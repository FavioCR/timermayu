import { useState } from "react"
import { ChevronDown, Folder, FolderClosed, Plus, X } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// Combobox de shadcn (Popover + Command): elige un proyecto que ya se usa o crea uno escribiéndolo.
export function ProyectoCombobox({
  valor,
  onCambiar,
  sugerencias,
  className,
  etiqueta = "Proyecto",
}: {
  valor: string | null
  onCambiar: (proyecto: string | null) => void
  sugerencias: string[]
  className?: string
  etiqueta?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  // El servidor guarda los proyectos en minúsculas.
  const nuevo = busqueda.trim().toLowerCase()
  const puedeCrear = nuevo !== "" && !sugerencias.includes(nuevo)

  function abrir(siguiente: boolean) {
    setAbierto(siguiente)
    if (!siguiente) setBusqueda("")
  }

  function elegir(proyecto: string | null) {
    onCambiar(proyecto)
    abrir(false)
  }

  return (
    <Popover open={abierto} onOpenChange={abrir}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={abierto}
          aria-label={valor ? `${etiqueta}: ${valor}` : etiqueta}
          className={cn("justify-between gap-2 px-3 font-normal dark:bg-input/30", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <FolderClosed className="text-muted-foreground" />
            <span className={cn("truncate", !valor && "text-muted-foreground")}>{valor ?? "Proyecto"}</span>
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Busca o escribe uno nuevo…" value={busqueda} onValueChange={setBusqueda} maxLength={60} />
          <CommandList>
            <CommandEmpty>Escribe el nombre del proyecto.</CommandEmpty>
            {puedeCrear && (
              <CommandGroup>
                <CommandItem value={`crear ${nuevo}`} onSelect={() => elegir(nuevo)}>
                  <Plus /> Crear «{nuevo}»
                </CommandItem>
              </CommandGroup>
            )}
            {sugerencias.length > 0 && (
              <CommandGroup heading="Proyectos">
                {sugerencias.map((nombre) => (
                  <CommandItem key={nombre} value={nombre} data-checked={valor === nombre} onSelect={() => elegir(nombre)}>
                    <Folder /> {nombre}
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
