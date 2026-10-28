import { useEffect, useSyncExternalStore } from "react"

import { api, type CuerpoSeguimiento } from "@/lib/api"
import { escucharSeguimiento } from "@/lib/cambios"

// Seguimiento, como en Miro: cada quien ve dónde anda el resto del equipo (el tablero, un pendiente o sus notas) y,
// si está en el mismo lugar, su mouse con su nombre; también puede seguir a alguien (ver el tablero).
//
// El mouse va anclado a lo que tiene debajo, marcado con data-seguir: una columna (columna:<estado>), una tarjeta
// (tarjeta:<id>), la descripción o el chat de un pendiente (detalle:<id>, chat:<id>); fuera de eso, la ventana
// (pagina). x e y van de 0 a 1 dentro del ancla, así cae sobre lo mismo en pantallas de otro tamaño o con otro scroll.

export type Puntero = { ancla: string; x: number; y: number }
// Dónde está uno.
export type Lugar = { tipo: "tablero" } | { tipo: "pendiente"; id: string } | { tipo: "notas" }
// Dónde está otro. pendiente_id null: un pendiente que uno no puede ver.
export type LugarAjeno = { lugar: "tablero" | "pendiente" | "notas"; pendiente_id: string | null }

const ANCLA = "data-seguir"
// Unas 12 veces por segundo mientras se mueve; quien lo ve lo suaviza.
const ENVIAR_CADA_MS = 80
// Al reconectarse llega dónde anda cada uno; quien no aparece en este tiempo ya no está.
const CONFIRMAR_MS = 2000

// --- Lo de los demás ---

const punteros = new Map<string, Puntero>()
let lugares: ReadonlyMap<string, LugarAjeno> = new Map()
const vigilantes = new Set<() => void>()
let porConfirmar: Set<string> | null = null

function ponerLugar(perfilId: string, lugar: LugarAjeno | null) {
  const antes = lugares.get(perfilId)
  if (antes?.lugar === lugar?.lugar && antes?.pendiente_id === lugar?.pendiente_id) return
  const nuevos = new Map(lugares)
  if (lugar) nuevos.set(perfilId, lugar)
  else nuevos.delete(perfilId)
  lugares = nuevos
  for (const vigilante of vigilantes) vigilante()
}

escucharSeguimiento((evento) => {
  if (evento === "conectado") {
    // No se borra todo de una vez (quien sigue a alguien lo dejaría de seguir): lo que no vuelva a llegar, se va.
    const anteriores = new Set(lugares.keys())
    porConfirmar = anteriores
    window.setTimeout(() => {
      if (porConfirmar !== anteriores) return
      porConfirmar = null
      for (const perfilId of anteriores) {
        punteros.delete(perfilId)
        ponerLugar(perfilId, null)
      }
    }, CONFIRMAR_MS)
    return
  }
  porConfirmar?.delete(evento.perfil_id)
  if (evento.puntero) punteros.set(evento.perfil_id, evento.puntero)
  else punteros.delete(evento.perfil_id)
  ponerLugar(evento.perfil_id, evento.lugar ? { lugar: evento.lugar, pendiente_id: evento.pendiente_id } : null)
})

export function vigilarLugares(vigilante: () => void) {
  vigilantes.add(vigilante)
  return () => {
    vigilantes.delete(vigilante)
  }
}

export const lugaresActuales = () => lugares

// Dónde anda cada uno de los demás; cambia cuando alguien cambia de lugar, no con cada movimiento del mouse.
export function useLugares() {
  return useSyncExternalStore(vigilarLugares, lugaresActuales)
}

// El último mouse de alguien; se lee en cada cuadro, sin pasar por React.
export const punteroDe = (perfilId: string) => punteros.get(perfilId) ?? null

export function mismoLugar(ajeno: LugarAjeno | undefined, propio: Lugar) {
  if (!ajeno || ajeno.lugar !== propio.tipo) return false
  return propio.tipo !== "pendiente" || ajeno.pendiente_id === propio.id
}

export function describirLugar(lugar: LugarAjeno, tituloDe: (id: string) => string | undefined) {
  if (lugar.lugar === "tablero") return "En el tablero"
  if (lugar.lugar === "notas") return "En sus notas"
  const titulo = lugar.pendiente_id ? tituloDe(lugar.pendiente_id) : undefined
  return titulo ? `Viendo «${titulo}»` : "Viendo un pendiente"
}

// --- Medir y ubicar el mouse ---

const limitar = (n: number) => Math.min(1, Math.max(0, n)) || 0

function anclaDe(nombre: string) {
  const elemento = document.querySelector(`[${ANCLA}="${CSS.escape(nombre)}"]`)
  if (!elemento) return null
  const caja = elemento.getBoundingClientRect()
  return caja.width === 0 && caja.height === 0 ? null : elemento
}

function tieneScroll(elemento: Element) {
  const { overflowX, overflowY } = getComputedStyle(elemento)
  return (
    (elemento.scrollHeight > elemento.clientHeight && /auto|scroll/.test(overflowY)) ||
    (elemento.scrollWidth > elemento.clientWidth && /auto|scroll/.test(overflowX))
  )
}

// Dónde está el contenido del ancla en la ventana: si tiene scroll propio, todo su contenido y no solo lo que se ve.
function contenidoDe(elemento: Element) {
  const caja = elemento.getBoundingClientRect()
  if (!tieneScroll(elemento)) return { left: caja.left, top: caja.top, width: caja.width, height: caja.height }
  return {
    left: caja.left + elemento.clientLeft - elemento.scrollLeft,
    top: caja.top + elemento.clientTop - elemento.scrollTop,
    width: elemento.scrollWidth,
    height: elemento.scrollHeight,
  }
}

export function medir(x: number, y: number, debajo: Element | null): Puntero {
  const elemento = debajo?.closest(`[${ANCLA}]`)
  if (!elemento) return { ancla: "pagina", x: limitar(x / window.innerWidth), y: limitar(y / window.innerHeight) }
  const contenido = contenidoDe(elemento)
  return {
    ancla: elemento.getAttribute(ANCLA)!,
    x: limitar((x - contenido.left) / contenido.width),
    y: limitar((y - contenido.top) / contenido.height),
  }
}

// Si el punto se ve: dentro de la ventana y de cada contenedor que lo recorta (una columna con scroll, por ejemplo).
function aLaVista(elemento: Element, x: number, y: number) {
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false
  for (let actual: Element | null = elemento; actual && actual !== document.documentElement; actual = actual.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(actual)
    if (overflowX === "visible" && overflowY === "visible") continue
    const caja = actual.getBoundingClientRect()
    if (x < caja.left || x > caja.right || y < caja.top || y > caja.bottom) return false
  }
  return true
}

// Dónde cae en esta pantalla el mouse de otro; null si aquí no está lo que tenía debajo (filtrado, por ejemplo).
export function ubicar(puntero: Puntero) {
  if (puntero.ancla === "pagina") return { x: puntero.x * window.innerWidth, y: puntero.y * window.innerHeight, visible: true }
  const elemento = anclaDe(puntero.ancla)
  if (!elemento) return null
  const contenido = contenidoDe(elemento)
  const x = contenido.left + puntero.x * contenido.width
  const y = contenido.top + puntero.y * contenido.height
  return { x, y, visible: aLaVista(elemento, x, y) }
}

// Siguiendo a alguien: si su mouse quedó fuera de la vista, se desplaza lo necesario para verlo.
export function asomar(puntero: Puntero) {
  const elemento = puntero.ancla === "pagina" ? null : anclaDe(puntero.ancla)
  if (!elemento) return
  if (tieneScroll(elemento)) {
    elemento.scrollTo({
      left: puntero.x * elemento.scrollWidth - elemento.clientWidth / 2,
      top: puntero.y * elemento.scrollHeight - elemento.clientHeight / 2,
      behavior: "smooth",
    })
  }
  elemento.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })
}

// --- Lo propio ---

// En fila, para que un aviso viejo no llegue después de uno nuevo.
let cola = Promise.resolve()
function mandar(credenciales: string, cuerpo: CuerpoSeguimiento) {
  cola = cola.then(() => api.seguimiento.enviar(credenciales, cuerpo).catch(() => {}))
  return cola
}

// Avisa dónde anda quien entró con su perfil y, salvo en las notas, por dónde va su mouse (no con el dedo en el
// celular). Con la pestaña oculta, al cerrarla o al salir de la cuenta, avisa que se fue. lugar null: no avisa nada.
export function useCompartirSeguimiento(credenciales: string, lugar: Lugar | null) {
  const tipo = lugar?.tipo ?? null
  const pendienteId = lugar?.tipo === "pendiente" ? lugar.id : null
  const activo = tipo !== null

  useEffect(() => {
    if (!activo) return
    const irse = () => api.seguimiento.enviar(credenciales, { lugar: null }, true).catch(() => {})
    window.addEventListener("pagehide", irse)
    return () => {
      window.removeEventListener("pagehide", irse)
      mandar(credenciales, { lugar: null })
    }
  }, [credenciales, activo])

  useEffect(() => {
    if (!tipo) return
    let vivo = true
    let puntero: Puntero | null = null
    let mouse: { x: number; y: number } | null = null
    let ultimoEnvio = 0
    let temporizador = 0
    let enviando = false
    let otraVez = false

    const cuerpo = (): CuerpoSeguimiento =>
      document.visibilityState !== "visible"
        ? { lugar: null }
        : { lugar: tipo, pendiente_id: pendienteId, puntero: tipo === "notas" ? null : puntero }
    const enviar = () => {
      if (!vivo || temporizador) return
      if (enviando) {
        otraVez = true
        return
      }
      const espera = ultimoEnvio + ENVIAR_CADA_MS - Date.now()
      if (espera > 0) {
        temporizador = window.setTimeout(() => {
          temporizador = 0
          enviar()
        }, espera)
        return
      }
      enviando = true
      ultimoEnvio = Date.now()
      mandar(credenciales, cuerpo()).finally(() => {
        enviando = false
        if (otraVez) {
          otraVez = false
          enviar()
        }
      })
    }

    const mover = (evento: PointerEvent) => {
      if (evento.pointerType === "touch") return
      mouse = { x: evento.clientX, y: evento.clientY }
      puntero = medir(mouse.x, mouse.y, evento.target instanceof Element ? evento.target : null)
      enviar()
    }
    // Con el scroll, lo que está debajo del mouse cambia aunque el mouse no se mueva.
    const desplazar = () => {
      if (!mouse) return
      puntero = medir(mouse.x, mouse.y, document.elementFromPoint(mouse.x, mouse.y))
      enviar()
    }
    const salir = () => {
      mouse = null
      puntero = null
      enviar()
    }
    window.addEventListener("pointermove", mover, { passive: true })
    window.addEventListener("scroll", desplazar, { capture: true, passive: true })
    document.documentElement.addEventListener("mouseleave", salir)
    document.addEventListener("visibilitychange", enviar)
    // Si el servidor se reinició ya no sabe dónde anda: se le dice de nuevo al reconectarse.
    const dejarDeEscuchar = escucharSeguimiento((evento) => evento === "conectado" && enviar())
    enviar()
    return () => {
      vivo = false
      window.clearTimeout(temporizador)
      window.removeEventListener("pointermove", mover)
      window.removeEventListener("scroll", desplazar, { capture: true })
      document.documentElement.removeEventListener("mouseleave", salir)
      document.removeEventListener("visibilitychange", enviar)
      dejarDeEscuchar()
    }
  }, [credenciales, tipo, pendienteId])
}

// --- Preferencia: ver o no los cursores del equipo (de este navegador) ---

const CLAVE_CURSORES = "pendientes.cursores"
const vigilantesCursores = new Set<() => void>()
let verCursores = (() => {
  try {
    return localStorage.getItem(CLAVE_CURSORES) !== "no"
  } catch {
    return true
  }
})()

export function cambiarVerCursores(ver: boolean) {
  verCursores = ver
  try {
    localStorage.setItem(CLAVE_CURSORES, ver ? "si" : "no")
  } catch {
    // Sin almacenamiento vale hasta recargar.
  }
  for (const vigilante of vigilantesCursores) vigilante()
}

export function useVerCursores() {
  return useSyncExternalStore(
    (vigilante) => {
      vigilantesCursores.add(vigilante)
      return () => {
        vigilantesCursores.delete(vigilante)
      }
    },
    () => verCursores
  )
}
