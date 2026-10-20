import { useEffect, useState } from "react"
import { ExternalLink, ImageOff, LoaderCircle, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from "@/components/ui/carousel"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { api, type Archivo } from "@/lib/api"
import { tamanoLegible, urlDeArchivo } from "@/lib/archivos"

// Una imagen a tamaño completo. Pide contraseña, así que llega como blob (el mismo que ya usó la miniatura).
function ImagenGrande({ credenciales, archivo }: { credenciales: string; archivo: Archivo }) {
  const [url, setUrl] = useState<string | null>(null)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    let vigente = true
    api
      .urlDeImagen(credenciales, urlDeArchivo(archivo.id))
      .then((blob) => vigente && setUrl(blob))
      .catch(() => vigente && setFallo(true))
    return () => {
      vigente = false
    }
  }, [credenciales, archivo.id])

  if (fallo) {
    return (
      <p className="m-0 flex flex-col items-center gap-2 text-sm text-white/70">
        <ImageOff className="size-8" /> No se pudo cargar la imagen.
      </p>
    )
  }
  if (!url) return <LoaderCircle aria-label="Cargando la imagen" className="size-8 animate-spin text-white/70" />
  return <img src={url} alt={archivo.nombre} draggable={false} className="max-h-full max-w-full object-contain select-none" />
}

// Las imágenes de un chat en grande y en carrusel, empezando por la que se tocó: se pasa de una a otra con las flechas
// (en pantalla o del teclado) o deslizando en el celular.
export function VisorImagenes({
  credenciales,
  imagenes,
  inicial,
  onCerrar,
  onAbrirOriginal,
}: {
  credenciales: string
  imagenes: Archivo[]
  // La que se tocó (null: cerrado).
  inicial: number | null
  onCerrar: () => void
  onAbrirOriginal: (archivo: Archivo) => void
}) {
  const [carrusel, setCarrusel] = useState<CarouselApi>()
  const [actual, setActual] = useState(inicial ?? 0)

  useEffect(() => {
    if (!carrusel) return
    const alCambiar = () => setActual(carrusel.selectedScrollSnap())
    alCambiar()
    carrusel.on("select", alCambiar)
    return () => {
      carrusel.off("select", alCambiar)
    }
  }, [carrusel])

  const abierta = inicial !== null && imagenes.length > 0
  const imagen = imagenes[Math.min(actual, imagenes.length - 1)]

  return (
    <Dialog open={abierta} onOpenChange={(siguiente) => !siguiente && onCerrar()}>
      <DialogContent
        showCloseButton={false}
        className="h-[100svh] max-w-none gap-0 rounded-none bg-neutral-950 p-0 text-white ring-0 sm:h-[92svh] sm:max-w-[min(96vw,80rem)] sm:rounded-xl"
      >
        {abierta && (
          // El carrusel envuelve todo el panel: con el foco en cualquier botón, las flechas del teclado pasan de imagen.
          <Carousel
            setApi={setCarrusel}
            opts={{ startIndex: inicial, duration: 18 }}
            className="flex h-full min-h-0 flex-col"
            aria-label="Imágenes del chat"
          >
            <div className="flex items-center gap-3 px-4 pt-3 pb-2">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-sm font-medium text-white">{imagen?.nombre}</DialogTitle>
                <DialogDescription className="text-xs text-white/60">
                  {imagenes.length > 1 && `${actual + 1} de ${imagenes.length} · `}
                  {imagen && tamanoLegible(imagen.tamano)}
                </DialogDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={() => imagen && onAbrirOriginal(imagen)}
              >
                <ExternalLink /> <span className="max-sm:sr-only">Abrir original</span>
              </Button>
              <DialogClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Cerrar" className="text-white hover:bg-white/10 hover:text-white">
                  <X />
                </Button>
              </DialogClose>
            </div>
            <div className="relative min-h-0 flex-1 [&>[data-slot=carousel-content]]:h-full">
              <CarouselContent className="h-full">
                {imagenes.map((archivo, i) => (
                  <CarouselItem
                    key={archivo.id}
                    aria-label={`${i + 1} de ${imagenes.length}`}
                    className="flex h-full items-center justify-center p-2 sm:p-4"
                  >
                    {/* Solo se cargan la que se ve y sus vecinas. */}
                    {Math.abs(i - actual) <= 1 && <ImagenGrande credenciales={credenciales} archivo={archivo} />}
                  </CarouselItem>
                ))}
              </CarouselContent>
              {imagenes.length > 1 && (
                <>
                  <CarouselPrevious
                    aria-label="Imagen anterior"
                    variant="ghost"
                    className="left-2 size-11 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white disabled:opacity-0 sm:left-4 [&_svg]:size-6"
                  />
                  <CarouselNext
                    aria-label="Imagen siguiente"
                    variant="ghost"
                    className="right-2 size-11 bg-white/10 text-white backdrop-blur hover:bg-white/20 hover:text-white disabled:opacity-0 sm:right-4 [&_svg]:size-6"
                  />
                </>
              )}
            </div>
          </Carousel>
        )}
      </DialogContent>
    </Dialog>
  )
}
