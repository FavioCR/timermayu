import * as React from "react"

const MOBILE_BREAKPOINT = 768
const consulta = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

// El de la plantilla de shadcn, leído con useSyncExternalStore (sin setState dentro de un efecto).
function suscribir(avisar: () => void) {
  const mql = window.matchMedia(consulta)
  mql.addEventListener("change", avisar)
  return () => mql.removeEventListener("change", avisar)
}

export function useIsMobile() {
  return React.useSyncExternalStore(suscribir, () => window.matchMedia(consulta).matches)
}
