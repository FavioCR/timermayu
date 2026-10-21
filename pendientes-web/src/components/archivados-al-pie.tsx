import { useEffect, useRef } from "react"
import { Archive, ChevronDown, ChevronsUp } from "lucide-react"

import { Button } from "@/components/ui/button"

// Cuántos archivados más salen cada vez.
export const ARCHIVADOS_POR_VEZ = 5

const claseDelBoton =
  "w-full justify-center rounded-none border-dashed border-[color-mix(in_oklab,var(--tono)_30%,var(--color-border))] bg-transparent text-muted-foreground hover:text-foreground"

// Al final del scroll de Hecho: los hechos archivados (los de hace más de 2 días) quedan ocultos hasta que se piden.
// Pedidos, salen de 5 en 5 a medida que se baja; el botón queda por si el navegador no avisa que se llegó al final.
export function ArchivadosAlPie({
  total,
  mostrados,
  busqueda,
  vacia,
  onMostrarMas,
  onOcultar,
}: {
  // Los archivados que hay (con los filtros y lo escrito en el buscador de Hecho) y cuántos se ven ya.
  total: number
  mostrados: number
  busqueda: string
  // Sin tarjetas arriba, el pie lleva su propio margen de arriba.
  vacia: boolean
  onMostrarMas: () => void
  onOcultar: () => void
}) {
  const marca = useRef<HTMLDivElement>(null)
  const quedan = total - mostrados
  const siguiendo = mostrados > 0 && quedan > 0

  // Se vuelve a observar con cada tanda: si la marca sigue a la vista (la columna todavía no se llena), viene otra.
  useEffect(() => {
    const elemento = marca.current
    if (!siguiendo || !elemento) return
    const observador = new IntersectionObserver((entradas) => {
      if (entradas.some((entrada) => entrada.isIntersecting)) onMostrarMas()
    })
    observador.observe(elemento)
    return () => observador.disconnect()
  }, [siguiendo, mostrados, onMostrarMas])

  if (total === 0) return null
  const conBusqueda = busqueda ? ` con «${busqueda}»` : ""
  return (
    <div className={vacia ? "flex flex-col gap-2 p-3" : "flex flex-col gap-2 px-3 pb-3"}>
      {mostrados === 0 ? (
        <Button variant="outline" size="sm" className={claseDelBoton} onClick={onMostrarMas}>
          <Archive /> Mostrar archivados{conBusqueda} · {total}
        </Button>
      ) : (
        <>
          <div ref={marca} aria-hidden className="h-px" />
          {quedan > 0 && (
            <Button variant="outline" size="sm" className={claseDelBoton} onClick={onMostrarMas}>
              <ChevronDown /> Mostrar {Math.min(quedan, ARCHIVADOS_POR_VEZ)} más · {quedan === 1 ? "queda 1" : `quedan ${quedan}`}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onOcultar}>
            <ChevronsUp /> Ocultar archivados
          </Button>
        </>
      )}
    </div>
  )
}

// Separa, dentro de Hecho, lo reciente de lo archivado.
export function SeparadorDeArchivados() {
  return (
    <div role="separator" aria-label="Archivados" className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
      <Archive className="size-3.5" /> Archivados · hechos hace más de 2 días
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
