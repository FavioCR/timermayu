import { useEffect, useRef } from "react"

import { CLIENTE } from "@/lib/api"

// Cambios en tiempo real: el servidor avisa por SSE (text/event-stream) qué cambió y cada parte del tablero vuelve a
// pedir lo suyo. Se lee con fetch y no con EventSource porque la contraseña va en un encabezado.
// "conectado" llega al reconectar, por si se perdió algo mientras tanto.
export type Cambio = {
  tipo: "pendientes" | "comentarios" | "archivos" | "catalogo" | "ia" | "conectado"
  pendiente_id?: string | null
}

const oyentes = new Set<(cambio: Cambio) => void>()

const ESPERA_INICIAL_MS = 1000
const ESPERA_MAXIMA_MS = 30_000

function avisar(cambio: Cambio) {
  for (const oyente of oyentes) oyente(cambio)
}

// Abre la conexión y la mantiene (reconecta sola, cada vez esperando más). Devuelve cómo cerrarla.
export function conectarCambios(credenciales: string, onNoAutorizado: () => void) {
  const control = new AbortController()
  let primera = true

  async function escuchar() {
    let espera = ESPERA_INICIAL_MS
    while (!control.signal.aborted) {
      try {
        const response = await fetch(`/api/pendientes/eventos?cliente=${CLIENTE}`, {
          headers: { Authorization: `Basic ${credenciales}` },
          cache: "no-store",
          signal: control.signal,
        })
        if (response.status === 401) {
          onNoAutorizado()
          return
        }
        if (!response.ok || !response.body) throw new Error(`http_${response.status}`)
        const lector = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let resto = ""
        for (;;) {
          const { value, done } = await lector.read()
          if (done) break
          resto += value
          const bloques = resto.split("\n\n")
          resto = bloques.pop() ?? ""
          for (const bloque of bloques) {
            const datos = bloque
              .split("\n")
              .filter((linea) => linea.startsWith("data:"))
              .map((linea) => linea.slice(5).trim())
              .join("\n")
            if (!datos) continue
            let cambio: Cambio
            try {
              cambio = JSON.parse(datos)
            } catch {
              continue
            }
            if (cambio.tipo === "conectado") {
              espera = ESPERA_INICIAL_MS
              // La primera vez el tablero recién cargó todo.
              if (primera) {
                primera = false
                continue
              }
            }
            avisar(cambio)
          }
        }
      } catch {
        if (control.signal.aborted) return
      }
      await new Promise((listo) => setTimeout(listo, espera))
      espera = Math.min(espera * 2, ESPERA_MAXIMA_MS)
    }
  }

  escuchar()
  return () => control.abort()
}

// Llama a `oyente` con cada cambio mientras el componente esté montado; siempre con su versión más reciente.
export function useCambios(oyente: (cambio: Cambio) => void) {
  const actual = useRef(oyente)
  useEffect(() => {
    actual.current = oyente
  })
  useEffect(() => {
    const llamar = (cambio: Cambio) => actual.current(cambio)
    oyentes.add(llamar)
    return () => {
      oyentes.delete(llamar)
    }
  }, [])
}
