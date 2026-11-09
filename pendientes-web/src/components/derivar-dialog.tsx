import { useState, type FormEvent } from "react"
import { CopyPlus } from "lucide-react"

import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Pendiente, Perfil } from "@/lib/api"
import { NADIE } from "@/lib/estados"

// Lo que se escribe en el diálogo; el resto (proyecto, tipo, etiquetas, el enlace al original) lo pone quien lo crea.
export type Derivado = { texto: string; detalle: string; perfil_id: string | null }

function Formulario({
  pendiente,
  personas,
  onCancelar,
  onCrear,
}: {
  pendiente: Pendiente
  personas: Perfil[]
  onCancelar: () => void
  onCrear: (derivado: Derivado) => Promise<boolean>
}) {
  const [texto, setTexto] = useState(pendiente.texto)
  const [detalle, setDetalle] = useState("")
  const [perfilId, setPerfilId] = useState(pendiente.perfil_id ?? NADIE)
  const [enviando, setEnviando] = useState(false)

  async function crear(event: FormEvent) {
    event.preventDefault()
    if (!texto.trim()) return
    setEnviando(true)
    const listo = await onCrear({ texto: texto.trim(), detalle: detalle.trim(), perfil_id: perfilId === NADIE ? null : perfilId })
    if (!listo) setEnviando(false)
  }

  return (
    <form onSubmit={crear} className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="derivar-texto">Título</FieldLabel>
          <Input
            id="derivar-texto"
            autoFocus
            // Seleccionado: escribir lo reemplaza, y dejarlo como está es un clic.
            onFocus={(event) => event.currentTarget.select()}
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            maxLength={500}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="derivar-detalle">
            ¿Qué hay que hacer? <span className="font-normal text-muted-foreground">(opcional)</span>
          </FieldLabel>
          <Textarea
            id="derivar-detalle"
            placeholder="Ej.: ahora que funciona, que también acepte tarjetas Visa"
            value={detalle}
            onChange={(event) => setDetalle(event.target.value)}
            onKeyDown={(event) => {
              // Cmd/Ctrl + Enter lo crea sin ir al botón.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit()
            }}
            maxLength={2000}
            rows={3}
          />
          <FieldDescription>Va en la descripción, debajo del enlace a #{pendiente.numero}.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="derivar-responsable">Responsable</FieldLabel>
          <Select value={perfilId} onValueChange={setPerfilId}>
            <SelectTrigger id="derivar-responsable" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {personas.map((perfil) => (
                <SelectItem key={perfil.id} value={perfil.id}>
                  <PerfilAvatar perfil={perfil} size="sm" /> {perfil.nombre}
                </SelectItem>
              ))}
              <SelectItem value={NADIE}>
                <PerfilAvatar perfil={null} size="sm" /> Sin asignar
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!texto.trim() || enviando}>
          <CopyPlus /> {enviando ? "Creando…" : "Crear pendiente"}
        </Button>
      </DialogFooter>
    </form>
  )
}

// Un pendiente nuevo que parte de otro (lo que siguió al revisarlo, una mejora…): lleva su proyecto, su tipo y sus
// etiquetas, y en la descripción el enlace al original. El original queda como estaba.
export function DerivarDialog({
  pendiente,
  personas,
  onCerrar,
  onCrear,
}: {
  pendiente: Pendiente | null
  personas: Perfil[]
  onCerrar: () => void
  onCrear: (derivado: Derivado) => Promise<boolean>
}) {
  return (
    <Dialog open={pendiente !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo pendiente a partir de #{pendiente?.numero}</DialogTitle>
          <DialogDescription>
            Entra en Por hacer con el mismo proyecto, tipo y etiquetas, y con el enlace a «{pendiente?.texto}». El original no cambia.
          </DialogDescription>
        </DialogHeader>
        {pendiente && <Formulario key={pendiente.id} pendiente={pendiente} personas={personas} onCancelar={onCerrar} onCrear={onCrear} />}
      </DialogContent>
    </Dialog>
  )
}
