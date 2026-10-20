import { cn } from "cn"

import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { TipoTrabajo } from "@/lib/api"
import { TIPOS, tipoDe } from "@/lib/tipos"

const SIN_TIPO = "sin-tipo"

// La etiqueta del tipo en las tarjetas: "fix" en su color.
export function InsigniaTipo({ tipo, className }: { tipo: TipoTrabajo; className?: string }) {
  const datos = tipoDe(tipo)
  if (!datos) return null
  return (
    <span
      title={datos.descripcion}
      className={cn("inline-flex shrink-0 items-center px-1.5 py-0.5 font-mono text-[11px] leading-none font-semibold", className)}
      style={{ color: datos.color, backgroundColor: `color-mix(in oklab, ${datos.color} 16%, transparent)` }}
    >
      {datos.id}
    </span>
  )
}

export function TipoSelect({
  valor,
  onCambiar,
  className,
  etiqueta = "Tipo",
  compacto = false,
}: {
  valor: TipoTrabajo | null
  onCambiar: (tipo: TipoTrabajo | null) => void
  className?: string
  etiqueta?: string
  // En poco espacio el botón muestra solo "fix", sin la descripción.
  compacto?: boolean
}) {
  return (
    <Select value={valor ?? SIN_TIPO} onValueChange={(nuevo) => onCambiar(nuevo === SIN_TIPO ? null : (nuevo as TipoTrabajo))}>
      <SelectTrigger aria-label={etiqueta} size="sm" className={cn(compacto && "[&_[data-descripcion]]:hidden", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TIPOS.map((tipo) => (
          <SelectItem key={tipo.id} value={tipo.id}>
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tipo.color }} />
            <span className="font-mono">{tipo.id}</span>
            <span data-descripcion className="text-muted-foreground">
              {tipo.descripcion}
            </span>
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={SIN_TIPO}>
          <span className="size-2 shrink-0 rounded-full border border-dashed border-muted-foreground" />
          Sin tipo
        </SelectItem>
      </SelectContent>
    </Select>
  )
}
