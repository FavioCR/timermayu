import { useEffect, useRef, useSyncExternalStore } from "react"

import { CLIENTE } from "@/lib/api"

// Cambios en tiempo real: el servidor avisa por SSE (text/event-stream) qué cambió y cada parte del tablero vuelve a
// pedir lo suyo. Se lee con fetch y no con EventSource porque la contraseña va en un encabezado.
// "conectado" llega al reconectar, por si se perdió algo mientras tanto; "presencia", cuando alguien entra o sale de línea.
export type Cambio = {
  tipo: "pendientes" | "comentarios" | "archivos" | "catalogo" | "ia" | "presencia" | "conectado"
  pendiente_id?: string | null
}

// Dónde anda otra persona y por dónde va su mouse (ver lib/seguimiento.ts). Llega cada vez que se mueve, así que no
// pasa por los oyentes de los cambios: tiene los suyos. lugar null: se fue.
export type EventoSeguimiento = {
  tipo: "seguimiento"
  perfil_id: string
  lugar: "tablero" | "pendiente" | "notas" | null
  pendiente_id: string | null
  puntero: { ancla: string; x: number; y: number } | null
}

// Cómo está la conexión, para el indicador del encabezado. reintentoEn: cuándo se vuelve a intentar.
export type Conexion = { estado: "conectando" | "en-vivo" | "reconectando"; reintentoEn: number | null }

const oyentes = new Set<(cambio: Cambio) => void>()
// "conectado": el servidor enseguida manda dónde anda cada uno ahora (lo de antes ya no vale).
const oyentesSeguimiento = new Set<(evento: EventoSeguimiento | "conectado") => void>()
const vigilantes = new Set<() => void>()
let conexion: Conexion = { estado: "conectando", reintentoEn: null }
let reintentarYa: (() => void) | null = null
let cortarIntento: (() => void) | null = null

const ESPERA_INICIAL_MS = 1000
const ESPERA_MAXIMA_MS = 30_000
// El servidor manda un latido cada 9 s: tanto silencio es una conexión muerta aunque el navegador no lo sepa.
const SILENCIO_MAXIMO_MS = 25_000

function avisar(cambio: Cambio) {
  for (const oyente of oyentes) oyente(cambio)
}

function ponerConexion(nueva: Conexion) {
  conexion = nueva
  for (const vigilante of vigilantes) vigilante()
}

// Si está esperando para reconectar, lo intenta ya.
export function reintentarAhora() {
  reintentarYa?.()
}

// Otra petición no llegó al servidor: en vez de esperar al vigía, se corta la conexión y se vuelve a abrir. Si el
// servidor sigue caído, el indicador lo dice enseguida; si fue un tropiezo, reconecta y el tablero se pone al día.
export function revisarConexion() {
  if (conexion.estado === "en-vivo") cortarIntento?.()
}

// Abre la conexión y la mantiene (reconecta sola, cada vez esperando más). Devuelve cómo cerrarla.
export function conectarCambios(credenciales: string, onNoAutorizado: () => void) {
  const control = new AbortController()
  let primera = true

  async function escuchar() {
    let espera = ESPERA_INICIAL_MS
    while (!control.signal.aborted) {
      // Cada intento se corta solo si deja de llegar el latido.
      const intento = new AbortController()
      const cortar = () => intento.abort()
      control.signal.addEventListener("abort", cortar)
      // Sin internet no se espera al vigía: se corta ya.
      window.addEventListener("offline", cortar)
      cortarIntento = cortar
      let vigia = window.setTimeout(cortar, SILENCIO_MAXIMO_MS)
      try {
        const response = await fetch(`/api/pendientes/eventos?cliente=${CLIENTE}`, {
          headers: { Authorization: `Basic ${credenciales}` },
          cache: "no-store",
          signal: intento.signal,
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
          window.clearTimeout(vigia)
          vigia = window.setTimeout(cortar, SILENCIO_MAXIMO_MS)
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
            let cambio: Cambio | EventoSeguimiento
            try {
              cambio = JSON.parse(datos)
            } catch {
              continue
            }
            if (cambio.tipo === "seguimiento") {
              for (const oyente of oyentesSeguimiento) oyente(cambio)
              continue
            }
            if (cambio.tipo === "conectado") {
              for (const oyente of oyentesSeguimiento) oyente("conectado")
              espera = ESPERA_INICIAL_MS
              ponerConexion({ estado: "en-vivo", reintentoEn: null })
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
      } finally {
        window.clearTimeout(vigia)
        control.signal.removeEventListener("abort", cortar)
        window.removeEventListener("offline", cortar)
        cortarIntento = null
      }
      // Espera antes de reintentar; al volver internet o al pedirlo desde el indicador, reintenta ya.
      ponerConexion({ estado: "reconectando", reintentoEn: Date.now() + espera })
      await new Promise<void>((listo) => {
        const terminar = () => {
          window.clearTimeout(temporizador)
          window.removeEventListener("online", terminar)
          control.signal.removeEventListener("abort", terminar)
          reintentarYa = null
          listo()
        }
        const temporizador = window.setTimeout(terminar, espera)
        window.addEventListener("online", terminar)
        control.signal.addEventListener("abort", terminar)
        reintentarYa = terminar
      })
      if (!control.signal.aborted) ponerConexion({ estado: "reconectando", reintentoEn: null })
      espera = Math.min(espera * 2, ESPERA_MAXIMA_MS)
    }
  }

  ponerConexion({ estado: "conectando", reintentoEn: null })
  escuchar()
  return () => control.abort()
}

export function escucharSeguimiento(oyente: (evento: EventoSeguimiento | "conectado") => void) {
  oyentesSeguimiento.add(oyente)
  return () => {
    oyentesSeguimiento.delete(oyente)
  }
}

function vigilar(vigilante: () => void) {
  vigilantes.add(vigilante)
  return () => {
    vigilantes.delete(vigilante)
  }
}

export function useConexion() {
  return useSyncExternalStore(vigilar, () => conexion)
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
