import { useEffect, useState } from "react"
import { RefreshCw, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useNuevaVersion } from "@/lib/version"

// Arriba de todo cuando se publicó una versión nueva: «Actualizar» recarga la página con lo último. Si se cierra, vuelve
// a salir con la siguiente versión. Mientras se ve, --alto-aviso deja su lugar a lo que va pegado arriba (las notas).
export function NuevaVersion() {
  const nueva = useNuevaVersion()
  const [cerrada, setCerrada] = useState<string | null>(null)
  const visible = nueva !== null && nueva !== cerrada

  useEffect(() => {
    if (!visible) return
    document.documentElement.style.setProperty("--alto-aviso", "2.75rem")
    return () => {
      document.documentElement.style.removeProperty("--alto-aviso")
    }
  }, [visible])

  if (!visible) return null
  return (
    <div role="status" className="sticky top-0 z-50 flex h-11 items-center gap-3 bg-primary px-4 text-sm text-primary-foreground">
      <Sparkles className="size-4 shrink-0" aria-hidden />
      <p className="m-0 min-w-0 flex-1 truncate font-medium">
        Nueva versión disponible<span className="max-sm:hidden"> · actualiza para ver los últimos cambios</span>
      </p>
      <Button size="sm" variant="secondary" className="h-7 shrink-0" onClick={() => window.location.reload()}>
        <RefreshCw /> Actualizar
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Cerrar el aviso"
        className="size-7 shrink-0 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
        onClick={() => setCerrada(nueva)}
      >
        <X />
      </Button>
    </div>
  )
}
