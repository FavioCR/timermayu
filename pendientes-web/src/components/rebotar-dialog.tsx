import { useState, type FormEvent } from "react"
import { TriangleAlert, Undo2 } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { haceCuanto } from "@/lib/actividad"
import type { Pendiente, Perfil } from "@/lib/api"

// La marca de un pendiente rebotado, en su tarjeta y en su detalle: el signo de atención, quién lo rebotó y qué falta.
export function AvisoRebote({
  pendiente,
  por,
  compacto = false,
}: {
  pendiente: Pick<Pendiente, "rebotado_en" | "rebote_nota">
  por: Perfil | null
  compacto?: boolean
}) {
  if (!pendiente.rebotado_en) return null
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-1.5 border border-destructive/30 bg-destructive/10 text-destructive",
        compacto ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm"
      )}
    >
      <TriangleAlert className={cn("shrink-0", compacto ? "mt-px size-3.5" : "mt-0.5 size-4")} aria-hidden />
      <p className={cn("m-0 min-w-0 break-words", compacto && "line-clamp-2")}>
        <span className="font-semibold">Rebotado</span> por {por?.nombre ?? "alguien"} {haceCuanto(pendiente.rebotado_en)}
        {pendiente.rebote_nota && `: ${pendiente.rebote_nota}`}
      </p>
    </div>
  )
}

function Formulario({ onCancelar, onRebotar }: { onCancelar: () => void; onRebotar: (nota: string) => Promise<boolean> }) {
  const [nota, setNota] = useState("")
  const [enviando, setEnviando] = useState(false)

  async function rebotar(event: FormEvent) {
    event.preventDefault()
    setEnviando(true)
    const listo = await onRebotar(nota.trim())
    if (!listo) setEnviando(false)
  }

  return (
    <form onSubmit={rebotar} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="rebote-nota">
            ¿Qué falta? <span className="font-normal text-muted-foreground">(opcional)</span>
          </FieldLabel>
          <Textarea
            id="rebote-nota"
            autoFocus
            placeholder="Ej.: con tarjetas Visa el pago falla"
            value={nota}
            onChange={(event) => setNota(event.target.value)}
            onKeyDown={(event) => {
              // Cmd/Ctrl + Enter rebota sin ir al botón.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
            }}
            maxLength={500}
            rows={3}
          />
          <FieldDescription>Se ve en la tarjeta, queda en el historial y le llega en el aviso.</FieldDescription>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" variant="destructive" disabled={enviando}>
          <Undo2 /> {enviando ? "Rebotando…" : "Rebotar"}
        </Button>
      </DialogFooter>
    </form>
  )
}

// Quien revisa un pendiente hecho y no lo aprueba lo rebota: vuelve a Haciendo, primero en su columna y con el signo de
// atención hasta que vuelva a Hecho. A su responsable le llega el aviso (y, si no lo abre, el recordatorio por correo).
export function RebotarDialog({
  pendiente,
  responsable,
  onCerrar,
  onRebotar,
}: {
  pendiente: Pendiente | null
  responsable: Perfil | null
  onCerrar: () => void
  onRebotar: (nota: string) => Promise<boolean>
}) {
  return (
    <Dialog open={pendiente !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rebotar a Haciendo</DialogTitle>
          <DialogDescription>
            «{pendiente?.texto}» vuelve a Haciendo, primero en la columna y marcado como rebotado hasta que vuelva a Hecho.
            {responsable && ` ${responsable.nombre} recibe el aviso.`}
          </DialogDescription>
        </DialogHeader>
        {pendiente && <Formulario key={pendiente.id} onCancelar={onCerrar} onRebotar={onRebotar} />}
      </DialogContent>
    </Dialog>
  )
}
