import { useState } from "react"

import { esNoAutorizado, mensajeDeError } from "@/lib/api"
import { notasApi, type Recurso } from "@/lib/notas"

export type Subida = { clave: string; curso_id: string; nombre: string; avance: number; error?: string }

// Lo que se sube mientras tanto, con su avance: un PDF grande tarda.
export function useSubidas(credenciales: string, onSubido: (recurso: Recurso) => void, onNoAutorizado: () => void) {
  const [subidas, setSubidas] = useState<Subida[]>([])

  async function subir(cursoId: string, archivos: File[]) {
    const nuevas = archivos.map((archivo) => ({ clave: crypto.randomUUID(), curso_id: cursoId, nombre: archivo.name, avance: 0 }))
    setSubidas((actuales) => [...actuales, ...nuevas])
    const cambiar = (clave: string, cambio: Partial<Subida>) =>
      setSubidas((actuales) => actuales.map((subida) => (subida.clave === clave ? { ...subida, ...cambio } : subida)))
    // Una a la vez, para que cada una termine lo antes posible.
    for (const [i, archivo] of archivos.entries()) {
      const { clave } = nuevas[i]
      try {
        const recurso = await notasApi.recursos.subir(credenciales, cursoId, archivo, (avance) => cambiar(clave, { avance }))
        setSubidas((actuales) => actuales.filter((subida) => subida.clave !== clave))
        onSubido(recurso)
      } catch (err) {
        if (esNoAutorizado(err)) return onNoAutorizado()
        cambiar(clave, { error: mensajeDeError(err) })
      }
    }
  }

  const descartar = (clave: string) => setSubidas((actuales) => actuales.filter((subida) => subida.clave !== clave))
  return { subidas, subir, descartar }
}
