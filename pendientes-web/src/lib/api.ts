export type Estado = "pendiente" | "haciendo" | "hecho"

export type Pendiente = {
  id: string
  texto: string
  proyecto_id: string | null
  estado: Estado
  perfil_id: string | null
  resumen: string | null
  num_imagenes: number
  creado_en: string
  actualizado_en: string
}

// Solo el detalle trae la descripción: el documento del editor en JSON.
export type PendienteDetalle = Pendiente & { descripcion: string | null }

export type CambiosPendiente = Partial<Pick<Pendiente, "texto" | "proyecto_id" | "estado" | "perfil_id"> & { descripcion: string | null }>

export type Perfil = {
  id: string
  nombre: string
  correo: string | null
  color: string
  tiene_contrasena: boolean
  creado_en: string
}

// Quien entró: un perfil, o la cuenta del equipo (perfil_id null), que solo ve lo compartido.
export type Usuario = { perfil_id: string | null; nombre: string }

// Sin dueño es del equipo. Las privadas solo las ve su dueño, igual que sus proyectos y pendientes.
export type Organizacion = {
  id: string
  nombre: string
  color: string
  duenio_id: string | null
  compartida: boolean
  creado_en: string
}

export type Proyecto = {
  id: string
  nombre: string
  organizacion_id: string | null
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
  texto_invalido: "Escribe el pendiente (máximo 500 caracteres).",
  proyecto_invalido: "Ese proyecto ya no existe o no lo puedes ver. Recarga la página.",
  not_found: "Eso ya no existe. Recarga la página.",
  perfil_invalido: "Ese perfil ya no existe. Recarga la página.",
  nombre_invalido: "Escribe un nombre (máximo 40 caracteres, o 60 en proyectos).",
  perfil_duplicado: "Ya hay un perfil con ese nombre.",
  nombre_reservado: "Ese nombre es el de la cuenta del equipo; elige otro.",
  correo_invalido: "Ese correo no parece válido.",
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
  proyecto_duplicado: "Ya hay un proyecto con ese nombre en esa organización.",
  proyecto_con_pendientes: "Todavía tiene pendientes: muévelos a otro proyecto o bórralos antes.",
  descripcion_invalida: "La descripción es demasiado larga.",
  imagen_invalida: "Solo se pueden subir imágenes PNG, JPG, GIF o WebP.",
  body_too_large: "La imagen pesa más de 10 MB.",
}

export const MAX_IMAGEN_BYTES = 10 * 1024 * 1024

export class ApiError extends Error {
  code: string
  status: number

  constructor(code: string, status: number) {
    super(code)
    this.code = code
    this.status = status
  }
}

export function mensajeDeError(error: unknown) {
  const code = error instanceof ApiError ? error.code : ""
  return MENSAJES[code] ?? "Algo salió mal. Intenta de nuevo."
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

async function pedir<T>(credenciales: string, method: string, ruta = "", body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${ruta}`, {
      method,
      headers: {
        Authorization: `Basic ${credenciales}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    })
  } catch {
    throw new ApiError("sin_conexion", 0)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(data.error ?? `http_${response.status}`, response.status)
  return data as T
}

async function subirImagen(credenciales: string, pendienteId: string, archivo: File) {
  if (archivo.size > MAX_IMAGEN_BYTES) throw new ApiError("body_too_large", 413)
  let response: Response
  try {
    response = await fetch(`${BASE}/${pendienteId}/imagenes`, {
      method: "POST",
      headers: { Authorization: `Basic ${credenciales}`, "Content-Type": archivo.type || "application/octet-stream" },
      body: archivo,
    })
  } catch {
    throw new ApiError("sin_conexion", 0)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(data.error ?? `http_${response.status}`, response.status)
  return (data as { imagen: { id: string; url: string } }).imagen
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

export const api = {
  yo: (credenciales: string) => pedir<{ usuario: Usuario }>(credenciales, "GET", "/yo").then((data) => data.usuario),
  listar: (credenciales: string) =>
    pedir<{ pendientes: Pendiente[] }>(credenciales, "GET").then((data) => data.pendientes),
  crear: (credenciales: string, datos: { texto: string; proyecto_id: string | null; estado?: Estado; perfil_id: string | null }) =>
    pedir<{ pendiente: Pendiente }>(credenciales, "POST", "", datos).then((data) => data.pendiente),
  detalle: (credenciales: string, id: string) =>
    pedir<{ pendiente: PendienteDetalle }>(credenciales, "GET", `/${id}`).then((data) => data.pendiente),
  actualizar: (credenciales: string, id: string, cambios: CambiosPendiente) =>
    pedir<{ pendiente: Pendiente }>(credenciales, "PATCH", `/${id}`, cambios).then((data) => data.pendiente),
  borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/${id}`),
  ordenar: (credenciales: string, items: { id: string; estado: Estado }[]) =>
    pedir<{ pendientes: Pendiente[] }>(credenciales, "PUT", "/orden", { items }).then((data) => data.pendientes),
  subirImagen,
  urlDeImagen,
  perfiles: {
    listar: (credenciales: string) =>
      pedir<{ perfiles: Perfil[] }>(credenciales, "GET", "/perfiles").then((data) => data.perfiles),
    crear: (credenciales: string, datos: { nombre: string; color: string; correo: string | null }) =>
      pedir<{ perfil: Perfil }>(credenciales, "POST", "/perfiles", datos).then((data) => data.perfil),
    actualizar: (credenciales: string, id: string, cambios: Partial<Pick<Perfil, "nombre" | "correo" | "color">>) =>
      pedir<{ perfil: Perfil }>(credenciales, "PATCH", `/perfiles/${id}`, cambios).then((data) => data.perfil),
    ponerContrasena: (credenciales: string, id: string, contrasena: string) =>
      pedir<{ perfil: Perfil }>(credenciales, "PUT", `/perfiles/${id}/contrasena`, { contrasena }).then((data) => data.perfil),
    borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/perfiles/${id}`),
  },
  organizaciones: {
    listar: (credenciales: string) =>
      pedir<{ organizaciones: Organizacion[] }>(credenciales, "GET", "/organizaciones").then((data) => data.organizaciones),
    crear: (credenciales: string, datos: { nombre: string; color: string; compartida: boolean }) =>
      pedir<{ organizacion: Organizacion }>(credenciales, "POST", "/organizaciones", datos).then((data) => data.organizacion),
    actualizar: (credenciales: string, id: string, cambios: Partial<Pick<Organizacion, "nombre" | "color" | "compartida">>) =>
      pedir<{ organizacion: Organizacion }>(credenciales, "PATCH", `/organizaciones/${id}`, cambios).then((data) => data.organizacion),
    borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/organizaciones/${id}`),
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
