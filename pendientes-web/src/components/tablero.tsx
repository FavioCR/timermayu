import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react"
import {
  CircleCheck,
  CircleDashed,
  ClipboardList,
  Folder,
  FolderOpen,
  ImageIcon,
  Inbox,
  Keyboard,
  Layers,
  LogOut,
  MoreVertical,
  Plus,
  RotateCw,
  Search,
  Timer,
  Trash2,
  X,
} from "lucide-react"
import { cn } from "cn"

import { DetallePendiente } from "@/components/detalle-pendiente"
import { IlustracionColumna } from "@/components/ilustraciones"
import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from "@/components/kibo-ui/kanban"
import { PerfilAvatar } from "@/components/perfil-avatar"
import { PerfilesDialog } from "@/components/perfiles-dialog"
import { ProyectoCombobox } from "@/components/proyecto-combobox"
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, esNoAutorizado, mensajeDeError, type CambiosPendiente, type Estado, type Pendiente, type Perfil } from "@/lib/api"
import { COLUMNAS, NADIE } from "@/lib/estados"

const ICONOS: Record<Estado, typeof Inbox> = { pendiente: Inbox, haciendo: RotateCw, hecho: CircleCheck }

const VACIO: Record<Estado, string> = {
  pendiente: "Agrega una tarea o arrastra una tarjeta a esta columna.",
  haciendo: "Arrastra una tarjeta o crea una nueva tarea para empezar.",
  hecho: "Las tareas completadas aparecerán aquí automáticamente.",
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

// Tocar un botón dentro de la tarjeta no debe empezar a arrastrarla.
const detener = (event: SyntheticEvent) => event.stopPropagation()
const noArrastrar = { onMouseDown: detener, onTouchStart: detener, onKeyDown: detener }

// Un clic en la tarjeta abre su detalle, salvo que caiga en uno de sus botones o en un menú abierto desde ella.
const esClicEnLaTarjeta = (event: MouseEvent<HTMLElement>) =>
  event.currentTarget.contains(event.target as Node) && !(event.target as HTMLElement).closest("button, a, input")

function Contador({ valor }: { valor: number }) {
  return <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs leading-none tabular-nums text-muted-foreground">{valor}</span>
}

function Filtro({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-lg border bg-card px-3.5 text-sm font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
        activo && "border-primary bg-primary/25 ring-3 ring-primary/25 hover:bg-primary/30"
      )}
    >
      {children}
    </button>
  )
}

export function Tablero({ credenciales, onSalir }: { credenciales: string; onSalir: () => void }) {
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([])
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState("")
  const [filtroProyecto, setFiltroProyecto] = useState<string | null>(null)
  const [filtroPerfil, setFiltroPerfil] = useState<string | null>(null)
  const [texto, setTexto] = useState("")
  const [proyecto, setProyecto] = useState<string | null>(null)
  const [responsable, setResponsable] = useState(NADIE)
  // Columna donde cae lo que se agrega; se elige desde el menú de cada columna.
  const [destino, setDestino] = useState<Estado>("pendiente")
  const [abierto, setAbierto] = useState<string | null>(null)
  const [confirmarLimpieza, setConfirmarLimpieza] = useState(false)
  const ultimas = useRef<Tarjeta[]>([])
  const ordenAlEmpezar = useRef("")
  const arrastrando = useRef(false)
  const campoTexto = useRef<HTMLInputElement>(null)
  // Lo que toca hacer cuando el menú de una columna termina de cerrarse (en vez de devolver el foco a su botón).
  const alCerrarMenu = useRef<(() => void) | null>(null)

  useEffect(() => {
    ultimas.current = tarjetas
  }, [tarjetas])

  const fallar = useCallback(
    (err: unknown) => {
      if (esNoAutorizado(err)) onSalir()
      else setError(mensajeDeError(err))
    },
    [onSalir]
  )

  const recargar = useCallback(async () => {
    try {
      const [pendientes, nuevosPerfiles] = await Promise.all([api.listar(credenciales), api.perfiles.listar(credenciales)])
      setTarjetas(pendientes.map(aTarjeta))
      setPerfiles(nuevosPerfiles)
      setError("")
    } catch (err) {
      fallar(err)
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

  const perfilesPorId = useMemo(() => new Map(perfiles.map((perfil) => [perfil.id, perfil])), [perfiles])

  const filtrando = filtroProyecto !== null || filtroPerfil !== null

  const visibles = useMemo(
    () =>
      tarjetas.filter(
        (tarjeta) =>
          (filtroProyecto === null || tarjeta.proyecto === filtroProyecto) &&
          (filtroPerfil === null || (tarjeta.perfil_id ?? NADIE) === filtroPerfil)
      ),
    [tarjetas, filtroProyecto, filtroPerfil]
  )

  const proyectos = useMemo(
    () => [...contar(tarjetas, (tarjeta) => tarjeta.proyecto).entries()].sort(([a], [b]) => a.localeCompare(b)),
    [tarjetas]
  )

  const asignados = useMemo(() => contar(tarjetas, (tarjeta) => tarjeta.perfil_id ?? NADIE), [tarjetas])

  // El campo proyecto sugiere los que ya se usan en alguna tarjeta; se puede escribir cualquier otro.
  const sugerencias = useMemo(() => proyectos.map(([nombre]) => nombre), [proyectos])

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
    try {
      const nuevo = await api.crear(credenciales, {
        texto,
        proyecto,
        estado: destino,
        perfil_id: responsable === NADIE ? null : responsable,
      })
      setTarjetas((actuales) => [aTarjeta(nuevo), ...actuales])
      setTexto("")
      setDestino("pendiente")
      setError("")
    } catch (err) {
      fallar(err)
    }
  }

  // El cambio se ve al instante; la respuesta trae además el resumen de la descripción para la tarjeta.
  const cambiarPendiente = useCallback(
    async (id: string, cambios: CambiosPendiente) => {
      const { descripcion: _descripcion, ...enLaTarjeta } = cambios
      setTarjetas((actuales) => actuales.map((t) => (t.id === id ? aTarjeta({ ...t, ...enLaTarjeta }) : t)))
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

  async function crearPerfil(datos: { nombre: string; color: string }) {
    try {
      const nuevo = await api.perfiles.crear(credenciales, datos)
      setPerfiles((actuales) => [...actuales, nuevo])
      return null
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
      return mensajeDeError(err)
    }
  }

  async function borrarPerfil(perfil: Perfil) {
    try {
      await api.perfiles.borrar(credenciales, perfil.id)
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

  function cambiarTablero(nuevas: Tarjeta[]) {
    const todas = filtrando ? mezclar(ultimas.current, nuevas) : nuevas
    ultimas.current = todas
    setTarjetas(todas)
  }

  function alEmpezarArrastre() {
    arrastrando.current = true
    ordenAlEmpezar.current = firmaDelOrden(ultimas.current)
  }

  function alSoltar() {
    // Kibo avisa onDragEnd antes de su último onDataChange: se espera un tick para leer el orden final.
    setTimeout(async () => {
      arrastrando.current = false
      const finales = ultimas.current
      if (firmaDelOrden(finales) === ordenAlEmpezar.current) return
      try {
        await api.ordenar(credenciales, finales.map((tarjeta) => ({ id: tarjeta.id, estado: tarjeta.column as Estado })))
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
          <div className="ml-auto flex items-center gap-1">
            <PerfilesDialog perfiles={perfiles} asignados={asignados} onCrear={crearPerfil} onBorrar={borrarPerfil} />
            <Button asChild variant="ghost">
              <a href="/" aria-label="Timer">
                <Timer /> <span className="hidden sm:inline">Timer</span>
              </a>
            </Button>
            <Button variant="ghost" onClick={onSalir} aria-label="Salir">
              <LogOut /> <span className="hidden sm:inline">Salir</span>
            </Button>
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
              placeholder="¿Qué falta hacer?"
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
          <ProyectoCombobox valor={proyecto} onCambiar={setProyecto} sugerencias={sugerencias} className="h-11 w-full sm:w-52" />
          <Select value={responsable} onValueChange={setResponsable}>
            <SelectTrigger aria-label="Responsable" className="w-full px-3 data-[size=default]:h-11 sm:w-48">
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
          <Button type="submit" className="h-11 px-5">
            <Plus /> Agregar
          </Button>
        </form>

        {(perfiles.length > 0 || proyectos.length > 0) && (
          <div className="flex flex-col gap-2.5">
            {perfiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por persona">
                <Filtro activo={filtroPerfil === null} onClick={() => setFiltroPerfil(null)}>
                  <Layers /> Todos
                </Filtro>
                {[...perfiles, null].map((perfil) => {
                  const clave = perfil?.id ?? NADIE
                  return (
                    <Filtro
                      key={clave}
                      activo={filtroPerfil === clave}
                      onClick={() => setFiltroPerfil(filtroPerfil === clave ? null : clave)}
                    >
                      {perfil ? (
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: perfil.color }} />
                      ) : (
                        <CircleDashed className="text-muted-foreground" />
                      )}
                      {perfil?.nombre ?? "Sin asignar"} <Contador valor={asignados.get(clave) ?? 0} />
                    </Filtro>
                  )
                })}
              </div>
            )}
            {proyectos.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por proyecto">
                <Filtro activo={filtroProyecto === null} onClick={() => setFiltroProyecto(null)}>
                  <FolderOpen /> Todos los proyectos
                </Filtro>
                {proyectos.map(([nombre, cantidad]) => (
                  <Filtro
                    key={nombre}
                    activo={filtroProyecto === nombre}
                    onClick={() => setFiltroProyecto(filtroProyecto === nombre ? null : nombre)}
                  >
                    <Folder className="text-muted-foreground" /> {nombre} <Contador valor={cantidad} />
                  </Filtro>
                ))}
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
              data={visibles}
              onDataChange={cambiarTablero}
              onDragStart={alEmpezarArrastre}
              onDragEnd={alSoltar}
            >
              {(columna) => {
                const cantidad = visibles.filter((tarjeta) => tarjeta.column === columna.id).length
                const Icono = ICONOS[columna.id]
                return (
                  <KanbanBoard
                    id={columna.id}
                    key={columna.id}
                    // Cada columna se tiñe con su color: el fondo apenas, el encabezado un poco más.
                    style={{ "--tono": columna.color } as CSSProperties}
                    className="min-h-[28rem] divide-y-0 rounded-xl border-[color-mix(in_oklab,var(--tono)_20%,var(--color-border))] bg-[color-mix(in_oklab,var(--tono)_4%,var(--color-columna))] text-sm shadow-none"
                  >
                    <KanbanHeader className="flex items-center gap-2.5 bg-[color-mix(in_oklab,var(--tono)_10%,transparent)] py-3 pr-2 pl-4">
                      <span className="size-2.5 shrink-0 rounded-full bg-(--tono)" />
                      <Icono className="size-4.5 shrink-0 text-foreground/80" />
                      <h2 className="text-sm font-semibold">{columna.name}</h2>
                      <span className="ml-auto rounded-md bg-background/60 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                        {cantidad}
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
                    <KanbanCards id={columna.id} className={cantidad === 0 ? "p-0" : "gap-2.5 p-3"}>
                      {(tarjeta: Tarjeta) => {
                        const perfil = tarjeta.perfil_id ? perfilesPorId.get(tarjeta.perfil_id) : null
                        return (
                          <KanbanCard
                            column={columna.id}
                            id={tarjeta.id}
                            key={tarjeta.id}
                            name={tarjeta.name}
                            className="rounded-lg ring-border transition-shadow hover:ring-primary/50"
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
                                  {tarjeta.texto}
                                </button>
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
                              <div className="flex items-center gap-2">
                                {tarjeta.proyecto && (
                                  <Badge variant="secondary" className="gap-1">
                                    <Folder className="size-3" /> {tarjeta.proyecto}
                                  </Badge>
                                )}
                                {tarjeta.num_imagenes > 0 && (
                                  <span
                                    className="flex items-center gap-1 text-xs text-muted-foreground"
                                    title={tarjeta.num_imagenes === 1 ? "1 imagen" : `${tarjeta.num_imagenes} imágenes`}
                                  >
                                    <ImageIcon className="size-3.5" /> {tarjeta.num_imagenes}
                                  </span>
                                )}
                                <span className="ml-auto text-xs text-muted-foreground">
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
                                      {perfiles.map((opcion) => (
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
                    {cantidad === 0 && (
                      <Empty className="m-3 w-auto gap-3 border border-[color-mix(in_oklab,var(--tono)_22%,var(--color-border))] p-6">
                        <EmptyHeader>
                          <EmptyMedia>
                            <IlustracionColumna estado={columna.id} />
                          </EmptyMedia>
                          <EmptyTitle className="text-lg font-semibold">Nada por aquí</EmptyTitle>
                          <EmptyDescription className="max-w-64 text-sm">{VACIO[columna.id]}</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </KanbanBoard>
                )
              }}
            </KanbanProvider>
          </div>
        )}

        <p className="m-0 flex items-center gap-4 rounded-xl border border-dashed px-5 py-4 text-sm text-muted-foreground">
          <Keyboard className="size-6 shrink-0" />
          Arrastra las tarjetas entre columnas. Toca una tarjeta para abrir su detalle: descripción e imágenes (también se pegan con Ctrl+V o ⌘V).
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

      <DetallePendiente
        credenciales={credenciales}
        pendiente={pendienteAbierto}
        perfiles={perfiles}
        sugerencias={sugerencias}
        onCambiar={cambiarPendiente}
        onBorrar={borrar}
        onCerrar={cerrarDetalle}
        onSalir={onSalir}
      />
    </div>
  )
}
