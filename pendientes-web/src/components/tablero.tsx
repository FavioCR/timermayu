import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react"
import type { DragStartEvent } from "@dnd-kit/core"
import {
  Bell,
  BellRing,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  CircleCheck,
  CircleDashed,
  ClipboardList,
  Folder,
  FolderKanban,
  FolderOpen,
  Forward,
  History,
  ImageIcon,
  Inbox,
  Info,
  Keyboard,
  Layers,
  Lock,
  LogOut,
  MessageSquare,
  MonitorDown,
  NotebookPen,
  MoreVertical,
  Paperclip,
  Plus,
  RotateCw,
  Search,
  SearchX,
  Sparkles,
  Tag,
  Timer,
  Trash2,
  Type,
  UserPlus,
  Users,
  UsersRound,
  X,
} from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"

import { ActividadSheet } from "@/components/actividad-sheet"
import { AparienciaDialog } from "@/components/apariencia-dialog"
import { DetallePendiente } from "@/components/detalle-pendiente"
import { EstadoConexion } from "@/components/estado-conexion"
import { porNombre, PuntoEtiqueta } from "@/components/etiquetas-selector"
import { HechosAnteriores } from "@/components/hechos-anteriores"
import { InstalarDialog } from "@/components/instalar-dialog"
import { IlustracionColumna } from "@/components/ilustraciones"
import { InvolucradosMenu } from "@/components/involucrados-menu"
import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from "@/components/kibo-ui/kanban"
import { Notificaciones } from "@/components/notificaciones"
import { PasarDialog } from "@/components/pasar-dialog"
import { PerfilAvatar } from "@/components/perfil-avatar"
import type { CambiosPerfil } from "@/components/perfiles-dialog"
import { ProyectoCombobox } from "@/components/proyecto-combobox"
import { ProyectosDialog } from "@/components/proyectos-dialog"
import { InsigniaEligiendo, InsigniaTipo } from "@/components/tipo-select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Toaster } from "@/components/ui/sonner"
import {
  api,
  crearCredenciales,
  esNoAutorizado,
  esSinConexion,
  mensajeDeError,
  partesDe,
  type CambiosPendiente,
  type Estado,
  type Etiqueta,
  type Organizacion,
  type Pendiente,
  type Perfil,
  type SinLeer,
  type Usuario,
} from "@/lib/api"
import { enlaceWhatsApp } from "@/lib/actividad"
import { APARIENCIA_NORMAL, aplicarApariencia } from "@/lib/apariencia"
import { coincide } from "@/lib/buscar"
import { agrupar, conOrganizacion, conProyecto, involucrados, organizacionDe, SIN_ORGANIZACION, type Catalogo } from "@/lib/catalogo"
import { conectarCambios, revisarConexion, useCambios } from "@/lib/cambios"
import { COLUMNAS, NADIE } from "@/lib/estados"
import { instalar, useInstalacion } from "@/lib/instalar"
import { separarTipo, TIPOS, tipoDe } from "@/lib/tipos"

const PerfilesDialog = lazy(() => import("@/components/perfiles-dialog").then((modulo) => ({ default: modulo.PerfilesDialog })))
const IaDialog = lazy(() => import("@/components/ia-dialog").then((modulo) => ({ default: modulo.IaDialog })))
const CrearConIaDialog = lazy(() => import("@/components/crear-con-ia-dialog").then((modulo) => ({ default: modulo.CrearConIaDialog })))

// El tablero muestra los hechos de la última semana; los anteriores se buscan desde la columna Hecho.
const SEMANA_MS = 7 * 24 * 60 * 60 * 1000
// Filtro por tipo: "tipo:fix". Por etiqueta: su id.
const PREFIJO_TIPO = "tipo:"

const ICONOS: Record<Estado, typeof Inbox> = { pendiente: Inbox, haciendo: RotateCw, hecho: CircleCheck }

const VACIO: Record<Estado, string> = {
  pendiente: "Agrega una tarea o arrastra una tarjeta a esta columna.",
  haciendo: "Arrastra una tarjeta o crea una nueva tarea para empezar.",
  hecho: "Aquí se ve lo terminado en los últimos 7 días.",
}

const fecha = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" })

// Kibo UI necesita name y column en cada tarjeta.
type Tarjeta = Pendiente & { name: string; column: string }

const aTarjeta = (pendiente: Pendiente): Tarjeta => ({ ...pendiente, name: pendiente.texto, column: pendiente.estado })

const firmaDelOrden = (tarjetas: Tarjeta[]) => tarjetas.map((tarjeta) => `${tarjeta.id}:${tarjeta.column}`).join(",")

// Con un filtro activo el tablero solo ve una parte: su nuevo orden se acomoda en los mismos lugares de la lista completa.
function mezclar(todas: Tarjeta[], visibles: Tarjeta[]) {
  const ids = new Set(visibles.map((tarjeta) => tarjeta.id))
  let i = 0
  return todas.map((tarjeta) => (ids.has(tarjeta.id) ? visibles[i++] : tarjeta))
}

function contar<T>(items: T[], clave: (item: T) => string | null) {
  const conteo = new Map<string, number>()
  for (const item of items) {
    const valor = clave(item)
    if (valor) conteo.set(valor, (conteo.get(valor) ?? 0) + 1)
  }
  return conteo
}

const AVISO_EQUIPO = "pendientes.aviso-equipo-cerrado"

function avisoEquipoCerrado() {
  try {
    return localStorage.getItem(AVISO_EQUIPO) === "1"
  } catch {
    return false
  }
}

// Filtros y campos del formulario de la última visita, para encontrarlos igual al volver.
const SELECCIONES = "pendientes.selecciones"

type Selecciones = {
  organizacion: string | null
  proyecto: string | null
  perfil: string | null
  proyectoNuevo: string | null
  responsableNuevo: string
  // Organizaciones y proyectos comprimidos en una sola línea "Organización › Proyecto".
  compacto: boolean
  // Tipo ("tipo:fix") o etiqueta (su id) por la que se filtra.
  marca: string | null
}

function leerSelecciones(): Selecciones {
  let guardadas: Record<string, unknown> = {}
  try {
    guardadas = JSON.parse(localStorage.getItem(SELECCIONES) ?? "{}") ?? {}
  } catch {
    // Sin almacenamiento o con algo ilegible se empieza sin filtros.
  }
  const texto = (valor: unknown) => (typeof valor === "string" ? valor : null)
  return {
    organizacion: texto(guardadas.organizacion),
    proyecto: texto(guardadas.proyecto),
    perfil: texto(guardadas.perfil),
    proyectoNuevo: texto(guardadas.proyectoNuevo),
    responsableNuevo: texto(guardadas.responsableNuevo) ?? NADIE,
    compacto: guardadas.compacto === true,
    marca: texto(guardadas.marca),
  }
}

type Ventana = "proyectos" | "perfiles" | "actividad" | "ia" | "crear-ia" | "instalar" | "apariencia"

// Tocar un botón dentro de la tarjeta no debe empezar a arrastrarla.
const detener = (event: SyntheticEvent) => event.stopPropagation()
const noArrastrar = { onMouseDown: detener, onTouchStart: detener, onKeyDown: detener }

// Un clic en la tarjeta abre su detalle, salvo que caiga en uno de sus botones o en un menú abierto desde ella.
const esClicEnLaTarjeta = (event: MouseEvent<HTMLElement>) =>
  event.currentTarget.contains(event.target as Node) && !(event.target as HTMLElement).closest("button, a, input")

// Lo que dice la campana de una tarjeta.
function descripcionAviso({ avisos, menciones }: SinLeer) {
  const total = avisos === 1 ? "1 aviso sin leer" : `${avisos} avisos sin leer`
  return menciones > 0 ? `Te mencionaron · ${total}` : total
}

function Contador({ valor }: { valor: number }) {
  return <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs leading-none tabular-nums text-muted-foreground">{valor}</span>
}

function Filtro({ activo, className, children, ...props }: { activo: boolean } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-lg border bg-card px-3.5 text-sm font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
        activo && "border-primary bg-primary/25 ring-3 ring-primary/25 hover:bg-primary/30",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

// Filtro por tipo de trabajo o etiqueta: un botón como el de las organizaciones que abre la lista encima del tablero.
function FiltroMarca({
  valor,
  onCambiar,
  tipos,
  etiquetas,
  porTipo,
  porEtiqueta,
  total,
}: {
  valor: string | null
  onCambiar: (valor: string | null) => void
  tipos: (typeof TIPOS)[number][]
  etiquetas: Etiqueta[]
  porTipo: Map<string | null, number>
  porEtiqueta: Map<string, number>
  total: number
}) {
  const [abierto, setAbierto] = useState(false)
  const tipo = valor?.startsWith(PREFIJO_TIPO) ? tipos.find((t) => `${PREFIJO_TIPO}${t.id}` === valor) : undefined
  const etiqueta = valor && !tipo ? etiquetas.find((e) => e.id === valor) : undefined

  function elegir(nuevo: string | null) {
    onCambiar(nuevo === valor ? null : nuevo)
    setAbierto(false)
  }

  const marca = (activo: boolean) => <Check className={cn("size-4", activo ? "opacity-100" : "opacity-0")} />

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Filtro activo={valor !== null} aria-pressed={undefined} aria-label="Filtrar por tipo o etiqueta">
          {tipo ? (
            <>
              <span className="size-2.5 rounded-full" style={{ backgroundColor: tipo.color }} />
              <span className="font-mono">{tipo.id}</span>
              <Contador valor={porTipo.get(tipo.id) ?? 0} />
            </>
          ) : etiqueta ? (
            <>
              <PuntoEtiqueta etiqueta={etiqueta} className="size-2.5" /> {etiqueta.nombre}
              <Contador valor={porEtiqueta.get(etiqueta.id) ?? 0} />
            </>
          ) : (
            <>
              <Tag /> Todos los tipos y etiquetas
            </>
          )}
          <ChevronDown className="text-muted-foreground" />
        </Filtro>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Buscar tipo o etiqueta…" />
          <CommandList className="max-h-80">
            <CommandEmpty>Nada con ese nombre.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="todos los tipos y etiquetas" onSelect={() => elegir(null)}>
                {marca(valor === null)}
                <Tag className="text-muted-foreground" /> Todos
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{total}</span>
              </CommandItem>
            </CommandGroup>
            {tipos.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Tipo">
                  {tipos.map((t) => {
                    const clave = `${PREFIJO_TIPO}${t.id}`
                    return (
                      <CommandItem key={clave} value={clave} keywords={[t.id, t.descripcion]} onSelect={() => elegir(clave)}>
                        {marca(valor === clave)}
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                        <span className="font-mono">{t.id}</span>
                        <span className="truncate text-muted-foreground">{t.descripcion}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{porTipo.get(t.id) ?? 0}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </>
            )}
            {etiquetas.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Etiqueta">
                  {etiquetas.map((e) => (
                    <CommandItem key={e.id} value={e.id} keywords={[e.nombre]} onSelect={() => elegir(e.id)}>
                      {marca(valor === e.id)}
                      <PuntoEtiqueta etiqueta={e} />
                      <span className="truncate">{e.nombre}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{porEtiqueta.get(e.id) ?? 0}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function Tablero({
  credenciales,
  onCredenciales,
  onSalir,
}: {
  credenciales: string
  onCredenciales: (credenciales: string) => void
  onSalir: () => void
}) {
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([])
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [catalogo, setCatalogo] = useState<Catalogo>({ organizaciones: [], proyectos: [] })
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([])
  // Pendientes recién creados sin tipo a los que la IA les está eligiendo uno.
  const [eligiendoTipo, setEligiendoTipo] = useState<ReadonlySet<string>>(() => new Set())
  // Desde cuándo un hecho es "de la última semana"; se pone al día con cada recarga.
  const [ahora, setAhora] = useState(() => Date.now())
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState("")
  const [guardadas] = useState(leerSelecciones)
  const [filtroOrganizacion, setFiltroOrganizacion] = useState(guardadas.organizacion)
  const [filtroProyecto, setFiltroProyecto] = useState(guardadas.proyecto)
  const [filtroPerfil, setFiltroPerfil] = useState(guardadas.perfil)
  const [filtroMarca, setFiltroMarca] = useState(guardadas.marca)
  const [texto, setTexto] = useState("")
  const [proyectoId, setProyectoId] = useState(guardadas.proyectoNuevo)
  const [responsable, setResponsable] = useState(guardadas.responsableNuevo)
  const [compacto, setCompacto] = useState(guardadas.compacto)
  // Columna donde cae lo que se agrega; se elige desde el menú de cada columna.
  const [destino, setDestino] = useState<Estado>("pendiente")
  // Un enlace con ?p=<id> (el de WhatsApp, por ejemplo) abre ese pendiente.
  const [abierto, setAbierto] = useState(() => new URLSearchParams(window.location.search).get("p"))
  const [ventana, setVentana] = useState<Ventana | null>(null)
  const instalacion = useInstalacion()
  // Abierta una vez, Perfiles queda montada para que se cierre con su animación.
  const [perfilesAbiertos, setPerfilesAbiertos] = useState(false)
  if (ventana === "perfiles" && !perfilesAbiertos) setPerfilesAbiertos(true)
  // Igual con los de la IA, que se cargan aparte.
  const [iaAbierta, setIaAbierta] = useState(false)
  if ((ventana === "ia" || ventana === "crear-ia") && !iaAbierta) setIaAbierta(true)
  // Al configurar la IA desde "Crear con IA", al guardar se vuelve ahí.
  const volverACrear = useRef(false)
  const [hechosAbiertos, setHechosAbiertos] = useState(false)
  const [busquedaHechos, setBusquedaHechos] = useState("")
  // Lo escrito en el buscador de cada columna.
  const [busquedas, setBusquedas] = useState<Partial<Record<string, string>>>({})
  // La tarjeta que se arrastra: el buscador no la esconde aunque pase a una columna donde no coincide.
  const [arrastrada, setArrastrada] = useState<string | null>(null)
  // Los pendientes con avisos sin leer de quien entró, para la campana de su tarjeta.
  const [sinLeer, setSinLeer] = useState<Map<string, SinLeer>>(() => new Map())
  // El pendiente hecho que se está pasando a otra persona.
  const [pasando, setPasando] = useState<Pendiente | null>(null)
  const [confirmarLimpieza, setConfirmarLimpieza] = useState(false)
  const [sinAvisoEquipo, setSinAvisoEquipo] = useState(avisoEquipoCerrado)
  const ultimas = useRef<Tarjeta[]>([])
  const ordenAlEmpezar = useRef("")
  const arrastrando = useRef(false)
  // Llegó un cambio de otra persona mientras se arrastraba: se recarga al soltar.
  const recargarAlSoltar = useRef(false)
  const recargaPendiente = useRef<number | undefined>(undefined)
  const campoTexto = useRef<HTMLInputElement>(null)
  // Lo que toca hacer cuando el menú de una columna termina de cerrarse (en vez de devolver el foco a su botón).
  const alCerrarMenu = useRef<(() => void) | null>(null)

  useEffect(() => {
    ultimas.current = tarjetas
  }, [tarjetas])

  useEffect(() => {
    const selecciones: Selecciones = {
      organizacion: filtroOrganizacion,
      proyecto: filtroProyecto,
      perfil: filtroPerfil,
      proyectoNuevo: proyectoId,
      responsableNuevo: responsable,
      compacto,
      marca: filtroMarca,
    }
    try {
      localStorage.setItem(SELECCIONES, JSON.stringify(selecciones))
    } catch {
      // Sin almacenamiento las selecciones duran lo que dure la pestaña.
    }
  }, [filtroOrganizacion, filtroProyecto, filtroPerfil, proyectoId, responsable, compacto, filtroMarca])

  // La dirección lleva el pendiente abierto, para poder compartirla o recargar sin perderlo.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (abierto) url.searchParams.set("p", abierto)
    else url.searchParams.delete("p")
    window.history.replaceState(null, "", url)
  }, [abierto])

  const fallar = useCallback(
    (err: unknown) => {
      if (esNoAutorizado(err)) onSalir()
      else setError(mensajeDeError(err))
    },
    [onSalir]
  )

  const recargar = useCallback(async () => {
    try {
      const [pendientes, nuevosPerfiles, organizaciones, proyectos, nuevasEtiquetas, yo] = await Promise.all([
        api.listar(credenciales),
        api.perfiles.listar(credenciales),
        api.organizaciones.listar(credenciales),
        api.proyectos.listar(credenciales),
        api.etiquetas.listar(credenciales),
        api.yo(credenciales),
      ])
      setTarjetas(pendientes.map(aTarjeta))
      setPerfiles(nuevosPerfiles)
      setCatalogo({ organizaciones, proyectos })
      setEtiquetas(nuevasEtiquetas)
      setAhora(Date.now())
      setUsuario(yo)
      // Un pendiente que ya no existe (o que no se puede ver) no queda abierto.
      setAbierto((actual) => (actual && pendientes.some((p) => p.id === actual) ? actual : null))
      setError("")
    } catch (err) {
      // Sin conexión no se muestra el error: lo dicen el indicador y su aviso, y al reconectar se vuelve a cargar.
      if (esSinConexion(err)) revisarConexion()
      else fallar(err)
    } finally {
      setCargando(false)
    }
  }, [credenciales, fallar])

  // Al volver a la pestaña se recarga, por si alguien más movió algo.
  useEffect(() => {
    recargar()
    const alVolver = () => document.visibilityState === "visible" && recargar()
    document.addEventListener("visibilitychange", alVolver)
    return () => document.removeEventListener("visibilitychange", alVolver)
  }, [recargar])

  // Cambios en tiempo real: cuando otra persona (u otra pestaña) cambia algo, el tablero se pone al día.
  // Varios avisos seguidos se juntan en una sola recarga; mientras se arrastra, se espera a soltar.
  useEffect(() => conectarCambios(credenciales, onSalir), [credenciales, onSalir])
  const recargarPronto = useCallback(() => {
    window.clearTimeout(recargaPendiente.current)
    recargaPendiente.current = window.setTimeout(() => {
      if (arrastrando.current) recargarAlSoltar.current = true
      else recargar()
    }, 250)
  }, [recargar])
  useEffect(() => () => window.clearTimeout(recargaPendiente.current), [])
  useCambios((cambio) => {
    // El aviso de un pendiente que esperaba su tipo es la respuesta de la IA: el tipo llega con la recarga.
    if (cambio.pendiente_id && eligiendoTipo.has(cambio.pendiente_id)) dejarDeElegir(cambio.pendiente_id, 1500)
    if (cambio.tipo !== "ia") recargarPronto()
  })

  const dejarDeElegir = useCallback((id: string, enMs: number) => {
    window.setTimeout(
      () =>
        setEligiendoTipo((actuales) => {
          if (!actuales.has(id)) return actuales
          const nuevos = new Set(actuales)
          nuevos.delete(id)
          return nuevos
        }),
      enMs
    )
  }, [])

  const perfilesPorId = useMemo(() => new Map(perfiles.map((perfil) => [perfil.id, perfil])), [perfiles])
  const proyectosPorId = useMemo(() => new Map(catalogo.proyectos.map((proyecto) => [proyecto.id, proyecto])), [catalogo])
  const organizacionesPorId = useMemo(
    () => new Map(catalogo.organizaciones.map((organizacion) => [organizacion.id, organizacion])),
    [catalogo]
  )
  const grupos = useMemo(() => agrupar(catalogo), [catalogo])
  const etiquetasPorId = useMemo(() => new Map(etiquetas.map((etiqueta) => [etiqueta.id, etiqueta])), [etiquetas])
  const etiquetasOrdenadas = useMemo(() => [...etiquetas].sort(porNombre), [etiquetas])

  // Lo que no tiene proyecto, o tiene uno suelto, cae en "Sin organización".
  const claveOrganizacion = useCallback(
    (tarjeta: Pendiente) => (tarjeta.proyecto_id && proyectosPorId.get(tarjeta.proyecto_id)?.organizacion_id) || SIN_ORGANIZACION,
    [proyectosPorId]
  )

  // Un filtro que apunta a algo borrado deja de filtrar.
  const organizacionFiltrada =
    filtroOrganizacion === SIN_ORGANIZACION || (filtroOrganizacion && organizacionesPorId.has(filtroOrganizacion)) ? filtroOrganizacion : null
  const proyectoFiltrado = filtroProyecto && proyectosPorId.has(filtroProyecto) ? filtroProyecto : null
  const organizacionDelFiltro = organizacionFiltrada ? organizacionesPorId.get(organizacionFiltrada) : undefined

  // Se elige organización, luego proyecto y luego persona: las personas son los involucrados de esa organización.
  const personasDelFiltro = involucrados(perfiles, organizacionDelFiltro)
  const perfilFiltrado =
    filtroPerfil === null || filtroPerfil === NADIE || personasDelFiltro.some((perfil) => perfil.id === filtroPerfil) ? filtroPerfil : null

  // Un tipo o una etiqueta que ya no existe deja de filtrar.
  const marcaFiltrada =
    filtroMarca !== null &&
    (filtroMarca.startsWith(PREFIJO_TIPO) ? tipoDe(filtroMarca.slice(PREFIJO_TIPO.length) as Pendiente["tipo"]) : etiquetasPorId.has(filtroMarca))
      ? filtroMarca
      : null

  const filtrando = organizacionFiltrada !== null || proyectoFiltrado !== null || perfilFiltrado !== null || marcaFiltrada !== null

  const enOrganizacionYProyecto = useCallback(
    (tarjeta: Tarjeta) =>
      (organizacionFiltrada === null || claveOrganizacion(tarjeta) === organizacionFiltrada) &&
      (proyectoFiltrado === null || tarjeta.proyecto_id === proyectoFiltrado),
    [organizacionFiltrada, proyectoFiltrado, claveOrganizacion]
  )
  const conPersona = useCallback((tarjeta: Tarjeta) => perfilFiltrado === null || (tarjeta.perfil_id ?? NADIE) === perfilFiltrado, [perfilFiltrado])
  const conMarca = useCallback(
    (tarjeta: Tarjeta) =>
      marcaFiltrada === null ||
      (marcaFiltrada.startsWith(PREFIJO_TIPO) ? tarjeta.tipo === marcaFiltrada.slice(PREFIJO_TIPO.length) : tarjeta.etiquetas.includes(marcaFiltrada)),
    [marcaFiltrada]
  )

  // Los hechos de hace más de una semana salen del tablero (y de sus números); se buscan aparte.
  const esAntiguo = useCallback(
    (tarjeta: Tarjeta) => tarjeta.column === "hecho" && tarjeta.hecho_en !== null && Date.parse(tarjeta.hecho_en) < ahora - SEMANA_MS,
    [ahora]
  )
  const recientes = useMemo(() => tarjetas.filter((tarjeta) => !esAntiguo(tarjeta)), [tarjetas, esAntiguo])
  const antiguosVisibles = useMemo(
    () => tarjetas.filter((tarjeta) => esAntiguo(tarjeta) && enOrganizacionYProyecto(tarjeta) && conPersona(tarjeta) && conMarca(tarjeta)),
    [tarjetas, esAntiguo, enOrganizacionYProyecto, conPersona, conMarca]
  )

  // Lo que queda con la organización, el proyecto y el tipo o etiqueta elegidos; de ahí salen los números de cada persona.
  const enAlcance = useMemo(
    () => recientes.filter((tarjeta) => enOrganizacionYProyecto(tarjeta) && conMarca(tarjeta)),
    [recientes, enOrganizacionYProyecto, conMarca]
  )

  const visibles = useMemo(() => enAlcance.filter(conPersona), [enAlcance, conPersona])

  // El buscador de cada columna mira el título, la descripción, el proyecto, la persona, el tipo y las etiquetas.
  const textoDe = useCallback(
    (tarjeta: Tarjeta) => {
      const proyecto = tarjeta.proyecto_id ? proyectosPorId.get(tarjeta.proyecto_id) : undefined
      const organizacion = proyecto?.organizacion_id ? organizacionesPorId.get(proyecto.organizacion_id) : undefined
      const perfil = tarjeta.perfil_id ? perfilesPorId.get(tarjeta.perfil_id) : undefined
      const etiquetasDe = tarjeta.etiquetas.map((id) => etiquetasPorId.get(id)?.nombre)
      return [tarjeta.texto, tarjeta.resumen, organizacion?.nombre, proyecto?.nombre, perfil?.nombre ?? "Sin asignar", tarjeta.tipo, ...etiquetasDe]
        .filter(Boolean)
        .join(" ")
    },
    [proyectosPorId, organizacionesPorId, perfilesPorId, etiquetasPorId]
  )
  const enColumnas = useMemo(
    () => visibles.filter((tarjeta) => tarjeta.id === arrastrada || coincide(textoDe(tarjeta), busquedas[tarjeta.column] ?? "")),
    [visibles, arrastrada, busquedas, textoDe]
  )
  const antiguosEnBusqueda = useMemo(
    () => antiguosVisibles.filter((tarjeta) => coincide(textoDe(tarjeta), busquedas.hecho ?? "")),
    [antiguosVisibles, busquedas, textoDe]
  )

  const porOrganizacion = useMemo(() => contar(recientes, claveOrganizacion), [recientes, claveOrganizacion])
  const porProyecto = useMemo(() => contar(recientes, (tarjeta) => tarjeta.proyecto_id), [recientes])
  const asignados = useMemo(() => contar(tarjetas, (tarjeta) => tarjeta.perfil_id ?? NADIE), [tarjetas])
  const asignadosEnAlcance = useMemo(() => contar(enAlcance, (tarjeta) => tarjeta.perfil_id ?? NADIE), [enAlcance])
  // Los números de cada tipo y etiqueta, con los demás filtros.
  const paraMarcas = useMemo(() => recientes.filter((tarjeta) => enOrganizacionYProyecto(tarjeta) && conPersona(tarjeta)), [recientes, enOrganizacionYProyecto, conPersona])
  const porTipo = useMemo(() => contar(paraMarcas, (tarjeta) => tarjeta.tipo), [paraMarcas])
  const porEtiqueta = useMemo(() => {
    const conteo = new Map<string, number>()
    for (const tarjeta of paraMarcas) for (const id of tarjeta.etiquetas) conteo.set(id, (conteo.get(id) ?? 0) + 1)
    return conteo
  }, [paraMarcas])
  const tiposEnUso = TIPOS.filter((tipo) => porTipo.has(tipo.id) || marcaFiltrada === `${PREFIJO_TIPO}${tipo.id}`)

  // Los proyectos de la organización elegida en el filtro.
  const proyectosDelFiltro =
    organizacionFiltrada === null
      ? []
      : (grupos.find((grupo) => (grupo.organizacion?.id ?? SIN_ORGANIZACION) === organizacionFiltrada)?.proyectos ?? [])

  const hayCatalogo = catalogo.organizaciones.length > 0 || catalogo.proyectos.length > 0

  const miPerfil = usuario?.perfil_id ? perfilesPorId.get(usuario.perfil_id) : null

  // La fuente y el tamaño del perfil. Mientras se eligen en Apariencia, manda lo que se está probando ahí; al cerrar sin
  // guardar, vuelve la guardada.
  const apariencia = usuario?.apariencia ?? APARIENCIA_NORMAL
  const conUsuario = usuario !== null
  const eligiendoApariencia = ventana === "apariencia"
  useEffect(() => {
    if (conUsuario && !eligiendoApariencia) aplicarApariencia({ fuente: apariencia.fuente, tamano: apariencia.tamano })
  }, [conUsuario, eligiendoApariencia, apariencia.fuente, apariencia.tamano])

  const abribles = useMemo(() => new Set(tarjetas.map((tarjeta) => tarjeta.id)), [tarjetas])

  // Lo guardado puede apuntar a algo borrado o que esta cuenta no ve: entonces el campo queda vacío.
  const proyectoDelFormulario = proyectoId && proyectosPorId.has(proyectoId) ? proyectoId : null
  // En el formulario, como en los filtros, se asigna a los involucrados de la organización del proyecto elegido.
  const personasDelFormulario = involucrados(perfiles, organizacionDe(catalogo, proyectoDelFormulario))
  const responsableDelFormulario = personasDelFormulario.some((perfil) => perfil.id === responsable) ? responsable : NADIE

  function etiquetaDeProyecto(id: string | null) {
    const proyecto = id ? proyectosPorId.get(id) : undefined
    const organizacion = proyecto?.organizacion_id ? organizacionesPorId.get(proyecto.organizacion_id) : undefined
    return proyecto ? (organizacion ? `${organizacion.nombre} › ${proyecto.nombre}` : proyecto.nombre) : null
  }

  // El formulario toma lo que marcan los filtros, para que lo nuevo quede donde se está mirando.
  // Al quitar un filtro, el campo se vacía solo si todavía tenía lo que el filtro le había puesto.
  function filtrarPorPerfil(clave: string | null) {
    setFiltroPerfil(clave)
    if (clave !== null) setResponsable(clave)
    else if (responsable === perfilFiltrado) setResponsable(NADIE)
  }

  function filtrarPorOrganizacion(clave: string | null) {
    setFiltroOrganizacion(clave)
    setFiltroProyecto(null)
    // Si la persona elegida no está en la nueva organización, deja de filtrarse (y de rellenar el formulario).
    const personas = involucrados(perfiles, clave ? organizacionesPorId.get(clave) : undefined)
    if (perfilFiltrado && perfilFiltrado !== NADIE && !personas.some((perfil) => perfil.id === perfilFiltrado)) {
      setFiltroPerfil(null)
      if (responsable === perfilFiltrado) setResponsable(NADIE)
    }
    const delFormulario = proyectoDelFormulario ? proyectosPorId.get(proyectoDelFormulario) : undefined
    const deOtraOrganizacion = delFormulario && clave !== null && (delFormulario.organizacion_id ?? SIN_ORGANIZACION) !== clave
    if (deOtraOrganizacion || (clave === null && proyectoId === proyectoFiltrado)) setProyectoId(null)
  }

  function filtrarPorProyecto(id: string | null) {
    setFiltroProyecto(id)
    if (id !== null) setProyectoId(id)
    else if (proyectoId === proyectoFiltrado) setProyectoId(null)
  }

  const abrirPendiente = useCallback((id: string) => setAbierto(id), [])

  // Se ve al instante, para poder marcar varias personas seguidas; si falla, vuelve a como estaba.
  async function cambiarInvolucrados(organizacion: Organizacion, miembros: string[]) {
    setCatalogo((actual) => conOrganizacion(actual, { ...organizacion, miembros }))
    try {
      await api.organizaciones.actualizar(credenciales, organizacion.id, { miembros })
      setError("")
    } catch (err) {
      setCatalogo((actual) => conOrganizacion(actual, organizacion))
      fallar(err)
    }
  }

  const abiertos = tarjetas.filter((tarjeta) => tarjeta.column !== "hecho").length

  const hechosVisibles = visibles.filter((tarjeta) => tarjeta.column === "hecho")

  const pendienteAbierto = tarjetas.find((tarjeta) => tarjeta.id === abierto) ?? null

  const columnaDestino = COLUMNAS.find((columna) => columna.id === destino)

  async function agregar(event: FormEvent) {
    event.preventDefault()
    if (!texto.trim()) {
      campoTexto.current?.focus()
      return
    }
    // "fix: el login falla" lo crea como fix; con un tipo o etiqueta en el filtro, lo nuevo lo lleva para no desaparecer.
    const separado = separarTipo(texto)
    const tipoDelFiltro = marcaFiltrada?.startsWith(PREFIJO_TIPO) ? (marcaFiltrada.slice(PREFIJO_TIPO.length) as Pendiente["tipo"]) : null
    try {
      const nuevo = await api.crear(credenciales, {
        texto: separado.texto,
        proyecto_id: proyectoDelFormulario,
        estado: destino,
        // Sin tipo, la IA lo elige si está configurada.
        tipo: separado.tipo ?? tipoDelFiltro ?? undefined,
        perfil_id: responsableDelFormulario === NADIE ? null : responsableDelFormulario,
        etiquetas: marcaFiltrada && !marcaFiltrada.startsWith(PREFIJO_TIPO) ? [marcaFiltrada] : [],
      })
      // Sin responsable entra arriba; con responsable, al final de su cola (como lo ordena el servidor).
      setTarjetas((actuales) => (nuevo.perfil_id ? [...actuales, aTarjeta(nuevo)] : [aTarjeta(nuevo), ...actuales]))
      if (nuevo.eligiendoTipo) {
        setEligiendoTipo((actuales) => new Set(actuales).add(nuevo.id))
        // Por si el aviso no llega (sin conexión en tiempo real): la IA tarda como mucho un minuto.
        dejarDeElegir(nuevo.id, 65_000)
      }
      setTexto("")
      setDestino("pendiente")
      setError("")
      avisarPorWhatsApp(nuevo)
    } catch (err) {
      fallar(err)
    }
  }

  // Al darle un pendiente a otra persona, ofrece avisarle por WhatsApp con el enlace al pendiente.
  function avisarPorWhatsApp(nuevo: Pendiente, titulo?: string) {
    const asignado = nuevo.perfil_id ? perfilesPorId.get(nuevo.perfil_id) : undefined
    if (!asignado || asignado.id === usuario?.perfil_id) return
    const enlace = enlaceWhatsApp({
      perfil: asignado,
      pendiente: nuevo,
      proyecto: etiquetaDeProyecto(nuevo.proyecto_id),
      quien: usuario?.perfil_id ? usuario.nombre : null,
    })
    // Sin contraseña todavía no puede entrar con su perfil: el aviso le espera en la campana, pero no lo verá aún.
    const enElTablero = asignado.tiene_contrasena
      ? "Ya le llegó el aviso en el tablero."
      : `${asignado.nombre} aún no entra con su perfil, así que no verá el aviso en el tablero.`
    const porWhatsApp = asignado.telefono ? "¿Le escribes por WhatsApp?" : "¿Le escribes por WhatsApp? Sin número guardado, elegirás el chat."
    toast.success(titulo ?? `Pendiente asignado a ${asignado.nombre}`, {
      description: `${enElTablero} ${porWhatsApp}`,
      action: { label: "WhatsApp", onClick: () => window.open(enlace, "_blank", "noopener,noreferrer") },
      duration: 15000,
    })
  }

  // El chat y los archivos del detalle avisan cuántos hay, para el contador de la tarjeta.
  const cambiarConteo = useCallback((id: string, campo: "num_comentarios" | "num_archivos", cantidad: number) => {
    setTarjetas((actuales) =>
      actuales.some((t) => t.id === id && t[campo] !== cantidad)
        ? actuales.map((t) => (t.id === id ? { ...t, [campo]: cantidad } : t))
        : actuales
    )
  }, [])
  const cambiarCantidadComentarios = useCallback((id: string, cantidad: number) => cambiarConteo(id, "num_comentarios", cantidad), [cambiarConteo])
  const cambiarCantidadArchivos = useCallback((id: string, cantidad: number) => cambiarConteo(id, "num_archivos", cantidad), [cambiarConteo])

  // Vuelve a Por hacer, al final de la cola, con el nuevo responsable; el historial queda en el mismo pendiente.
  async function pasar(perfilId: string, nota: string) {
    if (!pasando) return false
    try {
      const pasado = await api.traspasar(credenciales, pasando.id, perfilId, nota)
      setTarjetas((actuales) => [...actuales.filter((t) => t.id !== pasado.id), aTarjeta(pasado)])
      setPasando(null)
      setError("")
      const nombre = perfilesPorId.get(perfilId)?.nombre ?? "otra persona"
      if (perfilId === usuario?.perfil_id) toast.success(`«${pasado.texto}» volvió a Por hacer contigo`)
      else avisarPorWhatsApp(pasado, `«${pasado.texto}» pasó a ${nombre}`)
      return true
    } catch (err) {
      fallar(err)
      return false
    }
  }

  // El cambio se ve al instante; la respuesta trae además el resumen de la descripción para la tarjeta.
  // Al dárselo a otra persona va al final de la cola de su columna, igual que en el servidor.
  const cambiarPendiente = useCallback(
    async (id: string, cambios: CambiosPendiente) => {
      const { descripcion: _descripcion, ...enLaTarjeta } = cambios
      const fecha = (t: Tarjeta) =>
        cambios.estado && cambios.estado !== t.estado ? { hecho_en: cambios.estado === "hecho" ? new Date().toISOString() : null } : {}
      setTarjetas((actuales) => {
        const antes = actuales.find((t) => t.id === id)
        if (!antes) return actuales
        const despues = aTarjeta({ ...antes, ...enLaTarjeta, ...fecha(antes) })
        const asignado = Boolean(cambios.perfil_id) && cambios.perfil_id !== antes.perfil_id
        return asignado ? [...actuales.filter((t) => t.id !== id), despues] : actuales.map((t) => (t.id === id ? despues : t))
      })
      try {
        const actualizado = await api.actualizar(credenciales, id, cambios)
        setTarjetas((actuales) => actuales.map((t) => (t.id === id ? aTarjeta(actualizado) : t)))
        return actualizado
      } catch (err) {
        fallar(err)
        recargar()
        return null
      }
    },
    [credenciales, fallar, recargar]
  )

  const cerrarDetalle = useCallback(() => setAbierto(null), [])

  async function borrar(tarjeta: Pendiente) {
    if (abierto === tarjeta.id) setAbierto(null)
    setTarjetas((actuales) => actuales.filter((t) => t.id !== tarjeta.id))
    try {
      await api.borrar(credenciales, tarjeta.id)
    } catch (err) {
      fallar(err)
      recargar()
    }
  }

  // Borra los hechos que se ven (con un filtro activo, solo los de ese filtro).
  async function borrarHechos() {
    const ids = new Set(hechosVisibles.map((tarjeta) => tarjeta.id))
    if (abierto && ids.has(abierto)) setAbierto(null)
    setTarjetas((actuales) => actuales.filter((t) => !ids.has(t.id)))
    try {
      await Promise.all([...ids].map((id) => api.borrar(credenciales, id)))
    } catch (err) {
      fallar(err)
      recargar()
    }
  }

  const crearProyecto = useCallback(
    async (datos: { nombre: string; organizacion_id: string | null }) => {
      try {
        const nuevo = await api.proyectos.crear(credenciales, datos)
        setCatalogo((actual) => conProyecto(actual, nuevo))
        setError("")
        return nuevo
      } catch (err) {
        fallar(err)
        return null
      }
    },
    [credenciales, fallar]
  )

  const crearEtiqueta = useCallback(
    async (nombre: string) => {
      try {
        const nueva = await api.etiquetas.crear(credenciales, { nombre })
        setEtiquetas((actuales) => [...actuales, nueva])
        setError("")
        return nueva
      } catch (err) {
        fallar(err)
        return null
      }
    },
    [credenciales, fallar]
  )

  // Se quita de todo el tablero.
  const borrarEtiqueta = useCallback(
    async (etiqueta: Etiqueta) => {
      setEtiquetas((actuales) => actuales.filter((e) => e.id !== etiqueta.id))
      setTarjetas((actuales) =>
        actuales.map((t) => (t.etiquetas.includes(etiqueta.id) ? { ...t, etiquetas: t.etiquetas.filter((id) => id !== etiqueta.id) } : t))
      )
      try {
        await api.etiquetas.borrar(credenciales, etiqueta.id)
      } catch (err) {
        fallar(err)
        recargar()
      }
    },
    [credenciales, fallar, recargar]
  )

  // Con la ventana del navegador si la ofrece; si no (Safari, Firefox…), los pasos para hacerlo a mano.
  async function instalarApp() {
    const resultado = await instalar()
    if (resultado === null) setVentana("instalar")
    else if (resultado === "accepted") toast.success("Listo: el tablero quedó instalado", { description: "Ábrelo desde el Dock, el Launchpad o el menú Inicio." })
  }

  // Lo que crea la IA entra en su orden: arriba del tablero lo que no tiene responsable, y al final de su cola lo asignado.
  function agregarCreados(nuevos: Pendiente[]) {
    const resto = (actuales: Tarjeta[]) => actuales.filter((t) => !nuevos.some((n) => n.id === t.id))
    setTarjetas((actuales) => [
      ...nuevos.filter((n) => !n.perfil_id).map(aTarjeta),
      ...resto(actuales),
      ...nuevos.filter((n) => n.perfil_id).map(aTarjeta),
    ])
    toast.success(nuevos.length === 1 ? "Se creó 1 pendiente" : `Se crearon ${nuevos.length} pendientes`)
  }

  async function crearPerfil(datos: { nombre: string; color: string; correo: string | null; telefono: string | null }) {
    try {
      const nuevo = await api.perfiles.crear(credenciales, datos)
      setPerfiles((actuales) => [...actuales, nuevo])
      return null
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
      return mensajeDeError(err)
    }
  }

  // En un perfil ajeno los datos van antes que la contraseña: con contraseña ya solo lo edita esa persona.
  // En el propio, la contraseña va primero y las credenciales guardadas se rehacen para seguir dentro.
  async function actualizarPerfil(perfil: Perfil, { contrasena, ...datos }: CambiosPerfil) {
    const esYo = perfil.id === usuario?.perfil_id
    let actuales = credenciales
    try {
      let actualizado = perfil
      // El teléfono se compara por sus dígitos, que es como lo guarda el servidor.
      const comparable = (campo: string, valor: string | null) =>
        campo === "color" ? valor?.toUpperCase() : campo === "telefono" ? (valor ?? "").replace(/\D/g, "").replace(/^00/, "") || null : valor
      const cambios = Object.fromEntries(
        Object.entries(datos).filter(
          ([campo, valor]) => comparable(campo, valor) !== comparable(campo, perfil[campo as keyof Perfil] as string | null)
        )
      )
      const guardarDatos = async () => {
        if (Object.keys(cambios).length) actualizado = await api.perfiles.actualizar(actuales, perfil.id, cambios)
      }
      if (!esYo) await guardarDatos()
      if (contrasena) {
        actualizado = await api.perfiles.ponerContrasena(actuales, perfil.id, contrasena)
        if (esYo) actuales = crearCredenciales(partesDe(actuales).usuario, contrasena)
      }
      if (esYo) await guardarDatos()
      if (esYo && (contrasena || cambios.nombre)) actuales = crearCredenciales(actualizado.nombre, partesDe(actuales).contrasena)
      setPerfiles((lista) => lista.map((p) => (p.id === perfil.id ? actualizado : p)))
      return null
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
      return mensajeDeError(err)
    } finally {
      if (actuales !== credenciales) onCredenciales(actuales)
    }
  }

  async function borrarPerfil(perfil: Perfil) {
    try {
      await api.perfiles.borrar(credenciales, perfil.id)
      if (perfil.id === usuario?.perfil_id) {
        onSalir()
        return null
      }
      setPerfiles((actuales) => actuales.filter((p) => p.id !== perfil.id))
      setTarjetas((actuales) => actuales.map((t) => (t.perfil_id === perfil.id ? { ...t, perfil_id: null } : t)))
      if (filtroPerfil === perfil.id) setFiltroPerfil(null)
      if (responsable === perfil.id) setResponsable(NADIE)
      return null
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
      return mensajeDeError(err)
    }
  }

  // El tablero nunca tiene todo (los hechos viejos no están): su nuevo orden se acomoda en la lista completa.
  // Lo que cambia de columna anota (o borra) cuándo se terminó, como hará el servidor.
  function cambiarTablero(nuevas: Tarjeta[]) {
    const columnaAntes = new Map(ultimas.current.map((tarjeta) => [tarjeta.id, tarjeta.column]))
    const momento = new Date().toISOString()
    const conFecha = nuevas.map((tarjeta) =>
      columnaAntes.get(tarjeta.id) === tarjeta.column ? tarjeta : { ...tarjeta, hecho_en: tarjeta.column === "hecho" ? momento : null }
    )
    const todas = mezclar(ultimas.current, conFecha)
    ultimas.current = todas
    setTarjetas(todas)
  }

  // Empieza con lo que tenga el buscador de Hecho.
  function abrirHechosAnteriores() {
    setBusquedaHechos(busquedas.hecho ?? "")
    setHechosAbiertos(true)
  }

  function alEmpezarArrastre(event: DragStartEvent) {
    setArrastrada(String(event.active.id))
    arrastrando.current = true
    ordenAlEmpezar.current = firmaDelOrden(ultimas.current)
  }

  function alSoltar() {
    // Kibo avisa onDragEnd antes de su último onDataChange: se espera un tick para leer el orden final.
    setTimeout(async () => {
      arrastrando.current = false
      setArrastrada(null)
      const finales = ultimas.current
      const pendienteDeRecarga = recargarAlSoltar.current
      recargarAlSoltar.current = false
      if (firmaDelOrden(finales) === ordenAlEmpezar.current) {
        if (pendienteDeRecarga) recargar()
        return
      }
      try {
        await api.ordenar(credenciales, finales.map((tarjeta) => ({ id: tarjeta.id, estado: tarjeta.column as Estado })))
        if (pendienteDeRecarga) recargar()
      } catch (err) {
        fallar(err)
        recargar()
      }
    })
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-[100rem] items-center gap-3 px-4 py-4 md:px-6 lg:px-10">
          <span className="mr-1 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_22px_-2px] shadow-primary/60">
            <ClipboardList className="size-5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Pendientes</h1>
          {!cargando && (
            <span className="hidden rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground min-[400px]:inline">
              {abiertos} {abiertos === 1 ? "abierto" : "abiertos"}
            </span>
          )}
          <EstadoConexion />
          {/* En pantallas angostas solo quedan la campana y la cuenta; lo demás va en el menú de la cuenta. */}
          <div className="ml-auto flex items-center gap-1">
            <div className="hidden items-center gap-1 md:flex">
              {/* Solo cuando el navegador puede instalarlo con un clic; si no, queda en el menú de la cuenta. */}
              {instalacion.directa && !instalacion.instalada && (
                <Button variant="ghost" onClick={instalarApp}>
                  <MonitorDown /> Instalar
                </Button>
              )}
              <Button variant="ghost" onClick={() => setVentana("proyectos")}>
                <FolderKanban /> Proyectos
              </Button>
              <Button variant="ghost" onClick={() => setVentana("perfiles")}>
                <Users /> Perfiles
              </Button>
              <Button variant="ghost" onClick={() => setVentana("actividad")}>
                <History /> Actividad
              </Button>
              {usuario?.notas && (
                <Button asChild variant="ghost">
                  <a href="/pendientes/notas">
                    <NotebookPen /> Notas
                  </a>
                </Button>
              )}
              <Button asChild variant="ghost">
                <a href="/" aria-label="Timer">
                  <Timer /> <span className="hidden lg:inline">Timer</span>
                </a>
              </Button>
            </div>
            {usuario?.perfil_id && (
              <Notificaciones
                credenciales={credenciales}
                yo={usuario.perfil_id}
                perfilesPorId={perfilesPorId}
                abribles={abribles}
                pendienteAbierto={abierto}
                onAbrir={abrirPendiente}
                onNovedades={recargarPronto}
                onSinLeer={(lista) => setSinLeer(new Map(lista.map((pendiente) => [pendiente.pendiente_id, pendiente])))}
                onSalir={onSalir}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2" aria-label={`Cuenta: ${usuario?.nombre ?? ""}`}>
                  {miPerfil ? <PerfilAvatar perfil={miPerfil} size="sm" /> : <UsersRound />}
                  <span className="hidden max-w-32 truncate md:inline">{usuario?.nombre}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuLabel className="font-normal text-muted-foreground">
                  {usuario?.perfil_id ? `Entraste como ${usuario.nombre}` : "Entraste con la cuenta del equipo"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="md:hidden" onSelect={() => setVentana("proyectos")}>
                  <FolderKanban /> Proyectos
                </DropdownMenuItem>
                <DropdownMenuItem className="md:hidden" onSelect={() => setVentana("perfiles")}>
                  <Users /> Perfiles
                </DropdownMenuItem>
                <DropdownMenuItem className="md:hidden" onSelect={() => setVentana("actividad")}>
                  <History /> Actividad
                </DropdownMenuItem>
                {usuario?.notas && (
                  <DropdownMenuItem className="md:hidden" asChild>
                    <a href="/pendientes/notas">
                      <NotebookPen /> Notas
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="md:hidden" asChild>
                  <a href="/">
                    <Timer /> Timer
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="md:hidden" />
                <DropdownMenuItem onSelect={() => setVentana("ia")}>
                  <Sparkles /> Inteligencia artificial
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setVentana("apariencia")}>
                  <Type /> Apariencia
                </DropdownMenuItem>
                {!instalacion.instalada && (
                  <DropdownMenuItem onSelect={instalarApp}>
                    <MonitorDown /> Instalar en el escritorio
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onSalir}>
                  <LogOut /> Salir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[100rem] flex-col gap-5 px-4 py-5 md:px-6 md:py-6 lg:px-10">
        <form onSubmit={agregar} className="flex flex-col gap-3 sm:flex-row">
          <InputGroup className="h-11 sm:flex-1">
            <InputGroupAddon className="pl-3">
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              ref={campoTexto}
              aria-label="Nuevo pendiente"
              placeholder="¿Qué falta hacer? (fix: o feat: le pone tipo)"
              value={texto}
              onChange={(event) => setTexto(event.target.value)}
              maxLength={500}
            />
            {destino !== "pendiente" && columnaDestino && (
              <InputGroupAddon align="inline-end">
                <span className="flex items-center gap-1.5 rounded-md bg-muted py-0.5 pr-0.5 pl-2 text-xs font-normal text-foreground">
                  <span className="size-2 rounded-full" style={{ backgroundColor: columnaDestino.color }} />
                  en {columnaDestino.name}
                  <InputGroupButton size="icon-xs" aria-label="Agregar en Por hacer" onClick={() => setDestino("pendiente")}>
                    <X />
                  </InputGroupButton>
                </span>
              </InputGroupAddon>
            )}
          </InputGroup>
          <ProyectoCombobox
            valor={proyectoDelFormulario}
            onCambiar={setProyectoId}
            catalogo={catalogo}
            onCrear={crearProyecto}
            className="h-11 w-full sm:w-60"
          />
          <Select value={responsableDelFormulario} onValueChange={setResponsable}>
            <SelectTrigger aria-label="Responsable" className="w-full px-3 data-[size=default]:h-11 sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {personasDelFormulario.map((perfil) => (
                <SelectItem key={perfil.id} value={perfil.id}>
                  <PerfilAvatar perfil={perfil} size="sm" /> {perfil.nombre}
                </SelectItem>
              ))}
              <SelectItem value={NADIE}>
                <PerfilAvatar perfil={null} size="sm" /> Sin asignar
              </SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-3">
            <Button type="submit" className="h-11 flex-1 px-5 sm:flex-none">
              <Plus /> Agregar
            </Button>
            <Button type="button" variant="outline" className="h-11 flex-1 sm:flex-none" aria-label="Crear con IA" onClick={() => setVentana("crear-ia")}>
              <Sparkles className="text-primary" /> <span className="sm:hidden xl:inline">Crear con IA</span>
              <span className="hidden sm:inline xl:hidden">IA</span>
            </Button>
          </div>
        </form>

        {usuario && usuario.perfil_id === null && !sinAvisoEquipo && (
          <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="m-0 flex-1">
              Entraste con la cuenta del equipo, así que solo ves lo compartido. Ponle contraseña a tu perfil en{" "}
              <strong className="font-medium">Perfiles</strong> y entra con tu nombre para tener organizaciones privadas.
            </p>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Cerrar aviso"
              onClick={() => {
                setSinAvisoEquipo(true)
                try {
                  localStorage.setItem(AVISO_EQUIPO, "1")
                } catch {
                  // Sin almacenamiento el aviso vuelve a salir al recargar.
                }
              }}
            >
              <X />
            </Button>
          </div>
        )}

        {(perfiles.length > 0 || hayCatalogo || etiquetas.length > 0) && (
          <div className="flex flex-col gap-2.5">
            {hayCatalogo && (
              <Collapsible open={!compacto} onOpenChange={(abierto) => setCompacto(!abierto)} className="flex flex-col gap-2.5">
                {compacto && (
                  <div className="flex">
                    <CollapsibleTrigger asChild>
                      <Filtro activo={organizacionFiltrada !== null} aria-pressed={undefined} aria-label="Mostrar organizaciones y proyectos">
                        {organizacionDelFiltro ? (
                          <span className="size-2.5 rounded-full" style={{ backgroundColor: organizacionDelFiltro.color }} />
                        ) : organizacionFiltrada === SIN_ORGANIZACION ? (
                          <CircleDashed className="text-muted-foreground" />
                        ) : (
                          <Building2 />
                        )}
                        {organizacionDelFiltro?.nombre ?? (organizacionFiltrada === SIN_ORGANIZACION ? "Sin organización" : "Todas las organizaciones")}
                        {proyectoFiltrado && (
                          <>
                            <ChevronRight className="text-muted-foreground" />
                            <Folder className="text-muted-foreground" /> {proyectosPorId.get(proyectoFiltrado)?.nombre}
                          </>
                        )}
                        <Contador valor={enAlcance.length} />
                        <ChevronDown className="text-muted-foreground" />
                      </Filtro>
                    </CollapsibleTrigger>
                  </div>
                )}
                <CollapsibleContent className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por organización">
                    <Filtro activo={organizacionFiltrada === null} onClick={() => filtrarPorOrganizacion(null)}>
                      <Building2 /> Todas
                    </Filtro>
                    {grupos.map(({ organizacion, proyectos }) => {
                      const clave = organizacion?.id ?? SIN_ORGANIZACION
                      const cantidad = porOrganizacion.get(clave) ?? 0
                      // "Sin organización" solo sale si tiene algo.
                      if (!organizacion && cantidad === 0 && proyectos.length === 0) return null
                      return (
                        <Filtro
                          key={clave}
                          activo={organizacionFiltrada === clave}
                          onClick={() => filtrarPorOrganizacion(organizacionFiltrada === clave ? null : clave)}
                        >
                          {organizacion ? (
                            <span className="size-2.5 rounded-full" style={{ backgroundColor: organizacion.color }} />
                          ) : (
                            <CircleDashed className="text-muted-foreground" />
                          )}
                          {organizacion?.nombre ?? "Sin organización"}
                          {organizacion && !organizacion.compartida && <Lock className="text-muted-foreground" aria-label="Privada" />}
                          <Contador valor={cantidad} />
                        </Filtro>
                      )
                    })}
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-10 text-muted-foreground" aria-label="Comprimir organizaciones y proyectos" title="Comprimir">
                        <ChevronsDownUp />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  {proyectosDelFiltro.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por proyecto">
                      <Filtro activo={proyectoFiltrado === null} onClick={() => filtrarPorProyecto(null)}>
                        <FolderOpen /> Todos los proyectos
                      </Filtro>
                      {proyectosDelFiltro.map((proyecto) => (
                        <Filtro
                          key={proyecto.id}
                          activo={proyectoFiltrado === proyecto.id}
                          onClick={() => filtrarPorProyecto(proyectoFiltrado === proyecto.id ? null : proyecto.id)}
                        >
                          <Folder className="text-muted-foreground" /> {proyecto.nombre} <Contador valor={porProyecto.get(proyecto.id) ?? 0} />
                        </Filtro>
                      ))}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
            {perfiles.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label={organizacionDelFiltro ? `Filtrar por persona de ${organizacionDelFiltro.nombre}` : "Filtrar por persona"}
              >
                <Filtro activo={perfilFiltrado === null} onClick={() => filtrarPorPerfil(null)}>
                  <Layers /> Todos
                </Filtro>
                {[...personasDelFiltro, null].map((perfil) => {
                  const clave = perfil?.id ?? NADIE
                  return (
                    <Filtro
                      key={clave}
                      activo={perfilFiltrado === clave}
                      onClick={() => filtrarPorPerfil(perfilFiltrado === clave ? null : clave)}
                    >
                      {perfil ? (
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: perfil.color }} />
                      ) : (
                        <CircleDashed className="text-muted-foreground" />
                      )}
                      {perfil?.nombre ?? "Sin asignar"} <Contador valor={asignadosEnAlcance.get(clave) ?? 0} />
                    </Filtro>
                  )
                })}
                {organizacionDelFiltro?.compartida && (
                  <InvolucradosMenu
                    organizacion={organizacionDelFiltro}
                    perfiles={perfiles}
                    onCambiar={(miembros) => cambiarInvolucrados(organizacionDelFiltro, miembros)}
                    onNuevoPerfil={() => setVentana("perfiles")}
                    align="start"
                  >
                    <Button variant="ghost" className="h-10 text-muted-foreground" aria-label={`Agregar o quitar personas de ${organizacionDelFiltro.nombre}`}>
                      <UserPlus /> <span className="hidden sm:inline">Personas</span>
                    </Button>
                  </InvolucradosMenu>
                )}
              </div>
            )}
            {(tiposEnUso.length > 0 || etiquetas.length > 0) && (
              <div className="flex">
                <FiltroMarca
                  valor={marcaFiltrada}
                  onCambiar={setFiltroMarca}
                  tipos={tiposEnUso}
                  etiquetas={etiquetasOrdenadas}
                  porTipo={porTipo}
                  porEtiqueta={porEtiqueta}
                  total={paraMarcas.length}
                />
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {cargando ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <div className="overflow-x-auto pb-2">
            <KanbanProvider
              className="min-w-[56rem] gap-5 md:min-w-0"
              columns={COLUMNAS}
              data={enColumnas}
              onDataChange={cambiarTablero}
              onDragStart={alEmpezarArrastre}
              onDragEnd={alSoltar}
            >
              {(columna) => {
                const cantidad = visibles.filter((tarjeta) => tarjeta.column === columna.id).length
                const busqueda = busquedas[columna.id] ?? ""
                const buscando = busqueda.trim() !== ""
                const enPantalla = buscando ? enColumnas.filter((tarjeta) => tarjeta.column === columna.id).length : cantidad
                const buscar = (texto: string) => setBusquedas((actuales) => ({ ...actuales, [columna.id]: texto }))
                const Icono = ICONOS[columna.id]
                return (
                  <KanbanBoard
                    id={columna.id}
                    key={columna.id}
                    // Cada columna se tiñe con su color: el fondo apenas, el encabezado un poco más.
                    style={{ "--tono": columna.color } as CSSProperties}
                    className="min-h-[28rem] divide-y-0 rounded-none border-[color-mix(in_oklab,var(--tono)_20%,var(--color-border))] bg-[color-mix(in_oklab,var(--tono)_4%,var(--color-columna))] text-sm shadow-none"
                  >
                    <KanbanHeader className="flex items-center gap-2.5 bg-[color-mix(in_oklab,var(--tono)_10%,transparent)] py-3 pr-2 pl-4">
                      <span className="size-2.5 shrink-0 rounded-full bg-(--tono)" />
                      <Icono className="size-4.5 shrink-0 text-foreground/80" />
                      <h2 className="text-sm font-semibold">{columna.name}</h2>
                      <span className="ml-auto rounded-md bg-background/60 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                        {buscando ? `${enPantalla} de ${cantidad}` : cantidad}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Opciones de ${columna.name}`}>
                            <MoreVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="min-w-52"
                          onCloseAutoFocus={(event) => {
                            const despues = alCerrarMenu.current
                            if (!despues) return
                            event.preventDefault()
                            alCerrarMenu.current = null
                            despues()
                          }}
                        >
                          <DropdownMenuItem
                            onSelect={() => {
                              setDestino(columna.id)
                              alCerrarMenu.current = () => campoTexto.current?.focus()
                            }}
                          >
                            <Plus /> Agregar pendiente aquí
                          </DropdownMenuItem>
                          {columna.id === "hecho" && (
                            <>
                              <DropdownMenuItem
                                onSelect={() => {
                                  alCerrarMenu.current = abrirHechosAnteriores
                                }}
                              >
                                <Search /> Buscar hechos anteriores
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={cantidad === 0}
                                onSelect={() => {
                                  alCerrarMenu.current = () => setConfirmarLimpieza(true)
                                }}
                              >
                                <Trash2 /> {cantidad === 1 ? "Borrar el hecho" : `Borrar los ${cantidad} hechos`}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </KanbanHeader>
                    <div className="px-3 pt-3">
                      <InputGroup className="h-8 bg-background/50">
                        <InputGroupAddon className="pl-2.5">
                          <Search />
                        </InputGroupAddon>
                        <InputGroupInput
                          aria-label={`Buscar en ${columna.name}`}
                          placeholder={`Buscar en ${columna.name}`}
                          value={busqueda}
                          onChange={(event) => buscar(event.target.value)}
                          onKeyDown={(event) => event.key === "Escape" && buscar("")}
                        />
                        {busqueda && (
                          <InputGroupAddon align="inline-end">
                            <InputGroupButton size="icon-xs" aria-label={`Limpiar la búsqueda de ${columna.name}`} onClick={() => buscar("")}>
                              <X />
                            </InputGroupButton>
                          </InputGroupAddon>
                        )}
                      </InputGroup>
                    </div>
                    <KanbanCards id={columna.id} className={enPantalla === 0 ? "p-0" : "gap-2.5 p-3"}>
                      {(tarjeta: Tarjeta) => {
                        const perfil = tarjeta.perfil_id ? perfilesPorId.get(tarjeta.perfil_id) : null
                        const proyecto = tarjeta.proyecto_id ? proyectosPorId.get(tarjeta.proyecto_id) : null
                        const organizacion = proyecto?.organizacion_id ? organizacionesPorId.get(proyecto.organizacion_id) : null
                        const susEtiquetas = tarjeta.etiquetas.flatMap((id) => etiquetasPorId.get(id) ?? []).sort(porNombre)
                        // El borde toma el color de su tipo; sin tipo, el de su primera etiqueta.
                        const colorBorde = tipoDe(tarjeta.tipo)?.color ?? susEtiquetas[0]?.color
                        const aviso = sinLeer.get(tarjeta.id)
                        return (
                          <KanbanCard
                            column={columna.id}
                            id={tarjeta.id}
                            key={tarjeta.id}
                            name={tarjeta.name}
                            cardStyle={colorBorde ? ({ "--borde": colorBorde } as CSSProperties) : undefined}
                            className={cn(
                              "rounded-none transition-shadow",
                              colorBorde ? "ring-(--borde)/70 hover:ring-2 hover:ring-(--borde)" : "ring-border hover:ring-primary/50"
                            )}
                          >
                            <div
                              className="flex flex-col gap-2"
                              onClick={(event) => !arrastrando.current && esClicEnLaTarjeta(event) && setAbierto(tarjeta.id)}
                            >
                              <div className="flex items-start gap-1">
                                {/* Con el teclado, Enter en la tarjeta la arrastra; este botón abre el detalle. */}
                                <button
                                  type="button"
                                  className="m-0 flex-1 rounded-sm text-left text-sm font-medium break-words outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label={`Abrir "${tarjeta.texto}"`}
                                  onKeyDown={detener}
                                  onClick={() => !arrastrando.current && setAbierto(tarjeta.id)}
                                >
                                  {tarjeta.tipo ? (
                                    <InsigniaTipo tipo={tarjeta.tipo} className="mr-1.5 align-[1px]" />
                                  ) : (
                                    eligiendoTipo.has(tarjeta.id) && <InsigniaEligiendo className="mr-1.5 align-[1px]" />
                                  )}
                                  {tarjeta.texto}
                                </button>
                                {/* Avisos sin leer de quien entró; una mención resalta. Se leen al abrir la tarjeta. */}
                                {aviso && (
                                  <span
                                    role="img"
                                    aria-label={descripcionAviso(aviso)}
                                    title={descripcionAviso(aviso)}
                                    className={cn(
                                      "mt-px flex h-5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[11px] leading-none font-semibold tabular-nums",
                                      aviso.menciones > 0 ? "bg-primary text-primary-foreground shadow-sm shadow-primary/40" : "bg-primary/15 text-primary"
                                    )}
                                  >
                                    {aviso.menciones > 0 ? <BellRing className="size-3" /> : <Bell className="size-3" />}
                                    {aviso.menciones > 0 ? "@" : aviso.avisos > 1 && aviso.avisos}
                                  </span>
                                )}
                                {tarjeta.column === "hecho" && (
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="text-muted-foreground hover:text-primary"
                                    aria-label={`Pasar "${tarjeta.texto}" a otra persona`}
                                    title="Pasar a otra persona (vuelve a Por hacer)"
                                    {...noArrastrar}
                                    onClick={() => setPasando(tarjeta)}
                                  >
                                    <Forward />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="text-muted-foreground hover:text-destructive"
                                  aria-label={`Borrar "${tarjeta.texto}"`}
                                  {...noArrastrar}
                                  onClick={() => borrar(tarjeta)}
                                >
                                  <Trash2 />
                                </Button>
                              </div>
                              {tarjeta.resumen && (
                                <p className="m-0 line-clamp-2 text-xs text-muted-foreground">{tarjeta.resumen}</p>
                              )}
                              {susEtiquetas.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {susEtiquetas.map((etiqueta) => (
                                    <span
                                      key={etiqueta.id}
                                      className="inline-flex max-w-full items-center gap-1 border px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground"
                                    >
                                      <PuntoEtiqueta etiqueta={etiqueta} className="size-1.5" />
                                      <span className="truncate">{etiqueta.nombre}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              <div className="flex min-w-0 items-center gap-2">
                                {proyecto && (
                                  <Badge
                                    variant="secondary"
                                    className="min-w-0 shrink justify-start gap-1.5"
                                    title={organizacion ? `${organizacion.nombre} › ${proyecto.nombre}` : proyecto.nombre}
                                  >
                                    {organizacion ? (
                                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: organizacion.color }} />
                                    ) : (
                                      <Folder />
                                    )}
                                    <span className="truncate">
                                      {organizacion && <span className="text-muted-foreground">{organizacion.nombre} › </span>}
                                      {proyecto.nombre}
                                    </span>
                                    {organizacion && !organizacion.compartida && <Lock aria-label="Privado" />}
                                  </Badge>
                                )}
                                {tarjeta.num_comentarios > 0 && (
                                  <span
                                    className="flex items-center gap-1 text-xs text-muted-foreground"
                                    title={tarjeta.num_comentarios === 1 ? "1 mensaje" : `${tarjeta.num_comentarios} mensajes`}
                                  >
                                    <MessageSquare className="size-3.5" /> {tarjeta.num_comentarios}
                                  </span>
                                )}
                                {tarjeta.num_archivos > 0 && (
                                  <span
                                    className="flex items-center gap-1 text-xs text-muted-foreground"
                                    title={tarjeta.num_archivos === 1 ? "1 archivo" : `${tarjeta.num_archivos} archivos`}
                                  >
                                    <Paperclip className="size-3.5" /> {tarjeta.num_archivos}
                                  </span>
                                )}
                                {tarjeta.num_imagenes > 0 && (
                                  <span
                                    className="flex items-center gap-1 text-xs text-muted-foreground"
                                    title={tarjeta.num_imagenes === 1 ? "1 imagen" : `${tarjeta.num_imagenes} imágenes`}
                                  >
                                    <ImageIcon className="size-3.5" /> {tarjeta.num_imagenes}
                                  </span>
                                )}
                                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                  {fecha.format(new Date(tarjeta.creado_en))}
                                </span>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      aria-label={perfil ? `Asignado a ${perfil.nombre}; cambiar` : "Asignar a alguien"}
                                      {...noArrastrar}
                                    >
                                      <PerfilAvatar perfil={perfil} size="sm" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="min-w-44">
                                    <DropdownMenuLabel>Asignar a</DropdownMenuLabel>
                                    <DropdownMenuRadioGroup
                                      value={tarjeta.perfil_id ?? NADIE}
                                      onValueChange={(valor) => cambiarPendiente(tarjeta.id, { perfil_id: valor === NADIE ? null : valor })}
                                    >
                                      {involucrados(perfiles, organizacion, tarjeta.perfil_id).map((opcion) => (
                                        <DropdownMenuRadioItem key={opcion.id} value={opcion.id}>
                                          <PerfilAvatar perfil={opcion} size="sm" /> {opcion.nombre}
                                        </DropdownMenuRadioItem>
                                      ))}
                                      <DropdownMenuSeparator />
                                      <DropdownMenuRadioItem value={NADIE}>
                                        <PerfilAvatar perfil={null} size="sm" /> Sin asignar
                                      </DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </KanbanCard>
                        )
                      }}
                    </KanbanCards>
                    {cantidad > 0 && enPantalla === 0 && (
                      <Empty className="m-3 mt-3 w-auto gap-3 rounded-none border border-dashed border-[color-mix(in_oklab,var(--tono)_22%,var(--color-border))] p-6">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <SearchX />
                          </EmptyMedia>
                          <EmptyTitle className="text-base font-semibold break-all">Nada con «{busqueda.trim()}»</EmptyTitle>
                          <EmptyDescription className="max-w-64 text-sm">Busca por título, descripción, proyecto, persona, tipo o etiqueta.</EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          <Button variant="outline" size="sm" onClick={() => buscar("")}>
                            <X /> Limpiar búsqueda
                          </Button>
                        </EmptyContent>
                      </Empty>
                    )}
                    {cantidad === 0 && (
                      <Empty className="m-3 w-auto gap-3 rounded-none border border-[color-mix(in_oklab,var(--tono)_22%,var(--color-border))] p-6">
                        <EmptyHeader>
                          <EmptyMedia>
                            <IlustracionColumna estado={columna.id} />
                          </EmptyMedia>
                          <EmptyTitle className="text-lg font-semibold">Nada por aquí</EmptyTitle>
                          <EmptyDescription className="max-w-64 text-sm">{VACIO[columna.id]}</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                    {columna.id === "hecho" && antiguosEnBusqueda.length > 0 && (
                      <button
                        type="button"
                        onClick={abrirHechosAnteriores}
                        className="m-3 mt-auto flex items-center justify-center gap-2 border border-dashed border-[color-mix(in_oklab,var(--tono)_30%,var(--color-border))] px-3 py-2.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <Search className="size-4" />
                        {antiguosEnBusqueda.length === 1 ? "1 hecho anterior" : `${antiguosEnBusqueda.length} hechos anteriores`}
                        {buscando && ` con «${busqueda.trim()}»`} · Buscar
                      </button>
                    )}
                  </KanbanBoard>
                )
              }}
            </KanbanProvider>
          </div>
        )}

        <p className="m-0 flex items-center gap-4 rounded-none border border-dashed px-5 py-4 text-sm text-muted-foreground">
          <Keyboard className="size-6 shrink-0" />
          Arrastra las tarjetas entre columnas. Toca una tarjeta para abrir su detalle: descripción e imágenes (también se pegan con Ctrl+V o ⌘V).
          Empieza con «fix:» o «feat:» para darle tipo. Hecho muestra los últimos 7 días; lo anterior se busca al pie de la columna.
        </p>
      </main>

      <AlertDialog open={confirmarLimpieza} onOpenChange={setConfirmarLimpieza}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hechosVisibles.length === 1 ? "¿Borrar el pendiente hecho?" : `¿Borrar los ${hechosVisibles.length} pendientes hechos?`}
            </AlertDialogTitle>
            <AlertDialogDescription>También se borran sus descripciones e imágenes. No se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={borrarHechos}>
              Sí, borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ProyectosDialog
        abierto={ventana === "proyectos"}
        onAbiertoChange={(siguiente) => setVentana(siguiente ? "proyectos" : null)}
        credenciales={credenciales}
        catalogo={catalogo}
        onCatalogo={setCatalogo}
        perfiles={perfiles}
        usuario={usuario}
        pendientesPorProyecto={porProyecto}
        onSalir={onSalir}
      />
      {/* Se carga al abrirla: el campo de WhatsApp trae las banderas y los formatos de cada país. */}
      {perfilesAbiertos && (
        <Suspense fallback={null}>
          <PerfilesDialog
            abierto={ventana === "perfiles"}
            onAbiertoChange={(siguiente) => setVentana(siguiente ? "perfiles" : null)}
            perfiles={perfiles}
            asignados={asignados}
            usuario={usuario}
            onCrear={crearPerfil}
            onActualizar={actualizarPerfil}
            onBorrar={borrarPerfil}
          />
        </Suspense>
      )}
      <InstalarDialog abierto={ventana === "instalar"} onAbiertoChange={(siguiente) => setVentana(siguiente ? "instalar" : null)} />
      <AparienciaDialog
        abierto={ventana === "apariencia"}
        onAbiertoChange={(siguiente) => setVentana(siguiente ? "apariencia" : null)}
        credenciales={credenciales}
        actual={apariencia}
        esEquipo={!usuario?.perfil_id}
        onGuardado={(guardada) => {
          setUsuario((antes) => antes && { ...antes, apariencia: guardada })
          toast.success("Apariencia guardada")
        }}
        onSalir={onSalir}
      />
      {iaAbierta && (
        <Suspense fallback={null}>
          <IaDialog
            abierto={ventana === "ia"}
            onAbiertoChange={(siguiente) => {
              if (siguiente) return setVentana("ia")
              setVentana(volverACrear.current ? "crear-ia" : null)
              volverACrear.current = false
            }}
            credenciales={credenciales}
            onGuardado={() => toast.success("IA configurada")}
            onSalir={onSalir}
          />
          <CrearConIaDialog
            abierto={ventana === "crear-ia"}
            onAbiertoChange={(siguiente) => setVentana(siguiente ? "crear-ia" : null)}
            credenciales={credenciales}
            catalogo={catalogo}
            perfiles={perfiles}
            etiquetas={etiquetas}
            proyectoPorDefecto={proyectoDelFormulario}
            onCrearProyecto={crearProyecto}
            onCrearEtiqueta={crearEtiqueta}
            onCreados={agregarCreados}
            onConfigurar={() => {
              volverACrear.current = true
              setVentana("ia")
            }}
            onSalir={onSalir}
          />
        </Suspense>
      )}
      <HechosAnteriores
        abierto={hechosAbiertos}
        onAbiertoChange={setHechosAbiertos}
        busqueda={busquedaHechos}
        onBusquedaChange={setBusquedaHechos}
        pendientes={antiguosVisibles}
        filtrando={filtrando}
        perfilesPorId={perfilesPorId}
        etiquetasPorId={etiquetasPorId}
        etiquetaDeProyecto={etiquetaDeProyecto}
        onAbrir={abrirPendiente}
      />
      <ActividadSheet
        credenciales={credenciales}
        abierto={ventana === "actividad"}
        onAbiertoChange={(siguiente) => setVentana(siguiente ? "actividad" : null)}
        yo={usuario?.perfil_id ?? null}
        abribles={abribles}
        onAbrir={abrirPendiente}
        onSalir={onSalir}
      />
      <PasarDialog
        pendiente={pasando}
        personas={pasando ? involucrados(perfiles, organizacionDe(catalogo, pasando.proyecto_id)) : []}
        onCerrar={() => setPasando(null)}
        onPasar={pasar}
      />
      <Toaster position="bottom-right" />

      <DetallePendiente
        credenciales={credenciales}
        pendiente={pendienteAbierto}
        usuario={usuario}
        perfiles={perfiles}
        catalogo={catalogo}
        etiquetas={etiquetas}
        onCrearProyecto={crearProyecto}
        onCrearEtiqueta={crearEtiqueta}
        onBorrarEtiqueta={borrarEtiqueta}
        onCambiar={cambiarPendiente}
        onCantidadComentarios={cambiarCantidadComentarios}
        onCantidadArchivos={cambiarCantidadArchivos}
        onPasar={setPasando}
        onBorrar={borrar}
        onCerrar={cerrarDetalle}
        onSalir={onSalir}
      />
    </div>
  )
}
