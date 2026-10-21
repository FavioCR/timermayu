import { useRef } from "react"
import { ChevronRight, ClipboardCheck, ImageIcon, MessageSquarePlus } from "lucide-react"
import { cn } from "cn"

import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { haceCuanto } from "@/lib/actividad"
import type { Evidencia, Perfil } from "@/lib/api"

export type Recordatorio = { pendiente: { id: string; texto: string }; evidencia: Evidencia }

const BURBUJA = "rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm"

function Mencion({ perfil }: { perfil: Perfil | null }) {
  return (
    <span className="rounded-full bg-primary/10 py-px pr-1.5 pl-0.5 font-semibold whitespace-nowrap text-primary">
      <PerfilAvatar perfil={perfil} size="xs" className="mr-1" />@{perfil?.nombre ?? "equipo"}
    </span>
  )
}

// Un mensaje de evidencia como se ve en el chat: qué se probó y cómo salió, con las capturas, y la respuesta del equipo.
function Ejemplo({ yo, otro }: { yo: Perfil | null; otro: Perfil | null }) {
  return (
    <div aria-label="Ejemplo de evidencia" className="flex flex-col gap-3 rounded-xl border bg-background/60 p-3">
      <div className="flex gap-2">
        <PerfilAvatar perfil={yo} size="sm" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{yo?.nombre ?? "Tú"}</span> · ahora
          </span>
          <p className={cn(BURBUJA, "m-0")}>
            <Mencion perfil={otro} />, les comparto el resultado: probé el flujo completo con los tres casos. En la primera captura se ve
            la configuración y en las siguientes, cómo respondió en cada caso.
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-xl border bg-gradient-to-br from-muted to-muted/40 text-muted-foreground"
              >
                <ImageIcon className="size-4" />
                <span className="text-[10px]">captura-{n}.png</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <span className="rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
          <span className="rounded-full bg-primary-foreground/20 py-px pr-1.5 pl-0.5 font-semibold whitespace-nowrap">
            <PerfilAvatar perfil={yo} size="xs" className="mr-1" />@{yo?.nombre ?? "tú"}
          </span>{" "}
          correcto
        </span>
        <PerfilAvatar perfil={otro} size="sm" />
      </div>
    </div>
  )
}

// Al tercer pendiente seguido que alguien pasa a Hecho sin un mensaje final en su chat: le recuerda dejar la evidencia.
export function RecordatorioEvidencia({
  recordatorio,
  yo,
  otro,
  onEscribir,
  onCerrar,
}: {
  recordatorio: Recordatorio | null
  yo: Perfil | null
  // Alguien del equipo, para el ejemplo (la mención y la respuesta).
  otro: Perfil | null
  onEscribir: (id: string) => void
  onCerrar: () => void
}) {
  const faltan = recordatorio?.evidencia.sin_evidencia ?? []
  const escribir = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={recordatorio !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg"
        // El foco va a lo que se espera que haga: escribir la evidencia (no al primero de la lista).
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          escribir.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="size-5 text-primary" /> Deja la evidencia en el chat
          </DialogTitle>
          <DialogDescription>
            Ya van {recordatorio?.evidencia.seguidos} pendientes seguidos que pasas a Hecho sin un mensaje final. Cuenta en el chat qué pruebas hiciste y
            qué resultados obtuviste, con capturas, para que quede la evidencia.
          </DialogDescription>
        </DialogHeader>

        <Ejemplo yo={yo} otro={otro} />

        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-sm font-medium">Sin evidencia</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {faltan.slice(0, 5).map((pendiente) => (
              <li key={pendiente.id}>
                <button
                  type="button"
                  onClick={() => onEscribir(pendiente.id)}
                  className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="min-w-0 flex-1 truncate">{pendiente.texto}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{haceCuanto(pendiente.hecho_en)}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
          {(recordatorio?.evidencia.seguidos ?? 0) > 5 && (
            <p className="m-0 text-xs text-muted-foreground">Y {(recordatorio?.evidencia.seguidos ?? 0) - 5} más.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>
            Ahora no
          </Button>
          <Button ref={escribir} onClick={() => recordatorio && onEscribir(recordatorio.pendiente.id)}>
            <MessageSquarePlus /> Escribir la evidencia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
