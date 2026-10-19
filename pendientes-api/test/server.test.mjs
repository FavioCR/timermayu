import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyOrden, createApp, parseOrden, parsePendiente } from '../src/server.mjs';

const password = 'test-password';
const auth = `Basic ${Buffer.from(`pendientes:${password}`).toString('base64')}`;

async function startServer(t, options = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'timermayu-pendientes-test-'));
  const server = createApp({ dataDir, authPassword: password, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, ruta = '', body, headers = { Authorization: auth }) => fetch(`${base}/api/pendientes${ruta}`, {
    method,
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { dataDir, base, call };
}

test('valida texto, proyecto y estado', () => {
  assert.deepEqual(parsePendiente({ texto: '  Revisar logs  ', proyecto: ' Kimba ' }), { texto: 'Revisar logs', proyecto: 'kimba' });
  assert.deepEqual(parsePendiente({ estado: 'haciendo' }, { partial: true }), { estado: 'haciendo' });
  assert.throws(() => parsePendiente({ texto: '   ' }), /texto_invalido/);
  assert.throws(() => parsePendiente({ texto: 'x'.repeat(501) }), /texto_invalido/);
  assert.throws(() => parsePendiente({ estado: 'listo' }, { partial: true }), /estado_invalido/);
});

test('sin credenciales correctas responde 401 sin pedir la ventana del navegador', async (t) => {
  const { call } = await startServer(t);
  const response = await call('GET', '', undefined, { Authorization: `Basic ${Buffer.from('pendientes:mala').toString('base64')}` });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), null);
});

test('sin contraseña configurada no deja entrar a nadie', async (t) => {
  const { call } = await startServer(t, { authPassword: '' });
  assert.equal((await call('GET', '', undefined, { Authorization: `Basic ${Buffer.from('pendientes:').toString('base64')}` })).status, 401);
});

test('crea, mueve a hecho, edita y borra un pendiente', async (t) => {
  const { dataDir, call } = await startServer(t);

  const created = await call('POST', '', { texto: 'Rotar token de Cloudflare', proyecto: 'nginx' });
  assert.equal(created.status, 201);
  const { pendiente } = await created.json();
  assert.equal(pendiente.estado, 'pendiente');
  assert.equal(pendiente.proyecto, 'nginx');

  const done = await call('PATCH', `/${pendiente.id}`, { estado: 'hecho' });
  assert.equal(done.status, 200);
  assert.equal((await done.json()).pendiente.estado, 'hecho');

  const edited = await call('PATCH', `/${pendiente.id}`, { texto: 'Rotar token del túnel' });
  assert.equal((await edited.json()).pendiente.texto, 'Rotar token del túnel');

  const saved = JSON.parse(await readFile(path.join(dataDir, 'pendientes.json'), 'utf8'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].estado, 'hecho');

  assert.equal((await call('DELETE', `/${pendiente.id}`)).status, 200);
  assert.equal((await call('DELETE', `/${pendiente.id}`)).status, 404);
  assert.deepEqual((await (await call('GET')).json()).pendientes, []);
});

test('las altas simultáneas no se pierden', async (t) => {
  const { call } = await startServer(t);
  await Promise.all(Array.from({ length: 20 }, (_, i) => call('POST', '', { texto: `Pendiente ${i}` })));
  assert.equal((await (await call('GET')).json()).pendientes.length, 20);
});

test('reordena, cambia de columna y conserva lo que el tablero no conocía', () => {
  const items = [
    { id: 'a', estado: 'pendiente', actualizado_en: 'antes' },
    { id: 'b', estado: 'pendiente', actualizado_en: 'antes' },
    { id: 'c', estado: 'haciendo', actualizado_en: 'antes' },
  ];
  applyOrden(items, [{ id: 'b', estado: 'haciendo' }, { id: 'a', estado: 'pendiente' }, { id: 'fantasma', estado: 'hecho' }]);
  assert.deepEqual(items.map((item) => `${item.id}:${item.estado}`), ['b:haciendo', 'a:pendiente', 'c:haciendo']);
  assert.notEqual(items[0].actualizado_en, 'antes');
  assert.equal(items[1].actualizado_en, 'antes');
  assert.throws(() => parseOrden({ items: [{ id: 'a', estado: 'otro' }] }), /orden_invalido/);
});

test('guarda el orden del tablero por la API', async (t) => {
  const { call } = await startServer(t);
  const first = (await (await call('POST', '', { texto: 'Primero' })).json()).pendiente;
  const second = (await (await call('POST', '', { texto: 'Segundo' })).json()).pendiente;
  const response = await call('PUT', '/orden', { items: [{ id: first.id, estado: 'hecho' }, { id: second.id, estado: 'pendiente' }] });
  assert.equal(response.status, 200);
  const { pendientes } = await (await call('GET')).json();
  assert.deepEqual(pendientes.map((item) => [item.texto, item.estado]), [['Primero', 'hecho'], ['Segundo', 'pendiente']]);
});

test('rechaza JSON roto y rutas desconocidas', async (t) => {
  const { base, call } = await startServer(t);
  const broken = await fetch(`${base}/api/pendientes`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(broken.status, 400);
  assert.equal((await call('PUT')).status, 405);
  assert.equal((await fetch(`${base}/otra-cosa`)).status, 404);
});
