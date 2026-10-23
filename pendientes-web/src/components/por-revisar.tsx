import { useState } from "react"
import { ScanEye } from "lucide-react"
import { cn } from "cn"

import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { haceCuanto } from "@/lib/actividad"
import type { Pendiente, Perfil } from "@/lib/api"

// La bandeja de lo que a quien entró le pidieron revisar, como la de un correo: lo que no abrió va en negrita con su
// punto (y cuenta en el número), y todo sigue aquí hasta que lo aprueba o lo rebota (o, si no puede aprobarlo, lo da
// por revisado).
export function PorRevisar({
  pendientes,
  yo,
  perfilesPorId,
  onAbrir,
}: {
  pendientes: Pendiente[]
  yo: string
  perfilesPorId: Map<string, Perfil>
  onAbrir: (id: string) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const pedidos = pendientes
    .flatMap((pendiente) => {
      const revision = pendiente.revisiones.find((r) => r.revisor_id === yo)
      return revision ? [{ pendiente, revision }] : []
    })
    .sort((a, b) => b.revision.pedido_en.localeCompare(a.revision.pedido_en))
  const sinAbrir = pedidos.filter(({ revision }) => !revision.abierto_en).length

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={pedidos.length ? `Por revisar: ${pedidos.length}${sinAbrir ? `, ${sinAbrir} sin abrir` : ""}` : "Por revisar"}
          title="Por revisar"
        >
          <ScanEye />
          {pedidos.length > 0 && (
            <span
              className={cn(
                "absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums",
                sinAbrir > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground ring-1 ring-border"
              )}
            >
              {(sinAbrir || pedidos.length) > 9 ? "9+" : sinAbrir || pedidos.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex min-h-12 items-center justify-between gap-2 border-b px-4 py-2">
          <p className="m-0 font-medium">Por revisar</p>
          {pedidos.length > 0 && (
            <span className="text-xs text-muted-foreground">{sinAbrir > 0 ? `${sinAbrir} sin abrir` : "Todo abierto"}</span>
          )}
        </div>
        <ul className="m-0 max-h-[min(28rem,60svh)] list-none overflow-y-auto p-0">
          {pedidos.length === 0 && (
            <li className="px-6 py-8 text-center text-sm text-muted-foreground">
              Nada por revisar. Cuando alguien te pida revisar un pendiente, aparece aquí hasta que lo revises.
            </li>
          )}
          {pedidos.map(({ pendiente, revision }) => {
            const quien = revision.pedido_por ? perfilesPorId.get(revision.pedido_por) : undefined
            const nuevo = !revision.abierto_en
            return (
              <li key={pendiente.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    setAbierto(false)
                    onAbrir(pendiente.id)
                  }}
                  className={cn(
                    "flex w-full gap-3 px-4 py-3 text-left outline-none hover:bg-accent focus-visible:bg-accent",
                    nuevo && "bg-primary/8"
                  )}
                >
                  <PerfilAvatar perfil={quien} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted-foreground">{quien?.nombre ?? "Alguien"} te pidió revisar</span>
                    <span className={cn("block text-sm break-words", nuevo ? "font-semibold" : "text-foreground/85")}>{pendiente.texto}</span>
                    <span className="mt-1 block text-xs text-muted-foreground/80">
                      {haceCuanto(revision.pedido_en)}
                      {!nuevo &&
                        (pendiente.perfil_id === yo || pendiente.aprobaciones.includes(yo)
                          ? " · abierto: falta darlo por revisado"
                          : " · abierto: falta aprobarlo o rebotarlo")}
                    </span>
                  </span>
                  {nuevo && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Sin abrir" />}
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
