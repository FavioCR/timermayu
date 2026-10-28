import { useRef, useState, type FormEvent } from "react"
import { Folder, FolderInput, FolderOpen, Lock, MoreVertical, Palette, Pencil, Plus, Trash2, UserPlus, Users, UsersRound } from "lucide-react"

import { InvolucradosMenu } from "@/components/involucrados-menu"
import { SelectorColor } from "@/components/selector-color"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  api,
  colorLibre,
  COLORES_PERFIL,
  esNoAutorizado,
  mensajeDeError,
  type Organizacion,
  type Perfil,
  type Proyecto,
  type Usuario,
} from "@/lib/api"
import {
  agrupar,
  conOrganizacion,
  conProyecto,
  SIN_ORGANIZACION,
  sinOrganizacion,
  sinProyecto,
  type Catalogo,
} from "@/lib/catalogo"

type Props = {
  abierto: boolean
  onAbiertoChange: (abierto: boolean) => void
  credenciales: string
  catalogo: Catalogo
  onCatalogo: (cambiar: (actual: Catalogo) => Catalogo) => void
  perfiles: Perfil[]
  usuario: Usuario | null
  pendientesPorProyecto: Map<string, number>
  onSalir: () => void
}

const plural = (cantidad: number, singular: string, varios: string) => `${cantidad} ${cantidad === 1 ? singular : varios}`

// Enter guarda y Escape cancela; al salir del campo también se guarda.
function CampoNombre({
  valor,
  etiqueta,
  maximo,
  onGuardar,
  onCancelar,
}: {
  valor: string
  etiqueta: string
  maximo: number
  onGuardar: (nombre: string) => void
  onCancelar: () => void
}) {
  const cancelado = useRef(false)
  return (
    <Input
      autoFocus
      aria-label={etiqueta}
      defaultValue={valor}
      maxLength={maximo}
      className="h-7 min-w-0 flex-1"
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault()
          cancelado.current = event.key === "Escape"
          event.currentTarget.blur()
        }
      }}
      onBlur={(event) => {
        const limpio = event.currentTarget.value.trim().replace(/\s+/g, " ")
        if (!cancelado.current && limpio && limpio !== valor) onGuardar(limpio)
        else onCancelar()
      }}
    />
  )
}

function NuevoProyecto({ organizacion, onCrear }: { organizacion: Organizacion | null; onCrear: (nombre: string) => Promise<boolean> }) {
  const [nombre, setNombre] = useState("")
  const destino = organizacion ? `en ${organizacion.nombre}` : "sin organización"

  async function crear(event: FormEvent) {
    event.preventDefault()
    if (nombre.trim() && (await onCrear(nombre.trim()))) setNombre("")
  }

  return (
    <form onSubmit={crear} className="ml-1.5 flex gap-1.5 border-l pt-1 pl-3">
      <Input
        aria-label={`Nuevo proyecto ${destino}`}
        placeholder="Nuevo proyecto"
        value={nombre}
        onChange={(event) => setNombre(event.target.value)}
        maxLength={60}
        className="h-8"
      />
      <Button type="submit" size="icon-sm" variant="outline" className="size-8" aria-label={`Agregar proyecto ${destino}`} disabled={!nombre.trim()}>
        <Plus />
      </Button>
    </form>
  )
}

// Organizaciones con sus proyectos. Una privada, con sus proyectos y pendientes, solo la ve quien la creó.
export function ProyectosDialog({
  abierto,
  onAbiertoChange,
  credenciales,
  catalogo,
  onCatalogo,
  perfiles,
  usuario,
  pendientesPorProyecto,
  onSalir,
}: Props) {
  const [error, setError] = useState("")
  const [renombrando, setRenombrando] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [nombre, setNombre] = useState("")
  const [color, setColor] = useState<string | null>(null)
  const [privada, setPrivada] = useState(false)
  // Lo que toca hacer cuando un menú termina de cerrarse (en vez de devolver el foco a su botón).
  const despuesDelMenu = useRef<(() => void) | null>(null)

  const conPerfil = Boolean(usuario?.perfil_id)
  const grupos = agrupar(catalogo).filter((grupo) => grupo.organizacion || grupo.proyectos.length > 0)
  const colorElegido = color ?? colorLibre(catalogo.organizaciones.map((organizacion) => organizacion.color))
  const pendientesDe = (proyectos: Proyecto[]) => proyectos.reduce((total, proyecto) => total + (pendientesPorProyecto.get(proyecto.id) ?? 0), 0)

  async function intentar(accion: () => Promise<void>) {
    try {
      await accion()
      setError("")
      return true
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
      setError(mensajeDeError(err))
      return false
    }
  }

  function alCerrarMenu(event: Event) {
    const despues = despuesDelMenu.current
    if (!despues) return
    event.preventDefault()
    despuesDelMenu.current = null
    despues()
  }

  // Las del equipo las cambia cualquiera; las de un perfil, solo su dueño.
  const puedeCambiar = (organizacion: Organizacion) => organizacion.duenio_id === null || organizacion.duenio_id === usuario?.perfil_id

  function deQuien(organizacion: Organizacion) {
    if (!organizacion.duenio_id) return "del equipo"
    if (organizacion.duenio_id === usuario?.perfil_id) return "tuya"
    return `de ${perfiles.find((perfil) => perfil.id === organizacion.duenio_id)?.nombre ?? "otro perfil"}`
  }

  async function crearOrganizacion(event: FormEvent) {
    event.preventDefault()
    if (!nombre.trim()) return
    const creada = await intentar(async () => {
      const nueva = await api.organizaciones.crear(credenciales, { nombre: nombre.trim(), color: colorElegido, compartida: !privada })
      onCatalogo((actual) => conOrganizacion(actual, nueva))
    })
    if (creada) {
      setNombre("")
      setColor(null)
      setPrivada(false)
    }
  }

  const cambiarOrganizacion = (organizacion: Organizacion, cambios: Partial<Pick<Organizacion, "nombre" | "color" | "compartida">>) =>
    intentar(async () => {
      const nueva = await api.organizaciones.actualizar(credenciales, organizacion.id, cambios)
      onCatalogo((actual) => conOrganizacion(actual, nueva))
    })

  // Se ve al instante, para poder marcar varias personas seguidas; si falla, vuelve a como estaba.
  async function cambiarInvolucrados(organizacion: Organizacion, miembros: string[]) {
    onCatalogo((actual) => conOrganizacion(actual, { ...organizacion, miembros }))
    const listo = await intentar(async () => {
      await api.organizaciones.actualizar(credenciales, organizacion.id, { miembros })
    })
    if (!listo) onCatalogo((actual) => conOrganizacion(actual, organizacion))
  }

  const nombresDe = (miembros: string[]) =>
    perfiles
      .filter((perfil) => miembros.includes(perfil.id))
      .map((perfil) => perfil.nombre)
      .join(", ")

  const borrarOrganizacion = (organizacion: Organizacion) =>
    intentar(async () => {
      await api.organizaciones.borrar(credenciales, organizacion.id)
      onCatalogo((actual) => sinOrganizacion(actual, organizacion.id))
    })

  const crearProyecto = (nombreProyecto: string, organizacionId: string | null) =>
    intentar(async () => {
      const nuevo = await api.proyectos.crear(credenciales, { nombre: nombreProyecto, organizacion_id: organizacionId })
      onCatalogo((actual) => conProyecto(actual, nuevo))
    })

  const cambiarProyecto = (proyecto: Proyecto, cambios: Partial<Pick<Proyecto, "nombre" | "organizacion_id">>) =>
    intentar(async () => {
      const nuevo = await api.proyectos.actualizar(credenciales, proyecto.id, cambios)
      onCatalogo((actual) => conProyecto(actual, nuevo))
    })

  const borrarProyecto = (proyecto: Proyecto) =>
    intentar(async () => {
      await api.proyectos.borrar(credenciales, proyecto.id)
      onCatalogo((actual) => sinProyecto(actual, proyecto.id))
    })

  function confirmar(pregunta: string, onSi: () => void) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <span className="hidden text-xs text-muted-foreground sm:inline">{pregunta}</span>
        <Button
          size="xs"
          variant="destructive"
          onClick={() => {
            setConfirmando(null)
            onSi()
          }}
        >
          Sí, borrar
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setConfirmando(null)}>
          No
        </Button>
      </div>
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(siguiente) => {
        setRenombrando(null)
        setConfirmando(null)
        setError("")
        onAbiertoChange(siguiente)
      }}
    >
      <DialogContent
        data-seguir="seccion:proyectos"
        className="max-h-[90svh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg"
        // Mientras se renombra, Escape cancela el nombre y no cierra la ventana.
        onEscapeKeyDown={(event) => renombrando && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Organizaciones y proyectos</DialogTitle>
          <DialogDescription>
            Cada organización agrupa sus proyectos y a las personas involucradas. Una privada, con todo lo que tiene dentro, solo la ve
            quien la creó.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex flex-col divide-y overflow-y-auto px-4">
          {grupos.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              Todavía no hay organizaciones. Crea la primera abajo (por ejemplo, Mayugo) y agrégale sus proyectos.
            </p>
          )}
          {grupos.map(({ organizacion, proyectos }) => {
            const clave = organizacion ? `o:${organizacion.id}` : SIN_ORGANIZACION
            const total = pendientesDe(proyectos)
            return (
              <section key={clave} className="flex flex-col gap-1 py-3" aria-label={organizacion?.nombre ?? "Sin organización"}>
                <div className="flex min-h-9 items-center gap-2.5">
                  {organizacion ? (
                    <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: organizacion.color }} />
                  ) : (
                    <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  {organizacion && renombrando === clave ? (
                    <CampoNombre
                      valor={organizacion.nombre}
                      etiqueta="Nombre de la organización"
                      maximo={40}
                      onGuardar={(nuevo) => {
                        setRenombrando(null)
                        cambiarOrganizacion(organizacion, { nombre: nuevo })
                      }}
                      onCancelar={() => setRenombrando(null)}
                    />
                  ) : (
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">{organizacion?.nombre ?? "Sin organización"}</h3>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground [&_svg]:size-3">
                        {organizacion ? (
                          <>
                            {organizacion.compartida ? <Users /> : <Lock />}
                            {organizacion.compartida ? "Compartida" : "Privada"} · {deQuien(organizacion)} · {plural(total, "pendiente", "pendientes")}
                          </>
                        ) : (
                          <>Proyectos sueltos · los ve todo el equipo</>
                        )}
                      </p>
                    </div>
                  )}
                  {organizacion && confirmando === clave ? (
                    confirmar(
                      proyectos.length ? `¿Con sus ${plural(proyectos.length, "proyecto", "proyectos")}?` : "¿Borrarla?",
                      () => borrarOrganizacion(organizacion)
                    )
                  ) : (
                    organizacion &&
                    puedeCambiar(organizacion) &&
                    renombrando !== clave && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Opciones de ${organizacion.nombre}`}>
                            <MoreVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-52" onCloseAutoFocus={alCerrarMenu}>
                          <DropdownMenuItem onSelect={() => (despuesDelMenu.current = () => setRenombrando(clave))}>
                            <Pencil /> Renombrar
                          </DropdownMenuItem>
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <Palette /> Color
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              <DropdownMenuRadioGroup
                                value={organizacion.color.toUpperCase()}
                                onValueChange={(nuevo) => cambiarOrganizacion(organizacion, { color: nuevo })}
                              >
                                {COLORES_PERFIL.map((opcion) => (
                                  <DropdownMenuRadioItem key={opcion} value={opcion}>
                                    <span className="size-3 rounded-full" style={{ backgroundColor: opcion }} /> {opcion}
                                  </DropdownMenuRadioItem>
                                ))}
                              </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          {organizacion.duenio_id !== null && (
                            <DropdownMenuItem onSelect={() => cambiarOrganizacion(organizacion, { compartida: !organizacion.compartida })}>
                              {organizacion.compartida ? (
                                <>
                                  <Lock /> Hacerla privada
                                </>
                              ) : (
                                <>
                                  <Users /> Compartirla con el equipo
                                </>
                              )}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={total > 0}
                            onSelect={() => (despuesDelMenu.current = () => setConfirmando(clave))}
                          >
                            <Trash2 /> {total > 0 ? "Borrar (tiene pendientes)" : "Borrar organización"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )
                  )}
                </div>

                {organizacion?.compartida && (
                  <div className="ml-1.5 flex min-h-9 items-center gap-2 border-l pl-3 text-sm">
                    <UsersRound className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground" title={nombresDe(organizacion.miembros)}>
                      {organizacion.miembros.length ? nombresDe(organizacion.miembros) : "Nadie todavía (se puede asignar a todos)"}
                    </span>
                    <InvolucradosMenu organizacion={organizacion} perfiles={perfiles} onCambiar={(miembros) => cambiarInvolucrados(organizacion, miembros)}>
                      <Button variant="ghost" size="xs" className="shrink-0" aria-label={`Agregar o quitar personas de ${organizacion.nombre}`}>
                        <UserPlus /> Personas
                      </Button>
                    </InvolucradosMenu>
                  </div>
                )}

                {proyectos.length > 0 && (
                  <ul className="ml-1.5 flex flex-col border-l pl-3">
                    {proyectos.map((proyecto) => {
                      const claveProyecto = `p:${proyecto.id}`
                      const cantidad = pendientesPorProyecto.get(proyecto.id) ?? 0
                      return (
                        <li key={proyecto.id} className="flex min-h-9 items-center gap-2">
                          <Folder className="size-4 shrink-0 text-muted-foreground" />
                          {renombrando === claveProyecto ? (
                            <CampoNombre
                              valor={proyecto.nombre}
                              etiqueta="Nombre del proyecto"
                              maximo={60}
                              onGuardar={(nuevo) => {
                                setRenombrando(null)
                                cambiarProyecto(proyecto, { nombre: nuevo })
                              }}
                              onCancelar={() => setRenombrando(null)}
                            />
                          ) : (
                            <span className="min-w-0 flex-1 truncate">{proyecto.nombre}</span>
                          )}
                          {confirmando === claveProyecto ? (
                            confirmar("¿Borrar el proyecto?", () => borrarProyecto(proyecto))
                          ) : (
                            renombrando !== claveProyecto && (
                              <>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                  {plural(cantidad, "pendiente", "pendientes")}
                                </span>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Opciones de ${proyecto.nombre}`}>
                                      <MoreVertical />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="min-w-52" onCloseAutoFocus={alCerrarMenu}>
                                    <DropdownMenuItem onSelect={() => (despuesDelMenu.current = () => setRenombrando(claveProyecto))}>
                                      <Pencil /> Renombrar
                                    </DropdownMenuItem>
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger>
                                        <FolderInput /> Mover a
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent className="min-w-48">
                                        <DropdownMenuRadioGroup
                                          value={proyecto.organizacion_id ?? SIN_ORGANIZACION}
                                          onValueChange={(destino) =>
                                            cambiarProyecto(proyecto, { organizacion_id: destino === SIN_ORGANIZACION ? null : destino })
                                          }
                                        >
                                          {catalogo.organizaciones.map((opcion) => (
                                            <DropdownMenuRadioItem key={opcion.id} value={opcion.id}>
                                              <span className="size-2.5 rounded-full" style={{ backgroundColor: opcion.color }} />
                                              {opcion.nombre}
                                              {!opcion.compartida && <Lock className="text-muted-foreground" />}
                                            </DropdownMenuRadioItem>
                                          ))}
                                          {catalogo.organizaciones.length > 0 && <DropdownMenuSeparator />}
                                          <DropdownMenuRadioItem value={SIN_ORGANIZACION}>Sin organización</DropdownMenuRadioItem>
                                        </DropdownMenuRadioGroup>
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      variant="destructive"
                                      disabled={cantidad > 0}
                                      onSelect={() => (despuesDelMenu.current = () => setConfirmando(claveProyecto))}
                                    >
                                      <Trash2 /> {cantidad > 0 ? "Borrar (tiene pendientes)" : "Borrar proyecto"}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </>
                            )
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
                <NuevoProyecto organizacion={organizacion} onCrear={(nuevo) => crearProyecto(nuevo, organizacion?.id ?? null)} />
              </section>
            )
          })}
        </div>

        <form onSubmit={crearOrganizacion} className="flex flex-col gap-3 border-t pt-4">
          <div className="flex gap-2">
            <Input
              aria-label="Nombre de la organización nueva"
              placeholder="Nueva organización"
              value={nombre}
              onChange={(event) => setNombre(event.target.value)}
              maxLength={40}
            />
            <Button type="submit" disabled={!nombre.trim()}>
              <Plus /> Crear
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SelectorColor valor={colorElegido} onCambiar={setColor} etiqueta="Color de la organización" />
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={privada && conPerfil} onCheckedChange={setPrivada} disabled={!conPerfil} />
              <Lock className="size-3.5 text-muted-foreground" /> Privada
            </label>
          </div>
          {!conPerfil && (
            <p className="text-xs text-muted-foreground">
              Con la cuenta del equipo todo es compartido. Entra con tu perfil para crear organizaciones privadas.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
