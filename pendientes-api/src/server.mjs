import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import {
  closeSync, copyFileSync, createReadStream, existsSync, linkSync, mkdirSync, openSync, readFileSync, readSync, renameSync, unlinkSync,
} from 'node:fs';
import { appendFile, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  indicacionesDeSeleccion,
  instruccionesApuntes,
  instruccionesIA,
  instruccionesRedaccion,
  instruccionesTipo,
  listarModelos,
  MAX_SUGERENCIAS,
  pedirPendientes,
  pedirRedaccion,
  pedirTipo,
  PROVEEDORES_IA,
} from './ia.mjs';
import { armarResumen, crearCorreo } from './correo.mjs';

// Alcanza para el orden completo del tablero (hasta 5000 pendientes de ~60 bytes cada uno).
const MAX_BODY_BYTES = 512 * 1024;
// "Crear con IA" puede llevar imágenes (en base64): hasta 6 y 7 MB entre todas, bajo los 11 MB que deja pasar nginx.
const MAX_BODY_IA_BYTES = 10 * 1024 * 1024;
const MAX_IMAGENES_IA = 6;
const MAX_BYTES_IMAGENES_IA = 7 * 1024 * 1024;
// Los formatos que aceptan los tres proveedores.
const TIPOS_IMAGEN_IA = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGEN_BYTES = 10 * 1024 * 1024;
// Una imagen de otra página que se trae al pegar (después se achica en el navegador antes de subirla): lo que puede
// pesar, lo que puede tardar (bajo los 12 s que espera nginx) y cuántas redirecciones se siguen.
const MAX_IMAGEN_EXTERNA_BYTES = 15 * 1024 * 1024;
const TIEMPO_IMAGEN_EXTERNA_MS = 8000;
const MAX_REDIRECCIONES_IMAGEN = 3;
const MAX_TEXTO = 500;
const MAX_PROYECTO = 60;
const MAX_NOMBRE = 40;
const MAX_CORREO = 120;
const MAX_COMENTARIO = 2000;
const MAX_ARCHIVO_BYTES = 10 * 1024 * 1024;
// Lo más grande (videos, sobre todo) llega en partes de hasta MAX_PARTE_BYTES, como los recursos de las notas.
const MAX_ARCHIVO_GRANDE_BYTES = 500 * 1024 * 1024;
// Lo que vale el enlace firmado a un archivo: un <video> lo pide por rangos sin poder mandar la contraseña.
const VIDA_ENLACE_MS = 4 * 60 * 60 * 1000;
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
// Lo que se manda a redactar, lo que vuelve para la descripción y cuánto de ella va de contexto.
const MAX_REDACCION = 4000;
const MAX_CONTEXTO_REDACCION = 1500;
// Cómo reescribir lo seleccionado ("más corto", "en inglés"…).
const MAX_INDICACION = 300;
// La fuente y el tamaño de letra de cada perfil: las fuentes que ofrece el tablero y el tamaño en % del normal.
const FUENTES = ['geist', 'sistema', 'inter', 'roboto', 'nunito', 'atkinson', 'lexend', 'serif'];
const TAMANO_MIN = 75;
const TAMANO_MAX = 150;
const MAX_INSTRUCCIONES_IA = 2000;
const MAX_CLAVE_IA = 500;
const MAX_MODELO_IA = 200;
const MAX_ETIQUETA = 40;
const MAX_ETIQUETAS_POR_PENDIENTE = 20;
// Las notas: apuntes de cursos, como en Notion, privados de quien las escribe.
const MAX_NOMBRE_CURSO = 80;
const MAX_ICONO = 16;
const MAX_TITULO_NOTA = 200;
const MAX_CONTENIDO_NOTA = 3 * 1024 * 1024;
const MAX_BODY_NOTA_BYTES = 4 * 1024 * 1024;
// Un recurso (un PDF del curso, por ejemplo) puede pesar más de lo que nginx deja pasar en una petición (11 MB):
// se sube por partes de hasta 8 MB.
const MAX_RECURSO_BYTES = 300 * 1024 * 1024;
const MAX_PARTE_BYTES = 8 * 1024 * 1024;
const MAX_RESULTADOS_NOTAS = 30;
// En las notas, /ia puede devolver más que en una descripción (un resumen, una explicación).
const MAX_REDACCION_NOTA = 8000;
// Cambios en tiempo real: nginx corta una respuesta que pasa 12 s sin datos, así que el flujo manda un latido antes.
const LATIDO_MS = 9000;
const MAX_CONEXIONES = 500;
// Avisos por correo, como pidió el usuario: a las 9 de la mañana (hora de Lima, la del equipo) le llega un resumen de lo
// que no vio a quien tenga avisos de hace más de una hora sin ver, como mucho uno cada 2 días por persona. Lo de más de
// 3 días ya no se manda: al encenderlo no le llega a nadie todo lo atrasado.
const REGLAS_CORREO = { hora: 9, zona: 'America/Lima', dias: 2, esperaMs: 60 * 60_000, antiguedadMs: 3 * 24 * 60 * 60_000 };
const REVISAR_CORREOS_MS = 5 * 60_000;
const DIA_MS = 24 * 60 * 60_000;
const URL_TABLERO = 'https://timer.practi.dev/pendientes/';
// Al tercer pendiente seguido que alguien termina sin dejar un mensaje en su chat, el tablero le recuerda dejar la
// evidencia (las pruebas y los resultados).
const SIN_EVIDENCIA_PARA_RECORDAR = 3;
// Tras tantos intentos fallidos seguidos con un mismo usuario, se rechaza ese usuario durante la ventana.
const MAX_FALLOS = 10;
const VENTANA_FALLOS_MS = 15 * 60 * 1000;
// Una imagen que ya no aparece en la descripción se borra pasado este tiempo, para no
// pisar una subida en curso cuyo bloque todavía no llegó a guardarse.
const GRACIA_IMAGENES_MS = 60 * 60 * 1000;
// La descripción se guarda sola mientras se escribe: si la misma persona sigue editando dentro de
// este tiempo, el historial actualiza su última entrada en vez de sumar una nueva.
const UNIR_DESCRIPCION_MS = 10 * 60 * 1000;
// Escribir la descripción enseguida de crearlo ("Crear con IA" pone así sus imágenes) es parte de crearlo.
const DESCRIBIR_AL_CREAR_MS = 2 * 60 * 1000;
const ESTADOS = ['pendiente', 'haciendo', 'hecho'];
// El tipo de trabajo, como en los commits convencionales.
export const TIPOS = ['feat', 'fix', 'refactor', 'perf', 'docs', 'test', 'style', 'chore', 'ci'];
const COLORES = ['#2563EB', '#DB2777', '#059669', '#7C3AED', '#EA580C', '#0891B2', '#CA8A04', '#DC2626'];
const PERFILES_INICIALES = ['Favio', 'Diego', 'Junior'];
const UUID = '([0-9a-f-]{36})';
const API_PATH = '/api/pendientes';
const ORDER_PATH = '/api/pendientes/orden';
const YO_PATH = '/api/pendientes/yo';
const APARIENCIA_PATH = '/api/pendientes/yo/apariencia';
const AVISOS_POR_CORREO_PATH = '/api/pendientes/yo/avisos-por-correo';
const PERFILES_PATH = '/api/pendientes/perfiles';
const ORGANIZACIONES_PATH = '/api/pendientes/organizaciones';
const PROYECTOS_PATH = '/api/pendientes/proyectos';
const ACTIVIDAD_PATH = '/api/pendientes/actividad';
const NOTIFICACIONES_PATH = '/api/pendientes/notificaciones';
const LEIDAS_PATH = '/api/pendientes/notificaciones/leidas';
const IA_PATH = '/api/pendientes/ia';
const IA_MODELOS_PATH = '/api/pendientes/ia/modelos';
const IA_SUGERIR_PATH = '/api/pendientes/ia/sugerir';
const IA_REDACTAR_PATH = '/api/pendientes/ia/redactar';
const ETIQUETAS_PATH = '/api/pendientes/etiquetas';
const EVENTOS_PATH = '/api/pendientes/eventos';
const NOTAS_PATH = '/api/pendientes/notas';
const TODOS_LOS_ARCHIVOS_PATH = '/api/pendientes/archivos';
const NOTAS_BUSCAR_PATH = '/api/pendientes/notas/buscar';
const CURSOS_PATH = '/api/pendientes/notas/cursos';
const ITEM_PATH = new RegExp(`^/api/pendientes/${UUID}$`);
const PERFIL_PATH = new RegExp(`^/api/pendientes/perfiles/${UUID}$`);
const CONTRASENA_PATH = new RegExp(`^/api/pendientes/perfiles/${UUID}/contrasena$`);
const ORGANIZACION_PATH = new RegExp(`^/api/pendientes/organizaciones/${UUID}$`);
const PROYECTO_PATH = new RegExp(`^/api/pendientes/proyectos/${UUID}$`);
const SUBIR_IMAGEN_PATH = new RegExp(`^/api/pendientes/${UUID}/imagenes$`);
const IMAGEN_PATH = new RegExp(`^/api/pendientes/imagenes/${UUID}$`);
const TRAER_IMAGEN_PATH = '/api/pendientes/imagenes/traer';
const ACTIVIDAD_ITEM_PATH = new RegExp(`^/api/pendientes/${UUID}/actividad$`);
const COMENTARIOS_PATH = new RegExp(`^/api/pendientes/${UUID}/comentarios$`);
const COMENTARIO_PATH = new RegExp(`^/api/pendientes/comentarios/${UUID}$`);
const ARCHIVOS_PATH = new RegExp(`^/api/pendientes/${UUID}/archivos$`);
const ARCHIVO_PATH = new RegExp(`^/api/pendientes/archivos/${UUID}$`);
const PARTES_DE_ARCHIVO_PATH = new RegExp(`^/api/pendientes/archivos/${UUID}/partes$`);
const ENLACE_DE_ARCHIVO_PATH = new RegExp(`^/api/pendientes/archivos/${UUID}/enlace$`);
const ARCHIVO_REPETIDO_PATH = new RegExp(`^/api/pendientes/${UUID}/archivos/repetido$`);
const REUSAR_ARCHIVO_PATH = new RegExp(`^/api/pendientes/${UUID}/archivos/reusar$`);
const TRASPASO_PATH = new RegExp(`^/api/pendientes/${UUID}/traspaso$`);
const EVIDENCIA_PATH = new RegExp(`^/api/pendientes/${UUID}/evidencia$`);
const APROBACION_PATH = new RegExp(`^/api/pendientes/${UUID}/aprobacion$`);
const ETIQUETA_PATH = new RegExp(`^/api/pendientes/etiquetas/${UUID}$`);
const CURSO_PATH = new RegExp(`^/api/pendientes/notas/cursos/${UUID}$`);
const NOTAS_DE_CURSO_PATH = new RegExp(`^/api/pendientes/notas/cursos/${UUID}/notas$`);
const RECURSOS_DE_CURSO_PATH = new RegExp(`^/api/pendientes/notas/cursos/${UUID}/recursos$`);
const NOTA_PATH = new RegExp(`^/api/pendientes/notas/${UUID}$`);
const IMAGENES_DE_NOTA_PATH = new RegExp(`^/api/pendientes/notas/${UUID}/imagenes$`);
const IMAGEN_DE_NOTA_PATH = new RegExp(`^/api/pendientes/notas/imagenes/${UUID}$`);
const RECURSO_PATH = new RegExp(`^/api/pendientes/notas/recursos/${UUID}$`);
const PARTES_DE_RECURSO_PATH = new RegExp(`^/api/pendientes/notas/recursos/${UUID}/partes$`);
const IA_TRABAJO_PATH = new RegExp(`^/api/pendientes/ia/sugerir/${UUID}$`);
const RECURSO_REPETIDO_PATH = new RegExp(`^/api/pendientes/notas/cursos/${UUID}/recursos/repetido$`);
// Lo que se guarda el resultado de un trabajo de la IA que nadie vino a buscar.
const VIDA_TRABAJO_IA_MS = 10 * 60_000;
const RUTAS_FIJAS = [API_PATH, ORDER_PATH, YO_PATH, APARIENCIA_PATH, AVISOS_POR_CORREO_PATH, PERFILES_PATH, ORGANIZACIONES_PATH, PROYECTOS_PATH, ACTIVIDAD_PATH, NOTIFICACIONES_PATH, LEIDAS_PATH,
  IA_PATH, IA_MODELOS_PATH, IA_SUGERIR_PATH, IA_REDACTAR_PATH, ETIQUETAS_PATH, EVENTOS_PATH, NOTAS_PATH, NOTAS_BUSCAR_PATH, CURSOS_PATH, TODOS_LOS_ARCHIVOS_PATH,
  TRAER_IMAGEN_PATH];
const RUTAS_CON_ID = [ITEM_PATH, PERFIL_PATH, CONTRASENA_PATH, ORGANIZACION_PATH, PROYECTO_PATH, SUBIR_IMAGEN_PATH, IMAGEN_PATH,
  ACTIVIDAD_ITEM_PATH, COMENTARIOS_PATH, COMENTARIO_PATH, ARCHIVOS_PATH, ARCHIVO_PATH, TRASPASO_PATH, EVIDENCIA_PATH, APROBACION_PATH, ETIQUETA_PATH,
  CURSO_PATH, NOTAS_DE_CURSO_PATH, RECURSOS_DE_CURSO_PATH, NOTA_PATH, IMAGENES_DE_NOTA_PATH, IMAGEN_DE_NOTA_PATH, RECURSO_PATH, PARTES_DE_RECURSO_PATH, IA_TRABAJO_PATH, RECURSO_REPETIDO_PATH,
  PARTES_DE_ARCHIVO_PATH, ENLACE_DE_ARCHIVO_PATH, ARCHIVO_REPETIDO_PATH, REUSAR_ARCHIVO_PATH];
// Las filas que apuntan a un archivo guardado por su contenido (DATA_DIR/blobs/<sha256>).
const TABLAS_CON_BLOB = ['imagenes', 'archivos', 'nota_imagenes', 'recursos'];
const SHA256 = /^[0-9a-f]{64}$/;
const COLUMNAS_PENDIENTE = `id, texto, proyecto_id, estado, tipo, perfil_id, creado_por, resumen, num_imagenes, creado_en, actualizado_en, hecho_en,
  (SELECT COUNT(*) FROM comentarios c WHERE c.pendiente_id = pendientes.id) AS num_comentarios,
  (SELECT COUNT(*) FROM archivos a WHERE a.pendiente_id = pendientes.id AND a.borrador = 0 AND a.subido IS NULL) AS num_archivos,
  (SELECT COUNT(*) FROM archivos a WHERE a.pendiente_id = pendientes.id AND a.borrador = 0 AND a.subido IS NULL AND a.tipo LIKE 'video/%') AS num_videos,
  (SELECT json_group_array(pe.etiqueta_id) FROM pendiente_etiquetas pe WHERE pe.pendiente_id = pendientes.id) AS etiquetas,
  (SELECT json_group_array(ap.perfil_id ORDER BY ap.creado_en, ap.rowid) FROM aprobaciones ap WHERE ap.pendiente_id = pendientes.id) AS aprobaciones`;
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
const SELECT_ARCHIVO = 'SELECT id, pendiente_id, comentario_id, nombre, tipo, tamano, subido, perfil_id, autor, creado_en FROM archivos';
// Lo de las notas se busca siempre junto con el dueño del curso: lo de otro perfil no existe.
const SELECT_CURSO = 'SELECT id, nombre, icono, creado_en, actualizado_en FROM cursos';
const SELECT_NOTA = 'SELECT n.id, n.curso_id, n.titulo, n.creado_en, n.actualizado_en FROM notas n JOIN cursos c ON c.id = n.curso_id';
const SELECT_RECURSO = 'SELECT r.id, r.curso_id, r.nombre, r.tipo, r.tamano, r.subido, r.creado_en FROM recursos r JOIN cursos c ON c.id = r.curso_id';

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
  // Cuándo se terminó cada pendiente (el tablero archiva los hechos viejos), su tipo (feat, fix…),
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
  // Notas privadas: cursos de un perfil con sus notas (el documento del editor y su texto plano, para buscar) y sus
  // recursos (PDF y otros archivos, que se suben por partes: `subido` dice cuánto llegó). Las imágenes pegadas en una
  // nota son de su dueño y no de la nota, porque un bloque copiado a otra nota sigue usando el mismo archivo.
  (db) => {
    db.exec(`
      CREATE TABLE cursos (
        id TEXT PRIMARY KEY,
        perfil_id TEXT NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        icono TEXT NOT NULL,
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX cursos_perfil ON cursos (perfil_id, creado_en);
      CREATE TABLE notas (
        id TEXT PRIMARY KEY,
        curso_id TEXT NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
        titulo TEXT NOT NULL DEFAULT '',
        contenido TEXT,
        texto TEXT NOT NULL DEFAULT '',
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL
      );
      CREATE INDEX notas_curso ON notas (curso_id, creado_en);
      CREATE TABLE recursos (
        id TEXT PRIMARY KEY,
        curso_id TEXT NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        tipo TEXT NOT NULL,
        tamano INTEGER NOT NULL,
        subido INTEGER NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX recursos_curso ON recursos (curso_id, creado_en);
      CREATE TABLE nota_imagenes (
        id TEXT PRIMARY KEY,
        perfil_id TEXT NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
        nota_id TEXT,
        tipo TEXT NOT NULL,
        tamano INTEGER NOT NULL,
        creado_en TEXT NOT NULL
      );
      CREATE INDEX nota_imagenes_perfil ON nota_imagenes (perfil_id, nota_id);
    `);
  },
  // Cada archivo se guarda una sola vez por su contenido: cada fila dice cuál es el suyo (sha256 en hexadecimal). Lo
  // ya guardado (un archivo por fila) lo pasa openDb, que conoce la carpeta de datos.
  (db) => {
    db.exec(TABLAS_CON_BLOB.map((tabla) => `ALTER TABLE ${tabla} ADD COLUMN sha256 TEXT; CREATE INDEX ${tabla}_sha256 ON ${tabla} (sha256);`).join('\n'));
  },
  // Cuándo se mandó cada aviso por correo (null: todavía no), para no mandarlo dos veces.
  (db) => {
    db.exec('ALTER TABLE notificaciones ADD COLUMN correo_en TEXT');
  },
  // Aprobaciones: otros perfiles dan por buena la funcionalidad de un pendiente hecho. Se pierden si sale de Hecho (se
  // vuelve a trabajar), y quien queda a cargo no puede tener la suya.
  (db) => {
    db.exec(`
      CREATE TABLE aprobaciones (
        pendiente_id TEXT NOT NULL REFERENCES pendientes(id) ON DELETE CASCADE,
        perfil_id TEXT NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
        creado_en TEXT NOT NULL,
        PRIMARY KEY (pendiente_id, perfil_id)
      );
      CREATE TRIGGER aprobaciones_al_salir_de_hecho AFTER UPDATE OF estado ON pendientes
        WHEN OLD.estado = 'hecho' AND NEW.estado <> 'hecho'
        BEGIN DELETE FROM aprobaciones WHERE pendiente_id = NEW.id; END;
      CREATE TRIGGER aprobaciones_del_responsable AFTER UPDATE OF perfil_id ON pendientes
        WHEN NEW.perfil_id IS NOT NULL
        BEGIN DELETE FROM aprobaciones WHERE pendiente_id = NEW.id AND perfil_id = NEW.perfil_id; END;
    `);
  },
  // Adjuntos grandes, subidos por partes: `subido` dice cuánto llegó mientras se sube; NULL, que ya está completo.
  // Mientras tanto viven en subidas/<id>.parcial, sin sha256, y no se listan ni se cuentan.
  (db) => {
    db.exec('ALTER TABLE archivos ADD COLUMN subido INTEGER');
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

// La respuesta para un error: su código (y lo que dijo el proveedor de IA, si viene); lo inesperado no se detalla.
function comoError(error) {
  const status = error.statusCode || (error instanceof SyntaxError ? 400 : 500);
  if (status === 500) console.error(error);
  return { status, cuerpo: { error: status === 500 ? 'internal_error' : error.message, ...(error.detalle && { detalle: error.detalle }) } };
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

// Al pegar lo copiado de otra página, sus imágenes pasan a ser del pendiente (o de la nota). El navegador no puede leer
// una imagen de otro sitio (CORS), así que la pide el servidor: solo de internet, nunca de la propia máquina ni de las
// redes internas (la del servidor, Tailscale…). Se mira la dirección a la que de verdad se conecta, también en cada
// redirección, y solo se devuelve si el contenido es una imagen.
const REDES_INTERNAS = new BlockList();
for (const [red, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) {
  REDES_INTERNAS.addSubnet(red, bits, 'ipv4');
}
// :: y ::1, las IPv4 escritas como IPv6 (y por NAT64), las privadas, las de enlace local y multicast.
for (const [red, bits] of [['::', 127], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  REDES_INTERNAS.addSubnet(red, bits, 'ipv6');
}
const esInterna = (direccion) => REDES_INTERNAS.check(direccion, isIP(direccion) === 6 ? 'ipv6' : 'ipv4');

// Como dns.lookup, pero falla si el nombre lleva a alguna dirección interna.
function buscarSoloPublicas(nombre, opciones, listo) {
  lookup(nombre, { ...opciones, all: true }, (error, direcciones) => {
    if (error) return listo(error);
    if (direcciones.length === 0 || direcciones.some(({ address }) => esInterna(address))) return listo(httpError(422, 'imagen_externa_invalida'));
    return opciones.all ? listo(null, direcciones) : listo(null, direcciones[0].address, direcciones[0].family);
  });
}

function pedirImagenExterna(direccion, vence, redesInternas) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(direccion);
    } catch {
      return reject(httpError(422, 'imagen_externa_invalida'));
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (!redesInternas && isIP(host) && esInterna(host))) {
      return reject(httpError(422, 'imagen_externa_invalida'));
    }
    const fallar = (error) => {
      clearTimeout(reloj);
      reject(error.statusCode ? error : httpError(422, 'imagen_externa_no_disponible'));
    };
    const pedido = (url.protocol === 'https:' ? https : http).get(url, {
      agent: false,
      lookup: redesInternas ? undefined : buscarSoloPublicas,
      headers: { Accept: 'image/png,image/jpeg,image/gif,image/webp;q=0.9,*/*;q=0.1', 'User-Agent': 'Mozilla/5.0 (Pendientes)' },
    }, (res) => {
      res.on('error', fallar);
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        clearTimeout(reloj);
        return resolve({ redireccion: new URL(res.headers.location, url).href });
      }
      if (res.statusCode !== 200) {
        res.resume();
        return fallar(httpError(422, 'imagen_externa_no_disponible'));
      }
      const partes = [];
      let tamano = 0;
      res.on('data', (parte) => {
        tamano += parte.length;
        if (tamano > MAX_IMAGEN_EXTERNA_BYTES) pedido.destroy(httpError(413, 'imagen_muy_grande'));
        else partes.push(parte);
      });
      res.on('end', () => {
        clearTimeout(reloj);
        const contenido = Buffer.concat(partes);
        const tipo = tipoDeImagen(contenido);
        if (tipo) resolve({ tipo, contenido });
        else reject(httpError(415, 'imagen_invalida'));
      });
    });
    const reloj = setTimeout(() => pedido.destroy(httpError(504, 'imagen_externa_tardo')), Math.max(0, vence - Date.now()));
    pedido.on('error', fallar);
  });
}

// `redesInternas`: solo para las pruebas, que sirven las imágenes desde la propia máquina.
export async function traerImagenExterna(direccion, { redesInternas = false } = {}) {
  const vence = Date.now() + TIEMPO_IMAGEN_EXTERNA_MS;
  let url = direccion;
  for (let salto = 0; salto <= MAX_REDIRECCIONES_IMAGEN; salto++) {
    const respuesta = await pedirImagenExterna(url, vence, redesInternas);
    if (!respuesta.redireccion) return respuesta;
    url = respuesta.redireccion;
  }
  throw httpError(422, 'imagen_externa_no_disponible');
}

// Lo que el navegador puede mostrar o reproducir: imágenes, PDF, videos y audios (se mira el contenido, como en las
// imágenes). Cualquier otra cosa se guarda tal cual y solo se descarga.
export function tipoDeArchivo(buffer) {
  if (tipoDeImagen(buffer)) return tipoDeImagen(buffer);
  const ascii = (inicio, fin) => buffer.subarray(inicio, fin).toString('latin1');
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  // MP4, MOV y M4A empiezan con una caja "ftyp" que dice la marca.
  if (ascii(4, 8) === 'ftyp') {
    const marca = ascii(8, 12);
    if (marca === 'qt  ') return 'video/quicktime';
    if (marca === 'M4A ' || marca === 'M4B ') return 'audio/mp4';
    return 'video/mp4';
  }
  if (buffer.length >= 4 && buffer.readUInt32BE(0) === 0x1a45dfa3 && ascii(0, 64).includes('webm')) return 'video/webm';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(0, 3) === 'ID3' || (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe6) === 0xe2)) return 'audio/mpeg';
  return 'application/octet-stream';
}

// Manda un archivo guardado en el disco. Si el navegador pide un rango (un <video> al empezar o al adelantar), solo
// ese pedazo. Nada se ejecuta como página de este sitio; lo que no se muestra se descarga.
function enviarGuardado(req, res, { ruta, tamano, tipo, nombre, descargar = false }) {
  const enLinea = !descargar && tipo !== 'application/octet-stream';
  const cabeceras = {
    'Content-Type': tipo,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': `${enLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  let inicio = 0;
  let fin = tamano - 1;
  const rango = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? '').trim());
  if (rango && (rango[1] || rango[2])) {
    if (rango[1]) {
      inicio = Number(rango[1]);
      if (rango[2]) fin = Math.min(Number(rango[2]), tamano - 1);
    } else {
      inicio = Math.max(tamano - Number(rango[2]), 0);
    }
    if (inicio > fin) {
      res.writeHead(416, { 'Content-Range': `bytes */${tamano}` });
      return res.end();
    }
    cabeceras['Content-Range'] = `bytes ${inicio}-${fin}/${tamano}`;
  }
  cabeceras['Content-Length'] = fin - inicio + 1;
  res.writeHead(cabeceras['Content-Range'] ? 206 : 200, cabeceras);
  const flujo = createReadStream(ruta, { start: inicio, end: fin });
  flujo.on('error', (error) => res.destroy(error));
  return flujo.pipe(res);
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
export function resumirDescripcion(bloques, maximo = MAX_RESUMEN) {
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
  const resumen = textos.join(' ').replace(/\s+/g, ' ').trim().slice(0, maximo);
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
// Unos avisos por id, todos, o los de un pendiente (al abrirlo).
export function parseLeidas(input) {
  if (input.pendiente_id !== undefined) {
    if (typeof input.pendiente_id !== 'string' || input.pendiente_id === '') throw httpError(422, 'pendiente_invalido');
    return { pendienteId: input.pendiente_id };
  }
  if (input.ids === undefined) return { ids: null };
  if (!Array.isArray(input.ids) || input.ids.length > 500 || input.ids.some((id) => typeof id !== 'string')) throw httpError(422, 'ids_invalidos');
  return { ids: input.ids };
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
  // La IA de "Escribir con IA" (/ia): un proveedor y un modelo propios, o null para usar la del equipo.
  if ('redaccion' in input) {
    const { redaccion } = input;
    if (redaccion !== null) {
      if (typeof redaccion !== 'object' || !Object.hasOwn(PROVEEDORES_IA, redaccion?.proveedor)) throw httpError(422, 'proveedor_invalido');
      const { modelo } = redaccion;
      if (typeof modelo !== 'string' || !/^\S+$/.test(modelo.trim()) || modelo.trim().length > MAX_MODELO_IA) throw httpError(422, 'modelo_invalido');
    }
    changes.redaccion = redaccion && { proveedor: redaccion.proveedor, modelo: redaccion.modelo.trim() };
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

// En el chat o la descripción de un pendiente (pendiente_id), o en una nota (nota_id). Con `seleccion`, el texto es lo
// que se seleccionó en el editor y vuelve solo su reemplazo; `indicacion` dice cómo reescribirlo.
export function parseRedaccion(input) {
  const texto = typeof input.texto === 'string' ? input.texto.trim() : '';
  if (!texto || texto.length > MAX_REDACCION) throw httpError(422, 'texto_ia_invalido');
  if (!['chat', 'descripcion', 'nota'].includes(input.donde)) throw httpError(422, 'donde_invalido');
  if ('seleccion' in input && typeof input.seleccion !== 'boolean') throw httpError(422, 'seleccion_invalida');
  const indicacion = typeof input.indicacion === 'string' ? input.indicacion.trim() : '';
  if (input.indicacion != null && (typeof input.indicacion !== 'string' || indicacion.length > MAX_INDICACION)) {
    throw httpError(422, 'indicacion_invalida');
  }
  const extra = { seleccion: input.seleccion === true, indicacion: indicacion || null };
  if (input.donde === 'nota') {
    if (typeof input.nota_id !== 'string' || !input.nota_id) throw httpError(422, 'nota_id_invalido');
    return { texto, donde: input.donde, nota_id: input.nota_id, ...extra };
  }
  if (typeof input.pendiente_id !== 'string' || !input.pendiente_id) throw httpError(422, 'pendiente_invalido');
  return { texto, donde: input.donde, pendiente_id: input.pendiente_id, ...extra };
}

// La fuente y el tamaño de letra que elige cada persona para sí.
export function parseApariencia(input) {
  if (!FUENTES.includes(input.fuente)) throw httpError(422, 'apariencia_invalida');
  if (!Number.isInteger(input.tamano) || input.tamano < TAMANO_MIN || input.tamano > TAMANO_MAX) throw httpError(422, 'apariencia_invalida');
  return { fuente: input.fuente, tamano: input.tamano };
}

// El ícono de un curso es un emoji (o unas pocas letras): se muestra como texto.
export function parseCurso(input, { partial = false } = {}) {
  const changes = {};
  if (!partial || 'nombre' in input) changes.nombre = nombreValido(input.nombre, MAX_NOMBRE_CURSO, 'nombre_curso_invalido');
  if ('icono' in input) {
    const icono = typeof input.icono === 'string' ? input.icono.trim() : '';
    if (!icono || icono.length > MAX_ICONO || /[\u0000-\u001f\u007f]/.test(icono)) throw httpError(422, 'icono_invalido');
    changes.icono = icono;
  }
  return changes;
}

// El título puede quedar vacío ("Sin título"); el contenido es el documento del editor, en JSON.
export function parseNota(input, { partial = false } = {}) {
  const changes = {};
  if (!partial || 'titulo' in input) {
    if (input.titulo !== undefined && typeof input.titulo !== 'string') throw httpError(422, 'titulo_nota_invalido');
    const titulo = (input.titulo ?? '').replace(/\s+/g, ' ').trim();
    if (titulo.length > MAX_TITULO_NOTA) throw httpError(422, 'titulo_nota_invalido');
    changes.titulo = titulo;
  }
  if ('contenido' in input) {
    if (input.contenido !== null) {
      if (typeof input.contenido !== 'string' || input.contenido.length > MAX_CONTENIDO_NOTA) throw httpError(422, 'contenido_nota_invalido');
      let bloques;
      try { bloques = JSON.parse(input.contenido); } catch { throw httpError(422, 'contenido_nota_invalido'); }
      if (!Array.isArray(bloques)) throw httpError(422, 'contenido_nota_invalido');
    }
    changes.contenido = input.contenido;
  }
  if ('curso_id' in input) {
    if (typeof input.curso_id !== 'string' || !input.curso_id) throw httpError(422, 'curso_invalido');
    changes.curso_id = input.curso_id;
  }
  return changes;
}

// Sin tildes ni mayúsculas, para buscar en las notas.
const normalizar = (texto) => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Un pedazo del texto alrededor de donde aparece lo buscado.
export function extractoDe(texto, palabra, largo = 160) {
  const donde = Math.max(normalizar(texto).indexOf(palabra), 0);
  const desde = Math.max(donde - 50, 0);
  const pedazo = texto.slice(desde, desde + largo).trim();
  if (!pedazo) return null;
  return `${desde > 0 ? '…' : ''}${pedazo}${desde + largo < texto.length ? '…' : ''}`;
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
export function iaPublica({ proveedor, instrucciones, tipo_automatico: tipoAutomatico, redaccion, modelos, claves }) {
  return {
    proveedor,
    instrucciones,
    tipo_automatico: tipoAutomatico,
    lista: Boolean(proveedor && claves[proveedor]),
    redaccion: redaccion && { ...redaccion, lista: Boolean(claves[redaccion.proveedor]) },
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
const pendienteFila = (row) => (row ? { ...row, etiquetas: JSON.parse(row.etiquetas).sort(), aprobaciones: JSON.parse(row.aprobaciones) } : null);

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
  mkdirSync(path.join(dataDir, 'blobs'), { recursive: true });
  // Ahí quedan los recursos mientras se suben por partes.
  mkdirSync(path.join(dataDir, 'notas', 'recursos'), { recursive: true });
  // Y los adjuntos grandes del tablero.
  mkdirSync(path.join(dataDir, 'subidas'), { recursive: true });
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
  adoptarArchivosSueltos(db, dataDir);
  return db;
}

// La hora de `ms` en `zona` y el instante en que empezó ese día allí (a medianoche).
function enZona(ms, zona) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(ms).map(({ type, value }) => [type, Number(value)]));
  const desfase = Date.UTC(partes.year, partes.month - 1, partes.day, partes.hour, partes.minute, partes.second) - Math.floor(ms / 1000) * 1000;
  return { hora: partes.hour, medianoche: Date.UTC(partes.year, partes.month - 1, partes.day) - desfase };
}

function hashDeArchivoSync(ruta) {
  const hash = createHash('sha256');
  const trozo = Buffer.alloc(1024 * 1024);
  const fd = openSync(ruta, 'r');
  try {
    for (let leidos; (leidos = readSync(fd, trozo, 0, trozo.length, null)) > 0;) hash.update(trozo.subarray(0, leidos));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

async function hashDeArchivo(ruta) {
  const hash = createHash('sha256');
  for await (const trozo of createReadStream(ruta)) hash.update(trozo);
  return hash.digest('hex');
}

// Lo guardado antes de v10, un archivo por fila (imagenes/<id>, archivos/<id>, notas/imagenes/<id> y
// notas/recursos/<id>), pasa a guardarse por contenido. Primero el blob (un enlace, sin copiar), después la fila y al
// final se borra el viejo: si se corta a la mitad, la próxima vez sigue donde quedó.
function adoptarArchivosSueltos(db, dataDir) {
  const carpetas = { imagenes: ['imagenes'], archivos: ['archivos'], nota_imagenes: ['notas', 'imagenes'], recursos: ['notas', 'recursos'] };
  for (const [tabla, carpeta] of Object.entries(carpetas)) {
    const completos = { recursos: ' AND subido = tamano', archivos: ' AND subido IS NULL' }[tabla] ?? '';
    const filas = db.prepare(`SELECT id FROM ${tabla} WHERE sha256 IS NULL${completos}`).all();
    for (const { id } of filas) {
      const viejo = path.join(dataDir, ...carpeta, id);
      if (!existsSync(viejo)) continue;
      const hash = hashDeArchivoSync(viejo);
      const blob = path.join(dataDir, 'blobs', hash);
      if (!existsSync(blob)) {
        try {
          linkSync(viejo, blob);
        } catch {
          copyFileSync(viejo, blob);
        }
      }
      db.prepare(`UPDATE ${tabla} SET sha256 = ? WHERE id = ?`).run(hash, id);
      unlinkSync(viejo);
    }
  }
}

// Todos los métodos que tocan pendientes, proyectos u organizaciones reciben `yo`: el id del perfil
// que pregunta, o null si entró con la cuenta del equipo. Lo que no puede ver se trata como inexistente.
function createRepo(db, dataDir, graciaImagenesMs) {
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
    const mia = ultima?.perfil_id === quien.perfil_id && ultima?.autor === quien.nombre;
    const hace = ultima ? Date.now() - Date.parse(ultima.creado_en) : Infinity;
    if (mia && ultima.tipo === 'creado' && hace < DESCRIBIR_AL_CREAR_MS) return;
    if (mia && ultima.tipo === 'descripcion' && !ultima.datos && hace < UNIR_DESCRIPCION_MS) {
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

  const borrarSiEsta = (ruta) => unlink(ruta).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });

  // Cada archivo se guarda una sola vez por su contenido, en DATA_DIR/blobs/<sha256>, y las filas de imagenes,
  // archivos, nota_imagenes y recursos apuntan al suyo: subir lo mismo otra vez no ocupa más lugar, y del disco se
  // borra recién cuando ya ninguna fila lo usa. Quién puede leer qué lo siguen diciendo las filas, nunca el contenido.
  const blob = (hash) => path.join(dataDir, 'blobs', hash);
  const usaBlob = db.prepare(`${TABLAS_CON_BLOB.map((tabla) => `SELECT 1 FROM ${tabla} WHERE sha256 = :hash`).join(' UNION ALL ')} LIMIT 1`);
  // Guardar y soltar el mismo contenido van en fila: si no, un blob se podría borrar justo cuando otra subida lo reusa.
  const candados = new Map();
  function conCandado(hash, trabajo) {
    const turno = (candados.get(hash) ?? Promise.resolve()).then(trabajo);
    const cola = turno.catch(() => {});
    candados.set(hash, cola);
    cola.then(() => candados.get(hash) === cola && candados.delete(hash));
    return turno;
  }

  // Ya fuera de las filas que lo usaban: el contenido que nadie más usa se borra del disco.
  async function soltar(hashes) {
    for (const hash of new Set(hashes.filter(Boolean))) {
      await conCandado(hash, async () => {
        if (!usaBlob.get({ hash })) await borrarSiEsta(blob(hash));
      });
    }
  }

  // Guarda el contenido (si no estaba) y, sin soltar el candado, la fila que lo usa: `registrar(hash)`.
  async function guardarContenido(contenido, registrar) {
    const hash = createHash('sha256').update(contenido).digest('hex');
    return conCandado(hash, async () => {
      if (!existsSync(blob(hash))) {
        const temporal = `${blob(hash)}.${randomUUID()}.tmp`;
        await writeFile(temporal, contenido, { mode: 0o600 });
        await rename(temporal, blob(hash));
      }
      return registrarSinPerder(hash, registrar);
    });
  }

  // Lo mismo con un archivo ya escrito (un recurso que terminó de subirse): pasa a ser el blob, o se borra si ya estaba.
  async function adoptarArchivo(ruta, registrar) {
    const hash = await hashDeArchivo(ruta);
    return conCandado(hash, async () => {
      if (existsSync(blob(hash))) await unlink(ruta);
      else await rename(ruta, blob(hash));
      return registrarSinPerder(hash, registrar);
    });
  }

  // Si la fila no se pudo guardar, el blob recién puesto no queda suelto.
  async function registrarSinPerder(hash, registrar) {
    try {
      return registrar(hash);
    } catch (error) {
      if (!usaBlob.get({ hash })) await borrarSiEsta(blob(hash));
      throw error;
    }
  }

  async function leerContenido(hash) {
    try {
      return hash ? await readFile(blob(hash)) : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  const esAutor = (quien, row) => (row.perfil_id ? row.perfil_id === quien.perfil_id : quien.perfil_id === null && row.autor === quien.nombre);

  // Un adjunto grande, mientras se sube por partes.
  const parcialDeArchivo = (id) => path.join(dataDir, 'subidas', `${id}.parcial`);
  // Los que están recibiendo una parte: dos a la vez se pisarían.
  const recibiendoArchivos = new Set();

  // Ya borradas sus filas: lo que quedó a medias y el contenido que nadie más usa.
  async function soltarArchivos(filas) {
    await Promise.all(filas.map(({ id }) => borrarSiEsta(parcialDeArchivo(id))));
    await soltar(filas.map((row) => row.sha256));
  }

  // Archivos de un mensaje que nunca se envió, y los que quedaron a medias (se cerró la página mientras subían).
  async function limpiarBorradores() {
    const limite = new Date(Date.now() - VIDA_BORRADOR_MS).toISOString();
    const viejos = db.prepare('SELECT id, sha256 FROM archivos WHERE (borrador = 1 OR subido IS NOT NULL) AND creado_en < ?').all(limite)
      .filter(({ id }) => !recibiendoArchivos.has(id));
    const borrar = db.prepare('DELETE FROM archivos WHERE id = ?');
    for (const { id } of viejos) borrar.run(id);
    await soltarArchivos(viejos);
  }

  // Otra fila de archivos que apunta a un contenido que ya está guardado (reusar un adjunto, o subir uno repetido).
  // Si ese pendiente ya lo tiene, devuelve el que estaba.
  function copiarArchivo(quien, item, { nombre, tipo, tamano, sha256 }, paraChat) {
    return conCandado(sha256, () => {
      if (!existsSync(blob(sha256))) throw httpError(422, 'archivo_invalido');
      const yaEsta = !paraChat && db.prepare(`${SELECT_ARCHIVO} WHERE pendiente_id = ? AND sha256 = ? AND borrador = 0 AND subido IS NULL LIMIT 1`)
        .get(item.id, sha256);
      if (yaEsta) return fila(yaEsta);
      const id = randomUUID();
      return transaction(db, () => {
        db.prepare(`INSERT INTO archivos (id, pendiente_id, comentario_id, borrador, nombre, tipo, tamano, perfil_id, autor, creado_en, sha256)
          VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, item.id, paraChat ? 1 : 0, nombre, tipo, tamano, quien.perfil_id, quien.nombre, new Date().toISOString(), sha256);
        if (!paraChat) registrar(quien, item, 'archivo', { archivo_id: id, nombre }, [item.creado_por]);
        return fila(db.prepare(`${SELECT_ARCHIVO} WHERE id = ?`).get(id));
      });
    });
  }

  // Lo nuevo va arriba de todo; lo que recibe un responsable, al final de la cola de su columna (el orden es uno
  // solo para todo el tablero, así que después de todo queda último también en su columna).
  const arriba = () => db.prepare('SELECT COALESCE(MIN(posicion), 0) - 1 AS posicion FROM pendientes').get().posicion;
  const alFinal = () => db.prepare('SELECT COALESCE(MAX(posicion), 0) + 1 AS posicion FROM pendientes').get().posicion;

  // Imágenes del pendiente que pasaron el tiempo de gracia y ya no aparecen en ninguna descripción
  // (un bloque copiado a otra tarjeta sigue usando el mismo archivo).
  async function limpiarImagenes(pendienteId) {
    const limite = new Date(Date.now() - graciaImagenesMs).toISOString();
    const enUso = db.prepare('SELECT 1 FROM pendientes WHERE instr(descripcion, ?) > 0 LIMIT 1');
    const sobrantes = db.prepare('SELECT id, sha256 FROM imagenes WHERE pendiente_id = ? AND creado_en <= ?').all(pendienteId, limite)
      .filter(({ id }) => !enUso.get(`${API_PATH}/imagenes/${id}`));
    const borrar = db.prepare('DELETE FROM imagenes WHERE id = ?');
    for (const { id } of sobrantes) borrar.run(id);
    await soltar(sobrantes.map((row) => row.sha256));
  }

  // Notas: todo se busca con el dueño (`yo`); lo de otro perfil se trata como inexistente.
  // Mientras se sube por partes, un recurso vive en notas/recursos/<id>.parcial; completo, pasa a ser un blob.
  const parcialDeRecurso = (id) => path.join(dataDir, 'notas', 'recursos', `${id}.parcial`);
  const curso = (yo, id) => fila(db.prepare(`${SELECT_CURSO} WHERE id = ? AND perfil_id = ?`).get(id, yo));
  const nota = (yo, id) => fila(db.prepare(`${SELECT_NOTA} WHERE n.id = ? AND c.perfil_id = ?`).get(id, yo));
  const recurso = (yo, id) => fila(db.prepare(`${SELECT_RECURSO} WHERE r.id = ? AND c.perfil_id = ?`).get(id, yo));
  // Los recursos que se están subiendo: dos partes del mismo a la vez se pisarían.
  const recibiendo = new Set();

  // Ya borradas sus filas: lo que quedó a medias y el contenido que nadie más usa.
  async function soltarRecursos(filas) {
    await Promise.all(filas.map(({ id }) => borrarSiEsta(parcialDeRecurso(id))));
    await soltar(filas.map((row) => row.sha256));
  }

  // Lo que quedó a medias (se cerró la página mientras subía) se borra pasado un día.
  async function limpiarRecursosAMedias() {
    const limite = new Date(Date.now() - VIDA_BORRADOR_MS).toISOString();
    const viejos = db.prepare('SELECT id, sha256 FROM recursos WHERE subido < tamano AND creado_en < ?').all(limite)
      .filter(({ id }) => !recibiendo.has(id));
    const borrar = db.prepare('DELETE FROM recursos WHERE id = ?');
    for (const { id } of viejos) borrar.run(id);
    await soltarRecursos(viejos);
  }

  // Imágenes de una nota (o de notas que ya no existen) que pasaron el tiempo de gracia y no aparecen en ninguna nota
  // de su dueño.
  async function limpiarImagenesDeNotas(yo, notaId = null) {
    const limite = new Date(Date.now() - graciaImagenesMs).toISOString();
    const enUso = db.prepare('SELECT 1 FROM notas n JOIN cursos c ON c.id = n.curso_id WHERE c.perfil_id = ? AND instr(n.contenido, ?) > 0 LIMIT 1');
    const sobrantes = db.prepare(`SELECT id, sha256 FROM nota_imagenes WHERE perfil_id = ? AND creado_en <= ?
        AND (nota_id = ? OR nota_id IS NULL OR nota_id NOT IN (SELECT id FROM notas))`).all(yo, limite, notaId)
      .filter(({ id }) => !enUso.get(yo, `${NOTAS_PATH}/imagenes/${id}`));
    const borrar = db.prepare('DELETE FROM nota_imagenes WHERE id = ?');
    for (const { id } of sobrantes) borrar.run(id);
    await soltar(sobrantes.map((row) => row.sha256));
  }

  // La IA que redacta: la de "Escribir con IA" si el equipo eligió otra, o la del equipo.
  // Lo que se agrega a las instrucciones al reescribir una selección.
  const conIndicaciones = (extra) => indicacionesDeSeleccion(extra).map((linea) => `\n${linea}`).join('');

  function iaDeRedaccion(ajustes) {
    const { redaccion, modelos, claves, proveedor: delEquipo } = ajustes;
    const proveedor = redaccion?.proveedor ?? delEquipo;
    if (!proveedor) throw httpError(422, 'ia_no_configurada');
    if (!claves[proveedor]) throw httpError(422, 'ia_sin_clave');
    return { proveedor, modelo: redaccion?.modelo ?? modelos[proveedor] ?? PROVEEDORES_IA[proveedor].modelo, clave: claves[proveedor] };
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

    // La fuente y el tamaño de letra de cada persona (la cuenta del equipo tiene los suyos), o null si no eligió.
    apariencia(yo) {
      const guardada = db.prepare('SELECT valor FROM ajustes WHERE clave = ?').get(`apariencia:${yo ?? 'equipo'}`);
      return guardada ? JSON.parse(guardada.valor) : null;
    },

    guardarApariencia(yo, apariencia) {
      db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor')
        .run(`apariencia:${yo ?? 'equipo'}`, JSON.stringify(apariencia));
      return apariencia;
    },

    // Si le llegan por correo los avisos que no vio. Encendido salvo que lo apague.
    avisosPorCorreo: (yo) => db.prepare('SELECT valor FROM ajustes WHERE clave = ?').get(`avisos_por_correo:${yo}`)?.valor !== 'no',

    guardarAvisosPorCorreo(yo, activo) {
      db.prepare('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor')
        .run(`avisos_por_correo:${yo}`, activo ? 'si' : 'no');
      return activo;
    },

    // A quién le toca un correo y con qué: a quien tiene correo, no lo apagó y no recibió ninguno desde `desde`, si su
    // aviso sin ver más viejo lleva más de `esperaMs`. Van todos los que no vio ni le llegaron ya por correo (de los últimos
    // `antiguedadMs`), del más viejo al más nuevo. Solo lo que puede ver, como en la campana.
    avisosParaCorreo({ ahora, desde, esperaMs, antiguedadMs }) {
      const hace = (ms) => new Date(ahora - ms).toISOString();
      const perfiles = db.prepare(`SELECT id, nombre, correo FROM perfiles p WHERE coalesce(correo, '') != ''
        AND NOT EXISTS (SELECT 1 FROM ajustes WHERE clave = 'avisos_por_correo:' || p.id AND valor = 'no')
        AND NOT EXISTS (SELECT 1 FROM notificaciones WHERE perfil_id = p.id AND correo_en >= ?)`).all(new Date(desde).toISOString());
      const sinVer = db.prepare(`SELECT n.id AS notificacion_id, n.creado_en AS avisado_en, a.id, a.pendiente_id, a.texto_pendiente,
          a.perfil_id, a.autor, a.tipo, a.datos, a.creado_en
        FROM notificaciones n JOIN actividad a ON a.id = n.actividad_id
        WHERE n.perfil_id = ? AND n.leida_en IS NULL AND n.correo_en IS NULL AND n.creado_en > ? AND ${ACTIVIDAD_VISIBLE}
        ORDER BY n.creado_en, n.rowid`);
      return perfiles
        .map((perfil) => ({ perfil: { ...perfil }, avisos: sinVer.all(perfil.id, hace(antiguedadMs), perfil.id, perfil.id) }))
        .filter(({ avisos }) => avisos.length > 0 && avisos[0].avisado_en <= hace(esperaMs))
        .map(({ perfil, avisos }) => ({
          perfil,
          ids: avisos.map((aviso) => aviso.notificacion_id),
          avisos: avisos.map(({ notificacion_id: _id, avisado_en: _en, ...actividad }) => actividadFila(actividad)),
        }));
    },

    marcarAvisosEnviados(ids, ahora) {
      const marcar = db.prepare('UPDATE notificaciones SET correo_en = ? WHERE id = ?');
      transaction(db, () => ids.forEach((id) => marcar.run(new Date(ahora).toISOString(), id)));
    },

    // La IA del equipo. Las claves solo salen de aquí hacia el proveedor elegido.
    ajustesIA() {
      const guardado = db.prepare("SELECT valor FROM ajustes WHERE clave = 'ia'").get();
      const ajustes = guardado ? JSON.parse(guardado.valor) : {};
      return {
        proveedor: ajustes.proveedor ?? null,
        instrucciones: ajustes.instrucciones ?? null,
        // Si un pendiente se crea sin tipo, la IA se lo pone (salvo que el equipo lo apague).
        tipo_automatico: ajustes.tipo_automatico ?? true,
        // "Escribir con IA" puede usar otra IA (por ejemplo, un modelo más rápido); null = la de arriba.
        redaccion: ajustes.redaccion ?? null,
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
        redaccion: 'redaccion' in changes ? changes.redaccion : actual.redaccion,
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
      // Las imágenes que muestran cada tarea, por su posición entre las enviadas (desde 0). Si sale una sola tarea y la
      // IA no eligió ninguna, se le ponen todas: casi siempre son la captura de lo que hay que hacer.
      const deLaTarea = (numeros, unica) => (unica && numeros.length === 0 ? imagenes.map((_, i) => i + 1) : numeros)
        .filter((numero) => numero >= 1 && numero <= imagenes.length)
        .map((numero) => numero - 1);
      const lista = sugerencias.slice(0, MAX_SUGERENCIAS);
      return lista.map((sugerencia) => ({
        texto: sugerencia.titulo.slice(0, MAX_TEXTO),
        detalle: sugerencia.detalle,
        perfil_id: perfilDe(sugerencia.responsable),
        proyecto_id: proyectoDe(sugerencia.proyecto) ?? proyectoId,
        tipo: sugerencia.tipo,
        etiquetas: [...new Set(sugerencia.etiquetas.map((nombre) => etiquetas.find((e) => normal(e.nombre) === normal(nombre))?.id).filter(Boolean))],
        estado: sugerencia.estado,
        imagenes: deLaTarea(sugerencia.imagenes, lista.length === 1),
      }));
    },

    // Redacta mejor un borrador para el chat o la descripción de un pendiente que ve quien pregunta. Viajan el borrador,
    // el título, el proyecto, el responsable, el principio de la descripción, en el chat los últimos mensajes y en la
    // descripción los nombres de sus videos y audios (para las marcas de tiempo); de las personas solo sus nombres (para
    // escribir bien las @menciones), nunca correos ni teléfonos.
    async redactar(yo, { texto, donde, pendiente_id: pendienteId, ...extra }, bases) {
      const item = pendiente(yo, pendienteId);
      if (!item) return null;
      const ia = iaDeRedaccion(this.ajustesIA());
      const personas = db.prepare('SELECT id, nombre FROM perfiles ORDER BY creado_en, rowid').all();
      const responsable = personas.find((p) => p.id === item.perfil_id)?.nombre;
      const proyecto = etiquetaDeProyecto(item.proyecto_id);
      const { descripcion } = db.prepare('SELECT descripcion FROM pendientes WHERE id = ?').get(pendienteId);
      const resumen = descripcion ? resumirDescripcion(JSON.parse(descripcion), MAX_CONTEXTO_REDACCION).resumen : null;
      const mensajes = donde === 'chat'
        ? db.prepare(`SELECT autor, texto FROM comentarios WHERE pendiente_id = ? AND texto != '' ORDER BY creado_en DESC, rowid DESC LIMIT 6`)
          .all(pendienteId).reverse()
        : [];
      const medios = donde === 'chat'
        ? []
        : db.prepare(`SELECT nombre FROM archivos WHERE pendiente_id = ? AND borrador = 0 AND subido IS NULL
            AND (tipo LIKE 'video/%' OR tipo LIKE 'audio/%') ORDER BY creado_en, rowid`).all(pendienteId).map((archivo) => archivo.nombre);
      const sistema = instruccionesRedaccion({
        donde,
        medios,
        personas: personas.map((p) => p.nombre),
        pendiente: [`«${item.texto}»`, proyecto && `proyecto ${proyecto}`, `estado ${item.estado}`, responsable && `responsable ${responsable}`]
          .filter(Boolean).join(', '),
        contexto: [
          ...(resumen ? [`Descripción (el principio): ${resumen}`] : []),
          ...(mensajes.length ? ['Últimos mensajes del chat:', ...mensajes.map((m) => `${m.autor}: ${m.texto.slice(0, 300)}`)] : []),
        ],
      }) + conIndicaciones(extra);
      const redactado = await pedirRedaccion({
        ...ia,
        base: bases[ia.proveedor],
        sistema,
        texto,
        maximo: donde === 'chat' ? MAX_COMENTARIO : MAX_REDACCION,
      });
      return { texto: redactado };
    },

    // Lo mismo en una nota propia: viajan el borrador, el curso, el título y el principio de la nota.
    async redactarEnNota(yo, { texto, nota_id: notaId, ...extra }, bases) {
      const datos = db.prepare('SELECT n.titulo, n.texto, c.nombre AS curso FROM notas n JOIN cursos c ON c.id = n.curso_id WHERE n.id = ? AND c.perfil_id = ?')
        .get(notaId, yo);
      if (!datos) return null;
      const ia = iaDeRedaccion(this.ajustesIA());
      const sistema = instruccionesApuntes({ curso: datos.curso, titulo: datos.titulo, contexto: datos.texto.slice(0, MAX_CONTEXTO_REDACCION) })
        + conIndicaciones(extra);
      return { texto: await pedirRedaccion({ ...ia, base: bases[ia.proveedor], sistema, texto, maximo: MAX_REDACCION_NOTA }) };
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
        // Sin responsable, arriba de todo; ya asignado, al final de la cola, como al asignarlo después.
        const posicion = changes.perfil_id ? alFinal() : arriba();
        const estado = changes.estado ?? 'pendiente';
        const descripcion = changes.descripcion ?? null;
        const { resumen = null, num_imagenes: numImagenes = 0 } = descripcion ? resumirDescripcion(JSON.parse(descripcion)) : {};
        db.prepare(`INSERT INTO pendientes (id, texto, proyecto_id, estado, tipo, perfil_id, creado_por, posicion, creado_en, actualizado_en, hecho_en,
            descripcion, resumen, num_imagenes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, changes.texto, changes.proyecto_id ?? null, estado, changes.tipo ?? null, changes.perfil_id ?? null, yo, posicion, now, now,
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
      const actualizado = transaction(db, () => {
        // Al dárselo a alguien (otra persona que la de antes) va al final de la cola de su columna.
        if (changes.perfil_id && changes.perfil_id !== antes.perfil_id) columnas.posicion = alFinal();
        // Las columnas salen de parsePendiente, resumirDescripcion, hecho_en y posicion: solo campos conocidos.
        const campos = Object.keys(columnas);
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
      const contenidos = db.prepare('SELECT sha256 FROM imagenes WHERE pendiente_id = ? UNION ALL SELECT sha256 FROM archivos WHERE pendiente_id = ?')
        .all(id, id).map((row) => row.sha256);
      const aMedias = db.prepare('SELECT id FROM archivos WHERE pendiente_id = ? AND subido IS NOT NULL').all(id);
      transaction(db, () => {
        // Su historial queda con la privacidad que tenía al borrarse (ON DELETE SET NULL suelta el pendiente_id).
        db.prepare('UPDATE actividad SET privado_de = ? WHERE pendiente_id = ?').run(privadoDe(id), id);
        registrar(quien, actual, 'borrado', null, [actual.creado_por]);
        // ON DELETE CASCADE quita sus filas de imagenes, archivos y comentarios; lo guardado en disco se borra aparte.
        db.prepare('DELETE FROM pendientes WHERE id = ?').run(id);
      });
      await soltar(contenidos);
      await Promise.all(aMedias.map((row) => borrarSiEsta(parcialDeArchivo(row.id))));
      return true;
    },

    // Lo pasa a otra persona: vuelve a Por hacer, al final de la cola, con su nuevo responsable. Es el mismo pendiente,
    // así que conserva su historial, su chat y sus archivos.
    traspasar(quien, id, { perfil_id: perfilId, nota }) {
      const yo = quien.perfil_id;
      const antes = pendiente(yo, id);
      if (!antes) return null;
      verificarPerfil(perfilId);
      return transaction(db, () => {
        db.prepare("UPDATE pendientes SET estado = 'pendiente', hecho_en = NULL, perfil_id = ?, posicion = ?, actualizado_en = ? WHERE id = ?")
          .run(perfilId, alFinal(), new Date().toISOString(), id);
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

    // Otro perfil da por buena la funcionalidad de un pendiente hecho. Su responsable no la aprueba (es su trabajo), ni
    // la cuenta del equipo (no se sabría quién). Se avisa al responsable y a quien lo creó.
    aprobar(quien, id) {
      const yo = quien.perfil_id;
      const actual = pendiente(yo, id);
      if (!actual) return null;
      if (!yo) throw httpError(403, 'aprobar_con_perfil');
      if (actual.estado !== 'hecho') throw httpError(409, 'aprobar_solo_hechos');
      if (actual.perfil_id === yo) throw httpError(409, 'aprobar_lo_propio');
      return transaction(db, () => {
        const { changes } = db.prepare('INSERT OR IGNORE INTO aprobaciones (pendiente_id, perfil_id, creado_en) VALUES (?, ?, ?)')
          .run(id, yo, new Date().toISOString());
        if (changes) registrar(quien, actual, 'aprobado', null, [actual.perfil_id, actual.creado_por]);
        return pendiente(yo, id);
      });
    },

    desaprobar(quien, id) {
      const yo = quien.perfil_id;
      const actual = pendiente(yo, id);
      if (!actual) return null;
      if (!yo) throw httpError(403, 'aprobar_con_perfil');
      return transaction(db, () => {
        const { changes } = db.prepare('DELETE FROM aprobaciones WHERE pendiente_id = ? AND perfil_id = ?').run(id, yo);
        if (changes) registrar(quien, actual, 'aprobacion_quitada');
        return pendiente(yo, id);
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
        const adjuntos = archivoIds.map((archivoId) => fila(db.prepare(`${SELECT_ARCHIVO} WHERE id = ? AND pendiente_id = ? AND borrador = 1 AND subido IS NULL`)
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
      const contenidos = db.prepare('SELECT sha256 FROM archivos WHERE comentario_id = ?').all(id).map((row) => row.sha256);
      transaction(db, () => {
        db.prepare("DELETE FROM actividad WHERE tipo = 'comentario' AND json_extract(datos, '$.comentario_id') = ?").run(id);
        db.prepare('DELETE FROM comentarios WHERE id = ?').run(id);
      });
      await soltar(contenidos);
      return true;
    },

    // Para el chat queda como borrador hasta que se envía el mensaje; si no, se adjunta al pendiente y se avisa.
    async guardarArchivo(quien, pendienteId, { nombre, contenido, paraChat }) {
      const item = pendiente(quien.perfil_id, pendienteId);
      if (!item) return null;
      if (contenido.length === 0) throw httpError(422, 'archivo_vacio');
      await limpiarBorradores();
      const id = randomUUID();
      return guardarContenido(contenido, (hash) => transaction(db, () => {
        db.prepare(`INSERT INTO archivos (id, pendiente_id, comentario_id, borrador, nombre, tipo, tamano, perfil_id, autor, creado_en, sha256)
          VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, pendienteId, paraChat ? 1 : 0, nombre, tipoDeArchivo(contenido), contenido.length, quien.perfil_id, quien.nombre, new Date().toISOString(), hash);
        if (!paraChat) registrar(quien, item, 'archivo', { archivo_id: id, nombre }, [item.creado_por]);
        return fila(db.prepare(`${SELECT_ARCHIVO} WHERE id = ?`).get(id));
      }));
    },

    // Lo grande llega por partes y en orden: la primera crea el archivo con su tamaño total (todavía no se lista ni se
    // avisa) y cada una sigue donde quedó la anterior. Al completarse queda como cualquier otro adjunto.
    async empezarArchivo(quien, pendienteId, { nombre, tamano, parte, paraChat }) {
      const item = pendiente(quien.perfil_id, pendienteId);
      if (!item) return null;
      if (parte.length === 0) throw httpError(422, 'archivo_vacio');
      if (parte.length > tamano) throw httpError(422, 'parte_invalida');
      if (parte.length === tamano) return this.guardarArchivo(quien, pendienteId, { nombre, contenido: parte, paraChat });
      await limpiarBorradores();
      const id = randomUUID();
      await writeFile(parcialDeArchivo(id), parte, { mode: 0o600 });
      db.prepare(`INSERT INTO archivos (id, pendiente_id, comentario_id, borrador, nombre, tipo, tamano, subido, perfil_id, autor, creado_en)
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, pendienteId, paraChat ? 1 : 0, nombre, tipoDeArchivo(parte), tamano, parte.length, quien.perfil_id, quien.nombre, new Date().toISOString());
      return fila(db.prepare(`${SELECT_ARCHIVO} WHERE id = ?`).get(id));
    },

    async seguirArchivo(quien, id, { desde, parte }) {
      const actual = fila(db.prepare(`SELECT a.id, a.pendiente_id, a.nombre, a.borrador, a.tamano, a.subido, a.perfil_id, a.autor FROM archivos a
        JOIN pendientes ON pendientes.id = a.pendiente_id WHERE a.id = ? AND ${PENDIENTE_VISIBLE}`).get(id, quien.perfil_id));
      if (!actual) return null;
      if (!esAutor(quien, actual)) throw httpError(403, 'solo_el_autor');
      if (recibiendoArchivos.has(id) || actual.subido === null || desde !== actual.subido) throw httpError(409, 'parte_fuera_de_orden');
      if (parte.length === 0 || actual.subido + parte.length > actual.tamano) throw httpError(422, 'parte_invalida');
      recibiendoArchivos.add(id);
      try {
        await appendFile(parcialDeArchivo(id), parte);
        // Lo que manda es lo que quedó en el disco.
        const { size: subido } = await stat(parcialDeArchivo(id));
        if (subido !== actual.subido + parte.length) throw new Error(`El archivo ${id} quedó con ${subido} bytes`);
        if (subido < actual.tamano) {
          db.prepare('UPDATE archivos SET subido = ? WHERE id = ?').run(subido, id);
        } else {
          await adoptarArchivo(parcialDeArchivo(id), (hash) => transaction(db, () => {
            db.prepare('UPDATE archivos SET subido = NULL, sha256 = ? WHERE id = ?').run(hash, id);
            const item = pendiente(quien.perfil_id, actual.pendiente_id);
            if (!actual.borrador && item) registrar(quien, item, 'archivo', { archivo_id: id, nombre: actual.nombre }, [item.creado_por]);
          }));
        }
      } catch (error) {
        const fallido = db.prepare('SELECT id, sha256 FROM archivos WHERE id = ?').get(id);
        db.prepare('DELETE FROM archivos WHERE id = ?').run(id);
        await soltarArchivos([fallido ?? { id, sha256: null }]);
        throw error;
      } finally {
        recibiendoArchivos.delete(id);
      }
      return fila(db.prepare(`${SELECT_ARCHIVO} WHERE id = ?`).get(id));
    },

    // Un adjunto que ya está en otro pendiente (o en su chat) se agrega a este sin volver a subirlo: es otra fila que
    // apunta al mismo contenido, así que quitarlo de uno no lo quita de los demás.
    async reusarArchivo(quien, pendienteId, { archivo_id: archivoId, paraChat }) {
      const item = pendiente(quien.perfil_id, pendienteId);
      if (!item) return null;
      const origen = db.prepare(`SELECT a.nombre, a.tipo, a.tamano, a.sha256 FROM archivos a JOIN pendientes ON pendientes.id = a.pendiente_id
        WHERE a.id = ? AND a.borrador = 0 AND a.subido IS NULL AND ${PENDIENTE_VISIBLE}`).get(archivoId, quien.perfil_id);
      if (!origen) throw httpError(422, 'archivo_invalido');
      return copiarArchivo(quien, item, origen, paraChat);
    },

    // Antes de subir algo grande, el tablero pregunta si ese mismo contenido ya está en un pendiente que quien sube
    // puede ver: entonces lo agrega sin mandar nada. Solo mira lo que ya puede abrir, así que no revela nada de otros.
    // { archivo: null }: no está (y se sube como siempre); null: el pendiente no existe para quien pregunta.
    async archivoRepetido(quien, pendienteId, { nombre, tamano, sha256, paraChat }) {
      const item = pendiente(quien.perfil_id, pendienteId);
      if (!item) return null;
      const origen = db.prepare(`SELECT a.tipo FROM archivos a JOIN pendientes ON pendientes.id = a.pendiente_id
        WHERE a.sha256 = ? AND a.tamano = ? AND a.borrador = 0 AND a.subido IS NULL AND ${PENDIENTE_VISIBLE} LIMIT 1`).get(sha256, tamano, quien.perfil_id);
      if (!origen || !existsSync(blob(sha256))) return { archivo: null };
      return { archivo: await copiarArchivo(quien, item, { nombre, tipo: origen.tipo, tamano, sha256 }, paraChat) };
    },

    // Para reusar: lo ya subido a los pendientes que `yo` ve (sin borradores ni lo que se sigue subiendo), un renglón por
    // contenido con su nombre más reciente y dónde está. Lo nuevo primero.
    buscarArchivos(yo, texto = '') {
      const filas = db.prepare(`SELECT a.id, a.nombre, a.tipo, a.tamano, a.sha256, a.creado_en, pendientes.id AS pendiente_id, pendientes.texto
        FROM archivos a JOIN pendientes ON pendientes.id = a.pendiente_id
        WHERE a.borrador = 0 AND a.subido IS NULL AND ${PENDIENTE_VISIBLE} ORDER BY a.creado_en DESC, a.rowid DESC`).all(yo);
      const buscado = normalizar(texto.trim());
      const porContenido = new Map();
      for (const row of filas) {
        let grupo = porContenido.get(row.sha256);
        if (!grupo) {
          grupo = { id: row.id, nombre: row.nombre, tipo: row.tipo, tamano: row.tamano, creado_en: row.creado_en, nombres: new Set(), usado_en: new Map() };
          porContenido.set(row.sha256, grupo);
        }
        grupo.nombres.add(row.nombre);
        if (!grupo.usado_en.has(row.pendiente_id)) grupo.usado_en.set(row.pendiente_id, row.texto);
      }
      return [...porContenido.values()]
        .filter((grupo) => !buscado || [...grupo.nombres].some((nombre) => normalizar(nombre).includes(buscado)))
        .slice(0, 50)
        .map(({ nombres: _nombres, usado_en: usadoEn, ...grupo }) => ({
          ...grupo,
          usado_en: [...usadoEn].map(([pendienteId, textoPendiente]) => ({ pendiente_id: pendienteId, texto: textoPendiente })),
        }));
    },

    // Los del pendiente y los de su chat (no los borradores ni lo que se sigue subiendo), cada uno con los otros
    // pendientes que `yo` ve donde está ese mismo contenido.
    listarArchivos(yo, pendienteId) {
      if (!pendiente(yo, pendienteId)) return null;
      const enOtros = db.prepare(`SELECT DISTINCT pendientes.id AS pendiente_id, pendientes.texto FROM archivos a JOIN pendientes ON pendientes.id = a.pendiente_id
        WHERE a.sha256 = ? AND a.pendiente_id <> ? AND a.borrador = 0 AND a.subido IS NULL AND ${PENDIENTE_VISIBLE}`);
      return db.prepare(`${SELECT_ARCHIVO.replace(' FROM archivos', ', sha256 AS contenido FROM archivos')}
        WHERE pendiente_id = ? AND borrador = 0 AND subido IS NULL ORDER BY creado_en, rowid`)
        .all(pendienteId)
        .map(({ contenido, ...archivo }) => ({ ...archivo, tambien_en: enOtros.all(contenido, pendienteId, yo).map(fila) }));
    },

    // Dónde está y qué es, para mandarlo por partes (puede pesar cientos de MB). Solo si ya terminó de subirse.
    async leerArchivo(yo, id) {
      const archivo = db.prepare(`SELECT a.nombre, a.tipo, a.sha256 FROM archivos a JOIN pendientes ON pendientes.id = a.pendiente_id
        WHERE a.id = ? AND a.subido IS NULL AND ${PENDIENTE_VISIBLE}`).get(id, yo);
      if (!archivo?.sha256) return null;
      try {
        const { size } = await stat(blob(archivo.sha256));
        return { nombre: archivo.nombre, tipo: archivo.tipo, tamano: size, ruta: blob(archivo.sha256) };
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },

    // Cada quien quita lo que subió (también lo que dejó a medias). Lo de un mensaje se va al borrar el mensaje.
    async borrarArchivo(quien, id) {
      const archivo = fila(db.prepare(`SELECT a.id, a.perfil_id, a.autor, a.comentario_id, a.sha256 FROM archivos a JOIN pendientes ON pendientes.id = a.pendiente_id
        WHERE a.id = ? AND ${PENDIENTE_VISIBLE}`).get(id, quien.perfil_id));
      if (!archivo || recibiendoArchivos.has(id)) return false;
      if (archivo.comentario_id) throw httpError(409, 'archivo_de_mensaje');
      if (!esAutor(quien, archivo)) throw httpError(403, 'solo_el_autor');
      transaction(db, () => {
        db.prepare("DELETE FROM actividad WHERE tipo = 'archivo' AND json_extract(datos, '$.archivo_id') = ?").run(id);
        db.prepare('DELETE FROM archivos WHERE id = ?').run(id);
      });
      await soltarArchivos([archivo]);
      return true;
    },

    listarActividad: (yo, { antes = null, limite = 50 } = {}) => db.prepare(`${SELECT_ACTIVIDAD}
      WHERE ${ACTIVIDAD_VISIBLE} AND (? IS NULL OR a.creado_en < ?) ORDER BY a.creado_en DESC, a.rowid DESC LIMIT ?`)
      .all(yo, yo, antes, antes, limite).map(actividadFila),

    // Después de pasar un pendiente a Hecho: los que `yo` terminó seguidos sin evidencia, del último hacia atrás. Cuenta lo
    // que está en Hecho a su cargo y pasó él mismo a Hecho; tiene evidencia si escribió en su chat desde que lo empezó (la
    // última vez que pasó a Haciendo, que salió de Hecho o que se lo asignaron; si no, desde que se creó). Se recuerda
    // cuando el recién terminado es el tercero seguido, o uno más después de esos.
    evidencia(yo, pendienteId) {
      if (!pendiente(yo, pendienteId)) return null;
      if (!yo) return { recordar: false, seguidos: 0, sin_evidencia: [] };
      const terminados = db.prepare(`SELECT id, texto, hecho_en, creado_en FROM pendientes
        WHERE perfil_id = ? AND estado = 'hecho' AND hecho_en IS NOT NULL AND ${PENDIENTE_VISIBLE} ORDER BY hecho_en DESC LIMIT 50`).all(yo, yo);
      const quienTermino = db.prepare(`SELECT perfil_id FROM actividad WHERE pendiente_id = ? AND tipo = 'estado'
        AND json_extract(datos, '$.a') = 'hecho' ORDER BY creado_en DESC, rowid DESC LIMIT 1`);
      const empezado = db.prepare(`SELECT MAX(creado_en) AS desde FROM actividad WHERE pendiente_id = ? AND (
        (tipo = 'estado' AND (json_extract(datos, '$.a') = 'haciendo' OR json_extract(datos, '$.de') = 'hecho'))
        OR (tipo IN ('asignado', 'traspaso') AND json_extract(datos, '$.a_id') = ?))`);
      const escribio = db.prepare('SELECT 1 FROM comentarios WHERE pendiente_id = ? AND perfil_id = ? AND creado_en >= ? LIMIT 1');
      const sinEvidencia = [];
      for (const terminado of terminados) {
        if (quienTermino.get(terminado.id)?.perfil_id !== yo) continue;
        const desde = empezado.get(terminado.id, yo).desde ?? terminado.creado_en;
        if (escribio.get(terminado.id, yo, desde)) break;
        sinEvidencia.push({ id: terminado.id, texto: terminado.texto, hecho_en: terminado.hecho_en });
      }
      const recordar = sinEvidencia[0]?.id === pendienteId && sinEvidencia.length >= SIN_EVIDENCIA_PARA_RECORDAR;
      return { recordar, seguidos: sinEvidencia.length, sin_evidencia: sinEvidencia.slice(0, 10) };
    },

    actividadDePendiente(yo, pendienteId) {
      if (!pendiente(yo, pendienteId)) return null;
      return db.prepare(`${SELECT_ACTIVIDAD} WHERE a.pendiente_id = ? ORDER BY a.creado_en DESC, a.rowid DESC LIMIT 200`).all(pendienteId).map(actividadFila);
    },

    // La cuenta del equipo no es un perfil: no recibe avisos.
    listarNotificaciones(yo) {
      if (!yo) return { notificaciones: [], no_leidas: 0, sin_leer: [] };
      const notificaciones = db.prepare(`SELECT n.id AS notificacion_id, n.leida_en, a.id, a.pendiente_id, a.texto_pendiente, a.perfil_id, a.autor,
          a.tipo, a.datos, a.creado_en
        FROM notificaciones n JOIN actividad a ON a.id = n.actividad_id
        WHERE n.perfil_id = ? AND ${ACTIVIDAD_VISIBLE} ORDER BY n.creado_en DESC, n.rowid DESC LIMIT 50`).all(yo, yo, yo)
        .map(({ notificacion_id: id, leida_en: leidaEn, ...actividad }) => ({ id, leida: leidaEn !== null, actividad: actividadFila(actividad) }));
      return { notificaciones, no_leidas: this.noLeidas(yo), sin_leer: this.sinLeer(yo) };
    },

    // Los pendientes con avisos sin leer (todos, no solo los 50 de la lista), para marcar sus tarjetas. Las menciones
    // (en un mensaje o en la descripción) y las respuestas a un mensaje tuyo se cuentan aparte.
    sinLeer: (yo) => db.prepare(`SELECT a.pendiente_id, COUNT(*) AS avisos,
        SUM(CASE WHEN json_extract(a.datos, '$.respondido_id') = ?
          OR EXISTS (SELECT 1 FROM json_each(a.datos, '$.menciones') WHERE value = ?) THEN 1 ELSE 0 END) AS menciones
      FROM notificaciones n JOIN actividad a ON a.id = n.actividad_id
      WHERE n.perfil_id = ? AND n.leida_en IS NULL AND a.pendiente_id IS NOT NULL AND ${ACTIVIDAD_VISIBLE}
      GROUP BY a.pendiente_id ORDER BY MAX(n.creado_en) DESC`).all(yo, yo, yo, yo, yo).map((fila) => ({ ...fila })),

    noLeidas: (yo) => db.prepare(`SELECT COUNT(*) AS total FROM notificaciones n JOIN actividad a ON a.id = n.actividad_id
      WHERE n.perfil_id = ? AND n.leida_en IS NULL AND ${ACTIVIDAD_VISIBLE}`).get(yo, yo, yo).total,

    marcarLeidas(yo, { ids, pendienteId }) {
      if (!yo) return 0;
      const ahora = new Date().toISOString();
      if (pendienteId) {
        db.prepare(`UPDATE notificaciones SET leida_en = ? WHERE perfil_id = ? AND leida_en IS NULL
          AND actividad_id IN (SELECT id FROM actividad WHERE pendiente_id = ?)`).run(ahora, yo, pendienteId);
      } else if (ids === null) {
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
      await guardarContenido(contenido, (hash) => db.prepare('INSERT INTO imagenes (id, pendiente_id, tipo, tamano, creado_en, sha256) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, pendienteId, tipo, contenido.length, new Date().toISOString(), hash));
      return { id, url: `${API_PATH}/imagenes/${id}` };
    },

    async leerImagen(yo, id) {
      const imagen = db.prepare(`SELECT i.tipo, i.sha256 FROM imagenes i JOIN pendientes ON pendientes.id = i.pendiente_id
        WHERE i.id = ? AND ${PENDIENTE_VISIBLE}`).get(id, yo);
      const contenido = imagen && await leerContenido(imagen.sha256);
      return contenido && { tipo: imagen.tipo, contenido };
    },

    // Notas. El correo decide quién las tiene (ver NOTAS_CORREOS en createApp).
    correoDe: (perfilId) => db.prepare('SELECT lower(correo) AS correo FROM perfiles WHERE id = ?').get(perfilId)?.correo ?? null,

    // Todo lo de la barra lateral de una vez: cursos, títulos de las notas y recursos ya subidos.
    arbolDeNotas: (yo) => ({
      cursos: db.prepare(`${SELECT_CURSO} WHERE perfil_id = ? ORDER BY creado_en, rowid`).all(yo).map(fila),
      notas: db.prepare(`${SELECT_NOTA} WHERE c.perfil_id = ? ORDER BY n.creado_en, n.rowid`).all(yo).map(fila),
      recursos: db.prepare(`${SELECT_RECURSO} WHERE c.perfil_id = ? AND r.subido = r.tamano ORDER BY r.creado_en, r.rowid`).all(yo).map(fila),
    }),

    crearCurso(yo, { nombre, icono }) {
      const id = randomUUID();
      const ahora = new Date().toISOString();
      db.prepare('INSERT INTO cursos (id, perfil_id, nombre, icono, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, yo, nombre, icono ?? '📘', ahora, ahora);
      return curso(yo, id);
    },

    actualizarCurso(yo, id, changes) {
      if (!curso(yo, id)) return null;
      const campos = Object.keys(changes);
      db.prepare(`UPDATE cursos SET ${[...campos, 'actualizado_en'].map((campo) => `${campo} = ?`).join(', ')} WHERE id = ?`)
        .run(...campos.map((campo) => changes[campo]), new Date().toISOString(), id);
      return curso(yo, id);
    },

    // Se lleva sus notas y sus recursos.
    async borrarCurso(yo, id) {
      if (!curso(yo, id)) return false;
      const recursos = db.prepare('SELECT id, sha256 FROM recursos WHERE curso_id = ?').all(id);
      db.prepare('DELETE FROM cursos WHERE id = ?').run(id);
      await soltarRecursos(recursos);
      await limpiarImagenesDeNotas(yo);
      return true;
    },

    crearNota(yo, cursoId, { titulo }) {
      if (!curso(yo, cursoId)) return null;
      const id = randomUUID();
      const ahora = new Date().toISOString();
      db.prepare('INSERT INTO notas (id, curso_id, titulo, contenido, texto, creado_en, actualizado_en) VALUES (?, ?, ?, NULL, \'\', ?, ?)')
        .run(id, cursoId, titulo, ahora, ahora);
      return nota(yo, id);
    },

    detalleNota(yo, id) {
      const meta = nota(yo, id);
      return meta && { ...meta, contenido: db.prepare('SELECT contenido FROM notas WHERE id = ?').get(id).contenido };
    },

    // El texto plano del documento se guarda aparte para buscar y para darle contexto a la IA.
    async actualizarNota(yo, id, changes) {
      if (!nota(yo, id)) return null;
      if ('curso_id' in changes && !curso(yo, changes.curso_id)) throw httpError(422, 'curso_invalido');
      const cambios = { ...changes };
      if ('contenido' in changes) {
        cambios.texto = changes.contenido ? resumirDescripcion(JSON.parse(changes.contenido), Infinity).resumen ?? '' : '';
      }
      const campos = Object.keys(cambios);
      db.prepare(`UPDATE notas SET ${[...campos, 'actualizado_en'].map((campo) => `${campo} = ?`).join(', ')} WHERE id = ?`)
        .run(...campos.map((campo) => cambios[campo]), new Date().toISOString(), id);
      if ('contenido' in changes) await limpiarImagenesDeNotas(yo, id);
      return nota(yo, id);
    },

    async borrarNota(yo, id) {
      if (!nota(yo, id)) return false;
      db.prepare('DELETE FROM notas WHERE id = ?').run(id);
      await limpiarImagenesDeNotas(yo, id);
      return true;
    },

    // Busca todas las palabras (sin tildes) en el título y el texto de las notas, y en el nombre de los recursos.
    buscarEnNotas(yo, consulta) {
      const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
      if (palabras.length === 0) return { notas: [], recursos: [] };
      const coincide = (texto) => palabras.every((palabra) => normalizar(texto).includes(palabra));
      const notas = db.prepare(`SELECT n.id, n.curso_id, n.titulo, n.texto, n.actualizado_en FROM notas n JOIN cursos c ON c.id = n.curso_id
          WHERE c.perfil_id = ? ORDER BY n.actualizado_en DESC`).all(yo)
        .filter((row) => coincide(`${row.titulo} ${row.texto}`))
        .slice(0, MAX_RESULTADOS_NOTAS)
        .map(({ texto, ...row }) => ({ ...row, extracto: extractoDe(texto, palabras.find((palabra) => normalizar(texto).includes(palabra)) ?? '') }));
      const recursos = db.prepare(`${SELECT_RECURSO} WHERE c.perfil_id = ? AND r.subido = r.tamano ORDER BY r.creado_en DESC`).all(yo)
        .filter((row) => coincide(row.nombre))
        .slice(0, MAX_RESULTADOS_NOTAS)
        .map(fila);
      return { notas, recursos };
    },

    async guardarImagenDeNota(yo, notaId, contenido) {
      if (!nota(yo, notaId)) return null;
      const tipo = tipoDeImagen(contenido);
      if (!tipo) throw httpError(415, 'imagen_invalida');
      const id = randomUUID();
      await guardarContenido(contenido, (hash) => db.prepare('INSERT INTO nota_imagenes (id, perfil_id, nota_id, tipo, tamano, creado_en, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, yo, notaId, tipo, contenido.length, new Date().toISOString(), hash));
      return { id, url: `${NOTAS_PATH}/imagenes/${id}` };
    },

    async leerImagenDeNota(yo, id) {
      const imagen = db.prepare('SELECT tipo, sha256 FROM nota_imagenes WHERE id = ? AND perfil_id = ?').get(id, yo);
      const contenido = imagen && await leerContenido(imagen.sha256);
      return contenido && { tipo: imagen.tipo, contenido };
    },

    // Un recurso se sube por partes y en orden: la primera lo crea con su tamaño total y cada una sigue donde quedó la
    // anterior. Hasta completarse no aparece en la lista ni se puede abrir.
    async crearRecurso(yo, cursoId, { nombre, tamano, parte }) {
      if (!curso(yo, cursoId)) return null;
      if (parte.length === 0) throw httpError(422, 'archivo_vacio');
      if (parte.length > tamano) throw httpError(422, 'parte_invalida');
      await limpiarRecursosAMedias();
      const id = randomUUID();
      await writeFile(parcialDeRecurso(id), parte, { mode: 0o600 });
      const insertar = (hash) => db.prepare('INSERT INTO recursos (id, curso_id, nombre, tipo, tamano, subido, creado_en, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, cursoId, nombre, tipoDeArchivo(parte), tamano, parte.length, new Date().toISOString(), hash);
      if (parte.length === tamano) await adoptarArchivo(parcialDeRecurso(id), insertar);
      else insertar(null);
      return recurso(yo, id);
    },

    // Antes de subir un recurso, el tablero pregunta si su dueño ya tiene ese contenido (en cualquiera de sus cursos):
    // entonces lo agrega sin mandar nada. Solo mira lo propio, para que nadie pueda averiguar qué archivos tienen otros
    // con solo mandar un hash. { recurso: null }: no lo tiene (y se sube como siempre); null: el curso no es suyo.
    async crearRecursoRepetido(yo, cursoId, { nombre, tamano, sha256 }) {
      if (!curso(yo, cursoId)) return null;
      return { recurso: await conCandado(sha256, () => {
        const propio = db.prepare(`SELECT r.tipo FROM recursos r JOIN cursos c ON c.id = r.curso_id
          WHERE c.perfil_id = ? AND r.sha256 = ? AND r.tamano = ? AND r.subido = r.tamano LIMIT 1`).get(yo, sha256, tamano);
        if (!propio || !existsSync(blob(sha256))) return null;
        const id = randomUUID();
        db.prepare('INSERT INTO recursos (id, curso_id, nombre, tipo, tamano, subido, creado_en, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, cursoId, nombre, propio.tipo, tamano, tamano, new Date().toISOString(), sha256);
        return recurso(yo, id);
      }) };
    },

    async seguirRecurso(yo, id, { desde, parte }) {
      const actual = recurso(yo, id);
      if (!actual) return null;
      if (recibiendo.has(id) || desde !== actual.subido || actual.subido === actual.tamano) throw httpError(409, 'parte_fuera_de_orden');
      if (parte.length === 0 || actual.subido + parte.length > actual.tamano) throw httpError(422, 'parte_invalida');
      recibiendo.add(id);
      try {
        await appendFile(parcialDeRecurso(id), parte);
        // Lo que manda es lo que quedó en el disco.
        const { size: subido } = await stat(parcialDeRecurso(id));
        if (subido !== actual.subido + parte.length) throw new Error(`El recurso ${id} quedó con ${subido} bytes`);
        const actualizar = (hash) => db.prepare('UPDATE recursos SET subido = ?, sha256 = ? WHERE id = ?').run(subido, hash, id);
        if (subido === actual.tamano) await adoptarArchivo(parcialDeRecurso(id), actualizar);
        else actualizar(null);
      } catch (error) {
        const fallido = db.prepare('SELECT id, sha256 FROM recursos WHERE id = ?').get(id);
        db.prepare('DELETE FROM recursos WHERE id = ?').run(id);
        await soltarRecursos([fallido ?? { id, sha256: null }]);
        throw error;
      } finally {
        recibiendo.delete(id);
      }
      return recurso(yo, id);
    },

    renombrarRecurso(yo, id, nombre) {
      if (!recurso(yo, id)) return null;
      db.prepare('UPDATE recursos SET nombre = ? WHERE id = ?').run(nombre, id);
      return recurso(yo, id);
    },

    // Para mandarlo por partes (puede pesar cientos de MB): dónde está y qué es. Solo si ya terminó de subirse.
    async leerRecurso(yo, id) {
      const actual = recurso(yo, id);
      if (!actual || actual.subido < actual.tamano) return null;
      const { sha256 } = db.prepare('SELECT sha256 FROM recursos WHERE id = ?').get(id);
      if (!sha256) return null;
      try {
        const { size } = await stat(blob(sha256));
        return { ...actual, tamano: size, ruta: blob(sha256) };
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },

    async borrarRecurso(yo, id) {
      if (!recurso(yo, id) || recibiendo.has(id)) return false;
      const borrado = db.prepare('SELECT id, sha256 FROM recursos WHERE id = ?').get(id);
      db.prepare('DELETE FROM recursos WHERE id = ?').run(id);
      await soltarRecursos([borrado]);
      return true;
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
    async borrarPerfil(yo, id) {
      const actual = perfil(id);
      if (!actual) return false;
      if (actual.tiene_contrasena && id !== yo) throw httpError(403, 'solo_el_mismo');
      if (db.prepare('SELECT 1 FROM organizaciones WHERE duenio_id = ? AND compartida = 0').get(id)) throw httpError(409, 'perfil_con_privadas');
      if (db.prepare('SELECT 1 FROM cursos WHERE perfil_id = ?').get(id)) throw httpError(409, 'perfil_con_notas');
      // Las imágenes que le quedaron sueltas de notas ya borradas se van con él (ON DELETE CASCADE).
      const contenidos = db.prepare('SELECT sha256 FROM nota_imagenes WHERE perfil_id = ?').all(id).map((row) => row.sha256);
      transaction(db, () => {
        db.prepare('UPDATE organizaciones SET duenio_id = NULL WHERE duenio_id = ?').run(id);
        db.prepare('DELETE FROM perfiles WHERE id = ?').run(id);
      });
      await soltar(contenidos);
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
  // Las pruebas sirven las imágenes "de otra página" desde la propia máquina; en producción nunca se piden ahí.
  const imagenesDeRedesInternas = options.imagenesDeRedesInternas ?? process.env.IMAGENES_DE_REDES_INTERNAS === '1';
  // Las pruebas apuntan cada proveedor de IA a un servidor falso (IA_URL_GEMINI, IA_URL_OPENAI, IA_URL_OPENROUTER).
  const basesIA = Object.fromEntries(Object.entries(PROVEEDORES_IA).map(([id, { url }]) =>
    [id, options.basesIA?.[id] ?? process.env[`IA_URL_${id.toUpperCase()}`] ?? url]));
  // Credenciales de perfil ya verificadas (huella del encabezado → hash contra el que se verificaron),
  // para no correr scrypt en cada petición. Si la contraseña cambia, el hash ya no coincide.
  const verificadas = new Map();
  const fallos = new Map();
  // "Crear con IA" puede tardar más de lo que nginx espera una respuesta (12 s): con ?trabajo, POST /ia/sugerir deja a
  // la IA trabajando y devuelve el id; GET /ia/sugerir/<id> dice si terminó y entrega el resultado una sola vez.
  const trabajosIA = new Map();

  function empezarTrabajo(yo, tarea) {
    for (const [id, trabajo] of trabajosIA) if (Date.now() - trabajo.desde > VIDA_TRABAJO_IA_MS) trabajosIA.delete(id);
    const id = randomUUID();
    const trabajo = { yo, desde: Date.now(), respuesta: null };
    trabajosIA.set(id, trabajo);
    tarea().then(
      (cuerpo) => { trabajo.respuesta = { status: 200, cuerpo }; },
      (error) => { trabajo.respuesta = comoError(error); }
    );
    return id;
  }
  // Las notas son privadas: solo las tiene quien entra con su propio perfil y su correo está en NOTAS_CORREOS (separados
  // por comas). Para cualquier otro, incluida la cuenta del equipo, no existen.
  const correosNotas = new Set(String(options.notasCorreos ?? process.env.NOTAS_CORREOS ?? '').split(',')
    .map((correo) => correo.trim().toLowerCase()).filter(Boolean));
  const puedeNotas = (usuario) => Boolean(usuario.perfil_id && correosNotas.has(repo.correoDe(usuario.perfil_id)));

  // Avisos por correo: solo con AVISOS_POR_CORREO=si y el SMTP configurado (ver crearCorreo). Las pruebas pasan el suyo.
  const correo = 'correo' in options ? options.correo : process.env.AVISOS_POR_CORREO === 'si' ? crearCorreo() : null;
  const urlTablero = options.urlTablero ?? process.env.URL_TABLERO ?? URL_TABLERO;
  const reglasCorreo = { ...REGLAS_CORREO, ...options.reglasCorreo };
  let mandandoCorreos = false;
  // Cada 5 minutos, pero solo manda durante la hora de envío (de 9:00 a 9:59): a cada uno, si en los últimos días (los de
  // hoy y ayer, con 2) no le llegó ninguno.
  async function mandarAvisosPorCorreo(ahora = Date.now()) {
    const { hora, medianoche } = enZona(ahora, reglasCorreo.zona);
    if (!correo || mandandoCorreos || hora !== reglasCorreo.hora) return;
    mandandoCorreos = true;
    try {
      const pendientes = repo.avisosParaCorreo({
        ahora, desde: medianoche - (reglasCorreo.dias - 1) * DIA_MS, esperaMs: reglasCorreo.esperaMs, antiguedadMs: reglasCorreo.antiguedadMs,
      });
      for (const { perfil, ids, avisos } of pendientes) {
        try {
          await correo.enviar({ to: perfil.correo, ...armarResumen({ perfil, avisos, urlTablero, ahora }) });
          repo.marcarAvisosEnviados(ids, ahora);
        } catch (error) {
          // Se vuelve a intentar en la próxima vuelta.
          console.error(`No se pudo mandar el correo de avisos a ${perfil.nombre}: ${error.message}`);
        }
      }
    } finally {
      mandandoCorreos = false;
    }
  }
  const revisarCorreos = correo && setInterval(() => mandarAvisosPorCorreo().catch((error) => console.error(error)), REVISAR_CORREOS_MS);
  if (revisarCorreos) revisarCorreos.unref();

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
    const pendienteId = deRuta(ITEM_PATH) ?? deRuta(TRASPASO_PATH) ?? deRuta(APROBACION_PATH);
    if (pendienteId) return { tipo: 'pendientes', pendiente_id: pendienteId };
    if (deRuta(COMENTARIOS_PATH)) return { tipo: 'comentarios', pendiente_id: deRuta(COMENTARIOS_PATH) };
    if (deRuta(COMENTARIO_PATH)) return { tipo: 'comentarios', pendiente_id: repo.pendienteDeComentario(deRuta(COMENTARIO_PATH)) };
    const pendienteDeArchivos = deRuta(ARCHIVOS_PATH) ?? deRuta(ARCHIVO_REPETIDO_PATH) ?? deRuta(REUSAR_ARCHIVO_PATH);
    if (pendienteDeArchivos) return { tipo: 'archivos', pendiente_id: pendienteDeArchivos };
    if (deRuta(ARCHIVO_PATH)) return { tipo: 'archivos', pendiente_id: repo.pendienteDeArchivo(deRuta(ARCHIVO_PATH)) };
    if ([PERFILES_PATH, ORGANIZACIONES_PATH, PROYECTOS_PATH, ETIQUETAS_PATH].includes(pathname)
      || [PERFIL_PATH, CONTRASENA_PATH, ORGANIZACION_PATH, PROYECTO_PATH, ETIQUETA_PATH].some((ruta) => ruta.test(pathname))) {
      return { tipo: 'catalogo' };
    }
    if (pathname === IA_PATH) return { tipo: 'ia' };
    return null;
  }

  // Un <video> no puede mandar la contraseña: pide el archivo con un enlace firmado que vale unas horas, solo para ese
  // archivo y para quien lo pidió (al usarlo se vuelve a mirar que lo siga viendo). Reiniciar el servidor los invalida.
  const secretoDeEnlaces = randomBytes(32);
  const firmar = (id, dato) => createHmac('sha256', secretoDeEnlaces).update(`${id}.${dato}`).digest('base64url');
  function enlaceDeArchivo(id, yo) {
    const dato = Buffer.from(`${yo ?? ''}.${Date.now() + VIDA_ENLACE_MS}`).toString('base64url');
    return `${API_PATH}/archivos/${id}?t=${dato}.${firmar(id, dato)}`;
  }
  // El perfil del enlace (null: la cuenta del equipo), o undefined si no vale.
  function firmanteDe(id, token) {
    const [dato, firma] = String(token ?? '').split('.');
    if (!dato || !firma || !safeEqual(firma, firmar(id, dato))) return undefined;
    const [perfil, vence] = Buffer.from(dato, 'base64url').toString().split('.');
    return Number(vence) > Date.now() ? perfil || null : undefined;
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

  // Las rutas de las notas, ya con permiso. No avisan por los cambios en tiempo real: nadie más las ve.
  async function rutasDeNotas(req, res, url, yo) {
    const enviar = (status, clave, valor) => (valor ? json(res, status, { [clave]: valor }) : json(res, 404, { error: 'not_found' }));
    const listo = (hecho) => (hecho ? json(res, 200, { ok: true }) : json(res, 404, { error: 'not_found' }));
    const { pathname } = url;
    const { method } = req;

    if (pathname === NOTAS_PATH && method === 'GET') return json(res, 200, repo.arbolDeNotas(yo));
    if (pathname === NOTAS_BUSCAR_PATH && method === 'GET') {
      return json(res, 200, repo.buscarEnNotas(yo, (url.searchParams.get('q') ?? '').slice(0, 200)));
    }
    if (pathname === CURSOS_PATH && method === 'POST') return json(res, 201, { curso: repo.crearCurso(yo, parseCurso(await readJson(req))) });

    const cursoId = pathname.match(CURSO_PATH)?.[1];
    if (cursoId && method === 'PATCH') return enviar(200, 'curso', repo.actualizarCurso(yo, cursoId, parseCurso(await readJson(req), { partial: true })));
    if (cursoId && method === 'DELETE') return listo(await repo.borrarCurso(yo, cursoId));

    const cursoDeNota = pathname.match(NOTAS_DE_CURSO_PATH)?.[1];
    if (cursoDeNota && method === 'POST') return enviar(201, 'nota', repo.crearNota(yo, cursoDeNota, parseNota(await readJson(req))));

    const notaId = pathname.match(NOTA_PATH)?.[1];
    if (notaId && method === 'GET') return enviar(200, 'nota', repo.detalleNota(yo, notaId));
    if (notaId && method === 'PATCH') {
      return enviar(200, 'nota', await repo.actualizarNota(yo, notaId, parseNota(await readJson(req, MAX_BODY_NOTA_BYTES), { partial: true })));
    }
    if (notaId && method === 'DELETE') return listo(await repo.borrarNota(yo, notaId));

    const notaDeImagen = pathname.match(IMAGENES_DE_NOTA_PATH)?.[1];
    if (notaDeImagen && method === 'POST') {
      return enviar(201, 'imagen', await repo.guardarImagenDeNota(yo, notaDeImagen, await readBody(req, MAX_IMAGEN_BYTES)));
    }
    const imagenId = pathname.match(IMAGEN_DE_NOTA_PATH)?.[1];
    if (imagenId && method === 'GET') {
      const imagen = await repo.leerImagenDeNota(yo, imagenId);
      if (!imagen) return json(res, 404, { error: 'not_found' });
      res.writeHead(200, {
        'Content-Type': imagen.tipo,
        'Content-Length': imagen.contenido.length,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(imagen.contenido);
    }

    // La primera parte de un recurso lleva su nombre (X-Nombre-Archivo) y su tamaño total (X-Tamano).
    const cursoDeRecurso = pathname.match(RECURSOS_DE_CURSO_PATH)?.[1];
    if (cursoDeRecurso && method === 'POST') {
      const nombre = nombreDeArchivo(req.headers['x-nombre-archivo']);
      const tamano = Number(req.headers['x-tamano']);
      if (!Number.isInteger(tamano) || tamano < 1) throw httpError(422, 'parte_invalida');
      if (tamano > MAX_RECURSO_BYTES) throw httpError(413, 'recurso_muy_grande');
      return enviar(201, 'recurso', await repo.crearRecurso(yo, cursoDeRecurso, { nombre, tamano, parte: await readBody(req, MAX_PARTE_BYTES) }));
    }
    const cursoDeRepetido = pathname.match(RECURSO_REPETIDO_PATH)?.[1];
    if (cursoDeRepetido && method === 'POST') {
      const sha256 = String(req.headers['x-sha256'] ?? '').toLowerCase();
      const tamano = Number(req.headers['x-tamano']);
      if (!SHA256.test(sha256) || !Number.isInteger(tamano) || tamano < 1) throw httpError(422, 'parte_invalida');
      const nombre = nombreDeArchivo(req.headers['x-nombre-archivo']);
      const repetido = await repo.crearRecursoRepetido(yo, cursoDeRepetido, { nombre, tamano, sha256 });
      if (!repetido) return json(res, 404, { error: 'not_found' });
      // Que no lo tenga es lo normal: 200, no un error.
      return json(res, repetido.recurso ? 201 : 200, repetido);
    }
    const recursoDeParte = pathname.match(PARTES_DE_RECURSO_PATH)?.[1];
    if (recursoDeParte && method === 'POST') {
      const desde = Number(url.searchParams.get('desde'));
      if (!Number.isInteger(desde) || desde < 0) throw httpError(422, 'parte_invalida');
      return enviar(200, 'recurso', await repo.seguirRecurso(yo, recursoDeParte, { desde, parte: await readBody(req, MAX_PARTE_BYTES) }));
    }

    const recursoId = pathname.match(RECURSO_PATH)?.[1];
    if (recursoId && method === 'GET') {
      const recurso = await repo.leerRecurso(yo, recursoId);
      if (!recurso) return json(res, 404, { error: 'not_found' });
      // Como los archivos de un pendiente.
      return enviarGuardado(req, res, recurso);
    }
    if (recursoId && method === 'PATCH') {
      const input = await readJson(req);
      return enviar(200, 'recurso', repo.renombrarRecurso(yo, recursoId, nombreValido(input.nombre, MAX_NOMBRE_ARCHIVO, 'nombre_archivo_invalido')));
    }
    if (recursoId && method === 'DELETE') return listo(await repo.borrarRecurso(yo, recursoId));

    return json(res, 405, { error: 'method_not_allowed' });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, service: 'timermayu-pendientes-api', configured: Boolean(authPassword) });
      }

      const known = RUTAS_FIJAS.includes(url.pathname) || RUTAS_CON_ID.some((ruta) => ruta.test(url.pathname));
      if (!known) return json(res, 404, { error: 'not_found' });

      // Un archivo pedido con su enlace firmado (el reproductor de videos) no lleva contraseña.
      const archivoFirmado = req.method === 'GET' && url.searchParams.has('t') ? url.pathname.match(ARCHIVO_PATH)?.[1] : undefined;
      if (archivoFirmado) {
        const firmante = firmanteDe(archivoFirmado, url.searchParams.get('t'));
        const archivo = firmante !== undefined && await repo.leerArchivo(firmante, archivoFirmado);
        if (!archivo) return json(res, 404, { error: 'not_found' });
        return enviarGuardado(req, res, { ...archivo, descargar: url.searchParams.has('descargar') });
      }

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

      if (url.pathname === YO_PATH && req.method === 'GET') {
        // avisos_por_correo: null si no se mandan (están apagados en el servidor, o es la cuenta del equipo).
        const avisosPorCorreo = correo && yo ? { activo: repo.avisosPorCorreo(yo), correo: repo.correoDe(yo) } : null;
        return json(res, 200, { usuario: { ...usuario, notas: puedeNotas(usuario), apariencia: repo.apariencia(yo), avisos_por_correo: avisosPorCorreo } });
      }
      if (url.pathname === AVISOS_POR_CORREO_PATH && req.method === 'PUT') {
        if (!correo || !yo) return json(res, 404, { error: 'not_found' });
        const { activo } = await readJson(req);
        if (typeof activo !== 'boolean') throw httpError(422, 'activo_invalido');
        return json(res, 200, { activo: repo.guardarAvisosPorCorreo(yo, activo) });
      }
      if (url.pathname === APARIENCIA_PATH && req.method === 'PUT') {
        return json(res, 200, { apariencia: repo.guardarApariencia(yo, parseApariencia(await readJson(req))) });
      }

      if (url.pathname === NOTAS_PATH || url.pathname.startsWith(`${NOTAS_PATH}/`)) {
        if (!puedeNotas(usuario)) return json(res, 404, { error: 'not_found' });
        return await rutasDeNotas(req, res, url, yo);
      }

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
      if (url.pathname === IA_REDACTAR_PATH && req.method === 'POST') {
        const pedido = parseRedaccion(await readJson(req));
        if (pedido.donde !== 'nota') return enviar(200, 'redaccion', await repo.redactar(yo, pedido, basesIA));
        return enviar(200, 'redaccion', puedeNotas(usuario) ? await repo.redactarEnNota(yo, pedido, basesIA) : null);
      }
      if (url.pathname === IA_SUGERIR_PATH && req.method === 'POST') {
        const pedido = parseSugerencia(await readJson(req, MAX_BODY_IA_BYTES));
        const sugerir = async () => ({ sugerencias: await repo.sugerirPendientes(yo, pedido, basesIA) });
        // Sin ?trabajo, como antes (una pestaña abierta desde antes de este cambio).
        if (!url.searchParams.has('trabajo')) return json(res, 200, await sugerir());
        return json(res, 202, { trabajo: empezarTrabajo(yo, sugerir) });
      }
      const trabajoId = url.pathname.match(IA_TRABAJO_PATH)?.[1];
      if (trabajoId && req.method === 'GET') {
        const trabajo = trabajosIA.get(trabajoId);
        if (!trabajo || trabajo.yo !== yo) return json(res, 404, { error: 'not_found' });
        if (!trabajo.respuesta) return json(res, 200, { estado: 'pensando' });
        trabajosIA.delete(trabajoId);
        return json(res, trabajo.respuesta.status, trabajo.respuesta.cuerpo);
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
      const pendienteDeEvidencia = url.pathname.match(EVIDENCIA_PATH)?.[1];
      if (pendienteDeEvidencia && req.method === 'GET') return enviar(200, 'evidencia', repo.evidencia(yo, pendienteDeEvidencia));
      const pendienteDeActividad = url.pathname.match(ACTIVIDAD_ITEM_PATH)?.[1];
      if (pendienteDeActividad && req.method === 'GET') return enviar(200, 'actividad', repo.actividadDePendiente(yo, pendienteDeActividad));
      const pendienteDeComentarios = url.pathname.match(COMENTARIOS_PATH)?.[1];
      if (pendienteDeComentarios && req.method === 'GET') return enviar(200, 'comentarios', repo.listarComentarios(yo, pendienteDeComentarios));
      if (pendienteDeComentarios && req.method === 'POST') {
        return enviar(201, 'comentario', repo.crearComentario(usuario, pendienteDeComentarios, parseComentario(await readJson(req))));
      }
      const comentarioId = url.pathname.match(COMENTARIO_PATH)?.[1];
      if (comentarioId && req.method === 'DELETE') return listo(await repo.borrarComentario(usuario, comentarioId));

      if (url.pathname === TODOS_LOS_ARCHIVOS_PATH && req.method === 'GET') {
        return json(res, 200, { archivos: repo.buscarArchivos(yo, String(url.searchParams.get('q') ?? '').slice(0, 200)) });
      }
      const pendienteDeArchivos = url.pathname.match(ARCHIVOS_PATH)?.[1];
      const paraChat = url.searchParams.get('para') === 'chat';
      if (pendienteDeArchivos && req.method === 'GET') return enviar(200, 'archivos', repo.listarArchivos(yo, pendienteDeArchivos));
      if (pendienteDeArchivos && req.method === 'POST') {
        const nombre = nombreDeArchivo(req.headers['x-nombre-archivo']);
        // Lo grande llega por partes: la primera trae el tamaño total (X-Tamano).
        if (req.headers['x-tamano'] !== undefined) {
          const tamano = Number(req.headers['x-tamano']);
          if (!Number.isInteger(tamano) || tamano < 1) throw httpError(422, 'parte_invalida');
          if (tamano > MAX_ARCHIVO_GRANDE_BYTES) throw httpError(413, 'archivo_muy_grande');
          const parte = await readBody(req, MAX_PARTE_BYTES);
          return enviar(201, 'archivo', await repo.empezarArchivo(usuario, pendienteDeArchivos, { nombre, tamano, parte, paraChat }));
        }
        const contenido = await readBody(req, MAX_ARCHIVO_BYTES);
        return enviar(201, 'archivo', await repo.guardarArchivo(usuario, pendienteDeArchivos, { nombre, contenido, paraChat }));
      }
      const pendienteDeRepetido = url.pathname.match(ARCHIVO_REPETIDO_PATH)?.[1];
      if (pendienteDeRepetido && req.method === 'POST') {
        const sha256 = String(req.headers['x-sha256'] ?? '').toLowerCase();
        const tamano = Number(req.headers['x-tamano']);
        if (!SHA256.test(sha256) || !Number.isInteger(tamano) || tamano < 1) throw httpError(422, 'parte_invalida');
        const nombre = nombreDeArchivo(req.headers['x-nombre-archivo']);
        const repetido = await repo.archivoRepetido(usuario, pendienteDeRepetido, { nombre, tamano, sha256, paraChat });
        if (!repetido) return json(res, 404, { error: 'not_found' });
        // Que no esté es lo normal: 200, no un error.
        return json(res, repetido.archivo ? 201 : 200, repetido);
      }
      const pendienteDeReuso = url.pathname.match(REUSAR_ARCHIVO_PATH)?.[1];
      if (pendienteDeReuso && req.method === 'POST') {
        const { archivo_id: archivoDeOrigen } = await readJson(req);
        if (typeof archivoDeOrigen !== 'string' || !new RegExp(`^${UUID}$`).test(archivoDeOrigen)) throw httpError(422, 'archivo_invalido');
        return enviar(201, 'archivo', await repo.reusarArchivo(usuario, pendienteDeReuso, { archivo_id: archivoDeOrigen, paraChat }));
      }
      const archivoDeParte = url.pathname.match(PARTES_DE_ARCHIVO_PATH)?.[1];
      if (archivoDeParte && req.method === 'POST') {
        const desde = Number(url.searchParams.get('desde'));
        if (!Number.isInteger(desde) || desde < 0) throw httpError(422, 'parte_invalida');
        const archivo = await repo.seguirArchivo(usuario, archivoDeParte, { desde, parte: await readBody(req, MAX_PARTE_BYTES) });
        // Se avisa una vez, al completarse; no con cada parte.
        if (archivo?.subido === null) {
          const cliente = String(req.headers['x-cliente'] ?? '').slice(0, 64);
          res.on('finish', () => res.statusCode < 400 && avisarCambio({ tipo: 'archivos', pendiente_id: archivo.pendiente_id }, cliente));
        }
        return enviar(200, 'archivo', archivo);
      }
      const archivoDeEnlace = url.pathname.match(ENLACE_DE_ARCHIVO_PATH)?.[1];
      if (archivoDeEnlace && req.method === 'GET') {
        if (!(await repo.leerArchivo(yo, archivoDeEnlace))) return json(res, 404, { error: 'not_found' });
        return json(res, 200, { url: enlaceDeArchivo(archivoDeEnlace, yo) });
      }

      const archivoId = url.pathname.match(ARCHIVO_PATH)?.[1];
      if (archivoId && req.method === 'GET') {
        const archivo = await repo.leerArchivo(yo, archivoId);
        if (!archivo) return json(res, 404, { error: 'not_found' });
        return enviarGuardado(req, res, archivo);
      }
      if (archivoId && req.method === 'DELETE') return listo(await repo.borrarArchivo(usuario, archivoId));

      const pendienteDeTraspaso = url.pathname.match(TRASPASO_PATH)?.[1];
      if (pendienteDeTraspaso && req.method === 'POST') {
        return enviar(200, 'pendiente', repo.traspasar(usuario, pendienteDeTraspaso, parseTraspaso(await readJson(req))));
      }
      const pendienteDeAprobacion = url.pathname.match(APROBACION_PATH)?.[1];
      if (pendienteDeAprobacion && req.method === 'POST') return enviar(200, 'pendiente', repo.aprobar(usuario, pendienteDeAprobacion));
      if (pendienteDeAprobacion && req.method === 'DELETE') return enviar(200, 'pendiente', repo.desaprobar(usuario, pendienteDeAprobacion));

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
      if (perfilId && req.method === 'DELETE') return listo(await repo.borrarPerfil(yo, perfilId));
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

      if (url.pathname === TRAER_IMAGEN_PATH && req.method === 'POST') {
        const { url: direccion } = await readJson(req);
        if (typeof direccion !== 'string' || direccion.length > 8192) throw httpError(422, 'imagen_externa_invalida');
        const imagen = await traerImagenExterna(direccion, { redesInternas: imagenesDeRedesInternas });
        res.writeHead(200, {
          'Content-Type': imagen.tipo,
          'Content-Length': imagen.contenido.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(imagen.contenido);
      }

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
      const { status, cuerpo } = comoError(error);
      return json(res, status, cuerpo);
    }
  });
  // Las conexiones de los cambios en tiempo real no terminan solas: se cierran para que close() no espere por ellas.
  const cerrar = server.close.bind(server);
  server.close = (callback) => {
    clearInterval(latido);
    clearInterval(revisarCorreos);
    for (const conexion of conexiones) conexion.res.end();
    return cerrar(callback);
  };
  server.on('close', () => db.close());
  // Para las pruebas: la vuelta de los correos, como si fuera `ahora`.
  server.mandarAvisosPorCorreo = mandarAvisosPorCorreo;
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
} else if (isMain && process.argv[2] === 'probar-correo') {
  // Manda un correo de ejemplo para probar el SMTP:  node src/server.mjs probar-correo alguien@ejemplo.com
  const correo = crearCorreo();
  if (!correo) {
    console.error('Falta configurar SMTP_HOST y MAIL_FROM.');
    process.exitCode = 1;
  } else {
    const ahora = Date.now();
    const ejemplo = (tipo, datos, minutos) => ({
      pendiente_id: null, texto_pendiente: 'Correo de prueba', perfil_id: null, autor: 'Pendientes', tipo, datos,
      creado_en: new Date(ahora - minutos * 60_000).toISOString(),
    });
    const avisos = [ejemplo('asignado', { a: 'ti', a_id: 'prueba' }, 90), ejemplo('comentario', { menciones: ['prueba'], extracto: 'Si te llegó, el correo funciona.' }, 70)];
    correo.enviar({ to: process.argv[3], ...armarResumen({ perfil: { id: 'prueba', nombre: 'prueba' }, avisos, urlTablero: process.env.URL_TABLERO ?? URL_TABLERO, ahora }) })
      .then((info) => console.log(`Enviado (${info.messageId}).`), (error) => {
        console.error(`No se pudo mandar: ${error.message}`);
        process.exitCode = 1;
      });
  }
} else if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const dataDir = process.env.DATA_DIR || '/data';
  if (!process.env.AUTH_PASSWORD) console.warn('AUTH_PASSWORD vacío: la cuenta del equipo queda deshabilitada.');
  createApp({ dataDir }).listen(port, '0.0.0.0', () => console.log(`Pendientes API listening on :${port}`));
}
