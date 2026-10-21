import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  createApp,
  extractoDe,
  nombreDeArchivo,
  openDb,
  parseAjustesIA,
  parseComentario,
  parseCurso,
  parseEtiqueta,
  parseLeidas,
  parseNota,
  parseOrden,
  parseOrganizacion,
  parsePedidoModelos,
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
    const { status = 200, json } = await responder(req.url, cuerpo, req.headers);
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

// Los archivos se guardan por su contenido: DATA_DIR/blobs/<sha256>.
const sha = (contenido) => createHash('sha256').update(contenido).digest('hex');
const blobs = (dataDir) => readdirSync(path.join(dataDir, 'blobs'));

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
  return { dataDir, base, call, data, entrarComo, server };
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
  assert.deepEqual(parseLeidas({}), { ids: null });
  assert.deepEqual(parseLeidas({ ids: ['a'] }), { ids: ['a'] });
  assert.throws(() => parseLeidas({ ids: 'a' }), /ids_invalidos/);
  assert.deepEqual(parseLeidas({ pendiente_id: 'p' }), { pendienteId: 'p' });
  assert.throws(() => parseLeidas({ pendiente_id: 3 }), /pendiente_invalido/);
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
  assert.deepEqual((await data('GET', '/yo')).usuario, { perfil_id: null, nombre: 'Equipo', notas: false, apariencia: null, avisos_por_correo: null });

  const diego = await entrarComo('Diego');
  assert.deepEqual((await diego.data('GET', '/yo')).usuario, { perfil_id: diego.perfil.id, nombre: 'Diego', notas: false, apariencia: null, avisos_por_correo: null });
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
  const subir = async (id, contenido) => (await (await fetch(`${base}/api/pendientes/${id}/imagenes`, {
    method: 'POST', headers: { Authorization: auth }, body: contenido,
  })).json()).imagen;
  const conImagenes = (...urls) => JSON.stringify(urls.map((url) => ({ type: 'image', props: { url }, children: [] })));
  // Cada una con su contenido, para seguir su archivo en el disco.
  const png = (n) => Buffer.concat([PNG, Buffer.alloc(n)]);
  const enDisco = (contenido) => existsSync(path.join(dataDir, 'blobs', sha(contenido)));

  const a = (await data('POST', '', { texto: 'A' })).pendiente;
  const b = (await data('POST', '', { texto: 'B' })).pendiente;
  const queda = await subir(a.id, png(1));
  const sale = await subir(a.id, png(2));
  const copiada = await subir(a.id, png(3));
  await data('PATCH', `/${b.id}`, { descripcion: conImagenes(copiada.url) });

  const saved = await data('PATCH', `/${a.id}`, { descripcion: conImagenes(queda.url) });
  assert.equal(saved.pendiente.num_imagenes, 1);
  assert.equal(enDisco(png(1)), true);
  assert.equal(enDisco(png(2)), false);
  assert.equal(enDisco(png(3)), true);
  assert.equal((await fetch(`${base}${sale.url}`, { headers: { Authorization: auth } })).status, 404);

  await data('DELETE', `/${a.id}`);
  assert.equal(enDisco(png(1)), false);
});

test('el historial anota quién cambió qué; avisa a quien recibe el pendiente y a quien lo creó si otro lo cambia', async (t) => {
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
  // Diego se lo pasa a Junior y lo renombra: solo Junior (lo recibe) tiene aviso; a Favio ya no le toca, y el
  // cambio de título lo hizo quien lo creó.
  await diego.data('PATCH', `/${pendiente.id}`, { perfil_id: junior.perfil.id, texto: 'Facturación electrónica' });
  deFavio = await avisos(favio);
  assert.deepEqual(deFavio.notificaciones.map((n) => n.actividad.tipo), ['creado']);
  const deJunior = await avisos(junior);
  assert.deepEqual(deJunior.notificaciones.map((n) => n.actividad.tipo), ['asignado']);
  assert.deepEqual(deJunior.notificaciones[0].actividad.datos, { de: 'Favio', a: 'Junior', a_id: junior.perfil.id });
  // Lo que cambia otro en lo que Diego creó (tipo, etiquetas) le avisa a Diego; a Junior, que lo tiene, no.
  const { etiqueta } = await junior.data('POST', '/etiquetas', { nombre: 'Sprint 3' });
  await junior.data('PATCH', `/${pendiente.id}`, { tipo: 'feat', etiquetas: [etiqueta.id] });
  assert.deepEqual((await avisos(diego)).notificaciones.slice(0, 2).map((n) => n.actividad.tipo).sort(), ['etiquetas', 'tipo']);
  await junior.data('PATCH', `/${pendiente.id}`, { tipo: null, etiquetas: [] });

  // La descripción que se guarda sola cuenta una vez por racha; guardar lo mismo no anota nada.
  const descripcion = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }], children: [] }]);
  await junior.data('PATCH', `/${pendiente.id}`, { descripcion });
  await junior.data('PATCH', `/${pendiente.id}`, { descripcion: descripcion.replace('"a"', '"ab"') });
  await diego.data('PATCH', `/${pendiente.id}`, { descripcion: descripcion.replace('"a"', '"ab"') });
  const { actividad } = await diego.data('GET', `/${pendiente.id}/actividad`);
  assert.deepEqual(actividad.map((a) => `${a.autor}:${a.tipo}`).filter((a) => !/:(tipo|etiquetas)$/.test(a)),
    ['Junior:descripcion', 'Diego:asignado', 'Diego:texto', 'Favio:estado', 'Diego:creado']);
  assert.equal((await avisos(diego)).notificaciones[0].actividad.tipo, 'descripcion');
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
  assert.deepEqual(await data('GET', '/notificaciones'), { notificaciones: [], no_leidas: 0, sin_leer: [] });

  // Al borrarlo queda en el historial con su título. Lo borró quien lo creó: nadie recibe aviso.
  await diego.data('DELETE', `/${pendiente.id}`);
  assert.deepEqual([(await data('GET', '/actividad')).actividad[0].tipo, (await data('GET', '/actividad')).actividad[0].texto_pendiente],
    ['borrado', 'Facturación electrónica']);
  assert.ok(!(await avisos(junior)).notificaciones.some((n) => n.actividad.tipo === 'borrado'));
  // Si lo borra otro, se le avisa a quien lo creó.
  const { pendiente: otro } = await diego.data('POST', '', { texto: 'Otro de Diego' });
  await junior.data('DELETE', `/${otro.id}`);
  assert.equal((await avisos(diego)).notificaciones[0].actividad.tipo, 'borrado');
});

test('cada tarjeta sabe sus avisos sin leer (las menciones aparte) y al abrirla se leen', async (t) => {
  const { entrarComo, data } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const junior = await entrarComo('Junior');
  const { pendiente: asignado } = await diego.data('POST', '', { texto: 'Solo asignado', perfil_id: favio.perfil.id });
  const { pendiente: charlado } = await diego.data('POST', '', { texto: 'Con mención' });
  const sinLeer = async (quien) => (await quien.data('GET', '/notificaciones')).sin_leer;

  // Asignarle algo es un aviso; mencionarlo en el chat o responderle un mensaje, una mención.
  await junior.data('POST', `/${charlado.id}/comentarios`, { texto: '@Favio mira esto' });
  const { comentario } = await favio.data('POST', `/${charlado.id}/comentarios`, { texto: 'Ya lo veo' });
  await diego.data('POST', `/${charlado.id}/comentarios`, { texto: 'Gracias', respuesta_a: comentario.id });
  assert.deepEqual(await sinLeer(favio), [
    { pendiente_id: charlado.id, avisos: 2, menciones: 2 },
    { pendiente_id: asignado.id, avisos: 1, menciones: 0 },
  ]);
  // A Diego, que lo creó, los mensajes que no lo mencionan no le avisan.
  assert.deepEqual(await sinLeer(diego), []);

  // Abrir la tarjeta lee sus avisos; los de las demás siguen.
  assert.equal((await favio.data('POST', '/notificaciones/leidas', { pendiente_id: charlado.id })).no_leidas, 1);
  assert.deepEqual(await sinLeer(favio), [{ pendiente_id: asignado.id, avisos: 1, menciones: 0 }]);
  // Solo los propios: que Junior "abra" la de Favio no le lee nada a Favio.
  await junior.data('POST', '/notificaciones/leidas', { pendiente_id: asignado.id });
  assert.equal((await sinLeer(favio)).length, 1);
  assert.equal((await favio.data('POST', '/notificaciones/leidas', { pendiente_id: 42 })).error, 'pendiente_invalido');
  assert.deepEqual(await data('GET', '/notificaciones'), { notificaciones: [], no_leidas: 0, sin_leer: [] });
});

test('chat por pendiente: avisa solo a los @mencionados; cada quien borra solo lo suyo', async (t) => {
  const { call, entrarComo, data } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const junior = await entrarComo('Junior');
  const { pendiente } = await diego.data('POST', '', { texto: 'Revisar túnel', perfil_id: favio.perfil.id });

  // Un mensaje sin mención no avisa a nadie, ni a quien creó el pendiente ni a quien lo tiene.
  await junior.call('POST', `/${pendiente.id}/comentarios`, { texto: 'Hola' });
  assert.equal((await diego.data('GET', '/notificaciones')).no_leidas, 0);
  assert.equal((await favio.data('GET', '/notificaciones')).notificaciones.length, 1);
  await junior.data('DELETE', `/comentarios/${(await diego.data('GET', `/${pendiente.id}/comentarios`)).comentarios[0].id}`);

  const primero = await favio.call('POST', `/${pendiente.id}/comentarios`, { texto: '  @Diego ya lo vi, falta el certificado  ' });
  assert.equal(primero.status, 201);
  const { comentario } = await primero.json();
  assert.deepEqual([comentario.autor, comentario.texto, comentario.perfil_id], ['Favio', '@Diego ya lo vi, falta el certificado', favio.perfil.id]);
  assert.equal((await diego.data('GET', '/notificaciones')).notificaciones[0].actividad.tipo, 'comentario');
  assert.equal((await junior.data('GET', '/notificaciones')).no_leidas, 0);

  // Una palabra que solo empieza con el nombre no es una mención.
  await diego.call('POST', `/${pendiente.id}/comentarios`, { texto: 'Esto es para los @juniors del equipo' });
  assert.equal((await junior.data('GET', '/notificaciones')).no_leidas, 0);
  assert.equal((await favio.data('GET', '/notificaciones')).notificaciones.length, 1);

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
  const { pendiente } = await favio.data('POST', '', { texto: 'Contrato', perfil_id: favio.perfil.id });
  const subir = (quien, contenido, nombre, para = '') => fetch(`${base}/api/pendientes/${pendiente.id}/archivos${para}`, {
    method: 'POST',
    headers: { ...quien.headers, 'X-Nombre-Archivo': encodeURIComponent(nombre) },
    body: contenido,
  });
  const bajar = (id, quien = diego) => fetch(`${base}/api/pendientes/archivos/${id}`, { headers: quien.headers });
  const enDisco = (contenido) => existsSync(path.join(dataDir, 'blobs', sha(contenido)));
  const PDF = Buffer.from('%PDF-1.4\n%prueba\n');
  const HTML = Buffer.from('<script>alert(1)</script>');

  // Adjunto al pendiente: queda en el historial y avisa a quien lo creó.
  const subido = await subir(diego, PDF, '../Contrato firmado.pdf');
  assert.equal(subido.status, 201);
  const { archivo: contrato } = await subido.json();
  assert.deepEqual([contrato.nombre, contrato.tipo, contrato.tamano, contrato.autor, contrato.comentario_id],
    ['Contrato firmado.pdf', 'application/pdf', PDF.length, 'Diego', null]);
  assert.equal(enDisco(PDF), true);
  assert.deepEqual((await favio.data('GET', '/notificaciones')).notificaciones[0].actividad.datos, { archivo_id: contrato.id, nombre: 'Contrato firmado.pdf' });
  const pdf = await bajar(contrato.id, favio);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.headers.get('content-disposition'), "inline; filename*=UTF-8''Contrato%20firmado.pdf");
  assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), PDF);
  assert.equal((await fetch(`${base}/api/pendientes/archivos/${contrato.id}`)).status, 401);

  // Lo que no es imagen ni PDF solo se descarga, aunque diga ser una página.
  const { archivo: pagina } = await (await subir(diego, HTML, 'pagina.html')).json();
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
  assert.deepEqual((await diego.data('GET', `/${pendiente.id}/actividad`)).actividad[0].datos.adjuntos, ['plano.pdf']);
  assert.equal((await diego.data('GET')).pendientes[0].num_archivos, 3);

  // Cada quien quita lo suyo; lo de un mensaje se va con el mensaje, y todo se va con el pendiente.
  assert.equal((await favio.call('DELETE', `/archivos/${contrato.id}`)).status, 403);
  assert.equal((await favio.call('DELETE', `/archivos/${plano.id}`)).status, 409);
  assert.equal((await diego.call('DELETE', `/archivos/${contrato.id}`)).status, 200);
  // plano.pdf tiene el mismo contenido: el archivo sigue en el disco hasta que se va el último que lo usa.
  assert.equal(enDisco(PDF), true);
  assert.equal((await diego.data('GET', '/actividad')).actividad.some((a) => a.datos?.archivo_id === contrato.id), false);
  assert.equal((await favio.call('DELETE', `/comentarios/${comentario.id}`)).status, 200);
  assert.deepEqual([(await bajar(plano.id)).status, enDisco(PDF)], [404, false]);
  await diego.call('DELETE', `/${pendiente.id}`);
  assert.deepEqual([(await bajar(pagina.id)).status, enDisco(HTML)], [404, false]);
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
  assert.equal((await diego.data('GET')).pendientes.at(-1).id, pendiente.id, 'al final de la cola');
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
  assert.deepEqual(parseAjustesIA({ tipo_automatico: false }), { tipo_automatico: false });
  assert.deepEqual(parseAjustesIA({ redaccion: { proveedor: 'openai', modelo: ' gpt-6-chispa ' } }), { redaccion: { proveedor: 'openai', modelo: 'gpt-6-chispa' } });
  assert.deepEqual(parseAjustesIA({ redaccion: null }), { redaccion: null });
  assert.throws(() => parseAjustesIA({ redaccion: { proveedor: 'anthropic', modelo: 'x' } }), { message: 'proveedor_invalido' });
  assert.throws(() => parseAjustesIA({ redaccion: { proveedor: 'openai' } }), { message: 'modelo_invalido' });
  assert.throws(() => parseAjustesIA({ redaccion: 'openai' }), { message: 'proveedor_invalido' });
  assert.throws(() => parseAjustesIA({ tipo_automatico: 'no' }), { message: 'tipo_automatico_invalido' });
  assert.deepEqual(parsePedidoModelos({ proveedor: 'gemini', clave: ' AIza-1 ' }), { proveedor: 'gemini', clave: 'AIza-1' });
  assert.deepEqual(parsePedidoModelos({ proveedor: 'openrouter' }), { proveedor: 'openrouter', clave: null });
  assert.throws(() => parsePedidoModelos({ proveedor: 'otro' }), { message: 'proveedor_invalido' });
  assert.throws(() => parsePedidoModelos({ proveedor: 'openai', clave: 'con espacio' }), { message: 'clave_invalida' });

  assert.deepEqual(parseSugerencia({ texto: ' hola ' }), { texto: 'hola', imagenes: [], proyecto_id: null });
  assert.throws(() => parseSugerencia({ texto: ' ' }), { message: 'texto_ia_invalido' });
  // Con imágenes el texto puede faltar; el tipo sale del contenido y solo vale lo que aceptan los tres proveedores.
  const png = PNG.toString('base64');
  assert.deepEqual(parseSugerencia({ imagenes: [{ datos: png }] }).imagenes, [{ tipo: 'image/png', datos: png }]);
  const gif = Buffer.from('GIF89a-animado').toString('base64');
  assert.throws(() => parseSugerencia({ imagenes: [{ datos: gif }] }), { message: 'imagenes_ia_invalidas' });
  assert.throws(() => parseSugerencia({ imagenes: [{ datos: Buffer.from('hola').toString('base64') }] }), { message: 'imagenes_ia_invalidas' });
  assert.throws(() => parseSugerencia({ imagenes: [{ datos: `data:image/png;base64,${png}` }] }), { message: 'imagenes_ia_invalidas' });
  assert.throws(() => parseSugerencia({ imagenes: { datos: png } }), { message: 'imagenes_ia_invalidas' });
  assert.throws(() => parseSugerencia({ imagenes: Array(7).fill({ datos: png }) }), { message: 'imagenes_ia_invalidas' });
  const grande = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]).toString('base64');
  assert.throws(() => parseSugerencia({ imagenes: [{ datos: grande }, { datos: grande }] }), { message: 'imagenes_ia_muy_grandes' });
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
  assert.equal((await (await call('POST', '/ia/modelos', { proveedor: 'openai' })).json()).error, 'ia_sin_clave');
  assert.equal((await call('POST', '/ia/modelos', { proveedor: 'otro' })).status, 422);
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
      { texto: 'Arreglar el login', detalle: 'Falla con Google', perfil_id: diego.perfil.id, proyecto_id: web.id, tipo: 'fix', etiquetas: [sprint.id], estado: 'haciendo', imagenes: [] },
      // Responsable desconocido: nadie. Estado raro: pendiente. Proyecto "Web" a secas vale porque no se repite.
      { texto: 'Escribir la nota', detalle: null, perfil_id: null, proyecto_id: web.id, tipo: null, etiquetas: [], estado: 'pendiente', imagenes: [] },
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

  // Con imágenes (y sin texto), cada proveedor las recibe en su formato, después del texto y cada una con su rótulo.
  const png = PNG.toString('base64');
  for (const id of ['gemini', 'openai', 'openrouter']) {
    await data('PUT', '/ia', { proveedor: id });
    await diego.data('POST', '/ia/sugerir', { texto: '', imagenes: [{ datos: png }] });
    const { cuerpo } = proveedor.pedidos.at(-1);
    if (id === 'gemini') {
      assert.deepEqual(cuerpo.input, [
        { type: 'text', text: 'Saca los pendientes de las imágenes.' },
        { type: 'text', text: 'Imagen 1:' },
        { type: 'image', data: png, mime_type: 'image/png' },
      ]);
    }
    if (id === 'openai') {
      assert.deepEqual(cuerpo.input, [{
        role: 'user',
        content: [
          { type: 'input_text', text: 'Saca los pendientes de las imágenes.' },
          { type: 'input_text', text: 'Imagen 1:' },
          { type: 'input_image', image_url: `data:image/png;base64,${png}` },
        ],
      }]);
    }
    if (id === 'openrouter') {
      assert.deepEqual(cuerpo.messages[1].content, [
        { type: 'text', text: 'Saca los pendientes de las imágenes.' },
        { type: 'text', text: 'Imagen 1:' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
      ]);
    }
  }

  // Los modelos se listan con la clave guardada o con la que se está escribiendo, que no se guarda.
  await data('PUT', '/ia', { proveedor: 'gemini' });
  const geminiFlash = [{ id: 'gemini-3.5-flash-lite', nombre: 'Gemini 3.5 Flash-Lite' }];
  assert.deepEqual((await data('POST', '/ia/modelos', { proveedor: 'gemini' })).modelos, geminiFlash);
  assert.equal(proveedor.pedidos.at(-1).headers['x-goog-api-key'], 'AIza-falsa-1');
  assert.deepEqual((await data('POST', '/ia/modelos', { proveedor: 'gemini', clave: 'AIza-recien-escrita' })).modelos, geminiFlash);
  assert.equal(proveedor.pedidos.at(-1).headers['x-goog-api-key'], 'AIza-recien-escrita');
  assert.ok(!JSON.stringify(await data('GET', '/ia')).includes('recien'));
  assert.equal((await data('GET', '/ia')).ia.proveedores.find((p) => p.id === 'gemini').clave_final, 'sa-1');
});

test('mencionar con @ en la descripción avisa una vez a quien se menciona', async (t) => {
  const { entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const junior = await entrarComo('Junior');
  const favio = await entrarComo('Favio');
  const mencion = (perfil) => ({ type: 'mencion', props: { id: perfil.id, nombre: perfil.nombre } });
  const documento = (...contenido) => JSON.stringify([{ type: 'paragraph', content: contenido }]);
  const { pendiente } = await diego.data('POST', '', { texto: 'Revisar planos' });

  const { pendiente: conMencion } = await diego.data('PATCH', `/${pendiente.id}`, {
    descripcion: documento({ type: 'text', text: 'Mira esto ', styles: {} }, mencion(junior.perfil)),
  });
  assert.equal(conMencion.resumen, 'Mira esto @Junior');
  const avisos = async (quien) => (await quien.data('GET', '/notificaciones')).notificaciones.map((n) => n.actividad);
  const [aviso] = await avisos(junior);
  assert.deepEqual([aviso.tipo, aviso.autor, aviso.datos], ['descripcion', 'Diego', { menciones: [junior.perfil.id] }]);
  assert.equal((await avisos(favio)).length, 0);

  // Seguir editando no vuelve a avisar a Junior; mencionar a Favio le avisa solo a él. Mencionarse a uno mismo no avisa.
  await diego.data('PATCH', `/${pendiente.id}`, { descripcion: documento({ type: 'text', text: 'Mira esto bien ', styles: {} }, mencion(junior.perfil)) });
  await diego.data('PATCH', `/${pendiente.id}`, {
    descripcion: documento(mencion(junior.perfil), { type: 'text', text: ' y ', styles: {} }, mencion(favio.perfil), mencion(diego.perfil)),
  });
  assert.equal((await avisos(junior)).length, 1);
  assert.deepEqual((await avisos(favio)).map((a) => a.datos), [{ menciones: [favio.perfil.id] }]);
  assert.equal((await avisos(diego)).length, 0);

  // Al crear con la descripción ya escrita, también avisa.
  await diego.data('POST', '', { texto: 'Otro', descripcion: documento(mencion(junior.perfil)) });
  assert.equal((await avisos(junior)).length, 2);
});

test('IA: elige el tipo de lo que se crea sin tipo, sin pisar lo que se pone a mano', async (t) => {
  const espera = (ms) => new Promise((listo) => setTimeout(listo, ms));
  // Contesta según el título: "falla" es un fix, "manual" tarda, "reunión" no es software y "roto" da error.
  const proveedor = await startProveedor(t, async (ruta, cuerpo) => {
    const texto = cuerpo.input;
    if (texto.includes('roto')) return { status: 500, json: { error: { message: 'caído' } } };
    if (texto.includes('manual')) await espera(300);
    const tipo = texto.includes('falla') ? 'fix' : texto.includes('manual') ? 'feat' : null;
    return { json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ tipo }) }] }] } };
  });
  const { base, call, data, entrarComo } = await startServer(t, { basesIA: { gemini: proveedor.url } });
  const diego = await entrarComo('Diego');
  const crear = async (cuerpo, headers = {}) => {
    const res = await fetch(`${base}/api/pendientes`, {
      method: 'POST',
      headers: { ...diego.headers, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(cuerpo),
    });
    assert.equal(res.status, 201);
    return res.json();
  };
  const tipoDe = async (id) => (await diego.data('GET', '')).pendientes.find((p) => p.id === id).tipo;

  // Sin IA configurada, no se intenta.
  assert.equal((await crear({ texto: 'Antes de configurar' })).eligiendo_tipo, false);
  await data('PUT', '/ia', { proveedor: 'gemini', claves: { gemini: 'AIza-falsa-tipo' } });
  const { organizacion } = await diego.data('POST', '/organizaciones', { nombre: 'Mayugo', compartida: true });
  const { proyecto } = await diego.data('POST', '/proyectos', { nombre: 'Web', organizacion_id: organizacion.id });

  // La pestaña que lo creó también se entera cuando la IA termina (el aviso de la creación no le llega a ella).
  let creado;
  const eventos = await leerEventos(base, diego.headers, {
    cliente: 'pestana-1',
    esperaMs: 3000,
    alConectar: async () => {
      creado = await crear({ texto: 'El login falla en Safari', proyecto_id: proyecto.id }, { 'X-Cliente': 'pestana-1' });
    },
  });
  assert.equal(creado.eligiendo_tipo, true);
  assert.equal(creado.pendiente.tipo, null);
  assert.deepEqual(eventos, [{ tipo: 'pendientes', pendiente_id: creado.pendiente.id }]);
  assert.equal(await tipoDe(creado.pendiente.id), 'fix');
  const { actividad } = await diego.data('GET', `/${creado.pendiente.id}/actividad`);
  const anotado = actividad.find((a) => a.tipo === 'tipo');
  assert.deepEqual([anotado.autor, anotado.perfil_id, anotado.datos], ['IA', null, { de: null, a: 'fix', ia: true }]);

  // Solo viajan el título y el proyecto, con un esquema que solo pide el tipo.
  const pedido = proveedor.pedidos.at(-1);
  assert.equal(pedido.cuerpo.input, 'Pendiente: El login falla en Safari\nProyecto: Mayugo › Web');
  assert.match(pedido.cuerpo.system_instruction, /commits convencionales/);
  assert.deepEqual(pedido.cuerpo.response_format.schema.required, ['tipo']);

  // Con tipo, o con null a propósito ("sin tipo"), no se le pregunta a la IA.
  const pedidos = proveedor.pedidos.length;
  assert.equal((await crear({ texto: 'Ya trae tipo', tipo: 'docs' })).eligiendo_tipo, false);
  assert.equal((await crear({ texto: 'Sin tipo a propósito', tipo: null })).eligiendo_tipo, false);
  await espera(100);
  assert.equal(proveedor.pedidos.length, pedidos);

  // Si alguien le pone el tipo mientras la IA piensa, se queda el suyo.
  const manual = await crear({ texto: 'Cambio manual' });
  await diego.data('PATCH', `/${manual.pendiente.id}`, { tipo: 'chore' });
  await espera(500);
  assert.equal(await tipoDe(manual.pendiente.id), 'chore');

  // Si la IA no sabe (null) o falla, queda sin tipo y sin nada en el historial.
  const reunion = await crear({ texto: 'Reunión con el cliente' });
  const roto = await crear({ texto: 'Esto está roto' });
  await espera(200);
  for (const { pendiente } of [reunion, roto]) {
    assert.equal(await tipoDe(pendiente.id), null);
    assert.ok(!(await diego.data('GET', `/${pendiente.id}/actividad`)).actividad.some((a) => a.tipo === 'tipo'));
  }

  // El equipo lo puede apagar.
  assert.equal((await data('PUT', '/ia', { tipo_automatico: false })).ia.tipo_automatico, false);
  assert.equal((await crear({ texto: 'El otro login falla' })).eligiendo_tipo, false);
  assert.equal((await call('GET', '/ia')).status, 200);
});

test('IA: redacta mejor un borrador del chat o de la descripción, con el pendiente de contexto', async (t) => {
  const pedidos = [];
  const proveedor = await startProveedor(t, async (ruta, cuerpo) => {
    pedidos.push(cuerpo);
    const texto = cuerpo.input.includes('largo') ? 'x'.repeat(2500) : '@Junior, ¿puedes revisar el botón «Aceptar invitación»? Redirige a localhost.';
    return { json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ texto }) }] }] } };
  });
  const { call, data, entrarComo } = await startServer(t, { basesIA: { gemini: proveedor.url } });
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const junior = await entrarComo('Junior');
  await data('PATCH', `/perfiles/${junior.perfil.id}`, { correo: 'junior@example.com', telefono: '+50688887777' });
  const { organizacion } = await diego.data('POST', '/organizaciones', { nombre: 'Mayugo', compartida: true });
  const { proyecto } = await diego.data('POST', '/proyectos', { nombre: 'Vendeizi', organizacion_id: organizacion.id });
  const { pendiente } = await diego.data('POST', '', { texto: 'Corregir la redirección del botón', perfil_id: junior.perfil.id, proyecto_id: proyecto.id });
  const descripcion = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'En el correo de invitación el botón lleva a localhost.' }], children: [] }]);
  await diego.data('PATCH', `/${pendiente.id}`, { descripcion });
  await favio.data('POST', `/${pendiente.id}/comentarios`, { texto: 'Ya lo vi en staging' });
  const redactar = (quien, cuerpo) => quien.call('POST', '/ia/redactar', cuerpo);

  assert.equal((await (await redactar(diego, { texto: 'hola', donde: 'chat', pendiente_id: pendiente.id })).json()).error, 'ia_no_configurada');
  await data('PUT', '/ia', { proveedor: 'gemini', claves: { gemini: 'AIza-falsa-redactar' } });

  const res = await redactar(diego, { texto: '  dile a junior que lo revise  ', donde: 'chat', pendiente_id: pendiente.id });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { redaccion: { texto: '@Junior, ¿puedes revisar el botón «Aceptar invitación»? Redirige a localhost.' } });
  const [chat] = pedidos;
  assert.equal(chat.input, 'dile a junior que lo revise');
  for (const parte of ['mensaje del chat', '«Corregir la redirección del botón», proyecto Mayugo › Vendeizi, estado pendiente, responsable Junior',
    'Descripción (el principio): En el correo de invitación el botón lleva a localhost.', 'Favio: Ya lo vi en staging']) {
    assert.ok(chat.system_instruction.includes(parte), parte);
  }
  assert.match(chat.system_instruction, /Personas: (?=.*Diego)(?=.*Favio)(?=.*Junior)/);
  // Nunca correos ni teléfonos.
  assert.ok(!/junior@example|88887777/.test(JSON.stringify(chat)));

  // En la descripción puede usar Markdown y no van los mensajes del chat. Lo que vuelve se recorta: 2000 en el chat.
  await redactar(diego, { texto: 'pasos para probar', donde: 'descripcion', pendiente_id: pendiente.id });
  assert.ok(pedidos[1].system_instruction.includes('Markdown') && !pedidos[1].system_instruction.includes('Ya lo vi'));
  assert.equal((await diego.data('POST', '/ia/redactar', { texto: 'algo largo', donde: 'chat', pendiente_id: pendiente.id })).redaccion.texto.length, 2000);
  assert.equal((await diego.data('POST', '/ia/redactar', { texto: 'algo largo', donde: 'descripcion', pendiente_id: pendiente.id })).redaccion.texto.length, 2500);

  assert.equal((await diego.data('POST', '/ia/redactar', { texto: 'hola', donde: 'titulo', pendiente_id: pendiente.id })).error, 'donde_invalido');
  assert.equal((await diego.data('POST', '/ia/redactar', { texto: '   ', donde: 'chat', pendiente_id: pendiente.id })).error, 'texto_ia_invalido');
  assert.equal((await diego.data('POST', '/ia/redactar', { texto: 'x'.repeat(4001), donde: 'chat', pendiente_id: pendiente.id })).error, 'texto_ia_invalido');
  // Lo que no se ve no se redacta (ni deja saber que existe).
  const { organizacion: privada } = await favio.data('POST', '/organizaciones', { nombre: 'Lo mío', compartida: false });
  const { proyecto: suyo } = await favio.data('POST', '/proyectos', { nombre: 'Secreto', organizacion_id: privada.id });
  const { pendiente: ajeno } = await favio.data('POST', '', { texto: 'Privado', proyecto_id: suyo.id });
  assert.equal((await redactar(diego, { texto: 'hola', donde: 'chat', pendiente_id: ajeno.id })).status, 404);
  // (El pendiente privado se creó sin tipo y la IA eligió uno: ese pedido no es de redactar.)
  assert.equal(pedidos.filter((p) => p.response_format.schema.required.join() === 'texto').length, 4);
});

test('IA: "Escribir con IA" puede usar otro proveedor y modelo que el resto', async (t) => {
  const proveedor = await startProveedor(t, (ruta, cuerpo) => {
    // Como OpenAI: los modelos que no razonan no aceptan cuánto razonar.
    if (ruta === '/v1/responses' && cuerpo.model === 'gpt-4.1-mini' && cuerpo.reasoning) {
      return { status: 400, json: { error: { message: "Unsupported parameter: 'reasoning.effort' is not supported with this model.", type: 'invalid_request_error', param: 'reasoning.effort', code: 'unsupported_parameter' } } };
    }
    if (ruta === '/v1/responses') return { json: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ texto: 'Desde OpenAI' }) }] }] } };
    const texto = JSON.stringify({ texto: 'Desde Gemini', pendientes: [] });
    return { json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: texto }] }] } };
  });
  const { data, entrarComo } = await startServer(t, { basesIA: { gemini: proveedor.url, openai: proveedor.url } });
  const diego = await entrarComo('Diego');
  const { pendiente } = await diego.data('POST', '', { texto: 'Algo', tipo: 'chore' });
  const redactar = async () => (await diego.data('POST', '/ia/redactar', { texto: 'hola', donde: 'chat', pendiente_id: pendiente.id }));

  // Solo para redactar: no hace falta haber elegido la IA del equipo.
  const { ia } = await data('PUT', '/ia', { claves: { openai: 'sk-falsa-redactar' }, redaccion: { proveedor: 'openai', modelo: 'gpt-6-chispa' } });
  assert.deepEqual([ia.lista, ia.redaccion], [false, { proveedor: 'openai', modelo: 'gpt-6-chispa', lista: true }]);
  assert.equal((await redactar()).redaccion.texto, 'Desde OpenAI');
  const alOpenAI = proveedor.pedidos.at(-1);
  assert.deepEqual([alOpenAI.ruta, alOpenAI.cuerpo.model, alOpenAI.headers.authorization], ['/v1/responses', 'gpt-6-chispa', 'Bearer sk-falsa-redactar']);
  // Redactar no necesita razonar mucho: así contesta antes.
  assert.deepEqual(alOpenAI.cuerpo.reasoning, { effort: 'low' });

  // Un modelo que no razona: se vuelve a pedir sin eso, y la próxima vez ya no se intenta.
  await data('PUT', '/ia', { redaccion: { proveedor: 'openai', modelo: 'gpt-4.1-mini' } });
  const antes = proveedor.pedidos.length;
  assert.equal((await redactar()).redaccion.texto, 'Desde OpenAI');
  assert.equal((await redactar()).redaccion.texto, 'Desde OpenAI');
  assert.deepEqual(proveedor.pedidos.slice(antes).map((p) => Boolean(p.cuerpo.reasoning)), [true, false, false]);
  await data('PUT', '/ia', { redaccion: { proveedor: 'openai', modelo: 'gpt-6-chispa' } });

  // Lo demás sigue con la del equipo; cambiarla no toca la de redactar.
  await data('PUT', '/ia', { proveedor: 'gemini', claves: { gemini: 'AIza-falsa-equipo' }, modelos: { openai: 'gpt-6-astra' } });
  await diego.data('POST', '/ia/sugerir', { texto: 'algo' });
  assert.equal(proveedor.pedidos.at(-1).ruta, '/v1beta/interactions');
  assert.equal((await redactar()).redaccion.texto, 'Desde OpenAI');
  assert.equal(proveedor.pedidos.at(-1).cuerpo.model, 'gpt-6-chispa');

  // Sin la clave de su proveedor no redacta (aunque la del equipo sí tenga), y lo dice.
  const { ia: sinClave } = await data('PUT', '/ia', { claves: { openai: null } });
  assert.equal(sinClave.redaccion.lista, false);
  assert.equal((await redactar()).error, 'ia_sin_clave');

  // null: vuelve a usar la del equipo.
  assert.equal((await data('PUT', '/ia', { redaccion: null })).ia.redaccion, null);
  assert.equal((await redactar()).redaccion.texto, 'Desde Gemini');
  assert.equal(proveedor.pedidos.at(-1).cuerpo.model, 'gemini-3.5-flash-lite');
});

test('cada persona elige su fuente y su tamaño de letra, y le llegan con /yo', async (t) => {
  const { data, entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');

  assert.deepEqual(await diego.data('PUT', '/yo/apariencia', { fuente: 'atkinson', tamano: 112 }), { apariencia: { fuente: 'atkinson', tamano: 112 } });
  assert.deepEqual((await diego.data('GET', '/yo')).usuario.apariencia, { fuente: 'atkinson', tamano: 112 });
  // Es de cada uno: Favio sigue con la de siempre, y la cuenta del equipo tiene la suya.
  assert.equal((await favio.data('GET', '/yo')).usuario.apariencia, null);
  await data('PUT', '/yo/apariencia', { fuente: 'serif', tamano: 90 });
  assert.deepEqual((await data('GET', '/yo')).usuario.apariencia, { fuente: 'serif', tamano: 90 });
  assert.deepEqual((await diego.data('GET', '/yo')).usuario.apariencia, { fuente: 'atkinson', tamano: 112 });

  for (const malo of [{ fuente: 'comic-sans', tamano: 100 }, { fuente: 'inter', tamano: 200 }, { fuente: 'inter', tamano: 99.5 }, { fuente: 'inter' }, {}]) {
    assert.equal((await diego.data('PUT', '/yo/apariencia', malo)).error, 'apariencia_invalida', JSON.stringify(malo));
  }
  assert.equal((await diego.call('GET', '/yo/apariencia')).status, 405);
});

test('IA: «Crear con IA» queda trabajando en el servidor y se pregunta hasta que termina', async (t) => {
  let soltar;
  const proveedor = await startProveedor(t, async (ruta, cuerpo) => {
    // Tarda lo que diga la prueba: más de lo que nginx espera una respuesta.
    await new Promise((listo) => { soltar = listo; });
    if (cuerpo.input.includes('falla')) return { status: 400, json: { error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } } };
    const propuesta = { pendientes: [{ titulo: 'Revisar el login', detalle: null, responsable: 'Diego', proyecto: null, etiquetas: [], tipo: 'fix', estado: 'pendiente', imagenes: [] }] };
    return { json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(propuesta) }] }] } };
  });
  const { data, entrarComo } = await startServer(t, { basesIA: { gemini: proveedor.url } });
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  await data('PUT', '/ia', { proveedor: 'gemini', claves: { gemini: 'AIza-falsa-trabajo' } });
  const esperarPedido = async (cuantos) => { while (proveedor.pedidos.length < cuantos) await new Promise((listo) => setTimeout(listo, 10)); };

  const empezado = await diego.call('POST', '/ia/sugerir?trabajo', { texto: 'el login no deja entrar' });
  assert.equal(empezado.status, 202);
  const { trabajo } = await empezado.json();
  await esperarPedido(1);
  assert.deepEqual(await diego.data('GET', `/ia/sugerir/${trabajo}`), { estado: 'pensando' });
  // Es de quien lo pidió.
  assert.equal((await favio.call('GET', `/ia/sugerir/${trabajo}`)).status, 404);
  soltar();
  let listo;
  do listo = await diego.data('GET', `/ia/sugerir/${trabajo}`); while (listo.estado === 'pensando');
  assert.deepEqual(listo.sugerencias.map((s) => [s.texto, s.perfil_id, s.tipo]), [['Revisar el login', diego.perfil.id, 'fix']]);
  // El resultado se entrega una vez.
  assert.equal((await diego.call('GET', `/ia/sugerir/${trabajo}`)).status, 404);

  // Si la IA falla, la pregunta siguiente trae el error con lo que dijo el proveedor.
  const { trabajo: otro } = await diego.data('POST', '/ia/sugerir?trabajo', { texto: 'esto falla' });
  await esperarPedido(2);
  soltar();
  let fallo;
  do fallo = await diego.call('GET', `/ia/sugerir/${otro}`); while ((await fallo.clone().json()).estado === 'pensando');
  assert.equal(fallo.status, 422);
  assert.equal((await fallo.json()).error, 'ia_clave_invalida');

  // Lo que se valida antes (sin texto) responde al momento, como siempre.
  assert.equal((await diego.call('POST', '/ia/sugerir?trabajo', { texto: '' })).status, 422);
  assert.equal((await diego.call('GET', '/ia/sugerir/00000000-0000-0000-0000-000000000000')).status, 404);
});

test('IA: reescribe lo seleccionado, con una indicación si viene', async (t) => {
  const pedidos = [];
  const proveedor = await startProveedor(t, async (ruta, cuerpo) => {
    pedidos.push(cuerpo);
    return { json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ texto: 'Más corto' }) }] }] } };
  });
  const { data, entrarComo } = await startServer(t, { basesIA: { gemini: proveedor.url } });
  const diego = await entrarComo('Diego');
  await data('PUT', '/ia', { proveedor: 'gemini', claves: { gemini: 'AIza-falsa-seleccion' } });
  const { pendiente } = await diego.data('POST', '', { texto: 'Algo', tipo: 'chore' });
  const redactar = (extra) => diego.data('POST', '/ia/redactar', { texto: 'el texto que se seleccionó', donde: 'descripcion', pendiente_id: pendiente.id, ...extra });

  assert.equal((await redactar({ seleccion: true, indicacion: '  más corto  ' })).redaccion.texto, 'Más corto');
  const [conIndicacion] = pedidos;
  assert.equal(conIndicacion.input, 'el texto que se seleccionó');
  assert.match(conIndicacion.system_instruction, /fragmento que la persona seleccionó/);
  assert.match(conIndicacion.system_instruction, /siguiendo esta indicación de la persona: «más corto»/);
  // Sin indicación: solo mejorarlo. Y lo de siempre no lleva nada de esto.
  await redactar({ seleccion: true });
  assert.ok(pedidos[1].system_instruction.includes('fragmento') && !pedidos[1].system_instruction.includes('indicación de la persona'));
  await redactar({});
  assert.ok(!pedidos[2].system_instruction.includes('fragmento'));

  assert.equal((await redactar({ seleccion: 'sí' })).error, 'seleccion_invalida');
  assert.equal((await redactar({ indicacion: 'x'.repeat(301) })).error, 'indicacion_invalida');
  assert.equal((await redactar({ indicacion: 5 })).error, 'indicacion_invalida');
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
  // Un modelo que no lee imágenes (así lo dice OpenRouter, con 404).
  respuesta = { status: 404, json: { error: { message: 'No endpoints found that support image input' } } };
  assert.equal((await sugerir()).error, 'ia_sin_imagenes');
  respuesta = { status: 400, json: { error: { message: 'Invalid content type. image_url is only supported by certain models.' } } };
  assert.equal((await sugerir()).error, 'ia_sin_imagenes');
});

test('IA: dice qué imágenes son de cada pendiente; con uno solo, se lleva todas', async (t) => {
  let pendientes;
  const proveedor = await startProveedor(t, () => ({
    json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ pendientes }) }] }] },
  }));
  const { data } = await startServer(t, { basesIA: { gemini: proveedor.url, openai: proveedor.url, openrouter: proveedor.url } });
  await data('PUT', '/ia', { proveedor: 'gemini', claves: { gemini: 'AIza-falsa' } });
  const base = { detalle: null, responsable: null, proyecto: null, etiquetas: [], tipo: null, estado: 'pendiente' };
  const png = { datos: PNG.toString('base64') };
  const sugerir = async (cantidad) => (await data('POST', '/ia/sugerir', { texto: 'mira', imagenes: Array(cantidad).fill(png) })).sugerencias;

  // Números de 1 en adelante → posiciones desde 0; los que no existen se ignoran y no se repiten.
  pendientes = [{ ...base, titulo: 'Uno', imagenes: [2, 9, 0, 2] }, { ...base, titulo: 'Dos', imagenes: [] }, { ...base, titulo: 'Tres', imagenes: [1, 3] }];
  assert.deepEqual((await sugerir(3)).map((s) => s.imagenes), [[1], [], [0, 2]]);
  // Una sola tarea sin imágenes elegidas: todas son suyas. Si eligió alguna, solo esas.
  pendientes = [{ ...base, titulo: 'Única', imagenes: [] }];
  assert.deepEqual((await sugerir(2))[0].imagenes, [0, 1]);
  pendientes = [{ ...base, titulo: 'Única', imagenes: [2] }];
  assert.deepEqual((await sugerir(2))[0].imagenes, [1]);
  // Sin imágenes enviadas no hay nada que adjuntar, diga lo que diga la IA.
  assert.deepEqual((await data('POST', '/ia/sugerir', { texto: 'sin imágenes' })).sugerencias[0].imagenes, []);
});

test('al asignar un pendiente va al final de la cola de su columna; sin responsable, lo nuevo va arriba', async (t) => {
  const { entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const columna = async (estado) => (await diego.data('GET')).pendientes.filter((p) => p.estado === estado).map((p) => p.texto);
  const crear = async (texto, extra = {}) => (await diego.data('POST', '', { texto, ...extra })).pendiente;
  const a = await crear('A');
  await crear('Hecho', { estado: 'hecho' });
  const b = await crear('B');
  const c = await crear('C');
  assert.deepEqual(await columna('pendiente'), ['C', 'B', 'A']);

  // Creado ya con responsable: al final.
  const d = await crear('D', { perfil_id: favio.perfil.id });
  assert.deepEqual(await columna('pendiente'), ['C', 'B', 'A', 'D']);
  // Asignar uno que estaba arriba lo manda al final; volver a mandar el mismo responsable o quitarlo no lo mueve.
  await diego.data('PATCH', `/${c.id}`, { perfil_id: favio.perfil.id });
  assert.deepEqual(await columna('pendiente'), ['B', 'A', 'D', 'C']);
  await diego.data('PATCH', `/${d.id}`, { perfil_id: favio.perfil.id, texto: 'D2' });
  await diego.data('PATCH', `/${a.id}`, { perfil_id: null });
  assert.deepEqual(await columna('pendiente'), ['B', 'A', 'D2', 'C']);
  // Reasignar a otra persona también, y en la columna a la que va si cambia de estado a la vez.
  await diego.data('PATCH', `/${d.id}`, { perfil_id: diego.perfil.id });
  assert.deepEqual(await columna('pendiente'), ['B', 'A', 'C', 'D2']);
  await diego.data('PATCH', `/${b.id}`, { perfil_id: favio.perfil.id, estado: 'hecho' });
  assert.deepEqual(await columna('hecho'), ['Hecho', 'B']);
  // Pasarlo a otra persona: vuelve a Por hacer, al final.
  await diego.data('POST', `/${b.id}/traspaso`, { perfil_id: diego.perfil.id });
  assert.deepEqual(await columna('pendiente'), ['A', 'C', 'D2', 'B']);
});

test('escribir la descripción enseguida de crearlo es parte de crearlo; después sí queda en el historial', async (t) => {
  const { entrarComo } = await startServer(t);
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  const { pendiente } = await diego.data('POST', '', { texto: 'Con imágenes' });
  const descripcion = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Mira la captura', styles: {} }] }]);
  await diego.data('PATCH', `/${pendiente.id}`, { descripcion });
  const tipos = async () => (await diego.data('GET', `/${pendiente.id}/actividad`)).actividad.map((a) => `${a.autor}:${a.tipo}`);
  assert.deepEqual(await tipos(), ['Diego:creado']);
  // Si la edita otra persona, sí.
  await favio.data('PATCH', `/${pendiente.id}`, { descripcion: JSON.stringify([]) });
  assert.deepEqual(await tipos(), ['Favio:descripcion', 'Diego:creado']);
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

// Las notas privadas: Diego tiene su correo en NOTAS_CORREOS. Favio también, para ver que cada quien ve solo lo suyo.
async function conNotas(t, opciones = {}) {
  const servidor = await startServer(t, { notasCorreos: 'Diego@Ejemplo.com, favio@ejemplo.com', ...opciones });
  const diego = await servidor.entrarComo('Diego');
  const favio = await servidor.entrarComo('Favio');
  const junior = await servidor.entrarComo('Junior');
  assert.equal((await diego.call('PATCH', `/perfiles/${diego.perfil.id}`, { correo: 'diego@ejemplo.com' })).status, 200);
  assert.equal((await favio.call('PATCH', `/perfiles/${favio.perfil.id}`, { correo: 'favio@ejemplo.com' })).status, 200);
  assert.equal((await junior.call('PATCH', `/perfiles/${junior.perfil.id}`, { correo: 'junior@ejemplo.com' })).status, 200);
  // Para mandar el cuerpo tal cual (imágenes y partes de un recurso).
  const subir = (quien, ruta, cuerpo, headers = {}) => fetch(`${servidor.base}/api/pendientes${ruta}`, { method: 'POST', headers: { ...quien.headers, ...headers }, body: cuerpo });
  return { ...servidor, diego, favio, junior, subir };
}

const documento = (...textos) => JSON.stringify(textos.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }], children: [] })));

test('valida cursos y notas', () => {
  assert.deepEqual(parseCurso({ nombre: '  Cálculo II ', icono: ' 📐 ' }), { nombre: 'Cálculo II', icono: '📐' });
  assert.deepEqual(parseCurso({ icono: '🧪' }, { partial: true }), { icono: '🧪' });
  assert.throws(() => parseCurso({ nombre: '' }), /nombre_curso_invalido/);
  assert.throws(() => parseCurso({ nombre: 'x'.repeat(81) }), /nombre_curso_invalido/);
  assert.throws(() => parseCurso({ nombre: 'A', icono: '' }), /icono_invalido/);
  assert.throws(() => parseCurso({ nombre: 'A', icono: 'x'.repeat(17) }), /icono_invalido/);
  assert.deepEqual(parseNota({}), { titulo: '' });
  assert.deepEqual(parseNota({ titulo: '  Clase   1 ' }), { titulo: 'Clase 1' });
  assert.deepEqual(parseNota({ contenido: '[]' }, { partial: true }), { contenido: '[]' });
  assert.throws(() => parseNota({ titulo: 'x'.repeat(201) }), /titulo_nota_invalido/);
  assert.throws(() => parseNota({ contenido: '{}' }, { partial: true }), /contenido_nota_invalido/);
  assert.throws(() => parseNota({ contenido: 'no es json' }, { partial: true }), /contenido_nota_invalido/);
  assert.throws(() => parseNota({ curso_id: '' }, { partial: true }), /curso_invalido/);
  assert.equal(extractoDe('La derivada de una función mide su cambio', 'funcion'), 'La derivada de una función mide su cambio');
  assert.equal(extractoDe(`${'a'.repeat(100)} integral ${'b'.repeat(300)}`, 'integral').startsWith('…'), true);
});

test('notas: solo las tiene quien entra con su perfil y su correo está en la lista; para los demás no existen', async (t) => {
  const { base, call, data, diego, favio, junior } = await conNotas(t);
  assert.equal((await diego.data('GET', '/yo')).usuario.notas, true);
  assert.equal((await junior.data('GET', '/yo')).usuario.notas, false);
  assert.equal((await data('GET', '/yo')).usuario.notas, false);

  const { curso } = await diego.data('POST', '/notas/cursos', { nombre: 'Cálculo II', icono: '📐' });
  assert.equal(curso.icono, '📐');
  const { nota } = await diego.data('POST', `/notas/cursos/${curso.id}/notas`, { titulo: 'Integrales por partes' });
  assert.equal(nota.curso_id, curso.id);
  const contenido = documento('La fórmula es ∫u dv = uv − ∫v du.', 'Ecuación de ejemplo con logaritmos.');
  assert.equal((await diego.call('PATCH', `/notas/${nota.id}`, { contenido })).status, 200);
  assert.equal((await diego.data('GET', `/notas/${nota.id}`)).nota.contenido, contenido);
  const arbol = await diego.data('GET', '/notas');
  assert.deepEqual(arbol.cursos.map((c) => c.nombre), ['Cálculo II']);
  assert.deepEqual(arbol.notas.map((n) => n.titulo), ['Integrales por partes']);
  assert.deepEqual(arbol.recursos, []);
  // Se busca sin tildes ni mayúsculas, en el título y en el texto.
  const { notas: halladas } = await diego.data('GET', `/notas/buscar?q=${encodeURIComponent('ecuacion LOGARITMOS')}`);
  assert.deepEqual(halladas.map((n) => n.id), [nota.id]);
  assert.match(halladas[0].extracto, /Ecuación de ejemplo/);
  assert.deepEqual((await diego.data('GET', '/notas/buscar?q=derivadas')).notas, []);

  // La cuenta del equipo y un perfil sin el correo en la lista no las ven, ni lo que hay dentro.
  for (const [quien, headers] of [['equipo', { Authorization: auth }], ['junior', junior.headers]]) {
    for (const [method, ruta] of [['GET', '/notas'], ['GET', `/notas/${nota.id}`], ['GET', '/notas/buscar?q=ecuacion'], ['POST', '/notas/cursos'],
      ['PATCH', `/notas/${nota.id}`], ['DELETE', `/notas/cursos/${curso.id}`]]) {
      assert.equal((await call(method, ruta, method === 'GET' || method === 'DELETE' ? undefined : { nombre: 'X' }, headers)).status, 404, `${quien} ${method} ${ruta}`);
    }
  }
  // Favio también tiene notas, pero solo las suyas.
  assert.deepEqual(await favio.data('GET', '/notas'), { cursos: [], notas: [], recursos: [] });
  assert.equal((await favio.call('GET', `/notas/${nota.id}`)).status, 404);
  assert.equal((await favio.call('PATCH', `/notas/${nota.id}`, { titulo: 'Mía' })).status, 404);
  assert.equal((await favio.call('DELETE', `/notas/${nota.id}`)).status, 404);
  assert.equal((await favio.call('POST', `/notas/cursos/${curso.id}/notas`, {})).status, 404);
  assert.equal((await favio.call('PATCH', `/notas/cursos/${curso.id}`, { nombre: 'Mío' })).status, 404);
  assert.deepEqual((await favio.data('GET', '/notas/buscar?q=ecuacion')).notas, []);
  // Tampoco puede mover una nota suya a un curso ajeno.
  const { curso: deFavio } = await favio.data('POST', '/notas/cursos', { nombre: 'Inglés' });
  const { nota: suya } = await favio.data('POST', `/notas/cursos/${deFavio.id}/notas`, {});
  assert.equal(suya.titulo, '');
  assert.equal((await favio.data('PATCH', `/notas/${suya.id}`, { curso_id: curso.id })).error, 'curso_invalido');
  assert.equal((await diego.data('PATCH', `/notas/${nota.id}`, { curso_id: deFavio.id })).error, 'curso_invalido');

  // Si Diego cambia su correo por uno que no está en la lista, deja de verlas (y siguen ahí si lo vuelve a poner).
  await diego.call('PATCH', `/perfiles/${diego.perfil.id}`, { correo: 'otro@ejemplo.com' });
  assert.equal((await diego.call('GET', '/notas')).status, 404);
  await diego.call('PATCH', `/perfiles/${diego.perfil.id}`, { correo: 'DIEGO@ejemplo.com' });
  assert.equal((await diego.data('GET', '/notas')).notas.length, 1);

  // Un perfil con notas no se puede borrar sin borrarlas antes.
  assert.equal((await diego.data('DELETE', `/perfiles/${diego.perfil.id}`)).error, 'perfil_con_notas');

  // Nada de esto viaja por los cambios en tiempo real.
  const cambiar = async () => {
    await diego.data('POST', `/notas/cursos/${curso.id}/notas`, { titulo: 'Clase 2' });
    await diego.data('PATCH', `/notas/cursos/${curso.id}`, { nombre: 'Cálculo 2' });
  };
  assert.deepEqual(await leerEventos(base, favio.headers, { esperaMs: 600, alConectar: cambiar }), []);
  assert.deepEqual(await leerEventos(base, diego.headers, { cliente: 'otra', esperaMs: 600, alConectar: cambiar }), []);

  // Sin NOTAS_CORREOS nadie las tiene.
  const sinLista = await startServer(t);
  const otro = await sinLista.entrarComo('Diego');
  await otro.call('PATCH', `/perfiles/${otro.perfil.id}`, { correo: 'diego@ejemplo.com' });
  assert.equal((await otro.data('GET', '/yo')).usuario.notas, false);
  assert.equal((await otro.call('GET', '/notas')).status, 404);
});

test('notas: las imágenes son de su dueño y se borran cuando ninguna nota las usa', async (t) => {
  const { call, diego, favio, subir } = await conNotas(t, { graciaImagenesMs: 0 });
  const { curso } = await diego.data('POST', '/notas/cursos', { nombre: 'Química' });
  const { nota: primera } = await diego.data('POST', `/notas/cursos/${curso.id}/notas`, { titulo: 'Enlaces' });
  const { nota: segunda } = await diego.data('POST', `/notas/cursos/${curso.id}/notas`, { titulo: 'Repaso' });
  const res = await subir(diego, `/notas/${primera.id}/imagenes`, PNG, { 'Content-Type': 'image/png' });
  assert.equal(res.status, 201);
  const { imagen } = await res.json();
  assert.equal(imagen.url, `/api/pendientes/notas/imagenes/${imagen.id}`);
  assert.equal((await subir(diego, `/notas/${primera.id}/imagenes`, Buffer.from('<svg/>'))).status, 415);
  assert.equal((await subir(favio, `/notas/${primera.id}/imagenes`, PNG)).status, 404);

  const ver = (quien) => call('GET', `/notas/imagenes/${imagen.id}`, undefined, quien.headers);
  const vista = await ver(diego);
  assert.equal(vista.status, 200);
  assert.equal(vista.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await vista.arrayBuffer()), PNG);
  assert.equal((await ver(favio)).status, 404);
  assert.equal((await call('GET', `/notas/imagenes/${imagen.id}`)).status, 404);

  // Copiada a otra nota sigue viva aunque se quite (o se borre) la primera.
  const conImagen = JSON.stringify([{ type: 'image', props: { url: imagen.url }, children: [] }]);
  await diego.data('PATCH', `/notas/${primera.id}`, { contenido: conImagen });
  await diego.data('PATCH', `/notas/${segunda.id}`, { contenido: conImagen });
  await diego.data('DELETE', `/notas/${primera.id}`);
  assert.equal((await ver(diego)).status, 200);
  await diego.data('PATCH', `/notas/${segunda.id}`, { contenido: documento('Sin imagen') });
  assert.equal((await ver(diego)).status, 404);
});

test('notas: los recursos se suben por partes, en orden, y se abren con su tipo', async (t) => {
  const { base, dataDir, diego, favio, subir } = await conNotas(t);
  const { curso } = await diego.data('POST', '/notas/cursos', { nombre: 'Física', icono: '🧲' });
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3000, 0x41), Buffer.from('\n%%EOF\n')]);
  const partes = [pdf.subarray(0, 1000), pdf.subarray(1000, 2000), pdf.subarray(2000)];
  const nombre = encodeURIComponent('Guía de ejercicios.pdf');

  const primera = await subir(diego, `/notas/cursos/${curso.id}/recursos`, partes[0], { 'X-Nombre-Archivo': nombre, 'X-Tamano': String(pdf.length) });
  assert.equal(primera.status, 201);
  const { recurso } = await primera.json();
  assert.equal(recurso.nombre, 'Guía de ejercicios.pdf');
  assert.equal(recurso.tipo, 'application/pdf');
  assert.equal(recurso.subido, 1000);
  // A medias no aparece ni se abre.
  assert.deepEqual((await diego.data('GET', '/notas')).recursos, []);
  assert.equal((await diego.call('GET', `/notas/recursos/${recurso.id}`)).status, 404);
  // Una parte fuera de orden, o de otro perfil, no entra.
  assert.equal((await subir(diego, `/notas/recursos/${recurso.id}/partes?desde=2000`, partes[2])).status, 409);
  assert.equal((await subir(favio, `/notas/recursos/${recurso.id}/partes?desde=1000`, partes[1])).status, 404);
  assert.equal((await subir(diego, `/notas/recursos/${recurso.id}/partes?desde=1000`, Buffer.alloc(5000))).status, 422);
  assert.equal((await (await subir(diego, `/notas/recursos/${recurso.id}/partes?desde=1000`, partes[1])).json()).recurso.subido, 2000);
  const ultima = await (await subir(diego, `/notas/recursos/${recurso.id}/partes?desde=2000`, partes[2])).json();
  assert.equal(ultima.recurso.subido, pdf.length);
  assert.equal((await subir(diego, `/notas/recursos/${recurso.id}/partes?desde=${pdf.length}`, Buffer.from('x'))).status, 409);

  assert.deepEqual((await diego.data('GET', '/notas')).recursos.map((r) => r.nombre), ['Guía de ejercicios.pdf']);
  const abierto = await diego.call('GET', `/notas/recursos/${recurso.id}`);
  assert.equal(abierto.status, 200);
  assert.equal(abierto.headers.get('content-type'), 'application/pdf');
  assert.match(abierto.headers.get('content-disposition'), /^inline; filename\*=UTF-8''Gu%C3%ADa/);
  assert.match(abierto.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await abierto.arrayBuffer()), pdf);
  assert.equal((await favio.call('GET', `/notas/recursos/${recurso.id}`)).status, 404);
  assert.deepEqual((await diego.data('GET', '/notas/buscar?q=guia')).recursos.map((r) => r.id), [recurso.id]);

  // Lo que no es imagen ni PDF se descarga.
  const ZIP = Buffer.from('PK\x03\x04datos');
  const zip = await (await subir(diego, `/notas/cursos/${curso.id}/recursos`, ZIP, { 'X-Nombre-Archivo': 'a.zip', 'X-Tamano': '9' })).json();
  assert.equal(zip.recurso.subido, 9);
  assert.match((await diego.call('GET', `/notas/recursos/${zip.recurso.id}`)).headers.get('content-disposition'), /^attachment/);

  // Límites: el tamaño total, una parte más grande que lo que queda y una parte de más de 8 MB.
  const nuevo = (cuerpo, tamano) => subir(diego, `/notas/cursos/${curso.id}/recursos`, cuerpo, { 'X-Nombre-Archivo': 'x.pdf', 'X-Tamano': String(tamano) });
  assert.equal((await (await nuevo(Buffer.from('%PDF-'), 301 * 1024 * 1024)).json()).error, 'recurso_muy_grande');
  assert.equal((await (await nuevo(Buffer.from('%PDF-'), 2)).json()).error, 'parte_invalida');
  assert.equal((await (await nuevo(Buffer.from('%PDF-'), 'mucho')).json()).error, 'parte_invalida');
  assert.equal((await nuevo(Buffer.alloc(8 * 1024 * 1024 + 1), 9 * 1024 * 1024)).status, 413);
  assert.equal((await (await nuevo(Buffer.alloc(0), 5)).json()).error, 'archivo_vacio');
  assert.equal((await subir(favio, `/notas/cursos/${curso.id}/recursos`, Buffer.from('%PDF-'), { 'X-Tamano': '5' })).status, 404);

  // Se renombra; al borrarlo (o al borrar el curso) se va también del disco.
  assert.equal((await diego.data('PATCH', `/notas/recursos/${recurso.id}`, { nombre: 'Guía 1.pdf' })).recurso.nombre, 'Guía 1.pdf');
  assert.equal((await favio.call('PATCH', `/notas/recursos/${recurso.id}`, { nombre: 'Mía.pdf' })).status, 404);
  assert.equal((await favio.call('DELETE', `/notas/recursos/${recurso.id}`)).status, 404);
  const enDisco = (contenido) => existsSync(path.join(dataDir, 'blobs', sha(contenido)));
  assert.ok(enDisco(pdf));
  assert.ok(!existsSync(path.join(dataDir, 'notas', 'recursos', `${recurso.id}.parcial`)));
  assert.equal((await diego.call('DELETE', `/notas/recursos/${recurso.id}`)).status, 200);
  assert.ok(!enDisco(pdf));
  assert.ok(enDisco(ZIP));
  const { nota } = await diego.data('POST', `/notas/cursos/${curso.id}/notas`, { titulo: 'Clase 1' });
  assert.equal((await diego.call('DELETE', `/notas/cursos/${curso.id}`)).status, 200);
  assert.ok(!enDisco(ZIP));
  assert.equal((await diego.call('GET', `/notas/${nota.id}`)).status, 404);
  assert.deepEqual(await diego.data('GET', '/notas'), { cursos: [], notas: [], recursos: [] });
  assert.ok(base);
});

test('cada contenido se guarda una vez: lo repetido apunta al mismo archivo y se borra con el último que lo usa', async (t) => {
  const { base, dataDir, diego, favio, subir } = await conNotas(t);
  const PDF = Buffer.from('%PDF-1.4\n%repetido\n');
  const { pendiente: a } = await diego.data('POST', '', { texto: 'A' });
  const { pendiente: b } = await favio.data('POST', '', { texto: 'B' });
  const adjuntar = async (quien, pendienteId, nombre) => (await (await fetch(`${base}/api/pendientes/${pendienteId}/archivos`, {
    method: 'POST', headers: { ...quien.headers, 'X-Nombre-Archivo': nombre }, body: PDF,
  })).json()).archivo;

  // Dos adjuntos (de dos personas, en dos pendientes) y un recurso de las notas con el mismo contenido: un solo archivo.
  const uno = await adjuntar(diego, a.id, 'uno.pdf');
  const otro = await adjuntar(favio, b.id, 'otro.pdf');
  const { curso } = await diego.data('POST', '/notas/cursos', { nombre: 'Física' });
  const { recurso } = await (await subir(diego, `/notas/cursos/${curso.id}/recursos`, PDF, { 'X-Nombre-Archivo': 'guia.pdf', 'X-Tamano': String(PDF.length) })).json();
  assert.deepEqual(blobs(dataDir), [sha(PDF)]);
  assert.deepEqual([uno.nombre, otro.nombre, recurso.nombre], ['uno.pdf', 'otro.pdf', 'guia.pdf']);

  // Borrar uno no le quita el archivo a los demás.
  assert.equal((await diego.call('DELETE', `/archivos/${uno.id}`)).status, 200);
  assert.deepEqual(blobs(dataDir), [sha(PDF)]);
  assert.deepEqual(Buffer.from(await (await favio.call('GET', `/archivos/${otro.id}`)).arrayBuffer()), PDF);
  assert.equal((await favio.call('DELETE', `/${b.id}`)).status, 200);
  assert.deepEqual(blobs(dataDir), [sha(PDF)]);
  assert.deepEqual(Buffer.from(await (await diego.call('GET', `/notas/recursos/${recurso.id}`)).arrayBuffer()), PDF);
  // Con el último se va del disco.
  assert.equal((await diego.call('DELETE', `/notas/recursos/${recurso.id}`)).status, 200);
  assert.deepEqual(blobs(dataDir), []);
});

test('notas: un recurso que su dueño ya tiene se agrega sin volver a subirlo; lo de otro perfil no cuenta', async (t) => {
  const { dataDir, diego, favio, subir } = await conNotas(t);
  const pdf = Buffer.from(`%PDF-1.4\n${'x'.repeat(5000)}`);
  const { curso: fisica } = await diego.data('POST', '/notas/cursos', { nombre: 'Física' });
  const { curso: quimica } = await diego.data('POST', '/notas/cursos', { nombre: 'Química' });
  const { curso: deFavio } = await favio.data('POST', '/notas/cursos', { nombre: 'Lo de Favio' });
  const repetido = (quien, cursoId, cabeceras = {}) => subir(quien, `/notas/cursos/${cursoId}/recursos/repetido`, undefined, {
    'X-Nombre-Archivo': encodeURIComponent('Copia de la guía.pdf'), 'X-Tamano': String(pdf.length), 'X-Sha256': sha(pdf), ...cabeceras,
  });

  const noLoTiene = async (respuesta) => {
    assert.equal(respuesta.status, 200);
    assert.deepEqual(await respuesta.json(), { recurso: null });
  };
  // Todavía no lo tiene: se sube como siempre.
  await noLoTiene(await repetido(diego, quimica.id));
  await subir(diego, `/notas/cursos/${fisica.id}/recursos`, pdf, { 'X-Nombre-Archivo': 'guia.pdf', 'X-Tamano': String(pdf.length) });
  const agregado = await repetido(diego, quimica.id);
  assert.equal(agregado.status, 201);
  const { recurso } = await agregado.json();
  assert.deepEqual([recurso.curso_id, recurso.nombre, recurso.tipo, recurso.subido, recurso.tamano],
    [quimica.id, 'Copia de la guía.pdf', 'application/pdf', pdf.length, pdf.length]);
  assert.deepEqual(Buffer.from(await (await diego.call('GET', `/notas/recursos/${recurso.id}`)).arrayBuffer()), pdf);
  assert.deepEqual(blobs(dataDir), [sha(pdf)]);

  // Para Favio es como si nadie lo tuviera: no puede averiguar qué archivos tiene Diego mandando un hash.
  await noLoTiene(await repetido(favio, deFavio.id));
  assert.equal((await repetido(favio, quimica.id)).status, 404);
  // Otro tamaño no es el mismo archivo; un hash mal formado no se acepta.
  await noLoTiene(await repetido(diego, quimica.id, { 'X-Tamano': '10' }));
  assert.equal((await repetido(diego, quimica.id, { 'X-Sha256': 'abc' })).status, 422);
});

test('lo guardado antes (un archivo por fila) pasa a guardarse por contenido al arrancar', async (t) => {
  const primero = await startServer(t);
  const { dataDir } = primero;
  const diego = await primero.entrarComo('Diego');
  const { pendiente } = await diego.data('POST', '', { texto: 'De antes' });
  const PDF = Buffer.from('%PDF-1.4\n%de antes\n');
  const adjuntar = async (nombre) => (await (await fetch(`${primero.base}/api/pendientes/${pendiente.id}/archivos`, {
    method: 'POST', headers: { ...diego.headers, 'X-Nombre-Archivo': nombre }, body: PDF,
  })).json()).archivo;
  const archivos = [await adjuntar('a.pdf'), await adjuntar('b.pdf')];

  // Como antes de v10: cada fila con su propio archivo (archivos/<id>) y sin sha256.
  const db = new DatabaseSync(path.join(dataDir, 'pendientes.db'));
  db.exec('UPDATE archivos SET sha256 = NULL');
  db.close();
  await mkdir(path.join(dataDir, 'archivos'), { recursive: true });
  for (const { id } of archivos) await writeFile(path.join(dataDir, 'archivos', id), PDF);
  await unlink(path.join(dataDir, 'blobs', sha(PDF)));

  // Con la misma base, Diego entra con la contraseña que ya tiene.
  const segundo = await startServer(t, { dataDir });
  for (const { id } of archivos) {
    assert.deepEqual(Buffer.from(await (await segundo.call('GET', `/archivos/${id}`, undefined, diego.headers)).arrayBuffer()), PDF);
    assert.equal(existsSync(path.join(dataDir, 'archivos', id)), false);
  }
  assert.deepEqual(blobs(dataDir), [sha(PDF)]);
});

test('avisos por correo: a quien no ve sus avisos le llega un resumen de esa actividad, una vez, y lo puede apagar', async (t) => {
  const enviados = [];
  let fallar = false;
  const correo = { enviar: async (mensaje) => {
    if (fallar) throw new Error('SMTP caído');
    enviados.push(mensaje);
  } };
  const { server, call, entrarComo } = await startServer(t, { correo, urlTablero: 'https://tablero.ejemplo/pendientes/' });
  const diego = await entrarComo('Diego');
  const favio = await entrarComo('Favio');
  assert.equal((await favio.call('PATCH', `/perfiles/${favio.perfil.id}`, { correo: 'favio@ejemplo.com' })).status, 200);
  const MIN = 60_000;
  const inicio = Date.now();
  const vuelta = (minutos) => server.mandarAvisosPorCorreo(inicio + minutos * MIN);

  const yo = async (quien) => (await (await call('GET', '/yo', undefined, quien.headers)).json()).usuario.avisos_por_correo;
  assert.deepEqual(await yo(favio), { activo: true, correo: 'favio@ejemplo.com' });
  assert.deepEqual(await yo(diego), { activo: true, correo: null });
  assert.equal((await call('GET', '/yo').then((r) => r.json())).usuario.avisos_por_correo, null);

  const { pendiente } = await diego.data('POST', '', { texto: 'Facturación <octubre>', perfil_id: favio.perfil.id });
  await diego.data('POST', `/${pendiente.id}/comentarios`, { texto: '@Favio revisa el total & avísame' });

  // Antes de una hora no se manda nada; después, un solo correo con los dos avisos (lo más nuevo primero).
  await vuelta(30);
  assert.equal(enviados.length, 0);
  await vuelta(61);
  assert.equal(enviados.length, 1);
  const [primero] = enviados;
  assert.equal(primero.to, 'favio@ejemplo.com');
  assert.equal(primero.subject, 'Tienes 2 avisos sin ver en Pendientes');
  const enlace = `https://tablero.ejemplo/pendientes/?p=${pendiente.id}`;
  for (const parte of ['Hola, Favio:', '• Diego te mencionó en «Facturación <octubre>»', '> @Favio revisa el total & avísame',
    '• Diego creó «Facturación <octubre>» y te lo asignó', enlace, 'Abrir el tablero: https://tablero.ejemplo/pendientes/', 'Avisos por correo']) {
    assert.ok(primero.text.includes(parte), parte);
  }
  assert.ok(primero.text.indexOf('te mencionó') < primero.text.indexOf('te lo asignó'));
  assert.ok(primero.html.includes('Facturación &lt;octubre&gt;') && !primero.html.includes('<octubre>'));
  assert.ok(primero.html.includes(`href="${enlace}"`));
  // Lo que ya llegó por correo no se repite.
  await vuelta(70);
  assert.equal(enviados.length, 1);

  // Lo nuevo espera al menos 4 horas desde el último correo, y si falla el envío se reintenta en la vuelta siguiente.
  await diego.data('POST', `/${pendiente.id}/comentarios`, { texto: '¿Lo viste, @Favio?' });
  await vuelta(130);
  assert.equal(enviados.length, 1);
  fallar = true;
  await vuelta(305);
  assert.equal(enviados.length, 1);
  fallar = false;
  await vuelta(310);
  assert.equal(enviados.length, 2);
  assert.equal(enviados[1].subject, 'Diego te mencionó en «Facturación <octubre>»');
  assert.ok(!enviados[1].text.includes('te lo asignó'));

  // Lo que ya vio no se manda.
  await diego.data('POST', `/${pendiente.id}/comentarios`, { texto: 'Otra cosa, @Favio' });
  await favio.call('POST', '/notificaciones/leidas', {});
  await vuelta(600);
  assert.equal(enviados.length, 2);

  // Apagado no le llega nada; tampoco a la cuenta del equipo, que no es un perfil.
  assert.equal((await favio.call('PUT', '/yo/avisos-por-correo', { activo: 'no' })).status, 422);
  assert.deepEqual(await favio.data('PUT', '/yo/avisos-por-correo', { activo: false }), { activo: false });
  assert.equal((await call('PUT', '/yo/avisos-por-correo', { activo: false })).status, 404);
  assert.deepEqual(await yo(favio), { activo: false, correo: 'favio@ejemplo.com' });
  await diego.data('POST', `/${pendiente.id}/comentarios`, { texto: 'Y otra, @Favio' });
  await vuelta(900);
  assert.equal(enviados.length, 2);
  // Al volver a encenderlo, lo de hace más de 3 días ya no se manda.
  await favio.data('PUT', '/yo/avisos-por-correo', { activo: true });
  await vuelta(4 * 24 * 60);
  assert.equal(enviados.length, 2);
  await vuelta(1000);
  assert.equal(enviados.length, 3);
});

test('avisos por correo: sin configurar no se mandan ni aparecen', async (t) => {
  const { call, entrarComo } = await startServer(t);
  const favio = await entrarComo('Favio');
  assert.equal((await favio.data('GET', '/yo')).usuario.avisos_por_correo, null);
  assert.equal((await favio.call('PUT', '/yo/avisos-por-correo', { activo: false })).status, 404);
  assert.ok(call);
});

test('IA: en una nota redacta como apuntes del curso, y solo en las notas propias', async (t) => {
  const pedidos = [];
  const proveedor = await startProveedor(t, async (ruta, cuerpo) => {
    pedidos.push(cuerpo);
    const texto = cuerpo.input.includes('largo') ? 'x'.repeat(9000) : '## Integración por partes\n\n- Se elige **u** y dv.';
    return { json: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ texto }) }] }] } };
  });
  const { data, diego, favio, junior } = await conNotas(t, { basesIA: { gemini: proveedor.url } });
  await data('PUT', '/ia', { proveedor: 'gemini', claves: { gemini: 'AIza-falsa-notas' } });
  const { curso } = await diego.data('POST', '/notas/cursos', { nombre: 'Cálculo II' });
  const { nota } = await diego.data('POST', `/notas/cursos/${curso.id}/notas`, { titulo: 'Integrales' });
  await diego.data('PATCH', `/notas/${nota.id}`, { contenido: documento('Hoy vimos sustitución.') });

  const { redaccion } = await diego.data('POST', '/ia/redactar', { texto: 'resume integracion por partes', donde: 'nota', nota_id: nota.id });
  assert.equal(redaccion.texto, '## Integración por partes\n\n- Se elige **u** y dv.');
  const [pedido] = pedidos;
  assert.equal(pedido.input, 'resume integracion por partes');
  for (const parte of ['apuntes de estudio', 'Curso: Cálculo II', 'Nota: Integrales', 'La nota hasta ahora (el principio): Hoy vimos sustitución.']) {
    assert.ok(pedido.system_instruction.includes(parte), parte);
  }
  assert.ok(!/Personas:|diego@ejemplo/.test(pedido.system_instruction));
  assert.equal((await diego.data('POST', '/ia/redactar', { texto: 'algo largo', donde: 'nota', nota_id: nota.id })).redaccion.texto.length, 8000);

  assert.equal((await favio.call('POST', '/ia/redactar', { texto: 'hola', donde: 'nota', nota_id: nota.id })).status, 404);
  assert.equal((await junior.call('POST', '/ia/redactar', { texto: 'hola', donde: 'nota', nota_id: nota.id })).status, 404);
  assert.equal((await data('POST', '/ia/redactar', { texto: 'hola', donde: 'nota', nota_id: nota.id })).error, 'not_found');
  assert.equal((await diego.data('POST', '/ia/redactar', { texto: 'hola', donde: 'nota' })).error, 'nota_id_invalido');
  assert.equal(pedidos.length, 2);
});
