import { useState, type FormEvent } from "react"
import { ScanEye } from "lucide-react"

import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { haceCuanto } from "@/lib/actividad"
import type { Pendiente, Perfil } from "@/lib/api"

// Elegir a quién pedirle que revise un pendiente hecho, con una nota opcional de qué mirar. Cada uno lo verá «sin leer»
// en su bandeja «Por revisar» hasta que lo abra, y ahí sigue hasta que lo apruebe o lo rebote.
export function PedirRevision({
  pendiente,
  candidatos,
  onPedir,
}: {
  pendiente: Pick<Pendiente, "estado" | "perfil_id" | "aprobaciones" | "revisiones">
  // Quienes pueden revisarlo: todos menos quien pide.
  candidatos: Perfil[]
  onPedir: (revisores: string[], nota: string) => Promise<boolean>
}) {
  const [elegidos, setElegidos] = useState<string[]>([])
  const [nota, setNota] = useState("")
  const [enviando, setEnviando] = useState(false)

  if (pendiente.estado !== "hecho") {
    return (
      <p className="m-0 flex items-start gap-2 text-sm text-muted-foreground">
        <ScanEye className="mt-0.5 size-4 shrink-0" />
        Primero pásalo a Hecho: ahí se aprueba o se rebota. Después pide la revisión desde aquí.
      </p>
    )
  }

  async function pedir(event: FormEvent) {
    event.preventDefault()
    if (elegidos.length === 0) return
    setEnviando(true)
    const listo = await onPedir(elegidos, nota.trim())
    if (!listo) setEnviando(false)
  }

  const cambiar = (id: string, marcado: boolean) => setElegidos((actuales) => (marcado ? [...actuales, id] : actuales.filter((otro) => otro !== id)))

  return (
    <form onSubmit={pedir} className="flex flex-col gap-3">
      <p className="m-0 flex items-center gap-2 text-sm font-medium">
        <ScanEye className="size-4 text-primary" /> Pedir revisión
      </p>
      {candidatos.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No hay a quién pedírsela: nadie más del equipo ve este pendiente.</p>
      ) : (
        <ul className="m-0 flex max-h-56 list-none flex-col gap-0.5 overflow-y-auto p-0" aria-label="A quién">
          {candidatos.map((perfil) => {
            const aprobo = pendiente.aprobaciones.includes(perfil.id)
            const pedido = pendiente.revisiones.find((revision) => revision.revisor_id === perfil.id)
            const detalle = pedido
              ? `pedido ${haceCuanto(pedido.pedido_en)}, ${pedido.abierto_en ? "ya lo abrió" : "sin abrir"}`
              : aprobo
                ? "ya lo aprobó"
                : perfil.id === pendiente.perfil_id
                  ? "responsable"
                  : !perfil.tiene_contrasena
                    ? "aún no entra"
                    : null
            return (
              <li key={perfil.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  <Checkbox
                    checked={elegidos.includes(perfil.id)}
                    onCheckedChange={(marcado) => cambiar(perfil.id, marcado === true)}
                  />
                  <PerfilAvatar perfil={perfil} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{perfil.nombre}</span>
                  {detalle && <span className="shrink-0 text-xs text-muted-foreground">{detalle}</span>}
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <Textarea
        aria-label="Qué revisar (opcional)"
        placeholder="Qué revisar (opcional). Ej.: el pago con tarjetas Visa"
        value={nota}
        onChange={(event) => setNota(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
        }}
        maxLength={500}
        rows={2}
        className="min-h-14 resize-none"
      />
      <p className="m-0 text-xs text-muted-foreground">
        Queda un mensaje en el chat y le llega el aviso. Lo verá sin leer hasta que lo abra, y pendiente hasta que lo revise.
      </p>
      <Button type="submit" size="sm" disabled={elegidos.length === 0 || enviando} className="self-end">
        <ScanEye /> {enviando ? "Pidiendo…" : elegidos.length > 1 ? `Pedir a ${elegidos.length}` : "Pedir revisión"}
      </Button>
    </form>
  )
}
