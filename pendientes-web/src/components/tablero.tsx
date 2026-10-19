import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type SyntheticEvent } from "react"
import { LogOut, Pencil, Plus, Timer, Trash2 } from "lucide-react"

import {
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from "@/components/kibo-ui/kanban"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api, esNoAutorizado, mensajeDeError, type Estado, type Pendiente } from "@/lib/api"

const COLUMNAS: { id: Estado; name: string; color: string }[] = [
  { id: "pendiente", name: "Por hacer", color: "#6B7280" },
  { id: "haciendo", name: "Haciendo", color: "#F59E0B" },
  { id: "hecho", name: "Hecho", color: "#10B981" },
]

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

// Escribir o tocar un botón dentro de la tarjeta no debe empezar a arrastrarla.
const detener = (event: SyntheticEvent) => event.stopPropagation()
const noArrastrar = { onMouseDown: detener, onTouchStart: detener, onKeyDown: detener }

export function Tablero({ credenciales, onSalir }: { credenciales: string; onSalir: () => void }) {
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState("")
  const [filtro, setFiltro] = useState<string | null>(null)
  const [texto, setTexto] = useState("")
  const [proyecto, setProyecto] = useState("")
  const [editando, setEditando] = useState<string | null>(null)
  const ultimas = useRef<Tarjeta[]>([])
  const ordenAlEmpezar = useRef("")
  const cancelarEdicion = useRef(false)

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
      setTarjetas((await api.listar(credenciales)).map(aTarjeta))
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

  const visibles = useMemo(
    () => (filtro ? tarjetas.filter((tarjeta) => tarjeta.proyecto === filtro) : tarjetas),
    [tarjetas, filtro]
  )

  const proyectos = useMemo(() => {
    const conteo = new Map<string, number>()
    for (const tarjeta of tarjetas) {
      if (tarjeta.proyecto) conteo.set(tarjeta.proyecto, (conteo.get(tarjeta.proyecto) ?? 0) + 1)
    }
    return [...conteo.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [tarjetas])

  const sugerencias = useMemo(
    () => [...new Set([...PROYECTOS_SUGERIDOS, ...proyectos.map(([nombre]) => nombre)])].sort(),
    [proyectos]
  )

  const abiertos = tarjetas.filter((tarjeta) => tarjeta.column !== "hecho").length

  async function agregar(event: FormEvent) {
    event.preventDefault()
    if (!texto.trim()) return
    try {
      const nuevo = await api.crear(credenciales, { texto, proyecto: proyecto.trim() || null })
      setTarjetas((actuales) => [aTarjeta(nuevo), ...actuales])
      setTexto("")
      setError("")
    } catch (err) {
      fallar(err)
    }
  }

  async function guardarTexto(tarjeta: Tarjeta, nuevoTexto: string) {
    setEditando(null)
    const limpio = nuevoTexto.trim()
    if (!limpio || limpio === tarjeta.texto) return
    try {
      const actualizado = await api.actualizar(credenciales, tarjeta.id, { texto: limpio })
      setTarjetas((actuales) =>
        actuales.map((t) => (t.id === tarjeta.id ? { ...t, texto: actualizado.texto, name: actualizado.texto } : t))
      )
    } catch (err) {
      fallar(err)
    }
  }

  async function borrar(tarjeta: Tarjeta) {
    setTarjetas((actuales) => actuales.filter((t) => t.id !== tarjeta.id))
    try {
      await api.borrar(credenciales, tarjeta.id)
    } catch (err) {
      fallar(err)
      recargar()
    }
  }

  function cambiarTablero(nuevas: Tarjeta[]) {
    const todas = filtro ? mezclar(ultimas.current, nuevas) : nuevas
    ultimas.current = todas
    setTarjetas(todas)
  }

  function alEmpezarArrastre() {
    ordenAlEmpezar.current = firmaDelOrden(ultimas.current)
  }

  function alSoltar() {
    // Kibo avisa onDragEnd antes de su último onDataChange: se espera un tick para leer el orden final.
    setTimeout(async () => {
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
            <Button asChild variant="ghost" size="sm">
              <a href="/">
                <Timer /> Timer
              </a>
            </Button>
            <Button variant="ghost" size="sm" onClick={onSalir}>
              <LogOut /> Salir
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
            className="sm:w-44"
          />
          <datalist id="proyectos-sugeridos">
            {sugerencias.map((nombre) => (
              <option key={nombre} value={nombre} />
            ))}
          </datalist>
          <Button type="submit" disabled={!texto.trim()}>
            <Plus /> Agregar
          </Button>
        </form>

        {proyectos.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por proyecto">
            <Button size="xs" variant={filtro === null ? "default" : "outline"} onClick={() => setFiltro(null)}>
              Todos
            </Button>
            {proyectos.map(([nombre, cantidad]) => (
              <Button
                key={nombre}
                size="xs"
                variant={filtro === nombre ? "default" : "outline"}
                aria-pressed={filtro === nombre}
                onClick={() => setFiltro(filtro === nombre ? null : nombre)}
              >
                {nombre} <span className="opacity-60">{cantidad}</span>
              </Button>
            ))}
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
                      {(tarjeta: Tarjeta) => (
                        <KanbanCard column={columna.id} id={tarjeta.id} key={tarjeta.id} name={tarjeta.name}>
                          <div className="flex items-start gap-1">
                            {editando === tarjeta.id ? (
                              <Input
                                autoFocus
                                aria-label="Editar pendiente"
                                defaultValue={tarjeta.texto}
                                maxLength={500}
                                className="h-7 flex-1 text-sm"
                                {...noArrastrar}
                                onKeyDown={(event) => {
                                  event.stopPropagation()
                                  if (event.key === "Enter") event.currentTarget.blur()
                                  if (event.key === "Escape") {
                                    cancelarEdicion.current = true
                                    event.currentTarget.blur()
                                  }
                                }}
                                onBlur={(event) => {
                                  if (cancelarEdicion.current) {
                                    cancelarEdicion.current = false
                                    setEditando(null)
                                  } else {
                                    guardarTexto(tarjeta, event.currentTarget.value)
                                  }
                                }}
                              />
                            ) : (
                              <p
                                className="m-0 flex-1 text-sm font-medium break-words"
                                onDoubleClick={() => setEditando(tarjeta.id)}
                              >
                                {tarjeta.texto}
                              </p>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground"
                              aria-label={`Editar "${tarjeta.texto}"`}
                              {...noArrastrar}
                              onClick={() => setEditando(tarjeta.id)}
                            >
                              <Pencil />
                            </Button>
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
                          <div className="flex items-center gap-2">
                            {tarjeta.proyecto && <Badge variant="secondary">{tarjeta.proyecto}</Badge>}
                            <span className="ml-auto text-xs text-muted-foreground">
                              {fecha.format(new Date(tarjeta.creado_en))}
                            </span>
                          </div>
                        </KanbanCard>
                      )}
                    </KanbanCards>
                    {cantidad === 0 && <p className="m-0 px-3 pb-3 text-muted-foreground">Nada por aquí</p>}
                  </KanbanBoard>
                )
              }}
            </KanbanProvider>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Arrastra las tarjetas entre columnas. Doble clic o el lápiz para editar.
        </p>
      </main>
    </div>
  )
}
