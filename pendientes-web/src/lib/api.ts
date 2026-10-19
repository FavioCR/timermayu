export type Estado = "pendiente" | "haciendo" | "hecho"

export type Pendiente = {
  id: string
  texto: string
  proyecto: string | null
  estado: Estado
  perfil_id: string | null
  creado_en: string
  actualizado_en: string
}

export type Perfil = {
  id: string
  nombre: string
  color: string
  creado_en: string
}

// Los mismos colores que asigna el API cuando no se elige uno.
export const COLORES_PERFIL = ["#2563EB", "#DB2777", "#059669", "#7C3AED", "#EA580C", "#0891B2", "#CA8A04", "#DC2626"]

const BASE = "/api/pendientes"
const STORAGE_KEY = "pendientes.auth"

const MENSAJES: Record<string, string> = {
  authentication_required: "Usuario o contraseña incorrectos.",
  sin_conexion: "No se pudo conectar con el servidor.",
  texto_invalido: "Escribe el pendiente (máximo 500 caracteres).",
  proyecto_invalido: "El nombre del proyecto es muy largo (máximo 60 caracteres).",
  not_found: "Eso ya no existe. Recarga la página.",
  perfil_invalido: "Ese perfil ya no existe. Recarga la página.",
  nombre_invalido: "Escribe un nombre (máximo 40 caracteres).",
  perfil_duplicado: "Ya hay un perfil con ese nombre.",
}

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

export const api = {
  listar: (credenciales: string) =>
    pedir<{ pendientes: Pendiente[] }>(credenciales, "GET").then((data) => data.pendientes),
  crear: (credenciales: string, datos: { texto: string; proyecto: string | null; perfil_id: string | null }) =>
    pedir<{ pendiente: Pendiente }>(credenciales, "POST", "", datos).then((data) => data.pendiente),
  actualizar: (credenciales: string, id: string, cambios: Partial<Pick<Pendiente, "texto" | "proyecto" | "estado" | "perfil_id">>) =>
    pedir<{ pendiente: Pendiente }>(credenciales, "PATCH", `/${id}`, cambios).then((data) => data.pendiente),
  borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/${id}`),
  ordenar: (credenciales: string, items: { id: string; estado: Estado }[]) =>
    pedir<{ pendientes: Pendiente[] }>(credenciales, "PUT", "/orden", { items }).then((data) => data.pendientes),
  perfiles: {
    listar: (credenciales: string) =>
      pedir<{ perfiles: Perfil[] }>(credenciales, "GET", "/perfiles").then((data) => data.perfiles),
    crear: (credenciales: string, datos: { nombre: string; color: string }) =>
      pedir<{ perfil: Perfil }>(credenciales, "POST", "/perfiles", datos).then((data) => data.perfil),
    borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/perfiles/${id}`),
  },
}
