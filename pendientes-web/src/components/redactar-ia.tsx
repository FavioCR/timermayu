import { useState } from "react"
import { ArrowLeft, Check, Loader2, RotateCw, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { mensajeDeError } from "@/lib/api"

type Paso = { fase: "escribir" } | { fase: "pensando" } | { fase: "listo"; texto: string; reemplaza: boolean }

// La vista previa muestra la **negrita** como quedará (las listas ya se leen bien como texto).
function conNegritas(texto: string) {
  return texto.split(/\*\*(.+?)\*\*/g).map((parte, i) => (i % 2 === 1 ? <strong key={i}>{parte}</strong> : parte))
}

// El campo chico que abre /ia en el chat y en la descripción: se escribe a la rápida lo que se quiere decir (o se deja
// vacío para mejorar lo que ya está escrito) y la IA lo redacta. El resultado se revisa antes de usarlo.
export function RedactarIA({
  previo,
  redactar,
  onUsar,
}: {
  // Lo que ya está escrito: con el campo vacío, eso es lo que se mejora (y el resultado lo reemplaza).
  previo: string
  redactar: (texto: string) => Promise<string>
  onUsar: (texto: string, reemplaza: boolean) => void
}) {
  const [pedido, setPedido] = useState("")
  const [paso, setPaso] = useState<Paso>({ fase: "escribir" })
  const [error, setError] = useState("")
  const mejora = !pedido.trim() && previo.trim() !== ""

  async function pedir() {
    const reemplaza = !pedido.trim()
    const texto = reemplaza ? previo.trim() : pedido.trim()
    if (!texto || paso.fase === "pensando") return
    setError("")
    setPaso({ fase: "pensando" })
    try {
      setPaso({ fase: "listo", texto: await redactar(texto), reemplaza })
    } catch (err) {
      setError(mensajeDeError(err))
      setPaso({ fase: "escribir" })
    }
  }

  return (
    <div className="flex flex-col gap-2.5 text-sm">
      <p className="m-0 flex items-center gap-1.5 font-medium">
        <Sparkles className="size-4 text-primary" /> Escribir con IA
      </p>
      {paso.fase === "listo" ? (
        <>
          <div aria-label="Lo que propone la IA" className="max-h-60 overflow-y-auto rounded-md bg-muted px-3 py-2 break-words whitespace-pre-wrap">
            {conNegritas(paso.texto)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" autoFocus onClick={() => onUsar(paso.texto, paso.reemplaza)}>
              <Check /> {paso.reemplaza ? "Reemplazar" : "Usar"}
            </Button>
            <Button size="sm" variant="outline" onClick={pedir}>
              <RotateCw /> Otra versión
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPaso({ fase: "escribir" })}>
              <ArrowLeft /> Cambiar
            </Button>
          </div>
        </>
      ) : (
        <>
          <Textarea
            autoFocus
            aria-label="Qué quieres decir"
            placeholder={previo.trim() ? "Escribe a la rápida lo que quieres decir, o déjalo vacío para mejorar lo que ya escribiste" : "Escribe a la rápida lo que quieres decir"}
            value={pedido}
            onChange={(event) => setPedido(event.target.value)}
            onKeyDown={(event) => {
              // Enter redacta; Shift+Enter hace un salto de línea.
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              pedir()
            }}
            // De solo lectura y no deshabilitado: así no pierde el foco (y el panel no se cierra) mientras la IA piensa.
            readOnly={paso.fase === "pensando"}
            aria-busy={paso.fase === "pensando"}
            maxLength={4000}
            rows={2}
            className="max-h-40 min-h-14 resize-none read-only:opacity-60"
          />
          {error && (
            <p role="alert" className="m-0 text-destructive">
              {error}
            </p>
          )}
          <p className="m-0 flex items-center gap-1.5 text-xs text-muted-foreground">
            {paso.fase === "pensando" ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Redactando…
              </>
            ) : mejora ? (
              "Enter mejora lo que ya escribiste · Esc cierra"
            ) : (
              "Enter para redactar · Shift+Enter, salto de línea · Esc cierra"
            )}
          </p>
        </>
      )}
    </div>
  )
}
