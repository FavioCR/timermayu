import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_PANEL_ROWS = 100;
const ALLOWED_EVENTS = new Set([
  'webhook.test',
  'digitization.completed',
  'digitization.failed',
  'certificate.issued',
]);

const PANEL_HTML = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Timermayu · Webhook Debug</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    body { margin: 0; background: #0b1020; color: #e6edf7; }
    main { width: min(1100px, calc(100% - 32px)); margin: 32px auto; }
    h1 { margin-bottom: 4px; font-size: 24px; }
    .muted { color: #91a0b8; }
    .card { background: #121a2d; border: 1px solid #26334d; border-radius: 12px; padding: 16px; margin: 16px 0; }
    .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    input, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #344564; }
    input { flex: 1; min-width: 260px; background: #090e1a; color: #fff; }
    button { background: #2867d8; color: white; cursor: pointer; }
    button.secondary { background: #1c2942; }
    .ok { color: #49d17d; } .bad { color: #ff6b76; } .warn { color: #f5c451; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid #26334d; padding: 10px 8px; vertical-align: top; }
    th { color: #91a0b8; font-weight: 500; }
    details { max-width: 100%; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #090e1a; padding: 12px; border-radius: 8px; max-height: 420px; overflow: auto; }
    code { color: #9bc2ff; }
  </style>
</head>
<body><main>
  <h1>Webhook Debug</h1>
  <div class="muted">Timermayu · receptor temporal</div>
  <section class="card">
    <div class="row"><strong>Estado:</strong> <span id="status">consultando…</span></div>
    <p><code>POST https://timer.practi.dev/webhooks/3i</code></p>
    <form id="secret-form" class="row">
      <input id="secret" type="password" autocomplete="off" placeholder="Pega aquí el whsec_... mostrado por la API">
      <button type="submit">Guardar secret</button>
      <span id="secret-result"></span>
    </form>
    <small class="muted">El secret se guarda en el volumen privado y nunca vuelve a mostrarse.</small>
  </section>
  <section class="card">
    <div class="row"><h2 style="margin:0;flex:1">Últimas solicitudes</h2><button id="refresh" class="secondary">Actualizar</button></div>
    <div style="overflow:auto"><table>
      <thead><tr><th>Recibido</th><th>Evento</th><th>Firma</th><th>Resultado</th><th>Detalle</th></tr></thead>
      <tbody id="events"><tr><td colspan="5" class="muted">Cargando…</td></tr></tbody>
    </table></div>
  </section>
<script>
const $ = (id) => document.getElementById(id);
const escJson = (value) => JSON.stringify(value, null, 2);
async function load() {
  const response = await fetch('/debug/webhooks/api/events', { cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const data = await response.json();
  $('status').textContent = data.configured ? 'listo para verificar firmas' : 'falta configurar el secret';
  $('status').className = data.configured ? 'ok' : 'warn';
  $('events').replaceChildren();
  if (!data.events.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td'); td.colSpan = 5; td.className = 'muted'; td.textContent = 'Aún no se recibieron solicitudes.';
    tr.append(td); $('events').append(tr); return;
  }
  for (const event of data.events) {
    const tr = document.createElement('tr');
    for (const text of [new Date(event.received_at).toLocaleString(), event.event_type || '—']) {
      const td = document.createElement('td'); td.textContent = text; tr.append(td);
    }
    const signature = document.createElement('td');
    signature.textContent = event.signature_valid ? 'válida' : 'inválida';
    signature.className = event.signature_valid ? 'ok' : 'bad'; tr.append(signature);
    const result = document.createElement('td'); result.textContent = event.result; tr.append(result);
    const detail = document.createElement('td');
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = event.event_id || event.request_id;
    const pre = document.createElement('pre'); pre.textContent = escJson(event);
    details.append(summary, pre); detail.append(details); tr.append(detail); $('events').append(tr);
  }
}
$('refresh').addEventListener('click', () => load().catch(showError));
$('secret-form').addEventListener('submit', async (e) => {
  e.preventDefault(); $('secret-result').textContent = 'guardando…';
  const response = await fetch('/debug/webhooks/api/secret', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({secret: $('secret').value}) });
  const data = await response.json();
  $('secret-result').textContent = response.ok ? 'Guardado' : (data.error || 'Error');
  $('secret-result').className = response.ok ? 'ok' : 'bad';
  if (response.ok) $('secret').value = '';
  await load();
});
function showError(error) { $('status').textContent = error.message; $('status').className = 'bad'; }
load().catch(showError);
</script></main></body></html>`;

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function computeSignature(secret, eventId, timestamp, rawBody) {
  return `v1=${createHmac('sha256', secret).update(`${eventId}.${timestamp}.`).update(rawBody).digest('hex')}`;
}

export function verifyWebhook({ secret, eventId, timestamp, signature, rawBody, now = Date.now() }) {
  if (!secret) return { valid: false, reason: 'secret_not_configured' };
  if (!eventId || !timestamp || !signature) return { valid: false, reason: 'missing_headers' };
  if (!/^\d+$/.test(timestamp)) return { valid: false, reason: 'invalid_timestamp' };
  const age = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_CLOCK_SKEW_SECONDS) return { valid: false, reason: 'expired_timestamp' };
  const expected = computeSignature(secret, eventId, timestamp, rawBody);
  return safeEqual(expected, signature)
    ? { valid: true, reason: null }
    : { valid: false, reason: 'invalid_signature' };
}

async function readBody(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('body_too_large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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

async function ensureStorage(dataDir) {
  await mkdir(path.join(dataDir, 'requests'), { recursive: true });
  await mkdir(path.join(dataDir, 'dedupe'), { recursive: true });
}

async function readSecret(dataDir) {
  try { return (await readFile(path.join(dataDir, 'webhook-secret'), 'utf8')).trim(); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

async function saveSecret(dataDir, secret) {
  const target = path.join(dataDir, 'webhook-secret');
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${secret}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function markOnce(dataDir, eventId) {
  const name = createHash('sha256').update(eventId).digest('hex');
  try {
    const handle = await open(path.join(dataDir, 'dedupe', name), 'wx', 0o600);
    await handle.writeFile(`${new Date().toISOString()}\n`);
    await handle.close();
    return false;
  } catch (error) {
    if (error.code === 'EEXIST') return true;
    throw error;
  }
}

async function storeRequest(dataDir, record) {
  const filename = `${Date.now()}-${record.request_id}.json`;
  await writeFile(path.join(dataDir, 'requests', filename), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

async function latestRequests(dataDir) {
  const directory = path.join(dataDir, 'requests');
  const entries = await readdir(directory);
  const selected = entries.filter((name) => name.endsWith('.json')).sort().reverse().slice(0, MAX_PANEL_ROWS);
  const records = [];
  for (const name of selected) {
    try { records.push(JSON.parse(await readFile(path.join(directory, name), 'utf8'))); } catch { /* Ignore incomplete/corrupt debug entries. */ }
  }
  return records;
}

function publicHeaders(req) {
  return {
    'webhook-id': req.headers['webhook-id'] || null,
    'webhook-delivery': req.headers['webhook-delivery'] || null,
    'webhook-timestamp': req.headers['webhook-timestamp'] || null,
    'webhook-signature': req.headers['webhook-signature'] ? '[present]' : null,
    'content-type': req.headers['content-type'] || null,
    'user-agent': req.headers['user-agent'] || null,
  };
}

export function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || '/data';
  const panelUser = options.panelUser || process.env.PANEL_USER || 'debug';
  const panelPassword = options.panelPassword || process.env.PANEL_PASSWORD || '';

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, service: 'timermayu-webhook-receiver', configured: Boolean(await readSecret(dataDir)) });
      }

      if (url.pathname.startsWith('/debug/webhooks')) {
        if (!panelPassword || !basicAuth(req, panelUser, panelPassword)) {
          return json(res, 401, { error: 'authentication_required' }, { 'WWW-Authenticate': 'Basic realm="Timermayu Webhook Debug", charset="UTF-8"' });
        }
        if (url.pathname === '/debug/webhooks' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'" });
          return res.end(PANEL_HTML);
        }
        if (url.pathname === '/debug/webhooks/api/events' && req.method === 'GET') {
          return json(res, 200, { configured: Boolean(await readSecret(dataDir)), events: await latestRequests(dataDir) });
        }
        if (url.pathname === '/debug/webhooks/api/secret' && req.method === 'POST') {
          const input = JSON.parse((await readBody(req, 4096)).toString('utf8'));
          if (typeof input.secret !== 'string' || !/^whsec_[A-Za-z0-9_-]{32,}$/.test(input.secret)) {
            return json(res, 422, { error: 'secret_invalid' });
          }
          await saveSecret(dataDir, input.secret);
          return json(res, 200, { ok: true, configured: true });
        }
        return json(res, 404, { error: 'not_found' });
      }

      if (url.pathname === '/webhooks/3i' && req.method === 'POST') {
        const rawBody = await readBody(req);
        const eventId = String(req.headers['webhook-id'] || '');
        const timestamp = String(req.headers['webhook-timestamp'] || '');
        const signature = String(req.headers['webhook-signature'] || '');
        const verification = verifyWebhook({ secret: await readSecret(dataDir), eventId, timestamp, signature, rawBody });
        let payload = null;
        let parseError = null;
        try { payload = JSON.parse(rawBody.toString('utf8')); } catch { parseError = 'invalid_json'; }

        let status = 200;
        let result = 'accepted';
        let duplicate = false;
        if (!verification.valid) { status = verification.reason === 'secret_not_configured' ? 503 : 401; result = verification.reason; }
        else if (parseError) { status = 400; result = parseError; }
        else if (payload.id !== eventId) { status = 400; result = 'event_id_mismatch'; }
        else if (!ALLOWED_EVENTS.has(payload.type)) { status = 422; result = 'unsupported_event'; }
        else { duplicate = await markOnce(dataDir, eventId); result = duplicate ? 'duplicate' : 'accepted'; }

        const record = {
          request_id: randomUUID(),
          received_at: new Date().toISOString(),
          event_id: eventId || payload?.id || null,
          event_type: payload?.type || null,
          delivery_id: req.headers['webhook-delivery'] || null,
          signature_valid: verification.valid,
          signature_error: verification.reason,
          duplicate,
          result,
          response_status: status,
          headers: publicHeaders(req),
          payload,
          raw_body: rawBody.toString('utf8'),
        };
        await storeRequest(dataDir, record);
        return json(res, status, { ok: status >= 200 && status < 300, event_id: record.event_id, type: record.event_type, duplicate, signature_valid: verification.valid, result });
      }

      return json(res, 404, { error: 'not_found' });
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
  await ensureStorage(dataDir);
  createApp({ dataDir }).listen(port, '0.0.0.0', () => console.log(`Webhook receiver listening on :${port}`));
}
