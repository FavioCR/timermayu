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

// Basado en el bloque login-01 de shadcn/ui, adaptado al usuario y contraseña del API de pendientes.
export function LoginForm({
  className,
  onEntrar,
  ...props
}: React.ComponentProps<"div"> & { onEntrar: (credenciales: string) => void }) {
  const [usuario, setUsuario] = useState("pendientes")
  const [contrasena, setContrasena] = useState("")
  const [error, setError] = useState("")
  const [enviando, setEnviando] = useState(false)

  async function entrar(event: FormEvent) {
    event.preventDefault()
    setEnviando(true)
    setError("")
    const credenciales = crearCredenciales(usuario.trim(), contrasena)
    try {
      await api.listar(credenciales)
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
          <CardTitle>Pendientes</CardTitle>
          <CardDescription>
            Entra con el usuario y la contraseña del tablero.
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
                  autoFocus
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
