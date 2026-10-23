import { useCallback, useEffect, useState } from "react"

import { api, type Presencia } from "@/lib/api"
import { useCambios } from "@/lib/cambios"

// Cada cuánto avisa una pestaña que sigue en línea (el servidor la da por ida a los 2,5 min sin avisar).
const AVISAR_CADA_MS = 60_000
// Sin tocar el mouse ni el teclado este tiempo ya no se está en línea, aunque el tablero siga a la vista.
const INACTIVO_MS = 5 * 60_000
const ACTIVIDAD = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const

// Quien entró con su perfil está en línea mientras el tablero está a la vista y en uso: lo avisa cada minuto, y avisa
// cuando deja de estarlo (oculta la pestaña, se queda quieto o la cierra).
export function usePresencia(credenciales: string, activo: boolean) {
  useEffect(() => {
    if (!activo) return
    let ultimaActividad = Date.now()
    let enLinea = false
    const avisar = (estar: boolean) => {
      if (!estar && !enLinea) return
      enLinea = estar
      api.equipo.avisar(credenciales, estar).catch(() => {})
    }
    const revisar = () => avisar(document.visibilityState === "visible" && Date.now() - ultimaActividad < INACTIVO_MS)
    const alUsar = () => {
      ultimaActividad = Date.now()
      if (!enLinea && document.visibilityState === "visible") avisar(true)
    }
    const alIrse = () => avisar(false)
    revisar()
    const intervalo = window.setInterval(revisar, AVISAR_CADA_MS)
    for (const evento of ACTIVIDAD) window.addEventListener(evento, alUsar, { passive: true })
    document.addEventListener("visibilitychange", revisar)
    window.addEventListener("pagehide", alIrse)
    return () => {
      window.clearInterval(intervalo)
      for (const evento of ACTIVIDAD) window.removeEventListener(evento, alUsar)
      document.removeEventListener("visibilitychange", revisar)
      window.removeEventListener("pagehide", alIrse)
      alIrse()
    }
  }, [credenciales, activo])
}

// Quién está en línea y cuándo estuvo cada uno por última vez; se pone al día cuando alguien entra o sale.
export function useEquipo(credenciales: string) {
  const [equipo, setEquipo] = useState<Map<string, Presencia>>(new Map())
  const cargar = useCallback(async () => {
    try {
      const lista = await api.equipo.listar(credenciales)
      setEquipo(new Map(lista.map((presencia) => [presencia.perfil_id, presencia])))
    } catch {
      // Se vuelve a intentar con el próximo cambio o al minuto.
    }
  }, [credenciales])
  useCambios((cambio) => (cambio.tipo === "presencia" || cambio.tipo === "conectado" || cambio.tipo === "catalogo") && cargar())
  useEffect(() => {
    cargar()
    const intervalo = window.setInterval(cargar, AVISAR_CADA_MS)
    return () => window.clearInterval(intervalo)
  }, [cargar])
  return equipo
}

const hora = new Intl.DateTimeFormat("es", { hour: "numeric", minute: "2-digit" })
const fecha = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" })

// «Última conexión»: hace un momento, hace 25 minutos, hoy a las 10:32, ayer a las 18:40 o el 20 oct a las 9:15.
export function ultimaConexion(iso: string, ahora = Date.now()) {
  const cuando = new Date(iso)
  const minutos = Math.round((ahora - cuando.getTime()) / 60_000)
  if (minutos < 1) return "hace un momento"
  if (minutos < 60) return minutos === 1 ? "hace 1 minuto" : `hace ${minutos} minutos`
  const hoy = new Date(ahora)
  const ayer = new Date(ahora)
  ayer.setDate(hoy.getDate() - 1)
  if (cuando.toDateString() === hoy.toDateString()) return `hoy a las ${hora.format(cuando)}`
  if (cuando.toDateString() === ayer.toDateString()) return `ayer a las ${hora.format(cuando)}`
  return `el ${fecha.format(cuando)} a las ${hora.format(cuando)}`
}
