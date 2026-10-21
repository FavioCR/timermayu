import { useEffect, useState } from "react"
import { Download, ExternalLink, FileWarning, LoaderCircle, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { api, mensajeDeError } from "@/lib/api"
import { tamanoLegible } from "@/lib/archivos"
import { dejarDeReproducir, useReproduccion } from "@/lib/reproductor"

const claseDeBoton = "text-white hover:bg-white/10 hover:text-white"

// Videos y audios se ven aquí mismo sin bajarlos enteros: el <video> pide por partes un enlace firmado (no puede mandar la
// contraseña), así que empieza enseguida y se puede adelantar. Si el navegador no sabe reproducirlo, queda para bajar.
export function Reproductor() {
  const reproduccion = useReproduccion()
  const archivo = reproduccion?.archivo ?? null
  // Cada estado recuerda de qué archivo es: al abrir otro, lo del anterior ya no cuenta.
  const [enlace, setEnlace] = useState({ id: "", url: "" })
  const [fallo, setFallo] = useState({ id: "", mensaje: "" })

  useEffect(() => {
    if (!reproduccion) return
    let vigente = true
    const { id } = reproduccion.archivo
    api.archivos
      .enlace(reproduccion.credenciales, id)
      .then((url) => vigente && setEnlace({ id, url }))
      .catch((err) => vigente && setFallo({ id, mensaje: mensajeDeError(err) }))
    return () => {
      vigente = false
    }
  }, [reproduccion])

  const url = archivo && enlace.id === archivo.id ? enlace.url : ""
  const error = archivo && fallo.id === archivo.id ? fallo.mensaje : ""
  const esAudio = archivo?.tipo.startsWith("audio/") ?? false
  const noSeReproduce = (id: string) => setFallo({ id, mensaje: "Este navegador no puede reproducir este archivo. Descárgalo para verlo." })

  return (
    <Dialog open={archivo !== null} onOpenChange={(abierto) => !abierto && dejarDeReproducir()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100svh] max-w-none flex-col gap-0 rounded-none bg-neutral-950 p-0 text-white ring-0 sm:h-auto sm:max-h-[92svh] sm:max-w-[min(96vw,72rem)] sm:rounded-xl"
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-medium text-white">{archivo?.nombre}</DialogTitle>
            <DialogDescription className="text-xs text-white/60">
              {archivo?.tamano !== undefined ? tamanoLegible(archivo.tamano) : esAudio ? "Audio" : "Video"}
            </DialogDescription>
          </div>
          {url && (
            <>
              <Button asChild variant="ghost" size="sm" className={claseDeBoton}>
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink /> <span className="max-sm:sr-only">Otra pestaña</span>
                </a>
              </Button>
              <Button asChild variant="ghost" size="sm" className={claseDeBoton}>
                <a href={`${url}&descargar=1`} download={archivo?.nombre}>
                  <Download /> <span className="max-sm:sr-only">Descargar</span>
                </a>
              </Button>
            </>
          )}
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Cerrar" className={claseDeBoton}>
              <X />
            </Button>
          </DialogClose>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-2 sm:min-h-72 sm:p-4">
          {error ? (
            <p role="alert" className="m-0 flex flex-col items-center gap-2 px-6 text-center text-sm text-white/70">
              <FileWarning className="size-8" /> {error}
            </p>
          ) : !url || !archivo ? (
            <LoaderCircle aria-label="Cargando" className="size-8 animate-spin text-white/70" />
          ) : esAudio ? (
            <audio key={url} src={url} controls autoPlay className="w-full max-w-xl" onError={() => noSeReproduce(archivo.id)} />
          ) : (
            <video
              key={url}
              src={url}
              controls
              autoPlay
              playsInline
              preload="metadata"
              aria-label={archivo.nombre}
              className="max-h-[calc(100svh-5rem)] w-full rounded-md bg-black sm:max-h-[calc(92svh-6rem)]"
              onError={() => noSeReproduce(archivo.id)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
