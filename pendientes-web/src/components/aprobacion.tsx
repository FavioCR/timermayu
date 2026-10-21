import type { HTMLAttributes } from "react"
import { BadgeCheck, Check } from "lucide-react"
import { cn } from "cn"

import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import type { Pendiente, Perfil } from "@/lib/api"

// "Favio", "Favio y Kenny", "Favio, Kenny y Junior".
const lista = new Intl.ListFormat("es", { type: "conjunction" })

// Quiénes aprobaron un pendiente hecho y el check para aprobar su funcionalidad (o quitar la aprobación propia).
// La aprueban otros perfiles: su responsable no (es su trabajo) ni la cuenta del equipo (no se sabría quién).
export function Aprobacion({
  pendiente,
  perfilesPorId,
  yo,
  onAprobar,
  compacto = false,
  botonProps,
}: {
  pendiente: Pick<Pendiente, "texto" | "perfil_id" | "aprobaciones">
  perfilesPorId: Map<string, Perfil>
  yo: string | null
  onAprobar: (aprobar: boolean) => void
  // En la tarjeta: más chico, con el texto corto.
  compacto?: boolean
  // En la tarjeta, para que tocar el botón no empiece a arrastrarla.
  botonProps?: HTMLAttributes<HTMLButtonElement>
}) {
  const aprobadores = pendiente.aprobaciones.flatMap((id) => perfilesPorId.get(id) ?? [])
  const mia = yo !== null && pendiente.aprobaciones.includes(yo)
  const puedo = yo !== null && yo !== pendiente.perfil_id
  const nombres = lista.format(aprobadores.map((perfil) => perfil.nombre))
  const resumen =
    aprobadores.length === 0
      ? puedo
        ? ""
        : "Sin aprobar todavía"
      : compacto && aprobadores.length > 2
        ? `Aprobaron ${aprobadores.length}`
        : `${aprobadores.length === 1 ? "Aprobó" : "Aprobaron"} ${nombres}`

  return (
    <div className={cn("flex min-w-0 items-center gap-2", compacto ? "text-xs" : "flex-wrap text-sm")}>
      {puedo ? (
        <Button
          variant="outline"
          size={compacto ? "xs" : "sm"}
          aria-pressed={mia}
          aria-label={mia ? `Quitar tu aprobación de "${pendiente.texto}"` : `Aprobar "${pendiente.texto}"`}
          title={mia ? "Quitar tu aprobación" : "Aprobar la funcionalidad"}
          className={cn(
            "shrink-0",
            mia &&
              "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 hover:text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/20 dark:hover:text-emerald-200"
          )}
          {...botonProps}
          onClick={() => onAprobar(!mia)}
        >
          {mia ? <BadgeCheck /> : <Check />}
          {mia ? "Aprobado" : "Aprobar"}
        </Button>
      ) : (
        aprobadores.length > 0 && <BadgeCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      )}
      {aprobadores.length > 0 && (
        <span className="flex shrink-0 -space-x-1" aria-hidden>
          {aprobadores.slice(0, 4).map((perfil) => (
            <PerfilAvatar key={perfil.id} perfil={perfil} size="xs" className="ring-2 ring-card" />
          ))}
        </span>
      )}
      {resumen && (
        <span className="min-w-0 truncate text-muted-foreground" title={aprobadores.length > 0 ? `Aprobado por ${nombres}` : undefined}>
          {resumen}
        </span>
      )}
    </div>
  )
}
