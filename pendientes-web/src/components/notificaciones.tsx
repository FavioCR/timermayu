import { useCallback, useEffect, useRef, useState } from "react"
import { Bell, BellRing, CheckCheck, TriangleAlert, UsersRound, Volume2, VolumeX } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"

import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, esNoAutorizado, type Notificacion, type Perfil, type SinLeer } from "@/lib/api"
import { describir, detalleDe, haceCuanto } from "@/lib/actividad"
import { useCambios } from "@/lib/cambios"
import { activarSonido, esParaSonar, prepararSonido, sonarAviso, sonidoActivado } from "@/lib/sonido"

// Cada cuánto se buscan avisos nuevos (también al volver a la pestaña).
// Los avisos llegan al instante por los cambios en tiempo real; esto es por si esa conexión se cae.
const CADA_MS = 60_000
const TITULO = "Pendientes"

type Permiso = NotificationPermission | "sin_soporte"

const permisoActual = (): Permiso => ("Notification" in window ? Notification.permission : "sin_soporte")

// La campana de quien entró con su perfil. Avisa por tres cosas: te asignan algo, te mencionan con @ (en un mensaje o en
// una descripción; responder a tu mensaje cuenta como mencionarte) o alguien más cambia un pendiente que creaste. Un
// rebote (revisaron algo tuyo en Hecho y no lo aprobaron) resalta con el signo de atención.
// Con la pestaña en segundo plano y permiso del navegador, también avisa con una notificación del sistema.
// Además dice qué pendientes tienen avisos sin leer (para la campana de su tarjeta) y, al abrir uno, los lee.
export function Notificaciones({
  credenciales,
  yo,
  perfilesPorId,
  abribles,
  pendienteAbierto,
  onAbrir,
  onNovedades,
  onSinLeer,
  onSalir,
  abierto,
  onAbiertoChange: setAbierto,
}: {
  credenciales: string
  yo: string
  perfilesPorId: Map<string, Perfil>
  abribles: Set<string>
  pendienteAbierto: string | null
  onAbrir: (pendienteId: string) => void
  onNovedades: () => void
  onSinLeer: (sinLeer: SinLeer[]) => void
  onSalir: () => void
  // Lo lleva el tablero, para abrirlo o cerrarlo al seguir a alguien.
  abierto: boolean
  onAbiertoChange: (abierto: boolean) => void
}) {
  const [lista, setLista] = useState<Notificacion[]>([])
  const [noLeidas, setNoLeidas] = useState(0)
  const [sinLeer, setSinLeer] = useState<SinLeer[]>([])
  const [permiso, setPermiso] = useState(permisoActual)
  const [conSonido, setConSonido] = useState(sonidoActivado)
  // Ids ya vistos, para saber cuáles son nuevos. Null hasta la primera carga.
  const vistas = useRef<Set<string> | null>(null)
  // Lo que cambia en cada render se lee por ref para no reiniciar el intervalo.
  const actuales = useRef({ abribles, onAbrir, onNovedades, onSinLeer })
  useEffect(() => {
    actuales.current = { abribles, onAbrir, onNovedades, onSinLeer }
  })
  useEffect(() => actuales.current.onSinLeer(sinLeer), [sinLeer])
  // Lo recién asignado puede no haber llegado aún al tablero: se abre en cuanto llegue (o se olvida a los 10 s, por
  // ejemplo si lo borraron).
  const porAbrir = useRef<string | null>(null)
  useEffect(() => {
    const id = porAbrir.current
    if (!id || !abribles.has(id)) return
    porAbrir.current = null
    onAbrir(id)
  }, [abribles, onAbrir])

  const abrir = useCallback(
    (notificacion: Notificacion) => {
      setAbierto(false)
      if (!notificacion.leida) {
        setLista((actual) => actual.map((n) => (n.id === notificacion.id ? { ...n, leida: true } : n)))
        setNoLeidas((cantidad) => Math.max(cantidad - 1, 0))
        api.notificaciones.marcarLeidas(credenciales, [notificacion.id]).then(setNoLeidas).catch(() => {})
      }
      const id = notificacion.actividad.pendiente_id
      if (!id) return
      if (actuales.current.abribles.has(id)) return actuales.current.onAbrir(id)
      porAbrir.current = id
      actuales.current.onNovedades()
      window.setTimeout(() => {
        if (porAbrir.current === id) porAbrir.current = null
      }, 10_000)
    },
    [credenciales, setAbierto]
  )

  const cargar = useCallback(async () => {
    try {
      const datos = await api.notificaciones.listar(credenciales)
      setLista(datos.notificaciones)
      setNoLeidas(datos.no_leidas)
      setSinLeer(datos.sin_leer)
      const nuevas = vistas.current ? datos.notificaciones.filter((n) => !n.leida && !vistas.current!.has(n.id)) : []
      vistas.current = new Set(datos.notificaciones.map((n) => n.id))
      if (nuevas.length === 0) return
      // Si alguien cambió algo de uno, el tablero se pone al día.
      actuales.current.onNovedades()
      // Te asignaron algo o te mencionaron: suena y, con el tablero a la vista, sale también en la página.
      const importantes = nuevas.filter((notificacion) => esParaSonar(notificacion, yo))
      const sono = importantes.length === 0 || (await sonarAviso())
      if (importantes.length > 0 && document.visibilityState === "visible") {
        const [primera] = importantes
        const otras = importantes.length - 1
        toast(`${primera.actividad.autor} ${describir(primera.actividad, { yo })}`, {
          id: `aviso-${primera.id}`,
          description: [
            otras > 0 ? `Y ${otras === 1 ? "1 aviso más" : `${otras} avisos más`} en la campana.` : null,
            sono ? null : "No sonó: el navegador espera un clic en la página. Desde ese clic, suena.",
          ]
            .filter(Boolean)
            .join(" ") || undefined,
          action: primera.actividad.pendiente_id ? { label: "Abrir", onClick: () => abrir(primera) } : undefined,
          duration: 8000,
        })
      }
      // En otra pestaña o en otra app: aviso del sistema. Solo suena el de una asignación o mención, y solo si el
      // tablero no pudo sonar (así no suena dos veces).
      if ((document.hidden || !document.hasFocus()) && permisoActual() === "granted") {
        for (const notificacion of nuevas.slice(0, 3)) {
          const aviso = new Notification(`${notificacion.actividad.autor} ${describir(notificacion.actividad, { yo })}`, {
            body: detalleDe(notificacion.actividad) ?? "",
            tag: notificacion.id,
            silent: importantes.includes(notificacion) ? sono : true,
          })
          aviso.onclick = () => {
            window.focus()
            abrir(notificacion)
            aviso.close()
          }
        }
      }
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
    }
  }, [credenciales, yo, abrir, onSalir])

  useEffect(() => {
    const desbloquear = prepararSonido()
    return () => {
      window.removeEventListener("pointerdown", desbloquear)
      window.removeEventListener("keydown", desbloquear)
    }
  }, [])

  // Cualquier cambio de otra persona puede traer un aviso nuevo.
  useCambios((cambio) => cambio.tipo !== "ia" && cambio.tipo !== "presencia" && cargar())

  useEffect(() => {
    cargar()
    const intervalo = window.setInterval(cargar, CADA_MS)
    const alVolver = () => document.visibilityState === "visible" && cargar()
    document.addEventListener("visibilitychange", alVolver)
    return () => {
      window.clearInterval(intervalo)
      document.removeEventListener("visibilitychange", alVolver)
    }
  }, [cargar])

  // Abrir un pendiente lee sus avisos, también los que lleguen mientras está abierto.
  const leyendo = useRef<string | null>(null)
  useEffect(() => {
    const id = pendienteAbierto
    if (!id || leyendo.current === id || !sinLeer.some((pendiente) => pendiente.pendiente_id === id)) return
    leyendo.current = id
    api.notificaciones
      .leerPendiente(credenciales, id)
      .then((quedan) => {
        setNoLeidas(quedan)
        setLista((actual) => actual.map((n) => (n.actividad.pendiente_id === id ? { ...n, leida: true } : n)))
        setSinLeer((actual) => actual.filter((pendiente) => pendiente.pendiente_id !== id))
      })
      .catch((err) => {
        if (esNoAutorizado(err)) onSalir()
      })
      .finally(() => {
        leyendo.current = null
      })
  }, [credenciales, pendienteAbierto, sinLeer, onSalir])

  useEffect(() => {
    document.title = noLeidas ? `(${noLeidas}) ${TITULO}` : TITULO
    return () => {
      document.title = TITULO
    }
  }, [noLeidas])

  async function marcarTodas() {
    setLista((actual) => actual.map((n) => ({ ...n, leida: true })))
    setNoLeidas(0)
    setSinLeer([])
    try {
      setNoLeidas(await api.notificaciones.marcarLeidas(credenciales))
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
    }
  }

  function cambiarSonido() {
    activarSonido(!conSonido)
    setConSonido(!conSonido)
    // Al activarlo suena una vez, para que se sepa cómo es.
    if (!conSonido) sonarAviso()
  }

  async function pedirPermiso() {
    setPermiso(await Notification.requestPermission())
  }

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={noLeidas ? `Avisos: ${noLeidas} sin leer` : "Avisos"}>
          <Bell />
          {noLeidas > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white tabular-nums">
              {noLeidas > 9 ? "9+" : noLeidas}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent data-seguir="seccion:avisos" align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex min-h-12 items-center justify-between gap-2 border-b px-4 py-2">
          <p className="m-0 font-medium">Avisos</p>
          <div className="flex items-center gap-1">
            {noLeidas > 0 && (
              <Button variant="ghost" size="xs" onClick={marcarTodas}>
                <CheckCheck /> Marcar todo como leído
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-pressed={conSonido}
              aria-label={conSonido ? "Silenciar el sonido de los avisos" : "Activar el sonido de los avisos"}
              title={conSonido ? "Suena cuando te asignan o te mencionan. Clic para silenciar." : "Sin sonido. Clic para activarlo."}
              onClick={cambiarSonido}
            >
              {conSonido ? <Volume2 /> : <VolumeX />}
            </Button>
          </div>
        </div>
        <ul className="m-0 max-h-[min(28rem,60svh)] list-none overflow-y-auto p-0">
          {lista.length === 0 && (
            <li className="px-6 py-8 text-center text-sm text-muted-foreground">
              Sin avisos por ahora. Aquí verás lo que te asignen o te reboten, cuando te mencionen con @ y lo que otros cambien en lo que creaste.
            </li>
          )}
          {lista.map((notificacion) => {
            const { actividad } = notificacion
            const autor = actividad.perfil_id ? perfilesPorId.get(actividad.perfil_id) : null
            const rebote = actividad.tipo === "rebotado"
            return (
              <li key={notificacion.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => abrir(notificacion)}
                  className={cn(
                    "flex w-full gap-3 px-4 py-3 text-left outline-none hover:bg-accent focus-visible:bg-accent",
                    !notificacion.leida && (rebote ? "bg-destructive/8" : "bg-primary/8")
                  )}
                >
                  {autor ? (
                    <PerfilAvatar perfil={autor} size="sm" />
                  ) : (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <UsersRound className="size-3.5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", rebote && "text-destructive")}>
                      {rebote && <TriangleAlert className="mr-1 inline size-3.5 -translate-y-px" aria-label="Rebotado:" />}
                      <span className="font-medium">{actividad.autor}</span> {describir(actividad, { yo })}
                    </span>
                    {detalleDe(actividad) && (
                      <span className="mt-1 line-clamp-2 block text-xs break-words whitespace-pre-line text-muted-foreground">{detalleDe(actividad)}</span>
                    )}
                    <span className="mt-1 block text-xs text-muted-foreground/80">{haceCuanto(actividad.creado_en)}</span>
                  </span>
                  {!notificacion.leida && (
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", rebote ? "bg-destructive" : "bg-primary")} aria-label="Sin leer" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
        {permiso === "default" && (
          <div className="border-t p-3">
            <Button variant="outline" size="sm" className="w-full" onClick={pedirPermiso}>
              <BellRing /> Avisarme también con el navegador
            </Button>
          </div>
        )}
        {permiso === "denied" && (
          <p className="m-0 border-t px-4 py-3 text-xs text-muted-foreground">
            El navegador tiene bloqueados los avisos de esta página; actívalos en la configuración del sitio.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
