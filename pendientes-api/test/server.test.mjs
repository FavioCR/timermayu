import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  createApp,
  nombreDeArchivo,
  openDb,
  parseAjustesIA,
  parseComentario,
  parseEtiqueta,
  parseLeidas,
  parseOrden,
  parseOrganizacion,
  parsePendiente,
  parsePerfil,
  parseProyecto,
  parseSugerencia,
  parseTraspaso,
  resumirDescripcion,
  tipoDeArchivo,
  tipoDeImagen,
} from '../src/server.mjs';

const password = 'test-password';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const basic = (usuario, contrasena) => `Basic ${Buffer.from(`${usuario}:${contrasena}`).toString('base64')}`;
const auth = basic('pendientes', password);

// Un proveedor de IA falso: anota lo que le piden y contesta lo que diga `responder(ruta, cuerpo, headers)`.
async function startProveedor(t, responder) {
  const pedidos = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const cuerpo = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    pedidos.push({ ruta: req.url, metodo: req.method, headers: req.headers, cuerpo });
    const { status = 200, json } = responder(req.url, cuerpo, req.headers);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(json));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, pedidos };
}

// Lee los eventos de GET /eventos hasta juntar `cantidad` (o hasta que pase el tiempo) y cierra.
async function leerEventos(base, headers, { cliente = '', cantidad = 1, esperaMs = 1500, alConectar = async () => {} } = {}) {
  const control = new AbortController();
  const respuesta = await fetch(`${base}/api/pendientes/eventos?cliente=${cliente}`, { headers, signal: control.signal });
  assert.equal(respuesta.status, 200);
  assert.match(respuesta.headers.get('content-type'), /^text\/event-stream/);
  const eventos = [];
  const lector = respuesta.body.pipeThrough(new TextDecoderStream()).getReader();
  let resto = '';
  const temporizador = setTimeout(() => control.abort(), esperaMs);
  let conectado = false;
  try {
    while (eventos.length < cantidad) {
      const { value, done } = await lector.read();
      if (done) break;
      resto += value;
      const bloques = resto.split('\n\n');
      resto = bloques.pop();
      for (const bloque of bloques) {
        const datos = bloque.split('\n').find((linea) => linea.startsWith('data: '));
        if (!datos) continue;
        const evento = JSON.parse(datos.slice(6));
        if (evento.tipo === 'conectado' && !conectado) {
          conectado = true;
          await alConectar();
        } else {
          eventos.push(evento);
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
  } finally {
    clearTimeout(temporizador);
    control.abort();
  }
  return eventos;
}

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
  assert.deepEqual(parseOrganizacion({ miembros: ['a', 'b', 'a'] }, { partial: true }), { miembros: ['a', 'b'] });
  assert.throws(() => parseOrganizacion({ miembros: 'a' }, { partial: true }), /miembros_invalidos/);
  assert.throws(() => parseOrganizacion({ miembros: [1] }, { partial: true }), /miembros_invalidos/);
  assert.deepEqual(parseProyecto({ nombre: ' Vendeizi ', organizacion_id: null }), { nombre: 'Vendeizi', organizacion_id: null });
  assert.throws(() => parseProyecto({ nombre: 'x'.repeat(61) }), /nombre_invalido/);
  assert.throws(() => parseOrden({ items: [{ id: 'a', estado: 'otro' }] }), /orden_invalido/);
  assert.deepEqual(parsePerfil({ nombre: 'Ana', telefono: '+506 8888-8888' }), { nombre: 'Ana', telefono: '50688888888' });
  assert.deepEqual(parsePerfil({ nombre: 'Ana', telefono: '00 1 (555) 123 4567' }), { nombre: 'Ana', telefono: '15551234567' });
  assert.deepEqual(parsePerfil({ nombre: 'Ana', telefono: '' }), { nombre: 'Ana', telefono: null });
  assert.throws(() => parsePerfil({ nombre: 'Ana', telefono: '8888 8888' }), /telefono_invalido/);
  assert.throws(() => parsePerfil({ nombre: 'Ana', telefono: '+506 8888 abcd' }), /telefono_invalido/);
  assert.deepEqual(parseComentario({ texto: '  hola  ' }), { texto: 'hola', archivos: [], respuesta_a: null });
  assert.deepEqual(parseComentario({ archivos: ['a', 'a'] }), { texto: '', archivos: ['a'], respuesta_a: null });
  assert.equal(parseComentario({ texto: 'sí', respuesta_a: 'abc' }).respuesta_a, 'abc');
  assert.throws(() => parseComentario({ texto: 'sí', respuesta_a: 5 }), /respuesta_invalida/);
  assert.throws(() => parseComentario({ texto: 'sí', respuesta_a: '' }), /respuesta_invalida/);
  assert.throws(() => parseComentario({ texto: '   ' }), /comentario_invalido/);
  assert.throws(() => parseComentario({ texto: 'x'.repeat(2001) }), /comentario_invalido/);
  assert.throws(() => parseComentario({ texto: 'hola', archivos: 'a' }), /archivos_invalidos/);
  assert.deepEqual(parseTraspaso({ perfil_id: 'p', nota: '  el frontend ' }), { perfil_id: 'p', nota: 'el frontend' });
  assert.deepEqual(parseTraspaso({ perfil_id: 'p', nota: '' }), { perfil_id: 'p', nota: null });
  assert.throws(() => parseTraspaso({ perfil_id: null }), /perfil_invalido/);
  assert.throws(() => parseTraspaso({ perfil_id: 'p', nota: 'x'.repeat(501) }), /nota_invalida/);
  assert.equal(nombreDeArchivo(encodeURIComponent('../carpeta\\Plano final.pdf')), 'Plano final.pdf');
  assert.equal(nombreDeArchivo(undefined), 'archivo');
  assert.equal(nombreDeArchivo(`${'a'.repeat(200)}.pdf`).length, 120);
  assert.match(nombreDeArchivo(`${'a'.repeat(200)}.pdf`), /\.pdf$/);
  assert.throws(() => nombreDeArchivo('%E0%A4%A'), /nombre_archivo_invalido/);
  assert.equal(tipoDeArchivo(Buffer.from('%PDF-1.7')), 'application/pdf');
  assert.equal(tipoDeArchivo(Buffer.from('<html>')), 'application/octet-stream');
  assert.equal(parseLeidas({}), null);
  assert.deepEqual(parseLeidas({ ids: ['a'] }), ['a']);
  assert.throws(() => parseLeidas({ ids: 'a' }), /ids_invalidos/);
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

test('cada organización tiene sus involucrados: en una compartida los cambia cualquiera, una privada solo tiene a su dueño', async (t) => {
  const { call, data, entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const junior = await entrarComo('Junior');
  const ids = (...perfiles) => perfiles.map((perfil) => perfil.perfil.id).sort();

  // Sin decirlo, en una compartida están todos y en una privada solo su dueño.
  const { organizacion: mayugo } = await data('POST', '/organizaciones', { nombre: 'Mayugo' });
  assert.deepEqual(mayugo.miembros, ids(diego, favio, junior));
  const { organizacion: personal } = await diego.data('POST', '/organizaciones', { nombre: 'Personal', compartida: false, miembros: [favio.perfil.id] });
  assert.deepEqual(personal.miembros, ids(diego));
  const { organizacion: vendeizi } = await diego.data('POST', '/organizaciones', { nombre: 'Vendeizi', miembros: [diego.perfil.id, junior.perfil.id] });
  assert.deepEqual(vendeizi.miembros, ids(diego, junior));

  // Cualquiera que la ve cambia los involucrados de una compartida, aunque no sea su dueño; renombrarla, no.
  assert.deepEqual((await favio.data('PATCH', `/organizaciones/${vendeizi.id}`, { miembros: [favio.perfil.id, diego.perfil.id] })).organizacion.miembros,
    ids(diego, favio));
  assert.equal((await favio.call('PATCH', `/organizaciones/${vendeizi.id}`, { nombre: 'Mía', miembros: [] })).status, 403);
  assert.deepEqual((await data('PATCH', `/organizaciones/${mayugo.id}`, { miembros: [junior.perfil.id] })).organizacion.miembros, ids(junior));
  assert.equal((await call('PATCH', `/organizaciones/${mayugo.id}`, { miembros: [crypto.randomUUID()] })).status, 422);
  assert.deepEqual((await data('GET', '/organizaciones')).organizaciones.find((o) => o.id === mayugo.id).miembros, ids(junior));

  // En una privada no se agregan; al volverla privada queda solo su dueño, y al compartirla se agregan de nuevo.
  assert.equal((await diego.call('PATCH', `/organizaciones/${personal.id}`, { miembros: ids(diego, favio) })).status, 422);
  assert.equal((await favio.call('PATCH', `/organizaciones/${personal.id}`, { miembros: [] })).status, 404);
  assert.deepEqual((await diego.data('PATCH', `/organizaciones/${vendeizi.id}`, { compartida: false })).organizacion.miembros, ids(diego));
  const compartida = await diego.data('PATCH', `/organizaciones/${vendeizi.id}`, { compartida: true, miembros: ids(diego, junior) });
  assert.deepEqual(compartida.organizacion.miembros, ids(diego, junior));

  // Al quitar un perfil sale de las organizaciones.
  assert.equal((await junior.call('DELETE', `/perfiles/${junior.perfil.id}`)).status, 200);
  assert.deepEqual((await diego.data('GET', '/organizaciones')).organizaciones.find((o) => o.id === vendeizi.id).miembros, ids(diego));
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

test('el historial anota quién cambió qué y avisa al responsable y a quien lo creó, nunca a quien lo hizo', async (t) => {
  const { data, entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const junior = await entrarComo('Junior');
  const { organizacion } = await diego.data('POST', '/organizaciones', { nombre: 'Mayugo' });
  const { proyecto } = await diego.data('POST', '/proyectos', { nombre: 'Vendeizi', organizacion_id: organizacion.id });

  const { pendiente } = await diego.data('POST', '', { texto: 'Facturación', perfil_id: favio.perfil.id, proyecto_id: proyecto.id });
  assert.equal(pendiente.creado_por, diego.perfil.id);
  assert.equal(pendiente.num_comentarios, 0);
  const avisos = async (quien) => quien.data('GET', '/notificaciones');
  assert.equal((await avisos(diego)).no_leidas, 0);
  let deFavio = await avisos(favio);
  assert.equal(deFavio.no_leidas, 1);
  assert.deepEqual([deFavio.notificaciones[0].actividad.tipo, deFavio.notificaciones[0].actividad.autor], ['creado', 'Diego']);
  assert.deepEqual(deFavio.notificaciones[0].actividad.datos, { estado: 'pendiente', asignado: 'Favio', asignado_id: favio.perfil.id, proyecto: 'Mayugo › Vendeizi' });

  // Favio lo empieza: le avisa a Diego (quien lo creó), no a sí mismo.
  await favio.data('PATCH', `/${pendiente.id}`, { estado: 'haciendo' });
  assert.equal((await avisos(diego)).notificaciones[0].actividad.tipo, 'estado');
  assert.equal((await avisos(favio)).no_leidas, 1);
  // Diego se lo pasa a Junior: avisa a Favio (lo tenía) y a Junior (lo recibe).
  await diego.data('PATCH', `/${pendiente.id}`, { perfil_id: junior.perfil.id, texto: 'Facturación electrónica' });
  deFavio = await avisos(favio);
  assert.deepEqual(deFavio.notificaciones.map((n) => n.actividad.tipo), ['asignado', 'creado']);
  assert.deepEqual(deFavio.notificaciones[0].actividad.datos, { de: 'Favio', a: 'Junior', a_id: junior.perfil.id });
  assert.deepEqual((await avisos(junior)).notificaciones.map((n) => n.actividad.tipo).sort(), ['asignado', 'texto']);

  // La descripción que se guarda sola cuenta una vez por racha; guardar lo mismo no anota nada.
  const descripcion = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }], children: [] }]);
  await junior.data('PATCH', `/${pendiente.id}`, { descripcion });
  await junior.data('PATCH', `/${pendiente.id}`, { descripcion: descripcion.replace('"a"', '"ab"') });
  await diego.data('PATCH', `/${pendiente.id}`, { descripcion: descripcion.replace('"a"', '"ab"') });
  const { actividad } = await diego.data('GET', `/${pendiente.id}/actividad`);
  assert.deepEqual(actividad.map((a) => `${a.autor}:${a.tipo}`),
    ['Junior:descripcion', 'Diego:asignado', 'Diego:texto', 'Favio:estado', 'Diego:creado']);
  assert.deepEqual(actividad.find((a) => a.tipo === 'texto').datos, { de: 'Facturación', a: 'Facturación electrónica' });

  // Arrastrar a Hecho también queda; el tablero general ve todo, el más nuevo primero.
  await junior.call('PUT', '/orden', { items: [{ id: pendiente.id, estado: 'hecho' }] });
  const general = (await data('GET', '/actividad')).actividad;
  assert.deepEqual([general[0].tipo, general[0].datos, general[0].autor], ['estado', { de: 'haciendo', a: 'hecho' }, 'Junior']);
  assert.equal((await data('GET', `/actividad?antes=${encodeURIComponent(general[0].creado_en)}&limite=2`)).actividad.length, 2);
  assert.equal((await data('GET', '/actividad?antes=ayer')).error, 'antes_invalido');

  // Leer avisos: unos o todos. La cuenta del equipo no tiene.
  const ids = (await avisos(favio)).notificaciones.map((n) => n.id);
  assert.equal((await favio.data('POST', '/notificaciones/leidas', { ids: [ids[0]] })).no_leidas, (await avisos(favio)).no_leidas);
  assert.equal((await avisos(favio)).notificaciones.find((n) => n.id === ids[0]).leida, true);
  assert.equal((await favio.data('POST', '/notificaciones/leidas', {})).no_leidas, 0);
  assert.deepEqual(await data('GET', '/notificaciones'), { notificaciones: [], no_leidas: 0 });

  // Al borrarlo queda en el historial con su título, y se avisa.
  await diego.data('DELETE', `/${pendiente.id}`);
  assert.deepEqual([(await data('GET', '/actividad')).actividad[0].tipo, (await data('GET', '/actividad')).actividad[0].texto_pendiente],
    ['borrado', 'Facturación electrónica']);
  assert.equal((await avisos(junior)).notificaciones[0].actividad.tipo, 'borrado');
});

test('chat por pendiente: avisa a los que participan y a los @mencionados; cada quien borra solo lo suyo', async (t) => {
  const { call, entrarComo, data } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const junior = await entrarComo('Junior');
  const { pendiente } = await diego.data('POST', '', { texto: 'Revisar túnel', perfil_id: favio.perfil.id });

  const primero = await favio.call('POST', `/${pendiente.id}/comentarios`, { texto: '  Ya lo vi, falta el certificado  ' });
  assert.equal(primero.status, 201);
  const { comentario } = await primero.json();
  assert.deepEqual([comentario.autor, comentario.texto, comentario.perfil_id], ['Favio', 'Ya lo vi, falta el certificado', favio.perfil.id]);
  assert.equal((await diego.data('GET', '/notificaciones')).notificaciones[0].actividad.tipo, 'comentario');
  assert.equal((await junior.data('GET', '/notificaciones')).no_leidas, 0);

  // Una palabra que solo empieza con el nombre no es una mención.
  await diego.call('POST', `/${pendiente.id}/comentarios`, { texto: 'Esto es para los @juniors del equipo' });
  assert.equal((await junior.data('GET', '/notificaciones')).no_leidas, 0);
  assert.equal((await favio.data('GET', '/notificaciones')).notificaciones[0].actividad.datos.menciones, undefined);

  await diego.call('POST', `/${pendiente.id}/comentarios`, { texto: '@junior ¿lo puedes revisar?, @Favio.' });
  const deJunior = await junior.data('GET', '/notificaciones');
  assert.equal(deJunior.no_leidas, 1);
  assert.deepEqual(deJunior.notificaciones[0].actividad.datos.extracto, '@junior ¿lo puedes revisar?, @Favio.');
  assert.deepEqual(deJunior.notificaciones[0].actividad.datos.menciones.sort(), [favio.perfil.id, junior.perfil.id].sort());
  assert.equal((await favio.data('GET', '/notificaciones')).notificaciones[0].actividad.autor, 'Diego');
  await data('POST', `/${pendiente.id}/comentarios`, { texto: 'Desde la cuenta del equipo' });

  const { comentarios } = await diego.data('GET', `/${pendiente.id}/comentarios`);
  assert.deepEqual(comentarios.map((c) => c.autor), ['Favio', 'Diego', 'Diego', 'Equipo']);
  assert.equal((await diego.data('GET')).pendientes[0].num_comentarios, 4);
  assert.equal((await call('POST', `/${pendiente.id}/comentarios`, { texto: ' ' })).status, 422);
  assert.equal((await call('POST', `/${crypto.randomUUID()}/comentarios`, { texto: 'nada' })).status, 404);

  assert.equal((await diego.call('DELETE', `/comentarios/${comentario.id}`)).status, 403);
  assert.equal((await call('DELETE', `/comentarios/${comentario.id}`)).status, 403);
  assert.equal((await favio.call('DELETE', `/comentarios/${comentario.id}`)).status, 200);
  assert.equal((await call('DELETE', `/comentarios/${comentarios[3].id}`)).status, 200);
  assert.deepEqual((await diego.data('GET', `/${pendiente.id}/comentarios`)).comentarios.map((c) => c.autor), ['Diego', 'Diego']);
  // Con el mensaje se fue su aviso.
  assert.equal((await diego.data('GET', '/notificaciones')).notificaciones.some((n) => n.actividad.tipo === 'comentario'), false);

  // Al borrar el pendiente se van sus mensajes.
  await diego.call('DELETE', `/${pendiente.id}`);
  assert.equal((await diego.call('GET', `/${pendiente.id}/comentarios`)).status, 404);
});

test('responder a un mensaje: queda enlazado, avisa "te respondió" y sobrevive al borrado del original', async (t) => {
  const { entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const junior = await entrarComo('Junior');
  const { pendiente } = await diego.data('POST', '', { texto: 'Login con Google' });
  const { pendiente: otro } = await diego.data('POST', '', { texto: 'Otro' });

  const { comentario: pregunta } = await junior.data('POST', `/${pendiente.id}/comentarios`, { texto: '¿Uso el SDK nuevo?' });
  assert.equal(pregunta.respuesta_a, null);
  const respuesta = await diego.call('POST', `/${pendiente.id}/comentarios`, { texto: 'Sí, el nuevo', respuesta_a: pregunta.id });
  assert.equal(respuesta.status, 201);
  const { comentario } = await respuesta.json();
  assert.equal(comentario.respuesta_a, pregunta.id);
  const aviso = (await junior.data('GET', '/notificaciones')).notificaciones[0];
  assert.deepEqual([aviso.actividad.autor, aviso.actividad.datos.respondido_id], ['Diego', junior.perfil.id]);

  // Solo se responde a un mensaje del mismo pendiente.
  assert.equal((await diego.call('POST', `/${otro.id}/comentarios`, { texto: 'x', respuesta_a: pregunta.id })).status, 422);
  assert.equal((await diego.call('POST', `/${pendiente.id}/comentarios`, { texto: 'x', respuesta_a: crypto.randomUUID() })).status, 422);

  // Si el original se borra, la respuesta queda y sigue apuntándolo.
  assert.equal((await junior.call('DELETE', `/comentarios/${pregunta.id}`)).status, 200);
  const { comentarios } = await diego.data('GET', `/${pendiente.id}/comentarios`);
  assert.deepEqual(comentarios.map((c) => [c.texto, c.respuesta_a]), [['Sí, el nuevo', pregunta.id]]);
});

test('el historial, el chat y los avisos de lo privado solo los ve su dueño, también después de borrarlo', async (t) => {
  const { data, entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const { organizacion } = await diego.data('POST', '/organizaciones', { nombre: 'Personal', compartida: false });
  const { proyecto } = await diego.data('POST', '/proyectos', { nombre: 'Casa', organizacion_id: organizacion.id });
  // Asignado a Favio, pero Favio no lo ve: no se le avisa.
  const { pendiente } = await diego.data('POST', '', { texto: 'Pagar luz', proyecto_id: proyecto.id, perfil_id: favio.perfil.id });
  await diego.data('POST', `/${pendiente.id}/comentarios`, { texto: '@Favio mira' });
  assert.equal((await favio.data('GET', '/notificaciones')).no_leidas, 0);
  for (const otro of [favio, { data }]) {
    assert.equal((await otro.data('GET', '/actividad')).actividad.length, 0);
  }
  assert.equal((await favio.call('GET', `/${pendiente.id}/actividad`)).status, 404);
  assert.equal((await favio.call('GET', `/${pendiente.id}/comentarios`)).status, 404);
  assert.equal((await favio.call('POST', `/${pendiente.id}/comentarios`, { texto: 'colado' })).status, 404);
  assert.equal((await diego.data('GET', '/actividad')).actividad.length, 2);

  await diego.data('DELETE', `/${pendiente.id}`);
  assert.equal((await favio.data('GET', '/actividad')).actividad.length, 0);
  assert.equal((await data('GET', '/actividad')).actividad.length, 0);
  assert.deepEqual((await diego.data('GET', '/actividad')).actividad.map((a) => a.tipo), ['borrado', 'comentario', 'creado']);
});

test('archivos: se adjuntan al pendiente o a un mensaje, se sirven con contraseña y se van con lo suyo', async (t) => {
  const { dataDir, base, entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const { pendiente } = await diego.data('POST', '', { texto: 'Contrato', perfil_id: favio.perfil.id });
  const subir = (quien, contenido, nombre, para = '') => fetch(`${base}/api/pendientes/${pendiente.id}/archivos${para}`, {
    method: 'POST',
    headers: { ...quien.headers, 'X-Nombre-Archivo': encodeURIComponent(nombre) },
    body: contenido,
  });
  const bajar = (id, quien = diego) => fetch(`${base}/api/pendientes/archivos/${id}`, { headers: quien.headers });
  const enDisco = (id) => existsSync(path.join(dataDir, 'archivos', id));
  const PDF = Buffer.from('%PDF-1.4\n%prueba\n');

  // Adjunto al pendiente: queda en el historial y avisa al responsable.
  const subido = await subir(diego, PDF, '../Contrato firmado.pdf');
  assert.equal(subido.status, 201);
  const { archivo: contrato } = await subido.json();
  assert.deepEqual([contrato.nombre, contrato.tipo, contrato.tamano, contrato.autor, contrato.comentario_id],
    ['Contrato firmado.pdf', 'application/pdf', PDF.length, 'Diego', null]);
  assert.equal(enDisco(contrato.id), true);
  assert.deepEqual((await favio.data('GET', '/notificaciones')).notificaciones[0].actividad.datos, { archivo_id: contrato.id, nombre: 'Contrato firmado.pdf' });
  const pdf = await bajar(contrato.id, favio);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.headers.get('content-disposition'), "inline; filename*=UTF-8''Contrato%20firmado.pdf");
  assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), PDF);
  assert.equal((await fetch(`${base}/api/pendientes/archivos/${contrato.id}`)).status, 401);

  // Lo que no es imagen ni PDF solo se descarga, aunque diga ser una página.
  const { archivo: pagina } = await (await subir(diego, Buffer.from('<script>alert(1)</script>'), 'pagina.html')).json();
  const html = await bajar(pagina.id);
  assert.deepEqual([html.headers.get('content-type'), html.headers.get('content-disposition').split(';')[0]], ['application/octet-stream', 'attachment']);
  assert.equal((await subir(diego, Buffer.alloc(0), 'vacio.txt')).status, 422);
  assert.equal((await subir(diego, Buffer.alloc(10 * 1024 * 1024 + 1), 'enorme.bin')).status, 413);

  // Para el chat queda como borrador hasta que se envía el mensaje, y solo lo usa quien lo subió.
  const { archivo: plano } = await (await subir(favio, PDF, 'plano.pdf', '?para=chat')).json();
  assert.deepEqual((await diego.data('GET', `/${pendiente.id}/archivos`)).archivos.map((a) => a.nombre), ['Contrato firmado.pdf', 'pagina.html']);
  assert.equal((await diego.call('POST', `/${pendiente.id}/comentarios`, { archivos: [plano.id] })).status, 422);
  const { comentario } = await favio.data('POST', `/${pendiente.id}/comentarios`, { archivos: [plano.id] });
  assert.deepEqual([comentario.texto, comentario.archivos.map((a) => a.nombre)], ['', ['plano.pdf']]);
  assert.equal((await favio.call('POST', `/${pendiente.id}/comentarios`, { archivos: [plano.id] })).status, 422);
  assert.deepEqual((await diego.data('GET', `/${pendiente.id}/comentarios`)).comentarios[0].archivos.map((a) => a.id), [plano.id]);
  assert.deepEqual((await diego.data('GET', '/notificaciones')).notificaciones[0].actividad.datos.adjuntos, ['plano.pdf']);
  assert.equal((await diego.data('GET')).pendientes[0].num_archivos, 3);

  // Cada quien quita lo suyo; lo de un mensaje se va con el mensaje, y todo se va con el pendiente.
  assert.equal((await favio.call('DELETE', `/archivos/${contrato.id}`)).status, 403);
  assert.equal((await favio.call('DELETE', `/archivos/${plano.id}`)).status, 409);
  assert.equal((await diego.call('DELETE', `/archivos/${contrato.id}`)).status, 200);
  assert.equal(enDisco(contrato.id), false);
  assert.equal((await diego.data('GET', '/actividad')).actividad.some((a) => a.datos?.archivo_id === contrato.id), false);
  assert.equal((await favio.call('DELETE', `/comentarios/${comentario.id}`)).status, 200);
  assert.deepEqual([(await bajar(plano.id)).status, enDisco(plano.id)], [404, false]);
  await diego.call('DELETE', `/${pendiente.id}`);
  assert.deepEqual([(await bajar(pagina.id)).status, enDisco(pagina.id)], [404, false]);
});

test('pasar un pendiente hecho a otra persona: vuelve a Por hacer y conserva su historial y su chat', async (t) => {
  const { call, entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const junior = await entrarComo('Junior');
  const { pendiente } = await favio.data('POST', '', { texto: 'Login con Google', perfil_id: diego.perfil.id });
  await favio.data('POST', '', { texto: 'Otro' });
  await diego.data('PATCH', `/${pendiente.id}`, { estado: 'hecho' });
  await diego.data('POST', `/${pendiente.id}/comentarios`, { texto: 'Backend listo' });

  const { pendiente: pasado } = await diego.data('POST', `/${pendiente.id}/traspaso`, { perfil_id: junior.perfil.id, nota: ' El frontend ' });
  assert.deepEqual([pasado.id, pasado.estado, pasado.perfil_id, pasado.num_comentarios], [pendiente.id, 'pendiente', junior.perfil.id, 1]);
  assert.equal((await diego.data('GET')).pendientes[0].id, pendiente.id);
  const historial = (await diego.data('GET', `/${pendiente.id}/actividad`)).actividad;
  assert.deepEqual(historial.map((a) => a.tipo), ['traspaso', 'comentario', 'estado', 'creado']);
  assert.deepEqual(historial[0].datos, { de: 'Diego', de_id: diego.perfil.id, a: 'Junior', a_id: junior.perfil.id, estado: 'hecho', nota: 'El frontend' });
  assert.deepEqual((await junior.data('GET', '/notificaciones')).notificaciones.map((n) => n.actividad.tipo), ['traspaso']);
  assert.equal((await favio.data('GET', '/notificaciones')).notificaciones[0].actividad.tipo, 'traspaso');

  assert.equal((await call('POST', `/${pendiente.id}/traspaso`, { perfil_id: crypto.randomUUID() })).status, 422);
  assert.equal((await call('POST', `/${pendiente.id}/traspaso`, {})).status, 422);
  assert.equal((await call('POST', `/${crypto.randomUUID()}/traspaso`, { perfil_id: junior.perfil.id })).status, 404);
});

test('rechaza JSON roto y rutas desconocidas', async (t) => {
  const { base, call } = await startServer(t);
  const broken = await fetch(`${base}/api/pendientes`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(broken.status, 400);
  assert.equal((await call('PUT')).status, 405);
  assert.equal((await call('PATCH', '/perfiles')).status, 405);
  assert.equal((await call('PUT', '/organizaciones')).status, 405);
  assert.equal((await call('DELETE', '/actividad')).status, 405);
  assert.equal((await fetch(`${base}/otra-cosa`)).status, 404);
});

test('valida etiquetas, ajustes de IA y textos para la IA', () => {
  assert.deepEqual(parseEtiqueta({ nombre: ' Sprint 12 ' }), { nombre: 'Sprint 12' });
  assert.throws(() => parseEtiqueta({ nombre: 'x'.repeat(41) }), { message: 'nombre_invalido' });
  assert.throws(() => parseEtiqueta({ nombre: 'Sprint', color: 'rojo' }), { message: 'color_invalido' });
  assert.deepEqual(parsePendiente({ texto: 'A', etiquetas: ['a', 'a', 'b'] }).etiquetas, ['a', 'b']);
  assert.throws(() => parsePendiente({ texto: 'A', etiquetas: 'a' }), { message: 'etiquetas_invalidas' });
  assert.equal(parsePendiente({ texto: 'A', tipo: 'feat' }).tipo, 'feat');
  assert.equal(parsePendiente({ texto: 'A', tipo: null }, { partial: true }).tipo, null);
  assert.throws(() => parsePendiente({ texto: 'A', tipo: 'feature' }), { message: 'tipo_invalido' });

  assert.deepEqual(parseAjustesIA({ proveedor: 'openai', claves: { openai: ' sk-1234 ' }, modelos: { gemini: null } }),
    { proveedor: 'openai', claves: { openai: 'sk-1234' }, modelos: { gemini: null } });
  assert.deepEqual(parseAjustesIA({ instrucciones: '  ' }), { instrucciones: null });
  assert.throws(() => parseAjustesIA({ proveedor: 'anthropic' }), { message: 'proveedor_invalido' });
  assert.throws(() => parseAjustesIA({ claves: { otro: 'x' } }), { message: 'proveedor_invalido' });
  assert.throws(() => parseAjustesIA({ claves: { openai: 'con espacio' } }), { message: 'clave_invalida' });
  assert.throws(() => parseAjustesIA({ modelos: { openai: '' } }), { message: 'modelo_invalido' });
  assert.throws(() => parseAjustesIA({ instrucciones: 'x'.repeat(2001) }), { message: 'instrucciones_invalidas' });

  assert.deepEqual(parseSugerencia({ texto: ' hola ' }), { texto: 'hola', proyecto_id: null });
  assert.throws(() => parseSugerencia({ texto: ' ' }), { message: 'texto_ia_invalido' });
  assert.throws(() => parseSugerencia({ texto: 'x'.repeat(20001) }), { message: 'texto_ia_invalido' });
});

test('hecho_en: se anota al pasar a Hecho por cualquier camino y se borra al salir', async (t) => {
  const { data, entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const junior = await entrarComo('Junior');
  const { pendiente: creado } = await data('POST', '', { texto: 'Ya estaba', estado: 'hecho' });
  assert.ok(creado.hecho_en);
  const { pendiente: otro } = await data('POST', '', { texto: 'Nuevo' });
  assert.equal(otro.hecho_en, null);

  const { pendiente: terminado } = await data('PATCH', `/${otro.id}`, { estado: 'hecho' });
  assert.ok(terminado.hecho_en >= otro.creado_en);
  // Cambiar otra cosa no mueve la fecha; salir de Hecho la borra.
  assert.equal((await data('PATCH', `/${otro.id}`, { texto: 'Nuevo 2', estado: 'hecho' })).pendiente.hecho_en, terminado.hecho_en);
  assert.equal((await data('PATCH', `/${otro.id}`, { estado: 'haciendo' })).pendiente.hecho_en, null);

  const { pendientes } = await data('PUT', '/orden', { items: [{ id: otro.id, estado: 'hecho' }, { id: creado.id, estado: 'hecho' }] });
  const porId = new Map(pendientes.map((p) => [p.id, p]));
  assert.ok(porId.get(otro.id).hecho_en);
  assert.equal(porId.get(creado.id).hecho_en, creado.hecho_en);

  const { pendiente: pasado } = await diego.data('POST', `/${otro.id}/traspaso`, { perfil_id: junior.perfil.id });
  assert.equal(pasado.hecho_en, null);
});

test('etiquetas: se crean una vez, se ponen y quitan de los pendientes y quedan en el historial', async (t) => {
  const { call, data, entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const { etiqueta: sprint } = await diego.data('POST', '/etiquetas', { nombre: 'Sprint 12' });
  assert.match(sprint.color, /^#[0-9A-F]{6}$/);
  assert.equal((await call('POST', '/etiquetas', { nombre: 'sprint 12' })).status, 409);
  const { etiqueta: urgente } = await diego.data('POST', '/etiquetas', { nombre: 'Urgente', color: '#DC2626' });
  assert.deepEqual((await data('GET', '/etiquetas')).etiquetas.map((e) => e.nombre), ['Sprint 12', 'Urgente']);

  const descripcion = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Con detalle' }] }]);
  const { pendiente } = await diego.data('POST', '', { texto: 'Login', etiquetas: [sprint.id], descripcion });
  assert.deepEqual(pendiente.etiquetas, [sprint.id]);
  assert.equal(pendiente.resumen, 'Con detalle');
  assert.equal((await data('GET', `/${pendiente.id}`)).pendiente.descripcion, descripcion);

  const { pendiente: cambiado } = await diego.data('PATCH', `/${pendiente.id}`, { etiquetas: [urgente.id], tipo: 'feat' });
  assert.deepEqual([cambiado.etiquetas, cambiado.tipo], [[urgente.id], 'feat']);
  const historial = (await data('GET', `/${pendiente.id}/actividad`)).actividad;
  assert.deepEqual(historial.slice(0, 2).map((a) => [a.tipo, a.datos]), [
    ['etiquetas', { agregadas: ['Urgente'], quitadas: ['Sprint 12'] }],
    ['tipo', { de: null, a: 'feat' }],
  ]);
  assert.equal((await call('PATCH', `/${pendiente.id}`, { etiquetas: [crypto.randomUUID()] })).status, 422);

  assert.equal((await diego.data('PATCH', `/etiquetas/${urgente.id}`, { nombre: 'Prioridad' })).etiqueta.nombre, 'Prioridad');
  assert.equal((await call('PATCH', `/etiquetas/${urgente.id}`, { nombre: 'Sprint 12' })).status, 409);
  assert.equal((await call('DELETE', `/etiquetas/${urgente.id}`)).status, 200);
  assert.deepEqual((await data('GET')).pendientes[0].etiquetas, []);
  assert.equal((await call('DELETE', `/etiquetas/${urgente.id}`)).status, 404);
});

test('IA: las claves nunca salen del servidor y se configuran por proveedor', async (t) => {
  const { call, data } = await startServer(t);
  const inicial = (await data('GET', '/ia')).ia;
  assert.equal(inicial.proveedor, null);
  assert.equal(inicial.lista, false);
  assert.deepEqual(inicial.proveedores.map((p) => p.id), ['gemini', 'openai', 'openrouter']);

  const clave = 'sk-proj-secreta-abcd1234';
  const { ia } = await data('PUT', '/ia', { proveedor: 'openai', claves: { openai: clave }, modelos: { openai: 'gpt-6-astra' }, instrucciones: 'En español' });
  const openai = ia.proveedores.find((p) => p.id === 'openai');
  assert.deepEqual([ia.lista, openai.tiene_clave, openai.clave_final, openai.modelo], [true, true, '1234', 'gpt-6-astra']);
  assert.ok(!JSON.stringify(await data('GET', '/ia')).includes('secreta'));

  // Sin clave en el cambio, la clave se queda; null la borra y el modelo vuelve al de siempre.
  await data('PUT', '/ia', { instrucciones: null });
  assert.equal((await data('GET', '/ia')).ia.proveedores.find((p) => p.id === 'openai').tiene_clave, true);
  const { ia: sinClave } = await data('PUT', '/ia', { claves: { openai: null }, modelos: { openai: null } });
  const vacio = sinClave.proveedores.find((p) => p.id === 'openai');
  assert.deepEqual([sinClave.lista, vacio.tiene_clave, vacio.modelo], [false, false, vacio.modelo_por_defecto]);
  assert.equal((await call('POST', '/ia/sugerir', { texto: 'algo' })).status, 422);
  assert.equal((await (await call('POST', '/ia/sugerir', { texto: 'algo' })).json()).error, 'ia_sin_clave');
  assert.equal((await call('GET', '/ia/modelos?proveedor=openai')).status, 422);
  assert.equal((await call('GET', '/ia/modelos?proveedor=otro')).status, 422);
});

test('IA: arma el pedido de cada proveedor y pasa los nombres que contesta a ids', async (t) => {
  const propuesta = {
    pendientes: [
      { titulo: 'Arreglar el login', detalle: 'Falla con Google', responsable: 'diego', proyecto: 'Mayugo › Web', etiquetas: ['sprint 12', 'Inventada'], tipo: 'fix', estado: 'haciendo' },
      { titulo: 'Escribir la nota', detalle: null, responsable: 'Alguien', proyecto: 'Web', etiquetas: [], tipo: 'otro', estado: 'raro' },
      { titulo: '  ', detalle: null, responsable: null, proyecto: null, etiquetas: [], estado: 'pendiente' },
    ],
  };
  const texto = JSON.stringify(propuesta);
  const proveedor = await startProveedor(t, (ruta) => {
    if (ruta === '/v1beta/interactions') return { json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: texto }] }] } };
    if (ruta === '/v1/responses') return { json: { status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: texto }] }] } };
    if (ruta === '/api/v1/chat/completions') return { json: { choices: [{ message: { content: `\`\`\`json\n${texto}\n\`\`\`` } }] } };
    if (ruta.startsWith('/v1beta/models')) return { json: { models: [{ name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' }, { name: 'models/text-embedding-005' }] } };
    return { status: 404, json: { error: { message: 'no' } } };
  });
  const bases = { gemini: proveedor.url, openai: proveedor.url, openrouter: proveedor.url };
  const { data, entrarComo } = await startServer(t, { basesIA: bases });
  const diego = await entrarComo('Diego');
  const { organizacion } = await diego.data('POST', '/organizaciones', { nombre: 'Mayugo', compartida: true });
  const { proyecto: web } = await diego.data('POST', '/proyectos', { nombre: 'Web', organizacion_id: organizacion.id });
  const { proyecto: otro } = await diego.data('POST', '/proyectos', { nombre: 'Otro', organizacion_id: organizacion.id });
  const { etiqueta: sprint } = await diego.data('POST', '/etiquetas', { nombre: 'Sprint 12' });

  for (const [id, clave] of [['gemini', 'AIza-falsa-1'], ['openai', 'sk-falsa-2'], ['openrouter', 'sk-or-falsa-3']]) {
    await data('PUT', '/ia', { proveedor: id, claves: { [id]: clave } });
    const { sugerencias } = await diego.data('POST', '/ia/sugerir', { texto: 'Diego arregla el login', proyecto_id: otro.id });
    assert.deepEqual(sugerencias, [
      { texto: 'Arreglar el login', detalle: 'Falla con Google', perfil_id: diego.perfil.id, proyecto_id: web.id, tipo: 'fix', etiquetas: [sprint.id], estado: 'haciendo' },
      // Responsable desconocido: nadie. Estado raro: pendiente. Proyecto "Web" a secas vale porque no se repite.
      { texto: 'Escribir la nota', detalle: null, perfil_id: null, proyecto_id: web.id, tipo: null, etiquetas: [], estado: 'pendiente' },
    ], id);
    const pedido = proveedor.pedidos.at(-1);
    const sistema = pedido.cuerpo.system_instruction ?? pedido.cuerpo.instructions ?? pedido.cuerpo.messages?.[0].content;
    assert.match(sistema, /Personas: Favio, Diego, Junior/);
    assert.match(sistema, /Mayugo › Otro \| Mayugo › Web/);
    assert.match(sistema, /si no, "Mayugo › Otro"/);
    assert.match(sistema, /Etiquetas: Sprint 12/);
    assert.ok(!sistema.includes('@'), 'no se mandan correos');
    if (id === 'gemini') {
      assert.equal(pedido.headers['x-goog-api-key'], clave);
      assert.equal(pedido.cuerpo.input, 'Diego arregla el login');
      assert.equal(pedido.cuerpo.response_format.mime_type, 'application/json');
      assert.equal(pedido.cuerpo.model, 'gemini-3.5-flash-lite');
    } else {
      assert.equal(pedido.headers.authorization, `Bearer ${clave}`);
    }
    if (id === 'openai') {
      assert.deepEqual([pedido.cuerpo.text.format.type, pedido.cuerpo.text.format.strict], ['json_schema', true]);
      assert.equal(pedido.cuerpo.input, 'Diego arregla el login');
    }
    if (id === 'openrouter') {
      assert.equal(pedido.cuerpo.response_format.json_schema.strict, true);
      assert.equal(pedido.cuerpo.messages[1].content, 'Diego arregla el login');
      assert.equal(pedido.headers['x-openrouter-title'], 'Pendientes');
    }
  }

  await data('PUT', '/ia', { proveedor: 'gemini' });
  assert.deepEqual((await data('GET', '/ia/modelos?proveedor=gemini')).modelos, [{ id: 'gemini-3.5-flash-lite', nombre: 'Gemini 3.5 Flash-Lite' }]);
});

test('IA: los errores del proveedor se traducen y no repiten la clave', async (t) => {
  let respuesta;
  const proveedor = await startProveedor(t, () => respuesta);
  const { call, data } = await startServer(t, { basesIA: { gemini: proveedor.url, openai: proveedor.url, openrouter: proveedor.url } });
  const clave = 'sk-muy-secreta-9999';
  await data('PUT', '/ia', { proveedor: 'openai', claves: { openai: clave } });
  const sugerir = async () => {
    const res = await call('POST', '/ia/sugerir', { texto: 'algo' });
    return { status: res.status, ...(await res.json()) };
  };

  respuesta = { status: 401, json: { error: { message: `Incorrect API key provided: ${clave}`, code: 'invalid_api_key' } } };
  assert.deepEqual(await sugerir(), { status: 422, error: 'ia_clave_invalida' });
  respuesta = { status: 429, json: { error: { message: 'Rate limit reached' } } };
  assert.deepEqual(await sugerir(), { status: 429, error: 'ia_limite', detalle: 'Rate limit reached' });
  respuesta = { status: 500, json: { error: { message: `Algo raro con ${clave}` } } };
  const fallo = await sugerir();
  assert.equal(fallo.error, 'ia_fallo');
  assert.ok(!fallo.detalle.includes('secreta'));
  respuesta = { json: { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No puedo' }] }] } };
  assert.equal((await sugerir()).error, 'ia_se_nego');
  respuesta = { json: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'no es json' }] }] } };
  assert.equal((await sugerir()).error, 'ia_respuesta_invalida');
});

test('cambios en tiempo real: avisa a las otras pestañas lo que cambió, sin colar lo privado', async (t) => {
  const { base, data, entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const { organizacion } = await diego.data('POST', '/organizaciones', { nombre: 'Personal', compartida: false });
  const { proyecto } = await diego.data('POST', '/proyectos', { nombre: 'Casa', organizacion_id: organizacion.id });
  const { pendiente: privado } = await diego.data('POST', '', { texto: 'Pagar luz', proyecto_id: proyecto.id });
  const { pendiente: compartido } = await diego.data('POST', '', { texto: 'Login' });

  const cambiar = async () => {
    await diego.data('PATCH', `/${privado.id}`, { texto: 'Pagar agua' });
    await diego.data('POST', `/${compartido.id}/comentarios`, { texto: 'listo' });
    await data('POST', '/etiquetas', { nombre: 'Sprint 1' });
  };
  const deFavio = await leerEventos(base, favio.headers, { cantidad: 2, alConectar: cambiar });
  assert.deepEqual(deFavio, [{ tipo: 'comentarios', pendiente_id: compartido.id }, { tipo: 'catalogo' }]);

  // La misma pestaña que hace el cambio no se avisa a sí misma; otra pestaña del mismo perfil sí.
  const llamarComo = (cliente) => fetch(`${base}/api/pendientes/${compartido.id}`, {
    method: 'PATCH',
    headers: { ...diego.headers, 'Content-Type': 'application/json', 'X-Cliente': cliente },
    body: JSON.stringify({ estado: 'haciendo' }),
  });
  const propios = await leerEventos(base, diego.headers, { cliente: 'pestana-1', esperaMs: 600, alConectar: () => llamarComo('pestana-1') });
  assert.deepEqual(propios, []);
  const otraPestana = await leerEventos(base, diego.headers, { cliente: 'pestana-2', alConectar: () => llamarComo('pestana-1') });
  assert.deepEqual(otraPestana, [{ tipo: 'pendientes', pendiente_id: compartido.id }]);

  assert.equal((await fetch(`${base}/api/pendientes/eventos`)).status, 401);
});
