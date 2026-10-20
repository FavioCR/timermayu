import { lazy, Suspense, useEffect, useRef, useState } from "react"
import { Check, CloudOff, LoaderCircle } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { api, ApiError, esNoAutorizado, mensajeDeError, type OpcionesRedaccion } from "@/lib/api"
import { haceCuanto } from "@/lib/actividad"
import { tipoPorNombre } from "@/lib/archivos"
import { comprimirImagen } from "@/lib/comprimir-imagen"
import { notasApi, PREFIJO_IMAGEN_NOTA, PREFIJO_RECURSO, urlDeRecurso, type Curso, type Nota, type Recurso } from "@/lib/notas"
import type { RecursoAbierto } from "@/components/notas/visor-recurso"

const EditorDescripcion = lazy(() => import("@/components/editor-descripcion"))

const TIPOS_DE_IMAGEN = ["image/png", "image/jpeg", "image/gif", "image/webp"]
// Se guarda solo, un momento después de dejar de escribir.
const GUARDAR_DESPUES_MS = 700
const REINTENTAR_MS = 5000

type Estado = "guardado" | "pendiente" | "guardando" | "error"
type Cambios = { titulo?: string; contenido?: string }

// Hay algo sin guardar en alguna nota: al cerrar la pestaña, el navegador pregunta antes.
let sinGuardar = 0
window.addEventListener("beforeunload", (event) => {
  if (sinGuardar > 0) event.preventDefault()
})

export function EstadoGuardado({ estado, editada }: { estado: Estado; editada: string }) {
  if (estado === "error") {
    return (
      <span role="status" className="flex items-center gap-1 text-destructive">
        <CloudOff className="size-3.5" /> Sin guardar: reintentando…
      </span>
    )
  }
  if (estado === "guardando" || estado === "pendiente") {
    return (
      <span role="status" className="flex items-center gap-1">
        <LoaderCircle className="size-3.5 animate-spin" /> Guardando…
      </span>
    )
  }
  return (
    <span role="status" className="flex items-center gap-1" title={new Date(editada).toLocaleString("es")}>
      <Check className="size-3.5" /> Guardado · editada {haceCuanto(editada)}
    </span>
  )
}

// Una nota: título grande y el editor (BlockNote, el mismo de las descripciones) con imágenes pegadas, archivos que
// quedan como recursos del curso y /ia. Todo se guarda solo.
export function VistaNota({
  credenciales,
  nota,
  curso,
  oscuro,
  onCambio,
  onEstado,
  onRecurso,
  onAbrir,
  onNoAutorizado,
}: {
  credenciales: string
  nota: Nota
  curso: Curso
  oscuro: boolean
  // El título cambia en la barra lateral mientras se escribe; lo guardado trae la fecha nueva.
  onCambio: (nota: Pick<Nota, "id"> & Partial<Nota>) => void
  onEstado: (estado: Estado) => void
  onRecurso: (recurso: Recurso) => void
  onAbrir: (recurso: RecursoAbierto) => void
  onNoAutorizado: () => void
}) {
  const { id } = nota
  const [inicial, setInicial] = useState<{ bloques: unknown[] | undefined } | null>(null)
  const [error, setError] = useState("")
  const [aviso, setAviso] = useState("")
  const [titulo, setTitulo] = useState(nota.titulo)
  const campoTitulo = useRef<HTMLTextAreaElement>(null)
  const porGuardar = useRef<Cambios | null>(null)
  const temporizador = useRef<number | undefined>(undefined)
  // Los guardados van en fila: uno viejo no puede llegar después de uno nuevo.
  const fila = useRef<Promise<void>>(Promise.resolve())
  const estado = useRef<Estado>("guardado")
  const avisos = useRef({ onCambio, onEstado, onNoAutorizado })
  avisos.current = { onCambio, onEstado, onNoAutorizado }

  function ponerEstado(nuevo: Estado) {
    const antes = estado.current !== "guardado"
    estado.current = nuevo
    sinGuardar += (nuevo !== "guardado" ? 1 : 0) - (antes ? 1 : 0)
    avisos.current.onEstado(nuevo)
  }

  function guardar() {
    window.clearTimeout(temporizador.current)
    fila.current = fila.current.then(async () => {
      const cambios = porGuardar.current
      if (!cambios) return
      porGuardar.current = null
      ponerEstado("guardando")
      try {
        const guardada = await notasApi.notas.actualizar(credenciales, id, cambios)
        avisos.current.onCambio(guardada)
        ponerEstado(porGuardar.current ? "pendiente" : "guardado")
      } catch (err) {
        if (esNoAutorizado(err)) {
          ponerEstado("guardado")
          return avisos.current.onNoAutorizado()
        }
        // Si la nota ya no existe no hay nada que reintentar.
        if (err instanceof ApiError && err.status === 404) {
          ponerEstado("guardado")
          return setError(mensajeDeError(err))
        }
        // Lo que se escribió mientras tanto manda sobre lo que no se pudo guardar.
        const nuevos: Cambios | null = porGuardar.current
        porGuardar.current = { ...cambios, ...(nuevos ?? {}) }
        ponerEstado("error")
        temporizador.current = window.setTimeout(guardar, REINTENTAR_MS)
      }
    })
  }

  function programar(cambios: Cambios) {
    porGuardar.current = { ...porGuardar.current, ...cambios }
    if (estado.current === "guardado") ponerEstado("pendiente")
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(guardar, GUARDAR_DESPUES_MS)
  }

  useEffect(() => {
    let vigente = true
    notasApi.notas
      .detalle(credenciales, id)
      .then((detalle) => {
        if (!vigente) return
        setInicial({ bloques: detalle.contenido ? JSON.parse(detalle.contenido) : undefined })
        // Una nota nueva empieza por el título.
        if (!detalle.titulo && !detalle.contenido) campoTitulo.current?.focus()
      })
      .catch((err) => {
        if (!vigente) return
        if (esNoAutorizado(err)) avisos.current.onNoAutorizado()
        else setError(mensajeDeError(err))
      })
    return () => {
      vigente = false
      // Al cambiar de nota (o salir), lo que faltaba se guarda ya.
      guardar()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir otra nota
  }, [credenciales, id])

  // El título crece con el texto, como en Notion.
  useEffect(() => {
    const campo = campoTitulo.current
    if (!campo) return
    campo.style.height = "auto"
    campo.style.height = `${campo.scrollHeight}px`
  }, [titulo])

  function cambiarTitulo(valor: string) {
    const limpio = valor.replace(/\n/g, " ")
    setTitulo(limpio)
    avisos.current.onCambio({ id, titulo: limpio.trim() })
    programar({ titulo: limpio })
  }

  // Las imágenes quedan en la nota (achicadas a WebP); lo demás se sube a los recursos del curso y la línea lo enlaza.
  async function subirArchivo(archivo: File) {
    try {
      setAviso("")
      if (TIPOS_DE_IMAGEN.includes(archivo.type)) {
        return (await notasApi.notas.subirImagen(credenciales, id, await comprimirImagen(archivo))).url
      }
      const recurso = await notasApi.recursos.subir(credenciales, curso.id, archivo)
      onRecurso(recurso)
      return urlDeRecurso(recurso.id)
    } catch (err) {
      if (esNoAutorizado(err)) onNoAutorizado()
      const mensaje = mensajeDeError(err)
      setAviso(mensaje)
      throw new Error(mensaje)
    }
  }

  function resolverUrl(url: string) {
    return url.startsWith(PREFIJO_IMAGEN_NOTA) ? api.urlDeImagen(credenciales, url) : Promise.resolve(url)
  }

  function abrirArchivo(url: string, nombre: string) {
    if (url.startsWith(PREFIJO_RECURSO)) onAbrir({ id: url.slice(PREFIJO_RECURSO.length), nombre, tipo: tipoPorNombre(nombre) })
    else if (/^https?:\/\//.test(url)) window.open(url, "_blank", "noopener,noreferrer")
  }

  async function redactar(borrador: string, opciones?: OpcionesRedaccion) {
    try {
      return await notasApi.notas.redactar(credenciales, id, borrador, opciones)
    } catch (err) {
      if (esNoAutorizado(err)) onNoAutorizado()
      throw err
    }
  }

  if (error) {
    return (
      <p role="alert" className="mx-auto max-w-3xl px-6 py-16 text-center text-sm text-muted-foreground">
        {error}
      </p>
    )
  }

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col pt-8 pb-32 md:pt-14">
      <div className="px-6 md:px-[54px]">
        <textarea
          ref={campoTitulo}
          aria-label="Título de la nota"
          placeholder="Sin título"
          rows={1}
          value={titulo}
          maxLength={200}
          onChange={(event) => cambiarTitulo(event.target.value)}
          onKeyDown={(event) => {
            // Enter pasa al texto de la nota.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            event.preventDefault()
            document.querySelector<HTMLElement>("[data-nota] .bn-editor")?.focus()
          }}
          className="w-full resize-none overflow-hidden bg-transparent text-3xl leading-tight font-bold tracking-tight outline-none placeholder:text-muted-foreground/50 md:text-4xl"
        />
        {aviso && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {aviso}
          </p>
        )}
      </div>
      <section data-nota aria-label="Contenido de la nota" className="mt-4 min-h-[50svh]">
        {inicial ? (
          <Suspense fallback={<CargandoNota />}>
            <EditorDescripcion
              key={id}
              inicial={inicial.bloques as Parameters<typeof EditorDescripcion>[0]["inicial"]}
              oscuro={oscuro}
              onCambio={(documento) => programar({ contenido: JSON.stringify(documento) })}
              subirArchivo={subirArchivo}
              resolverUrl={resolverUrl}
              abrirArchivo={abrirArchivo}
              redactar={redactar}
              pista="Escribe, / para bloques (/ia para escribir con IA), o pega imágenes y PDFs"
            />
          </Suspense>
        ) : (
          <CargandoNota />
        )}
      </section>
    </article>
  )
}

function CargandoNota() {
  return (
    <div className="flex flex-col gap-3 px-6 md:px-[54px]">
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-9/12" />
      <Skeleton className="h-4 w-10/12" />
    </div>
  )
}
