import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// Alcanza para el orden completo del tablero (hasta 5000 pendientes de ~60 bytes cada uno).
const MAX_BODY_BYTES = 512 * 1024;
const MAX_TEXTO = 500;
const MAX_PROYECTO = 60;
const MAX_NOMBRE = 40;
const ESTADOS = ['pendiente', 'haciendo', 'hecho'];
const COLORES = ['#2563EB', '#DB2777', '#059669', '#7C3AED', '#EA580C', '#0891B2', '#CA8A04', '#DC2626'];
const PERFILES_INICIALES = ['Favio', 'Diego', 'Junior'];
const API_PATH = '/api/pendientes';
const ORDER_PATH = '/api/pendientes/orden';
const PERFILES_PATH = '/api/pendientes/perfiles';
const ITEM_PATH = /^\/api\/pendientes\/([0-9a-f-]{36})$/;
const PERFIL_PATH = /^\/api\/pendientes\/perfiles\/([0-9a-f-]{36})$/;
const SELECT_PENDIENTE = 'SELECT id, texto, proyecto, estado, perfil_id, creado_en, actualizado_en FROM pendientes';
const SELECT_PERFIL = 'SELECT id, nombre, color, creado_en FROM perfiles';

// Cada función lleva la base de una versión a la siguiente; la versión vive en PRAGMA user_version.
const MIGRACIONES = [
  (db) => {
    db.exec(`
      CREATE TABLE perfiles (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
        color TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE TABLE pendientes (
        id TEXT PRIMARY KEY,
        texto TEXT NOT NULL,
        proyecto TEXT,
        estado TEXT NOT NULL CHECK (estado IN ('pendiente', 'haciendo', 'hecho')),
        perfil_id TEXT REFERENCES perfiles(id) ON DELETE SET NULL,
        posicion INTEGER NOT NULL,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX pendientes_posicion ON pendientes (posicion);
    `);
    const now = new Date().toISOString();
    const insert = db.prepare('INSERT INTO perfiles (id, nombre, color, creado_en) VALUES (?, ?, ?, ?)');
    PERFILES_INICIALES.forEach((nombre, i) => insert.run(randomUUID(), nombre, COLORES[i], now));
  },
];

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
  if ('perfil_id' in input) {
    if (input.perfil_id !== null && typeof input.perfil_id !== 'string') throw httpError(422, 'perfil_invalido');
    changes.perfil_id = input.perfil_id || null;
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

export function parsePerfil(input) {
  const nombre = typeof input.nombre === 'string' ? input.nombre.trim() : '';
  if (!nombre || nombre.length > MAX_NOMBRE) throw httpError(422, 'nombre_invalido');
  if (input.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(input.color)) throw httpError(422, 'color_invalido');
  return { nombre, color: input.color };
}

function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// node:sqlite devuelve objetos sin prototipo; se copian para que se comporten como objetos normales.
const fila = (row) => (row ? { ...row } : null);

// La primera versión guardaba todo en pendientes.json: se pasa a la base una sola vez.
function importarJson(db, dataDir) {
  const file = path.join(dataDir, 'pendientes.json');
  if (!existsSync(file)) return;
  const items = JSON.parse(readFileSync(file, 'utf8'));
  const insert = db.prepare(`INSERT OR IGNORE INTO pendientes (id, texto, proyecto, estado, perfil_id, posicion, creado_en, actualizado_en)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`);
  transaction(db, () => items.forEach((item, i) => (
    insert.run(item.id, item.texto, item.proyecto ?? null, item.estado ?? 'pendiente', i, item.creado_en, item.actualizado_en)
  )));
  renameSync(file, `${file}.importado`);
}

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'pendientes.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let next = version; next < MIGRACIONES.length; next++) {
    transaction(db, () => {
      MIGRACIONES[next](db);
      db.exec(`PRAGMA user_version = ${next + 1}`);
    });
  }
  importarJson(db, dataDir);
  return db;
}

function createRepo(db) {
  const pendiente = (id) => fila(db.prepare(`${SELECT_PENDIENTE} WHERE id = ?`).get(id));
  const perfil = (id) => fila(db.prepare(`${SELECT_PERFIL} WHERE id = ?`).get(id));

  function verificarPerfil(perfilId) {
    if (perfilId && !perfil(perfilId)) throw httpError(422, 'perfil_invalido');
  }

  return {
    listarPendientes: () => db.prepare(`${SELECT_PENDIENTE} ORDER BY posicion, creado_en DESC`).all().map(fila),

    crearPendiente(changes) {
      verificarPerfil(changes.perfil_id);
      const now = new Date().toISOString();
      const id = randomUUID();
      // Lo nuevo va arriba de todo.
      const { minimo } = db.prepare('SELECT COALESCE(MIN(posicion), 0) AS minimo FROM pendientes').get();
      db.prepare(`INSERT INTO pendientes (id, texto, proyecto, estado, perfil_id, posicion, creado_en, actualizado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, changes.texto, changes.proyecto ?? null, changes.estado ?? 'pendiente', changes.perfil_id ?? null, minimo - 1, now, now);
      return pendiente(id);
    },

    actualizarPendiente(id, changes) {
      if (!pendiente(id)) return null;
      verificarPerfil(changes.perfil_id);
      // Las columnas salen de parsePendiente, que solo deja pasar campos conocidos.
      const campos = Object.keys(changes);
      db.prepare(`UPDATE pendientes SET ${[...campos.map((campo) => `${campo} = ?`), 'actualizado_en = ?'].join(', ')} WHERE id = ?`)
        .run(...campos.map((campo) => changes[campo]), new Date().toISOString(), id);
      return pendiente(id);
    },

    borrarPendiente: (id) => db.prepare('DELETE FROM pendientes WHERE id = ?').run(id).changes > 0,

    ordenar(orden) {
      const now = new Date().toISOString();
      const update = db.prepare(`UPDATE pendientes
        SET posicion = ?, actualizado_en = CASE WHEN estado <> ? THEN ? ELSE actualizado_en END, estado = ?
        WHERE id = ?`);
      transaction(db, () => {
        // Lo que el tablero no conocía (otro lo creó mientras tanto) queda al final, en su mismo orden.
        db.exec('UPDATE pendientes SET posicion = posicion + 1000000');
        orden.forEach(({ id, estado }, i) => update.run(i, estado, now, estado, id));
        db.exec(`WITH r AS (SELECT id, ROW_NUMBER() OVER (ORDER BY posicion) - 1 AS n FROM pendientes)
          UPDATE pendientes SET posicion = (SELECT n FROM r WHERE r.id = pendientes.id)`);
      });
      return this.listarPendientes();
    },

    listarPerfiles: () => db.prepare(`${SELECT_PERFIL} ORDER BY creado_en, rowid`).all().map(fila),

    crearPerfil({ nombre, color }) {
      if (db.prepare('SELECT 1 FROM perfiles WHERE nombre = ?').get(nombre)) throw httpError(409, 'perfil_duplicado');
      const { total } = db.prepare('SELECT COUNT(*) AS total FROM perfiles').get();
      const id = randomUUID();
      db.prepare('INSERT INTO perfiles (id, nombre, color, creado_en) VALUES (?, ?, ?, ?)')
        .run(id, nombre, color ?? COLORES[total % COLORES.length], new Date().toISOString());
      return perfil(id);
    },

    // Sus pendientes quedan sin asignar (ON DELETE SET NULL).
    borrarPerfil: (id) => db.prepare('DELETE FROM perfiles WHERE id = ?').run(id).changes > 0,
  };
}

export function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || '/data';
  const authUser = options.authUser || process.env.AUTH_USER || 'pendientes';
  const authPassword = options.authPassword ?? process.env.AUTH_PASSWORD ?? '';
  const db = openDb(dataDir);
  const repo = createRepo(db);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, service: 'timermayu-pendientes-api', configured: Boolean(authPassword) });
      }

      const known = [API_PATH, ORDER_PATH, PERFILES_PATH].includes(url.pathname) || ITEM_PATH.test(url.pathname) || PERFIL_PATH.test(url.pathname);
      if (!known) return json(res, 404, { error: 'not_found' });

      // Sin contraseña configurada no se abre a nadie. No se manda WWW-Authenticate para que
      // el navegador no muestre su ventana nativa: la página tiene su propio formulario de acceso.
      if (!authPassword || !basicAuth(req, authUser, authPassword)) {
        return json(res, 401, { error: 'authentication_required' });
      }

      if (url.pathname === API_PATH && req.method === 'GET') {
        return json(res, 200, { pendientes: repo.listarPendientes() });
      }

      if (url.pathname === API_PATH && req.method === 'POST') {
        return json(res, 201, { pendiente: repo.crearPendiente(parsePendiente(await readJson(req))) });
      }

      if (url.pathname === ORDER_PATH && req.method === 'PUT') {
        return json(res, 200, { pendientes: repo.ordenar(parseOrden(await readJson(req))) });
      }

      if (url.pathname === PERFILES_PATH && req.method === 'GET') {
        return json(res, 200, { perfiles: repo.listarPerfiles() });
      }

      if (url.pathname === PERFILES_PATH && req.method === 'POST') {
        return json(res, 201, { perfil: repo.crearPerfil(parsePerfil(await readJson(req))) });
      }

      const perfilId = url.pathname.match(PERFIL_PATH)?.[1];
      if (perfilId && req.method === 'DELETE') {
        return repo.borrarPerfil(perfilId) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not_found' });
      }

      const id = url.pathname.match(ITEM_PATH)?.[1];

      if (id && req.method === 'PATCH') {
        const pendiente = repo.actualizarPendiente(id, parsePendiente(await readJson(req), { partial: true }));
        return pendiente ? json(res, 200, { pendiente }) : json(res, 404, { error: 'not_found' });
      }

      if (id && req.method === 'DELETE') {
        return repo.borrarPendiente(id) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not_found' });
      }

      return json(res, 405, { error: 'method_not_allowed' });
    } catch (error) {
      const status = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error(error);
      return json(res, status, { error: status === 500 ? 'internal_error' : error.message });
    }
  });
  server.on('close', () => db.close());
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const dataDir = process.env.DATA_DIR || '/data';
  if (!process.env.AUTH_PASSWORD) console.warn('AUTH_PASSWORD vacío: la API rechazará todas las peticiones.');
  createApp({ dataDir }).listen(port, '0.0.0.0', () => console.log(`Pendientes API listening on :${port}`));
}
