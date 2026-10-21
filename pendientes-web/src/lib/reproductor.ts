import { useSyncExternalStore } from "react"

import type { Archivo } from "@/lib/api"

// El video (o audio) que se está viendo. Se abre desde cualquier lado (los adjuntos, el chat, un archivo de la
// descripción) y lo muestra un solo reproductor, el del tablero.
export type Reproduccion = { credenciales: string; archivo: Pick<Archivo, "id" | "nombre" | "tipo"> & { tamano?: number } }

let actual: Reproduccion | null = null
const oyentes = new Set<() => void>()

function avisar(siguiente: Reproduccion | null) {
  actual = siguiente
  for (const oyente of oyentes) oyente()
}

export const reproducir = (reproduccion: Reproduccion) => avisar(reproduccion)
export const dejarDeReproducir = () => avisar(null)

function suscribir(oyente: () => void) {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

export const useReproduccion = () => useSyncExternalStore(suscribir, () => actual)
