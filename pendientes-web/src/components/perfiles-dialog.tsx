import { useState, type FormEvent } from "react"
import { cn } from "cn"
import { Plus, Trash2, Users } from "lucide-react"

import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { COLORES_PERFIL, type Perfil } from "@/lib/api"

// Los callbacks devuelven el mensaje de error, o null si salió bien.
export function PerfilesDialog({
  perfiles,
  asignados,
  onCrear,
  onBorrar,
}: {
  perfiles: Perfil[]
  asignados: Map<string, number>
  onCrear: (datos: { nombre: string; color: string }) => Promise<string | null>
  onBorrar: (perfil: Perfil) => Promise<string | null>
}) {
  const [nombre, setNombre] = useState("")
  const [color, setColor] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [error, setError] = useState("")

  const usados = new Set(perfiles.map((perfil) => perfil.color.toUpperCase()))
  const colorElegido = color ?? COLORES_PERFIL.find((c) => !usados.has(c)) ?? COLORES_PERFIL[perfiles.length % COLORES_PERFIL.length]

  async function agregar(event: FormEvent) {
    event.preventDefault()
    if (!nombre.trim()) return
    const fallo = await onCrear({ nombre: nombre.trim(), color: colorElegido })
    setError(fallo ?? "")
    if (!fallo) {
      setNombre("")
      setColor(null)
    }
  }

  async function quitar(perfil: Perfil) {
    const fallo = await onBorrar(perfil)
    setError(fallo ?? "")
    setConfirmando(null)
  }

  return (
    <Dialog
      onOpenChange={() => {
        setConfirmando(null)
        setError("")
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Perfiles">
          <Users /> <span className="hidden sm:inline">Perfiles</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Perfiles</DialogTitle>
          <DialogDescription>Las personas a las que se les puede asignar un pendiente.</DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col divide-y">
          {perfiles.map((perfil) => {
            const cantidad = asignados.get(perfil.id) ?? 0
            const enConfirmacion = confirmando === perfil.id
            return (
              <li key={perfil.id} className="flex items-center gap-3 py-2">
                <PerfilAvatar perfil={perfil} size="default" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{perfil.nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    {enConfirmacion && cantidad > 0
                      ? cantidad === 1
                        ? "Su pendiente quedará sin asignar"
                        : `Sus ${cantidad} pendientes quedarán sin asignar`
                      : cantidad === 0
                        ? "Sin pendientes asignados"
                        : `${cantidad} pendiente${cantidad === 1 ? "" : "s"} asignado${cantidad === 1 ? "" : "s"}`}
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
                ) : (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Quitar a ${perfil.nombre}`}
                    onClick={() => setConfirmando(perfil.id)}
                  >
                    <Trash2 />
                  </Button>
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
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color del perfil">
            {COLORES_PERFIL.map((opcion) => (
              <button
                key={opcion}
                type="button"
                role="radio"
                aria-checked={colorElegido === opcion}
                aria-label={`Color ${opcion}`}
                onClick={() => setColor(opcion)}
                className={cn(
                  "size-6 rounded-full ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  colorElegido === opcion && "ring-2 ring-foreground"
                )}
                style={{ backgroundColor: opcion }}
              />
            ))}
          </div>
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
