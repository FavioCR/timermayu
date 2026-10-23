import type { Notificacion } from "@/lib/api"

// El sonido de los avisos: dos notas cortas hechas con Web Audio (sin archivos). Los navegadores no dejan sonar una
// página hasta que la persona la toca (https://developer.chrome.com/blog/autoplay). Chrome sí deja si ya la tocó
// antes, por ejemplo al escribir la contraseña, o si el tablero está instalado como app: entonces se prepara enseguida.
// Si no, con el primer clic o tecla.
const GUARDADO = "pendientes.sonido"

let contexto: AudioContext | null = null

const sonando = () => contexto?.state === "running"

function arrancar() {
  if (!("AudioContext" in window)) return Promise.resolve()
  contexto ??= new AudioContext()
  return sonando() ? Promise.resolve() : contexto.resume().catch(() => {})
}

export function prepararSonido() {
  const desbloquear = () => {
    arrancar().then(() => {
      if (!sonando()) return
      window.removeEventListener("pointerdown", desbloquear)
      window.removeEventListener("keydown", desbloquear)
    })
  }
  window.addEventListener("pointerdown", desbloquear)
  window.addEventListener("keydown", desbloquear)
  const instalada = window.matchMedia("(display-mode: standalone)").matches
  if (navigator.userActivation?.hasBeenActive || instalada) desbloquear()
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

// Devuelve si sonó. Con el sonido apagado a propósito cuenta como que sí (no hay nada que avisar).
export async function sonarAviso() {
  if (!sonidoActivado()) return true
  // Por si el navegador ya lo permite; si no, no se queda esperando.
  if (!sonando()) await Promise.race([arrancar(), new Promise((listo) => setTimeout(listo, 300))])
  if (!contexto || !sonando()) return false
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
  return true
}

// Suena cuando te asignan algo (al crearlo, al reasignarlo o al pasártelo), te mencionan en un chat o una descripción, o
// rebotan algo tuyo.
export function esParaSonar(notificacion: Notificacion, yo: string) {
  const { tipo, datos } = notificacion.actividad
  if (tipo === "creado") return datos?.asignado_id === yo
  if (tipo === "asignado" || tipo === "traspaso") return datos?.a_id === yo
  if (tipo === "comentario" || tipo === "descripcion") return Boolean(datos?.menciones?.includes(yo))
  // Un rebote siempre: le llega a quien lo tiene a cargo y a quien lo creó.
  if (tipo === "rebotado") return true
  return false
}
