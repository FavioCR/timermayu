import { useCallback, useEffect, useState } from "react"
import { History } from "lucide-react"

import { ListaActividad } from "@/components/historial"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { api, esNoAutorizado, mensajeDeError, type Actividad } from "@/lib/api"

// El servidor manda de a 50: menos que eso es que ya no hay más.
const POR_PAGINA = 50

// Todo lo que pasó en el tablero (lo que quien entró puede ver), lo más nuevo arriba.
export function ActividadSheet({
  credenciales,
  abierto,
  onAbiertoChange,
  yo,
  abribles,
  onAbrir,
  onSalir,
}: {
  credenciales: string
  abierto: boolean
  onAbiertoChange: (abierto: boolean) => void
  yo: string | null
  abribles: Set<string>
  onAbrir: (pendienteId: string) => void
  onSalir: () => void
}) {
  const [items, setItems] = useState<Actividad[] | null>(null)
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState("")

  const cargar = useCallback(
    async (antes?: string) => {
      setCargando(true)
      try {
        const nuevos = await api.actividad.listar(credenciales, antes)
        setItems((actuales) => (antes ? [...(actuales ?? []), ...nuevos] : nuevos))
        setHayMas(nuevos.length === POR_PAGINA)
        setError("")
      } catch (err) {
        if (esNoAutorizado(err)) onSalir()
        else setError(mensajeDeError(err))
      } finally {
        setCargando(false)
      }
    },
    [credenciales, onSalir]
  )

  // Cada vez que se abre se trae lo último.
  useEffect(() => {
    if (abierto) cargar()
  }, [abierto, cargar])

  return (
    <Sheet open={abierto} onOpenChange={onAbiertoChange}>
      <SheetContent data-seguir="seccion:actividad" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="flex items-center gap-2">
            <History className="size-4" /> Actividad
          </SheetTitle>
          <SheetDescription>Cada cambio y mensaje del tablero, de lo que puedes ver.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4">
          {items === null ? (
            !error && <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : items.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <History />
                </EmptyMedia>
                <EmptyTitle>Todavía no hay actividad</EmptyTitle>
                <EmptyDescription>Aquí aparecerá quién crea, mueve, asigna o comenta cada pendiente.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ListaActividad
              items={items}
              yo={yo}
              abribles={abribles}
              onAbrir={(id) => {
                onAbiertoChange(false)
                onAbrir(id)
              }}
            />
          )}
          {hayMas && items && (
            <Button variant="outline" size="sm" className="mt-4 w-full" disabled={cargando} onClick={() => cargar(items.at(-1)?.creado_en)}>
              {cargando ? "Cargando…" : "Ver más"}
            </Button>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
