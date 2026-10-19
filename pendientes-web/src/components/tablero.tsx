import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode, type SyntheticEvent } from "react"
import { ImageIcon, LogOut, Plus, Timer, Trash2 } from "lucide-react"

import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from "@/components/kibo-ui/kanban"
import { DetallePendiente } from "@/components/detalle-pendiente"
import { PerfilAvatar } from "@/components/perfil-avatar"
import { PerfilesDialog } from "@/components/perfiles-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, esNoAutorizado, mensajeDeError, type CambiosPendiente, type Estado, type Pendiente, type Perfil } from "@/lib/api"
import { COLUMNAS, NADIE } from "@/lib/estados"

// Sugerencias del campo proyecto; se puede escribir cualquier otro.
const PROYECTOS_SUGERIDOS = ["kimba", "pos", "practipdf", "practitv", "timermayu", "servidor"]

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

function Filtro({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button size="xs" variant={activo ? "default" : "outline"} aria-pressed={activo} onClick={onClick}>
      {children}
    </Button>
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
  const [proyecto, setProyecto] = useState("")
  const [responsable, setResponsable] = useState(NADIE)
  const [abierto, setAbierto] = useState<string | null>(null)
  const ultimas = useRef<Tarjeta[]>([])
  const ordenAlEmpezar = useRef("")
  const arrastrando = useRef(false)

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

  const sugerencias = useMemo(
    () => [...new Set([...PROYECTOS_SUGERIDOS, ...proyectos.map(([nombre]) => nombre)])].sort(),
    [proyectos]
  )

  const abiertos = tarjetas.filter((tarjeta) => tarjeta.column !== "hecho").length

  const pendienteAbierto = tarjetas.find((tarjeta) => tarjeta.id === abierto) ?? null

  async function agregar(event: FormEvent) {
    event.preventDefault()
    if (!texto.trim()) return
    try {
      const nuevo = await api.crear(credenciales, {
        texto,
        proyecto: proyecto.trim() || null,
        perfil_id: responsable === NADIE ? null : responsable,
      })
      setTarjetas((actuales) => [aTarjeta(nuevo), ...actuales])
      setTexto("")
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
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 md:px-6">
          <h1 className="text-base font-semibold">Pendientes</h1>
          {!cargando && (
            <span className="text-sm text-muted-foreground">
              {abiertos} {abiertos === 1 ? "abierto" : "abiertos"}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <PerfilesDialog perfiles={perfiles} asignados={asignados} onCrear={crearPerfil} onBorrar={borrarPerfil} />
            <Button asChild variant="ghost" size="sm">
              <a href="/" aria-label="Timer">
                <Timer /> <span className="hidden sm:inline">Timer</span>
              </a>
            </Button>
            <Button variant="ghost" size="sm" onClick={onSalir} aria-label="Salir">
              <LogOut /> <span className="hidden sm:inline">Salir</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
        <form onSubmit={agregar} className="flex flex-col gap-2 sm:flex-row">
          <Input
            aria-label="Nuevo pendiente"
            placeholder="¿Qué falta hacer?"
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            maxLength={500}
            className="sm:flex-1"
          />
          <Input
            aria-label="Proyecto"
            placeholder="Proyecto"
            list="proyectos-sugeridos"
            value={proyecto}
            onChange={(event) => setProyecto(event.target.value)}
            maxLength={60}
            className="sm:w-40"
          />
          <datalist id="proyectos-sugeridos">
            {sugerencias.map((nombre) => (
              <option key={nombre} value={nombre} />
            ))}
          </datalist>
          <Select value={responsable} onValueChange={setResponsable}>
            <SelectTrigger aria-label="Responsable" className="w-full sm:w-40">
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
          <Button type="submit" disabled={!texto.trim()}>
            <Plus /> Agregar
          </Button>
        </form>

        {(perfiles.length > 0 || proyectos.length > 0) && (
          <div className="flex flex-col gap-2">
            {perfiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por persona">
                <Filtro activo={filtroPerfil === null} onClick={() => setFiltroPerfil(null)}>
                  Todos
                </Filtro>
                {[...perfiles, null].map((perfil) => {
                  const clave = perfil?.id ?? NADIE
                  return (
                    <Filtro
                      key={clave}
                      activo={filtroPerfil === clave}
                      onClick={() => setFiltroPerfil(filtroPerfil === clave ? null : clave)}
                    >
                      <span className="size-2 rounded-full" style={{ backgroundColor: perfil?.color ?? "transparent", border: perfil ? undefined : "1px dashed currentColor" }} />
                      {perfil?.nombre ?? "Sin asignar"} <span className="opacity-60">{asignados.get(clave) ?? 0}</span>
                    </Filtro>
                  )
                })}
              </div>
            )}
            {proyectos.length > 0 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por proyecto">
                <Filtro activo={filtroProyecto === null} onClick={() => setFiltroProyecto(null)}>
                  Todos los proyectos
                </Filtro>
                {proyectos.map(([nombre, cantidad]) => (
                  <Filtro
                    key={nombre}
                    activo={filtroProyecto === nombre}
                    onClick={() => setFiltroProyecto(filtroProyecto === nombre ? null : nombre)}
                  >
                    {nombre} <span className="opacity-60">{cantidad}</span>
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
              className="min-w-[48rem] md:min-w-0"
              columns={COLUMNAS}
              data={visibles}
              onDataChange={cambiarTablero}
              onDragStart={alEmpezarArrastre}
              onDragEnd={alSoltar}
            >
              {(columna) => {
                const cantidad = visibles.filter((tarjeta) => tarjeta.column === columna.id).length
                return (
                  <KanbanBoard id={columna.id} key={columna.id}>
                    <KanbanHeader>
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full" style={{ backgroundColor: columna.color }} />
                        <span>{columna.name}</span>
                        <span className="ml-auto font-normal text-muted-foreground">{cantidad}</span>
                      </div>
                    </KanbanHeader>
                    <KanbanCards id={columna.id}>
                      {(tarjeta: Tarjeta) => {
                        const perfil = tarjeta.perfil_id ? perfilesPorId.get(tarjeta.perfil_id) : null
                        return (
                          <KanbanCard column={columna.id} id={tarjeta.id} key={tarjeta.id} name={tarjeta.name}>
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
                                {tarjeta.proyecto && <Badge variant="secondary">{tarjeta.proyecto}</Badge>}
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
                    {cantidad === 0 && <p className="m-0 px-3 pb-3 text-muted-foreground">Nada por aquí</p>}
                  </KanbanBoard>
                )
              }}
            </KanbanProvider>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Arrastra las tarjetas entre columnas. Toca una tarjeta para abrir su detalle: descripción e imágenes (también se pegan con Ctrl+V o ⌘V).
        </p>
      </main>

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
