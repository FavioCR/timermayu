import { MonitorDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { comoInstalar } from "@/lib/instalar"

// Los pasos para instalar el tablero cuando el navegador no ofrece su propia ventana (Safari, Firefox, o Chrome si
// ya se cerró su aviso).
export function InstalarDialog({ abierto, onAbiertoChange }: { abierto: boolean; onAbiertoChange: (abierto: boolean) => void }) {
  const { navegador, pasos } = comoInstalar()
  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MonitorDown className="size-5 text-primary" /> Instalar en el escritorio
          </DialogTitle>
          <DialogDescription>
            El tablero queda como una app: con su ícono en el Dock o en el menú Inicio y en su propia ventana, sin pestañas.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm">
          <p className="m-0 font-medium">En {navegador}:</p>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {pasos.map((paso, i) => (
              <li key={paso} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="pt-0.5">{paso}</span>
              </li>
            ))}
          </ol>
          <p className="m-0 mt-2 text-muted-foreground">Si ya la instalaste, ábrela desde tus apps (Launchpad, el Dock o el menú Inicio).</p>
        </div>
        <DialogFooter>
          <Button onClick={() => onAbiertoChange(false)}>Entendido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
