import { cn } from "cn"

import { COLORES_PERFIL } from "@/lib/api"

export function SelectorColor({ valor, onCambiar, etiqueta }: { valor: string; onCambiar: (color: string) => void; etiqueta: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={etiqueta}>
      {COLORES_PERFIL.map((opcion) => (
        <button
          key={opcion}
          type="button"
          role="radio"
          aria-checked={valor === opcion}
          aria-label={`Color ${opcion}`}
          onClick={() => onCambiar(opcion)}
          className={cn(
            "size-6 rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring",
            valor === opcion && "ring-2 ring-foreground"
          )}
          style={{ backgroundColor: opcion }}
        />
      ))}
    </div>
  )
}
