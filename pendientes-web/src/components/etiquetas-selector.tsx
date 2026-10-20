import { useState } from "react"
import { Check, Plus, Tag, Trash2 } from "lucide-react"
import { cn } from "cn"

import {
  Tags,
  TagsContent,
  TagsEmpty,
  TagsGroup,
  TagsInput,
  TagsItem,
  TagsList,
  TagsTrigger,
  TagsValue,
} from "@/components/kibo-ui/tags"
import { CommandSeparator } from "@/components/ui/command"
import type { Etiqueta } from "@/lib/api"

export const porNombre = (a: Etiqueta, b: Etiqueta) => a.nombre.localeCompare(b.nombre, "es", { numeric: true })

export function PuntoEtiqueta({ etiqueta, className }: { etiqueta: Etiqueta; className?: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", className)} style={{ backgroundColor: etiqueta.color }} />
}

// Las etiquetas de un pendiente (el sprint, por ejemplo), con el componente Tags de Kibo UI: se eligen de la lista
// o se crean escribiendo el nombre y Enter. Desde la misma lista se borra una etiqueta de todo el tablero.
export function EtiquetasSelector({
  etiquetas,
  seleccionadas,
  onCambiar,
  onCrear,
  onBorrar,
  className,
}: {
  etiquetas: Etiqueta[]
  seleccionadas: string[]
  onCambiar: (ids: string[]) => void
  onCrear: (nombre: string) => Promise<Etiqueta | null>
  onBorrar?: (etiqueta: Etiqueta) => void
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  // Borrar pide un segundo clic sobre la misma etiqueta.
  const [porBorrar, setPorBorrar] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)

  const porId = new Map(etiquetas.map((etiqueta) => [etiqueta.id, etiqueta]))
  const elegidas = seleccionadas.flatMap((id) => porId.get(id) ?? []).sort(porNombre)
  const nombre = busqueda.trim()
  const yaExiste = etiquetas.some((etiqueta) => etiqueta.nombre.toLocaleLowerCase("es") === nombre.toLocaleLowerCase("es"))

  function alternar(id: string) {
    onCambiar(seleccionadas.includes(id) ? seleccionadas.filter((otra) => otra !== id) : [...seleccionadas, id])
  }

  async function crear() {
    if (!nombre || yaExiste || creando) return
    setCreando(true)
    const nueva = await onCrear(nombre)
    setCreando(false)
    if (!nueva) return
    onCambiar([...seleccionadas, nueva.id])
    setBusqueda("")
  }

  return (
    <Tags
      open={abierto}
      onOpenChange={(siguiente) => {
        setAbierto(siguiente)
        if (!siguiente) {
          setBusqueda("")
          setPorBorrar(null)
        }
      }}
      className={className}
    >
      <TagsTrigger
        placeholder={
          elegidas.length ? null : (
            <span className="flex items-center gap-1.5">
              <Tag className="size-4" /> Agregar etiqueta
            </span>
          )
        }
        aria-label={elegidas.length ? `Etiquetas: ${elegidas.map((e) => e.nombre).join(", ")}; cambiar` : "Agregar etiqueta"}
        className="min-h-9 justify-start px-2 py-1.5 font-normal"
      >
        {elegidas.map((etiqueta) => (
          <TagsValue key={etiqueta.id} variant="outline" className="gap-1.5" onRemove={() => alternar(etiqueta.id)}>
            <PuntoEtiqueta etiqueta={etiqueta} /> {etiqueta.nombre}
          </TagsValue>
        ))}
        {elegidas.length > 0 && <Plus className="size-3.5 text-muted-foreground" />}
      </TagsTrigger>
      <TagsContent className="min-w-64" align="start">
        <TagsInput placeholder="Buscar o crear etiqueta…" value={busqueda} onValueChange={setBusqueda} maxLength={40} />
        <TagsList>
          <TagsEmpty>{nombre ? null : "Escribe un nombre para crear la primera etiqueta."}</TagsEmpty>
          {etiquetas.length > 0 && (
            <TagsGroup>
              {[...etiquetas].sort(porNombre).map((etiqueta) => {
                const elegida = seleccionadas.includes(etiqueta.id)
                return (
                  <TagsItem key={etiqueta.id} value={etiqueta.nombre} onSelect={() => alternar(etiqueta.id)} className="group/etiqueta gap-2">
                    <Check className={cn("size-4", elegida ? "opacity-100" : "opacity-0")} />
                    <PuntoEtiqueta etiqueta={etiqueta} />
                    <span className="flex-1 truncate">{etiqueta.nombre}</span>
                    {onBorrar && (
                      <button
                        type="button"
                        className={cn(
                          "flex items-center gap-1 rounded-sm px-1 text-xs text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring",
                          porBorrar === etiqueta.id ? "text-destructive" : "opacity-0 group-hover/etiqueta:opacity-100 group-data-[selected=true]/etiqueta:opacity-100 [@media(hover:none)]:opacity-100"
                        )}
                        aria-label={porBorrar === etiqueta.id ? `Confirmar: borrar la etiqueta ${etiqueta.nombre}` : `Borrar la etiqueta ${etiqueta.nombre}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (porBorrar !== etiqueta.id) {
                            setPorBorrar(etiqueta.id)
                            return
                          }
                          setPorBorrar(null)
                          onBorrar(etiqueta)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                        {porBorrar === etiqueta.id && "¿Borrar de todo?"}
                      </button>
                    )}
                  </TagsItem>
                )
              })}
            </TagsGroup>
          )}
          {nombre && !yaExiste && (
            <>
              {etiquetas.length > 0 && <CommandSeparator />}
              <TagsGroup>
                {/* Siempre visible mientras se escribe un nombre nuevo, aunque no coincida con la búsqueda. */}
                <TagsItem forceMount value={`crear ${nombre}`} onSelect={crear} disabled={creando} className="justify-start gap-2">
                  <Plus className="size-4" /> Crear «{nombre}»
                </TagsItem>
              </TagsGroup>
            </>
          )}
        </TagsList>
      </TagsContent>
    </Tags>
  )
}
