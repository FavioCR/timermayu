import { useSyncExternalStore } from "react"

// Instalar el tablero como app de escritorio (PWA). Chrome y Edge avisan que se puede con `beforeinstallprompt`, que
// llega una sola vez y temprano: se guarda aquí desde main.tsx, antes de que React monte, para ofrecerlo desde la
// cuenta. Safari y Firefox no lo avisan: para ellos están las instrucciones de `comoInstalar`.
type AvisoInstalar = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export type Instalacion = {
  // El navegador puede mostrar su ventana de instalar ahora mismo.
  directa: boolean
  // Ya se está usando como app (ventana propia o pantalla de inicio).
  instalada: boolean
}

const enVentanaPropia = window.matchMedia("(display-mode: standalone)")
let aviso: AvisoInstalar | null = null
let estado: Instalacion = {
  directa: false,
  instalada: enVentanaPropia.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
}
const oyentes = new Set<() => void>()

function cambiar(cambios: Partial<Instalacion>) {
  estado = { ...estado, ...cambios }
  oyentes.forEach((oyente) => oyente())
}

export function prepararInstalacion() {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Sin esto el navegador lo ofrece por su cuenta (en el celular, con una barra abajo) y ya no se puede pedir después.
    event.preventDefault()
    aviso = event as AvisoInstalar
    cambiar({ directa: true })
  })
  window.addEventListener("appinstalled", () => {
    aviso = null
    cambiar({ directa: false, instalada: true })
  })
  enVentanaPropia.addEventListener("change", (event) => cambiar({ instalada: event.matches }))
  // Sin service worker no se puede instalar. No guarda nada de antemano: ver workbox en vite.config.ts.
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {})
    })
  }
}

export function useInstalacion() {
  return useSyncExternalStore(
    (oyente) => {
      oyentes.add(oyente)
      return () => oyentes.delete(oyente)
    },
    () => estado
  )
}

// Abre la ventana de instalar del navegador. Devuelve null si el navegador no la ofrece (hay que seguir los pasos).
export async function instalar() {
  if (!aviso) return null
  const actual = aviso
  // El aviso sirve una sola vez.
  aviso = null
  cambiar({ directa: false })
  await actual.prompt()
  return (await actual.userChoice).outcome
}

// Los pasos según el navegador, para cuando no hay ventana de instalar.
export function comoInstalar(): { navegador: string; pasos: string[] } {
  const agente = navigator.userAgent
  const tactil = navigator.maxTouchPoints > 1
  const ios = /iPhone|iPad|iPod/.test(agente) || (/Macintosh/.test(agente) && tactil)
  if (ios) {
    return { navegador: "Safari en iPhone o iPad", pasos: ["Toca el botón Compartir (el cuadrado con la flecha).", "Elige «Agregar a pantalla de inicio» y luego «Agregar»."] }
  }
  if (/Firefox\//.test(agente)) {
    return {
      navegador: "Firefox",
      pasos: ["Firefox no instala páginas como apps de escritorio.", "Abre timer.practi.dev/pendientes en Chrome, Edge o Safari y vuelve a elegir «Instalar en el escritorio»."],
    }
  }
  if (/Edg\//.test(agente)) {
    return {
      navegador: "Edge",
      pasos: ["Abre el menú «…» de arriba a la derecha.", "Elige «Aplicaciones» → «Instalar este sitio como una aplicación»."],
    }
  }
  if (/Android/.test(agente)) {
    return { navegador: "Chrome en Android", pasos: ["Abre el menú ⋮ de arriba a la derecha.", "Elige «Instalar app» (o «Agregar a la pantalla principal»)."] }
  }
  if (/Chrome\//.test(agente)) {
    return {
      navegador: "Chrome",
      pasos: [
        "Haz clic en el ícono de instalar, al final de la barra de direcciones.",
        "Si no aparece: menú ⋮ → «Transmitir, guardar y compartir» → «Instalar página como app».",
      ],
    }
  }
  if (/Safari\//.test(agente)) {
    return { navegador: "Safari en Mac", pasos: ["En la barra de menús, elige «Archivo» → «Agregar al Dock».", "Confirma con «Agregar»."] }
  }
  return { navegador: "tu navegador", pasos: ["Busca en el menú del navegador la opción «Instalar» o «Agregar a la pantalla de inicio».", "Funciona en Chrome, Edge y Safari."] }
}
