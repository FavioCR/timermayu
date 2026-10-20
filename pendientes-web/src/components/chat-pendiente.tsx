import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { SendHorizontal, Trash2 } from "lucide-react"
import { cn } from "cn"

import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { api, esNoAutorizado, mensajeDeError, type Comentario, type Perfil, type Usuario } from "@/lib/api"
import { fechaCompleta, haceCuanto } from "@/lib/actividad"

// Mientras el chat está abierto se buscan mensajes nuevos cada tanto (y al volver a la pestaña).
const CADA_MS = 10_000
const ENLACE = /(https?:\/\/[^\s]+)/g

// Los enlaces del mensaje se pueden abrir; el resto queda como texto.
function conEnlaces(texto: string) {
  return texto.split(ENLACE).map((parte, i) =>
    i % 2 ? (
      <a key={i} href={parte} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">
        {parte}
      </a>
    ) : (
      parte
    )
  )
}

export function ChatPendiente({
  credenciales,
  pendienteId,
  usuario,
  perfilesPorId,
  onCantidad,
  onSalir,
}: {
  credenciales: string
  pendienteId: string
  usuario: Usuario | null
  perfilesPorId: Map<string, Perfil>
  onCantidad: (cantidad: number) => void
  onSalir: () => void
}) {
  const [comentarios, setComentarios] = useState<Comentario[] | null>(null)
  const [texto, setTexto] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [error, setError] = useState("")
  const lista = useRef<HTMLDivElement>(null)
  // Si se está leyendo más arriba, los mensajes nuevos no lo bajan.
  const abajo = useRef(true)
  const avisarCantidad = useRef(onCantidad)
  useEffect(() => {
    avisarCantidad.current = onCantidad
  })

  const fallar = useCallback(
    (err: unknown) => {
      if (esNoAutorizado(err)) onSalir()
      else setError(mensajeDeError(err))
    },
    [onSalir]
  )

  const cargar = useCallback(async () => {
    try {
      setComentarios(await api.comentarios.listar(credenciales, pendienteId))
    } catch (err) {
      fallar(err)
    }
  }, [credenciales, pendienteId, fallar])

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

  useEffect(() => {
    if (!comentarios) return
    avisarCantidad.current(comentarios.length)
    const elemento = lista.current
    if (elemento && abajo.current) elemento.scrollTop = elemento.scrollHeight
  }, [comentarios])

  const esMio = (comentario: Comentario) =>
    comentario.perfil_id ? comentario.perfil_id === usuario?.perfil_id : usuario?.perfil_id === null && comentario.autor === usuario.nombre

  async function enviar(event?: FormEvent) {
    event?.preventDefault()
    const limpio = texto.trim()
    if (!limpio || enviando) return
    setEnviando(true)
    try {
      const nuevo = await api.comentarios.crear(credenciales, pendienteId, limpio)
      abajo.current = true
      setComentarios((actuales) => [...(actuales ?? []), nuevo])
      setTexto("")
      setError("")
    } catch (err) {
      fallar(err)
    } finally {
      setEnviando(false)
    }
  }

  async function borrar(comentario: Comentario) {
    setConfirmando(null)
    try {
      await api.comentarios.borrar(credenciales, comentario.id)
      setComentarios((actuales) => (actuales ?? []).filter((c) => c.id !== comentario.id))
      setError("")
    } catch (err) {
      fallar(err)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={lista}
        onScroll={(event) => {
          const elemento = event.currentTarget
          abajo.current = elemento.scrollHeight - elemento.scrollTop - elemento.clientHeight < 40
        }}
        className="flex max-h-[55svh] min-h-48 flex-col gap-4 overflow-y-auto p-4 lg:max-h-none lg:flex-1"
        role="log"
        aria-label="Mensajes"
      >
        {comentarios === null ? (
          !error && <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : comentarios.length === 0 ? (
          <p className="m-auto max-w-64 text-center text-sm text-muted-foreground">
            Todavía no hay mensajes. Escribe aquí para coordinar este pendiente; con @nombre le avisas a alguien.
          </p>
        ) : (
          comentarios.map((comentario) => {
            const mio = esMio(comentario)
            const perfil = comentario.perfil_id ? perfilesPorId.get(comentario.perfil_id) : null
            return (
              <div key={comentario.id} className={cn("group flex gap-2", mio && "flex-row-reverse")}>
                {!mio && <PerfilAvatar perfil={perfil} size="sm" />}
                <div className={cn("flex max-w-[85%] min-w-0 flex-col gap-1", mio && "items-end")}>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {!mio && <span className="font-medium text-foreground">{comentario.autor}</span>}
                    <time dateTime={comentario.creado_en} title={fechaCompleta.format(new Date(comentario.creado_en))}>
                      {haceCuanto(comentario.creado_en)}
                    </time>
                    {mio &&
                      (confirmando === comentario.id ? (
                        <span className="flex items-center gap-1">
                          <Button size="xs" variant="destructive" onClick={() => borrar(comentario)}>
                            Borrar
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => setConfirmando(null)}>
                            No
                          </Button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-label="Borrar mensaje"
                          className="rounded-sm opacity-0 outline-none group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => setConfirmando(comentario.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ))}
                  </div>
                  <p
                    className={cn(
                      "m-0 rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap",
                      mio ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-muted"
                    )}
                  >
                    {conEnlaces(comentario.texto)}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 px-4 pb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <form onSubmit={enviar} className="flex items-end gap-2 border-t p-3">
        <Textarea
          aria-label="Mensaje"
          placeholder="Escribe un mensaje… (@nombre para avisar)"
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          onKeyDown={(event) => {
            // Enter envía; Shift+Enter hace un salto de línea.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              enviar()
            }
          }}
          maxLength={2000}
          rows={1}
          className="max-h-32 min-h-9 resize-none py-2"
        />
        <Button type="submit" size="icon" className="shrink-0" disabled={!texto.trim() || enviando} aria-label="Enviar mensaje">
          <SendHorizontal />
        </Button>
      </form>
    </div>
  )
}
