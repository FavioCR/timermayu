import { useEffect, useState } from "react"
import { Download, ExternalLink, FileWarning, LoaderCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { esNoAutorizado, mensajeDeError } from "@/lib/api"
import { tamanoLegible } from "@/lib/archivos"
import { notasApi } from "@/lib/notas"

export type RecursoAbierto = { id: string; nombre: string; tipo: string; tamano?: number }

// En el celular el navegador no muestra un PDF dentro de la página (Android lo descarga, iOS solo la primera hoja):
// ahí se abre en su propio visor, en otra pestaña.
const verDentro = () => window.matchMedia("(min-width: 768px) and (pointer: fine)").matches

function descargar(url: string, nombre: string) {
  const enlace = document.createElement("a")
  enlace.href = url
  enlace.download = nombre
  enlace.click()
}

// El visor de un recurso (o de un archivo de una nota): PDF e imágenes se ven aquí mismo; lo demás se descarga.
export function VisorRecurso({
  credenciales,
  recurso,
  onCerrar,
  onNoAutorizado,
}: {
  credenciales: string
  recurso: RecursoAbierto | null
  onCerrar: () => void
  onNoAutorizado: () => void
}) {
  // Cada estado recuerda de qué recurso es: al abrir otro, lo del anterior ya no cuenta.
  const [contenido, setContenido] = useState<{ id: string; url: string; tipo: string } | null>(null)
  const [avance, setAvance] = useState({ id: "", valor: 0 })
  const [fallo, setFallo] = useState({ id: "", mensaje: "" })

  useEffect(() => {
    if (!recurso) return
    let vigente = true
    let url = ""
    const { id } = recurso
    notasApi.recursos
      .bajar(credenciales, id, (valor) => vigente && setAvance({ id, valor }))
      .then((blob) => {
        if (!vigente) return
        url = URL.createObjectURL(blob)
        setContenido({ id, url, tipo: blob.type || recurso.tipo })
      })
      .catch((err) => {
        if (!vigente) return
        if (esNoAutorizado(err)) onNoAutorizado()
        setFallo({ id, mensaje: mensajeDeError(err) })
      })
    return () => {
      vigente = false
      // Un rato después: si se abrió en otra pestaña, esa sigue usándolo.
      if (url) setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
    }
  }, [credenciales, recurso, onNoAutorizado])

  const listo = contenido && recurso && contenido.id === recurso.id ? contenido : null
  const error = fallo.id === recurso?.id ? fallo.mensaje : ""
  const bajado = avance.id === recurso?.id ? avance.valor : 0
  const esPdf = listo?.tipo === "application/pdf"
  const esImagen = listo?.tipo.startsWith("image/") ?? false

  // En otra pestaña, con el visor del navegador; usa lo que ya se bajó.
  function abrirAparte() {
    if (!listo) return
    const pestana = window.open(listo.url, "_blank")
    if (pestana) pestana.opener = null
  }

  return (
    <Dialog open={recurso !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent
        className="flex h-[min(92svh,60rem)] w-[min(76rem,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        aria-describedby={undefined}
      >
        <div className="flex min-h-12 items-center gap-2 border-b py-2 pr-12 pl-4">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-semibold">{recurso?.nombre}</DialogTitle>
            {recurso?.tamano !== undefined && (
              <DialogDescription className="text-xs">{tamanoLegible(recurso.tamano)}</DialogDescription>
            )}
          </div>
          {listo && (esPdf || esImagen) && (
            <Button size="sm" variant="ghost" onClick={abrirAparte}>
              <ExternalLink /> <span className="hidden sm:inline">Otra pestaña</span>
            </Button>
          )}
          {listo && recurso && (
            <Button size="sm" variant="ghost" onClick={() => descargar(listo.url, recurso.nombre)}>
              <Download /> <span className="hidden sm:inline">Descargar</span>
            </Button>
          )}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/40">
          {error ? (
            <p role="alert" className="px-6 text-center text-sm text-destructive">
              {error}
            </p>
          ) : !listo ? (
            <div className="flex w-56 flex-col items-center gap-3 text-sm text-muted-foreground">
              <LoaderCircle className="size-6 animate-spin" />
              <span>Abriendo… {bajado > 0 && `${Math.round(bajado * 100)} %`}</span>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(bajado * 100)}%` }} />
              </div>
            </div>
          ) : esPdf && verDentro() ? (
            <iframe src={listo.url} title={recurso?.nombre} className="size-full border-0 bg-background" />
          ) : esImagen ? (
            <img src={listo.url} alt={recurso?.nombre} className="max-h-full max-w-full object-contain" />
          ) : esPdf ? (
            <div className="flex flex-col items-center gap-3 px-6 text-center text-sm text-muted-foreground">
              <p>En el celular el PDF se abre en el visor del navegador.</p>
              <Button onClick={abrirAparte}>
                <ExternalLink /> Abrir el PDF
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 px-6 text-center text-sm text-muted-foreground">
              <FileWarning className="size-8" />
              <p>Este archivo no se puede mostrar aquí.</p>
              <Button onClick={() => recurso && descargar(listo.url, recurso.nombre)}>
                <Download /> Descargar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
