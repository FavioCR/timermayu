import { useState } from "react"
import { Building2, ChevronRight, ListTodo } from "lucide-react"

import { InsigniaTipo } from "@/components/tipo-select"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { Organizacion, Pendiente, Proyecto } from "@/lib/api"

// Lo que quien entró tiene por hacer, de todas las organizaciones y proyectos (sin los filtros del tablero), en el orden
// de la columna. Al tocar uno se cierra el panel y se abre su detalle.
export function MisPendientes({
  pendientes,
  proyectosPorId,
  organizacionesPorId,
  onAbrir,
}: {
  pendientes: Pendiente[]
  proyectosPorId: Map<string, Proyecto>
  organizacionesPorId: Map<string, Organizacion>
  onAbrir: (id: string) => void
}) {
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        className="relative w-8 px-0 2xl:w-auto 2xl:px-2.5"
        aria-label={`Mis pendientes: ${pendientes.length}`}
        title="Mis pendientes por hacer"
        onClick={() => setAbierto(true)}
      >
        <ListTodo />
        <span className="hidden 2xl:inline">Mis pendientes</span>
        <span className="absolute -top-0.5 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] leading-none font-semibold text-muted-foreground tabular-nums ring-1 ring-border 2xl:static 2xl:h-5 2xl:min-w-5 2xl:text-xs 2xl:ring-0">
          {pendientes.length > 99 ? "99+" : pendientes.length}
        </span>
      </Button>
      <Sheet open={abierto} onOpenChange={setAbierto}>
        <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
          <SheetHeader className="border-b pr-12">
            <SheetTitle className="flex items-center gap-2">
              <ListTodo className="size-4" /> Mis pendientes
            </SheetTitle>
            <SheetDescription>
              {pendientes.length === 1 ? "1 por hacer" : `${pendientes.length} por hacer`}, de todas tus organizaciones y proyectos.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {pendientes.length === 0 ? (
              <Empty className="m-4 border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ListTodo />
                  </EmptyMedia>
                  <EmptyTitle>Nada por hacer</EmptyTitle>
                  <EmptyDescription>Cuando te asignen un pendiente en Por hacer, aparece aquí.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="m-0 list-none p-0" aria-label="Mis pendientes">
                {pendientes.map((pendiente) => {
                  const proyecto = pendiente.proyecto_id ? proyectosPorId.get(pendiente.proyecto_id) : undefined
                  const organizacion = proyecto?.organizacion_id ? organizacionesPorId.get(proyecto.organizacion_id) : undefined
                  return (
                    <li key={pendiente.id} className="border-b">
                      <button
                        type="button"
                        onClick={() => {
                          setAbierto(false)
                          onAbrir(pendiente.id)
                        }}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                      >
                        <span className="min-w-0 flex-1">
                          {proyecto && (
                            <span className="mb-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <Building2 className="size-3 shrink-0" />
                              <span className="truncate">{organizacion ? `${organizacion.nombre} › ${proyecto.nombre}` : proyecto.nombre}</span>
                            </span>
                          )}
                          <span className="block text-sm font-medium break-words">
                            {pendiente.tipo && <InsigniaTipo tipo={pendiente.tipo} className="mr-1.5 align-[1px]" />}
                            {pendiente.texto}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
