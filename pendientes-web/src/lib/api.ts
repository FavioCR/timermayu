export type Estado = "pendiente" | "haciendo" | "hecho"

export type Pendiente = {
  id: string
  texto: string
  proyecto: string | null
  estado: Estado
  creado_en: string
  actualizado_en: string
}

const BASE = "/api/pendientes"
const STORAGE_KEY = "pendientes.auth"

const MENSAJES: Record<string, string> = {
  authentication_required: "Usuario o contraseña incorrectos.",
  sin_conexion: "No se pudo conectar con el servidor.",
  texto_invalido: "Escribe el pendiente (máximo 500 caracteres).",
  proyecto_invalido: "El nombre del proyecto es muy largo (máximo 60 caracteres).",
  not_found: "Ese pendiente ya no existe. Recarga la página.",
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
  crear: (credenciales: string, datos: { texto: string; proyecto: string | null }) =>
    pedir<{ pendiente: Pendiente }>(credenciales, "POST", "", datos).then((data) => data.pendiente),
  actualizar: (credenciales: string, id: string, cambios: Partial<Pick<Pendiente, "texto" | "proyecto" | "estado">>) =>
    pedir<{ pendiente: Pendiente }>(credenciales, "PATCH", `/${id}`, cambios).then((data) => data.pendiente),
  borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/${id}`),
  ordenar: (credenciales: string, items: { id: string; estado: Estado }[]) =>
    pedir<{ pendientes: Pendiente[] }>(credenciales, "PUT", "/orden", { items }).then((data) => data.pendientes),
}
