import { useEffect, useState } from "react"
import { LoaderCircle, RotateCcw, Type } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { api, esNoAutorizado, mensajeDeError } from "@/lib/api"
import { APARIENCIA_NORMAL, aplicarApariencia, FUENTES, mismaApariencia, TAMANOS, type Apariencia } from "@/lib/apariencia"

const TARJETA =
  "flex flex-col items-start gap-1 border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
const ELEGIDA = "border-primary bg-primary/15 ring-3 ring-primary/25 hover:bg-primary/20"

function Formulario({
  credenciales,
  actual,
  esEquipo,
  onCancelar,
  onGuardado,
  onSalir,
}: {
  credenciales: string
  actual: Apariencia
  esEquipo: boolean
  onCancelar: () => void
  onGuardado: (apariencia: Apariencia) => void
  onSalir: () => void
}) {
  const [elegida, setElegida] = useState(actual)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState("")

  // Se ve al instante en todo el tablero; al cerrar sin guardar, el tablero vuelve a poner la guardada.
  useEffect(() => aplicarApariencia(elegida), [elegida])

  async function guardar() {
    setGuardando(true)
    try {
      onGuardado(await api.guardarApariencia(credenciales, elegida))
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
      setError(mensajeDeError(err))
      setGuardando(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">Fuente</FieldLegend>
          <div role="radiogroup" aria-label="Fuente" className="grid gap-2 sm:grid-cols-2">
            {FUENTES.map((fuente) => (
              <button
                key={fuente.id}
                type="button"
                role="radio"
                aria-checked={elegida.fuente === fuente.id}
                onClick={() => setElegida((antes) => ({ ...antes, fuente: fuente.id }))}
                className={cn(TARJETA, "flex-row items-center gap-3", elegida.fuente === fuente.id && ELEGIDA)}
                style={{ fontFamily: fuente.familia }}
              >
                <span aria-hidden className="w-9 shrink-0 text-2xl leading-none">
                  Aa
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{fuente.nombre}</span>
                  <span className="truncate text-xs text-muted-foreground">{fuente.nota}</span>
                </span>
              </button>
            ))}
          </div>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Tamaño de letra</FieldLegend>
          <div role="radiogroup" aria-label="Tamaño de letra" className="grid grid-cols-5 gap-2">
            {TAMANOS.map((tamano) => (
              <button
                key={tamano.valor}
                type="button"
                role="radio"
                aria-checked={elegida.tamano === tamano.valor}
                aria-label={tamano.nombre}
                onClick={() => setElegida((antes) => ({ ...antes, tamano: tamano.valor }))}
                className={cn(TARJETA, "items-center justify-end px-1", elegida.tamano === tamano.valor && ELEGIDA)}
              >
                {/* La A crece con cada paso; en px para que no cambie al elegir. */}
                <span aria-hidden className="leading-none font-medium" style={{ fontSize: `${(tamano.valor / 100) * 18}px` }}>
                  A
                </span>
                <span className="text-center text-[11px] leading-tight text-muted-foreground">{tamano.nombre}</span>
              </button>
            ))}
          </div>
        </FieldSet>
      </FieldGroup>

      <p className="m-0 border-l-2 border-primary/50 pl-3 text-xs text-muted-foreground">
        {esEquipo
          ? "Con la cuenta del equipo, valen para todos los que entran con ella."
          : "Se guardan en tu perfil: los ves igual en cualquier computadora o celular donde entres. Los demás siguen con los suyos."}
      </p>

      {error && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          disabled={mismaApariencia(elegida, APARIENCIA_NORMAL)}
          onClick={() => setElegida(APARIENCIA_NORMAL)}
        >
          <RotateCcw /> Volver a la de siempre
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button type="button" disabled={guardando || mismaApariencia(elegida, actual)} onClick={guardar}>
            {guardando ? <LoaderCircle className="animate-spin" /> : <Type />} {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </DialogFooter>
    </div>
  )
}

// La fuente y el tamaño de letra con que cada persona ve el tablero (y sus notas).
export function AparienciaDialog({
  abierto,
  onAbiertoChange,
  credenciales,
  actual,
  esEquipo,
  onGuardado,
  onSalir,
}: {
  abierto: boolean
  onAbiertoChange: (abierto: boolean) => void
  credenciales: string
  actual: Apariencia
  esEquipo: boolean
  onGuardado: (apariencia: Apariencia) => void
  onSalir: () => void
}) {
  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Type className="size-5 text-primary" /> Apariencia
          </DialogTitle>
          <DialogDescription>La fuente y el tamaño de letra con que ves el tablero. Mientras eliges, ya se ve así.</DialogDescription>
        </DialogHeader>
        {abierto && (
          <Formulario
            credenciales={credenciales}
            actual={actual}
            esEquipo={esEquipo}
            onCancelar={() => onAbiertoChange(false)}
            onGuardado={(guardada) => {
              onGuardado(guardada)
              onAbiertoChange(false)
            }}
            onSalir={onSalir}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
