import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { reintentarAhora, useConexion } from "@/lib/cambios"

const TEXTOS = {
  "en-vivo": { corto: "En vivo", titulo: "Conectado en tiempo real" },
  conectando: { corto: "Conectando…", titulo: "Conectando en tiempo real…" },
  reconectando: { corto: "Reconectando…", titulo: "Sin conexión en tiempo real" },
}

const AVISO = "conexion"
// Un corte más corto (un reinicio del servidor, por ejemplo) no se avisa.
const AVISAR_TRAS_MS = 4000

// El punto del encabezado que dice si los cambios de los demás llegan al instante (la conexión SSE de lib/cambios).
// Si la conexión se pierde un rato, también lo avisa con un mensaje que queda hasta que vuelve.
export function EstadoConexion() {
  const { estado, reintentoEn } = useConexion()
  const [ahora, setAhora] = useState(() => Date.now())
  const avisado = useRef(false)

  useEffect(() => {
    if (estado === "en-vivo") {
      if (avisado.current) {
        avisado.current = false
        toast.success("Conexión recuperada", { id: AVISO, description: "El tablero ya está al día.", duration: 4000 })
      }
      return
    }
    if (estado !== "reconectando") return
    const espera = window.setTimeout(() => {
      avisado.current = true
      toast.warning("Sin conexión", {
        id: AVISO,
        description: navigator.onLine
          ? "Los cambios de los demás no llegan en tiempo real. Se reintenta solo."
          : "No hay internet: los cambios de los demás no llegan. Se reintenta al volver.",
        duration: Infinity,
        action: { label: "Reintentar", onClick: reintentarAhora },
      })
    }, AVISAR_TRAS_MS)
    return () => window.clearTimeout(espera)
  }, [estado])

  // Mientras espera para reintentar, la cuenta regresiva avanza.
  useEffect(() => {
    if (!reintentoEn) return
    const reloj = window.setInterval(() => setAhora(Date.now()), 250)
    return () => window.clearInterval(reloj)
  }, [reintentoEn])

  const textos = TEXTOS[estado]
  // Recortado a 30 s (la espera más larga) por si `ahora` quedó viejo hasta el primer tic.
  const segundos = reintentoEn ? Math.min(30, Math.max(0, Math.ceil((reintentoEn - ahora) / 1000))) : 0
  const sinInternet = estado === "reconectando" && !navigator.onLine

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Tiempo real: ${textos.corto}`}
          className="inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-2 whitespace-nowrap text-sm text-muted-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 sm:border sm:px-3"
        >
          <span className="relative flex size-2.5">
            {estado === "en-vivo" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
            <span
              className={cn(
                "relative inline-flex size-2.5 rounded-full",
                estado === "en-vivo" && "bg-emerald-500",
                estado === "conectando" && "animate-pulse bg-muted-foreground",
                estado === "reconectando" && "animate-pulse bg-amber-500"
              )}
            />
          </span>
          <span className="hidden sm:inline">{textos.corto}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        <p className="m-0 font-medium">{textos.titulo}</p>
        <p className="m-0 mt-1 text-muted-foreground">
          {estado === "en-vivo"
            ? "Lo que cambien los demás aparece al instante, sin recargar."
            : estado === "conectando"
              ? "En un momento, lo que cambien los demás aparecerá al instante."
              : `${sinInternet ? "No hay internet. " : ""}Los cambios de los demás no llegan solos; se vuelve a intentar ${
                  segundos > 0 ? `en ${segundos} s` : "ahora"
                }. Al reconectar, el tablero se pone al día.`}
        </p>
        {estado === "reconectando" && reintentoEn && (
          <Button variant="outline" size="sm" className="mt-3" onClick={reintentarAhora}>
            <RefreshCw /> Reintentar ahora
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
