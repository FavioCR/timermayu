import type { DragEvent } from "react"

import { api, type Archivo } from "@/lib/api"
import { reproducir } from "@/lib/reproductor"

export function tamanoLegible(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`
}

export type ClaseDeArchivo = "imagen" | "video" | "audio" | "documento" | "planilla" | "comprimido" | "otro"

export function claseDeArchivo(nombre: string, tipo: string): ClaseDeArchivo {
  const extension = nombre.split(".").pop()?.toLowerCase() ?? ""
  if (tipo.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic", "svg"].includes(extension)) return "imagen"
  if (tipo.startsWith("video/") || ["mp4", "m4v", "mov", "webm", "mkv", "avi"].includes(extension)) return "video"
  if (tipo.startsWith("audio/") || ["mp3", "m4a", "wav", "ogg", "opus", "aac"].includes(extension)) return "audio"
  if (tipo === "application/pdf" || ["pdf", "doc", "docx", "odt", "rtf", "txt", "md"].includes(extension)) return "documento"
  if (["xls", "xlsx", "ods", "csv"].includes(extension)) return "planilla"
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) return "comprimido"
  return "otro"
}

// Los archivos enlazados en la descripción guardan esta url; el servidor la sirve con la contraseña.
export const PREFIJO_URL_ARCHIVO = "/api/pendientes/archivos/"
export const urlDeArchivo = (id: string) => `${PREFIJO_URL_ARCHIVO}${id}`

const seMuestra = (tipo: string) => tipo === "application/pdf" || tipo.startsWith("image/")
// Lo que el reproductor del tablero puede pasar.
export const esMedio = (tipo: string) => tipo.startsWith("video/") || tipo.startsWith("audio/")

const TIPOS_POR_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
}

// Para lo que solo se conoce por su nombre, como un archivo de la descripción.
export function tipoPorNombre(nombre: string) {
  return TIPOS_POR_EXTENSION[nombre.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream"
}

// Videos y audios se ven en el reproductor del tablero, sin bajarlos enteros. Lo demás se baja con la contraseña:
// imágenes y PDF se abren en otra pestaña; lo demás se descarga con su nombre.
export async function abrirArchivo(credenciales: string, archivo: Pick<Archivo, "id" | "nombre" | "tipo"> & { tamano?: number }) {
  if (esMedio(archivo.tipo)) return reproducir({ credenciales, archivo })
  // La pestaña se abre dentro del clic, para que el navegador no la bloquee, y se llena cuando llega el archivo.
  const pestana = seMuestra(archivo.tipo) ? window.open("", "_blank") : null
  try {
    const contenido = await api.archivos.descargar(credenciales, archivo.id)
    const url = URL.createObjectURL(contenido)
    // Manda lo que dice el servidor: si al final no es imagen ni PDF, se descarga.
    if (pestana && seMuestra(contenido.type)) {
      pestana.opener = null
      pestana.location.href = url
    } else {
      pestana?.close()
      const enlace = document.createElement("a")
      enlace.href = url
      enlace.download = archivo.nombre
      enlace.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
  } catch (err) {
    pestana?.close()
    throw err
  }
}

// Para soltar archivos sobre una zona: lo que llega del sistema, no texto ni enlaces arrastrados.
export const traeArchivos = (event: DragEvent) => event.dataTransfer.types.includes("Files")
