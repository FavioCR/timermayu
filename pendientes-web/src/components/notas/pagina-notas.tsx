import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import {
  ChevronRight,
  FileText,
  FolderInput,
  KanbanSquare,
  LoaderCircle,
  LogOut,
  MoreHorizontal,
  NotebookPen,
  Paperclip,
  Plus,
  Search,
  Trash2,
} from "lucide-react"

import { IconoRecurso } from "@/components/notas/recursos-curso"
import { NuevoCurso, Vacio, VistaCurso } from "@/components/notas/vista-curso"
import { EstadoGuardado, VistaNota } from "@/components/notas/vista-nota"
import { VisorRecurso, type RecursoAbierto } from "@/components/notas/visor-recurso"
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
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { useSubidas } from "@/hooks/use-subidas"
import { api, esNoAutorizado, mensajeDeError, type Usuario } from "@/lib/api"
import { haceCuanto } from "@/lib/actividad"
import { APARIENCIA_NORMAL, aplicarApariencia } from "@/lib/apariencia"
import { usePresencia } from "@/lib/presencia"
import { useCompartirSeguimiento } from "@/lib/seguimiento"
import {
  direccionDe,
  lugarDeLaDireccion,
  notasApi,
  type ArbolNotas,
  type Curso,
  type Hallazgos,
  type Lugar,
  type Nota,
  type Recurso,
} from "@/lib/notas"

const PLEGADOS = "notas.plegados"

function leerPlegados() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(PLEGADOS) ?? "[]"))
  } catch {
    return new Set<string>()
  }
}

function guardarPlegados(plegados: Set<string>) {
  try {
    localStorage.setItem(PLEGADOS, JSON.stringify([...plegados]))
  } catch {
    // Sin almacenamiento: al recargar vuelven a quedar abiertos.
  }
}

// Un clic normal navega dentro de la página; con Ctrl/Cmd (o la rueda) abre otra pestaña como cualquier enlace.
const clicNormal = (event: MouseEvent) => !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)

// Notas privadas: apuntes agrupados por curso, como en Notion. Vive en /pendientes/notas con el mismo acceso que el
// tablero, pero solo para quien tiene su correo habilitado en el servidor.
export default function PaginaNotas({ credenciales, onSalir }: { credenciales: string; onSalir: () => void }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [arbol, setArbol] = useState<ArbolNotas | null>(null)
  const [error, setError] = useState("")
  const [lugar, setLugar] = useState<Lugar>(lugarDeLaDireccion)
  const [abierto, setAbierto] = useState<RecursoAbierto | null>(null)
  const [estado, setEstado] = useState<"guardado" | "pendiente" | "guardando" | "error">("guardado")
  const [nuevoCurso, setNuevoCurso] = useState(false)
  const [borrandoCurso, setBorrandoCurso] = useState<Curso | null>(null)
  const [borrandoNota, setBorrandoNota] = useState<Nota | null>(null)
  const [plegados, setPlegados] = useState(leerPlegados)
  const [aviso, setAviso] = useState("")
  // Con sus notas abiertas también se está en línea.
  usePresencia(credenciales, Boolean(usuario?.perfil_id))
  // Los demás solo saben que está en sus notas: ni cuál ni su mouse.
  useCompartirSeguimiento(credenciales, usuario?.perfil_id ? { tipo: "notas" } : null)

  const salir = useCallback(() => onSalir(), [onSalir])
  const agregarRecurso = useCallback(
    (recurso: Recurso) => setArbol((actual) => actual && { ...actual, recursos: [...actual.recursos.filter((r) => r.id !== recurso.id), recurso] }),
    []
  )
  const subidas = useSubidas(credenciales, agregarRecurso, salir)

  useEffect(() => {
    let vigente = true
    api
      .yo(credenciales)
      .then(async (yo) => {
        if (!vigente) return
        setUsuario(yo)
        // La fuente y el tamaño que eligió en el tablero (por si los cambió en otro dispositivo).
        aplicarApariencia(yo.apariencia ?? APARIENCIA_NORMAL)
        if (!yo.notas) return
        const datos = await notasApi.arbol(credenciales)
        if (vigente) setArbol(datos)
      })
      .catch((err) => {
        if (!vigente) return
        if (esNoAutorizado(err)) onSalir()
        else setError(mensajeDeError(err))
      })
    return () => {
      vigente = false
    }
  }, [credenciales, onSalir])

  // Atrás y adelante del navegador.
  useEffect(() => {
    const volver = () => setLugar(lugarDeLaDireccion())
    window.addEventListener("popstate", volver)
    return () => window.removeEventListener("popstate", volver)
  }, [])

  const irA = useCallback((destino: Lugar, { reemplazar = false } = {}) => {
    const direccion = direccionDe(destino)
    if (reemplazar) window.history.replaceState(null, "", direccion)
    else if (`${window.location.pathname}${window.location.search}` !== direccion) window.history.pushState(null, "", direccion)
    setLugar(destino)
    setEstado("guardado")
  }, [])

  const cursos = useMemo(() => arbol?.cursos ?? [], [arbol])
  const notasDe = useCallback((cursoId: string) => (arbol?.notas ?? []).filter((nota) => nota.curso_id === cursoId), [arbol])
  const recursosDe = useCallback((cursoId: string) => (arbol?.recursos ?? []).filter((recurso) => recurso.curso_id === cursoId), [arbol])
  const notaActual = lugar.vista === "nota" ? arbol?.notas.find((nota) => nota.id === lugar.id) : undefined
  const cursoActual = cursos.find((curso) => curso.id === (lugar.vista === "nota" ? notaActual?.curso_id : lugar.vista === "curso" ? lugar.id : null))

  useEffect(() => {
    const titulo = notaActual ? notaActual.titulo || "Sin título" : cursoActual?.nombre
    document.title = titulo ? `${titulo} · Notas` : "Notas"
  }, [notaActual, cursoActual])

  function fallo(err: unknown) {
    if (esNoAutorizado(err)) onSalir()
    else setAviso(mensajeDeError(err))
  }

  function plegar(cursoId: string, abierto: boolean) {
    setPlegados((actuales) => {
      const nuevos = new Set(actuales)
      if (abierto) nuevos.delete(cursoId)
      else nuevos.add(cursoId)
      guardarPlegados(nuevos)
      return nuevos
    })
  }

  async function crearCurso(nombre: string, icono: string) {
    try {
      const curso = await notasApi.cursos.crear(credenciales, { nombre, icono })
      setArbol((actual) => actual && { ...actual, cursos: [...actual.cursos, curso] })
      setNuevoCurso(false)
      irA({ vista: "curso", id: curso.id, recursos: false })
    } catch (err) {
      fallo(err)
    }
  }

  async function cambiarCurso(curso: Curso, cambios: Partial<Pick<Curso, "nombre" | "icono">>) {
    setArbol((actual) => actual && { ...actual, cursos: actual.cursos.map((c) => (c.id === curso.id ? { ...c, ...cambios } : c)) })
    try {
      const guardado = await notasApi.cursos.actualizar(credenciales, curso.id, cambios)
      setArbol((actual) => actual && { ...actual, cursos: actual.cursos.map((c) => (c.id === curso.id ? guardado : c)) })
    } catch (err) {
      setArbol((actual) => actual && { ...actual, cursos: actual.cursos.map((c) => (c.id === curso.id ? curso : c)) })
      fallo(err)
    }
  }

  async function borrarCurso(curso: Curso) {
    try {
      await notasApi.cursos.borrar(credenciales, curso.id)
      setArbol(
        (actual) =>
          actual && {
            cursos: actual.cursos.filter((c) => c.id !== curso.id),
            notas: actual.notas.filter((n) => n.curso_id !== curso.id),
            recursos: actual.recursos.filter((r) => r.curso_id !== curso.id),
          }
      )
      if (cursoActual?.id === curso.id) irA({ vista: "inicio" }, { reemplazar: true })
    } catch (err) {
      fallo(err)
    }
  }

  async function crearNota(cursoId: string) {
    try {
      const nota = await notasApi.notas.crear(credenciales, cursoId)
      setArbol((actual) => actual && { ...actual, notas: [...actual.notas, nota] })
      plegar(cursoId, true)
      irA({ vista: "nota", id: nota.id })
    } catch (err) {
      fallo(err)
    }
  }

  const cambiarNota = useCallback((cambio: Pick<Nota, "id"> & Partial<Nota>) => {
    setArbol((actual) => actual && { ...actual, notas: actual.notas.map((nota) => (nota.id === cambio.id ? { ...nota, ...cambio } : nota)) })
  }, [])

  async function moverNota(nota: Nota, cursoId: string) {
    try {
      cambiarNota(await notasApi.notas.actualizar(credenciales, nota.id, { curso_id: cursoId }))
      plegar(cursoId, true)
    } catch (err) {
      fallo(err)
    }
  }

  async function borrarNota(nota: Nota) {
    try {
      await notasApi.notas.borrar(credenciales, nota.id)
      setArbol((actual) => actual && { ...actual, notas: actual.notas.filter((n) => n.id !== nota.id) })
      if (notaActual?.id === nota.id) irA({ vista: "curso", id: nota.curso_id, recursos: false }, { reemplazar: true })
    } catch (err) {
      fallo(err)
    }
  }

  const abrirRecurso = useCallback((recurso: RecursoAbierto) => setAbierto(recurso), [])

  if (error) {
    return (
      <Centro>
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </Centro>
    )
  }

  if (usuario && !usuario.notas) {
    return (
      <Centro>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NotebookPen />
            </EmptyMedia>
            <EmptyTitle>Esta sección es privada</EmptyTitle>
            <EmptyDescription>Las notas solo están disponibles para la cuenta que las tiene habilitadas.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button asChild>
              <a href="/pendientes/">
                <KanbanSquare /> Ir a Pendientes
              </a>
            </Button>
            <Button variant="outline" onClick={onSalir}>
              <LogOut /> Entrar con otra cuenta
            </Button>
          </EmptyContent>
        </Empty>
      </Centro>
    )
  }

  if (!arbol || !usuario) {
    return (
      <Centro>
        <LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-label="Cargando" />
      </Centro>
    )
  }

  const oscuro = document.documentElement.classList.contains("dark")
  const noExiste = (lugar.vista === "nota" && !notaActual) || (lugar.vista === "curso" && !cursoActual)

  return (
    <SidebarProvider>
      <BarraLateral
        credenciales={credenciales}
        usuario={usuario}
        arbol={arbol}
        lugar={lugar}
        plegados={plegados}
        onPlegar={plegar}
        onIr={irA}
        onNuevoCurso={() => setNuevoCurso(true)}
        onNuevaNota={crearNota}
        onBorrarCurso={setBorrandoCurso}
        onAbrirRecurso={abrirRecurso}
        onSalir={onSalir}
      />
      <SidebarInset className="min-w-0">
        <header className="sticky top-(--alto-aviso) z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur">
          <SidebarTrigger aria-label="Mostrar u ocultar la barra lateral" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <Breadcrumb className="min-w-0 flex-1">
            <BreadcrumbList className="flex-nowrap">
              {cursoActual ? (
                <>
                  <BreadcrumbItem className="min-w-0">
                    {lugar.vista === "curso" && !lugar.recursos ? (
                      <BreadcrumbPage className="truncate">
                        {cursoActual.icono} {cursoActual.nombre}
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        href={direccionDe({ vista: "curso", id: cursoActual.id, recursos: false })}
                        onClick={(event) => {
                          if (!clicNormal(event)) return
                          event.preventDefault()
                          irA({ vista: "curso", id: cursoActual.id, recursos: false })
                        }}
                        className="truncate"
                      >
                        {cursoActual.icono} {cursoActual.nombre}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {(notaActual || (lugar.vista === "curso" && lugar.recursos)) && (
                    <>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem className="min-w-0">
                        <BreadcrumbPage className="truncate">{notaActual ? notaActual.titulo || "Sin título" : "Recursos"}</BreadcrumbPage>
                      </BreadcrumbItem>
                    </>
                  )}
                </>
              ) : (
                <BreadcrumbItem>
                  <BreadcrumbPage>Inicio</BreadcrumbPage>
                </BreadcrumbItem>
              )}
            </BreadcrumbList>
          </Breadcrumb>
          {notaActual && (
            <>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                <EstadoGuardado estado={estado} editada={notaActual.actualizado_en} />
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="Más acciones de la nota">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <FolderInput /> Mover a otro curso
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {cursos
                        .filter((curso) => curso.id !== notaActual.curso_id)
                        .map((curso) => (
                          <DropdownMenuItem key={curso.id} onSelect={() => moverNota(notaActual, curso.id)}>
                            <span aria-hidden>{curso.icono}</span> {curso.nombre}
                          </DropdownMenuItem>
                        ))}
                      {cursos.length < 2 && <DropdownMenuLabel className="font-normal text-muted-foreground">No hay otros cursos</DropdownMenuLabel>}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setBorrandoNota(notaActual)}>
                    <Trash2 /> Borrar nota
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </header>

        {aviso && (
          <div role="alert" className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <span className="flex-1">{aviso}</span>
            <Button size="sm" variant="ghost" onClick={() => setAviso("")}>
              Cerrar
            </Button>
          </div>
        )}

        <div className="flex-1">
          {noExiste ? (
            <Centro>
              <p className="text-sm text-muted-foreground">
                Eso ya no existe.{" "}
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => irA({ vista: "inicio" }, { reemplazar: true })}>
                  Volver al inicio
                </button>
              </p>
            </Centro>
          ) : notaActual && cursoActual ? (
            <VistaNota
              key={notaActual.id}
              credenciales={credenciales}
              nota={notaActual}
              curso={cursoActual}
              oscuro={oscuro}
              onCambio={cambiarNota}
              onEstado={setEstado}
              onRecurso={agregarRecurso}
              onAbrir={abrirRecurso}
              onNoAutorizado={salir}
            />
          ) : lugar.vista === "curso" && cursoActual ? (
            <VistaCurso
              key={cursoActual.id}
              credenciales={credenciales}
              curso={cursoActual}
              notas={notasDe(cursoActual.id)}
              recursos={recursosDe(cursoActual.id)}
              verRecursos={lugar.recursos}
              subidas={subidas}
              onVerRecursos={(ver) => irA({ vista: "curso", id: cursoActual.id, recursos: ver }, { reemplazar: true })}
              onCambiarCurso={(cambios) => cambiarCurso(cursoActual, cambios)}
              onNuevaNota={() => crearNota(cursoActual.id)}
              onAbrirNota={(nota) => irA({ vista: "nota", id: nota.id })}
              onAbrirRecurso={abrirRecurso}
              onRecursoCambiado={agregarRecurso}
              onRecursoBorrado={(id) => setArbol((actual) => actual && { ...actual, recursos: actual.recursos.filter((r) => r.id !== id) })}
              onNoAutorizado={salir}
              hrefDeNota={(nota) => direccionDe({ vista: "nota", id: nota.id })}
            />
          ) : (
            <Inicio usuario={usuario} arbol={arbol} onIr={irA} onNuevoCurso={() => setNuevoCurso(true)} />
          )}
        </div>
      </SidebarInset>

      <NuevoCurso abierto={nuevoCurso} onCerrar={() => setNuevoCurso(false)} onCrear={crearCurso} />
      <VisorRecurso credenciales={credenciales} recurso={abierto} onCerrar={() => setAbierto(null)} onNoAutorizado={salir} />

      <AlertDialog open={borrandoCurso !== null} onOpenChange={(valor) => !valor && setBorrandoCurso(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Borrar {borrandoCurso?.icono} «{borrandoCurso?.nombre}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {borrandoCurso &&
                `Se borran sus ${notasDe(borrandoCurso.id).length} notas y sus ${recursosDe(borrandoCurso.id).length} recursos. No se puede deshacer.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => borrandoCurso && borrarCurso(borrandoCurso)}>
              Borrar curso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={borrandoNota !== null} onOpenChange={(valor) => !valor && setBorrandoNota(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar «{borrandoNota?.titulo || "Sin título"}»?</AlertDialogTitle>
            <AlertDialogDescription>La nota se borra con sus imágenes. No se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => borrandoNota && borrarNota(borrandoNota)}>
              Borrar nota
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}

function Centro({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60svh] w-full items-center justify-center p-6">{children}</div>
}

function BarraLateral({
  credenciales,
  usuario,
  arbol,
  lugar,
  plegados,
  onPlegar,
  onIr,
  onNuevoCurso,
  onNuevaNota,
  onBorrarCurso,
  onAbrirRecurso,
  onSalir,
}: {
  credenciales: string
  usuario: Usuario
  arbol: ArbolNotas
  lugar: Lugar
  plegados: Set<string>
  onPlegar: (cursoId: string, abierto: boolean) => void
  onIr: (lugar: Lugar) => void
  onNuevoCurso: () => void
  onNuevaNota: (cursoId: string) => void
  onBorrarCurso: (curso: Curso) => void
  onAbrirRecurso: (recurso: RecursoAbierto) => void
  onSalir: () => void
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const [consulta, setConsulta] = useState("")
  // Cada resultado recuerda qué se buscó: mientras no llega el de lo que está escrito, se muestra "Buscando…".
  const [hallazgos, setHallazgos] = useState<{ consulta: string; resultado: Hallazgos } | null>(null)
  const buscador = useRef<HTMLInputElement>(null)

  // En el celular la barra es un panel: se cierra al elegir algo.
  function ir(destino: Lugar) {
    onIr(destino)
    if (isMobile) setOpenMobile(false)
  }

  function enlace(destino: Lugar) {
    return {
      href: direccionDe(destino),
      onClick: (event: MouseEvent) => {
        if (!clicNormal(event)) return
        event.preventDefault()
        ir(destino)
      },
    }
  }

  // Ctrl/Cmd + K busca.
  useEffect(() => {
    const atajo = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      if (isMobile) setOpenMobile(true)
      requestAnimationFrame(() => buscador.current?.focus())
    }
    window.addEventListener("keydown", atajo)
    return () => window.removeEventListener("keydown", atajo)
  }, [isMobile, setOpenMobile])

  // Busca en el texto de las notas (en el servidor) un momento después de dejar de escribir.
  useEffect(() => {
    const buscada = consulta.trim()
    if (!buscada) return
    let vigente = true
    const espera = window.setTimeout(() => {
      notasApi
        .buscar(credenciales, buscada)
        .then((resultado) => vigente && setHallazgos({ consulta: buscada, resultado }))
        .catch(() => vigente && setHallazgos({ consulta: buscada, resultado: { notas: [], recursos: [] } }))
    }, 200)
    return () => {
      vigente = false
      window.clearTimeout(espera)
    }
  }, [consulta, credenciales])

  const cursoDe = (cursoId: string) => arbol.cursos.find((curso) => curso.id === cursoId)
  const encontrados = hallazgos?.consulta === consulta.trim() ? hallazgos.resultado : null

  return (
    <Sidebar>
      <SidebarHeader className="gap-3">
        <div className="flex items-center gap-2 px-1 pt-1">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <NotebookPen className="size-4" />
          </span>
          <span className="flex-1 truncate font-semibold">Notas de {usuario.nombre}</span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput
            ref={buscador}
            aria-label="Buscar en las notas"
            placeholder="Buscar (Ctrl K)"
            value={consulta}
            onChange={(event) => setConsulta(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && setConsulta("")}
            className="pl-8"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {consulta.trim() ? (
          <SidebarGroup>
            <SidebarGroupLabel>Resultados</SidebarGroupLabel>
            <SidebarGroupContent>
              {!encontrados ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">Buscando…</p>
              ) : encontrados.notas.length + encontrados.recursos.length === 0 ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">Nada con «{consulta.trim()}».</p>
              ) : (
                <SidebarMenu>
                  {encontrados.notas.map((hallada) => (
                    <SidebarMenuItem key={hallada.id}>
                      <SidebarMenuButton asChild className="h-auto items-start py-1.5">
                        <a {...enlace({ vista: "nota", id: hallada.id })} onClickCapture={() => setConsulta("")}>
                          <FileText className="mt-0.5" />
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">{hallada.titulo || "Sin título"}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {cursoDe(hallada.curso_id)?.icono} {cursoDe(hallada.curso_id)?.nombre}
                            </span>
                            {hallada.extracto && <span className="line-clamp-2 text-xs whitespace-normal text-muted-foreground">{hallada.extracto}</span>}
                          </span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                  {encontrados.recursos.map((recurso) => (
                    <SidebarMenuItem key={recurso.id}>
                      <SidebarMenuButton
                        onClick={() => {
                          onAbrirRecurso(recurso)
                          if (isMobile) setOpenMobile(false)
                        }}
                      >
                        <IconoRecurso recurso={recurso} />
                        <span className="truncate">{recurso.nombre}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <SidebarGroup>
            <SidebarGroupLabel>Cursos</SidebarGroupLabel>
            <SidebarGroupAction title="Nuevo curso" aria-label="Nuevo curso" onClick={onNuevoCurso}>
              <Plus />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={lugar.vista === "inicio"}>
                    <a {...enlace({ vista: "inicio" })}>
                      <NotebookPen /> <span>Inicio</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {arbol.cursos.map((curso) => {
                  const notas = arbol.notas.filter((nota) => nota.curso_id === curso.id)
                  const recursos = arbol.recursos.filter((recurso) => recurso.curso_id === curso.id).length
                  const enRecursos = lugar.vista === "curso" && lugar.id === curso.id && lugar.recursos
                  return (
                    <Collapsible key={curso.id} asChild open={!plegados.has(curso.id)} onOpenChange={(abierto) => onPlegar(curso.id, abierto)}>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          asChild
                          isActive={lugar.vista === "curso" && lugar.id === curso.id && !lugar.recursos}
                          className="group-has-data-[sidebar=menu-action]/menu-item:pr-14"
                        >
                          <a {...enlace({ vista: "curso", id: curso.id, recursos: false })}>
                            <span aria-hidden className="w-4 text-center text-base leading-none">
                              {curso.icono}
                            </span>
                            <span className="truncate">{curso.nombre}</span>
                          </a>
                        </SidebarMenuButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuAction showOnHover className="right-7" aria-label={`Más acciones de ${curso.nombre}`}>
                              <MoreHorizontal />
                            </SidebarMenuAction>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side={isMobile ? "bottom" : "right"} align="start">
                            <DropdownMenuItem onSelect={() => onNuevaNota(curso.id)}>
                              <Plus /> Nueva nota
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => ir({ vista: "curso", id: curso.id, recursos: true })}>
                              <Paperclip /> Recursos
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => onBorrarCurso(curso)}>
                              <Trash2 /> Borrar curso
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuAction
                            aria-label={plegados.has(curso.id) ? `Mostrar ${curso.nombre}` : `Ocultar ${curso.nombre}`}
                            className="data-[state=open]:rotate-90"
                          >
                            <ChevronRight />
                          </SidebarMenuAction>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {notas.map((nota) => (
                              <SidebarMenuSubItem key={nota.id}>
                                <SidebarMenuSubButton {...enlace({ vista: "nota", id: nota.id })} isActive={lugar.vista === "nota" && lugar.id === nota.id}>
                                  <FileText />
                                  <span className={nota.titulo ? undefined : "text-muted-foreground"}>{nota.titulo || "Sin título"}</span>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton {...enlace({ vista: "curso", id: curso.id, recursos: true })} isActive={enRecursos}>
                                <Paperclip />
                                <span className="flex flex-1 items-center justify-between gap-2">
                                  Recursos {recursos > 0 && <span className="text-xs text-muted-foreground tabular-nums">{recursos}</span>}
                                </span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                            <SidebarMenuSubItem>
                              <SidebarMenuSubButton asChild>
                                <button type="button" className="w-full text-muted-foreground" onClick={() => onNuevaNota(curso.id)}>
                                  <Plus />
                                  <span>Nueva nota</span>
                                </button>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  )
                })}
                <SidebarMenuItem>
                  <SidebarMenuButton className="text-muted-foreground" onClick={onNuevoCurso}>
                    <Plus /> <span>Nuevo curso</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href="/pendientes/">
                <KanbanSquare /> <span>Pendientes</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onSalir} className="text-muted-foreground">
              <LogOut /> <span>Salir</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

function Inicio({ usuario, arbol, onIr, onNuevoCurso }: { usuario: Usuario; arbol: ArbolNotas; onIr: (lugar: Lugar) => void; onNuevoCurso: () => void }) {
  const recientes = [...arbol.notas].sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en)).slice(0, 8)
  const cursoDe = (cursoId: string) => arbol.cursos.find((curso) => curso.id === cursoId)

  if (arbol.cursos.length === 0) {
    return (
      <Centro>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NotebookPen />
            </EmptyMedia>
            <EmptyTitle>Tus notas de cursos</EmptyTitle>
            <EmptyDescription>
              Crea un curso y escribe tus apuntes como en Notion: pega imágenes, sube los PDF del curso y usa /ia para redactar mejor. Solo tú
              las ves.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={onNuevoCurso}>
              <Plus /> Crear el primer curso
            </Button>
          </EmptyContent>
        </Empty>
      </Centro>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 pt-10 pb-24 md:pt-14">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Hola, {usuario.nombre}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tus apuntes por curso. Solo tú los ves.</p>
      </header>

      <section aria-labelledby="titulo-cursos" className="flex flex-col gap-3">
        <h2 id="titulo-cursos" className="text-sm font-medium text-muted-foreground">
          Cursos
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {arbol.cursos.map((curso) => {
            const notas = arbol.notas.filter((nota) => nota.curso_id === curso.id).length
            const recursos = arbol.recursos.filter((recurso) => recurso.curso_id === curso.id).length
            const destino: Lugar = { vista: "curso", id: curso.id, recursos: false }
            return (
              <li key={curso.id}>
                <a
                  href={direccionDe(destino)}
                  onClick={(event) => {
                    if (!clicNormal(event)) return
                    event.preventDefault()
                    onIr(destino)
                  }}
                  className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden className="text-3xl leading-none">
                    {curso.icono}
                  </span>
                  <span className="font-semibold">{curso.nombre}</span>
                  <span className="mt-auto text-xs text-muted-foreground">
                    {notas} {notas === 1 ? "nota" : "notas"} · {recursos} {recursos === 1 ? "recurso" : "recursos"}
                  </span>
                </a>
              </li>
            )
          })}
          <li>
            <button
              type="button"
              onClick={onNuevoCurso}
              className="flex h-full min-h-28 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-4 text-sm text-muted-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-5" /> Nuevo curso
            </button>
          </li>
        </ul>
      </section>

      <section aria-labelledby="titulo-recientes" className="flex flex-col gap-3">
        <h2 id="titulo-recientes" className="text-sm font-medium text-muted-foreground">
          Editadas hace poco
        </h2>
        {recientes.length === 0 ? (
          <Vacio>Todavía no hay notas. Abre un curso y escribe la primera.</Vacio>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {recientes.map((nota) => {
              const destino: Lugar = { vista: "nota", id: nota.id }
              const curso = cursoDe(nota.curso_id)
              return (
                <li key={nota.id}>
                  <a
                    href={direccionDe(destino)}
                    onClick={(event) => {
                      if (!clicNormal(event)) return
                      event.preventDefault()
                      onIr(destino)
                    }}
                    className="flex items-center gap-3 px-3 py-2.5 text-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{nota.titulo || "Sin título"}</span>
                    <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:block">
                      {curso?.icono} {curso?.nombre}
                    </span>
                    <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">{haceCuanto(nota.actualizado_en)}</span>
                  </a>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
