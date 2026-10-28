import { CircleCheck } from "lucide-react"

import { PuntoEtiqueta } from "@/components/etiquetas-selector"
import { PerfilAvatar } from "@/components/perfil-avatar"
import { InsigniaTipo } from "@/components/tipo-select"
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import type { Etiqueta, Pendiente, Perfil } from "@/lib/api"
import { coincide } from "@/lib/buscar"

const mes = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" })
const dia = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" })

// Los hechos archivados (de hace más de 2 días) se buscan aquí (por título, descripción, proyecto, persona, tipo o
// etiqueta) y se abren igual que una tarjeta.
export function HechosAnteriores({
  abierto,
  onAbiertoChange,
  busqueda,
  onBusquedaChange,
  pendientes,
  filtrando,
  perfilesPorId,
  etiquetasPorId,
  etiquetaDeProyecto,
  onAbrir,
}: {
  abierto: boolean
  onAbiertoChange: (abierto: boolean) => void
  // Lo escrito; empieza con lo que tenga el buscador de Hecho.
  busqueda: string
  onBusquedaChange: (busqueda: string) => void
  pendientes: Pendiente[]
  filtrando: boolean
  perfilesPorId: Map<string, Perfil>
  etiquetasPorId: Map<string, Etiqueta>
  etiquetaDeProyecto: (id: string | null) => string | null
  onAbrir: (id: string) => void
}) {
  const ordenados = [...pendientes].sort((a, b) => (b.hecho_en ?? "").localeCompare(a.hecho_en ?? ""))
  const porMes: [string, Pendiente[]][] = []
  for (const pendiente of ordenados) {
    const clave = mes.format(new Date(pendiente.hecho_en ?? pendiente.actualizado_en))
    const ultimo = porMes.at(-1)
    if (ultimo?.[0] === clave) ultimo[1].push(pendiente)
    else porMes.push([clave, [pendiente]])
  }

  return (
    <CommandDialog
      open={abierto}
      onOpenChange={onAbiertoChange}
      title="Hechos archivados"
      description="Lo terminado hace más de 2 días."
      className="sm:max-w-xl"
    >
      {/* Busca igual que el buscador de la columna: cada palabra, sin importar tildes. */}
      <Command data-seguir="seccion:hechos-anteriores" filter={(valor, texto, palabras) => (coincide([valor, ...(palabras ?? [])].join(" "), texto) ? 1 : 0)}>
        <CommandInput placeholder="Buscar en lo terminado hace más de 2 días…" value={busqueda} onValueChange={onBusquedaChange} />
        <CommandList className="max-h-[min(60svh,32rem)]">
          <CommandEmpty>{pendientes.length ? "Nada con ese texto." : "No hay hechos archivados."}</CommandEmpty>
          {porMes.map(([nombre, lista]) => (
            <CommandGroup key={nombre} heading={`${nombre[0].toUpperCase()}${nombre.slice(1)}${filtrando ? " · con los filtros de arriba" : ""}`}>
              {lista.map((pendiente) => {
                const perfil = pendiente.perfil_id ? perfilesPorId.get(pendiente.perfil_id) : undefined
                const proyecto = etiquetaDeProyecto(pendiente.proyecto_id)
                const etiquetas = pendiente.etiquetas.flatMap((id) => etiquetasPorId.get(id) ?? [])
                return (
                  <CommandItem
                    key={pendiente.id}
                    // Lo que se puede buscar; el id lo hace único.
                    value={`${pendiente.texto} ${pendiente.id}`}
                    keywords={[pendiente.resumen ?? "", proyecto ?? "", perfil?.nombre ?? "", pendiente.tipo ?? "", ...etiquetas.map((e) => e.nombre)]}
                    onSelect={() => {
                      onAbiertoChange(false)
                      onAbrir(pendiente.id)
                    }}
                    className="items-start gap-3 py-2"
                  >
                    <CircleCheck className="mt-0.5 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium">
                        {pendiente.tipo && <InsigniaTipo tipo={pendiente.tipo} className="mr-1.5" />}
                        {pendiente.texto}
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        {pendiente.hecho_en && <span>Hecho el {dia.format(new Date(pendiente.hecho_en))}</span>}
                        {proyecto && <span className="truncate">{proyecto}</span>}
                        {etiquetas.map((etiqueta) => (
                          <span key={etiqueta.id} className="flex items-center gap-1">
                            <PuntoEtiqueta etiqueta={etiqueta} /> {etiqueta.nombre}
                          </span>
                        ))}
                      </span>
                    </span>
                    <PerfilAvatar perfil={perfil ?? null} size="sm" />
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
