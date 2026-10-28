import { useId, useState, type FormEvent } from "react"
import { KeyRound, Lock, Pencil, Plus, Trash2 } from "lucide-react"
import { formatPhoneNumberIntl, isValidPhoneNumber, parsePhoneNumber } from "react-phone-number-input"
import paises from "react-phone-number-input/locale/es.json"

import { PerfilAvatar } from "@/components/perfil-avatar"
import { SelectorColor } from "@/components/selector-color"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PhoneInput } from "@/components/ui/phone-input"
import { colorLibre, type Perfil, type Usuario } from "@/lib/api"

export type CambiosPerfil = { nombre: string; correo: string | null; telefono: string | null; color: string; contrasena: string }

const telefonoValido = (telefono: string) => !telefono || isValidPhoneNumber(telefono)

// El WhatsApp con su país (Costa Rica primero y por defecto). Llega en E.164 (+50688887777); el servidor guarda solo los dígitos.
function CampoWhatsApp({
  valor,
  onCambiar,
  invalido,
  ...props
}: {
  id?: string
  "aria-label"?: string
  valor: string
  onCambiar: (valor: string) => void
  invalido?: boolean
}) {
  // El país del número guardado, para que el campo muestre solo el número nacional.
  const [pais] = useState(() => (valor && parsePhoneNumber(valor)?.country) || "CR")
  return (
    <PhoneInput
      {...props}
      defaultCountry={pais}
      international={false}
      labels={paises}
      countryOptionsOrder={["CR", "|", "..."]}
      placeholder="Número"
      autoComplete="off"
      value={valor}
      onChange={onCambiar}
      aria-invalid={invalido || undefined}
    />
  )
}

function EditorPerfil({
  perfil,
  esYo,
  onGuardar,
  onCancelar,
}: {
  perfil: Perfil
  esYo: boolean
  onGuardar: (cambios: CambiosPerfil) => Promise<boolean>
  onCancelar: () => void
}) {
  const id = useId()
  const [nombre, setNombre] = useState(perfil.nombre)
  const [correo, setCorreo] = useState(perfil.correo ?? "")
  const [telefono, setTelefono] = useState(perfil.telefono ? `+${perfil.telefono}` : "")
  const [color, setColor] = useState(perfil.color.toUpperCase())
  const [contrasena, setContrasena] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [telefonoMal, setTelefonoMal] = useState(false)

  async function guardar(event: FormEvent) {
    event.preventDefault()
    if (!telefonoValido(telefono)) {
      setTelefonoMal(true)
      return
    }
    setGuardando(true)
    const listo = await onGuardar({ nombre: nombre.trim(), correo: correo.trim() || null, telefono: telefono.trim() || null, color, contrasena })
    setGuardando(false)
    if (listo) onCancelar()
  }

  return (
    <form onSubmit={guardar} className="mt-2 flex flex-col gap-4 rounded-lg border bg-muted/30 p-3">
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-nombre`}>Nombre</FieldLabel>
          <Input id={`${id}-nombre`} value={nombre} onChange={(event) => setNombre(event.target.value)} maxLength={40} required />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-correo`}>
            Correo <span className="font-normal text-muted-foreground">(opcional)</span>
          </FieldLabel>
          <Input
            id={`${id}-correo`}
            type="email"
            autoComplete="off"
            placeholder="nombre@ejemplo.com"
            value={correo}
            onChange={(event) => setCorreo(event.target.value)}
            maxLength={120}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-telefono`}>
            WhatsApp <span className="font-normal text-muted-foreground">(opcional)</span>
          </FieldLabel>
          <CampoWhatsApp
            id={`${id}-telefono`}
            valor={telefono}
            onCambiar={(valor) => {
              setTelefono(valor)
              setTelefonoMal(false)
            }}
            invalido={telefonoMal}
          />
          {telefonoMal ? (
            <FieldError>Revisa el número: no corresponde a ese país.</FieldError>
          ) : (
            <FieldDescription>Elige el país y escribe el número. Sirve para avisarle por WhatsApp cuando le asignan algo.</FieldDescription>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-contrasena`}>{perfil.tiene_contrasena ? "Nueva contraseña" : "Contraseña"}</FieldLabel>
          <Input
            id={`${id}-contrasena`}
            type="password"
            autoComplete="new-password"
            minLength={8}
            placeholder={perfil.tiene_contrasena ? "Déjala vacía para no cambiarla" : "Mínimo 8 caracteres"}
            value={contrasena}
            onChange={(event) => setContrasena(event.target.value)}
          />
          {!perfil.tiene_contrasena && (
            <FieldDescription>
              Con ella {esYo ? "entras" : `${perfil.nombre} entra`} con su nombre y puede tener organizaciones privadas. Desde entonces solo{" "}
              {esYo ? "tú podrás" : `${perfil.nombre} podrá`} cambiar este perfil.
            </FieldDescription>
          )}
        </Field>
        <SelectorColor valor={color} onCambiar={setColor} etiqueta="Color del perfil" />
      </FieldGroup>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={guardando || !nombre.trim()}>
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

// Los callbacks devuelven el mensaje de error, o null si salió bien.
export function PerfilesDialog({
  abierto,
  onAbiertoChange,
  perfiles,
  asignados,
  usuario,
  onCrear,
  onActualizar,
  onBorrar,
}: {
  abierto: boolean
  onAbiertoChange: (abierto: boolean) => void
  perfiles: Perfil[]
  asignados: Map<string, number>
  usuario: Usuario | null
  onCrear: (datos: { nombre: string; color: string; correo: string | null; telefono: string | null }) => Promise<string | null>
  onActualizar: (perfil: Perfil, cambios: CambiosPerfil) => Promise<string | null>
  onBorrar: (perfil: Perfil) => Promise<string | null>
}) {
  const [nombre, setNombre] = useState("")
  const [correo, setCorreo] = useState("")
  const [telefono, setTelefono] = useState("")
  const [color, setColor] = useState<string | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [error, setError] = useState("")

  const colorElegido = color ?? colorLibre(perfiles.map((perfil) => perfil.color))

  async function agregar(event: FormEvent) {
    event.preventDefault()
    if (!nombre.trim()) return
    if (!telefonoValido(telefono)) {
      setError("Revisa el WhatsApp: el número no corresponde a ese país.")
      return
    }
    const fallo = await onCrear({ nombre: nombre.trim(), color: colorElegido, correo: correo.trim() || null, telefono: telefono.trim() || null })
    setError(fallo ?? "")
    if (!fallo) {
      setNombre("")
      setCorreo("")
      setTelefono("")
      setColor(null)
    }
  }

  async function guardar(perfil: Perfil, cambios: CambiosPerfil) {
    const fallo = await onActualizar(perfil, cambios)
    setError(fallo ?? "")
    return !fallo
  }

  async function quitar(perfil: Perfil) {
    const fallo = await onBorrar(perfil)
    setError(fallo ?? "")
    setConfirmando(null)
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(siguiente) => {
        setEditando(null)
        setConfirmando(null)
        setError("")
        onAbiertoChange(siguiente)
      }}
    >
      <DialogContent data-seguir="seccion:perfiles" className="max-h-[90svh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Perfiles</DialogTitle>
          <DialogDescription>
            Las personas a las que se les puede asignar un pendiente. Con contraseña, cada una entra con su nombre (o su correo).
          </DialogDescription>
        </DialogHeader>

        <ul className="-mx-4 flex flex-col divide-y overflow-y-auto px-4">
          {perfiles.map((perfil) => {
            const cantidad = asignados.get(perfil.id) ?? 0
            const esYo = perfil.id === usuario?.perfil_id
            // Un perfil con contraseña solo lo cambia o lo quita esa persona.
            const puedeCambiar = !perfil.tiene_contrasena || esYo
            const enConfirmacion = confirmando === perfil.id
            return (
              <li key={perfil.id} className="flex flex-col py-2">
                <div className="flex items-center gap-3">
                  <PerfilAvatar perfil={perfil} size="default" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{perfil.nombre}</span>
                      {esYo && <Badge variant="secondary">Tú</Badge>}
                      {perfil.tiene_contrasena && <KeyRound className="size-3.5 shrink-0 text-muted-foreground" aria-label="Tiene contraseña" />}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {enConfirmacion
                        ? esYo
                          ? "Se cerrará tu sesión"
                          : cantidad > 0
                            ? cantidad === 1
                              ? "Su pendiente quedará sin asignar"
                              : `Sus ${cantidad} pendientes quedarán sin asignar`
                            : "No tiene pendientes asignados"
                        : [
                            perfil.correo,
                            perfil.telefono && (formatPhoneNumberIntl(`+${perfil.telefono}`) || `+${perfil.telefono}`),
                            cantidad === 0 ? "Sin pendientes asignados" : `${cantidad} pendiente${cantidad === 1 ? "" : "s"}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </p>
                  </div>
                  {enConfirmacion ? (
                    <div className="flex items-center gap-1">
                      <Button size="xs" variant="destructive" onClick={() => quitar(perfil)}>
                        Sí, quitar
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setConfirmando(null)}>
                        No
                      </Button>
                    </div>
                  ) : puedeCambiar ? (
                    <div className="flex items-center">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground"
                        aria-label={`Editar a ${perfil.nombre}`}
                        aria-expanded={editando === perfil.id}
                        onClick={() => setEditando(editando === perfil.id ? null : perfil.id)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Quitar a ${perfil.nombre}`}
                        onClick={() => {
                          setEditando(null)
                          setConfirmando(perfil.id)
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ) : (
                    <span className="flex size-8 items-center justify-center text-muted-foreground" title={`Solo ${perfil.nombre} puede cambiar su perfil`}>
                      <Lock className="size-4" aria-label={`Solo ${perfil.nombre} puede cambiar su perfil`} />
                    </span>
                  )}
                </div>
                {editando === perfil.id && (
                  <EditorPerfil perfil={perfil} esYo={esYo} onGuardar={(cambios) => guardar(perfil, cambios)} onCancelar={() => setEditando(null)} />
                )}
              </li>
            )
          })}
          {perfiles.length === 0 && <li className="py-2 text-sm text-muted-foreground">Todavía no hay perfiles.</li>}
        </ul>

        <form onSubmit={agregar} className="flex flex-col gap-3 border-t pt-4">
          <div className="flex gap-2">
            <Input
              aria-label="Nombre del perfil nuevo"
              placeholder="Nombre"
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
              maxLength={40}
            />
            <Button type="submit" disabled={!nombre.trim()}>
              <Plus /> Agregar
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              type="email"
              aria-label="Correo del perfil nuevo (opcional)"
              placeholder="Correo (opcional)"
              autoComplete="off"
              value={correo}
              onChange={(event) => setCorreo(event.target.value)}
              maxLength={120}
            />
            <CampoWhatsApp aria-label="WhatsApp del perfil nuevo (opcional)" valor={telefono} onCambiar={setTelefono} />
          </div>
          <SelectorColor valor={colorElegido} onCambiar={setColor} etiqueta="Color del perfil" />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
