import { useEffect, useRef, useState, type FormEvent } from "react"
import { ArrowLeft, ImagePlus, LoaderCircle, Settings, Sparkles, X } from "lucide-react"
import { cn } from "cn"

import { EtiquetasSelector } from "@/components/etiquetas-selector"
import { PerfilAvatar } from "@/components/perfil-avatar"
import { ProyectoCombobox } from "@/components/proyecto-combobox"
import { TipoSelect } from "@/components/tipo-select"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  api,
  esNoAutorizado,
  mensajeDeError,
  type AjustesIA,
  type Estado,
  type Etiqueta,
  type Pendiente,
  type Perfil,
  type Proyecto,
  type Sugerencia,
} from "@/lib/api"
import { traeArchivos } from "@/lib/archivos"
import { involucrados, organizacionDe, type Catalogo } from "@/lib/catalogo"
import { imagenParaIA } from "@/lib/comprimir-imagen"
import { COLUMNAS, NADIE } from "@/lib/estados"

type Propuesta = Sugerencia & { clave: number; elegida: boolean }

// Mientras se achica, la imagen todavía no tiene archivo ni vista previa.
type ImagenAdjunta = { clave: number; nombre: string; archivo?: File; url?: string }

// Lo que deja el servidor: hasta 6 imágenes y 7 MB entre todas (ya achicadas).
const MAX_IMAGENES = 6
const MAX_BYTES_IMAGENES = 7 * 1024 * 1024

const enBase64 = (archivo: File) =>
  new Promise<string>((resolve, reject) => {
    const lector = new FileReader()
    lector.onload = () => resolve(String(lector.result).replace(/^data:[^,]*,/, ""))
    lector.onerror = () => reject(lector.error)
    lector.readAsDataURL(archivo)
  })

// El detalle que propone la IA queda como la descripción del pendiente: un párrafo por línea.
const descripcionDe = (detalle: string) =>
  JSON.stringify(
    detalle
      .split("\n")
      .map((linea) => linea.trim())
      .filter(Boolean)
      .map((linea) => ({ type: "paragraph", content: [{ type: "text", text: linea, styles: {} }] }))
  )

type Props = {
  credenciales: string
  catalogo: Catalogo
  perfiles: Perfil[]
  etiquetas: Etiqueta[]
  proyectoPorDefecto: string | null
  onCrearProyecto: (datos: { nombre: string; organizacion_id: string | null }) => Promise<Proyecto | null>
  onCrearEtiqueta: (nombre: string) => Promise<Etiqueta | null>
  onCreados: (pendientes: Pendiente[]) => void
  onConfigurar: () => void
  onCerrar: () => void
  onSalir: () => void
}

function Contenido({
  credenciales,
  catalogo,
  perfiles,
  etiquetas,
  proyectoPorDefecto,
  onCrearProyecto,
  onCrearEtiqueta,
  onCreados,
  onConfigurar,
  onCerrar,
  onSalir,
}: Props) {
  const [ajustes, setAjustes] = useState<AjustesIA | null>(null)
  const [texto, setTexto] = useState("")
  const [proyectoId, setProyectoId] = useState(proyectoPorDefecto)
  const [imagenes, setImagenes] = useState<ImagenAdjunta[]>([])
  const [encima, setEncima] = useState(false)
  const [propuestas, setPropuestas] = useState<Propuesta[] | null>(null)
  const [pensando, setPensando] = useState(false)
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState("")
  const entrada = useRef<HTMLInputElement>(null)
  const siguienteImagen = useRef(0)
  const vistas = useRef(new Set<string>())

  // Las vistas previas se sueltan al cerrar.
  useEffect(() => {
    const creadas = vistas.current
    return () => creadas.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  useEffect(() => {
    let vigente = true
    api.ia
      .leer(credenciales)
      .then((leidos) => vigente && setAjustes(leidos))
      .catch((err) => {
        if (!vigente) return
        if (esNoAutorizado(err)) onSalir()
        setError(mensajeDeError(err))
      })
    return () => {
      vigente = false
    }
  }, [credenciales, onSalir])

  const fallar = (err: unknown) => {
    if (esNoAutorizado(err)) onSalir()
    setError(mensajeDeError(err))
  }

  const adjuntas = imagenes.flatMap((imagen) => imagen.archivo ?? [])
  const preparando = adjuntas.length < imagenes.length
  const hayQueMandar = Boolean(texto.trim()) || imagenes.length > 0

  // Capturas, fotos de una pizarra o de un papel: se achican aquí y se mandan con el texto.
  async function adjuntar(lista: FileList | File[]) {
    setError("")
    const archivos = [...lista].filter((archivo) => archivo.type.startsWith("image/"))
    const libres = MAX_IMAGENES - imagenes.length
    if (archivos.length < lista.length) setError("Solo se pueden adjuntar imágenes.")
    else if (archivos.length > libres) setError(`Se pueden adjuntar hasta ${MAX_IMAGENES} imágenes.`)
    const nuevas = archivos.slice(0, Math.max(0, libres)).map((archivo) => ({ archivo, clave: siguienteImagen.current++ }))
    if (!nuevas.length) return
    setImagenes((actuales) => [...actuales, ...nuevas.map(({ archivo, clave }) => ({ clave, nombre: archivo.name }))])
    await Promise.all(
      nuevas.map(async ({ archivo, clave }) => {
        const lista = await imagenParaIA(archivo)
        if (!lista) {
          setImagenes((actuales) => actuales.filter((imagen) => imagen.clave !== clave))
          setError(`No se pudo abrir «${archivo.name}». Prueba con una captura en PNG o JPG.`)
          return
        }
        const url = URL.createObjectURL(lista)
        vistas.current.add(url)
        setImagenes((actuales) => actuales.map((imagen) => (imagen.clave === clave ? { ...imagen, archivo: lista, url } : imagen)))
      })
    )
  }

  function quitarImagen(quitada: ImagenAdjunta) {
    if (quitada.url) {
      URL.revokeObjectURL(quitada.url)
      vistas.current.delete(quitada.url)
    }
    setImagenes((actuales) => actuales.filter((imagen) => imagen.clave !== quitada.clave))
  }

  async function proponer(event: FormEvent) {
    event.preventDefault()
    if (!hayQueMandar || pensando || preparando) return
    if (adjuntas.reduce((total, archivo) => total + archivo.size, 0) > MAX_BYTES_IMAGENES) {
      setError("Las imágenes pesan demasiado juntas. Quita alguna y vuelve a intentar.")
      return
    }
    setPensando(true)
    setError("")
    try {
      const sugerencias = await api.ia.sugerir(credenciales, texto, proyectoId, await Promise.all(adjuntas.map(enBase64)))
      setPropuestas(sugerencias.map((sugerencia, clave) => ({ ...sugerencia, clave, elegida: true })))
    } catch (err) {
      fallar(err)
    } finally {
      setPensando(false)
    }
  }

  function cambiar(clave: number, cambios: Partial<Propuesta>) {
    setPropuestas((actuales) => actuales?.map((p) => (p.clave === clave ? { ...p, ...cambios } : p)) ?? null)
  }

  const elegidas = (propuestas ?? []).filter((p) => p.elegida)
  const listas = elegidas.length > 0 && elegidas.every((p) => p.texto.trim())

  // De abajo hacia arriba: lo nuevo queda arriba del tablero, así el primero de la lista queda primero.
  async function crear() {
    if (!listas || creando) return
    setCreando(true)
    setError("")
    const creados: Pendiente[] = []
    const hechas = new Set<number>()
    try {
      for (const propuesta of [...elegidas].reverse()) {
        const detalle = propuesta.detalle?.trim()
        const nuevo = await api.crear(credenciales, {
          texto: propuesta.texto.trim(),
          proyecto_id: propuesta.proyecto_id,
          estado: propuesta.estado,
          tipo: propuesta.tipo,
          perfil_id: propuesta.perfil_id,
          etiquetas: propuesta.etiquetas,
          ...(detalle && { descripcion: descripcionDe(detalle) }),
        })
        creados.unshift(nuevo)
        hechas.add(propuesta.clave)
      }
      onCreados(creados)
      onCerrar()
    } catch (err) {
      // Si algo falla a mitad, lo ya creado queda en el tablero y no se vuelve a ofrecer.
      if (creados.length) onCreados(creados)
      setPropuestas((actuales) => actuales?.filter((p) => !hechas.has(p.clave)) ?? null)
      fallar(err)
    } finally {
      setCreando(false)
    }
  }

  if (!ajustes) {
    return <p className={error ? "m-0 text-sm text-destructive" : "m-0 text-sm text-muted-foreground"}>{error || "Cargando…"}</p>
  }

  if (!ajustes.lista) {
    return (
      <Empty className="border border-dashed p-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Sparkles />
          </EmptyMedia>
          <EmptyTitle>Falta configurar la IA</EmptyTitle>
          <EmptyDescription>Elige Gemini, OpenAI u OpenRouter y pega su clave. Se configura una vez para todo el equipo.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onConfigurar}>
            <Settings /> Configurar la IA
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const proveedor = ajustes.proveedores.find((p) => p.id === ajustes.proveedor)

  if (propuestas === null) {
    return (
      <form
        onSubmit={proponer}
        className="flex flex-col gap-5"
        onDragOver={(event) => {
          if (!traeArchivos(event)) return
          event.preventDefault()
          setEncima(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEncima(false)
        }}
        onDrop={(event) => {
          if (!traeArchivos(event)) return
          event.preventDefault()
          setEncima(false)
          adjuntar(event.dataTransfer.files)
        }}
      >
        <Field>
          <FieldLabel htmlFor="ia-texto">¿Qué hay que hacer?</FieldLabel>
          <Textarea
            id="ia-texto"
            autoFocus
            rows={9}
            maxLength={20000}
            placeholder={"Pega un correo, las notas de una reunión, una captura o escribe lo que falta.\nEj.: Diego arregla el login con Google para el sprint 12 y Junior documenta la API de pagos."}
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            onPaste={(event) => {
              // Una captura pegada se adjunta; el texto se pega como siempre.
              const pegadas = [...event.clipboardData.files].filter((archivo) => archivo.type.startsWith("image/"))
              if (!pegadas.length) return
              event.preventDefault()
              adjuntar(pegadas)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) proponer(event)
            }}
            className={cn(encima && "border-primary bg-primary/5 ring-3 ring-primary/30")}
          />
          <div className="flex flex-wrap items-center gap-2">
            {imagenes.length > 0 && (
              <ul aria-label="Imágenes para la IA" className="m-0 flex list-none flex-wrap gap-2 p-0">
                {imagenes.map((imagen) => (
                  <li key={imagen.clave} className="relative size-16 overflow-hidden rounded-md border bg-muted">
                    {imagen.url ? (
                      <img src={imagen.url} alt={imagen.nombre} className="size-full object-cover" />
                    ) : (
                      <span className="flex size-full items-center justify-center text-muted-foreground" role="status" aria-label={`Preparando ${imagen.nombre}`}>
                        <LoaderCircle className="size-4 animate-spin" />
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-xs"
                      className="absolute top-0.5 right-0.5 size-5 rounded-full opacity-90 shadow-sm"
                      aria-label={`Quitar ${imagen.nombre}`}
                      onClick={() => quitarImagen(imagen)}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {imagenes.length < MAX_IMAGENES &&
              (imagenes.length ? (
                <Button
                  type="button"
                  variant="outline"
                  className="size-16 border-dashed text-muted-foreground"
                  aria-label="Adjuntar otra imagen"
                  title="Adjuntar otra imagen"
                  onClick={() => entrada.current?.click()}
                >
                  <ImagePlus className="size-5" />
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => entrada.current?.click()}>
                  <ImagePlus /> Adjuntar imágenes
                </Button>
              ))}
            <input
              ref={entrada}
              type="file"
              accept="image/*"
              multiple
              hidden
              aria-label="Elegir imágenes para la IA"
              onChange={(event) => {
                if (event.target.files) adjuntar(event.target.files)
                event.target.value = ""
              }}
            />
          </div>
          <FieldDescription>
            La IA propone los pendientes y tú los revisas antes de crearlos. Puedes adjuntar, pegar o soltar hasta {MAX_IMAGENES} imágenes
            (capturas, fotos de una pizarra…). Ctrl+Enter o ⌘Enter para enviar.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Proyecto si no se menciona otro</FieldLabel>
          <ProyectoCombobox valor={proyectoId} onCambiar={setProyectoId} catalogo={catalogo} onCrear={onCrearProyecto} className="w-full sm:w-80" />
        </Field>
        {error && (
          <p role="alert" className="m-0 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="items-center sm:justify-between">
          <Button type="button" variant="link" size="sm" className="h-auto justify-start px-0 text-muted-foreground" onClick={onConfigurar}>
            <Settings /> {proveedor?.nombre} · <span className="font-mono">{proveedor?.modelo}</span>
          </Button>
          <Button type="submit" disabled={!hayQueMandar || pensando || preparando}>
            {pensando ? <LoaderCircle className="animate-spin" /> : <Sparkles />} {pensando ? "Pensando…" : "Proponer pendientes"}
          </Button>
        </DialogFooter>
      </form>
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {propuestas.length === 0 ? (
        <p className="m-0 border border-dashed p-6 text-center text-sm text-muted-foreground">
          {imagenes.length ? "La IA no encontró tareas en el texto ni en las imágenes." : "La IA no encontró tareas en ese texto."}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y border p-0">
          {propuestas.map((propuesta) => {
            const personas = involucrados(perfiles, organizacionDe(catalogo, propuesta.proyecto_id), propuesta.perfil_id)
            return (
              <li key={propuesta.clave} className="flex gap-3 p-3 data-[elegida=false]:opacity-55" data-elegida={propuesta.elegida}>
                <Checkbox
                  className="mt-2.5"
                  checked={propuesta.elegida}
                  onCheckedChange={(marcada) => cambiar(propuesta.clave, { elegida: marcada === true })}
                  aria-label={`Crear «${propuesta.texto}»`}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Input
                    aria-label="Título"
                    value={propuesta.texto}
                    maxLength={500}
                    onChange={(event) => cambiar(propuesta.clave, { texto: event.target.value })}
                    className="font-medium"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <TipoSelect compacto valor={propuesta.tipo} onCambiar={(tipo) => cambiar(propuesta.clave, { tipo })} className="w-32" />
                    <Select
                      value={propuesta.perfil_id ?? NADIE}
                      onValueChange={(valor) => cambiar(propuesta.clave, { perfil_id: valor === NADIE ? null : valor })}
                    >
                      <SelectTrigger aria-label="Responsable" size="sm" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {personas.map((perfil) => (
                          <SelectItem key={perfil.id} value={perfil.id}>
                            <PerfilAvatar perfil={perfil} size="sm" /> {perfil.nombre}
                          </SelectItem>
                        ))}
                        <SelectItem value={NADIE}>
                          <PerfilAvatar perfil={null} size="sm" /> Sin asignar
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={propuesta.estado} onValueChange={(valor) => cambiar(propuesta.clave, { estado: valor as Estado })}>
                      <SelectTrigger aria-label="Columna" size="sm" className="w-36">
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
                    <ProyectoCombobox
                      valor={propuesta.proyecto_id}
                      onCambiar={(proyecto) => cambiar(propuesta.clave, { proyecto_id: proyecto })}
                      catalogo={catalogo}
                      onCrear={onCrearProyecto}
                      className="h-8 w-full sm:w-64"
                    />
                  </div>
                  <EtiquetasSelector
                    etiquetas={etiquetas}
                    seleccionadas={propuesta.etiquetas}
                    onCambiar={(ids) => cambiar(propuesta.clave, { etiquetas: ids })}
                    onCrear={onCrearEtiqueta}
                  />
                  <Textarea
                    aria-label="Detalle"
                    rows={2}
                    placeholder="Detalle (opcional): queda en la descripción"
                    value={propuesta.detalle ?? ""}
                    onChange={(event) => cambiar(propuesta.clave, { detalle: event.target.value })}
                    className="min-h-0 text-sm"
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="outline" onClick={() => setPropuestas(null)} disabled={creando}>
          <ArrowLeft /> {imagenes.length ? "Cambiar texto o imágenes" : "Cambiar el texto"}
        </Button>
        {propuestas.length > 0 && (
          <Button onClick={crear} disabled={!listas || creando}>
            {creando ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            {creando ? "Creando…" : elegidas.length === 1 ? "Crear 1 pendiente" : `Crear ${elegidas.length} pendientes`}
          </Button>
        )}
      </DialogFooter>
    </div>
  )
}

// Crear pendientes a partir de un texto o de imágenes: la IA del equipo los propone y se revisan (título, tipo, responsable,
// columna, proyecto, etiquetas y detalle) antes de crearlos.
export function CrearConIaDialog({ abierto, ...props }: Omit<Props, "onCerrar"> & { abierto: boolean; onAbiertoChange: (abierto: boolean) => void }) {
  const { onAbiertoChange, ...resto } = props
  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" /> Crear con IA
          </DialogTitle>
          <DialogDescription>Pega un texto o una captura y la IA lo convierte en pendientes.</DialogDescription>
        </DialogHeader>
        {abierto && <Contenido {...resto} onCerrar={() => onAbiertoChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}
