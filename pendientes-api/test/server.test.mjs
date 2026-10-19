import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp, openDb, parseOrden, parsePendiente, parsePerfil, resumirDescripcion, tipoDeImagen } from '../src/server.mjs';

const password = 'test-password';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const auth = `Basic ${Buffer.from(`pendientes:${password}`).toString('base64')}`;

async function startServer(t, options = {}) {
  const dataDir = options.dataDir ?? await mkdtemp(path.join(tmpdir(), 'timermayu-pendientes-test-'));
  const server = createApp({ dataDir, authPassword: password, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, ruta = '', body, headers = { Authorization: auth }) => fetch(`${base}/api/pendientes${ruta}`, {
    method,
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = async (method, ruta, body) => (await call(method, ruta, body)).json();
  return { dataDir, base, call, data };
}

test('valida pendientes, perfiles y orden', () => {
  assert.deepEqual(parsePendiente({ texto: '  Revisar logs  ', proyecto: ' Kimba ' }), { texto: 'Revisar logs', proyecto: 'kimba' });
  assert.deepEqual(parsePendiente({ estado: 'haciendo', perfil_id: null }, { partial: true }), { estado: 'haciendo', perfil_id: null });
  assert.throws(() => parsePendiente({ texto: '   ' }), /texto_invalido/);
  assert.throws(() => parsePendiente({ texto: 'x'.repeat(501) }), /texto_invalido/);
  assert.throws(() => parsePendiente({ estado: 'listo' }, { partial: true }), /estado_invalido/);
  assert.throws(() => parsePendiente({ perfil_id: 3 }, { partial: true }), /perfil_invalido/);
  assert.deepEqual(parsePerfil({ nombre: ' Ana ' }), { nombre: 'Ana', color: undefined });
  assert.throws(() => parsePerfil({ nombre: '' }), /nombre_invalido/);
  assert.throws(() => parsePerfil({ nombre: 'Ana', color: 'rojo' }), /color_invalido/);
  assert.throws(() => parseOrden({ items: [{ id: 'a', estado: 'otro' }] }), /orden_invalido/);
});

test('sin credenciales correctas responde 401 sin pedir la ventana del navegador', async (t) => {
  const { call } = await startServer(t);
  const response = await call('GET', '/perfiles', undefined, { Authorization: `Basic ${Buffer.from('pendientes:mala').toString('base64')}` });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), null);
});

test('sin contraseña configurada no deja entrar a nadie', async (t) => {
  const { call } = await startServer(t, { authPassword: '' });
  assert.equal((await call('GET', '', undefined, { Authorization: `Basic ${Buffer.from('pendientes:').toString('base64')}` })).status, 401);
});

test('la base nueva trae a Favio, Diego y Junior una sola vez', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'timermayu-pendientes-db-'));
  const db = openDb(dataDir);
  const nombres = () => db.prepare('SELECT nombre FROM perfiles ORDER BY nombre').all().map((row) => row.nombre);
  assert.deepEqual(nombres(), ['Diego', 'Favio', 'Junior']);
  db.prepare("DELETE FROM perfiles WHERE nombre = 'Junior'").run();
  db.close();
  const reopened = openDb(dataDir);
  assert.deepEqual(reopened.prepare('SELECT nombre FROM perfiles ORDER BY nombre').all().map((row) => row.nombre), ['Diego', 'Favio']);
  reopened.close();
});

test('crea, asigna, mueve, edita y borra un pendiente', async (t) => {
  const { call, data } = await startServer(t);
  const { perfiles } = await data('GET', '/perfiles');
  const favio = perfiles.find((perfil) => perfil.nombre === 'Favio');

  const created = await call('POST', '', { texto: 'Rotar token de Cloudflare', proyecto: 'nginx', perfil_id: favio.id });
  assert.equal(created.status, 201);
  const { pendiente } = await created.json();
  assert.deepEqual([pendiente.estado, pendiente.proyecto, pendiente.perfil_id], ['pendiente', 'nginx', favio.id]);

  const moved = await data('PATCH', `/${pendiente.id}`, { estado: 'hecho', perfil_id: null });
  assert.deepEqual([moved.pendiente.estado, moved.pendiente.perfil_id], ['hecho', null]);

  const edited = await data('PATCH', `/${pendiente.id}`, { texto: 'Rotar token del túnel' });
  assert.equal(edited.pendiente.texto, 'Rotar token del túnel');

  assert.equal((await call('PATCH', `/${pendiente.id}`, { perfil_id: crypto.randomUUID() })).status, 422);
  assert.equal((await call('PATCH', `/${crypto.randomUUID()}`, { texto: 'nada' })).status, 404);

  assert.equal((await call('DELETE', `/${pendiente.id}`)).status, 200);
  assert.equal((await call('DELETE', `/${pendiente.id}`)).status, 404);
  assert.deepEqual((await data('GET')).pendientes, []);
});

test('agrega y quita perfiles; al quitar uno sus pendientes quedan sin asignar', async (t) => {
  const { call, data } = await startServer(t);
  const created = await call('POST', '/perfiles', { nombre: 'Ana' });
  assert.equal(created.status, 201);
  const { perfil: ana } = await created.json();
  assert.match(ana.color, /^#[0-9A-F]{6}$/);
  assert.equal((await call('POST', '/perfiles', { nombre: 'ana' })).status, 409);

  const { pendiente } = await data('POST', '', { texto: 'Probar impresora', perfil_id: ana.id });
  assert.equal((await call('DELETE', `/perfiles/${ana.id}`)).status, 200);
  assert.equal((await call('DELETE', `/perfiles/${ana.id}`)).status, 404);
  assert.equal((await data('GET')).pendientes.find((p) => p.id === pendiente.id).perfil_id, null);
  assert.deepEqual((await data('GET', '/perfiles')).perfiles.map((p) => p.nombre), ['Favio', 'Diego', 'Junior']);
});

test('las altas simultáneas no se pierden y lo nuevo queda arriba', async (t) => {
  const { data } = await startServer(t);
  await Promise.all(Array.from({ length: 20 }, (_, i) => data('POST', '', { texto: `Pendiente ${i}` })));
  await data('POST', '', { texto: 'El último' });
  const { pendientes } = await data('GET');
  assert.equal(pendientes.length, 21);
  assert.equal(pendientes[0].texto, 'El último');
});

test('guarda el orden del tablero y deja al final lo que el tablero no conocía', async (t) => {
  const { call, data } = await startServer(t);
  const a = (await data('POST', '', { texto: 'A' })).pendiente;
  const b = (await data('POST', '', { texto: 'B' })).pendiente;
  const c = (await data('POST', '', { texto: 'C' })).pendiente;
  const response = await call('PUT', '/orden', { items: [
    { id: a.id, estado: 'hecho' },
    { id: c.id, estado: 'pendiente' },
    { id: crypto.randomUUID(), estado: 'haciendo' },
  ] });
  assert.equal(response.status, 200);
  const { pendientes } = await data('GET');
  assert.deepEqual(pendientes.map((p) => [p.texto, p.estado]), [['A', 'hecho'], ['C', 'pendiente'], ['B', 'pendiente']]);
  assert.notEqual(pendientes[0].actualizado_en, a.actualizado_en);
  assert.equal(pendientes[1].actualizado_en, c.actualizado_en);
  assert.equal(b.id, pendientes[2].id);
});

test('acepta el orden de un tablero grande', async (t) => {
  const { call } = await startServer(t);
  const items = Array.from({ length: 5000 }, () => ({ id: crypto.randomUUID(), estado: 'hecho' }));
  assert.equal((await call('PUT', '/orden', { items })).status, 200);
});

test('importa una sola vez los pendientes de la versión con archivo JSON', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'timermayu-pendientes-json-'));
  const now = new Date().toISOString();
  await writeFile(path.join(dataDir, 'pendientes.json'), JSON.stringify([
    { id: crypto.randomUUID(), texto: 'Primero', proyecto: 'kimba', estado: 'haciendo', creado_en: now, actualizado_en: now },
    { id: crypto.randomUUID(), texto: 'Segundo', proyecto: null, estado: 'pendiente', creado_en: now, actualizado_en: now },
  ]));
  const { data } = await startServer(t, { dataDir });
  assert.deepEqual((await data('GET')).pendientes.map((p) => [p.texto, p.estado, p.perfil_id]), [['Primero', 'haciendo', null], ['Segundo', 'pendiente', null]]);
  assert.equal(existsSync(path.join(dataDir, 'pendientes.json')), false);
  assert.equal(existsSync(path.join(dataDir, 'pendientes.json.importado')), true);
});

test('reconoce las imágenes por su contenido y no por el nombre', () => {
  assert.equal(tipoDeImagen(PNG), 'image/png');
  assert.equal(tipoDeImagen(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])), 'image/jpeg');
  assert.equal(tipoDeImagen(Buffer.from('GIF89a......')), 'image/gif');
  assert.equal(tipoDeImagen(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(tipoDeImagen(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(tipoDeImagen(Buffer.alloc(0)), null);
});

test('resume la descripción en texto plano y cuenta sus imágenes', () => {
  const bloques = [
    { type: 'heading', content: [{ type: 'text', text: 'Pasos' }], children: [] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Revisar ' }, { type: 'link', href: 'https://x', content: [{ type: 'text', text: 'el log' }] }],
      children: [{ type: 'image', props: { url: '/api/pendientes/imagenes/abc' }, children: [] }] },
    { type: 'image', props: { url: '' }, children: [] },
    { type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: 'celda' }]] }] }, children: [] },
  ];
  assert.deepEqual(resumirDescripcion(bloques), { resumen: 'Pasos Revisar el log celda', num_imagenes: 1 });
  assert.deepEqual(resumirDescripcion([{ type: 'paragraph', content: [], children: [] }]), { resumen: null, num_imagenes: 0 });
});

test('guarda la descripción, la devuelve en el detalle y deja un resumen en la lista', async (t) => {
  const { call, data } = await startServer(t);
  const { pendiente } = await data('POST', '', { texto: 'Con descripción' });
  const descripcion = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Hay que revisar el túnel' }], children: [] }]);
  const saved = await data('PATCH', `/${pendiente.id}`, { descripcion });
  assert.equal(saved.pendiente.resumen, 'Hay que revisar el túnel');
  assert.equal((await data('GET', `/${pendiente.id}`)).pendiente.descripcion, descripcion);
  const enLista = (await data('GET')).pendientes[0];
  assert.equal(enLista.resumen, 'Hay que revisar el túnel');
  assert.equal('descripcion' in enLista, false);
  assert.equal((await call('PATCH', `/${pendiente.id}`, { descripcion: '{"no":"es lista"}' })).status, 422);
  assert.equal((await call('PATCH', `/${pendiente.id}`, { descripcion: 'x'.repeat(450 * 1024) })).status, 422);
  assert.equal((await call('GET', `/${crypto.randomUUID()}`)).status, 404);
});

test('sube imágenes, las sirve con contraseña y rechaza lo que no es imagen', async (t) => {
  const { base, data } = await startServer(t);
  const { pendiente } = await data('POST', '', { texto: 'Con captura' });
  const subir = (cuerpo, id = pendiente.id) => fetch(`${base}/api/pendientes/${id}/imagenes`, {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'image/png' }, body: cuerpo,
  });

  const subida = await subir(PNG);
  assert.equal(subida.status, 201);
  const { imagen } = await subida.json();
  assert.match(imagen.url, /^\/api\/pendientes\/imagenes\/[0-9a-f-]{36}$/);

  const servida = await fetch(`${base}${imagen.url}`, { headers: { Authorization: auth } });
  assert.equal(servida.status, 200);
  assert.equal(servida.headers.get('content-type'), 'image/png');
  assert.equal(servida.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await servida.arrayBuffer()), PNG);
  assert.equal((await fetch(`${base}${imagen.url}`)).status, 401);

  assert.equal((await subir(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))).status, 415);
  assert.equal((await subir(PNG, crypto.randomUUID())).status, 404);
  assert.equal((await subir(Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
});

test('borra las imágenes que salen de la descripción, salvo si otra tarjeta las usa', async (t) => {
  const { base, dataDir, data } = await startServer(t, { graciaImagenesMs: 0 });
  const subir = async (id) => (await (await fetch(`${base}/api/pendientes/${id}/imagenes`, {
    method: 'POST', headers: { Authorization: auth }, body: PNG,
  })).json()).imagen;
  const conImagenes = (...urls) => JSON.stringify(urls.map((url) => ({ type: 'image', props: { url }, children: [] })));
  const archivo = (imagen) => path.join(dataDir, 'imagenes', imagen.url.split('/').pop());

  const a = (await data('POST', '', { texto: 'A' })).pendiente;
  const b = (await data('POST', '', { texto: 'B' })).pendiente;
  const queda = await subir(a.id);
  const sale = await subir(a.id);
  const copiada = await subir(a.id);
  await data('PATCH', `/${b.id}`, { descripcion: conImagenes(copiada.url) });

  const saved = await data('PATCH', `/${a.id}`, { descripcion: conImagenes(queda.url) });
  assert.equal(saved.pendiente.num_imagenes, 1);
  assert.equal(existsSync(archivo(queda)), true);
  assert.equal(existsSync(archivo(sale)), false);
  assert.equal(existsSync(archivo(copiada)), true);
  assert.equal((await fetch(`${base}${sale.url}`, { headers: { Authorization: auth } })).status, 404);

  await data('DELETE', `/${a.id}`);
  assert.equal(existsSync(archivo(queda)), false);
});

test('rechaza JSON roto y rutas desconocidas', async (t) => {
  const { base, call } = await startServer(t);
  const broken = await fetch(`${base}/api/pendientes`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(broken.status, 400);
  assert.equal((await call('PUT')).status, 405);
  assert.equal((await call('PATCH', '/perfiles')).status, 405);
  assert.equal((await fetch(`${base}/otra-cosa`)).status, 404);
});
