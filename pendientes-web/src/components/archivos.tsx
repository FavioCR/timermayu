import { useEffect, useRef, useState } from "react"
import { File, FileArchive, FileImage, FileSpreadsheet, FileText, LoaderCircle, Paperclip, X } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { api, esNoAutorizado, MAX_IMAGEN_BYTES, mensajeDeError, type Archivo, type Usuario } from "@/lib/api"
import { abrirArchivo, claseDeArchivo, tamanoLegible, traeArchivos, type ClaseDeArchivo } from "@/lib/archivos"

const ICONOS: Record<ClaseDeArchivo, typeof File> = {
  imagen: FileImage,
  documento: FileText,
  planilla: FileSpreadsheet,
  comprimido: FileArchive,
  otro: File,
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

// Los archivos del pendiente y los que llegaron por su chat. Se vuelve a pedir cuando cambia `version`.
export function ArchivosPendiente({
  credenciales,
  pendienteId,
  usuario,
  version,
  onCantidad,
  onSalir,
}: {
  credenciales: string
  pendienteId: string
  usuario: Usuario | null
  version: string
  onCantidad: (cantidad: number) => void
  onSalir: () => void
}) {
  const [archivos, setArchivos] = useState<Archivo[] | null>(null)
  const [subiendo, setSubiendo] = useState<{ clave: string; nombre: string; tipo: string; tamano: number }[]>([])
  const [encima, setEncima] = useState(false)
  const [error, setError] = useState("")
  const entrada = useRef<HTMLInputElement>(null)
  const avisarCantidad = useRef(onCantidad)
  useEffect(() => {
    avisarCantidad.current = onCantidad
  })

  const fallar = (err: unknown) => {
    if (esNoAutorizado(err)) onSalir()
    else setError(mensajeDeError(err))
  }

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
    if (archivos) avisarCantidad.current(archivos.length)
  }, [archivos])

  async function subir(lista: FileList | null) {
    // Se copian antes de esperar nada: al limpiar el campo, el navegador vacía la lista.
    for (const archivo of [...(lista ?? [])]) {
      if (archivo.size > MAX_IMAGEN_BYTES) {
        setError(`«${archivo.name}» pesa más de 10 MB.`)
        continue
      }
      const clave = crypto.randomUUID()
      setSubiendo((actuales) => [...actuales, { clave, nombre: archivo.name, tipo: archivo.type, tamano: archivo.size }])
      try {
        const nuevo = await api.archivos.subir(credenciales, pendienteId, archivo)
        setArchivos((actuales) => [...(actuales ?? []), nuevo])
        setError("")
      } catch (err) {
        fallar(err)
      } finally {
        setSubiendo((actuales) => actuales.filter((s) => s.clave !== clave))
      }
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
          <ChipArchivo
            key={archivo.id}
            archivo={archivo}
            nota={archivo.comentario_id ? "en el chat" : undefined}
            onAbrir={() => abrirArchivo(credenciales, archivo).catch(fallar)}
            onQuitar={!archivo.comentario_id && esMio(archivo) ? () => quitar(archivo) : undefined}
          />
        ))}
        {subiendo.map((archivo) => (
          <ChipArchivo key={archivo.clave} archivo={archivo} subiendo />
        ))}
        <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => entrada.current?.click()}>
          <Paperclip /> {archivos?.length || subiendo.length ? "Adjuntar" : "Adjuntar archivo (PDF, Word, imágenes…)"}
        </Button>
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
    </div>
  )
}
