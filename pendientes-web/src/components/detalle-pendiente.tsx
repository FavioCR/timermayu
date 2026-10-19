import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Lock, Trash2, Users } from "lucide-react"

import type { DocumentoDescripcion } from "@/components/editor-descripcion"
import { PerfilAvatar } from "@/components/perfil-avatar"
import { ProyectoCombobox } from "@/components/proyecto-combobox"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { api, esNoAutorizado, mensajeDeError, type CambiosPendiente, type Estado, type Pendiente, type Perfil, type Proyecto } from "@/lib/api"
import { organizacionDe, type Catalogo } from "@/lib/catalogo"
import { COLUMNAS, NADIE } from "@/lib/estados"

const EditorDescripcion = lazy(() => import("@/components/editor-descripcion"))

// La descripción se guarda sola cuando se deja de escribir este tiempo.
const GUARDAR_DESPUES_MS = 800

const fechaLarga = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" })

type Props = {
  credenciales: string
  pendiente: Pendiente | null
  perfiles: Perfil[]
  catalogo: Catalogo
  onCrearProyecto: (datos: { nombre: string; organizacion_id: string | null }) => Promise<Proyecto | null>
  onCambiar: (id: string, cambios: CambiosPendiente) => Promise<Pendiente | null>
  onBorrar: (pendiente: Pendiente) => void
  onCerrar: () => void
  onSalir: () => void
}

// Página de un pendiente al estilo Notion: propiedades arriba y la descripción con imágenes debajo.
export function DetallePendiente({ pendiente, onCerrar, ...props }: Props) {
  // Mientras el panel se cierra con su animación se sigue mostrando el último pendiente.
  const [mostrado, setMostrado] = useState(pendiente)
  if (pendiente && pendiente !== mostrado) setMostrado(pendiente)

  return (
    <Sheet open={pendiente !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <SheetContent
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
        // Radix enfocaría el título y lo dejaría seleccionado; el foco va al panel y se escribe donde se haga clic.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).focus()
        }}
      >
        {mostrado && <Contenido key={mostrado.id} pendiente={mostrado} {...props} />}
      </SheetContent>
    </Sheet>
  )
}

function Contenido({
  credenciales,
  pendiente,
  perfiles,
  catalogo,
  onCrearProyecto,
  onCambiar,
  onBorrar,
  onSalir,
}: Omit<Props, "pendiente" | "onCerrar"> & { pendiente: Pendiente }) {
  const [inicial, setInicial] = useState<{ bloques: unknown[] | undefined } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [aviso, setAviso] = useState("")
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const porGuardar = useRef<DocumentoDescripcion | null>(null)
  const temporizador = useRef<number | undefined>(undefined)
  const id = pendiente.id

  useEffect(() => {
    let vigente = true
    api
      .detalle(credenciales, id)
      .then((detalle) => {
        if (!vigente) return
        let bloques: unknown[] | undefined
        try {
          bloques = detalle.descripcion ? JSON.parse(detalle.descripcion) : undefined
        } catch {
          bloques = undefined
        }
        setInicial({ bloques })
      })
      .catch((err) => {
        if (!vigente) return
        if (esNoAutorizado(err)) onSalir()
        else setAviso(mensajeDeError(err))
      })
    return () => {
      vigente = false
    }
  }, [credenciales, id, onSalir])

  const guardarDescripcion = useCallback(async () => {
    window.clearTimeout(temporizador.current)
    const documento = porGuardar.current
    if (!documento) return
    porGuardar.current = null
    setGuardando(true)
    const actualizado = await onCambiar(id, { descripcion: JSON.stringify(documento) })
    setGuardando(false)
    setGuardado(Boolean(actualizado))
    setAviso(actualizado ? "" : "No se pudo guardar la descripción. Vuelve a intentarlo.")
  }, [id, onCambiar])

  // Al cerrar el panel o abrir otra tarjeta, lo que quedó sin guardar se guarda en ese momento.
  const guardarAlSalir = useRef(guardarDescripcion)
  useEffect(() => {
    guardarAlSalir.current = guardarDescripcion
  }, [guardarDescripcion])
  useEffect(() => () => void guardarAlSalir.current(), [])

  function alCambiarDescripcion(documento: DocumentoDescripcion) {
    porGuardar.current = documento
    setGuardado(false)
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(guardarDescripcion, GUARDAR_DESPUES_MS)
  }

  async function subirImagen(archivo: File) {
    try {
      const imagen = await api.subirImagen(credenciales, id, archivo)
      setAviso("")
      return imagen.url
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
      const mensaje = mensajeDeError(err)
      setAviso(mensaje)
      throw new Error(mensaje)
    }
  }

  function borrar() {
    // Lo que quedaba por guardar ya no hace falta: el pendiente desaparece.
    window.clearTimeout(temporizador.current)
    porGuardar.current = null
    onBorrar(pendiente)
  }

  function resolverUrl(url: string) {
    return url.startsWith("/api/pendientes/imagenes/") ? api.urlDeImagen(credenciales, url) : Promise.resolve(url)
  }

  function guardarTitulo(valor: string) {
    const limpio = valor.trim()
    if (limpio && limpio !== pendiente.texto) onCambiar(id, { texto: limpio })
  }

  const estadoGuardado = guardando ? "Guardando…" : guardado ? "Guardado" : ""
  const organizacion = organizacionDe(catalogo, pendiente.proyecto_id)
  const privado = organizacion !== null && !organizacion.compartida

  return (
    <>
      <SheetHeader className="gap-1 pr-12">
        <SheetTitle className="sr-only">{pendiente.texto}</SheetTitle>
        <Textarea
          aria-label="Título del pendiente"
          defaultValue={pendiente.texto}
          maxLength={500}
          rows={1}
          className="min-h-0 resize-none rounded-md border-none px-0 py-0 text-xl font-semibold shadow-none focus-visible:ring-0 md:text-xl dark:bg-transparent"
          onKeyDown={(event) => {
            // El título es una sola línea aunque se vea en varias.
            if (event.key === "Enter") {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
          onBlur={(event) => guardarTitulo(event.currentTarget.value.replace(/\s+/g, " "))}
        />
        <SheetDescription>
          Creado el {fechaLarga.format(new Date(pendiente.creado_en))}
          {estadoGuardado && ` · ${estadoGuardado}`}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-6 px-4 pb-6">
        <dl className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Estado</dt>
          <dd>
            <Select value={pendiente.estado} onValueChange={(valor) => onCambiar(id, { estado: valor as Estado })}>
              <SelectTrigger aria-label="Estado" size="sm" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLUMNAS.map((columna) => (
                  <SelectItem key={columna.id} value={columna.id}>
                    <span className="size-2 rounded-full" style={{ backgroundColor: columna.color }} /> {columna.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </dd>

          <dt className="text-muted-foreground">Responsable</dt>
          <dd>
            <Select
              value={pendiente.perfil_id ?? NADIE}
              onValueChange={(valor) => onCambiar(id, { perfil_id: valor === NADIE ? null : valor })}
            >
              <SelectTrigger aria-label="Responsable del pendiente" size="sm" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {perfiles.map((perfil) => (
                  <SelectItem key={perfil.id} value={perfil.id}>
                    <PerfilAvatar perfil={perfil} size="sm" /> {perfil.nombre}
                  </SelectItem>
                ))}
                <SelectItem value={NADIE}>
                  <PerfilAvatar perfil={null} size="sm" /> Sin asignar
                </SelectItem>
              </SelectContent>
            </Select>
          </dd>

          <dt className="text-muted-foreground">Proyecto</dt>
          <dd>
            <ProyectoCombobox
              etiqueta="Proyecto del pendiente"
              valor={pendiente.proyecto_id}
              onCambiar={(proyectoId) => onCambiar(id, { proyecto_id: proyectoId })}
              catalogo={catalogo}
              onCrear={onCrearProyecto}
              className="h-8 w-full sm:w-72"
            />
          </dd>

          <dt className="text-muted-foreground">Lo ve</dt>
          <dd className="flex items-center gap-1.5 text-sm [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
            {privado ? (
              <>
                <Lock /> Solo tú: está en {organizacion.nombre}, que es privada
              </>
            ) : (
              <>
                <Users /> Todo el equipo
              </>
            )}
          </dd>
        </dl>

        <section aria-label="Descripción" className="-mx-4 min-h-64 border-t pt-4">
          {inicial ? (
            <Suspense fallback={<p className="px-4 text-sm text-muted-foreground">Cargando editor…</p>}>
              <EditorDescripcion
                inicial={inicial.bloques as Parameters<typeof EditorDescripcion>[0]["inicial"]}
                oscuro={document.documentElement.classList.contains("dark")}
                onCambio={alCambiarDescripcion}
                subirImagen={subirImagen}
                resolverUrl={resolverUrl}
              />
            </Suspense>
          ) : (
            !aviso && <p className="px-4 text-sm text-muted-foreground">Cargando…</p>
          )}
        </section>

        {aviso && (
          <p role="alert" className="text-sm text-destructive">
            {aviso}
          </p>
        )}

        <div className="flex items-center gap-2 border-t pt-4">
          {confirmarBorrado ? (
            <>
              <span className="text-sm text-muted-foreground">¿Borrar este pendiente y sus imágenes?</span>
              <Button size="sm" variant="destructive" onClick={borrar}>
                Sí, borrar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmarBorrado(false)}>
                No
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmarBorrado(true)}
            >
              <Trash2 /> Borrar pendiente
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
