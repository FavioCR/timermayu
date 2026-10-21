import type { Apariencia } from "@/lib/apariencia"

export type Estado = "pendiente" | "haciendo" | "hecho"

export type TipoTrabajo = "feat" | "fix" | "refactor" | "perf" | "docs" | "test" | "style" | "chore" | "ci"

export type Pendiente = {
  id: string
  texto: string
  proyecto_id: string | null
  estado: Estado
  // feat, fix… como en los commits convencionales; null si no se eligió.
  tipo: TipoTrabajo | null
  perfil_id: string | null
  // Null si lo creó la cuenta del equipo o es de antes de que se anotara.
  creado_por: string | null
  resumen: string | null
  num_imagenes: number
  // Archivos adjuntos al pendiente y a los mensajes de su chat.
  num_archivos: number
  num_comentarios: number
  // Ids de sus etiquetas.
  etiquetas: string[]
  // Perfiles que aprobaron su funcionalidad, del primero al último. Solo en Hecho: al salir de ahí se pierden.
  aprobaciones: string[]
  creado_en: string
  actualizado_en: string
  // Cuándo pasó a Hecho; null si no está hecho. El tablero solo muestra los hechos de la última semana.
  hecho_en: string | null
}

// Solo el detalle trae la descripción: el documento del editor en JSON.
export type PendienteDetalle = Pendiente & { descripcion: string | null }

export type CambiosPendiente = Partial<
  Pick<Pendiente, "texto" | "proyecto_id" | "estado" | "tipo" | "perfil_id" | "etiquetas"> & { descripcion: string | null }
>

// Etiquetas de todo el equipo: el sprint, por ejemplo.
export type Etiqueta = { id: string; nombre: string; color: string; creado_en: string }

export type ProveedorIA = "gemini" | "openai" | "openrouter"

// La IA que crea pendientes. De las claves solo se sabe si hay una y sus últimos 4 caracteres: nunca salen del servidor.
export type AjustesIA = {
  proveedor: ProveedorIA | null
  instrucciones: string | null
  // A lo que se crea sin tipo, la IA le pone uno.
  tipo_automatico: boolean
  // Hay proveedor elegido y tiene clave.
  lista: boolean
  // La IA de "Escribir con IA" (/ia) si es otra que la de arriba; `lista` dice si su proveedor tiene clave.
  redaccion: { proveedor: ProveedorIA; modelo: string; lista: boolean } | null
  proveedores: {
    id: ProveedorIA
    nombre: string
    modelo: string
    modelo_por_defecto: string
    tiene_clave: boolean
    clave_final: string | null
  }[]
}

// Una clave o un modelo en null se borra (el modelo vuelve al de siempre); lo que no viene no cambia.
export type CambiosIA = {
  proveedor?: ProveedorIA | null
  instrucciones?: string | null
  tipo_automatico?: boolean
  redaccion?: { proveedor: ProveedorIA; modelo: string } | null
  modelos?: Partial<Record<ProveedorIA, string | null>>
  claves?: Partial<Record<ProveedorIA, string | null>>
}

export type ModeloIA = { id: string; nombre: string }

// Un pendiente que propone la IA; no existe hasta que se crea.
export type Sugerencia = {
  texto: string
  detalle: string | null
  perfil_id: string | null
  proyecto_id: string | null
  tipo: TipoTrabajo | null
  etiquetas: string[]
  estado: Estado
  // Las imágenes enviadas que muestran esta tarea, por su posición (desde 0).
  imagenes: number[]
}

export type Perfil = {
  id: string
  nombre: string
  correo: string | null
  // Solo dígitos, con código de país (como lo pide wa.me).
  telefono: string | null
  color: string
  tiene_contrasena: boolean
  creado_en: string
}

// Quien entró: un perfil, o la cuenta del equipo (perfil_id null), que solo ve lo compartido.
// notas: si tiene las notas privadas (apuntes de cursos).
// `apariencia`: la fuente y el tamaño de letra que eligió (null: la de siempre).
// `avisos_por_correo`: si le llegan por correo los avisos que no vio, y a qué correo (null: no se mandan correos).
export type Usuario = {
  perfil_id: string | null
  nombre: string
  notas: boolean
  apariencia: Apariencia | null
  avisos_por_correo: { activo: boolean; correo: string | null } | null
}

// Al reescribir lo seleccionado en el editor: que vuelva solo su reemplazo y, si se dice, cómo reescribirlo.
export type OpcionesRedaccion = { seleccion?: boolean; indicacion?: string }

// Sin dueño es del equipo. Las privadas solo las ve su dueño, igual que sus proyectos y pendientes.
export type Organizacion = {
  id: string
  nombre: string
  color: string
  duenio_id: string | null
  compartida: boolean
  creado_en: string
  // Ids de sus involucrados: a quiénes se filtra y asigna dentro de ella.
  miembros: string[]
}

export type Proyecto = {
  id: string
  nombre: string
  organizacion_id: string | null
  creado_en: string
}

export type TipoActividad =
  | "creado"
  | "texto"
  | "estado"
  | "asignado"
  | "proyecto"
  | "descripcion"
  | "comentario"
  | "borrado"
  | "traspaso"
  | "archivo"
  | "etiquetas"
  | "tipo"
  | "aprobado"
  | "aprobacion_quitada"

// Lo que se anota según el tipo: de/a en los cambios, extracto y menciones (ids de perfil) en los mensajes, etc.
export type DatosActividad = {
  de?: string | null
  a?: string | null
  a_id?: string | null
  estado?: string
  asignado?: string | null
  asignado_id?: string | null
  proyecto?: string | null
  comentario_id?: string
  extracto?: string
  menciones?: string[]
  respondido_id?: string
  adjuntos?: string[]
  de_id?: string | null
  nota?: string
  archivo_id?: string
  nombre?: string
  agregadas?: string[]
  quitadas?: string[]
  // El tipo lo puso la IA.
  ia?: boolean
}

// Una entrada del historial. Guarda nombres (no solo ids) para leerse aunque el perfil o el proyecto ya no existan.
// pendiente_id es null si el pendiente ya se borró.
export type Actividad = {
  id: string
  pendiente_id: string | null
  texto_pendiente: string
  perfil_id: string | null
  autor: string
  tipo: TipoActividad
  datos: DatosActividad | null
  creado_en: string
}

export type Notificacion = { id: string; leida: boolean; actividad: Actividad }

// Un pendiente con avisos sin leer: cuántos y cuántos son menciones (o respuestas a un mensaje tuyo).
export type SinLeer = { pendiente_id: string; avisos: number; menciones: number }

export type Comentario = {
  id: string
  pendiente_id: string
  perfil_id: string | null
  autor: string
  texto: string
  // El mensaje al que responde, como en WhatsApp; puede ya no estar si se borró.
  respuesta_a: string | null
  creado_en: string
  archivos: Archivo[]
}

// Un archivo adjunto. Si es de un mensaje, comentario_id dice de cuál. `tipo` es image/*, application/pdf
// (se pueden ver en el navegador) o application/octet-stream (solo se descarga).
export type Archivo = {
  id: string
  pendiente_id: string
  comentario_id: string | null
  nombre: string
  tipo: string
  tamano: number
  perfil_id: string | null
  autor: string
  creado_en: string
}

// Los mismos colores que asigna el API cuando no se elige uno.
export const COLORES_PERFIL = ["#2563EB", "#DB2777", "#059669", "#7C3AED", "#EA580C", "#0891B2", "#CA8A04", "#DC2626"]

// El primer color que nadie usa todavía; si ya se usan todos, se repiten en orden.
export function colorLibre(usados: string[]) {
  const ocupados = new Set(usados.map((color) => color.toUpperCase()))
  return COLORES_PERFIL.find((color) => !ocupados.has(color)) ?? COLORES_PERFIL[usados.length % COLORES_PERFIL.length]
}

const BASE = "/api/pendientes"
const STORAGE_KEY = "pendientes.auth"

const MENSAJES: Record<string, string> = {
  authentication_required: "Usuario o contraseña incorrectos.",
  sin_conexion: "No se pudo conectar con el servidor.",
  // Respuestas del servidor web (nginx), no de la API.
  http_502: "El servidor no está disponible en este momento. Vuelve a intentar en un momento.",
  http_503: "El servidor no está disponible en este momento. Vuelve a intentar en un momento.",
  http_504: "El servidor tardó demasiado en responder. Vuelve a intentar.",
  ia_trabajo_perdido: "Se perdió la respuesta de la IA (el servidor se reinició). Vuelve a intentar.",
  texto_invalido: "Escribe el pendiente (máximo 500 caracteres).",
  proyecto_invalido: "Ese proyecto ya no existe o no lo puedes ver. Recarga la página.",
  not_found: "Eso ya no existe. Recarga la página.",
  perfil_invalido: "Ese perfil ya no existe. Recarga la página.",
  nombre_invalido: "Escribe un nombre (máximo 40 caracteres, o 60 en proyectos).",
  perfil_duplicado: "Ya hay un perfil con ese nombre.",
  nombre_reservado: "Ese nombre es el de la cuenta del equipo; elige otro.",
  correo_invalido: "Ese correo no parece válido.",
  telefono_invalido: "Escribe el teléfono con código de país, por ejemplo +506 8888 8888.",
  comentario_invalido: "Escribe el mensaje (máximo 2000 caracteres).",
  solo_el_autor: "Solo quien escribió el mensaje lo puede borrar.",
  aprobar_con_perfil: "Para aprobar, entra con tu perfil.",
  aprobar_solo_hechos: "Solo se aprueba lo que está en Hecho.",
  aprobar_lo_propio: "Lo que está a tu cargo lo aprueba otra persona.",
  correo_duplicado: "Ese correo ya lo tiene otro perfil.",
  contrasena_invalida: "La contraseña debe tener al menos 8 caracteres.",
  solo_el_mismo: "Ese perfil ya tiene contraseña: solo esa persona puede cambiarlo.",
  perfil_con_privadas: "Ese perfil tiene organizaciones privadas: compártelas o bórralas antes.",
  demasiados_intentos: "Demasiados intentos fallidos. Espera 15 minutos.",
  organizacion_invalida: "Esa organización ya no existe o no la puedes ver. Recarga la página.",
  organizacion_duplicada: "Ya tienes una organización con ese nombre.",
  organizacion_con_pendientes: "Todavía tiene pendientes: muévelos a otro proyecto o bórralos antes.",
  organizacion_del_equipo: "Una organización del equipo no puede ser privada.",
  solo_el_duenio: "Solo quien creó la organización puede cambiarla o borrarla.",
  miembros_invalidos: "Alguna de esas personas ya no existe. Recarga la página.",
  miembros_en_privada: "Una organización privada solo es de su dueño. Compártela para agregar personas.",
  proyecto_duplicado: "Ya hay un proyecto con ese nombre en esa organización.",
  proyecto_con_pendientes: "Todavía tiene pendientes: muévelos a otro proyecto o bórralos antes.",
  descripcion_invalida: "La descripción es demasiado larga.",
  imagen_invalida: "Solo se pueden subir imágenes PNG, JPG, GIF o WebP.",
  body_too_large: "El archivo pesa más de 10 MB.",
  archivo_vacio: "Ese archivo está vacío.",
  archivos_invalidos: "Esos archivos ya no están listos para enviar. Vuelve a adjuntarlos.",
  archivo_de_mensaje: "Ese archivo es de un mensaje del chat: se quita borrando el mensaje.",
  nombre_archivo_invalido: "El nombre del archivo no se pudo leer. Cámbialo y vuelve a intentar.",
  nota_invalida: "La nota puede tener hasta 500 caracteres.",
  respuesta_invalida: "El mensaje al que respondías ya no está.",
  etiqueta_duplicada: "Ya hay una etiqueta con ese nombre.",
  tipo_invalido: "Ese tipo no existe. Recarga la página.",
  etiquetas_invalidas: "Alguna de esas etiquetas ya no existe. Recarga la página.",
  clave_invalida: "Esa clave no parece válida: pégala completa, sin espacios.",
  modelo_invalido: "Escribe el nombre del modelo, sin espacios.",
  instrucciones_invalidas: "Las indicaciones pueden tener hasta 2000 caracteres.",
  texto_ia_invalido: "Escribe o pega el texto (hasta 20 000 caracteres), o adjunta una imagen.",
  imagenes_ia_invalidas: "Alguna imagen no se pudo leer. Usa PNG, JPG o WebP, hasta 6.",
  imagenes_ia_muy_grandes: "Las imágenes pesan demasiado juntas. Quita alguna y vuelve a intentar.",
  ia_sin_imagenes: "Ese modelo no lee imágenes. Elige otro en la configuración de la IA o quita las imágenes.",
  ia_no_configurada: "Todavía no hay una IA configurada.",
  ia_sin_clave: "Falta la clave de ese proveedor. Agrégala en la configuración de la IA.",
  ia_clave_invalida: "El proveedor rechazó la clave. Revísala en la configuración de la IA.",
  ia_sin_saldo: "La cuenta del proveedor no tiene saldo.",
  ia_limite: "El proveedor está limitando las peticiones. Espera un momento y vuelve a intentar.",
  ia_modelo_invalido: "El proveedor no reconoce ese modelo. Elige otro en la configuración de la IA.",
  ia_se_nego: "La IA no quiso procesar ese texto.",
  ia_incompleta: "La respuesta de la IA quedó cortada. Prueba con un texto más corto.",
  ia_respuesta_invalida: "La IA respondió algo que no se pudo leer. Vuelve a intentar.",
  ia_tardo: "La IA tardó demasiado en responder. Vuelve a intentar.",
  ia_sin_conexion: "El servidor no pudo conectarse con el proveedor de IA.",
  ia_fallo: "El proveedor de IA devolvió un error.",
  perfil_con_notas: "Ese perfil tiene notas: bórralas antes.",
  nombre_curso_invalido: "Escribe el nombre del curso (máximo 80 caracteres).",
  icono_invalido: "Elige un ícono para el curso.",
  titulo_nota_invalido: "El título puede tener hasta 200 caracteres.",
  contenido_nota_invalido: "La nota es demasiado larga para guardarla.",
  curso_invalido: "Ese curso ya no existe. Recarga la página.",
  recurso_muy_grande: "El archivo pesa más de 300 MB.",
  parte_invalida: "El archivo no se pudo subir. Vuelve a intentar.",
  parte_fuera_de_orden: "El archivo no se pudo subir. Vuelve a intentar.",
  apariencia_invalida: "Esa fuente o ese tamaño no se pueden usar.",
  indicacion_invalida: "La indicación puede tener hasta 300 caracteres.",
}

// Cada pestaña se identifica para que los cambios en tiempo real no le avisen de lo que ella misma hizo.
export const CLIENTE = crypto.randomUUID()

export const MAX_IMAGEN_BYTES = 10 * 1024 * 1024

export class ApiError extends Error {
  code: string
  status: number
  // Lo que dijo el proveedor de IA, cuando sirve para entender el error.
  detalle?: string

  constructor(code: string, status: number, detalle?: string) {
    super(code)
    this.code = code
    this.status = status
    this.detalle = detalle
  }
}

export function mensajeDeError(error: unknown) {
  const code = error instanceof ApiError ? error.code : ""
  const mensaje = MENSAJES[code] ?? "Algo salió mal. Intenta de nuevo."
  return error instanceof ApiError && error.detalle ? `${mensaje} (${error.detalle})` : mensaje
}

// No hubo respuesta del servidor, o el proxy no lo alcanzó (502/503/504).
export function esSinConexion(error: unknown) {
  return error instanceof ApiError && (error.status === 0 || [502, 503, 504].includes(error.status))
}

export function esNoAutorizado(error: unknown) {
  return error instanceof ApiError && error.status === 401
}

export function crearCredenciales(usuario: string, contrasena: string) {
  const bytes = new TextEncoder().encode(`${usuario}:${contrasena}`)
  return btoa(String.fromCharCode(...bytes))
}

// Las credenciales son "usuario:contraseña" en base64. Al cambiar el propio nombre o la contraseña
// se rehacen para no tener que volver a entrar.
export function partesDe(credenciales: string) {
  const texto = new TextDecoder().decode(Uint8Array.from(atob(credenciales), (c) => c.charCodeAt(0)))
  const separador = texto.indexOf(":")
  return { usuario: texto.slice(0, separador), contrasena: texto.slice(separador + 1) }
}

export function leerCredenciales() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function guardarCredenciales(credenciales: string | null) {
  try {
    if (credenciales) localStorage.setItem(STORAGE_KEY, credenciales)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Sin almacenamiento (modo privado): habrá que entrar de nuevo al recargar.
  }
}

export async function pedir<T>(credenciales: string, method: string, ruta = "", body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${ruta}`, {
      method,
      headers: {
        Authorization: `Basic ${credenciales}`,
        "X-Cliente": CLIENTE,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    })
  } catch {
    throw new ApiError("sin_conexion", 0)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(data.error ?? `http_${response.status}`, response.status, data.detalle)
  return data as T
}

const PREGUNTAR_CADA_MS = 1500
// El servidor corta a la IA mucho antes; esto es por si el trabajo quedara colgado.
const MAX_ESPERA_TRABAJO_MS = 3 * 60_000

// Pregunta por un trabajo de la IA hasta que termina. Un corte de red suelto no lo hace fallar; si el servidor se
// reinició, el trabajo ya no existe.
async function esperarTrabajo<T>(credenciales: string, ruta: string): Promise<T> {
  const hasta = Date.now() + MAX_ESPERA_TRABAJO_MS
  let cortes = 0
  while (Date.now() < hasta) {
    await new Promise((listo) => setTimeout(listo, PREGUNTAR_CADA_MS))
    try {
      const data = await pedir<T | { estado: "pensando" }>(credenciales, "GET", ruta)
      cortes = 0
      if (!(data as { estado?: string }).estado) return data as T
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) throw new ApiError("ia_trabajo_perdido", 404)
      if (!esSinConexion(err) || ++cortes > 3) throw err
    }
  }
  throw new ApiError("ia_tardo", 504)
}

async function subirImagen(credenciales: string, pendienteId: string, archivo: File) {
  if (archivo.size > MAX_IMAGEN_BYTES) throw new ApiError("body_too_large", 413)
  let response: Response
  try {
    response = await fetch(`${BASE}/${pendienteId}/imagenes`, {
      method: "POST",
      headers: { Authorization: `Basic ${credenciales}`, "X-Cliente": CLIENTE, "Content-Type": archivo.type || "application/octet-stream" },
      body: archivo,
    })
  } catch {
    throw new ApiError("sin_conexion", 0)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(data.error ?? `http_${response.status}`, response.status)
  return (data as { imagen: { id: string; url: string } }).imagen
}

// Cualquier archivo, para un pendiente o (con paraChat) para el próximo mensaje del chat.
async function subirArchivo(credenciales: string, pendienteId: string, archivo: File, paraChat = false) {
  if (archivo.size > MAX_IMAGEN_BYTES) throw new ApiError("body_too_large", 413)
  let response: Response
  try {
    response = await fetch(`${BASE}/${pendienteId}/archivos${paraChat ? "?para=chat" : ""}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credenciales}`,
        "X-Cliente": CLIENTE,
        "Content-Type": archivo.type || "application/octet-stream",
        "X-Nombre-Archivo": encodeURIComponent(archivo.name),
      },
      body: archivo,
    })
  } catch {
    throw new ApiError("sin_conexion", 0)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(data.error ?? `http_${response.status}`, response.status)
  return (data as { archivo: Archivo }).archivo
}

async function descargarArchivo(credenciales: string, id: string) {
  let response: Response
  try {
    response = await fetch(`${BASE}/archivos/${id}`, { headers: { Authorization: `Basic ${credenciales}` } })
  } catch {
    throw new ApiError("sin_conexion", 0)
  }
  if (!response.ok) throw new ApiError(response.status === 404 ? "not_found" : `http_${response.status}`, response.status)
  return response.blob()
}

// Las imágenes piden contraseña, así que un <img src> directo no sirve: se bajan con fetch y se
// muestran desde un blob. Cada url es un archivo que nunca cambia, así que se guarda una vez.
const imagenesEnMemoria = new Map<string, Promise<string>>()

function urlDeImagen(credenciales: string, url: string) {
  let promesa = imagenesEnMemoria.get(url)
  if (!promesa) {
    promesa = fetch(url, { headers: { Authorization: `Basic ${credenciales}` } }).then(async (response) => {
      if (!response.ok) throw new ApiError(`http_${response.status}`, response.status)
      return URL.createObjectURL(await response.blob())
    })
    promesa.catch(() => imagenesEnMemoria.delete(url))
    imagenesEnMemoria.set(url, promesa)
  }
  return promesa
}

// Después de pasar algo a Hecho: si hay que recordarle dejar la evidencia, cuántos van seguidos sin ella y cuáles.
export type Evidencia = { recordar: boolean; seguidos: number; sin_evidencia: { id: string; texto: string; hecho_en: string }[] }

export const api = {
  yo: (credenciales: string) => pedir<{ usuario: Usuario }>(credenciales, "GET", "/yo").then((data) => data.usuario),
  guardarApariencia: (credenciales: string, apariencia: Apariencia) =>
    pedir<{ apariencia: Apariencia }>(credenciales, "PUT", "/yo/apariencia", apariencia).then((data) => data.apariencia),
  guardarAvisosPorCorreo: (credenciales: string, activo: boolean) =>
    pedir<{ activo: boolean }>(credenciales, "PUT", "/yo/avisos-por-correo", { activo }).then((data) => data.activo),
  evidencia: (credenciales: string, id: string) =>
    pedir<{ evidencia: Evidencia }>(credenciales, "GET", `/${id}/evidencia`).then((data) => data.evidencia),
  listar: (credenciales: string) =>
    pedir<{ pendientes: Pendiente[] }>(credenciales, "GET").then((data) => data.pendientes),
  crear: (
    credenciales: string,
    datos: {
      texto: string
      proyecto_id: string | null
      estado?: Estado
      // Sin tipo (undefined), la IA lo elige si está configurada; null es "sin tipo" a propósito.
      tipo?: TipoTrabajo | null
      perfil_id: string | null
      etiquetas?: string[]
      descripcion?: string
    }
  ) =>
    pedir<{ pendiente: Pendiente; eligiendo_tipo: boolean }>(credenciales, "POST", "", datos).then((data) =>
      Object.assign(data.pendiente, { eligiendoTipo: data.eligiendo_tipo })
    ),
  detalle: (credenciales: string, id: string) =>
    pedir<{ pendiente: PendienteDetalle }>(credenciales, "GET", `/${id}`).then((data) => data.pendiente),
  actualizar: (credenciales: string, id: string, cambios: CambiosPendiente) =>
    pedir<{ pendiente: Pendiente }>(credenciales, "PATCH", `/${id}`, cambios).then((data) => data.pendiente),
  borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/${id}`),
  // Vuelve a Por hacer con otra persona como responsable; conserva historial, chat y archivos.
  traspasar: (credenciales: string, id: string, perfilId: string, nota: string) =>
    pedir<{ pendiente: Pendiente }>(credenciales, "POST", `/${id}/traspaso`, { perfil_id: perfilId, nota }).then((data) => data.pendiente),
  // El check de otro perfil sobre un pendiente hecho: aprueba su funcionalidad (o quita esa aprobación).
  aprobar: (credenciales: string, id: string) =>
    pedir<{ pendiente: Pendiente }>(credenciales, "POST", `/${id}/aprobacion`).then((data) => data.pendiente),
  desaprobar: (credenciales: string, id: string) =>
    pedir<{ pendiente: Pendiente }>(credenciales, "DELETE", `/${id}/aprobacion`).then((data) => data.pendiente),
  ordenar: (credenciales: string, items: { id: string; estado: Estado }[]) =>
    pedir<{ pendientes: Pendiente[] }>(credenciales, "PUT", "/orden", { items }).then((data) => data.pendientes),
  subirImagen,
  urlDeImagen,
  perfiles: {
    listar: (credenciales: string) =>
      pedir<{ perfiles: Perfil[] }>(credenciales, "GET", "/perfiles").then((data) => data.perfiles),
    crear: (credenciales: string, datos: { nombre: string; color: string; correo: string | null; telefono: string | null }) =>
      pedir<{ perfil: Perfil }>(credenciales, "POST", "/perfiles", datos).then((data) => data.perfil),
    actualizar: (credenciales: string, id: string, cambios: Partial<Pick<Perfil, "nombre" | "correo" | "telefono" | "color">>) =>
      pedir<{ perfil: Perfil }>(credenciales, "PATCH", `/perfiles/${id}`, cambios).then((data) => data.perfil),
    ponerContrasena: (credenciales: string, id: string, contrasena: string) =>
      pedir<{ perfil: Perfil }>(credenciales, "PUT", `/perfiles/${id}/contrasena`, { contrasena }).then((data) => data.perfil),
    borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/perfiles/${id}`),
  },
  actividad: {
    listar: (credenciales: string, antes?: string) =>
      pedir<{ actividad: Actividad[] }>(credenciales, "GET", `/actividad${antes ? `?antes=${encodeURIComponent(antes)}` : ""}`).then(
        (data) => data.actividad
      ),
    dePendiente: (credenciales: string, id: string) =>
      pedir<{ actividad: Actividad[] }>(credenciales, "GET", `/${id}/actividad`).then((data) => data.actividad),
  },
  comentarios: {
    listar: (credenciales: string, pendienteId: string) =>
      pedir<{ comentarios: Comentario[] }>(credenciales, "GET", `/${pendienteId}/comentarios`).then((data) => data.comentarios),
    crear: (credenciales: string, pendienteId: string, texto: string, archivos: string[] = [], respuestaA: string | null = null) =>
      pedir<{ comentario: Comentario }>(credenciales, "POST", `/${pendienteId}/comentarios`, { texto, archivos, respuesta_a: respuestaA }).then(
        (data) => data.comentario
      ),
    borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/comentarios/${id}`),
  },
  archivos: {
    listar: (credenciales: string, pendienteId: string) =>
      pedir<{ archivos: Archivo[] }>(credenciales, "GET", `/${pendienteId}/archivos`).then((data) => data.archivos),
    subir: subirArchivo,
    descargar: descargarArchivo,
    borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/archivos/${id}`),
  },
  notificaciones: {
    listar: (credenciales: string) =>
      pedir<{ notificaciones: Notificacion[]; no_leidas: number; sin_leer: SinLeer[] }>(credenciales, "GET", "/notificaciones"),
    // Sin ids marca todas.
    marcarLeidas: (credenciales: string, ids?: string[]) =>
      pedir<{ no_leidas: number }>(credenciales, "POST", "/notificaciones/leidas", ids ? { ids } : {}).then((data) => data.no_leidas),
    // Los de un pendiente, al abrirlo.
    leerPendiente: (credenciales: string, pendienteId: string) =>
      pedir<{ no_leidas: number }>(credenciales, "POST", "/notificaciones/leidas", { pendiente_id: pendienteId }).then((data) => data.no_leidas),
  },
  organizaciones: {
    listar: (credenciales: string) =>
      pedir<{ organizaciones: Organizacion[] }>(credenciales, "GET", "/organizaciones").then((data) => data.organizaciones),
    crear: (credenciales: string, datos: { nombre: string; color: string; compartida: boolean }) =>
      pedir<{ organizacion: Organizacion }>(credenciales, "POST", "/organizaciones", datos).then((data) => data.organizacion),
    actualizar: (credenciales: string, id: string, cambios: Partial<Pick<Organizacion, "nombre" | "color" | "compartida" | "miembros">>) =>
      pedir<{ organizacion: Organizacion }>(credenciales, "PATCH", `/organizaciones/${id}`, cambios).then((data) => data.organizacion),
    borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/organizaciones/${id}`),
  },
  etiquetas: {
    listar: (credenciales: string) =>
      pedir<{ etiquetas: Etiqueta[] }>(credenciales, "GET", "/etiquetas").then((data) => data.etiquetas),
    crear: (credenciales: string, datos: { nombre: string; color?: string }) =>
      pedir<{ etiqueta: Etiqueta }>(credenciales, "POST", "/etiquetas", datos).then((data) => data.etiqueta),
    actualizar: (credenciales: string, id: string, cambios: Partial<Pick<Etiqueta, "nombre" | "color">>) =>
      pedir<{ etiqueta: Etiqueta }>(credenciales, "PATCH", `/etiquetas/${id}`, cambios).then((data) => data.etiqueta),
    borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/etiquetas/${id}`),
  },
  ia: {
    leer: (credenciales: string) => pedir<{ ia: AjustesIA }>(credenciales, "GET", "/ia").then((data) => data.ia),
    guardar: (credenciales: string, cambios: CambiosIA) =>
      pedir<{ ia: AjustesIA }>(credenciales, "PUT", "/ia", cambios).then((data) => data.ia),
    // Con la clave guardada, o con una que se está escribiendo (va en el cuerpo y no se guarda).
    modelos: (credenciales: string, proveedor: ProveedorIA, clave?: string) =>
      pedir<{ modelos: ModeloIA[] }>(credenciales, "POST", "/ia/modelos", { proveedor, clave }).then((data) => data.modelos),
    // Propone pendientes a partir de un texto; no crea nada.
    // Las imágenes van en base64 dentro del JSON (sin el prefijo "data:…;base64,").
    // La IA puede tardar más de lo que el servidor web espera una respuesta (12 s): queda trabajando allá y se le
    // pregunta cada poco hasta que termina.
    sugerir: async (credenciales: string, texto: string, proyectoId: string | null, imagenes: string[] = []) => {
      const { trabajo } = await pedir<{ trabajo: string }>(credenciales, "POST", "/ia/sugerir?trabajo", {
        texto,
        proyecto_id: proyectoId,
        imagenes: imagenes.map((datos) => ({ datos })),
      })
      return (await esperarTrabajo<{ sugerencias: Sugerencia[] }>(credenciales, `/ia/sugerir/${trabajo}`)).sugerencias
    },
    // Un borrador (o lo que ya está escrito) bien redactado para el chat o la descripción de un pendiente.
    redactar: (credenciales: string, pendienteId: string, donde: "chat" | "descripcion", texto: string, opciones: OpcionesRedaccion = {}) =>
      pedir<{ redaccion: { texto: string } }>(credenciales, "POST", "/ia/redactar", {
        texto,
        donde,
        pendiente_id: pendienteId,
        ...opciones,
      }).then((data) => data.redaccion.texto),
  },
  proyectos: {
    listar: (credenciales: string) =>
      pedir<{ proyectos: Proyecto[] }>(credenciales, "GET", "/proyectos").then((data) => data.proyectos),
    crear: (credenciales: string, datos: { nombre: string; organizacion_id: string | null }) =>
      pedir<{ proyecto: Proyecto }>(credenciales, "POST", "/proyectos", datos).then((data) => data.proyecto),
    actualizar: (credenciales: string, id: string, cambios: Partial<Pick<Proyecto, "nombre" | "organizacion_id">>) =>
      pedir<{ proyecto: Proyecto }>(credenciales, "PATCH", `/proyectos/${id}`, cambios).then((data) => data.proyecto),
    borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/proyectos/${id}`),
  },
}
