import { lazy, Suspense, useCallback, useState } from "react"

import { LoginForm } from "@/components/login-form"
import { NuevaVersion } from "@/components/nueva-version"
import { Tablero } from "@/components/tablero"
import { Toaster } from "@/components/ui/sonner"
import { APARIENCIA_NORMAL, aplicarApariencia } from "@/lib/apariencia"
import { guardarCredenciales, leerCredenciales } from "@/lib/api"
import { esNotas } from "@/lib/notas"

// Las notas privadas (/pendientes/notas) se cargan aparte: el tablero no las necesita.
const PaginaNotas = lazy(() => import("@/components/notas/pagina-notas"))

export default function App() {
  const [credenciales, setCredenciales] = useState(leerCredenciales)
  const notas = esNotas()

  const entrar = useCallback((nuevas: string) => {
    guardarCredenciales(nuevas)
    setCredenciales(nuevas)
  }, [])

  const salir = useCallback(() => {
    guardarCredenciales(null)
    setCredenciales(null)
    // La fuente y el tamaño eran de esa persona: quien entre después empieza con los de siempre.
    aplicarApariencia(APARIENCIA_NORMAL)
  }, [])

  return (
    <>
      <NuevaVersion />
      {!credenciales ? (
        <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 md:p-10">
          <div className="w-full max-w-sm">
            <LoginForm onEntrar={entrar} notas={notas} />
          </div>
        </div>
      ) : notas ? (
        <Suspense fallback={null}>
          <PaginaNotas credenciales={credenciales} onSalir={salir} />
        </Suspense>
      ) : (
        <Tablero credenciales={credenciales} onCredenciales={entrar} onSalir={salir} />
      )}
      {/* Los avisos que se van solos, del tablero y de las notas. */}
      <Toaster position="bottom-right" />
    </>
  )
}
