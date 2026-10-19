import { useState } from "react"
import { ChevronDown, Folder, FolderClosed, Lock, Plus, X } from "lucide-react"
import { cn } from "cn"
import { defaultFilter } from "cmdk"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Organizacion, Proyecto } from "@/lib/api"
import { agrupar, organizacionDe, type Catalogo } from "@/lib/catalogo"

const valorCrear = (nombre: string, organizacion: Organizacion | null) =>
  `crear ${nombre} en ${organizacion?.nombre ?? "sin organización"}`.toLowerCase()

function Punto({ organizacion }: { organizacion: Organizacion }) {
  return <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: organizacion.color }} />
}

// Combobox de shadcn (Popover + Command): elige un proyecto, agrupados por organización, o crea uno escribiéndolo.
export function ProyectoCombobox({
  valor,
  onCambiar,
  catalogo,
  onCrear,
  className,
  etiqueta = "Proyecto",
}: {
  valor: string | null
  onCambiar: (proyectoId: string | null) => void
  catalogo: Catalogo
  onCrear: (datos: { nombre: string; organizacion_id: string | null }) => Promise<Proyecto | null>
  className?: string
  etiqueta?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  const [creando, setCreando] = useState(false)
  const grupos = agrupar(catalogo)
  const actual = catalogo.proyectos.find((proyecto) => proyecto.id === valor) ?? null
  const organizacion = organizacionDe(catalogo, valor)
  const nuevo = busqueda.trim().replace(/\s+/g, " ")
  // El nombre escrito se puede crear en cada organización que todavía no tenga un proyecto así.
  const destinos = nuevo
    ? grupos.filter((grupo) => !grupo.proyectos.some((proyecto) => proyecto.nombre.toLowerCase() === nuevo.toLowerCase()))
    : []

  function abrir(siguiente: boolean) {
    setAbierto(siguiente)
    if (!siguiente) setBusqueda("")
  }

  function elegir(proyectoId: string | null) {
    onCambiar(proyectoId)
    abrir(false)
  }

  async function crear(organizacionId: string | null) {
    setCreando(true)
    const creado = await onCrear({ nombre: nuevo, organizacion_id: organizacionId })
    setCreando(false)
    if (creado) elegir(creado.id)
  }

  // Crear va siempre después de los proyectos que ya existen, para no duplicar uno sin querer.
  const valoresCrear = new Set(destinos.map(({ organizacion: destino }) => valorCrear(nuevo, destino)))
  const filtrar = (value: string, search: string, keywords?: string[]) =>
    defaultFilter(value, search, keywords) * (valoresCrear.has(value.toLowerCase()) ? 0.01 : 1)

  const texto = actual ? (organizacion ? `${organizacion.nombre} / ${actual.nombre}` : actual.nombre) : null

  return (
    <Popover open={abierto} onOpenChange={abrir}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={abierto}
          aria-label={texto ? `${etiqueta}: ${texto}` : etiqueta}
          className={cn("justify-between gap-2 px-3 font-normal dark:bg-input/30", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {organizacion ? <Punto organizacion={organizacion} /> : <FolderClosed className="text-muted-foreground" />}
            {actual ? (
              <span className="truncate">
                {organizacion && <span className="text-muted-foreground">{organizacion.nombre} / </span>}
                {actual.nombre}
              </span>
            ) : (
              <span className="truncate text-muted-foreground">Proyecto</span>
            )}
            {organizacion && !organizacion.compartida && <Lock className="text-muted-foreground" />}
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command filter={filtrar}>
          <CommandInput placeholder="Busca o escribe uno nuevo…" value={busqueda} onValueChange={setBusqueda} maxLength={60} />
          <CommandList>
            <CommandEmpty>Escribe el nombre del proyecto.</CommandEmpty>
            {grupos.map(
              ({ organizacion: grupo, proyectos }) =>
                proyectos.length > 0 && (
                  <CommandGroup
                    key={grupo?.id ?? "sueltos"}
                    heading={
                      <span className="flex items-center gap-1.5">
                        {grupo ? <Punto organizacion={grupo} /> : null}
                        {grupo?.nombre ?? "Sin organización"}
                        {grupo && !grupo.compartida && <Lock className="size-3" aria-label="Privada" />}
                      </span>
                    }
                  >
                    {proyectos.map((proyecto) => (
                      <CommandItem
                        key={proyecto.id}
                        value={`${grupo?.nombre ?? "sin organización"} ${proyecto.nombre}`}
                        data-checked={valor === proyecto.id}
                        onSelect={() => elegir(proyecto.id)}
                      >
                        <Folder /> {proyecto.nombre}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
            )}
            {destinos.length > 0 && (
              <CommandGroup heading="Crear">
                {destinos.map(({ organizacion: destino }) => (
                  <CommandItem
                    key={destino?.id ?? "suelto"}
                    value={valorCrear(nuevo, destino)}
                    disabled={creando}
                    onSelect={() => crear(destino?.id ?? null)}
                  >
                    <Plus />
                    <span className="min-w-0 truncate">
                      «{nuevo}» {destino ? <>en {destino.nombre}</> : <span className="text-muted-foreground">sin organización</span>}
                    </span>
                    {destino && !destino.compartida && <Lock className="ml-auto" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {valor && !busqueda && (
              <CommandGroup>
                <CommandItem value="quitar proyecto" onSelect={() => elegir(null)}>
                  <X /> Sin proyecto
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
