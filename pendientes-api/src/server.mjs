import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Alcanza para el orden completo del tablero (hasta 5000 pendientes de ~60 bytes cada uno).
const MAX_BODY_BYTES = 512 * 1024;
const MAX_IMAGEN_BYTES = 10 * 1024 * 1024;
const MAX_TEXTO = 500;
const MAX_PROYECTO = 60;
const MAX_NOMBRE = 40;
const MAX_CORREO = 120;
const MAX_DESCRIPCION = 400 * 1024;
const MAX_RESUMEN = 200;
const MIN_CONTRASENA = 8;
const MAX_CONTRASENA = 200;
// Tras tantos intentos fallidos seguidos con un mismo usuario, se rechaza ese usuario durante la ventana.
const MAX_FALLOS = 10;
const VENTANA_FALLOS_MS = 15 * 60 * 1000;
// Una imagen que ya no aparece en la descripción se borra pasado este tiempo, para no
// pisar una subida en curso cuyo bloque todavía no llegó a guardarse.
const GRACIA_IMAGENES_MS = 60 * 60 * 1000;
const ESTADOS = ['pendiente', 'haciendo', 'hecho'];
const COLORES = ['#2563EB', '#DB2777', '#059669', '#7C3AED', '#EA580C', '#0891B2', '#CA8A04', '#DC2626'];
const PERFILES_INICIALES = ['Favio', 'Diego', 'Junior'];
const UUID = '([0-9a-f-]{36})';
const API_PATH = '/api/pendientes';
const ORDER_PATH = '/api/pendientes/orden';
const YO_PATH = '/api/pendientes/yo';
const PERFILES_PATH = '/api/pendientes/perfiles';
const ORGANIZACIONES_PATH = '/api/pendientes/organizaciones';
const PROYECTOS_PATH = '/api/pendientes/proyectos';
const ITEM_PATH = new RegExp(`^/api/pendientes/${UUID}$`);
const PERFIL_PATH = new RegExp(`^/api/pendientes/perfiles/${UUID}$`);
const CONTRASENA_PATH = new RegExp(`^/api/pendientes/perfiles/${UUID}/contrasena$`);
const ORGANIZACION_PATH = new RegExp(`^/api/pendientes/organizaciones/${UUID}$`);
const PROYECTO_PATH = new RegExp(`^/api/pendientes/proyectos/${UUID}$`);
const SUBIR_IMAGEN_PATH = new RegExp(`^/api/pendientes/${UUID}/imagenes$`);
const IMAGEN_PATH = new RegExp(`^/api/pendientes/imagenes/${UUID}$`);
const RUTAS_FIJAS = [API_PATH, ORDER_PATH, YO_PATH, PERFILES_PATH, ORGANIZACIONES_PATH, PROYECTOS_PATH];
const RUTAS_CON_ID = [ITEM_PATH, PERFIL_PATH, CONTRASENA_PATH, ORGANIZACION_PATH, PROYECTO_PATH, SUBIR_IMAGEN_PATH, IMAGEN_PATH];
const COLUMNAS_PENDIENTE = 'id, texto, proyecto_id, estado, perfil_id, resumen, num_imagenes, creado_en, actualizado_en';
const SELECT_PERFIL = 'SELECT id, nombre, correo, color, password_hash IS NOT NULL AS tiene_contrasena, creado_en FROM perfiles';
const SELECT_ORGANIZACION = 'SELECT id, nombre, color, duenio_id, compartida, creado_en FROM organizaciones';
const SELECT_PROYECTO = 'SELECT id, nombre, organizacion_id, creado_en FROM proyectos';

// Lo privado de una organización (sus proyectos y los pendientes de esos proyectos) solo lo ve su dueño.
// El único parámetro es el perfil que pregunta (NULL para la cuenta del equipo, que solo ve lo compartido).
const PROYECTOS_VISIBLES = `SELECT pr.id FROM proyectos pr LEFT JOIN organizaciones o ON o.id = pr.organizacion_id
  WHERE pr.organizacion_id IS NULL OR o.compartida = 1 OR o.duenio_id = ?`;
const PENDIENTE_VISIBLE = `(proyecto_id IS NULL OR proyecto_id IN (${PROYECTOS_VISIBLES}))`;

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

async function readJson(req) {
  const input = JSON.parse((await readBody(req, MAX_BODY_BYTES)).toString('utf8') || '{}');
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

// Texto plano para la vista previa de la tarjeta y cantidad de imágenes del documento del editor.
export function resumirDescripcion(bloques) {
  const textos = [];
  let imagenes = 0;
  const visitar = (nodo) => {
    if (Array.isArray(nodo)) return nodo.forEach(visitar);
    if (!nodo || typeof nodo !== 'object') return;
    if (nodo.type === 'image' && nodo.props?.url) imagenes++;
    if (typeof nodo.text === 'string') textos.push(nodo.text);
    for (const hijo of [nodo.content, nodo.children, nodo.rows, nodo.cells]) visitar(hijo);
  };
  visitar(bloques);
  const resumen = textos.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_RESUMEN);
  return { resumen: resumen || null, num_imagenes: imagenes };
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
  if (partial && 'descripcion' in input) {
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
  return changes;
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
  return changes;
}

export function parseProyecto(input, { partial = false } = {}) {
  const changes = {};
  if (!partial || 'nombre' in input) changes.nombre = nombreValido(input.nombre, MAX_PROYECTO, 'nombre_invalido');
  if ('organizacion_id' in input) changes.organizacion_id = idOpcional(input, 'organizacion_id', 'organizacion_invalida');
  return changes;
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
const organizacionFila = (row) => (row ? { ...row, compartida: Boolean(row.compartida) } : null);

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
  const insert = db.prepare(`INSERT OR IGNORE INTO pendientes (id, texto, proyecto_id, estado, perfil_id, posicion, creado_en, actualizado_en)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`);
  transaction(db, () => items.forEach((item, i) => {
    const proyecto = item.proyecto?.trim().toLowerCase();
    insert.run(item.id, item.texto, proyecto ? proyectoSuelto(db, proyecto) : null, item.estado ?? 'pendiente', i, item.creado_en, item.actualizado_en);
  }));
  renameSync(file, `${file}.importado`);
}

export function openDb(dataDir) {
  mkdirSync(path.join(dataDir, 'imagenes'), { recursive: true });
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
  const pendiente = (yo, id) => fila(db.prepare(`SELECT ${COLUMNAS_PENDIENTE} FROM pendientes WHERE id = ? AND ${PENDIENTE_VISIBLE}`).get(id, yo));
  const perfil = (id) => perfilFila(db.prepare(`${SELECT_PERFIL} WHERE id = ?`).get(id));
  const organizacion = (yo, id) => organizacionFila(db.prepare(`${SELECT_ORGANIZACION} WHERE id = ? AND (compartida = 1 OR duenio_id = ?)`).get(id, yo));
  const proyecto = (yo, id) => fila(db.prepare(`${SELECT_PROYECTO} WHERE id = ? AND id IN (${PROYECTOS_VISIBLES})`).get(id, yo));

  function verificarPerfil(perfilId) {
    if (perfilId && !perfil(perfilId)) throw httpError(422, 'perfil_invalido');
  }

  function verificarProyecto(yo, proyectoId) {
    if (proyectoId && !proyecto(yo, proyectoId)) throw httpError(422, 'proyecto_invalido');
  }

  function verificarOrganizacion(yo, organizacionId) {
    if (organizacionId && !organizacion(yo, organizacionId)) throw httpError(422, 'organizacion_invalida');
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

  async function borrarArchivos(ids) {
    await Promise.all(ids.map((id) => unlink(archivoDeImagen(id)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    })));
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
    listarPendientes: (yo) => db.prepare(`SELECT ${COLUMNAS_PENDIENTE} FROM pendientes WHERE ${PENDIENTE_VISIBLE} ORDER BY posicion, creado_en DESC`)
      .all(yo).map(fila),

    detallePendiente: (yo, id) => fila(db.prepare(`SELECT ${COLUMNAS_PENDIENTE}, descripcion FROM pendientes WHERE id = ? AND ${PENDIENTE_VISIBLE}`).get(id, yo)),

    crearPendiente(yo, changes) {
      verificarPerfil(changes.perfil_id);
      verificarProyecto(yo, changes.proyecto_id);
      const now = new Date().toISOString();
      const id = randomUUID();
      // Lo nuevo va arriba de todo.
      const { minimo } = db.prepare('SELECT COALESCE(MIN(posicion), 0) AS minimo FROM pendientes').get();
      db.prepare(`INSERT INTO pendientes (id, texto, proyecto_id, estado, perfil_id, posicion, creado_en, actualizado_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, changes.texto, changes.proyecto_id ?? null, changes.estado ?? 'pendiente', changes.perfil_id ?? null, minimo - 1, now, now);
      return pendiente(yo, id);
    },

    async actualizarPendiente(yo, id, changes) {
      if (!pendiente(yo, id)) return null;
      verificarPerfil(changes.perfil_id);
      verificarProyecto(yo, changes.proyecto_id);
      const columnas = { ...changes };
      if ('descripcion' in changes) {
        Object.assign(columnas, changes.descripcion === null
          ? { resumen: null, num_imagenes: 0 }
          : resumirDescripcion(JSON.parse(changes.descripcion)));
      }
      // Las columnas salen de parsePendiente y resumirDescripcion, que solo producen campos conocidos.
      const campos = Object.keys(columnas);
      db.prepare(`UPDATE pendientes SET ${[...campos.map((campo) => `${campo} = ?`), 'actualizado_en = ?'].join(', ')} WHERE id = ?`)
        .run(...campos.map((campo) => columnas[campo]), new Date().toISOString(), id);
      if ('descripcion' in changes) await limpiarImagenes(id);
      return pendiente(yo, id);
    },

    async borrarPendiente(yo, id) {
      if (!pendiente(yo, id)) return false;
      const imagenes = db.prepare('SELECT id FROM imagenes WHERE pendiente_id = ?').all(id).map((row) => row.id);
      // ON DELETE CASCADE quita sus filas de imagenes; los archivos se borran aparte.
      db.prepare('DELETE FROM pendientes WHERE id = ?').run(id);
      await borrarArchivos(imagenes);
      return true;
    },

    ordenar(yo, orden) {
      const now = new Date().toISOString();
      const update = db.prepare(`UPDATE pendientes
        SET posicion = ?, actualizado_en = CASE WHEN estado <> ? THEN ? ELSE actualizado_en END, estado = ?
        WHERE id = ? AND ${PENDIENTE_VISIBLE}`);
      transaction(db, () => {
        // Lo que el tablero no conocía (otro lo creó mientras tanto, o no lo puede ver) queda al final, en su mismo orden.
        db.exec('UPDATE pendientes SET posicion = posicion + 1000000');
        orden.forEach(({ id, estado }, i) => update.run(i, estado, now, estado, id, yo));
        db.exec(`WITH r AS (SELECT id, ROW_NUMBER() OVER (ORDER BY posicion) - 1 AS n FROM pendientes)
          UPDATE pendientes SET posicion = (SELECT n FROM r WHERE r.id = pendientes.id)`);
      });
      return this.listarPendientes(yo);
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

    crearPerfil({ nombre, color, correo = null }) {
      if (db.prepare('SELECT 1 FROM perfiles WHERE nombre = ?').get(nombre)) throw httpError(409, 'perfil_duplicado');
      const { total } = db.prepare('SELECT COUNT(*) AS total FROM perfiles').get();
      const id = randomUUID();
      sinDuplicados('correo_duplicado', () => db.prepare('INSERT INTO perfiles (id, nombre, correo, color, creado_en) VALUES (?, ?, ?, ?, ?)')
        .run(id, nombre, correo, color ?? COLORES[total % COLORES.length], new Date().toISOString()));
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
    crearOrganizacion(yo, { nombre, color, compartida = true }) {
      const { total } = db.prepare('SELECT COUNT(*) AS total FROM organizaciones').get();
      const id = randomUUID();
      sinDuplicados('organizacion_duplicada', () => db.prepare(`INSERT INTO organizaciones (id, nombre, color, duenio_id, compartida, creado_en)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, nombre, color ?? COLORES[total % COLORES.length], yo, yo === null || compartida ? 1 : 0, new Date().toISOString()));
      return organizacion(yo, id);
    },

    actualizarOrganizacion(yo, id, changes) {
      const org = administrable(yo, id);
      if (!org) return null;
      if (changes.compartida === false && org.duenio_id === null) throw httpError(422, 'organizacion_del_equipo');
      const columnas = { ...changes, ...('compartida' in changes ? { compartida: changes.compartida ? 1 : 0 } : {}) };
      const campos = Object.keys(columnas);
      if (campos.length) {
        sinDuplicados('organizacion_duplicada', () => db.prepare(`UPDATE organizaciones SET ${campos.map((campo) => `${campo} = ?`).join(', ')} WHERE id = ?`)
          .run(...campos.map((campo) => columnas[campo]), id));
      }
      return organizacion(yo, id);
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
  // Credenciales de perfil ya verificadas (huella del encabezado → hash contra el que se verificaron),
  // para no correr scrypt en cada petición. Si la contraseña cambia, el hash ya no coincide.
  const verificadas = new Map();
  const fallos = new Map();

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
      const enviar = (status, clave, valor) => (valor ? json(res, status, { [clave]: valor }) : json(res, 404, { error: 'not_found' }));
      const listo = (hecho) => (hecho ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not_found' }));

      if (url.pathname === YO_PATH && req.method === 'GET') return json(res, 200, { usuario });

      if (url.pathname === API_PATH && req.method === 'GET') return json(res, 200, { pendientes: repo.listarPendientes(yo) });
      if (url.pathname === API_PATH && req.method === 'POST') {
        return json(res, 201, { pendiente: repo.crearPendiente(yo, parsePendiente(await readJson(req))) });
      }
      if (url.pathname === ORDER_PATH && req.method === 'PUT') {
        return json(res, 200, { pendientes: repo.ordenar(yo, parseOrden(await readJson(req))) });
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
        return enviar(200, 'pendiente', await repo.actualizarPendiente(yo, id, parsePendiente(await readJson(req), { partial: true })));
      }
      if (id && req.method === 'DELETE') return listo(await repo.borrarPendiente(yo, id));

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
