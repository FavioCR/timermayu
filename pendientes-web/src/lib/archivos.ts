import type { DragEvent } from "react"

import { api, type Archivo } from "@/lib/api"

export function tamanoLegible(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`
}

export type ClaseDeArchivo = "imagen" | "documento" | "planilla" | "comprimido" | "otro"

export function claseDeArchivo(nombre: string, tipo: string): ClaseDeArchivo {
  const extension = nombre.split(".").pop()?.toLowerCase() ?? ""
  if (tipo.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "heic", "svg"].includes(extension)) return "imagen"
  if (tipo === "application/pdf" || ["pdf", "doc", "docx", "odt", "rtf", "txt", "md"].includes(extension)) return "documento"
  if (["xls", "xlsx", "ods", "csv"].includes(extension)) return "planilla"
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) return "comprimido"
  return "otro"
}

// Se bajan con la contraseña. Imágenes y PDF se abren en otra pestaña; lo demás se descarga con su nombre.
export async function abrirArchivo(credenciales: string, archivo: Archivo) {
  const enPestana = archivo.tipo !== "application/octet-stream"
  // La pestaña se abre dentro del clic, para que el navegador no la bloquee, y se llena cuando llega el archivo.
  const pestana = enPestana ? window.open("", "_blank") : null
  try {
    const url = URL.createObjectURL(await api.archivos.descargar(credenciales, archivo.id))
    if (pestana) {
      pestana.opener = null
      pestana.location.href = url
    } else {
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
