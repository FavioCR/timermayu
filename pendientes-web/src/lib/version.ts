import { useCallback, useEffect, useRef, useState } from "react"

import { useCambios } from "@/lib/cambios"

// Cada cuánto se pregunta si hay una versión nueva (también al volver a la pestaña o al reconectarse al servidor).
const CADA_MS = 5 * 60 * 1000

// Lo que identifica a una versión: el script y los estilos principales de su index.html, que llevan en el nombre el
// hash de su contenido (cambian con cada despliegue que cambia algo).
const huella = (documento: Document) =>
  [
    documento.querySelector('script[type="module"][src]')?.getAttribute("src"),
    documento.querySelector('link[rel="stylesheet"][href]')?.getAttribute("href"),
  ].join(" ")

// La de esta página, tomada antes de que se agreguen estilos de otras partes.
const ESTA = huella(document)

async function huellaPublicada() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}?version=${Date.now()}`, { cache: "no-store" })
    if (!response.ok) return null
    const documento = new DOMParser().parseFromString(await response.text(), "text/html")
    // Una página sin su script (un error del servidor mientras se despliega) no cuenta.
    return documento.querySelector('script[type="module"][src]') ? huella(documento) : null
  } catch {
    return null
  }
}

// La huella de la versión publicada, si es otra que la de esta página (null mientras sea la misma). En desarrollo no
// se pregunta: la página la sirve Vite.
export function useNuevaVersion() {
  const [nueva, setNueva] = useState<string | null>(null)
  const vigente = useRef(true)

  const revisar = useCallback(async () => {
    if (!import.meta.env.PROD) return
    const publicada = await huellaPublicada()
    if (vigente.current && publicada && publicada !== ESTA) setNueva(publicada)
  }, [])

  useEffect(() => {
    vigente.current = true
    const intervalo = window.setInterval(revisar, CADA_MS)
    const alVolver = () => document.visibilityState === "visible" && revisar()
    document.addEventListener("visibilitychange", alVolver)
    window.addEventListener("online", revisar)
    return () => {
      vigente.current = false
      window.clearInterval(intervalo)
      document.removeEventListener("visibilitychange", alVolver)
      window.removeEventListener("online", revisar)
    }
  }, [revisar])

  // Al reconectarse con el servidor (que se reinicia con cada despliegue del API) se pregunta enseguida, y otra vez al
  // rato por si la página todavía no estaba publicada.
  useCambios((cambio) => {
    if (cambio.tipo !== "conectado") return
    revisar()
    window.setTimeout(revisar, 30_000)
  })

  return nueva
}
