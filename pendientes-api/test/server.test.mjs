import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createApp, openDb, parseOrden, parseOrganizacion, parsePendiente, parsePerfil, parseProyecto, resumirDescripcion, tipoDeImagen } from '../src/server.mjs';

const password = 'test-password';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const basic = (usuario, contrasena) => `Basic ${Buffer.from(`${usuario}:${contrasena}`).toString('base64')}`;
const auth = basic('pendientes', password);

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
  // Le pone contraseña a un perfil (desde la cuenta del equipo) y devuelve funciones para llamar como ese perfil.
  const entrarComo = async (nombre) => {
    const { perfiles } = await data('GET', '/perfiles');
    const perfil = perfiles.find((p) => p.nombre === nombre);
    const contrasena = `clave-de-${nombre}`;
    assert.equal((await call('PUT', `/perfiles/${perfil.id}/contrasena`, { contrasena })).status, 200);
    const headers = { Authorization: basic(nombre, contrasena) };
    const llamar = (method, ruta, body) => call(method, ruta, body, headers);
    return { perfil, contrasena, headers, call: llamar, data: async (method, ruta, body) => (await llamar(method, ruta, body)).json() };
  };
  return { dataDir, base, call, data, entrarComo };
}

test('valida pendientes, perfiles, organizaciones, proyectos y orden', () => {
  assert.deepEqual(parsePendiente({ texto: '  Revisar logs  ', proyecto_id: null }), { texto: 'Revisar logs', proyecto_id: null });
  assert.deepEqual(parsePendiente({ estado: 'haciendo', perfil_id: null }, { partial: true }), { estado: 'haciendo', perfil_id: null });
  assert.throws(() => parsePendiente({ texto: '   ' }), /texto_invalido/);
  assert.throws(() => parsePendiente({ texto: 'x'.repeat(501) }), /texto_invalido/);
  assert.throws(() => parsePendiente({ estado: 'listo' }, { partial: true }), /estado_invalido/);
  assert.throws(() => parsePendiente({ perfil_id: 3 }, { partial: true }), /perfil_invalido/);
  assert.throws(() => parsePendiente({ proyecto_id: 3 }, { partial: true }), /proyecto_invalido/);
  assert.deepEqual(parsePerfil({ nombre: ' Ana ' }), { nombre: 'Ana' });
  assert.deepEqual(parsePerfil({ nombre: 'Ana', correo: ' ana@ejemplo.com ' }), { nombre: 'Ana', correo: 'ana@ejemplo.com' });
  assert.deepEqual(parsePerfil({ nombre: 'Ana', correo: '' }), { nombre: 'Ana', correo: null });
  assert.throws(() => parsePerfil({ nombre: 'Ana', correo: 'ana' }), /correo_invalido/);
  assert.throws(() => parsePerfil({ nombre: '' }), /nombre_invalido/);
  assert.throws(() => parsePerfil({ nombre: 'Ana', color: 'rojo' }), /color_invalido/);
  assert.deepEqual(parseOrganizacion({ nombre: ' Mayugo ', compartida: false }), { nombre: 'Mayugo', compartida: false });
  assert.throws(() => parseOrganizacion({ nombre: 'Mayugo', compartida: 'sí' }), /compartida_invalida/);
  assert.deepEqual(parseProyecto({ nombre: ' Vendeizi ', organizacion_id: null }), { nombre: 'Vendeizi', organizacion_id: null });
  assert.throws(() => parseProyecto({ nombre: 'x'.repeat(61) }), /nombre_invalido/);
  assert.throws(() => parseOrden({ items: [{ id: 'a', estado: 'otro' }] }), /orden_invalido/);
});

test('sin credenciales correctas responde 401 sin pedir la ventana del navegador', async (t) => {
  const { call } = await startServer(t);
  const response = await call('GET', '/perfiles', undefined, { Authorization: basic('pendientes', 'mala') });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), null);
});

test('sin contraseña configurada la cuenta del equipo no entra', async (t) => {
  const { call } = await startServer(t, { authPassword: '' });
  assert.equal((await call('GET', '', undefined, { Authorization: basic('pendientes', '') })).status, 401);
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

test('cada perfil entra con su contraseña, por nombre o por correo', async (t) => {
  const { call, data, entrarComo } = await startServer(t);
  assert.deepEqual((await data('GET', '/yo')).usuario, { perfil_id: null, nombre: 'Equipo' });

  const diego = await entrarComo('Diego');
  assert.deepEqual((await diego.data('GET', '/yo')).usuario, { perfil_id: diego.perfil.id, nombre: 'Diego' });
  assert.equal((await call('GET', '/yo', undefined, { Authorization: basic('diego', diego.contrasena) })).status, 200);
  assert.equal((await call('GET', '/yo', undefined, { Authorization: basic('Diego', 'otra-clave') })).status, 401);
  assert.equal((await call('GET', '/yo', undefined, { Authorization: basic('Favio', '') })).status, 401);
  assert.equal((await data('GET', '/perfiles')).perfiles.find((p) => p.nombre === 'Diego').tiene_contrasena, true);
  assert.equal(JSON.stringify(await data('GET', '/perfiles')).includes('scrypt'), false);

  // Ya puesta, solo él la cambia; y la contraseña corta no vale.
  assert.equal((await call('PUT', `/perfiles/${diego.perfil.id}/contrasena`, { contrasena: 'la-pone-otro' })).status, 403);
  assert.equal((await diego.call('PUT', `/perfiles/${diego.perfil.id}/contrasena`, { contrasena: 'corta' })).status, 422);
  assert.equal((await diego.call('PUT', `/perfiles/${diego.perfil.id}/contrasena`, { contrasena: 'clave-nueva-1' })).status, 200);
  assert.equal((await diego.call('GET', '/yo')).status, 401);

  // Con correo también entra por correo.
  const nuevo = { Authorization: basic('Diego', 'clave-nueva-1') };
  assert.equal((await call('PATCH', `/perfiles/${diego.perfil.id}`, { correo: 'diego@ejemplo.com' }, nuevo)).status, 200);
  assert.equal((await call('GET', '/yo', undefined, { Authorization: basic('DIEGO@ejemplo.com', 'clave-nueva-1') })).status, 200);
});

test('tras muchos intentos fallidos con un usuario lo frena un rato', async (t) => {
  const { call, entrarComo } = await startServer(t);
  const junior = await entrarComo('Junior');
  for (let i = 0; i < 10; i++) assert.equal((await call('GET', '/yo', undefined, { Authorization: basic('Junior', 'adivinando') })).status, 401);
  assert.equal((await call('GET', '/yo', undefined, junior.headers)).status, 429);
  assert.equal((await call('GET', '/yo')).status, 200);
});

test('perfiles con correo opcional; uno con contraseña solo se edita o quita a sí mismo', async (t) => {
  const { call, data, entrarComo } = await startServer(t);
  const created = await call('POST', '/perfiles', { nombre: 'Ana' });
  assert.equal(created.status, 201);
  const { perfil: ana } = await created.json();
  assert.equal(ana.correo, null);
  assert.match(ana.color, /^#[0-9A-F]{6}$/);
  assert.equal((await call('POST', '/perfiles', { nombre: 'ana' })).status, 409);
  assert.equal((await call('POST', '/perfiles', { nombre: 'Pendientes' })).status, 422);
  assert.equal((await call('POST', '/perfiles', { nombre: 'Luis', correo: 'luis@ejemplo.com' })).status, 201);
  assert.equal((await call('POST', '/perfiles', { nombre: 'Luisa', correo: 'LUIS@ejemplo.com' })).status, 409);
  assert.equal((await data('PATCH', `/perfiles/${ana.id}`, { correo: 'ana@ejemplo.com' })).perfil.correo, 'ana@ejemplo.com');
  assert.equal((await data('PATCH', `/perfiles/${ana.id}`, { correo: null })).perfil.correo, null);

  const { pendiente } = await data('POST', '', { texto: 'Probar impresora', perfil_id: ana.id });
  assert.equal((await call('DELETE', `/perfiles/${ana.id}`)).status, 200);
  assert.equal((await call('DELETE', `/perfiles/${ana.id}`)).status, 404);
  assert.equal((await data('GET')).pendientes.find((p) => p.id === pendiente.id).perfil_id, null);

  const favio = await entrarComo('Favio');
  assert.equal((await call('PATCH', `/perfiles/${favio.perfil.id}`, { nombre: 'Otro' })).status, 403);
  assert.equal((await call('DELETE', `/perfiles/${favio.perfil.id}`)).status, 403);
});

test('crea, asigna, mueve, edita y borra un pendiente', async (t) => {
  const { call, data } = await startServer(t);
  const { perfiles } = await data('GET', '/perfiles');
  const favio = perfiles.find((perfil) => perfil.nombre === 'Favio');
  const { proyecto } = await data('POST', '/proyectos', { nombre: 'nginx' });

  const created = await call('POST', '', { texto: 'Rotar token de Cloudflare', proyecto_id: proyecto.id, perfil_id: favio.id });
  assert.equal(created.status, 201);
  const { pendiente } = await created.json();
  assert.deepEqual([pendiente.estado, pendiente.proyecto_id, pendiente.perfil_id], ['pendiente', proyecto.id, favio.id]);

  const moved = await data('PATCH', `/${pendiente.id}`, { estado: 'hecho', perfil_id: null, proyecto_id: null });
  assert.deepEqual([moved.pendiente.estado, moved.pendiente.perfil_id, moved.pendiente.proyecto_id], ['hecho', null, null]);

  const edited = await data('PATCH', `/${pendiente.id}`, { texto: 'Rotar token del túnel' });
  assert.equal(edited.pendiente.texto, 'Rotar token del túnel');

  assert.equal((await call('PATCH', `/${pendiente.id}`, { perfil_id: crypto.randomUUID() })).status, 422);
  assert.equal((await call('PATCH', `/${pendiente.id}`, { proyecto_id: crypto.randomUUID() })).status, 422);
  assert.equal((await call('PATCH', `/${crypto.randomUUID()}`, { texto: 'nada' })).status, 404);

  assert.equal((await call('DELETE', `/${pendiente.id}`)).status, 200);
  assert.equal((await call('DELETE', `/${pendiente.id}`)).status, 404);
  assert.deepEqual((await data('GET')).pendientes, []);
});

test('organizaciones con proyectos: nombres únicos dentro de cada una, mover, renombrar y borrar vacíos', async (t) => {
  const { call, data } = await startServer(t);
  const { organizacion: mayugo } = await data('POST', '/organizaciones', { nombre: 'Mayugo' });
  assert.deepEqual([mayugo.duenio_id, mayugo.compartida], [null, true]);
  assert.equal((await call('POST', '/organizaciones', { nombre: 'mayugo' })).status, 409);
  const { organizacion: otra } = await data('POST', '/organizaciones', { nombre: 'Otra' });

  const crear = (nombre, organizacionId) => call('POST', '/proyectos', { nombre, organizacion_id: organizacionId });
  const vendeizi = (await (await crear('Vendeizi', mayugo.id)).json()).proyecto;
  assert.equal(vendeizi.organizacion_id, mayugo.id);
  assert.equal((await crear('vendeizi', mayugo.id)).status, 409);
  assert.equal((await crear('Vendeizi', otra.id)).status, 201);
  assert.equal((await crear('Vendeizi', null)).status, 201);
  assert.equal((await crear('Fantasma', crypto.randomUUID())).status, 422);
  const instituto = (await (await crear('Instituto de Ingeniería', mayugo.id)).json()).proyecto;

  assert.equal((await data('PATCH', `/proyectos/${instituto.id}`, { nombre: 'Instituto de ingeniería' })).proyecto.nombre, 'Instituto de ingeniería');
  assert.equal((await call('PATCH', `/proyectos/${vendeizi.id}`, { organizacion_id: otra.id })).status, 409);
  assert.equal((await data('PATCH', `/proyectos/${instituto.id}`, { organizacion_id: otra.id })).proyecto.organizacion_id, otra.id);

  const { pendiente } = await data('POST', '', { texto: 'Facturación', proyecto_id: vendeizi.id });
  assert.equal((await call('DELETE', `/proyectos/${vendeizi.id}`)).status, 409);
  assert.equal((await call('DELETE', `/organizaciones/${mayugo.id}`)).status, 409);
  await data('DELETE', `/${pendiente.id}`);
  assert.equal((await call('DELETE', `/organizaciones/${mayugo.id}`)).status, 200);
  assert.equal((await data('GET', '/proyectos')).proyectos.some((p) => p.id === vendeizi.id), false);
  assert.equal((await call('DELETE', `/proyectos/${instituto.id}`)).status, 200);
});

test('lo de una organización privada solo lo ve su dueño hasta que la comparte', async (t) => {
  const { base, call, data, entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');

  const { organizacion: personal } = await diego.data('POST', '/organizaciones', { nombre: 'Personal', compartida: false });
  assert.deepEqual([personal.duenio_id, personal.compartida], [diego.perfil.id, false]);
  const { proyecto: casa } = await diego.data('POST', '/proyectos', { nombre: 'Casa', organizacion_id: personal.id });
  const { pendiente: secreto } = await diego.data('POST', '', { texto: 'Pagar luz', proyecto_id: casa.id });
  const { pendiente: publico } = await diego.data('POST', '', { texto: 'Para todos' });
  const imagen = (await (await fetch(`${base}/api/pendientes/${secreto.id}/imagenes`, { method: 'POST', headers: diego.headers, body: PNG })).json()).imagen;

  // Favio y la cuenta del equipo no ven nada de Personal: ni la organización, ni el proyecto, ni el pendiente.
  for (const otro of [favio, { call, data, headers: { Authorization: auth } }]) {
    assert.equal((await otro.data('GET', '/organizaciones')).organizaciones.some((o) => o.id === personal.id), false);
    assert.equal((await otro.data('GET', '/proyectos')).proyectos.some((p) => p.id === casa.id), false);
    assert.deepEqual((await otro.data('GET')).pendientes.map((p) => p.texto), ['Para todos']);
    assert.equal((await otro.call('GET', `/${secreto.id}`)).status, 404);
    assert.equal((await otro.call('PATCH', `/${secreto.id}`, { texto: 'visto' })).status, 404);
    assert.equal((await otro.call('DELETE', `/${secreto.id}`)).status, 404);
    assert.equal((await otro.call('POST', '', { texto: 'colado', proyecto_id: casa.id })).status, 422);
    assert.equal((await otro.call('POST', '/proyectos', { nombre: 'colado', organizacion_id: personal.id })).status, 422);
    assert.equal((await fetch(`${base}${imagen.url}`, { headers: otro.headers })).status, 404);
    assert.equal((await otro.call('PATCH', `/organizaciones/${personal.id}`, { nombre: 'Mía' })).status, 404);
    // Si manda el orden, lo privado no se mueve.
    await otro.call('PUT', '/orden', { items: [{ id: secreto.id, estado: 'hecho' }, { id: publico.id, estado: 'haciendo' }] });
  }
  assert.equal((await diego.data('GET', `/${secreto.id}`)).pendiente.estado, 'pendiente');
  assert.equal((await fetch(`${base}${imagen.url}`, { headers: diego.headers })).status, 200);

  // La cuenta del equipo no crea privadas, y una del equipo no se vuelve privada.
  const { organizacion: delEquipo } = await data('POST', '/organizaciones', { nombre: 'Equipo', compartida: false });
  assert.deepEqual([delEquipo.duenio_id, delEquipo.compartida], [null, true]);
  assert.equal((await diego.call('PATCH', `/organizaciones/${delEquipo.id}`, { compartida: false })).status, 422);

  // Al compartirla la ve Favio, que puede agregar proyectos, pero no renombrarla ni volverla privada.
  assert.equal((await diego.data('PATCH', `/organizaciones/${personal.id}`, { compartida: true })).organizacion.compartida, true);
  assert.deepEqual((await favio.data('GET')).pendientes.map((p) => p.texto).sort(), ['Pagar luz', 'Para todos']);
  assert.equal((await favio.call('POST', '/proyectos', { nombre: 'Jardín', organizacion_id: personal.id })).status, 201);
  assert.equal((await favio.call('PATCH', `/organizaciones/${personal.id}`, { compartida: false })).status, 403);
  assert.equal((await favio.call('DELETE', `/organizaciones/${personal.id}`)).status, 403);

  // Con una privada no se puede quitar el perfil; las compartidas pasan al equipo.
  await diego.call('PATCH', `/organizaciones/${personal.id}`, { compartida: false });
  assert.equal((await diego.call('DELETE', `/perfiles/${diego.perfil.id}`)).status, 409);
  await diego.call('PATCH', `/organizaciones/${personal.id}`, { compartida: true });
  assert.equal((await diego.call('DELETE', `/perfiles/${diego.perfil.id}`)).status, 200);
  assert.equal((await favio.data('GET', '/organizaciones')).organizaciones.find((o) => o.id === personal.id).duenio_id, null);
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
  const { proyectos } = await data('GET', '/proyectos');
  assert.deepEqual(proyectos.map((p) => [p.nombre, p.organizacion_id]), [['kimba', null]]);
  assert.deepEqual((await data('GET')).pendientes.map((p) => [p.texto, p.estado, p.proyecto_id]),
    [['Primero', 'haciendo', proyectos[0].id], ['Segundo', 'pendiente', null]]);
  assert.equal(existsSync(path.join(dataDir, 'pendientes.json')), false);
  assert.equal(existsSync(path.join(dataDir, 'pendientes.json.importado')), true);
});

test('quitar-contrasena deja a un perfil sin contraseña para que la vuelva a poner', async (t) => {
  const { dataDir, call, entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const servidor = new URL('../src/server.mjs', import.meta.url).pathname;
  const { stdout } = await promisify(execFile)(process.execPath, ['--disable-warning=ExperimentalWarning', servidor, 'quitar-contrasena', 'Diego'], {
    env: { ...process.env, DATA_DIR: dataDir },
  });
  assert.match(stdout, /Se quitó la contraseña de Diego/);
  assert.equal((await call('GET', '/yo', undefined, diego.headers)).status, 401);
  assert.equal((await call('PUT', `/perfiles/${diego.perfil.id}/contrasena`, { contrasena: 'otra-clave-1' })).status, 200);
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
  assert.equal((await call('PUT', '/organizaciones')).status, 405);
  assert.equal((await fetch(`${base}/otra-cosa`)).status, 404);
});
