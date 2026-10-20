import { createSHA256 } from "hash-wasm"

import { ApiError, CLIENTE, pedir, type OpcionesRedaccion } from "@/lib/api"

// Notas privadas: cursos con sus notas (como en Notion) y sus recursos (PDF y otros archivos).
export type Curso = { id: string; nombre: string; icono: string; creado_en: string; actualizado_en: string }
export type Nota = { id: string; curso_id: string; titulo: string; creado_en: string; actualizado_en: string }
// contenido: el documento del editor en JSON (null si todavía está vacía).
export type NotaDetalle = Nota & { contenido: string | null }
export type Recurso = { id: string; curso_id: string; nombre: string; tipo: string; tamano: number; subido: number; creado_en: string }
export type ArbolNotas = { cursos: Curso[]; notas: Nota[]; recursos: Recurso[] }
export type Hallazgos = {
  notas: (Pick<Nota, "id" | "curso_id" | "titulo" | "actualizado_en"> & { extracto: string | null })[]
  recursos: Recurso[]
}

const BASE = "/api/pendientes"
export const PREFIJO_IMAGEN_NOTA = `${BASE}/notas/imagenes/`
export const PREFIJO_RECURSO = `${BASE}/notas/recursos/`
export const urlDeRecurso = (id: string) => `${PREFIJO_RECURSO}${id}`
export const MAX_RECURSO_BYTES = 300 * 1024 * 1024
// nginx deja pasar hasta 11 MB por petición: los recursos más grandes se suben en partes de 8 MB.
const PARTE_BYTES = 8 * 1024 * 1024

export const ICONOS_CURSO = [
  "📘", "📗", "📕", "📙", "📓", "📚", "🎓", "✏️", "📐", "📊", "🧮", "🧪",
  "🧬", "🔬", "🧲", "⚛️", "💻", "🤖", "🌐", "🗄️", "📈", "💼", "⚖️", "🏛️",
  "🩺", "🧠", "🎨", "🎵", "🌍", "🗣️", "🇬🇧", "🇫🇷", "📝", "🚀", "🔒", "☁️",
]

export const sinTildes = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

// Sube una parte con XMLHttpRequest, que sí avisa cuánto lleva (fetch no).
function enviarParte(url: string, headers: Record<string, string>, parte: Blob, onProgreso: (bytes: number) => void) {
  return new Promise<Recurso>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    for (const [nombre, valor] of Object.entries(headers)) xhr.setRequestHeader(nombre, valor)
    xhr.upload.onprogress = (event) => onProgreso(event.loaded)
    xhr.onload = () => {
      let data: { recurso?: Recurso; error?: string } = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        // Un 413 de nginx no trae JSON.
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.recurso) resolve(data.recurso)
      else reject(new ApiError(data.error ?? (xhr.status === 413 ? "body_too_large" : `http_${xhr.status}`), xhr.status))
    }
    xhr.onerror = () => reject(new ApiError("sin_conexion", 0))
    xhr.send(parte)
  })
}

// El SHA-256 del archivo, leído por partes para no tener cientos de MB en memoria. null si el navegador no puede.
async function hashDeArchivo(archivo: File) {
  try {
    const hash = await createSHA256()
    for (let desde = 0; desde < archivo.size; desde += PARTE_BYTES) {
      hash.update(new Uint8Array(await archivo.slice(desde, desde + PARTE_BYTES).arrayBuffer()))
    }
    return hash.digest("hex")
  } catch {
    return null
  }
}

// Si ya tienes ese mismo archivo en alguno de tus cursos, se agrega sin volver a subirlo. null: no lo tienes.
async function recursoRepetido(credenciales: string, cursoId: string, archivo: File, sha256: string) {
  let response: Response
  try {
    response = await fetch(`${BASE}/notas/cursos/${cursoId}/recursos/repetido`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credenciales}`,
        "X-Cliente": CLIENTE,
        "X-Nombre-Archivo": encodeURIComponent(archivo.name),
        "X-Tamano": String(archivo.size),
        "X-Sha256": sha256,
      },
    })
  } catch {
    throw new ApiError("sin_conexion", 0)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(data.error ?? `http_${response.status}`, response.status)
  return (data.recurso ?? null) as Recurso | null
}

// Sube un archivo como recurso de un curso, por partes y en orden. onProgreso va de 0 a 1.
async function subirRecurso(credenciales: string, cursoId: string, archivo: File, onProgreso: (avance: number) => void = () => {}) {
  if (archivo.size > MAX_RECURSO_BYTES) throw new ApiError("recurso_muy_grande", 413)
  if (archivo.size === 0) throw new ApiError("archivo_vacio", 422)
  const sha256 = await hashDeArchivo(archivo)
  const repetido = sha256 && (await recursoRepetido(credenciales, cursoId, archivo, sha256))
  if (repetido) {
    onProgreso(1)
    return repetido
  }
  const auth = { Authorization: `Basic ${credenciales}`, "X-Cliente": CLIENTE }
  const avance = (desde: number) => (bytes: number) => onProgreso(Math.min((desde + bytes) / archivo.size, 1))
  let recurso = await enviarParte(
    `${BASE}/notas/cursos/${cursoId}/recursos`,
    {
      ...auth,
      "Content-Type": "application/octet-stream",
      "X-Nombre-Archivo": encodeURIComponent(archivo.name),
      "X-Tamano": String(archivo.size),
    },
    archivo.slice(0, PARTE_BYTES),
    avance(0)
  )
  while (recurso.subido < recurso.tamano) {
    const desde = recurso.subido
    recurso = await enviarParte(
      `${BASE}/notas/recursos/${recurso.id}/partes?desde=${desde}`,
      { ...auth, "Content-Type": "application/octet-stream" },
      archivo.slice(desde, desde + PARTE_BYTES),
      avance(desde)
    )
  }
  onProgreso(1)
  return recurso
}

async function subirImagen(credenciales: string, notaId: string, archivo: File) {
  let response: Response
  try {
    response = await fetch(`${BASE}/notas/${notaId}/imagenes`, {
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

// Un recurso se baja con la contraseña (un enlace directo no la lleva), avisando cuánto lleva: un PDF puede pesar
// cientos de MB. Los últimos que se abrieron, si no son tan grandes, quedan en memoria para volver a abrirlos al instante.
const bajados = new Map<string, Promise<Blob>>()
const MAX_BAJADOS = 4
const MAX_BYTES_EN_MEMORIA = 40 * 1024 * 1024

function bajarRecurso(credenciales: string, id: string, onProgreso: (avance: number) => void = () => {}) {
  const guardado = bajados.get(id)
  if (guardado) {
    bajados.delete(id)
    bajados.set(id, guardado)
    return guardado
  }
  const promesa = (async () => {
    let response: Response
    try {
      response = await fetch(urlDeRecurso(id), { headers: { Authorization: `Basic ${credenciales}` } })
    } catch {
      throw new ApiError("sin_conexion", 0)
    }
    if (!response.ok) throw new ApiError(response.status === 404 ? "not_found" : `http_${response.status}`, response.status)
    const total = Number(response.headers.get("Content-Length")) || 0
    const tipo = response.headers.get("Content-Type") ?? "application/octet-stream"
    if (!response.body || !total) return response.blob()
    const partes: BlobPart[] = []
    let llegados = 0
    const lector = response.body.getReader()
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      partes.push(value)
      llegados += value.length
      onProgreso(llegados / total)
    }
    return new Blob(partes, { type: tipo })
  })()
  promesa.then((blob) => blob.size > MAX_BYTES_EN_MEMORIA && bajados.delete(id)).catch(() => bajados.delete(id))
  bajados.set(id, promesa)
  while (bajados.size > MAX_BAJADOS) bajados.delete(bajados.keys().next().value!)
  return promesa
}

export const notasApi = {
  arbol: (credenciales: string) => pedir<ArbolNotas>(credenciales, "GET", "/notas"),
  buscar: (credenciales: string, consulta: string) =>
    pedir<Hallazgos>(credenciales, "GET", `/notas/buscar?q=${encodeURIComponent(consulta)}`),
  cursos: {
    crear: (credenciales: string, datos: { nombre: string; icono: string }) =>
      pedir<{ curso: Curso }>(credenciales, "POST", "/notas/cursos", datos).then((data) => data.curso),
    actualizar: (credenciales: string, id: string, cambios: Partial<Pick<Curso, "nombre" | "icono">>) =>
      pedir<{ curso: Curso }>(credenciales, "PATCH", `/notas/cursos/${id}`, cambios).then((data) => data.curso),
    borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/notas/cursos/${id}`),
  },
  notas: {
    crear: (credenciales: string, cursoId: string, titulo = "") =>
      pedir<{ nota: Nota }>(credenciales, "POST", `/notas/cursos/${cursoId}/notas`, { titulo }).then((data) => data.nota),
    detalle: (credenciales: string, id: string) =>
      pedir<{ nota: NotaDetalle }>(credenciales, "GET", `/notas/${id}`).then((data) => data.nota),
    actualizar: (credenciales: string, id: string, cambios: { titulo?: string; contenido?: string | null; curso_id?: string }) =>
      pedir<{ nota: Nota }>(credenciales, "PATCH", `/notas/${id}`, cambios).then((data) => data.nota),
    borrar: (credenciales: string, id: string) => pedir<{ ok: true }>(credenciales, "DELETE", `/notas/${id}`),
    subirImagen,
    redactar: (credenciales: string, notaId: string, texto: string, opciones: OpcionesRedaccion = {}) =>
      pedir<{ redaccion: { texto: string } }>(credenciales, "POST", "/ia/redactar", { texto, donde: "nota", nota_id: notaId, ...opciones }).then(
        (data) => data.redaccion.texto
      ),
  },
  recursos: {
    subir: subirRecurso,
    bajar: bajarRecurso,
    renombrar: (credenciales: string, id: string, nombre: string) =>
      pedir<{ recurso: Recurso }>(credenciales, "PATCH", `/notas/recursos/${id}`, { nombre }).then((data) => data.recurso),
    borrar: (credenciales: string, id: string) => {
      bajados.delete(id)
      return pedir<{ ok: true }>(credenciales, "DELETE", `/notas/recursos/${id}`)
    },
  },
}

// Dónde se está, en la dirección (para volver con atrás y abrir lo mismo al recargar):
// /pendientes/notas, ?curso=<id>, ?curso=<id>&ver=recursos o ?nota=<id>.
export type Lugar = { vista: "inicio" } | { vista: "curso"; id: string; recursos: boolean } | { vista: "nota"; id: string }

export function lugarDeLaDireccion(): Lugar {
  const params = new URLSearchParams(window.location.search)
  const nota = params.get("nota")
  const curso = params.get("curso")
  if (nota) return { vista: "nota", id: nota }
  if (curso) return { vista: "curso", id: curso, recursos: params.get("ver") === "recursos" }
  return { vista: "inicio" }
}

export function direccionDe(lugar: Lugar) {
  const base = "/pendientes/notas"
  if (lugar.vista === "nota") return `${base}?nota=${lugar.id}`
  if (lugar.vista === "curso") return `${base}?curso=${lugar.id}${lugar.recursos ? "&ver=recursos" : ""}`
  return base
}

export const esNotas = () => /^\/pendientes\/notas\/?$/.test(window.location.pathname)
