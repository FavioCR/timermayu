import { useState, type FormEvent } from "react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { api, crearCredenciales, mensajeDeError } from "@/lib/api"

const ULTIMO_USUARIO = "pendientes.usuario"

function leerUltimoUsuario() {
  try {
    return localStorage.getItem(ULTIMO_USUARIO) ?? ""
  } catch {
    return ""
  }
}

function guardarUltimoUsuario(usuario: string) {
  try {
    localStorage.setItem(ULTIMO_USUARIO, usuario)
  } catch {
    // Sin almacenamiento: la próxima vez habrá que escribirlo de nuevo.
  }
}

// Basado en el bloque login-01 de shadcn/ui. Cada perfil entra con su nombre (o su correo) y su contraseña;
// la cuenta del equipo sirve para entrar la primera vez y ponerle contraseña a cada perfil. Las notas privadas usan el
// mismo acceso, con su título.
export function LoginForm({
  className,
  onEntrar,
  notas = false,
  ...props
}: React.ComponentProps<"div"> & { onEntrar: (credenciales: string) => void; notas?: boolean }) {
  const [usuario, setUsuario] = useState(leerUltimoUsuario)
  const [contrasena, setContrasena] = useState("")
  const [error, setError] = useState("")
  const [enviando, setEnviando] = useState(false)

  async function entrar(event: FormEvent) {
    event.preventDefault()
    setEnviando(true)
    setError("")
    const credenciales = crearCredenciales(usuario.trim(), contrasena)
    try {
      await api.yo(credenciales)
      guardarUltimoUsuario(usuario.trim())
      onEntrar(credenciales)
    } catch (err) {
      setError(mensajeDeError(err))
      setEnviando(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>{notas ? "Notas" : "Pendientes"}</CardTitle>
          <CardDescription>
            {notas
              ? "Tus apuntes privados. Entra con tu correo y tu contraseña."
              : "Entra con tu nombre (o tu correo) y tu contraseña. Si tu perfil todavía no tiene contraseña, entra con la cuenta del equipo y pónsela en Perfiles."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={entrar}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="usuario">Usuario</FieldLabel>
                <Input
                  id="usuario"
                  autoComplete="username"
                  placeholder={notas ? "Tu correo" : "Tu nombre"}
                  autoFocus={!usuario}
                  value={usuario}
                  onChange={(event) => setUsuario(event.target.value)}
                  required
                />
              </Field>
              <Field data-invalid={Boolean(error) || undefined}>
                <FieldLabel htmlFor="contrasena">Contraseña</FieldLabel>
                <Input
                  id="contrasena"
                  type="password"
                  autoComplete="current-password"
                  autoFocus={Boolean(usuario)}
                  value={contrasena}
                  onChange={(event) => setContrasena(event.target.value)}
                  aria-invalid={Boolean(error) || undefined}
                  required
                />
                {error && <FieldError>{error}</FieldError>}
              </Field>
              <Field>
                <Button type="submit" disabled={enviando}>
                  {enviando ? "Entrando…" : "Entrar"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
