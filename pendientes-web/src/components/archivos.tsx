import { useCallback, useEffect, useRef, useState } from "react"
import {
  File,
  FileArchive,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Library,
  Link2,
  LoaderCircle,
  Paperclip,
  X,
} from "lucide-react"
import { cn } from "cn"

import { VisorImagenes } from "@/components/visor-imagenes"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, esNoAutorizado, MAX_ARCHIVO_BYTES, mensajeDeError, type Archivo, type ArchivoEncontrado, type Usuario } from "@/lib/api"
import { abrirArchivo, claseDeArchivo, esMedio, tamanoLegible, traeArchivos, urlDeArchivo, type ClaseDeArchivo } from "@/lib/archivos"

export const ICONOS: Record<ClaseDeArchivo, typeof File> = {
  imagen: FileImage,
  video: FileVideoCamera,
  audio: FileMusic,
  documento: FileText,
  planilla: FileSpreadsheet,
  comprimido: FileArchive,
  otro: File,
}

// Las imágenes que el navegador muestra sin riesgo; las demás (SVG incluido) quedan como archivo.
export const esImagenVisible = (archivo: Pick<Archivo, "tipo">) => /^image\/(png|jpeg|gif|webp)$/.test(archivo.tipo)

// Una imagen adjunta, vista en pequeño; al tocarla se abre completa. Si no se puede cargar, queda como archivo.
export function MiniaturaArchivo({
  credenciales,
  archivo,
  onAbrir,
  className,
}: {
  credenciales: string
  archivo: Archivo
  onAbrir: () => void
  className?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    let vigente = true
    // Pide contraseña, así que se baja con fetch y se muestra desde un blob (que queda guardado para la próxima).
    api
      .urlDeImagen(credenciales, urlDeArchivo(archivo.id))
      .then((blob) => vigente && setUrl(blob))
      .catch(() => vigente && setFallo(true))
    return () => {
      vigente = false
    }
  }, [credenciales, archivo.id])

  if (fallo) return <ChipArchivo archivo={archivo} onAbrir={onAbrir} className={className} />
  return (
    <button
      type="button"
      onClick={onAbrir}
      title={`${archivo.nombre} · ${tamanoLegible(archivo.tamano)}`}
      aria-label={`Abrir la imagen ${archivo.nombre}`}
      className={cn(
        "block overflow-hidden rounded-xl border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !url && "h-40 w-56 animate-pulse",
        className
      )}
    >
      {url && (
        <img
          src={url}
          alt={archivo.nombre}
          onError={() => setFallo(true)}
          className="block max-h-60 w-auto max-w-full object-contain sm:max-w-60"
        />
      )}
    </button>
  )
}

export function ChipArchivo({
  archivo,
  subiendo = false,
  nota,
  onAbrir,
  onQuitar,
  className,
}: {
  archivo: Pick<Archivo, "nombre" | "tipo"> & { tamano?: number }
  subiendo?: boolean
  nota?: string
  onAbrir?: () => void
  onQuitar?: () => void
  className?: string
}) {
  const Icono = ICONOS[claseDeArchivo(archivo.nombre, archivo.tipo)]
  return (
    <span className={cn("inline-flex max-w-full min-w-0 items-center gap-1 rounded-lg border bg-card py-1 pr-1 pl-2 text-xs text-card-foreground", className)}>
      <button
        type="button"
        disabled={!onAbrir}
        onClick={onAbrir}
        title={archivo.tamano === undefined ? archivo.nombre : `${archivo.nombre} · ${tamanoLegible(archivo.tamano)}`}
        className="flex min-w-0 items-center gap-1.5 rounded-sm outline-none enabled:hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {subiendo ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Subiendo" />
        ) : (
          <Icono className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-medium">{archivo.nombre}</span>
        {(archivo.tamano !== undefined || nota) && (
          <span className="shrink-0 text-muted-foreground">
            {[archivo.tamano !== undefined && tamanoLegible(archivo.tamano), nota].filter(Boolean).join(" · ")}
          </span>
        )}
      </button>
      {onQuitar && (
        <button
          type="button"
          aria-label={`Quitar ${archivo.nombre}`}
          onClick={onQuitar}
          className="rounded-sm p-0.5 text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      )}
    </span>
  )
}

// Los otros pendientes donde está el mismo archivo; se abren desde aquí.
function TambienEn({ archivo, onAbrirPendiente }: { archivo: Archivo; onAbrirPendiente?: (id: string) => void }) {
  const otros = archivo.tambien_en ?? []
  if (otros.length === 0) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="-ml-1 text-muted-foreground"
          aria-label={`«${archivo.nombre}» también está en ${otros.length === 1 ? "otro pendiente" : `${otros.length} pendientes más`}`}
        >
          <Link2 /> {otros.length === 1 ? "en 1 más" : `en ${otros.length} más`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-1 p-2">
        <p className="m-0 px-2 pt-1 pb-1.5 text-xs text-muted-foreground">También está en:</p>
        {otros.map((otro) => (
          <button
            key={otro.pendiente_id}
            type="button"
            disabled={!onAbrirPendiente}
            onClick={() => onAbrirPendiente?.(otro.pendiente_id)}
            className="truncate rounded-md px-2 py-1.5 text-left text-sm outline-none enabled:hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            {otro.texto}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

// Lo ya subido a otros pendientes, para usarlo en este sin volver a subirlo (es el mismo archivo: quitarlo de uno no lo
// quita de los demás). Se busca por nombre en el servidor.
function UsarExistente({
  credenciales,
  pendienteId,
  onUsar,
  onError,
}: {
  credenciales: string
  pendienteId: string
  onUsar: (archivo: ArchivoEncontrado) => Promise<void>
  onError: (err: unknown) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState("")
  const [encontrados, setEncontrados] = useState<{ texto: string; lista: ArchivoEncontrado[] } | null>(null)
  const [usando, setUsando] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    const espera = window.setTimeout(() => {
      api.archivos
        .buscar(credenciales, texto)
        .then((lista) => vigente && setEncontrados({ texto, lista }))
        .catch((err) => vigente && onError(err))
    }, texto ? 200 : 0)
    return () => {
      vigente = false
      window.clearTimeout(espera)
    }
  }, [abierto, credenciales, texto, onError])

  // Lo que ya está en este pendiente no se ofrece.
  const lista = (encontrados?.lista ?? []).filter((archivo) => !archivo.usado_en.some((uso) => uso.pendiente_id === pendienteId))
  const buscando = encontrados === null || encontrados.texto !== texto

  async function usar(archivo: ArchivoEncontrado) {
    setUsando(archivo.id)
    try {
      await onUsar(archivo)
      setAbierto(false)
      setTexto("")
    } finally {
      setUsando(null)
    }
  }

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="xs" className="text-muted-foreground">
          <Library /> Usar uno que ya existe
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar por nombre…" value={texto} onValueChange={setTexto} aria-label="Buscar un archivo ya subido" />
          <CommandList className="max-h-80">
            {!buscando && <CommandEmpty>{texto ? `Nada con «${texto}».` : "Todavía no hay archivos en otros pendientes."}</CommandEmpty>}
            {buscando && lista.length === 0 && (
              <div className="flex justify-center py-6">
                <LoaderCircle aria-label="Buscando" className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {lista.length > 0 && (
              <CommandGroup heading="Ya subidos">
                {lista.map((archivo) => {
                  const Icono = ICONOS[claseDeArchivo(archivo.nombre, archivo.tipo)]
                  const lugares = archivo.usado_en.map((uso) => `«${uso.texto}»`).join(", ")
                  return (
                    <CommandItem
                      key={archivo.id}
                      value={archivo.id}
                      disabled={usando !== null}
                      onSelect={() => usar(archivo)}
                      className="items-start"
                    >
                      {usando === archivo.id ? <LoaderCircle className="mt-0.5 animate-spin" /> : <Icono className="mt-0.5" />}
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{archivo.nombre}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {tamanoLegible(archivo.tamano)} · en {lugares}
                        </span>
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// Los archivos del pendiente y los que llegaron por su chat. Se vuelve a pedir cuando cambia `version`.
export function ArchivosPendiente({
  credenciales,
  pendienteId,
  usuario,
  version,
  onCantidad,
  onMedios,
  onAbrirPendiente,
  onSalir,
}: {
  credenciales: string
  pendienteId: string
  usuario: Usuario | null
  version: string
  // Cuántos hay y cuántos son videos, para la tarjeta.
  onCantidad: (cantidad: number, videos: number) => void
  // Sus videos y audios, a los que llevan las marcas de tiempo de la descripción.
  onMedios?: (medios: Archivo[]) => void
  onAbrirPendiente?: (id: string) => void
  onSalir: () => void
}) {
  const [archivos, setArchivos] = useState<Archivo[] | null>(null)
  const [subiendo, setSubiendo] = useState<{ clave: string; nombre: string; tipo: string; tamano: number; avance: number }[]>([])
  // La imagen que se agrandó (con las demás del pendiente en carrusel).
  const [agrandada, setAgrandada] = useState<number | null>(null)
  const [encima, setEncima] = useState(false)
  const [error, setError] = useState("")
  const entrada = useRef<HTMLInputElement>(null)
  const avisarCantidad = useRef(onCantidad)
  const avisarMedios = useRef(onMedios)
  useEffect(() => {
    avisarCantidad.current = onCantidad
    avisarMedios.current = onMedios
  })

  const fallar = useCallback(
    (err: unknown) => {
      if (esNoAutorizado(err)) onSalir()
      else setError(mensajeDeError(err))
    },
    [onSalir]
  )
  const cargarImagen = useCallback((url: string) => api.urlDeImagen(credenciales, url), [credenciales])

  useEffect(() => {
    let vigente = true
    api.archivos
      .listar(credenciales, pendienteId)
      .then((lista) => {
        if (vigente) setArchivos(lista)
      })
      .catch((err) => {
        if (!vigente) return
        if (esNoAutorizado(err)) onSalir()
        else setError(mensajeDeError(err))
      })
    return () => {
      vigente = false
    }
  }, [credenciales, pendienteId, version, onSalir])

  useEffect(() => {
    if (!archivos) return
    avisarCantidad.current(archivos.length, archivos.filter((archivo) => archivo.tipo.startsWith("video/")).length)
    avisarMedios.current?.(archivos.filter((archivo) => esMedio(archivo.tipo)))
  }, [archivos])

  async function subir(lista: FileList | null) {
    // Se copian antes de esperar nada: al limpiar el campo, el navegador vacía la lista.
    for (const archivo of [...(lista ?? [])]) {
      if (archivo.size > MAX_ARCHIVO_BYTES) {
        setError(`«${archivo.name}» pesa más de 500 MB.`)
        continue
      }
      const clave = crypto.randomUUID()
      setSubiendo((actuales) => [...actuales, { clave, nombre: archivo.name, tipo: archivo.type, tamano: archivo.size, avance: 0 }])
      const avanzar = (avance: number) => setSubiendo((actuales) => actuales.map((s) => (s.clave === clave ? { ...s, avance } : s)))
      try {
        const nuevo = await api.archivos.subir(credenciales, pendienteId, archivo, false, avanzar)
        // Si ya estaba (el mismo archivo subido otra vez), no se repite.
        setArchivos((actuales) => [...(actuales ?? []).filter((a) => a.id !== nuevo.id), nuevo])
        setError("")
      } catch (err) {
        fallar(err)
      } finally {
        setSubiendo((actuales) => actuales.filter((s) => s.clave !== clave))
      }
    }
  }

  async function usarExistente(encontrado: ArchivoEncontrado) {
    try {
      const nuevo = await api.archivos.reusar(credenciales, pendienteId, encontrado.id)
      // Viene sin la lista de dónde más está: es donde estaba el elegido.
      setArchivos((actuales) => [...(actuales ?? []).filter((a) => a.id !== nuevo.id), { ...nuevo, tambien_en: encontrado.usado_en }])
      setError("")
    } catch (err) {
      fallar(err)
    }
  }

  async function quitar(archivo: Archivo) {
    try {
      await api.archivos.borrar(credenciales, archivo.id)
      setArchivos((actuales) => (actuales ?? []).filter((a) => a.id !== archivo.id))
      setError("")
    } catch (err) {
      fallar(err)
    }
  }

  const esMio = (archivo: Archivo) =>
    archivo.perfil_id ? archivo.perfil_id === usuario?.perfil_id : usuario?.perfil_id === null && archivo.autor === usuario.nombre
  const imagenes = (archivos ?? []).filter(esImagenVisible).map((archivo) => ({ ...archivo, url: urlDeArchivo(archivo.id) }))

  return (
    <div
      className={cn("-m-1 flex flex-col gap-1.5 rounded-lg p-1 transition-colors", encima && "bg-primary/10 ring-2 ring-primary/40")}
      onDragOver={(event) => {
        if (!traeArchivos(event)) return
        event.preventDefault()
        setEncima(true)
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(event) => {
        if (!traeArchivos(event)) return
        event.preventDefault()
        setEncima(false)
        subir(event.dataTransfer.files)
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {archivos?.map((archivo) => (
          <span key={archivo.id} className="inline-flex max-w-full min-w-0 items-center">
            <ChipArchivo
              archivo={archivo}
              nota={archivo.comentario_id ? "en el chat" : undefined}
              onAbrir={() =>
                esImagenVisible(archivo)
                  ? setAgrandada(imagenes.findIndex((imagen) => imagen.id === archivo.id))
                  : abrirArchivo(credenciales, archivo).catch(fallar)
              }
              onQuitar={!archivo.comentario_id && esMio(archivo) ? () => quitar(archivo) : undefined}
            />
            <TambienEn archivo={archivo} onAbrirPendiente={onAbrirPendiente} />
          </span>
        ))}
        {subiendo.map((archivo) => (
          <ChipArchivo key={archivo.clave} archivo={archivo} subiendo nota={archivo.avance > 0 ? `${Math.round(archivo.avance * 100)} %` : undefined} />
        ))}
        <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => entrada.current?.click()}>
          <Paperclip /> {archivos?.length || subiendo.length ? "Adjuntar" : "Adjuntar archivo (PDF, Word, imágenes, videos…)"}
        </Button>
        <UsarExistente
          credenciales={credenciales}
          pendienteId={pendienteId}
          onUsar={usarExistente}
          onError={fallar}
        />
        <input
          ref={entrada}
          type="file"
          multiple
          hidden
          aria-label="Adjuntar archivos al pendiente"
          onChange={(event) => {
            subir(event.target.files)
            event.target.value = ""
          }}
        />
      </div>
      {error && (
        <p role="alert" className="m-0 text-xs text-destructive">
          {error}
        </p>
      )}
      <VisorImagenes
        imagenes={imagenes}
        cargar={cargarImagen}
        inicial={agrandada}
        etiqueta="Imágenes adjuntas"
        onCerrar={() => setAgrandada(null)}
        onAbrirOriginal={(imagen) => {
          const archivo = imagenes.find((a) => a.id === imagen.id)
          if (archivo) abrirArchivo(credenciales, archivo).catch(fallar)
        }}
      />
    </div>
  )
}
