import { useState, type FormEvent } from "react"
import { Forward } from "lucide-react"

import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Pendiente, Perfil } from "@/lib/api"

function Formulario({
  pendiente,
  personas,
  onCancelar,
  onPasar,
}: {
  pendiente: Pendiente
  personas: Perfil[]
  onCancelar: () => void
  onPasar: (perfilId: string, nota: string) => Promise<boolean>
}) {
  const opciones = personas.filter((perfil) => perfil.id !== pendiente.perfil_id)
  const [perfilId, setPerfilId] = useState("")
  const [nota, setNota] = useState("")
  const [enviando, setEnviando] = useState(false)

  async function pasar(event: FormEvent) {
    event.preventDefault()
    if (!perfilId) return
    setEnviando(true)
    const listo = await onPasar(perfilId, nota.trim())
    if (!listo) setEnviando(false)
  }

  return (
    <form onSubmit={pasar} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="pasar-a">¿A quién?</FieldLabel>
          <Select value={perfilId} onValueChange={setPerfilId}>
            <SelectTrigger id="pasar-a" className="w-full">
              <SelectValue placeholder="Elige a la persona" />
            </SelectTrigger>
            <SelectContent>
              {opciones.map((perfil) => (
                <SelectItem key={perfil.id} value={perfil.id}>
                  <PerfilAvatar perfil={perfil} size="sm" /> {perfil.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="pasar-nota">
            ¿Qué le toca? <span className="font-normal text-muted-foreground">(opcional)</span>
          </FieldLabel>
          <Textarea
            id="pasar-nota"
            placeholder="Ej.: el frontend de esta funcionalidad"
            value={nota}
            onChange={(event) => setNota(event.target.value)}
            maxLength={500}
            rows={3}
          />
          <FieldDescription>Queda en el historial y le llega en el aviso.</FieldDescription>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!perfilId || enviando}>
          <Forward /> {enviando ? "Pasando…" : "Pasar"}
        </Button>
      </DialogFooter>
    </form>
  )
}

// Cuando alguien termina su parte (el backend, por ejemplo), pasa el mismo pendiente a quien sigue (el frontend):
// vuelve a Por hacer con el nuevo responsable y conserva su historial, su chat y sus archivos.
export function PasarDialog({
  pendiente,
  personas,
  onCerrar,
  onPasar,
}: {
  pendiente: Pendiente | null
  personas: Perfil[]
  onCerrar: () => void
  onPasar: (perfilId: string, nota: string) => Promise<boolean>
}) {
  return (
    <Dialog open={pendiente !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pasar a otra persona</DialogTitle>
          <DialogDescription>
            «{pendiente?.texto}» vuelve a Por hacer con su nuevo responsable. Su historial, su chat y sus archivos se mantienen.
          </DialogDescription>
        </DialogHeader>
        {pendiente && <Formulario key={pendiente.id} pendiente={pendiente} personas={personas} onCancelar={onCerrar} onPasar={onPasar} />}
      </DialogContent>
    </Dialog>
  )
}
