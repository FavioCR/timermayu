import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { instruccionesIA, instruccionesTipo, listarModelos, MAX_SUGERENCIAS, pedirPendientes, pedirTipo, PROVEEDORES_IA } from './ia.mjs';

// Alcanza para el orden completo del tablero (hasta 5000 pendientes de ~60 bytes cada uno).
const MAX_BODY_BYTES = 512 * 1024;
// "Crear con IA" puede llevar imágenes (en base64): hasta 6 y 7 MB entre todas, bajo los 11 MB que deja pasar nginx.
const MAX_BODY_IA_BYTES = 10 * 1024 * 1024;
const MAX_IMAGENES_IA = 6;
const MAX_BYTES_IMAGENES_IA = 7 * 1024 * 1024;
// Los formatos que aceptan los tres proveedores.
const TIPOS_IMAGEN_IA = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGEN_BYTES = 10 * 1024 * 1024;
const MAX_TEXTO = 500;
const MAX_PROYECTO = 60;
const MAX_NOMBRE = 40;
const MAX_CORREO = 120;
const MAX_COMENTARIO = 2000;
const MAX_ARCHIVO_BYTES = 10 * 1024 * 1024;
const MAX_NOMBRE_ARCHIVO = 120;
const MAX_ADJUNTOS = 10;
const MAX_NOTA = 500;
// Lo que se sube para un mensaje y no se llega a enviar se borra pasado un día.
const VIDA_BORRADOR_MS = 24 * 60 * 60 * 1000;
const MAX_MIEMBROS = 100;
// Lo que se guarda de un mensaje en el historial y en los avisos.
const MAX_EXTRACTO = 140;
const MAX_DESCRIPCION = 400 * 1024;
const MAX_RESUMEN = 200;
const MIN_CONTRASENA = 8;
const MAX_CONTRASENA = 200;
// Lo que se le puede pasar a la IA de una vez y las indicaciones propias del equipo.
const MAX_TEXTO_IA = 20000;
const MAX_INSTRUCCIONES_IA = 2000;
const MAX_CLAVE_IA = 500;
const MAX_MODELO_IA = 200;
const MAX_ETIQUETA = 40;
const MAX_ETIQUETAS_POR_PENDIENTE = 20;
// Cambios en tiempo real: nginx corta una respuesta que pasa 12 s sin datos, así que el flujo manda un latido antes.
const LATIDO_MS = 9000;
const MAX_CONEXIONES = 500;
// Tras tantos intentos fallidos seguidos con un mismo usuario, se rechaza ese usuario durante la ventana.
const MAX_FALLOS = 10;
const VENTANA_FALLOS_MS = 15 * 60 * 1000;
// Una imagen que ya no aparece en la descripción se borra pasado este tiempo, para no
// pisar una subida en curso cuyo bloque todavía no llegó a guardarse.
const GRACIA_IMAGENES_MS = 60 * 60 * 1000;
// La descripción se guarda sola mientras se escribe: si la misma persona sigue editando dentro de
// este tiempo, el historial actualiza su última entrada en vez de sumar una nueva.
const UNIR_DESCRIPCION_MS = 10 * 60 * 1000;
const ESTADOS = ['pendiente', 'haciendo', 'hecho'];
// El tipo de trabajo, como en los commits convencionales.
export const TIPOS = ['feat', 'fix', 'refactor', 'perf', 'docs', 'test', 'style', 'chore', 'ci'];
const COLORES = ['#2563EB', '#DB2777', '#059669', '#7C3AED', '#EA580C', '#0891B2', '#CA8A04', '#DC2626'];
const PERFILES_INICIALES = ['Favio', 'Diego', 'Junior'];
const UUID = '([0-9a-f-]{36})';
const API_PATH = '/api/pendientes';
const ORDER_PATH = '/api/pendientes/orden';
const YO_PATH = '/api/pendientes/yo';
const PERFILES_PATH = '/api/pendientes/perfiles';
const ORGANIZACIONES_PATH = '/api/pendientes/organizaciones';
const PROYECTOS_PATH = '/api/pendientes/proyectos';
const ACTIVIDAD_PATH = '/api/pendientes/actividad';
const NOTIFICACIONES_PATH = '/api/pendientes/notificaciones';
const LEIDAS_PATH = '/api/pendientes/notificaciones/leidas';
const IA_PATH = '/api/pendientes/ia';
const IA_MODELOS_PATH = '/api/pendientes/ia/modelos';
const IA_SUGERIR_PATH = '/api/pendientes/ia/sugerir';
const ETIQUETAS_PATH = '/api/pendientes/etiquetas';
const EVENTOS_PATH = '/api/pendientes/eventos';
const ITEM_PATH = new RegExp(`^/api/pendientes/${UUID}$`);
const PERFIL_PATH = new RegExp(`^/api/pendientes/perfiles/${UUID}$`);
const CONTRASENA_PATH = new RegExp(`^/api/pendientes/perfiles/${UUID}/contrasena$`);
const ORGANIZACION_PATH = new RegExp(`^/api/pendientes/organizaciones/${UUID}$`);
const PROYECTO_PATH = new RegExp(`^/api/pendientes/proyectos/${UUID}$`);
const SUBIR_IMAGEN_PATH = new RegExp(`^/api/pendientes/${UUID}/imagenes$`);
const IMAGEN_PATH = new RegExp(`^/api/pendientes/imagenes/${UUID}$`);
const ACTIVIDAD_ITEM_PATH = new RegExp(`^/api/pendientes/${UUID}/actividad$`);
const COMENTARIOS_PATH = new RegExp(`^/api/pendientes/${UUID}/comentarios$`);
const COMENTARIO_PATH = new RegExp(`^/api/pendientes/comentarios/${UUID}$`);
const ARCHIVOS_PATH = new RegExp(`^/api/pendientes/${UUID}/archivos$`);
const ARCHIVO_PATH = new RegExp(`^/api/pendientes/archivos/${UUID}$`);
const TRASPASO_PATH = new RegExp(`^/api/pendientes/${UUID}/traspaso$`);
const ETIQUETA_PATH = new RegExp(`^/api/pendientes/etiquetas/${UUID}$`);
const RUTAS_FIJAS = [API_PATH, ORDER_PATH, YO_PATH, PERFILES_PATH, ORGANIZACIONES_PATH, PROYECTOS_PATH, ACTIVIDAD_PATH, NOTIFICACIONES_PATH, LEIDAS_PATH,
  IA_PATH, IA_MODELOS_PATH, IA_SUGERIR_PATH, ETIQUETAS_PATH, EVENTOS_PATH];
const RUTAS_CON_ID = [ITEM_PATH, PERFIL_PATH, CONTRASENA_PATH, ORGANIZACION_PATH, PROYECTO_PATH, SUBIR_IMAGEN_PATH, IMAGEN_PATH,
  ACTIVIDAD_ITEM_PATH, COMENTARIOS_PATH, COMENTARIO_PATH, ARCHIVOS_PATH, ARCHIVO_PATH, TRASPASO_PATH, ETIQUETA_PATH];
const COLUMNAS_PENDIENTE = `id, texto, proyecto_id, estado, tipo, perfil_id, creado_por, resumen, num_imagenes, creado_en, actualizado_en, hecho_en,
  (SELECT COUNT(*) FROM comentarios c WHERE c.pendiente_id = pendientes.id) AS num_comentarios,
  (SELECT COUNT(*) FROM archivos a WHERE a.pendiente_id = pendientes.id AND a.borrador = 0) AS num_archivos,
  (SELECT json_group_array(pe.etiqueta_id) FROM pendiente_etiquetas pe WHERE pe.pendiente_id = pendientes.id) AS etiquetas`;
const SELECT_PERFIL = 'SELECT id, nombre, correo, telefono, color, password_hash IS NOT NULL AS tiene_contrasena, creado_en FROM perfiles';
const SELECT_ORGANIZACION = `SELECT id, nombre, color, duenio_id, compartida, creado_en,
  (SELECT json_group_array(perfil_id) FROM organizacion_miembros m WHERE m.organizacion_id = organizaciones.id) AS miembros FROM organizaciones`;
const SELECT_PROYECTO = 'SELECT id, nombre, organizacion_id, creado_en FROM proyectos';

// Lo privado de una organización (sus proyectos y los pendientes de esos proyectos) solo lo ve su dueño.
// El único parámetro es el perfil que pregunta (NULL para la cuenta del equipo, que solo ve lo compartido).
const PROYECTOS_VISIBLES = `SELECT pr.id FROM proyectos pr LEFT JOIN organizaciones o ON o.id = pr.organizacion_id
  WHERE pr.organizacion_id IS NULL OR o.compartida = 1 OR o.duenio_id = ?`;
const PENDIENTE_VISIBLE = `(proyecto_id IS NULL OR proyecto_id IN (${PROYECTOS_VISIBLES}))`;
// El historial de un pendiente se ve si se ve el pendiente. El de uno ya borrado guarda en privado_de
// al dueño de la organización privada en la que estaba (o NULL si lo veía todo el equipo).
// Lleva dos parámetros, los dos el perfil que pregunta.
const ACTIVIDAD_VISIBLE = `(a.pendiente_id IN (SELECT id FROM pendientes WHERE ${PENDIENTE_VISIBLE})
  OR (a.pendiente_id IS NULL AND (a.privado_de IS NULL OR a.privado_de = ?)))`;
const SELECT_ACTIVIDAD = 'SELECT a.id, a.pendiente_id, a.texto_pendiente, a.perfil_id, a.autor, a.tipo, a.datos, a.creado_en FROM actividad a';
const SELECT_COMENTARIO = 'SELECT id, pendiente_id, perfil_id, autor, texto, respuesta_a, creado_en FROM comentarios';
const SELECT_ARCHIVO = 'SELECT id, pendiente_id, comentario_id, nombre, tipo, tamano, perfil_id, autor, creado_en FROM archivos';

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
  // Descripción (documento del editor en JSON) e imágenes pegadas o subidas en ella.
  (db) => {
    db.exec(`
      ALTER TABLE pendientes ADD COLUMN descripcion TEXT;
      ALTER TABLE pendientes ADD COLUMN resumen TEXT;
      ALTER TABLE pendientes ADD COLUMN num_imagenes INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE imagenes (
        id TEXT PRIMARY KEY,
        pendiente_id TEXT NOT NULL REFERENCES pendientes(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL,
        tamano INTEGER NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX imagenes_pendiente ON imagenes (pendiente_id);
    `);
  },
  // Contraseña y correo (opcional) por perfil, organizaciones (privadas o compartidas) y proyectos dentro de ellas.
  // Los proyectos que eran texto libre pasan a ser proyectos sin organización.
  (db) => {
    db.exec(`
      ALTER TABLE perfiles ADD COLUMN password_hash TEXT;
      ALTER TABLE perfiles ADD COLUMN correo TEXT;
      CREATE UNIQUE INDEX perfiles_correo ON perfiles (lower(correo)) WHERE correo IS NOT NULL;
      CREATE TABLE organizaciones (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL COLLATE NOCASE,
        color TEXT NOT NULL,
        duenio_id TEXT REFERENCES perfiles(id) ON DELETE SET NULL,
        compartida INTEGER NOT NULL DEFAULT 1 CHECK (compartida IN (0, 1)),
        creado_en TEXT NOT NULL,
        CHECK (compartida = 1 OR duenio_id IS NOT NULL)
      );
      CREATE UNIQUE INDEX organizaciones_nombre ON organizaciones (COALESCE(duenio_id, ''), nombre);
      CREATE TABLE proyectos (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL COLLATE NOCASE,
        organizacion_id TEXT REFERENCES organizaciones(id) ON DELETE CASCADE,
        creado_en TEXT NOT NULL
      );
      CREATE UNIQUE INDEX proyectos_nombre ON proyectos (COALESCE(organizacion_id, ''), nombre);
      ALTER TABLE pendientes ADD COLUMN proyecto_id TEXT REFERENCES proyectos(id) ON DELETE SET NULL;
      CREATE INDEX pendientes_proyecto ON pendientes (proyecto_id);
    `);
    const insertar = db.prepare('INSERT INTO proyectos (id, nombre, organizacion_id, creado_en) VALUES (?, ?, NULL, ?)');
    const asignar = db.prepare('UPDATE pendientes SET proyecto_id = ? WHERE proyecto = ?');
    const usados = db.prepare('SELECT proyecto, MIN(creado_en) AS desde FROM pendientes WHERE proyecto IS NOT NULL GROUP BY proyecto').all();
    for (const { proyecto, desde } of usados) {
      const id = randomUUID();
      insertar.run(id, proyecto, desde);
      asignar.run(id, proyecto);
    }
    db.exec('ALTER TABLE pendientes DROP COLUMN proyecto');
  },
  // Historial de cambios, chat por pendiente, avisos para cada perfil y teléfono para avisar por WhatsApp.
  (db) => {
    db.exec(`
      ALTER TABLE perfiles ADD COLUMN telefono TEXT;
      ALTER TABLE pendientes ADD COLUMN creado_por TEXT REFERENCES perfiles(id) ON DELETE SET NULL;
      CREATE TABLE actividad (
        id TEXT PRIMARY KEY,
        pendiente_id TEXT REFERENCES pendientes(id) ON DELETE SET NULL,
        texto_pendiente TEXT NOT NULL,
        perfil_id TEXT REFERENCES perfiles(id) ON DELETE SET NULL,
        autor TEXT NOT NULL,
        tipo TEXT NOT NULL,
        datos TEXT,
        privado_de TEXT,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX actividad_fecha ON actividad (creado_en);
      CREATE INDEX actividad_pendiente ON actividad (pendiente_id, creado_en);
      CREATE TABLE comentarios (
        id TEXT PRIMARY KEY,
        pendiente_id TEXT NOT NULL REFERENCES pendientes(id) ON DELETE CASCADE,
        perfil_id TEXT REFERENCES perfiles(id) ON DELETE SET NULL,
        autor TEXT NOT NULL,
        texto TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX comentarios_pendiente ON comentarios (pendiente_id, creado_en);
      CREATE TABLE notificaciones (
        id TEXT PRIMARY KEY,
        perfil_id TEXT NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
        actividad_id TEXT NOT NULL REFERENCES actividad(id) ON DELETE CASCADE,
        leida_en TEXT,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX notificaciones_perfil ON notificaciones (perfil_id, creado_en);
      CREATE INDEX notificaciones_actividad ON notificaciones (actividad_id);
    `);
  },
  // Involucrados de cada organización: en las compartidas, todos los perfiles que ya había; en las privadas, su dueño.
  (db) => {
    db.exec(`
      CREATE TABLE organizacion_miembros (
        organizacion_id TEXT NOT NULL REFERENCES organizaciones(id) ON DELETE CASCADE,
        perfil_id TEXT NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
        PRIMARY KEY (organizacion_id, perfil_id)
      );
      CREATE INDEX organizacion_miembros_perfil ON organizacion_miembros (perfil_id);
      INSERT INTO organizacion_miembros (organizacion_id, perfil_id)
        SELECT o.id, p.id FROM organizaciones o JOIN perfiles p ON o.compartida = 1 OR p.id = o.duenio_id;
    `);
  },
  // Archivos adjuntos (PDF y cualquier otro) en cada pendiente o en un mensaje de su chat. Viven en DATA_DIR/archivos.
  // `borrador` marca lo subido para un mensaje que todavía no se envía.
  (db) => {
    db.exec(`
      CREATE TABLE archivos (
        id TEXT PRIMARY KEY,
        pendiente_id TEXT NOT NULL REFERENCES pendientes(id) ON DELETE CASCADE,
        comentario_id TEXT REFERENCES comentarios(id) ON DELETE CASCADE,
        borrador INTEGER NOT NULL DEFAULT 0,
        nombre TEXT NOT NULL,
        tipo TEXT NOT NULL,
        tamano INTEGER NOT NULL,
        perfil_id TEXT REFERENCES perfiles(id) ON DELETE SET NULL,
        autor TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX archivos_pendiente ON archivos (pendiente_id, creado_en);
      CREATE INDEX archivos_comentario ON archivos (comentario_id);
    `);
  },
  // Responder a un mensaje del chat, como en WhatsApp. Sin clave foránea: si el original se borra,
  // la respuesta sigue apuntándolo y el tablero muestra "Mensaje borrado".
  (db) => {
    db.exec('ALTER TABLE comentarios ADD COLUMN respuesta_a TEXT');
  },
  // Cuándo se terminó cada pendiente (el tablero solo muestra los hechos de la última semana), su tipo (feat, fix…),
  // etiquetas de todo el equipo (el sprint, por ejemplo) y los ajustes del equipo, como la IA que crea pendientes. A lo que ya estaba
  // hecho se le pone la fecha en que pasó a Hecho según el historial, o la de su último cambio.
  (db) => {
    db.exec(`
      ALTER TABLE pendientes ADD COLUMN hecho_en TEXT;
      ALTER TABLE pendientes ADD COLUMN tipo TEXT;
      UPDATE pendientes SET hecho_en = COALESCE(
        (SELECT MAX(a.creado_en) FROM actividad a
          WHERE a.pendiente_id = pendientes.id AND a.tipo = 'estado' AND json_extract(a.datos, '$.a') = 'hecho'),
        actualizado_en)
      WHERE estado = 'hecho';
      CREATE TABLE ajustes (
        clave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      );
      CREATE TABLE etiquetas (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
        color TEXT NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE TABLE pendiente_etiquetas (
        pendiente_id TEXT NOT NULL REFERENCES pendientes(id) ON DELETE CASCADE,
        etiqueta_id TEXT NOT NULL REFERENCES etiquetas(id) ON DELETE CASCADE,
        PRIMARY KEY (pendiente_id, etiqueta_id)
      );
      CREATE INDEX pendiente_etiquetas_etiqueta ON pendiente_etiquetas (etiqueta_id);
    `);
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

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, maximo = MAX_BODY_BYTES) {
  const input = JSON.parse((await readBody(req, maximo)).toString('utf8') || '{}');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'invalid_json');
  return input;
}

function leerBasic(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  return { usuario: decoded.slice(0, separator), contrasena: decoded.slice(separator + 1), huella: createHash('sha256').update(header).digest('hex') };
}

const scryptAsync = promisify(scrypt);

export async function hashearContrasena(contrasena) {
  const sal = randomBytes(16);
  const hash = await scryptAsync(contrasena, sal, 64);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

async function verificarContrasena(contrasena, guardada) {
  const [tipo, salHex, hashHex] = guardada.split('$');
  if (tipo !== 'scrypt' || !salHex || !hashHex) return false;
  const hash = await scryptAsync(contrasena, Buffer.from(salHex, 'hex'), 64);
  return timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// Se mira el contenido, no el Content-Type: solo formatos de imagen que el navegador no ejecuta (nada de SVG).
export function tipoDeImagen(buffer) {
  const ascii = (inicio, fin) => buffer.subarray(inicio, fin).toString('latin1');
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Las imágenes y los PDF se pueden mostrar en el navegador; cualquier otra cosa se guarda tal cual y solo se descarga.
export function tipoDeArchivo(buffer) {
  if (tipoDeImagen(buffer)) return tipoDeImagen(buffer);
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return 'application/octet-stream';
}

// El nombre viaja en una cabecera, codificado con encodeURIComponent. Se queda solo con el nombre, sin carpetas.
export function nombreDeArchivo(cabecera) {
  let nombre = '';
  try {
    nombre = decodeURIComponent(String(cabecera ?? ''));
  } catch {
    throw httpError(422, 'nombre_archivo_invalido');
  }
  nombre = nombre.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (nombre.length > MAX_NOMBRE_ARCHIVO) {
    const punto = nombre.lastIndexOf('.');
    const extension = punto > 0 && nombre.length - punto <= 10 ? nombre.slice(punto) : '';
    nombre = nombre.slice(0, MAX_NOMBRE_ARCHIVO - extension.length) + extension;
  }
  return nombre || 'archivo';
}

// Texto plano para la vista previa de la tarjeta y cantidad de imágenes del documento del editor.
export function resumirDescripcion(bloques) {
  const textos = [];
  let imagenes = 0;
  const visitar = (nodo) => {
    if (Array.isArray(nodo)) return nodo.forEach(visitar);
    if (!nodo || typeof nodo !== 'object') return;
    if (nodo.type === 'image' && nodo.props?.url) imagenes++;
    if (typeof nodo.text === 'string') textos.push(nodo.text);
    if (nodo.type === 'mencion' && nodo.props?.nombre) textos.push(`@${nodo.props.nombre}`);
    for (const hijo of [nodo.content, nodo.children, nodo.rows, nodo.cells]) visitar(hijo);
  };
  visitar(bloques);
  const resumen = textos.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_RESUMEN);
  return { resumen: resumen || null, num_imagenes: imagenes };
}

// Los perfiles mencionados con @ en la descripción (el contenido "mencion" del editor guarda su id).
export function mencionesDeDescripcion(descripcion) {
  const ids = new Set();
  const visitar = (nodo) => {
    if (Array.isArray(nodo)) return nodo.forEach(visitar);
    if (!nodo || typeof nodo !== 'object') return;
    if (nodo.type === 'mencion' && typeof nodo.props?.id === 'string' && nodo.props.id) ids.add(nodo.props.id);
    for (const hijo of [nodo.content, nodo.children, nodo.rows, nodo.cells]) visitar(hijo);
  };
  if (descripcion) visitar(JSON.parse(descripcion));
  return ids;
}

function idOpcional(input, campo, error) {
  if (input[campo] !== null && typeof input[campo] !== 'string') throw httpError(422, error);
  return input[campo] || null;
}

function nombreValido(valor, maximo, error) {
  const nombre = typeof valor === 'string' ? valor.trim() : '';
  if (!nombre || nombre.length > maximo) throw httpError(422, error);
  return nombre;
}

function colorValido(color) {
  if (color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(color)) throw httpError(422, 'color_invalido');
  return color;
}

export function parsePendiente(input, { partial = false } = {}) {
  const changes = {};
  if (!partial || 'texto' in input) changes.texto = nombreValido(input.texto, MAX_TEXTO, 'texto_invalido');
  if ('proyecto_id' in input) changes.proyecto_id = idOpcional(input, 'proyecto_id', 'proyecto_invalido');
  if ('estado' in input) {
    if (!ESTADOS.includes(input.estado)) throw httpError(422, 'estado_invalido');
    changes.estado = input.estado;
  }
  if ('perfil_id' in input) changes.perfil_id = idOpcional(input, 'perfil_id', 'perfil_invalido');
  if ('tipo' in input) {
    if (input.tipo !== null && !TIPOS.includes(input.tipo)) throw httpError(422, 'tipo_invalido');
    changes.tipo = input.tipo;
  }
  if ('etiquetas' in input) {
    const { etiquetas } = input;
    if (!Array.isArray(etiquetas) || etiquetas.length > MAX_ETIQUETAS_POR_PENDIENTE || etiquetas.some((id) => typeof id !== 'string' || id.length > 64)) {
      throw httpError(422, 'etiquetas_invalidas');
    }
    changes.etiquetas = [...new Set(etiquetas)];
  }
  if ('descripcion' in input) {
    if (input.descripcion !== null) {
      if (typeof input.descripcion !== 'string' || input.descripcion.length > MAX_DESCRIPCION) throw httpError(422, 'descripcion_invalida');
      let bloques;
      try { bloques = JSON.parse(input.descripcion); } catch { throw httpError(422, 'descripcion_invalida'); }
      if (!Array.isArray(bloques)) throw httpError(422, 'descripcion_invalida');
    }
    changes.descripcion = input.descripcion;
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

// El correo es opcional: vacío o null lo deja sin correo.
export function parsePerfil(input, { partial = false } = {}) {
  const changes = {};
  if (!partial || 'nombre' in input) changes.nombre = nombreValido(input.nombre, MAX_NOMBRE, 'nombre_invalido');
  if ('color' in input) changes.color = colorValido(input.color);
  if ('correo' in input) {
    if (input.correo !== null && typeof input.correo !== 'string') throw httpError(422, 'correo_invalido');
    const correo = (input.correo ?? '').trim();
    if (correo && (correo.length > MAX_CORREO || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo))) throw httpError(422, 'correo_invalido');
    changes.correo = correo || null;
  }
  // Con código de país, como lo pide wa.me: se guardan solo los dígitos.
  if ('telefono' in input) {
    if (input.telefono !== null && typeof input.telefono !== 'string') throw httpError(422, 'telefono_invalido');
    const crudo = (input.telefono ?? '').trim();
    const digitos = crudo.replace(/[\s().-]/g, '').replace(/^(\+|00)/, '');
    if (crudo && !/^\d{10,15}$/.test(digitos)) throw httpError(422, 'telefono_invalido');
    changes.telefono = crudo ? digitos : null;
  }
  return changes;
}

// Un mensaje lleva texto, archivos ya subidos para él, o las dos cosas; puede responder a otro mensaje.
export function parseComentario(input) {
  const texto = typeof input.texto === 'string' ? input.texto.trim() : '';
  const archivos = input.archivos ?? [];
  if (!Array.isArray(archivos) || archivos.length > MAX_ADJUNTOS || archivos.some((id) => typeof id !== 'string')) {
    throw httpError(422, 'archivos_invalidos');
  }
  if ((!texto && archivos.length === 0) || texto.length > MAX_COMENTARIO) throw httpError(422, 'comentario_invalido');
  const respuestaA = input.respuesta_a ?? null;
  if (respuestaA !== null && (typeof respuestaA !== 'string' || !respuestaA)) throw httpError(422, 'respuesta_invalida');
  return { texto, archivos: [...new Set(archivos)], respuesta_a: respuestaA };
}

// Pasar un pendiente a otra persona: vuelve a Por hacer con su nuevo responsable y, si se quiere, una nota de lo que le toca.
export function parseTraspaso(input) {
  if (typeof input.perfil_id !== 'string' || !input.perfil_id) throw httpError(422, 'perfil_invalido');
  const nota = typeof input.nota === 'string' ? input.nota.trim() : '';
  if (input.nota !== undefined && input.nota !== null && typeof input.nota !== 'string') throw httpError(422, 'nota_invalida');
  if (nota.length > MAX_NOTA) throw httpError(422, 'nota_invalida');
  return { perfil_id: input.perfil_id, nota: nota || null };
}

// Sin ids marca todos los avisos como leídos.
export function parseLeidas(input) {
  if (input.ids === undefined) return null;
  if (!Array.isArray(input.ids) || input.ids.length > 500 || input.ids.some((id) => typeof id !== 'string')) throw httpError(422, 'ids_invalidos');
  return input.ids;
}

export function parseContrasena(input) {
  const { contrasena } = input;
  if (typeof contrasena !== 'string' || contrasena.length < MIN_CONTRASENA || contrasena.length > MAX_CONTRASENA) {
    throw httpError(422, 'contrasena_invalida');
  }
  return contrasena;
}

export function parseOrganizacion(input, { partial = false } = {}) {
  const changes = {};
  if (!partial || 'nombre' in input) changes.nombre = nombreValido(input.nombre, MAX_NOMBRE, 'nombre_invalido');
  if ('color' in input) changes.color = colorValido(input.color);
  if ('compartida' in input) {
    if (typeof input.compartida !== 'boolean') throw httpError(422, 'compartida_invalida');
    changes.compartida = input.compartida;
  }
  if ('miembros' in input) {
    const { miembros } = input;
    if (!Array.isArray(miembros) || miembros.length > MAX_MIEMBROS || miembros.some((id) => typeof id !== 'string' || id.length > 64)) {
      throw httpError(422, 'miembros_invalidos');
    }
    changes.miembros = [...new Set(miembros)];
  }
  return changes;
}

export function parseEtiqueta(input, { partial = false } = {}) {
  const changes = {};
  if (!partial || 'nombre' in input) changes.nombre = nombreValido(input.nombre, MAX_ETIQUETA, 'nombre_invalido');
  if ('color' in input) changes.color = colorValido(input.color);
  return changes;
}

export function parseProyecto(input, { partial = false } = {}) {
  const changes = {};
  if (!partial || 'nombre' in input) changes.nombre = nombreValido(input.nombre, MAX_PROYECTO, 'nombre_invalido');
  if ('organizacion_id' in input) changes.organizacion_id = idOpcional(input, 'organizacion_id', 'organizacion_invalida');
  return changes;
}

// Cambios a la IA del equipo. Una clave solo se reemplaza si viene; null la borra (y en modelos, vuelve al de siempre).
export function parseAjustesIA(input) {
  const changes = {};
  if ('proveedor' in input) {
    if (input.proveedor !== null && !Object.hasOwn(PROVEEDORES_IA, input.proveedor)) throw httpError(422, 'proveedor_invalido');
    changes.proveedor = input.proveedor;
  }
  if ('instrucciones' in input) {
    const { instrucciones } = input;
    if (instrucciones !== null && (typeof instrucciones !== 'string' || instrucciones.length > MAX_INSTRUCCIONES_IA)) {
      throw httpError(422, 'instrucciones_invalidas');
    }
    changes.instrucciones = instrucciones?.trim() || null;
  }
  if ('tipo_automatico' in input) {
    if (typeof input.tipo_automatico !== 'boolean') throw httpError(422, 'tipo_automatico_invalido');
    changes.tipo_automatico = input.tipo_automatico;
  }
  for (const [campo, maximo, error] of [['modelos', MAX_MODELO_IA, 'modelo_invalido'], ['claves', MAX_CLAVE_IA, 'clave_invalida']]) {
    if (!(campo in input)) continue;
    const valores = input[campo];
    if (!valores || typeof valores !== 'object' || Array.isArray(valores)) throw httpError(422, error);
    changes[campo] = {};
    for (const [proveedor, valor] of Object.entries(valores)) {
      if (!Object.hasOwn(PROVEEDORES_IA, proveedor)) throw httpError(422, 'proveedor_invalido');
      // Ni los modelos ni las claves llevan espacios.
      if (valor !== null && (typeof valor !== 'string' || !/^\S+$/.test(valor.trim()) || valor.trim().length > maximo)) throw httpError(422, error);
      changes[campo][proveedor] = valor?.trim() ?? null;
    }
  }
  return changes;
}

// El texto puede faltar si vienen imágenes. Cada imagen es { datos } en base64; su tipo se mira en el contenido.
export function parseSugerencia(input) {
  const texto = typeof input.texto === 'string' ? input.texto.trim() : '';
  const lista = input.imagenes ?? [];
  if (!Array.isArray(lista) || lista.length > MAX_IMAGENES_IA) throw httpError(422, 'imagenes_ia_invalidas');
  let total = 0;
  const imagenes = lista.map((imagen) => {
    if (typeof imagen?.datos !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(imagen.datos)) throw httpError(422, 'imagenes_ia_invalidas');
    const contenido = Buffer.from(imagen.datos, 'base64');
    total += contenido.length;
    const tipo = tipoDeImagen(contenido);
    if (!TIPOS_IMAGEN_IA.includes(tipo)) throw httpError(422, 'imagenes_ia_invalidas');
    return { tipo, datos: imagen.datos };
  });
  if (total > MAX_BYTES_IMAGENES_IA) throw httpError(413, 'imagenes_ia_muy_grandes');
  if ((!texto && imagenes.length === 0) || texto.length > MAX_TEXTO_IA) throw httpError(422, 'texto_ia_invalido');
  return { texto, imagenes, proyecto_id: 'proyecto_id' in input ? idOpcional(input, 'proyecto_id', 'proyecto_invalido') : null };
}

// La clave con la que se listan los modelos: la que se está escribiendo (va en el cuerpo, no en la URL) o la guardada.
export function parsePedidoModelos(input) {
  if (!Object.hasOwn(PROVEEDORES_IA, input.proveedor)) throw httpError(422, 'proveedor_invalido');
  const { clave } = input;
  if (clave != null && (typeof clave !== 'string' || !/^\S+$/.test(clave.trim()) || clave.trim().length > MAX_CLAVE_IA)) {
    throw httpError(422, 'clave_invalida');
  }
  return { proveedor: input.proveedor, clave: clave?.trim() || null };
}

// Lo que se muestra de la IA: de cada clave, solo si hay una y sus últimos 4 caracteres.
export function iaPublica({ proveedor, instrucciones, tipo_automatico: tipoAutomatico, modelos, claves }) {
  return {
    proveedor,
    instrucciones,
    tipo_automatico: tipoAutomatico,
    lista: Boolean(proveedor && claves[proveedor]),
    proveedores: Object.entries(PROVEEDORES_IA).map(([id, { nombre, modelo }]) => ({
      id,
      nombre,
      modelo: modelos[id] ?? modelo,
      modelo_por_defecto: modelo,
      tiene_clave: Boolean(claves[id]),
      clave_final: claves[id] ? claves[id].slice(-4) : null,
    })),
  };
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
const perfilFila = (row) => (row ? { ...row, tiene_contrasena: Boolean(row.tiene_contrasena) } : null);
const organizacionFila = (row) => (row ? { ...row, compartida: Boolean(row.compartida), miembros: JSON.parse(row.miembros).sort() } : null);
const actividadFila = (row) => (row ? { ...row, datos: row.datos ? JSON.parse(row.datos) : null } : null);
const pendienteFila = (row) => (row ? { ...row, etiquetas: JSON.parse(row.etiquetas).sort() } : null);

// Proyecto sin organización con ese nombre; se crea si no existe.
function proyectoSuelto(db, nombre) {
  const existente = db.prepare('SELECT id FROM proyectos WHERE organizacion_id IS NULL AND nombre = ?').get(nombre);
  if (existente) return existente.id;
  const id = randomUUID();
  db.prepare('INSERT INTO proyectos (id, nombre, organizacion_id, creado_en) VALUES (?, ?, NULL, ?)').run(id, nombre, new Date().toISOString());
  return id;
}

// La primera versión guardaba todo en pendientes.json: se pasa a la base una sola vez.
function importarJson(db, dataDir) {
  const file = path.join(dataDir, 'pendientes.json');
  if (!existsSync(file)) return;
  const items = JSON.parse(readFileSync(file, 'utf8'));
  const insert = db.prepare(`INSERT OR IGNORE INTO pendientes (id, texto, proyecto_id, estado, perfil_id, posicion, creado_en, actualizado_en, hecho_en)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`);
  transaction(db, () => items.forEach((item, i) => {
    const proyecto = item.proyecto?.trim().toLowerCase();
    const estado = item.estado ?? 'pendiente';
    insert.run(item.id, item.texto, proyecto ? proyectoSuelto(db, proyecto) : null, estado, i, item.creado_en, item.actualizado_en,
      estado === 'hecho' ? item.actualizado_en : null);
  }));
  renameSync(file, `${file}.importado`);
}

export function openDb(dataDir) {
  mkdirSync(path.join(dataDir, 'imagenes'), { recursive: true });
  mkdirSync(path.join(dataDir, 'archivos'), { recursive: true });
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

// Todos los métodos que tocan pendientes, proyectos u organizaciones reciben `yo`: el id del perfil
// que pregunta, o null si entró con la cuenta del equipo. Lo que no puede ver se trata como inexistente.
function createRepo(db, dataDir, graciaImagenesMs) {
  const archivoDeImagen = (id) => path.join(dataDir, 'imagenes', id);
  const pendiente = (yo, id) => pendienteFila(db.prepare(`SELECT ${COLUMNAS_PENDIENTE} FROM pendientes WHERE id = ? AND ${PENDIENTE_VISIBLE}`).get(id, yo));
  const etiqueta = (id) => fila(db.prepare('SELECT id, nombre, color, creado_en FROM etiquetas WHERE id = ?').get(id));
  const perfil = (id) => perfilFila(db.prepare(`${SELECT_PERFIL} WHERE id = ?`).get(id));
  const organizacion = (yo, id) => organizacionFila(db.prepare(`${SELECT_ORGANIZACION} WHERE id = ? AND (compartida = 1 OR duenio_id = ?)`).get(id, yo));
  const proyecto = (yo, id) => fila(db.prepare(`${SELECT_PROYECTO} WHERE id = ? AND id IN (${PROYECTOS_VISIBLES})`).get(id, yo));

  // Si el pendiente está en una organización privada, el id de su dueño; si no, null.
  const privadoDe = (pendienteId) => db.prepare(`SELECT o.duenio_id FROM pendientes p JOIN proyectos pr ON pr.id = p.proyecto_id
    JOIN organizaciones o ON o.id = pr.organizacion_id WHERE p.id = ? AND o.compartida = 0`).get(pendienteId)?.duenio_id ?? null;

  // El historial guarda nombres y no solo ids: así se sigue leyendo aunque el perfil o el proyecto ya no existan.
  const nombreDePerfil = (id) => (id ? db.prepare('SELECT nombre FROM perfiles WHERE id = ?').get(id)?.nombre ?? null : null);
  function etiquetaDeProyecto(id) {
    const row = id && db.prepare('SELECT pr.nombre, o.nombre AS organizacion FROM proyectos pr LEFT JOIN organizaciones o ON o.id = pr.organizacion_id WHERE pr.id = ?').get(id);
    return row ? (row.organizacion ? `${row.organizacion} › ${row.nombre}` : row.nombre) : null;
  }

  // "@Diego" (sin importar mayúsculas) menciona a Diego; "@Diegoxx" no menciona a nadie.
  const mencionadosEn = (texto) => db.prepare('SELECT id, nombre FROM perfiles').all()
    .filter((p) => new RegExp(`@${p.nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu').test(texto))
    .map((p) => p.id);

  // Anota un cambio en el historial y avisa a los perfiles de `avisar`, salvo a quien lo hizo.
  // De un pendiente privado solo se avisa a su dueño, que es el único que lo ve.
  // La campana avisa por tres cosas: te asignan algo, te mencionan con @ (una vez por mención; responder a tu mensaje
  // cuenta como mencionarte) o alguien más cambia un pendiente que creaste.
  function registrar(quien, item, tipo, datos = null, avisar = []) {
    const id = randomUUID();
    const privado = privadoDe(item.id);
    const ahora = new Date().toISOString();
    db.prepare(`INSERT INTO actividad (id, pendiente_id, texto_pendiente, perfil_id, autor, tipo, datos, privado_de, creado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, item.id, item.texto, quien.perfil_id, quien.nombre, tipo, datos && JSON.stringify(datos), privado, ahora);
    const avisarA = db.prepare('INSERT INTO notificaciones (id, perfil_id, actividad_id, leida_en, creado_en) SELECT ?, id, ?, NULL, ? FROM perfiles WHERE id = ?');
    for (const perfilId of new Set(avisar)) {
      if (perfilId && perfilId !== quien.perfil_id && (!privado || perfilId === privado)) avisarA.run(randomUUID(), id, ahora, perfilId);
    }
  }

  // Si la descripción nueva menciona a alguien que antes no estaba, se le avisa (una entrada propia en el historial);
  // si no, se anota como una edición más.
  function anotarDescripcion(quien, item, antes = null, despues = null) {
    const nuevas = [...mencionesDeDescripcion(despues)]
      .filter((id) => !mencionesDeDescripcion(antes).has(id) && id !== quien.perfil_id && perfil(id));
    if (nuevas.length > 0) return registrar(quien, item, 'descripcion', { menciones: nuevas }, [...nuevas, item.creado_por]);
    anotarEdicion(quien, item);
  }

  // Varias ediciones seguidas de la misma persona quedan en una sola entrada (no en la de una mención, que es un aviso).
  function anotarEdicion(quien, item) {
    const ultima = db.prepare('SELECT id, perfil_id, autor, tipo, datos, creado_en FROM actividad WHERE pendiente_id = ? ORDER BY creado_en DESC, rowid DESC LIMIT 1')
      .get(item.id);
    if (ultima?.tipo === 'descripcion' && !ultima.datos && ultima.perfil_id === quien.perfil_id && ultima.autor === quien.nombre
      && Date.now() - Date.parse(ultima.creado_en) < UNIR_DESCRIPCION_MS) {
      db.prepare('UPDATE actividad SET creado_en = ?, texto_pendiente = ? WHERE id = ?').run(new Date().toISOString(), item.texto, ultima.id);
    } else {
      registrar(quien, item, 'descripcion', null, [item.creado_por]);
    }
  }

  // Cada cambio le avisa a quien lo creó; al reasignar, también a quien lo recibe.
  function anotarCambios(quien, antes, despues, changes) {
    const interesados = [despues.creado_por];
    if (despues.texto !== antes.texto) registrar(quien, despues, 'texto', { de: antes.texto, a: despues.texto }, interesados);
    if (despues.estado !== antes.estado) registrar(quien, despues, 'estado', { de: antes.estado, a: despues.estado }, interesados);
    if (despues.perfil_id !== antes.perfil_id) {
      registrar(quien, despues, 'asignado', { de: nombreDePerfil(antes.perfil_id), a: nombreDePerfil(despues.perfil_id), a_id: despues.perfil_id },
        [despues.perfil_id, despues.creado_por]);
    }
    if (despues.proyecto_id !== antes.proyecto_id) {
      registrar(quien, despues, 'proyecto', { de: etiquetaDeProyecto(antes.proyecto_id), a: etiquetaDeProyecto(despues.proyecto_id) }, interesados);
    }
    if ('descripcion' in changes && changes.descripcion !== antes.descripcion) anotarDescripcion(quien, despues, antes.descripcion, changes.descripcion);
    if (despues.tipo !== antes.tipo) registrar(quien, despues, 'tipo', { de: antes.tipo, a: despues.tipo }, interesados);
    const agregadas = despues.etiquetas.filter((id) => !antes.etiquetas.includes(id));
    const quitadas = antes.etiquetas.filter((id) => !despues.etiquetas.includes(id));
    if (agregadas.length || quitadas.length) {
      const nombres = (ids) => ids.map((id) => etiqueta(id)?.nombre).filter(Boolean);
      registrar(quien, despues, 'etiquetas', { agregadas: nombres(agregadas), quitadas: nombres(quitadas) }, interesados);
    }
  }

  // Las etiquetas de un pendiente se reemplazan completas. Los ids deben ser de etiquetas que existen.
  function ponerEtiquetas(pendienteId, etiquetas) {
    if (etiquetas.some((id) => !etiqueta(id))) throw httpError(422, 'etiquetas_invalidas');
    db.prepare('DELETE FROM pendiente_etiquetas WHERE pendiente_id = ?').run(pendienteId);
    const insertar = db.prepare('INSERT INTO pendiente_etiquetas (pendiente_id, etiqueta_id) VALUES (?, ?)');
    for (const etiquetaId of etiquetas) insertar.run(pendienteId, etiquetaId);
  }

  function verificarPerfil(perfilId) {
    if (perfilId && !perfil(perfilId)) throw httpError(422, 'perfil_invalido');
  }

  function verificarProyecto(yo, proyectoId) {
    if (proyectoId && !proyecto(yo, proyectoId)) throw httpError(422, 'proyecto_invalido');
  }

  function verificarOrganizacion(yo, organizacionId) {
    if (organizacionId && !organizacion(yo, organizacionId)) throw httpError(422, 'organizacion_invalida');
  }

  // Los involucrados de una organización (para filtrar y asignar). Los ids deben ser de perfiles que existen.
  function ponerMiembros(organizacionId, miembros) {
    const existentes = miembros.filter((id) => db.prepare('SELECT 1 FROM perfiles WHERE id = ?').get(id));
    if (existentes.length !== miembros.length) throw httpError(422, 'miembros_invalidos');
    db.prepare('DELETE FROM organizacion_miembros WHERE organizacion_id = ?').run(organizacionId);
    const insertar = db.prepare('INSERT INTO organizacion_miembros (organizacion_id, perfil_id) VALUES (?, ?)');
    for (const id of miembros) insertar.run(organizacionId, id);
  }

  // Nombre, color, privacidad y borrado de una organización son de su dueño; las del equipo (sin dueño), de todos.
  function administrable(yo, id) {
    const org = organizacion(yo, id);
    if (!org) return null;
    if (org.duenio_id !== null && org.duenio_id !== yo) throw httpError(403, 'solo_el_duenio');
    return org;
  }

  // Los índices únicos de nombre fallan con SQLITE_CONSTRAINT_UNIQUE; se traducen a 409.
  function sinDuplicados(error, trabajo) {
    try {
      return trabajo();
    } catch (fallo) {
      if (fallo.errcode === 2067 || /UNIQUE constraint failed/.test(fallo.message)) throw httpError(409, error);
      throw fallo;
    }
  }

  async function borrarArchivos(ids, ruta = archivoDeImagen) {
    await Promise.all(ids.map((id) => unlink(ruta(id)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    })));
  }

  const archivoSubido = (id) => path.join(dataDir, 'archivos', id);
  const borrarSubidos = (ids) => borrarArchivos(ids, archivoSubido);
  const esAutor = (quien, row) => (row.perfil_id ? row.perfil_id === quien.perfil_id : quien.perfil_id === null && row.autor === quien.nombre);

  // Archivos de un mensaje que nunca se envió.
  async function limpiarBorradores() {
    const limite = new Date(Date.now() - VIDA_BORRADOR_MS).toISOString();
    const viejos = db.prepare('SELECT id FROM archivos WHERE borrador = 1 AND creado_en < ?').all(limite).map((row) => row.id);
    const borrar = db.prepare('DELETE FROM archivos WHERE id = ?');
    for (const id of viejos) borrar.run(id);
    await borrarSubidos(viejos);
  }

  // Imágenes del pendiente que pasaron el tiempo de gracia y ya no aparecen en ninguna descripción
  // (un bloque copiado a otra tarjeta sigue usando el mismo archivo).
  async function limpiarImagenes(pendienteId) {
    const limite = new Date(Date.now() - graciaImagenesMs).toISOString();
    const enUso = db.prepare('SELECT 1 FROM pendientes WHERE instr(descripcion, ?) > 0 LIMIT 1');
    const sobrantes = db.prepare('SELECT id FROM imagenes WHERE pendiente_id = ? AND creado_en <= ?').all(pendienteId, limite)
      .map((row) => row.id)
      .filter((id) => !enUso.get(`${API_PATH}/imagenes/${id}`));
    const borrar = db.prepare('DELETE FROM imagenes WHERE id = ?');
    for (const id of sobrantes) borrar.run(id);
    await borrarArchivos(sobrantes);
  }

  return {
    // Etiquetas de todo el equipo, para marcar pendientes (el sprint, por ejemplo).
    listarEtiquetas: () => db.prepare('SELECT id, nombre, color, creado_en FROM etiquetas ORDER BY nombre, creado_en').all().map(fila),

    crearEtiqueta({ nombre, color }) {
      const { total } = db.prepare('SELECT COUNT(*) AS total FROM etiquetas').get();
      const id = randomUUID();
      sinDuplicados('etiqueta_duplicada', () => db.prepare('INSERT INTO etiquetas (id, nombre, color, creado_en) VALUES (?, ?, ?, ?)')
        .run(id, nombre, color ?? COLORES[total % COLORES.length], new Date().toISOString()));
      return etiqueta(id);
    },

    actualizarEtiqueta(id, changes) {
      if (!etiqueta(id)) return null;
      const campos = Object.keys(changes);
      if (campos.length) {
        sinDuplicados('etiqueta_duplicada', () => db.prepare(`UPDATE etiquetas SET ${campos.map((campo) => `${campo} = ?`).join(', ')} WHERE id = ?`)
          .run(...campos.map((campo) => changes[campo]), id));
      }
      return etiqueta(id);
    },

    // Se quita de todos los pendientes que la tenían (ON DELETE CASCADE).
    borrarEtiqueta: (id) => db.prepare('DELETE FROM etiquetas WHERE id = ?').run(id).changes > 0,

    // Para los cambios en tiempo real: de qué pendiente es un mensaje o un archivo, y si alguien puede ver un pendiente
    // (uno que ya no existe no guarda secretos).
    pendienteDeComentario: (id) => db.prepare('SELECT pendiente_id FROM comentarios WHERE id = ?').get(id)?.pendiente_id ?? null,
    pendienteDeArchivo: (id) => db.prepare('SELECT pendiente_id FROM archivos WHERE id = ?').get(id)?.pendiente_id ?? null,
    puedeVerPendiente: (yo, id) => !db.prepare('SELECT 1 FROM pendientes WHERE id = ?').get(id)
      || Boolean(db.prepare(`SELECT 1 FROM pendientes WHERE id = ? AND ${PENDIENTE_VISIBLE}`).get(id, yo)),

    // La IA del equipo. Las claves solo salen de aquí hacia el proveedor elegido.
    ajustesIA() {
      const guardado = db.prepare("SELECT valor FROM ajustes WHERE clave = 'ia'").get();
      const ajustes = guardado ? JSON.parse(guardado.valor) : {};
      return {
        proveedor: ajustes.proveedor ?? null,
        instrucciones: ajustes.instrucciones ?? null,
        // Si un pendiente se crea sin tipo, la IA se lo pone (salvo que el equipo lo apague).
        tipo_automatico: ajustes.tipo_automatico ?? true,
        modelos: ajustes.modelos ?? {},
        claves: ajustes.claves ?? {},
      };
    },

    tipoAutomatico() {
      const { proveedor, claves, tipo_automatico: tipoAutomatico } = this.ajustesIA();
      return Boolean(proveedor && claves[proveedor] && tipoAutomatico);
    },

    guardarAjustesIA(changes) {
      const actual = this.ajustesIA();
      const juntar = (antes, nuevos = {}) => Object.fromEntries(Object.entries({ ...antes, ...nuevos }).filter(([, valor]) => valor !== null));
      const nuevo = {
        proveedor: 'proveedor' in changes ? changes.proveedor : actual.proveedor,
        instrucciones: 'instrucciones' in changes ? changes.instrucciones : actual.instrucciones,
        tipo_automatico: 'tipo_automatico' in changes ? changes.tipo_automatico : actual.tipo_automatico,
        modelos: juntar(actual.modelos, changes.modelos),
        claves: juntar(actual.claves, changes.claves),
      };
      db.prepare("INSERT INTO ajustes (clave, valor) VALUES ('ia', ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor")
        .run(JSON.stringify(nuevo));
      return nuevo;
    },

    // Le pasa el texto (y las imágenes, si vienen) a la IA con los nombres de las personas y de los proyectos que ve
    // quien pregunta (sin correos ni teléfonos) y devuelve los pendientes que propone, sin crear nada: el tablero los
    // muestra para revisarlos.
    async sugerirPendientes(yo, { texto, imagenes = [], proyecto_id: proyectoId }, bases) {
      verificarProyecto(yo, proyectoId);
      const { proveedor, modelos, claves, instrucciones } = this.ajustesIA();
      if (!proveedor) throw httpError(422, 'ia_no_configurada');
      if (!claves[proveedor]) throw httpError(422, 'ia_sin_clave');
      const personas = db.prepare('SELECT id, nombre FROM perfiles ORDER BY creado_en, rowid').all();
      const proyectos = db.prepare(`SELECT id FROM proyectos WHERE id IN (${PROYECTOS_VISIBLES})`).all(yo)
        .map(({ id }) => ({ id, etiqueta: etiquetaDeProyecto(id) }))
        .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
      const etiquetas = this.listarEtiquetas();
      const sistema = instruccionesIA({
        personas: personas.map((p) => p.nombre),
        proyectos: proyectos.map((p) => p.etiqueta),
        etiquetas: etiquetas.map((e) => e.nombre),
        proyectoPorDefecto: proyectoId && etiquetaDeProyecto(proyectoId),
        extra: instrucciones,
        hoy: new Date().toLocaleDateString('es-CR', { timeZone: 'America/Costa_Rica', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      });
      const sugerencias = await pedirPendientes({
        proveedor,
        modelo: modelos[proveedor] ?? PROVEEDORES_IA[proveedor].modelo,
        clave: claves[proveedor],
        base: bases[proveedor],
        sistema,
        texto: texto || 'Saca los pendientes de las imágenes.',
        imagenes,
      });
      // La IA contesta con nombres: se pasan a ids. Un proyecto vale con su etiqueta completa o, si no se repite, solo con su nombre.
      const normal = (valor) => valor.trim().replace(/^@/, '').toLocaleLowerCase('es');
      const perfilDe = (nombre) => (nombre && personas.find((p) => normal(p.nombre) === normal(nombre))?.id) ?? null;
      const proyectoDe = (nombre) => {
        if (!nombre) return null;
        const exacto = proyectos.find((p) => normal(p.etiqueta) === normal(nombre));
        const porNombre = proyectos.filter((p) => normal(p.etiqueta.split(' › ').pop()) === normal(nombre));
        return exacto?.id ?? (porNombre.length === 1 ? porNombre[0].id : null);
      };
      return sugerencias.slice(0, MAX_SUGERENCIAS).map((sugerencia) => ({
        texto: sugerencia.titulo.slice(0, MAX_TEXTO),
        detalle: sugerencia.detalle,
        perfil_id: perfilDe(sugerencia.responsable),
        proyecto_id: proyectoDe(sugerencia.proyecto) ?? proyectoId,
        tipo: sugerencia.tipo,
        etiquetas: [...new Set(sugerencia.etiquetas.map((nombre) => etiquetas.find((e) => normal(e.nombre) === normal(nombre))?.id).filter(Boolean))],
        estado: sugerencia.estado,
      }));
    },

    // Le pide a la IA el tipo de un pendiente que se creó sin tipo. Solo viajan su título y su proyecto. Si mientras
    // tanto alguien le puso (o le quitó) el tipo a mano, la respuesta no lo pisa. Devuelve el tipo puesto, o null.
    async elegirTipo(id, bases) {
      const { proveedor, modelos, claves, instrucciones } = this.ajustesIA();
      const item = db.prepare('SELECT id, texto, proyecto_id, tipo FROM pendientes WHERE id = ?').get(id);
      if (!proveedor || !claves[proveedor] || !item || item.tipo) return null;
      const proyecto = etiquetaDeProyecto(item.proyecto_id);
      const tipo = await pedirTipo({
        proveedor,
        modelo: modelos[proveedor] ?? PROVEEDORES_IA[proveedor].modelo,
        clave: claves[proveedor],
        base: bases[proveedor],
        sistema: instruccionesTipo({ extra: instrucciones }),
        texto: [`Pendiente: ${item.texto}`, ...(proyecto ? [`Proyecto: ${proyecto}`] : [])].join('\n'),
      });
      if (!tipo) return null;
      return transaction(db, () => {
        const puesto = db.prepare(`UPDATE pendientes SET tipo = ? WHERE id = ? AND tipo IS NULL
          AND NOT EXISTS (SELECT 1 FROM actividad WHERE pendiente_id = ? AND tipo = 'tipo')`).run(tipo, id, id).changes > 0;
        if (!puesto) return null;
        const despues = db.prepare('SELECT id, texto FROM pendientes WHERE id = ?').get(id);
        registrar({ perfil_id: null, nombre: 'IA' }, despues, 'tipo', { de: null, a: tipo, ia: true });
        return tipo;
      });
    },

    listarPendientes: (yo) => db.prepare(`SELECT ${COLUMNAS_PENDIENTE} FROM pendientes WHERE ${PENDIENTE_VISIBLE} ORDER BY posicion, creado_en DESC`)
      .all(yo).map(pendienteFila),

    detallePendiente: (yo, id) => pendienteFila(db.prepare(`SELECT ${COLUMNAS_PENDIENTE}, descripcion FROM pendientes WHERE id = ? AND ${PENDIENTE_VISIBLE}`).get(id, yo)),

    // `quien` es { perfil_id, nombre } de quien hace el cambio, para el historial y los avisos.
    crearPendiente(quien, changes) {
      const yo = quien.perfil_id;
      verificarPerfil(changes.perfil_id);
      verificarProyecto(yo, changes.proyecto_id);
      const now = new Date().toISOString();
      const id = randomUUID();
      return transaction(db, () => {
        // Lo nuevo va arriba de todo.
        const { minimo } = db.prepare('SELECT COALESCE(MIN(posicion), 0) AS minimo FROM pendientes').get();
        const estado = changes.estado ?? 'pendiente';
        const descripcion = changes.descripcion ?? null;
        const { resumen = null, num_imagenes: numImagenes = 0 } = descripcion ? resumirDescripcion(JSON.parse(descripcion)) : {};
        db.prepare(`INSERT INTO pendientes (id, texto, proyecto_id, estado, tipo, perfil_id, creado_por, posicion, creado_en, actualizado_en, hecho_en,
            descripcion, resumen, num_imagenes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, changes.texto, changes.proyecto_id ?? null, estado, changes.tipo ?? null, changes.perfil_id ?? null, yo, minimo - 1, now, now,
            estado === 'hecho' ? now : null, descripcion, resumen, numImagenes);
        if (changes.etiquetas) ponerEtiquetas(id, changes.etiquetas);
        const creado = pendiente(yo, id);
        registrar(quien, creado, 'creado', {
          estado: creado.estado,
          asignado: nombreDePerfil(creado.perfil_id),
          asignado_id: creado.perfil_id,
          proyecto: etiquetaDeProyecto(creado.proyecto_id),
        }, [creado.perfil_id]);
        if (descripcion && mencionesDeDescripcion(descripcion).size > 0) anotarDescripcion(quien, creado, null, descripcion);
        return creado;
      });
    },

    async actualizarPendiente(quien, id, changes) {
      const yo = quien.perfil_id;
      const filaAntes = db.prepare(`SELECT texto, estado, tipo, perfil_id, proyecto_id, creado_por, descripcion FROM pendientes WHERE id = ? AND ${PENDIENTE_VISIBLE}`)
        .get(id, yo);
      if (!filaAntes) return null;
      const antes = { ...filaAntes, etiquetas: pendiente(yo, id).etiquetas };
      verificarPerfil(changes.perfil_id);
      verificarProyecto(yo, changes.proyecto_id);
      const now = new Date().toISOString();
      const { etiquetas, ...columnas } = changes;
      if ('estado' in changes && changes.estado !== antes.estado) columnas.hecho_en = changes.estado === 'hecho' ? now : null;
      if ('descripcion' in changes) {
        Object.assign(columnas, changes.descripcion === null
          ? { resumen: null, num_imagenes: 0 }
          : resumirDescripcion(JSON.parse(changes.descripcion)));
      }
      // Las columnas salen de parsePendiente, resumirDescripcion y hecho_en: solo campos conocidos.
      const campos = Object.keys(columnas);
      const actualizado = transaction(db, () => {
        db.prepare(`UPDATE pendientes SET ${[...campos.map((campo) => `${campo} = ?`), 'actualizado_en = ?'].join(', ')} WHERE id = ?`)
          .run(...campos.map((campo) => columnas[campo]), now, id);
        if (etiquetas) ponerEtiquetas(id, etiquetas);
        const despues = pendiente(yo, id);
        anotarCambios(quien, antes, despues, changes);
        return despues;
      });
      if ('descripcion' in changes) await limpiarImagenes(id);
      return actualizado;
    },

    async borrarPendiente(quien, id) {
      const actual = pendiente(quien.perfil_id, id);
      if (!actual) return false;
      const imagenes = db.prepare('SELECT id FROM imagenes WHERE pendiente_id = ?').all(id).map((row) => row.id);
      const subidos = db.prepare('SELECT id FROM archivos WHERE pendiente_id = ?').all(id).map((row) => row.id);
      transaction(db, () => {
        // Su historial queda con la privacidad que tenía al borrarse (ON DELETE SET NULL suelta el pendiente_id).
        db.prepare('UPDATE actividad SET privado_de = ? WHERE pendiente_id = ?').run(privadoDe(id), id);
        registrar(quien, actual, 'borrado', null, [actual.creado_por]);
        // ON DELETE CASCADE quita sus filas de imagenes, archivos y comentarios; lo guardado en disco se borra aparte.
        db.prepare('DELETE FROM pendientes WHERE id = ?').run(id);
      });
      await borrarArchivos(imagenes);
      await borrarSubidos(subidos);
      return true;
    },

    // Lo pasa a otra persona: vuelve a Por hacer, arriba de todo, con su nuevo responsable. Es el mismo pendiente,
    // así que conserva su historial, su chat y sus archivos.
    traspasar(quien, id, { perfil_id: perfilId, nota }) {
      const yo = quien.perfil_id;
      const antes = pendiente(yo, id);
      if (!antes) return null;
      verificarPerfil(perfilId);
      return transaction(db, () => {
        const { minimo } = db.prepare('SELECT COALESCE(MIN(posicion), 0) AS minimo FROM pendientes').get();
        db.prepare("UPDATE pendientes SET estado = 'pendiente', hecho_en = NULL, perfil_id = ?, posicion = ?, actualizado_en = ? WHERE id = ?")
          .run(perfilId, minimo - 1, new Date().toISOString(), id);
        const despues = pendiente(yo, id);
        registrar(quien, despues, 'traspaso', {
          de: nombreDePerfil(antes.perfil_id),
          de_id: antes.perfil_id,
          a: nombreDePerfil(perfilId),
          a_id: perfilId,
          estado: antes.estado,
          ...(nota && { nota }),
        }, [perfilId, antes.creado_por]);
        return despues;
      });
    },

    ordenar(quien, orden) {
      const yo = quien.perfil_id;
      const now = new Date().toISOString();
      // Todo el SET lee la fila de antes: `estado <> ?` compara con el estado previo.
      const update = db.prepare(`UPDATE pendientes
        SET posicion = ?, actualizado_en = CASE WHEN estado <> ? THEN ? ELSE actualizado_en END,
          hecho_en = CASE WHEN estado = ? THEN hecho_en WHEN ? = 'hecho' THEN ? ELSE NULL END, estado = ?
        WHERE id = ? AND ${PENDIENTE_VISIBLE}`);
      const antes = new Map(db.prepare(`SELECT id, texto, estado, perfil_id, creado_por FROM pendientes WHERE ${PENDIENTE_VISIBLE}`).all(yo)
        .map((row) => [row.id, fila(row)]));
      transaction(db, () => {
        // Lo que el tablero no conocía (otro lo creó mientras tanto, o no lo puede ver) queda al final, en su mismo orden.
        db.exec('UPDATE pendientes SET posicion = posicion + 1000000');
        orden.forEach(({ id, estado }, i) => update.run(i, estado, now, estado, estado, now, estado, id, yo));
        db.exec(`WITH r AS (SELECT id, ROW_NUMBER() OVER (ORDER BY posicion) - 1 AS n FROM pendientes)
          UPDATE pendientes SET posicion = (SELECT n FROM r WHERE r.id = pendientes.id)`);
        // Arrastrar a otra columna también es un cambio de estado.
        for (const [id, estado] of new Map(orden.map((item) => [item.id, item.estado]))) {
          const previo = antes.get(id);
          if (previo && previo.estado !== estado) {
            registrar(quien, previo, 'estado', { de: previo.estado, a: estado }, [previo.creado_por]);
          }
        }
      });
      return this.listarPendientes(yo);
    },

    listarComentarios(yo, pendienteId) {
      if (!pendiente(yo, pendienteId)) return null;
      const adjuntos = Map.groupBy(db.prepare(`${SELECT_ARCHIVO} WHERE pendiente_id = ? AND comentario_id IS NOT NULL ORDER BY creado_en, rowid`)
        .all(pendienteId).map(fila), (archivo) => archivo.comentario_id);
      return db.prepare(`${SELECT_COMENTARIO} WHERE pendiente_id = ? ORDER BY creado_en, rowid`).all(pendienteId)
        .map((row) => ({ ...fila(row), archivos: adjuntos.get(row.id) ?? [] }));
    },

    // Avisa al responsable, a quien lo creó, a quienes ya escribieron, a los @mencionados y a quien escribió el mensaje respondido.
    // Los archivos tienen que ser borradores de quien escribe, subidos para este mismo pendiente.
    crearComentario(quien, pendienteId, { texto, archivos: archivoIds = [], respuesta_a: respuestaA = null }) {
      const item = pendiente(quien.perfil_id, pendienteId);
      if (!item) return null;
      const id = randomUUID();
      return transaction(db, () => {
        const adjuntos = archivoIds.map((archivoId) => fila(db.prepare(`${SELECT_ARCHIVO} WHERE id = ? AND pendiente_id = ? AND borrador = 1`)
          .get(archivoId, pendienteId)));
        if (adjuntos.some((archivo) => !archivo || !esAutor(quien, archivo))) throw httpError(422, 'archivos_invalidos');
        const respondido = respuestaA && db.prepare('SELECT perfil_id FROM comentarios WHERE id = ? AND pendiente_id = ?').get(respuestaA, pendienteId);
        if (respuestaA && !respondido) throw httpError(422, 'respuesta_invalida');
        db.prepare('INSERT INTO comentarios (id, pendiente_id, perfil_id, autor, texto, respuesta_a, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, pendienteId, quien.perfil_id, quien.nombre, texto, respuestaA, new Date().toISOString());
        const adjuntar = db.prepare('UPDATE archivos SET comentario_id = ?, borrador = 0 WHERE id = ?');
        for (const archivo of adjuntos) adjuntar.run(id, archivo.id);
        // Los mencionados quedan en el historial para que su aviso diga "te mencionó".
        const menciones = mencionadosEn(texto);
        const datos = {
          comentario_id: id,
          extracto: texto.slice(0, MAX_EXTRACTO),
          ...(menciones.length > 0 && { menciones }),
          ...(adjuntos.length > 0 && { adjuntos: adjuntos.map((archivo) => archivo.nombre) }),
          // Para que el aviso de quien escribió el original diga "te respondió".
          ...(respondido?.perfil_id && { respondido_id: respondido.perfil_id }),
        };
        // Un mensaje no cambia el pendiente: solo avisa a los mencionados y a quien escribió el mensaje que se responde.
        registrar(quien, item, 'comentario', datos, [...menciones, respondido?.perfil_id]);
        return { ...fila(db.prepare(`${SELECT_COMENTARIO} WHERE id = ?`).get(id)), archivos: adjuntos.map((archivo) => ({ ...archivo, comentario_id: id })) };
      });
    },

    // Cada quien borra solo sus mensajes; con el mensaje se van su entrada del historial y sus avisos.
    async borrarComentario(quien, id) {
      const comentario = db.prepare(`SELECT c.perfil_id, c.autor FROM comentarios c JOIN pendientes ON pendientes.id = c.pendiente_id
        WHERE c.id = ? AND ${PENDIENTE_VISIBLE}`).get(id, quien.perfil_id);
      if (!comentario) return false;
      const esSuyo = comentario.perfil_id ? comentario.perfil_id === quien.perfil_id : quien.perfil_id === null && comentario.autor === quien.nombre;
      if (!esSuyo) throw httpError(403, 'solo_el_autor');
      const subidos = db.prepare('SELECT id FROM archivos WHERE comentario_id = ?').all(id).map((row) => row.id);
      transaction(db, () => {
        db.prepare("DELETE FROM actividad WHERE tipo = 'comentario' AND json_extract(datos, '$.comentario_id') = ?").run(id);
        db.prepare('DELETE FROM comentarios WHERE id = ?').run(id);
      });
      await borrarSubidos(subidos);
      return true;
    },

    // Para el chat queda como borrador hasta que se envía el mensaje; si no, se adjunta al pendiente y se avisa.
    async guardarArchivo(quien, pendienteId, { nombre, contenido, paraChat }) {
      const item = pendiente(quien.perfil_id, pendienteId);
      if (!item) return null;
      if (contenido.length === 0) throw httpError(422, 'archivo_vacio');
      await limpiarBorradores();
      const id = randomUUID();
      const destino = archivoSubido(id);
      await writeFile(`${destino}.tmp`, contenido, { mode: 0o600 });
      await rename(`${destino}.tmp`, destino);
      return transaction(db, () => {
        db.prepare(`INSERT INTO archivos (id, pendiente_id, comentario_id, borrador, nombre, tipo, tamano, perfil_id, autor, creado_en)
          VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, pendienteId, paraChat ? 1 : 0, nombre, tipoDeArchivo(contenido), contenido.length, quien.perfil_id, quien.nombre, new Date().toISOString());
        if (!paraChat) registrar(quien, item, 'archivo', { archivo_id: id, nombre }, [item.creado_por]);
        return fila(db.prepare(`${SELECT_ARCHIVO} WHERE id = ?`).get(id));
      });
    },

    // Los del pendiente y los de su chat (no los borradores).
    listarArchivos(yo, pendienteId) {
      if (!pendiente(yo, pendienteId)) return null;
      return db.prepare(`${SELECT_ARCHIVO} WHERE pendiente_id = ? AND borrador = 0 ORDER BY creado_en, rowid`).all(pendienteId).map(fila);
    },

    async leerArchivo(yo, id) {
      const archivo = fila(db.prepare(`SELECT a.nombre, a.tipo FROM archivos a JOIN pendientes ON pendientes.id = a.pendiente_id
        WHERE a.id = ? AND ${PENDIENTE_VISIBLE}`).get(id, yo));
      if (!archivo) return null;
      try {
        return { ...archivo, contenido: await readFile(archivoSubido(id)) };
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },

    // Cada quien quita lo que subió. Lo de un mensaje se va al borrar el mensaje.
    async borrarArchivo(quien, id) {
      const archivo = fila(db.prepare(`SELECT a.perfil_id, a.autor, a.comentario_id FROM archivos a JOIN pendientes ON pendientes.id = a.pendiente_id
        WHERE a.id = ? AND ${PENDIENTE_VISIBLE}`).get(id, quien.perfil_id));
      if (!archivo) return false;
      if (archivo.comentario_id) throw httpError(409, 'archivo_de_mensaje');
      if (!esAutor(quien, archivo)) throw httpError(403, 'solo_el_autor');
      transaction(db, () => {
        db.prepare("DELETE FROM actividad WHERE tipo = 'archivo' AND json_extract(datos, '$.archivo_id') = ?").run(id);
        db.prepare('DELETE FROM archivos WHERE id = ?').run(id);
      });
      await borrarSubidos([id]);
      return true;
    },

    listarActividad: (yo, { antes = null, limite = 50 } = {}) => db.prepare(`${SELECT_ACTIVIDAD}
      WHERE ${ACTIVIDAD_VISIBLE} AND (? IS NULL OR a.creado_en < ?) ORDER BY a.creado_en DESC, a.rowid DESC LIMIT ?`)
      .all(yo, yo, antes, antes, limite).map(actividadFila),

    actividadDePendiente(yo, pendienteId) {
      if (!pendiente(yo, pendienteId)) return null;
      return db.prepare(`${SELECT_ACTIVIDAD} WHERE a.pendiente_id = ? ORDER BY a.creado_en DESC, a.rowid DESC LIMIT 200`).all(pendienteId).map(actividadFila);
    },

    // La cuenta del equipo no es un perfil: no recibe avisos.
    listarNotificaciones(yo) {
      if (!yo) return { notificaciones: [], no_leidas: 0 };
      const notificaciones = db.prepare(`SELECT n.id AS notificacion_id, n.leida_en, a.id, a.pendiente_id, a.texto_pendiente, a.perfil_id, a.autor,
          a.tipo, a.datos, a.creado_en
        FROM notificaciones n JOIN actividad a ON a.id = n.actividad_id
        WHERE n.perfil_id = ? AND ${ACTIVIDAD_VISIBLE} ORDER BY n.creado_en DESC, n.rowid DESC LIMIT 50`).all(yo, yo, yo)
        .map(({ notificacion_id: id, leida_en: leidaEn, ...actividad }) => ({ id, leida: leidaEn !== null, actividad: actividadFila(actividad) }));
      return { notificaciones, no_leidas: this.noLeidas(yo) };
    },

    noLeidas: (yo) => db.prepare(`SELECT COUNT(*) AS total FROM notificaciones n JOIN actividad a ON a.id = n.actividad_id
      WHERE n.perfil_id = ? AND n.leida_en IS NULL AND ${ACTIVIDAD_VISIBLE}`).get(yo, yo, yo).total,

    marcarLeidas(yo, ids) {
      if (!yo) return 0;
      const ahora = new Date().toISOString();
      if (ids === null) {
        db.prepare('UPDATE notificaciones SET leida_en = ? WHERE perfil_id = ? AND leida_en IS NULL').run(ahora, yo);
      } else {
        const marcar = db.prepare('UPDATE notificaciones SET leida_en = ? WHERE id = ? AND perfil_id = ? AND leida_en IS NULL');
        transaction(db, () => ids.forEach((id) => marcar.run(ahora, id, yo)));
      }
      return this.noLeidas(yo);
    },

    async guardarImagen(yo, pendienteId, contenido) {
      if (!pendiente(yo, pendienteId)) return null;
      const tipo = tipoDeImagen(contenido);
      if (!tipo) throw httpError(415, 'imagen_invalida');
      const id = randomUUID();
      const destino = archivoDeImagen(id);
      await writeFile(`${destino}.tmp`, contenido, { mode: 0o600 });
      await rename(`${destino}.tmp`, destino);
      db.prepare('INSERT INTO imagenes (id, pendiente_id, tipo, tamano, creado_en) VALUES (?, ?, ?, ?, ?)')
        .run(id, pendienteId, tipo, contenido.length, new Date().toISOString());
      return { id, url: `${API_PATH}/imagenes/${id}` };
    },

    async leerImagen(yo, id) {
      const imagen = fila(db.prepare(`SELECT i.tipo FROM imagenes i JOIN pendientes ON pendientes.id = i.pendiente_id
        WHERE i.id = ? AND ${PENDIENTE_VISIBLE}`).get(id, yo));
      if (!imagen) return null;
      try {
        return { tipo: imagen.tipo, contenido: await readFile(archivoDeImagen(id)) };
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },

    // Se entra con el nombre del perfil o con su correo, si tiene.
    perfilPorUsuario: (usuario) => fila(db.prepare('SELECT id, nombre, password_hash FROM perfiles WHERE nombre = ? OR lower(correo) = lower(?)')
      .get(usuario, usuario)),

    listarPerfiles: () => db.prepare(`${SELECT_PERFIL} ORDER BY creado_en, rowid`).all().map(perfilFila),

    crearPerfil({ nombre, color, correo = null, telefono = null }) {
      if (db.prepare('SELECT 1 FROM perfiles WHERE nombre = ?').get(nombre)) throw httpError(409, 'perfil_duplicado');
      const { total } = db.prepare('SELECT COUNT(*) AS total FROM perfiles').get();
      const id = randomUUID();
      sinDuplicados('correo_duplicado', () => db.prepare('INSERT INTO perfiles (id, nombre, correo, telefono, color, creado_en) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, nombre, correo, telefono, color ?? COLORES[total % COLORES.length], new Date().toISOString()));
      return perfil(id);
    },

    // Igual que la contraseña: un perfil con contraseña solo lo edita él mismo.
    actualizarPerfil(yo, id, changes) {
      const actual = perfil(id);
      if (!actual) return null;
      if (actual.tiene_contrasena && id !== yo) throw httpError(403, 'solo_el_mismo');
      if (changes.nombre && db.prepare('SELECT 1 FROM perfiles WHERE nombre = ? AND id <> ?').get(changes.nombre, id)) throw httpError(409, 'perfil_duplicado');
      const campos = Object.keys(changes);
      if (campos.length) {
        sinDuplicados('correo_duplicado', () => db.prepare(`UPDATE perfiles SET ${campos.map((campo) => `${campo} = ?`).join(', ')} WHERE id = ?`)
          .run(...campos.map((campo) => changes[campo]), id));
      }
      return perfil(id);
    },

    // Un perfil sin contraseña la puede poner cualquiera (así cada quien entra la primera vez);
    // una vez puesta, solo ese perfil la cambia.
    async ponerContrasena(yo, id, contrasena) {
      const actual = perfil(id);
      if (!actual) return null;
      if (actual.tiene_contrasena && id !== yo) throw httpError(403, 'solo_el_mismo');
      db.prepare('UPDATE perfiles SET password_hash = ? WHERE id = ?').run(await hashearContrasena(contrasena), id);
      return perfil(id);
    },

    // Sus pendientes quedan sin asignar (ON DELETE SET NULL) y sus organizaciones compartidas pasan al equipo.
    // Un perfil con contraseña solo se quita a sí mismo, y no mientras tenga organizaciones privadas.
    borrarPerfil(yo, id) {
      const actual = perfil(id);
      if (!actual) return false;
      if (actual.tiene_contrasena && id !== yo) throw httpError(403, 'solo_el_mismo');
      if (db.prepare('SELECT 1 FROM organizaciones WHERE duenio_id = ? AND compartida = 0').get(id)) throw httpError(409, 'perfil_con_privadas');
      transaction(db, () => {
        db.prepare('UPDATE organizaciones SET duenio_id = NULL WHERE duenio_id = ?').run(id);
        db.prepare('DELETE FROM perfiles WHERE id = ?').run(id);
      });
      return true;
    },

    listarOrganizaciones: (yo) => db.prepare(`${SELECT_ORGANIZACION} WHERE compartida = 1 OR duenio_id = ? ORDER BY nombre, creado_en`)
      .all(yo).map(organizacionFila),

    // La cuenta del equipo crea organizaciones sin dueño, que siempre son compartidas.
    // Si no se dicen sus involucrados, en una compartida son todos los perfiles; en una privada, solo su dueño.
    crearOrganizacion(yo, { nombre, color, compartida = true, miembros }) {
      const { total } = db.prepare('SELECT COUNT(*) AS total FROM organizaciones').get();
      const id = randomUUID();
      const esCompartida = yo === null || compartida;
      return transaction(db, () => {
        sinDuplicados('organizacion_duplicada', () => db.prepare(`INSERT INTO organizaciones (id, nombre, color, duenio_id, compartida, creado_en)
          VALUES (?, ?, ?, ?, ?, ?)`).run(id, nombre, color ?? COLORES[total % COLORES.length], yo, esCompartida ? 1 : 0, new Date().toISOString()));
        ponerMiembros(id, !esCompartida ? [yo] : (miembros ?? db.prepare('SELECT id FROM perfiles').all().map((p) => p.id)));
        return organizacion(yo, id);
      });
    },

    // Los involucrados de una compartida los cambia cualquiera que la ve, como sus proyectos; lo demás, quien la administra.
    // Una privada solo tiene a su dueño: al volverla privada quedan solo él.
    actualizarOrganizacion(yo, id, { miembros, ...changes }) {
      const org = Object.keys(changes).length ? administrable(yo, id) : organizacion(yo, id);
      if (!org) return null;
      if (changes.compartida === false && org.duenio_id === null) throw httpError(422, 'organizacion_del_equipo');
      const compartida = changes.compartida ?? org.compartida;
      if (miembros && !compartida) throw httpError(422, 'miembros_en_privada');
      const columnas = { ...changes, ...('compartida' in changes ? { compartida: changes.compartida ? 1 : 0 } : {}) };
      const campos = Object.keys(columnas);
      return transaction(db, () => {
        if (campos.length) {
          sinDuplicados('organizacion_duplicada', () => db.prepare(`UPDATE organizaciones SET ${campos.map((campo) => `${campo} = ?`).join(', ')} WHERE id = ?`)
            .run(...campos.map((campo) => columnas[campo]), id));
        }
        if (miembros) ponerMiembros(id, miembros);
        else if (!compartida && org.compartida) ponerMiembros(id, [org.duenio_id]);
        return organizacion(yo, id);
      });
    },

    // Con pendientes adentro no se borra: se perderían, o se verían de golpe los de una organización privada.
    borrarOrganizacion(yo, id) {
      if (!administrable(yo, id)) return false;
      const { total } = db.prepare('SELECT COUNT(*) AS total FROM pendientes WHERE proyecto_id IN (SELECT id FROM proyectos WHERE organizacion_id = ?)').get(id);
      if (total > 0) throw httpError(409, 'organizacion_con_pendientes');
      // Sus proyectos (vacíos) se van con ella por ON DELETE CASCADE.
      db.prepare('DELETE FROM organizaciones WHERE id = ?').run(id);
      return true;
    },

    listarProyectos: (yo) => db.prepare(`${SELECT_PROYECTO} WHERE id IN (${PROYECTOS_VISIBLES}) ORDER BY nombre, creado_en`).all(yo).map(fila),

    crearProyecto(yo, { nombre, organizacion_id: organizacionId = null }) {
      verificarOrganizacion(yo, organizacionId);
      const id = randomUUID();
      sinDuplicados('proyecto_duplicado', () => db.prepare('INSERT INTO proyectos (id, nombre, organizacion_id, creado_en) VALUES (?, ?, ?, ?)')
        .run(id, nombre, organizacionId, new Date().toISOString()));
      return proyecto(yo, id);
    },

    actualizarProyecto(yo, id, changes) {
      if (!proyecto(yo, id)) return null;
      verificarOrganizacion(yo, changes.organizacion_id);
      const campos = Object.keys(changes);
      if (campos.length) {
        sinDuplicados('proyecto_duplicado', () => db.prepare(`UPDATE proyectos SET ${campos.map((campo) => `${campo} = ?`).join(', ')} WHERE id = ?`)
          .run(...campos.map((campo) => changes[campo]), id));
      }
      return proyecto(yo, id);
    },

    borrarProyecto(yo, id) {
      if (!proyecto(yo, id)) return false;
      if (db.prepare('SELECT 1 FROM pendientes WHERE proyecto_id = ?').get(id)) throw httpError(409, 'proyecto_con_pendientes');
      db.prepare('DELETE FROM proyectos WHERE id = ?').run(id);
      return true;
    },
  };
}

export function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || '/data';
  const authUser = options.authUser || process.env.AUTH_USER || 'pendientes';
  const authPassword = options.authPassword ?? process.env.AUTH_PASSWORD ?? '';
  const db = openDb(dataDir);
  const repo = createRepo(db, dataDir, options.graciaImagenesMs ?? GRACIA_IMAGENES_MS);
  // Las pruebas apuntan cada proveedor de IA a un servidor falso (IA_URL_GEMINI, IA_URL_OPENAI, IA_URL_OPENROUTER).
  const basesIA = Object.fromEntries(Object.entries(PROVEEDORES_IA).map(([id, { url }]) =>
    [id, options.basesIA?.[id] ?? process.env[`IA_URL_${id.toUpperCase()}`] ?? url]));
  // Credenciales de perfil ya verificadas (huella del encabezado → hash contra el que se verificaron),
  // para no correr scrypt en cada petición. Si la contraseña cambia, el hash ya no coincide.
  const verificadas = new Map();
  const fallos = new Map();

  // Cambios en tiempo real (SSE): cada pestaña abierta deja una conexión en GET /api/pendientes/eventos y, cuando
  // alguien cambia algo, se le avisa qué cambió (pendientes, un chat, archivos, el catálogo) para que lo vuelva a
  // pedir con sus permisos. No viaja el cambio en sí. La pestaña que hizo el cambio (X-Cliente) no se avisa a sí misma.
  const conexiones = new Set();
  const latido = setInterval(() => {
    for (const conexion of conexiones) conexion.res.write(': latido\n\n');
  }, LATIDO_MS);
  latido.unref();

  function avisarCambio(cambio, cliente) {
    const mensaje = `event: cambio\ndata: ${JSON.stringify(cambio)}\n\n`;
    for (const conexion of conexiones) {
      if (cliente && conexion.cliente === cliente) continue;
      if (cambio.pendiente_id && !repo.puedeVerPendiente(conexion.yo, cambio.pendiente_id)) continue;
      conexion.res.write(mensaje);
    }
  }

  // El tipo que elige la IA llega después de crear el pendiente: se avisa a todos, también a la pestaña que lo creó
  // (que espera la respuesta para dejar de mostrar que la IA está eligiendo), haya salido bien o no.
  function elegirTipo(id) {
    repo.elegirTipo(id, basesIA)
      .catch((error) => console.warn(`La IA no pudo elegir el tipo de ${id}: ${error.message}${error.detalle ? ` (${error.detalle})` : ''}`))
      .finally(() => avisarCambio({ tipo: 'pendientes', pendiente_id: id }));
  }

  // Qué avisar si la petición sale bien. Lo de un mensaje o archivo que se borra se busca antes de borrarlo.
  function cambioDe(pathname, method) {
    if (method === 'GET') return null;
    const deRuta = (ruta) => pathname.match(ruta)?.[1];
    if (pathname === API_PATH || pathname === ORDER_PATH) return { tipo: 'pendientes' };
    const pendienteId = deRuta(ITEM_PATH) ?? deRuta(TRASPASO_PATH);
    if (pendienteId) return { tipo: 'pendientes', pendiente_id: pendienteId };
    if (deRuta(COMENTARIOS_PATH)) return { tipo: 'comentarios', pendiente_id: deRuta(COMENTARIOS_PATH) };
    if (deRuta(COMENTARIO_PATH)) return { tipo: 'comentarios', pendiente_id: repo.pendienteDeComentario(deRuta(COMENTARIO_PATH)) };
    if (deRuta(ARCHIVOS_PATH)) return { tipo: 'archivos', pendiente_id: deRuta(ARCHIVOS_PATH) };
    if (deRuta(ARCHIVO_PATH)) return { tipo: 'archivos', pendiente_id: repo.pendienteDeArchivo(deRuta(ARCHIVO_PATH)) };
    if ([PERFILES_PATH, ORGANIZACIONES_PATH, PROYECTOS_PATH, ETIQUETAS_PATH].includes(pathname)
      || [PERFIL_PATH, CONTRASENA_PATH, ORGANIZACION_PATH, PROYECTO_PATH, ETIQUETA_PATH].some((ruta) => ruta.test(pathname))) {
      return { tipo: 'catalogo' };
    }
    if (pathname === IA_PATH) return { tipo: 'ia' };
    return null;
  }

  // Devuelve { perfil_id, nombre } de quien llama, o null. La cuenta del equipo (AUTH_USER) no es un perfil.
  async function autenticar(req) {
    const credenciales = leerBasic(req);
    if (!credenciales) return null;
    const clave = credenciales.usuario.trim().toLowerCase();
    const intento = fallos.get(clave);
    if (intento && Date.now() - intento.desde > VENTANA_FALLOS_MS) fallos.delete(clave);
    if ((fallos.get(clave)?.cantidad ?? 0) >= MAX_FALLOS) throw httpError(429, 'demasiados_intentos');

    let usuario = null;
    // Sin AUTH_PASSWORD la cuenta del equipo queda deshabilitada.
    if (authPassword && safeEqual(credenciales.usuario, authUser) && safeEqual(credenciales.contrasena, authPassword)) {
      usuario = { perfil_id: null, nombre: 'Equipo' };
    } else {
      const perfil = repo.perfilPorUsuario(credenciales.usuario.trim());
      if (perfil?.password_hash && (verificadas.get(credenciales.huella) === perfil.password_hash
        || await verificarContrasena(credenciales.contrasena, perfil.password_hash))) {
        if (verificadas.size > 1000) verificadas.clear();
        verificadas.set(credenciales.huella, perfil.password_hash);
        usuario = { perfil_id: perfil.id, nombre: perfil.nombre };
      }
    }

    if (usuario) fallos.delete(clave);
    else fallos.set(clave, { cantidad: (fallos.get(clave)?.cantidad ?? 0) + 1, desde: fallos.get(clave)?.desde ?? Date.now() });
    return usuario;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, service: 'timermayu-pendientes-api', configured: Boolean(authPassword) });
      }

      const known = RUTAS_FIJAS.includes(url.pathname) || RUTAS_CON_ID.some((ruta) => ruta.test(url.pathname));
      if (!known) return json(res, 404, { error: 'not_found' });

      // No se manda WWW-Authenticate para que el navegador no muestre su ventana nativa:
      // la página tiene su propio formulario de acceso.
      const usuario = await autenticar(req);
      if (!usuario) return json(res, 401, { error: 'authentication_required' });
      const yo = usuario.perfil_id;
      const cambio = cambioDe(url.pathname, req.method);
      if (cambio) {
        const cliente = String(req.headers['x-cliente'] ?? '').slice(0, 64);
        res.on('finish', () => res.statusCode < 400 && avisarCambio(cambio, cliente));
      }
      const enviar = (status, clave, valor) => (valor ? json(res, status, { [clave]: valor }) : json(res, 404, { error: 'not_found' }));
      const listo = (hecho) => (hecho ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not_found' }));

      if (url.pathname === YO_PATH && req.method === 'GET') return json(res, 200, { usuario });

      if (url.pathname === EVENTOS_PATH && req.method === 'GET') {
        if (conexiones.size >= MAX_CONEXIONES) throw httpError(503, 'demasiadas_conexiones');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          // Que nginx lo pase tal cual llega, sin juntarlo en su búfer.
          'X-Accel-Buffering': 'no',
        });
        res.write('event: conectado\ndata: {"tipo":"conectado"}\n\n');
        const conexion = { res, yo, cliente: (url.searchParams.get('cliente') ?? '').slice(0, 64) };
        conexiones.add(conexion);
        res.on('close', () => conexiones.delete(conexion));
        return;
      }

      if (url.pathname === API_PATH && req.method === 'GET') return json(res, 200, { pendientes: repo.listarPendientes(yo) });
      if (url.pathname === API_PATH && req.method === 'POST') {
        const changes = parsePendiente(await readJson(req));
        const creado = repo.crearPendiente(usuario, changes);
        // Sin "tipo" en el pedido (null es "sin tipo" a propósito), la IA lo elige si está configurada.
        const eligiendoTipo = !('tipo' in changes) && repo.tipoAutomatico();
        if (eligiendoTipo) elegirTipo(creado.id);
        return json(res, 201, { pendiente: creado, eligiendo_tipo: eligiendoTipo });
      }
      if (url.pathname === ORDER_PATH && req.method === 'PUT') {
        return json(res, 200, { pendientes: repo.ordenar(usuario, parseOrden(await readJson(req))) });
      }

      if (url.pathname === IA_PATH && req.method === 'GET') return json(res, 200, { ia: iaPublica(repo.ajustesIA()) });
      if (url.pathname === IA_PATH && req.method === 'PUT') {
        return json(res, 200, { ia: iaPublica(repo.guardarAjustesIA(parseAjustesIA(await readJson(req)))) });
      }
      if (url.pathname === IA_MODELOS_PATH && req.method === 'POST') {
        const pedido = parsePedidoModelos(await readJson(req));
        const { proveedor } = pedido;
        // OpenRouter lista sus modelos sin clave.
        const clave = pedido.clave ?? repo.ajustesIA().claves[proveedor];
        if (!clave && proveedor !== 'openrouter') throw httpError(422, 'ia_sin_clave');
        return json(res, 200, { modelos: await listarModelos({ proveedor, clave, base: basesIA[proveedor] }) });
      }
      if (url.pathname === IA_SUGERIR_PATH && req.method === 'POST') {
        return json(res, 200, { sugerencias: await repo.sugerirPendientes(yo, parseSugerencia(await readJson(req, MAX_BODY_IA_BYTES)), basesIA) });
      }

      if (url.pathname === ETIQUETAS_PATH && req.method === 'GET') return json(res, 200, { etiquetas: repo.listarEtiquetas() });
      if (url.pathname === ETIQUETAS_PATH && req.method === 'POST') {
        return json(res, 201, { etiqueta: repo.crearEtiqueta(parseEtiqueta(await readJson(req))) });
      }
      const etiquetaId = url.pathname.match(ETIQUETA_PATH)?.[1];
      if (etiquetaId && req.method === 'PATCH') {
        return enviar(200, 'etiqueta', repo.actualizarEtiqueta(etiquetaId, parseEtiqueta(await readJson(req), { partial: true })));
      }
      if (etiquetaId && req.method === 'DELETE') return listo(repo.borrarEtiqueta(etiquetaId));

      if (url.pathname === ACTIVIDAD_PATH && req.method === 'GET') {
        const antes = url.searchParams.get('antes');
        if (antes !== null && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(antes)) throw httpError(422, 'antes_invalido');
        const limite = Math.min(Math.max(Number(url.searchParams.get('limite')) || 50, 1), 100);
        return json(res, 200, { actividad: repo.listarActividad(yo, { antes, limite }) });
      }
      if (url.pathname === NOTIFICACIONES_PATH && req.method === 'GET') return json(res, 200, repo.listarNotificaciones(yo));
      if (url.pathname === LEIDAS_PATH && req.method === 'POST') {
        return json(res, 200, { no_leidas: repo.marcarLeidas(yo, parseLeidas(await readJson(req))) });
      }
      const pendienteDeActividad = url.pathname.match(ACTIVIDAD_ITEM_PATH)?.[1];
      if (pendienteDeActividad && req.method === 'GET') return enviar(200, 'actividad', repo.actividadDePendiente(yo, pendienteDeActividad));
      const pendienteDeComentarios = url.pathname.match(COMENTARIOS_PATH)?.[1];
      if (pendienteDeComentarios && req.method === 'GET') return enviar(200, 'comentarios', repo.listarComentarios(yo, pendienteDeComentarios));
      if (pendienteDeComentarios && req.method === 'POST') {
        return enviar(201, 'comentario', repo.crearComentario(usuario, pendienteDeComentarios, parseComentario(await readJson(req))));
      }
      const comentarioId = url.pathname.match(COMENTARIO_PATH)?.[1];
      if (comentarioId && req.method === 'DELETE') return listo(await repo.borrarComentario(usuario, comentarioId));

      const pendienteDeArchivos = url.pathname.match(ARCHIVOS_PATH)?.[1];
      if (pendienteDeArchivos && req.method === 'GET') return enviar(200, 'archivos', repo.listarArchivos(yo, pendienteDeArchivos));
      if (pendienteDeArchivos && req.method === 'POST') {
        const nombre = nombreDeArchivo(req.headers['x-nombre-archivo']);
        const contenido = await readBody(req, MAX_ARCHIVO_BYTES);
        return enviar(201, 'archivo', await repo.guardarArchivo(usuario, pendienteDeArchivos, { nombre, contenido, paraChat: url.searchParams.get('para') === 'chat' }));
      }

      const archivoId = url.pathname.match(ARCHIVO_PATH)?.[1];
      if (archivoId && req.method === 'GET') {
        const archivo = await repo.leerArchivo(yo, archivoId);
        if (!archivo) return json(res, 404, { error: 'not_found' });
        // Solo imágenes y PDF se abren en el navegador; lo demás se descarga. Nada se ejecuta como página de este sitio.
        const enLinea = archivo.tipo !== 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': archivo.tipo,
          'Content-Length': archivo.contenido.length,
          'Cache-Control': 'private, max-age=31536000, immutable',
          'Content-Disposition': `${enLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}`,
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(archivo.contenido);
      }
      if (archivoId && req.method === 'DELETE') return listo(await repo.borrarArchivo(usuario, archivoId));

      const pendienteDeTraspaso = url.pathname.match(TRASPASO_PATH)?.[1];
      if (pendienteDeTraspaso && req.method === 'POST') {
        return enviar(200, 'pendiente', repo.traspasar(usuario, pendienteDeTraspaso, parseTraspaso(await readJson(req))));
      }

      if (url.pathname === PERFILES_PATH && req.method === 'GET') return json(res, 200, { perfiles: repo.listarPerfiles() });
      // El nombre de la cuenta del equipo no puede ser un perfil: al entrar no se sabría cuál es.
      const nombreLibre = (datos) => {
        if (datos.nombre?.toLowerCase() === authUser.toLowerCase()) throw httpError(422, 'nombre_reservado');
        return datos;
      };
      if (url.pathname === PERFILES_PATH && req.method === 'POST') {
        return json(res, 201, { perfil: repo.crearPerfil(nombreLibre(parsePerfil(await readJson(req)))) });
      }
      const perfilId = url.pathname.match(PERFIL_PATH)?.[1];
      if (perfilId && req.method === 'PATCH') {
        return enviar(200, 'perfil', repo.actualizarPerfil(yo, perfilId, nombreLibre(parsePerfil(await readJson(req), { partial: true }))));
      }
      if (perfilId && req.method === 'DELETE') return listo(repo.borrarPerfil(yo, perfilId));
      const perfilDeContrasena = url.pathname.match(CONTRASENA_PATH)?.[1];
      if (perfilDeContrasena && req.method === 'PUT') {
        return enviar(200, 'perfil', await repo.ponerContrasena(yo, perfilDeContrasena, parseContrasena(await readJson(req))));
      }

      if (url.pathname === ORGANIZACIONES_PATH && req.method === 'GET') return json(res, 200, { organizaciones: repo.listarOrganizaciones(yo) });
      if (url.pathname === ORGANIZACIONES_PATH && req.method === 'POST') {
        return json(res, 201, { organizacion: repo.crearOrganizacion(yo, parseOrganizacion(await readJson(req))) });
      }
      const organizacionId = url.pathname.match(ORGANIZACION_PATH)?.[1];
      if (organizacionId && req.method === 'PATCH') {
        return enviar(200, 'organizacion', repo.actualizarOrganizacion(yo, organizacionId, parseOrganizacion(await readJson(req), { partial: true })));
      }
      if (organizacionId && req.method === 'DELETE') return listo(repo.borrarOrganizacion(yo, organizacionId));

      if (url.pathname === PROYECTOS_PATH && req.method === 'GET') return json(res, 200, { proyectos: repo.listarProyectos(yo) });
      if (url.pathname === PROYECTOS_PATH && req.method === 'POST') {
        return json(res, 201, { proyecto: repo.crearProyecto(yo, parseProyecto(await readJson(req))) });
      }
      const proyectoId = url.pathname.match(PROYECTO_PATH)?.[1];
      if (proyectoId && req.method === 'PATCH') {
        return enviar(200, 'proyecto', repo.actualizarProyecto(yo, proyectoId, parseProyecto(await readJson(req), { partial: true })));
      }
      if (proyectoId && req.method === 'DELETE') return listo(repo.borrarProyecto(yo, proyectoId));

      const pendienteDeImagen = url.pathname.match(SUBIR_IMAGEN_PATH)?.[1];
      if (pendienteDeImagen && req.method === 'POST') {
        return enviar(201, 'imagen', await repo.guardarImagen(yo, pendienteDeImagen, await readBody(req, MAX_IMAGEN_BYTES)));
      }

      const imagenId = url.pathname.match(IMAGEN_PATH)?.[1];
      if (imagenId && req.method === 'GET') {
        const imagen = await repo.leerImagen(yo, imagenId);
        if (!imagen) return json(res, 404, { error: 'not_found' });
        res.writeHead(200, {
          'Content-Type': imagen.tipo,
          'Content-Length': imagen.contenido.length,
          // Cada id es un archivo distinto que nunca cambia.
          'Cache-Control': 'private, max-age=31536000, immutable',
          'Content-Disposition': 'inline',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(imagen.contenido);
      }

      const id = url.pathname.match(ITEM_PATH)?.[1];
      if (id && req.method === 'GET') return enviar(200, 'pendiente', repo.detallePendiente(yo, id));
      if (id && req.method === 'PATCH') {
        return enviar(200, 'pendiente', await repo.actualizarPendiente(usuario, id, parsePendiente(await readJson(req), { partial: true })));
      }
      if (id && req.method === 'DELETE') return listo(await repo.borrarPendiente(usuario, id));

      return json(res, 405, { error: 'method_not_allowed' });
    } catch (error) {
      const status = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error(error);
      return json(res, status, { error: status === 500 ? 'internal_error' : error.message, ...(error.detalle && { detalle: error.detalle }) });
    }
  });
  // Las conexiones de los cambios en tiempo real no terminan solas: se cierran para que close() no espere por ellas.
  const cerrar = server.close.bind(server);
  server.close = (callback) => {
    clearInterval(latido);
    for (const conexion of conexiones) conexion.res.end();
    return cerrar(callback);
  };
  server.on('close', () => db.close());
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain && process.argv[2] === 'quitar-contrasena') {
  // Para quien olvidó su contraseña:  node src/server.mjs quitar-contrasena Diego
  // Después la vuelve a poner desde Perfiles (entrando con la cuenta del equipo).
  const db = openDb(process.env.DATA_DIR || '/data');
  const { changes } = db.prepare('UPDATE perfiles SET password_hash = NULL WHERE nombre = ?').run(process.argv[3] ?? '');
  console.log(changes ? `Se quitó la contraseña de ${process.argv[3]}.` : `No hay un perfil llamado "${process.argv[3] ?? ''}".`);
  db.close();
} else if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const dataDir = process.env.DATA_DIR || '/data';
  if (!process.env.AUTH_PASSWORD) console.warn('AUTH_PASSWORD vacío: la cuenta del equipo queda deshabilitada.');
  createApp({ dataDir }).listen(port, '0.0.0.0', () => console.log(`Pendientes API listening on :${port}`));
}
