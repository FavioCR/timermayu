import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXTO = 500;
const MAX_PROYECTO = 60;
const ESTADOS = ['pendiente', 'haciendo', 'hecho'];
const API_PATH = '/api/pendientes';
const ORDER_PATH = '/api/pendientes/orden';
const ITEM_PATH = /^\/api\/pendientes\/([0-9a-f-]{36})$/;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function httpError(status, message) {
  return Object.assign(new Error(message), { statusCode: status });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, 'body_too_large');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'invalid_json');
  return input;
}

function basicAuth(req, user, password) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  return safeEqual(decoded.slice(0, separator), user) && safeEqual(decoded.slice(separator + 1), password);
}

export function parsePendiente(input, { partial = false } = {}) {
  const changes = {};
  if (!partial || 'texto' in input) {
    const texto = typeof input.texto === 'string' ? input.texto.trim() : '';
    if (!texto || texto.length > MAX_TEXTO) throw httpError(422, 'texto_invalido');
    changes.texto = texto;
  }
  if ('proyecto' in input) {
    if (input.proyecto !== null && typeof input.proyecto !== 'string') throw httpError(422, 'proyecto_invalido');
    const proyecto = (input.proyecto || '').trim().toLowerCase();
    if (proyecto.length > MAX_PROYECTO) throw httpError(422, 'proyecto_invalido');
    changes.proyecto = proyecto || null;
  }
  if ('estado' in input) {
    if (!ESTADOS.includes(input.estado)) throw httpError(422, 'estado_invalido');
    changes.estado = input.estado;
  }
  return changes;
}

// El tablero manda el orden completo después de arrastrar: [{ id, estado }, ...].
export function parseOrden(input) {
  if (!Array.isArray(input.items) || input.items.length > 5000) throw httpError(422, 'orden_invalido');
  return input.items.map((item) => {
    if (!item || typeof item.id !== 'string' || !ESTADOS.includes(item.estado)) throw httpError(422, 'orden_invalido');
    return { id: item.id, estado: item.estado };
  });
}

export function applyOrden(items, orden) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const now = new Date().toISOString();
  const sorted = [];
  for (const { id, estado } of orden) {
    const item = byId.get(id);
    if (!item) continue;
    if (item.estado !== estado) Object.assign(item, { estado, actualizado_en: now });
    sorted.push(item);
    byId.delete(id);
  }
  // Lo que el tablero no conocía (otro lo creó mientras tanto) se queda al final.
  items.splice(0, items.length, ...sorted, ...byId.values());
  return items;
}

function createStore(dataDir) {
  const file = path.join(dataDir, 'pendientes.json');
  let queue = Promise.resolve();

  async function list() {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }

  async function save(items) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  }

  // Las escrituras van en fila para que dos peticiones simultáneas no se pisen el archivo.
  function update(change) {
    const run = queue.then(async () => {
      const items = await list();
      const result = change(items);
      await save(items);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  return { list, update };
}

export function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || '/data';
  const authUser = options.authUser || process.env.AUTH_USER || 'pendientes';
  const authPassword = options.authPassword ?? process.env.AUTH_PASSWORD ?? '';
  const store = createStore(dataDir);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, service: 'timermayu-pendientes-api', configured: Boolean(authPassword) });
      }

      if (url.pathname !== API_PATH && url.pathname !== ORDER_PATH && !ITEM_PATH.test(url.pathname)) {
        return json(res, 404, { error: 'not_found' });
      }

      // Sin contraseña configurada no se abre a nadie. No se manda WWW-Authenticate para que
      // el navegador no muestre su ventana nativa: la página tiene su propio formulario de acceso.
      if (!authPassword || !basicAuth(req, authUser, authPassword)) {
        return json(res, 401, { error: 'authentication_required' });
      }

      if (url.pathname === API_PATH && req.method === 'GET') {
        return json(res, 200, { pendientes: await store.list() });
      }

      if (url.pathname === API_PATH && req.method === 'POST') {
        const changes = parsePendiente(await readJson(req));
        const now = new Date().toISOString();
        const pendiente = { id: randomUUID(), texto: changes.texto, proyecto: changes.proyecto ?? null, estado: changes.estado ?? 'pendiente', creado_en: now, actualizado_en: now };
        await store.update((items) => { items.unshift(pendiente); });
        return json(res, 201, { pendiente });
      }

      if (url.pathname === ORDER_PATH && req.method === 'PUT') {
        const orden = parseOrden(await readJson(req));
        return json(res, 200, { pendientes: await store.update((items) => applyOrden(items, orden)) });
      }

      const id = url.pathname.match(ITEM_PATH)?.[1];

      if (id && req.method === 'PATCH') {
        const changes = parsePendiente(await readJson(req), { partial: true });
        const pendiente = await store.update((items) => {
          const item = items.find((candidate) => candidate.id === id);
          if (!item) return null;
          Object.assign(item, changes, { actualizado_en: new Date().toISOString() });
          return item;
        });
        return pendiente ? json(res, 200, { pendiente }) : json(res, 404, { error: 'not_found' });
      }

      if (id && req.method === 'DELETE') {
        const deleted = await store.update((items) => {
          const index = items.findIndex((candidate) => candidate.id === id);
          if (index < 0) return false;
          items.splice(index, 1);
          return true;
        });
        return deleted ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not_found' });
      }

      return json(res, 405, { error: 'method_not_allowed' });
    } catch (error) {
      const status = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
      return json(res, status, { error: status === 500 ? 'internal_error' : error.message });
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const dataDir = process.env.DATA_DIR || '/data';
  await mkdir(dataDir, { recursive: true });
  if (!process.env.AUTH_PASSWORD) console.warn('AUTH_PASSWORD vacío: la API rechazará todas las peticiones.');
  createApp({ dataDir }).listen(port, '0.0.0.0', () => console.log(`Pendientes API listening on :${port}`));
}
