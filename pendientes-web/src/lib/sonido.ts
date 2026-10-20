import type { Notificacion } from "@/lib/api"

// El sonido de los avisos: dos notas cortas hechas con Web Audio (sin archivos). Los navegadores no dejan sonar una
// página hasta que la persona la toca, así que el audio se prepara con el primer clic o tecla.
const GUARDADO = "pendientes.sonido"

let contexto: AudioContext | null = null

export function prepararSonido() {
  const desbloquear = () => {
    window.removeEventListener("pointerdown", desbloquear)
    window.removeEventListener("keydown", desbloquear)
    if (!("AudioContext" in window)) return
    contexto ??= new AudioContext()
    contexto.resume().catch(() => {})
  }
  window.addEventListener("pointerdown", desbloquear)
  window.addEventListener("keydown", desbloquear)
  return desbloquear
}

export function sonidoActivado() {
  try {
    return localStorage.getItem(GUARDADO) !== "0"
  } catch {
    return true
  }
}

export function activarSonido(activado: boolean) {
  try {
    localStorage.setItem(GUARDADO, activado ? "1" : "0")
  } catch {
    // Sin almacenamiento vuelve a sonar al recargar.
  }
}

export function sonarAviso() {
  if (!contexto || contexto.state !== "running" || !sonidoActivado()) return
  const inicio = contexto.currentTime
  for (const [frecuencia, desde] of [
    [880, 0],
    [1320, 0.12],
  ]) {
    const oscilador = contexto.createOscillator()
    const volumen = contexto.createGain()
    oscilador.type = "sine"
    oscilador.frequency.value = frecuencia
    volumen.gain.setValueAtTime(0, inicio + desde)
    volumen.gain.linearRampToValueAtTime(0.18, inicio + desde + 0.015)
    volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + desde + 0.35)
    oscilador.connect(volumen).connect(contexto.destination)
    oscilador.start(inicio + desde)
    oscilador.stop(inicio + desde + 0.4)
  }
}

// Suena cuando te asignan algo (al crearlo, al reasignarlo o al pasártelo) o te mencionan en un chat o una descripción.
export function esParaSonar(notificacion: Notificacion, yo: string) {
  const { tipo, datos } = notificacion.actividad
  if (tipo === "creado") return datos?.asignado_id === yo
  if (tipo === "asignado" || tipo === "traspaso") return datos?.a_id === yo
  if (tipo === "comentario" || tipo === "descripcion") return Boolean(datos?.menciones?.includes(yo))
  return false
}
