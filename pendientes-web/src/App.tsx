import { useCallback, useState } from "react"

import { LoginForm } from "@/components/login-form"
import { Tablero } from "@/components/tablero"
import { guardarCredenciales, leerCredenciales } from "@/lib/api"

export default function App() {
  const [credenciales, setCredenciales] = useState(leerCredenciales)

  const entrar = useCallback((nuevas: string) => {
    guardarCredenciales(nuevas)
    setCredenciales(nuevas)
  }, [])

  const salir = useCallback(() => {
    guardarCredenciales(null)
    setCredenciales(null)
  }, [])

  if (!credenciales) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 md:p-10">
        <div className="w-full max-w-sm">
          <LoginForm onEntrar={entrar} />
        </div>
      </div>
    )
  }

  return <Tablero credenciales={credenciales} onCredenciales={entrar} onSalir={salir} />
}
