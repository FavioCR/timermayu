import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { Forward, History, Lock, MessageCircle, MessageSquare, Trash2, Users } from "lucide-react"

import { Aprobacion } from "@/components/aprobacion"
import { ArchivosPendiente } from "@/components/archivos"
import { ChatPendiente } from "@/components/chat-pendiente"
import type { DocumentoDescripcion } from "@/components/editor-descripcion"
import { EtiquetasSelector } from "@/components/etiquetas-selector"
import { HistorialPendiente } from "@/components/historial"
import { PerfilAvatar } from "@/components/perfil-avatar"
import { ProyectoCombobox } from "@/components/proyecto-combobox"
import { TipoSelect } from "@/components/tipo-select"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  api,
  esNoAutorizado,
  mensajeDeError,
  type CambiosPendiente,
  type Estado,
  type Etiqueta,
  type OpcionesRedaccion,
  type Pendiente,
  type Perfil,
  type Proyecto,
  type Usuario,
} from "@/lib/api"
import { enlaceWhatsApp } from "@/lib/actividad"
import { abrirArchivo, PREFIJO_URL_ARCHIVO, tipoPorNombre, urlDeArchivo } from "@/lib/archivos"
import { comprimirImagen } from "@/lib/comprimir-imagen"
import type { Medio } from "@/lib/marcas-de-tiempo"
import { reproducir } from "@/lib/reproductor"
import { involucrados, organizacionDe, type Catalogo } from "@/lib/catalogo"
import { COLUMNAS, NADIE } from "@/lib/estados"

// Lo que el servidor guarda como imagen de la descripción; lo demás va a Archivos.
const TIPOS_DE_IMAGEN = ["image/png", "image/jpeg", "image/gif", "image/webp"]
const EditorDescripcion = lazy(() => import("@/components/editor-descripcion"))

// La descripción se guarda sola cuando se deja de escribir este tiempo.
const GUARDAR_DESPUES_MS = 800

const fechaLarga = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" })

type Props = {
  credenciales: string
  pendiente: Pendiente | null
  usuario: Usuario | null
  perfiles: Perfil[]
  catalogo: Catalogo
  etiquetas: Etiqueta[]
  onCrearProyecto: (datos: { nombre: string; organizacion_id: string | null }) => Promise<Proyecto | null>
  onCrearEtiqueta: (nombre: string) => Promise<Etiqueta | null>
  onBorrarEtiqueta: (etiqueta: Etiqueta) => void
  onCambiar: (id: string, cambios: CambiosPendiente) => Promise<Pendiente | null>
  onCantidadComentarios: (id: string, cantidad: number) => void
  onCantidadArchivos: (id: string, cantidad: number, videos: number) => void
  onPasar: (pendiente: Pendiente) => void
  // Abre otro pendiente (uno donde también está un archivo de este).
  onAbrirPendiente: (id: string) => void
  onAprobar: (id: string, aprueba: boolean) => void
  onBorrar: (pendiente: Pendiente) => void
  onCerrar: () => void
  onSalir: () => void
  // Cambia (>0) cuando hay que mostrar el chat con el campo listo para escribir (desde el recordatorio de evidencia).
  enfocarChat?: number
}

// Página de un pendiente al estilo Notion: propiedades arriba y la descripción con imágenes debajo;
// al costado (debajo en pantallas angostas), su chat y su historial.
export function DetallePendiente({ pendiente, onCerrar, ...props }: Props) {
  // Mientras el panel se cierra con su animación se sigue mostrando el último pendiente.
  const [mostrado, setMostrado] = useState(pendiente)
  if (pendiente && pendiente !== mostrado) setMostrado(pendiente)

  return (
    <Sheet open={pendiente !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <SheetContent
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl lg:overflow-hidden data-[side=right]:lg:max-w-5xl"
        // Radix enfocaría el título y lo dejaría seleccionado; el foco va al panel y se escribe donde se haga clic (o al
        // chat, si se abrió para escribir ahí).
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (!props.enfocarChat) (event.currentTarget as HTMLElement).focus()
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
  usuario,
  perfiles,
  catalogo,
  etiquetas,
  onCrearProyecto,
  onCrearEtiqueta,
  onBorrarEtiqueta,
  onCambiar,
  onCantidadComentarios,
  onCantidadArchivos,
  onPasar,
  onAbrirPendiente,
  onAprobar,
  onBorrar,
  onSalir,
  enfocarChat = 0,
}: Omit<Props, "pendiente" | "onCerrar"> & { pendiente: Pendiente }) {
  const [pestana, setPestana] = useState("chat")
  // Un pedido nuevo de escribir en el chat lo muestra aunque estuviera viendo el historial.
  const [pedidoDeChat, setPedidoDeChat] = useState(enfocarChat)
  if (enfocarChat !== pedidoDeChat) {
    setPedidoDeChat(enfocarChat)
    if (enfocarChat) setPestana("chat")
  }
  // `version` cambia cuando llega una descripción nueva de otra persona: el editor se vuelve a montar con ella.
  const [inicial, setInicial] = useState<{ bloques: unknown[] | undefined; version: number } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guardado, setGuardado] = useState(false)
  const [aviso, setAviso] = useState("")
  // Los videos y audios del pendiente abierto (los avisa la lista de archivos), para las marcas de tiempo.
  const [mediosDe, setMediosDe] = useState<{ id: string; lista: Medio[] }>({ id: "", lista: [] })
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const porGuardar = useRef<DocumentoDescripcion | null>(null)
  const temporizador = useRef<number | undefined>(undefined)
  // La última descripción que se cargó o se guardó desde aquí, para saber si la del servidor es de otra persona.
  const descripcionConocida = useRef<string | null>(null)
  const seccionDescripcion = useRef<HTMLElement>(null)
  const id = pendiente.id

  const aplicarDescripcion = useCallback((descripcion: string | null) => {
    descripcionConocida.current = descripcion
    let bloques: unknown[] | undefined
    try {
      bloques = descripcion ? JSON.parse(descripcion) : undefined
    } catch {
      bloques = undefined
    }
    setInicial((actual) => ({ bloques, version: (actual?.version ?? 0) + 1 }))
  }, [])

  useEffect(() => {
    let vigente = true
    api
      .detalle(credenciales, id)
      .then((detalle) => {
        if (vigente) aplicarDescripcion(detalle.descripcion)
      })
      .catch((err) => {
        if (!vigente) return
        if (esNoAutorizado(err)) onSalir()
        else setAviso(mensajeDeError(err))
      })
    return () => {
      vigente = false
    }
  }, [credenciales, id, onSalir, aplicarDescripcion])

  // Si el pendiente cambió (otra persona lo editó y el tablero se puso al día), trae la descripción otra vez. Solo la
  // reemplaza si es distinta y aquí no se está escribiendo: nada sin guardar y el cursor fuera del editor (y de su /ia).
  const actualizadoVisto = useRef(pendiente.actualizado_en)
  useEffect(() => {
    if (actualizadoVisto.current === pendiente.actualizado_en) return
    actualizadoVisto.current = pendiente.actualizado_en
    const escribiendo = () =>
      porGuardar.current !== null ||
      Boolean(seccionDescripcion.current?.contains(document.activeElement) || document.activeElement?.closest("[data-ia-descripcion]"))
    if (escribiendo()) return
    let vigente = true
    api
      .detalle(credenciales, id)
      .then((detalle) => {
        if (vigente && detalle.descripcion !== descripcionConocida.current && !escribiendo()) aplicarDescripcion(detalle.descripcion)
      })
      .catch(() => {
        // La próxima vez que cambie se vuelve a intentar.
      })
    return () => {
      vigente = false
    }
  }, [credenciales, id, pendiente.actualizado_en, aplicarDescripcion])

  const guardarDescripcion = useCallback(async () => {
    window.clearTimeout(temporizador.current)
    const documento = porGuardar.current
    if (!documento) return
    porGuardar.current = null
    setGuardando(true)
    const descripcion = JSON.stringify(documento)
    descripcionConocida.current = descripcion
    const actualizado = await onCambiar(id, { descripcion })
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

  // Las imágenes quedan como imagen de la descripción (achicadas a WebP); lo demás se sube a Archivos y la línea lo enlaza.
  async function subirArchivo(archivo: File) {
    try {
      const url = TIPOS_DE_IMAGEN.includes(archivo.type)
        ? (await api.subirImagen(credenciales, id, await comprimirImagen(archivo))).url
        : urlDeArchivo((await api.archivos.subir(credenciales, id, archivo)).id)
      setAviso("")
      return url
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
    const conContrasena = url.startsWith("/api/pendientes/imagenes/") || url.startsWith(PREFIJO_URL_ARCHIVO)
    return conContrasena ? api.urlDeImagen(credenciales, url) : Promise.resolve(url)
  }

  // Lo que pide /ia en la descripción.
  async function redactarDescripcion(borrador: string, opciones?: OpcionesRedaccion) {
    try {
      return await api.ia.redactar(credenciales, id, "descripcion", borrador, opciones)
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
      throw err
    }
  }

  function abrirDeDescripcion(url: string, nombre: string) {
    if (url.startsWith(PREFIJO_URL_ARCHIVO)) {
      abrirArchivo(credenciales, { id: url.slice(PREFIJO_URL_ARCHIVO.length), nombre, tipo: tipoPorNombre(nombre) }).catch((err) => {
        if (esNoAutorizado(err)) onSalir()
        else setAviso(mensajeDeError(err))
      })
    } else if (/^https?:\/\//.test(url)) {
      window.open(url, "_blank", "noopener,noreferrer")
    }
  }

  function guardarTitulo(valor: string) {
    const limpio = valor.trim()
    if (limpio && limpio !== pendiente.texto) onCambiar(id, { texto: limpio })
  }

  const estadoGuardado = guardando ? "Guardando…" : guardado ? "Guardado" : ""
  const organizacion = organizacionDe(catalogo, pendiente.proyecto_id)
  const privado = organizacion !== null && !organizacion.compartida
  const perfilesPorId = new Map(perfiles.map((perfil) => [perfil.id, perfil]))
  const asignado = pendiente.perfil_id ? perfilesPorId.get(pendiente.perfil_id) : undefined
  const creador = pendiente.creado_por ? perfilesPorId.get(pendiente.creado_por) : undefined
  const proyecto = catalogo.proyectos.find((p) => p.id === pendiente.proyecto_id)
  const etiquetaProyecto = proyecto ? (organizacion ? `${organizacion.nombre} › ${proyecto.nombre}` : proyecto.nombre) : null

  return (
    <div className="flex flex-col lg:h-full lg:flex-row">
      <div className="min-w-0 flex-1 lg:overflow-y-auto">
      <SheetHeader className="gap-1 pr-12 lg:pr-4">
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
          {creador && ` por ${creador.nombre}`}
          {estadoGuardado && ` · ${estadoGuardado}`}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-6 px-4 pb-6">
        <dl className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Estado</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Select value={pendiente.estado} onValueChange={(valor) => onCambiar(id, { estado: valor as Estado })}>
              <SelectTrigger aria-label="Estado" size="sm" className="w-full sm:w-64">
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
            {/* Terminada una parte (el backend, por ejemplo), el mismo pendiente pasa a quien sigue. */}
            {pendiente.estado === "hecho" && (
              <Button variant="outline" size="sm" onClick={() => onPasar(pendiente)}>
                <Forward /> Pasar a otra persona
              </Button>
            )}
          </dd>

          {pendiente.estado === "hecho" && (
            <>
              <dt className="text-muted-foreground">Aprobación</dt>
              <dd>
                <Aprobacion
                  pendiente={pendiente}
                  perfilesPorId={perfilesPorId}
                  yo={usuario?.perfil_id ?? null}
                  onAprobar={(aprueba) => onAprobar(id, aprueba)}
                />
              </dd>
            </>
          )}

          <dt className="text-muted-foreground">Tipo</dt>
          <dd>
            <TipoSelect
              etiqueta="Tipo del pendiente"
              valor={pendiente.tipo}
              onCambiar={(tipo) => onCambiar(id, { tipo })}
              className="w-full sm:w-64"
            />
          </dd>

          <dt className="text-muted-foreground">Responsable</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Select
              value={pendiente.perfil_id ?? NADIE}
              onValueChange={(valor) => onCambiar(id, { perfil_id: valor === NADIE ? null : valor })}
            >
              <SelectTrigger aria-label="Responsable del pendiente" size="sm" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {involucrados(perfiles, organizacion, pendiente.perfil_id).map((perfil) => (
                  <SelectItem key={perfil.id} value={perfil.id}>
                    <PerfilAvatar perfil={perfil} size="sm" /> {perfil.nombre}
                  </SelectItem>
                ))}
                <SelectItem value={NADIE}>
                  <PerfilAvatar perfil={null} size="sm" /> Sin asignar
                </SelectItem>
              </SelectContent>
            </Select>
            {asignado && asignado.id !== usuario?.perfil_id && (
              <Button asChild variant="outline" size="sm" title={asignado.telefono ? undefined : `${asignado.nombre} no tiene teléfono guardado: elegirás el chat en WhatsApp`}>
                <a
                  href={enlaceWhatsApp({
                    perfil: asignado,
                    pendiente,
                    proyecto: etiquetaProyecto,
                    quien: usuario?.perfil_id ? usuario.nombre : null,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle /> Avisar por WhatsApp
                </a>
              </Button>
            )}
          </dd>

          <dt className="text-muted-foreground">Proyecto</dt>
          <dd>
            <ProyectoCombobox
              etiqueta="Proyecto del pendiente"
              valor={pendiente.proyecto_id}
              onCambiar={(proyectoId) => onCambiar(id, { proyecto_id: proyectoId })}
              catalogo={catalogo}
              onCrear={onCrearProyecto}
              className="h-8 w-full sm:w-80"
            />
          </dd>

          <dt className="text-muted-foreground">Etiquetas</dt>
          <dd className="min-w-0">
            <EtiquetasSelector
              etiquetas={etiquetas}
              seleccionadas={pendiente.etiquetas}
              onCambiar={(ids) => onCambiar(id, { etiquetas: ids })}
              onCrear={onCrearEtiqueta}
              onBorrar={onBorrarEtiqueta}
              className="w-full sm:w-80"
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

          <dt className="self-start pt-1.5 text-muted-foreground">Archivos</dt>
          <dd className="min-w-0">
            <ArchivosPendiente
              credenciales={credenciales}
              pendienteId={id}
              usuario={usuario}
              version={`${pendiente.actualizado_en}:${pendiente.num_comentarios}:${pendiente.num_archivos}`}
              onCantidad={(cantidad, videos) => onCantidadArchivos(id, cantidad, videos)}
              onMedios={(lista) => setMediosDe({ id, lista })}
              onAbrirPendiente={onAbrirPendiente}
              onSalir={onSalir}
            />
          </dd>
        </dl>

        <section ref={seccionDescripcion} aria-label="Descripción" className="-mx-4 min-h-64 border-t pt-4">
          {inicial ? (
            <Suspense fallback={<p className="px-4 text-sm text-muted-foreground">Cargando editor…</p>}>
              <EditorDescripcion
                key={inicial.version}
                inicial={inicial.bloques as Parameters<typeof EditorDescripcion>[0]["inicial"]}
                oscuro={document.documentElement.classList.contains("dark")}
                onCambio={alCambiarDescripcion}
                subirArchivo={subirArchivo}
                resolverUrl={resolverUrl}
                abrirArchivo={abrirDeDescripcion}
                perfiles={perfiles}
                yo={usuario?.perfil_id ?? null}
                redactar={redactarDescripcion}
                medios={mediosDe.id === id ? mediosDe.lista : undefined}
                onReproducir={(medio, desde, hasta) => reproducir({ credenciales, archivo: medio, desde, hasta })}
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
      </div>

      <aside aria-label="Chat e historial" className="flex flex-col border-t lg:h-full lg:w-96 lg:shrink-0 lg:border-t-0 lg:border-l">
        <Tabs value={pestana} onValueChange={setPestana} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="flex h-14 shrink-0 items-center border-b px-4 lg:pr-12">
            <TabsList>
              <TabsTrigger value="chat" className="px-3">
                <MessageSquare /> Chat
                {pendiente.num_comentarios > 0 && <span className="text-xs tabular-nums text-muted-foreground">{pendiente.num_comentarios}</span>}
              </TabsTrigger>
              <TabsTrigger value="historial" className="px-3">
                <History /> Historial
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="chat" className="flex min-h-0 flex-col">
            <ChatPendiente
              credenciales={credenciales}
              pendienteId={id}
              usuario={usuario}
              perfilesPorId={perfilesPorId}
              onCantidad={(cantidad) => onCantidadComentarios(id, cantidad)}
              onSalir={onSalir}
              enfocar={enfocarChat}
            />
          </TabsContent>
          <TabsContent value="historial" className="min-h-0 overflow-y-auto p-4">
            <HistorialPendiente
              credenciales={credenciales}
              pendienteId={id}
              version={`${pendiente.actualizado_en}:${pendiente.num_comentarios}:${pendiente.num_archivos}`}
              yo={usuario?.perfil_id ?? null}
              onSalir={onSalir}
            />
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  )
}
