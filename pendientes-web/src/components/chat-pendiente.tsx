import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode, type TouchEvent } from "react"
import { Paperclip, Reply, ScanEye, SendHorizontal, Trash2, X } from "lucide-react"
import { cn } from "cn"

import { ChipArchivo, esImagenVisible, MiniaturaArchivo } from "@/components/archivos"
import { VisorImagenes } from "@/components/visor-imagenes"
import { PedirRevision } from "@/components/pedir-revision"
import { PerfilAvatar } from "@/components/perfil-avatar"
import { RedactarIA } from "@/components/redactar-ia"
import { Button } from "@/components/ui/button"
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import {
  api,
  esNoAutorizado,
  MAX_ARCHIVO_BYTES,
  mensajeDeError,
  type Archivo,
  type Comentario,
  type Pendiente,
  type Perfil,
  type Usuario,
} from "@/lib/api"
import { fechaCompleta, haceCuanto } from "@/lib/actividad"
import { useCambios } from "@/lib/cambios"
import { abrirArchivo, traeArchivos, urlDeArchivo } from "@/lib/archivos"
import { comprimirImagen } from "@/lib/comprimir-imagen"

// Mientras el chat está abierto se buscan mensajes nuevos cada tanto (y al volver a la pestaña).
// Los mensajes nuevos llegan al instante por los cambios en tiempo real; esto es por si esa conexión se cae.
const CADA_MS = 60_000
const MAX_SUGERENCIAS = 6
const MAX_ADJUNTOS = 10

// Deslizar un mensaje hacia la derecha lo responde, como en WhatsApp: se mueve hasta ARRASTRE_MAXIMO y responde desde ARRASTRE_RESPONDER.
const ARRASTRE_MAXIMO = 80
const ARRASTRE_RESPONDER = 56
// Responder y borrar aparecen al pasar el mouse; en pantallas táctiles se ven siempre.
const ACCION_DE_MENSAJE =
  "rounded-sm opacity-0 outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:opacity-100"

const resumenDe = (comentario: Comentario) =>
  comentario.texto ||
  (comentario.archivos.length === 1 ? `📎 ${comentario.archivos[0].nombre}` : `📎 ${comentario.archivos.length} archivos`)

// La cita del mensaje respondido: su autor en su color y un extracto. Si el original se borró, lo dice.
function CitaMensaje({
  original,
  perfil,
  deMi,
  enMio,
  onIr,
  className,
}: {
  original: Comentario | undefined
  perfil: Perfil | null | undefined
  deMi: boolean
  enMio: boolean
  onIr?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onIr}
      disabled={!original || !onIr}
      aria-label={original ? `Ir al mensaje de ${original.autor}` : undefined}
      className={cn(
        "flex w-full min-w-0 flex-col rounded-lg border-l-4 px-2 py-1 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:cursor-pointer",
        enMio ? "bg-primary-foreground/15" : "bg-background/60",
        className
      )}
      style={{ borderLeftColor: perfil?.color ?? "currentColor" }}
    >
      {original ? (
        <>
          <span className="font-semibold" style={enMio ? undefined : { color: perfil?.color }}>
            {deMi ? "Tú" : original.autor}
          </span>
          <span className={cn("line-clamp-2 break-words", enMio ? "text-primary-foreground/80" : "text-muted-foreground")}>
            {resumenDe(original)}
          </span>
        </>
      ) : (
        <span className="italic opacity-80">Mensaje borrado</span>
      )}
    </button>
  )
}

// Un archivo elegido para el próximo mensaje: mientras sube no tiene `archivo`.
type Adjunto = { clave: string; nombre: string; tipo: string; tamano: number; avance?: number; archivo?: Archivo }
// Lo escrito entre una @ y el cursor, mientras se escribe una mención.
const MENCION_EN_CURSO = /(?:^|\s)@([^\s@]{0,30})$/u

const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const sinTildes = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

// Los enlaces del mensaje se pueden abrir y las @menciones de perfiles salen con su imagen (resaltadas si son para quien lee).
function formatear(texto: string, perfiles: Perfil[], yo: string | null, mio: boolean) {
  const nombres = perfiles.map((perfil) => escapar(perfil.nombre)).sort((a, b) => b.length - a.length)
  const patron = new RegExp(`(https?:\\/\\/[^\\s]+)${nombres.length ? `|@(${nombres.join("|")})(?![\\p{L}\\p{N}_])` : ""}`, "giu")
  const partes: ReactNode[] = []
  let desde = 0
  for (const encontrado of texto.matchAll(patron)) {
    partes.push(texto.slice(desde, encontrado.index))
    const [completo, enlace, nombre] = encontrado
    if (enlace) {
      partes.push(
        <a key={encontrado.index} href={enlace} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">
          {enlace}
        </a>
      )
    } else {
      const perfil = perfiles.find((p) => p.nombre.toLowerCase() === nombre.toLowerCase())
      partes.push(
        <span
          key={encontrado.index}
          className={cn(
            "rounded-full py-px pr-1.5 pl-0.5 font-semibold whitespace-nowrap",
            mio ? "bg-primary-foreground/20" : "bg-primary/10 text-primary",
            perfil && perfil.id === yo && !mio && "bg-primary/20 ring-1 ring-primary/40"
          )}
        >
          <PerfilAvatar perfil={perfil} size="xs" className="mr-1" />
          {completo}
        </span>
      )
    }
    desde = encontrado.index + completo.length
  }
  partes.push(texto.slice(desde))
  return partes
}

export function ChatPendiente({
  credenciales,
  pendienteId,
  usuario,
  perfilesPorId,
  onCantidad,
  onSalir,
  enfocar = 0,
  revision,
}: {
  credenciales: string
  pendienteId: string
  usuario: Usuario | null
  perfilesPorId: Map<string, Perfil>
  onCantidad: (cantidad: number) => void
  onSalir: () => void
  // Cambia (>0) cuando hay que dejar el campo listo para escribir.
  enfocar?: number
  // Para pedirle a un compañero que lo revise (botón y /revisar); sin perfil no se puede.
  revision?: {
    pendiente: Pick<Pendiente, "estado" | "aprobaciones" | "revisiones">
    candidatos: Perfil[]
    onPedir: (revisores: string[], nota: string) => Promise<boolean>
  }
}) {
  const [comentarios, setComentarios] = useState<Comentario[] | null>(null)
  const [texto, setTexto] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [error, setError] = useState("")
  // La mención que se está escribiendo: desde la @ hasta el cursor.
  const [mencion, setMencion] = useState<{ inicio: number; fin: number; consulta: string } | null>(null)
  const [elegido, setElegido] = useState(0)
  // /ia abierto: dónde estaba escrito (ahí va lo que redacte la IA) y lo que ya había en el mensaje.
  const [ia, setIa] = useState<{ posicion: number; previo: string } | null>(null)
  const [pidiendoRevision, setPidiendoRevision] = useState(false)
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([])
  const [encima, setEncima] = useState(false)
  const [respondiendo, setRespondiendo] = useState<Comentario | null>(null)
  // Al agrandar una imagen se ven todas las del chat en carrusel, en el orden de los mensajes.
  const imagenesDelChat = useMemo(
    () =>
      (comentarios ?? []).flatMap((comentario) =>
        comentario.archivos.filter(esImagenVisible).map((archivo) => ({ ...archivo, url: urlDeArchivo(archivo.id) }))
      ),
    [comentarios]
  )
  const cargarImagen = useCallback((url: string) => api.urlDeImagen(credenciales, url), [credenciales])
  const [agrandada, setAgrandada] = useState<number | null>(null)
  // El mensaje al que se saltó desde una cita, resaltado un momento.
  const [resaltado, setResaltado] = useState<string | null>(null)
  const [deslizado, setDeslizado] = useState<{ id: string; dx: number } | null>(null)
  const toque = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null)
  const idSugerencias = useId()
  const idChat = useId()
  const entrada = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  const formulario = useRef<HTMLFormElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)
  // Desde el recordatorio de evidencia: el campo queda listo para escribir, una vez que el panel terminó de abrirse.
  useEffect(() => {
    if (!enfocar) return
    const espera = window.setTimeout(() => {
      campo.current?.focus()
      campo.current?.scrollIntoView({ block: "nearest" })
    }, 150)
    return () => window.clearTimeout(espera)
  }, [enfocar])
  const anclaMensaje = useRef({ getBoundingClientRect: () => campo.current?.getBoundingClientRect() ?? new DOMRect() })
  // Dónde queda el cursor del mensaje al cerrar el campo de /ia: donde estaba el /ia, o al final de lo redactado.
  const cursorTrasIA = useRef(0)
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

  useCambios((cambio) => {
    if (cambio.tipo === "conectado" || ((cambio.tipo === "comentarios" || cambio.tipo === "archivos") && cambio.pendiente_id === pendienteId)) cargar()
  })

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

  const perfiles = useMemo(() => [...perfilesPorId.values()], [perfilesPorId])
  const porId = useMemo(() => new Map((comentarios ?? []).map((comentario) => [comentario.id, comentario])), [comentarios])
  const yo = usuario?.perfil_id ?? null
  const perfilDe = (comentario: Comentario | undefined) => (comentario?.perfil_id ? perfilesPorId.get(comentario.perfil_id) : null)

  // Los que empiezan como lo escrito van primero; quien escribe no sale (no se avisa a sí mismo).
  const sugerencias = useMemo(() => {
    if (!mencion) return []
    const consulta = sinTildes(mencion.consulta)
    return perfiles
      .filter((perfil) => perfil.id !== yo && sinTildes(perfil.nombre).includes(consulta))
      .sort((a, b) => Number(sinTildes(b.nombre).startsWith(consulta)) - Number(sinTildes(a.nombre).startsWith(consulta)))
      .slice(0, MAX_SUGERENCIAS)
  }, [mencion, perfiles, yo])
  const sugerida = sugerencias[Math.min(elegido, sugerencias.length - 1)]

  function revisarMencion(elemento: HTMLTextAreaElement) {
    const fin = elemento.selectionStart
    const encontrada = fin === elemento.selectionEnd ? MENCION_EN_CURSO.exec(elemento.value.slice(0, fin)) : null
    if (!encontrada) {
      setMencion(null)
      return
    }
    const consulta = encontrada[1]
    if (consulta !== mencion?.consulta) setElegido(0)
    setMencion({ inicio: fin - consulta.length - 1, fin, consulta })
  }

  // Escribir /ia (al principio o después de un espacio) lo borra y abre el campo de la IA en ese lugar; /revisar lo borra y
  // abre el pedido de revisión.
  function revisarIA(elemento: HTMLTextAreaElement) {
    const cursor = elemento.selectionStart
    if (revision && cursor === elemento.selectionEnd && /(^|\s)\/revisar$/i.test(elemento.value.slice(0, cursor))) {
      setTexto(elemento.value.slice(0, cursor - 8) + elemento.value.slice(cursor))
      setMencion(null)
      setPidiendoRevision(true)
      return true
    }
    if (cursor !== elemento.selectionEnd || !/(^|\s)\/ia$/i.test(elemento.value.slice(0, cursor))) return false
    const sinComando = elemento.value.slice(0, cursor - 3) + elemento.value.slice(cursor)
    setTexto(sinComando)
    setMencion(null)
    setIa({ posicion: cursor - 3, previo: sinComando })
    cursorTrasIA.current = cursor - 3
    return true
  }

  async function redactar(borrador: string) {
    try {
      return await api.ia.redactar(credenciales, pendienteId, "chat", borrador)
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
      throw err
    }
  }

  function usarRedaccion(redactado: string, reemplaza: boolean) {
    if (!ia) return
    const nuevo = (reemplaza ? redactado : texto.slice(0, ia.posicion) + redactado + texto.slice(ia.posicion)).slice(0, 2000)
    cursorTrasIA.current = Math.min(reemplaza ? redactado.length : ia.posicion + redactado.length, nuevo.length)
    setTexto(nuevo)
    setIa(null)
  }

  async function pedirRevision(revisores: string[], nota: string) {
    if (!revision) return false
    const listo = await revision.onPedir(revisores, nota)
    if (listo) {
      setPidiendoRevision(false)
      cargar()
    }
    return listo
  }

  function mencionar(perfil: Perfil) {
    if (!mencion) return
    const insertado = `@${perfil.nombre} `
    const cursor = mencion.inicio + insertado.length
    setTexto(texto.slice(0, mencion.inicio) + insertado + texto.slice(mencion.fin))
    setMencion(null)
    requestAnimationFrame(() => {
      campo.current?.focus()
      campo.current?.setSelectionRange(cursor, cursor)
    })
  }

  const esMio = (comentario: Comentario) =>
    comentario.perfil_id ? comentario.perfil_id === usuario?.perfil_id : usuario?.perfil_id === null && comentario.autor === usuario.nombre

  function responder(comentario: Comentario) {
    setRespondiendo(comentario)
    requestAnimationFrame(() => campo.current?.focus())
  }

  function irAlMensaje(id: string) {
    document.getElementById(`${idChat}-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    setResaltado(id)
    window.setTimeout(() => setResaltado((actual) => (actual === id ? null : actual)), 1500)
  }

  // En pantallas táctiles: deslizar hacia la derecha responde; el desplazamiento vertical sigue siendo del navegador.
  const deslizable = (comentario: Comentario) => ({
    onTouchStart: (event: TouchEvent) => {
      toque.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, horizontal: null }
    },
    onTouchMove: (event: TouchEvent) => {
      const inicio = toque.current
      if (!inicio) return
      const dx = event.touches[0].clientX - inicio.x
      const dy = event.touches[0].clientY - inicio.y
      if (inicio.horizontal === null && Math.hypot(dx, dy) > 8) inicio.horizontal = Math.abs(dx) > Math.abs(dy)
      if (inicio.horizontal) setDeslizado({ id: comentario.id, dx: Math.max(0, Math.min(dx, ARRASTRE_MAXIMO)) })
    },
    onTouchEnd: () => {
      if (deslizado?.id === comentario.id && deslizado.dx >= ARRASTRE_RESPONDER) responder(comentario)
      toque.current = null
      setDeslizado(null)
    },
    onTouchCancel: () => {
      toque.current = null
      setDeslizado(null)
    },
  })

  // Se suben apenas se eligen (como borradores del próximo mensaje); el mensaje solo los nombra al enviarse.
  async function adjuntar(lista: FileList | File[]) {
    const archivos = [...lista].slice(0, Math.max(MAX_ADJUNTOS - adjuntos.length, 0))
    if (archivos.length < lista.length) setError(`Un mensaje lleva hasta ${MAX_ADJUNTOS} archivos.`)
    for (const original of archivos) {
      const clave = crypto.randomUUID()
      const quitar = () => setAdjuntos((actuales) => actuales.filter((a) => a.clave !== clave))
      setAdjuntos((actuales) => [...actuales, { clave, nombre: original.name, tipo: original.type, tamano: original.size }])
      // Las fotos y capturas se achican a WebP antes de subir; el límite cuenta después de eso.
      const archivo = await comprimirImagen(original)
      if (archivo.size > MAX_ARCHIVO_BYTES) {
        quitar()
        setError(`«${original.name}» pesa más de 500 MB.`)
        continue
      }
      try {
        const avanzar = (avance: number) => setAdjuntos((actuales) => actuales.map((a) => (a.clave === clave ? { ...a, avance } : a)))
        const subido = await api.archivos.subir(credenciales, pendienteId, archivo, true, avanzar)
        setAdjuntos((actuales) => actuales.map((a) => (a.clave === clave ? { ...a, archivo: subido } : a)))
      } catch (err) {
        quitar()
        fallar(err)
      }
    }
  }

  const subiendo = adjuntos.some((adjunto) => !adjunto.archivo)
  const listos = adjuntos.flatMap((adjunto) => (adjunto.archivo ? [adjunto.archivo.id] : []))
  const puedeEnviar = (texto.trim() !== "" || listos.length > 0) && !subiendo && !enviando

  async function enviar(event?: FormEvent) {
    event?.preventDefault()
    const limpio = texto.trim()
    if (!puedeEnviar) return
    setEnviando(true)
    setMencion(null)
    try {
      const nuevo = await api.comentarios.crear(credenciales, pendienteId, limpio, listos, respondiendo?.id ?? null)
      abajo.current = true
      setComentarios((actuales) => [...(actuales ?? []), nuevo])
      setTexto("")
      setAdjuntos([])
      setRespondiendo(null)
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
        className="flex max-h-[55svh] min-h-48 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 lg:max-h-none lg:flex-1"
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
            const perfil = perfilDe(comentario)
            const original = comentario.respuesta_a ? porId.get(comentario.respuesta_a) : undefined
            const dx = deslizado?.id === comentario.id ? deslizado.dx : 0
            return (
              <div
                key={comentario.id}
                id={`${idChat}-${comentario.id}`}
                className={cn("relative -m-1 rounded-xl p-1 transition-colors duration-700", resaltado === comentario.id && "bg-primary/15")}
                style={{ touchAction: "pan-y" }}
                {...deslizable(comentario)}
              >
                {dx > 0 && (
                  <Reply
                    aria-hidden
                    className="absolute top-1/2 left-1 size-5 -translate-y-1/2 text-muted-foreground"
                    style={{ opacity: Math.min(dx / ARRASTRE_RESPONDER, 1) }}
                  />
                )}
                <div
                  className={cn("group flex gap-2", mio && "flex-row-reverse")}
                  style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dx ? "none" : "transform 200ms" }}
                >
                  <PerfilAvatar perfil={perfil} size="sm" />
                  <div className={cn("flex max-w-[85%] min-w-0 flex-col gap-1", mio && "items-end")}>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {!mio && <span className="font-medium text-foreground">{comentario.autor}</span>}
                      {comentario.revision && (
                        <span className="flex items-center gap-1 font-medium text-primary">
                          <ScanEye className="size-3.5" /> Pidió revisión
                        </span>
                      )}
                      <time dateTime={comentario.creado_en} title={fechaCompleta.format(new Date(comentario.creado_en))}>
                        {haceCuanto(comentario.creado_en)}
                      </time>
                      <button
                        type="button"
                        aria-label={`Responder a ${mio ? "tu mensaje" : comentario.autor}`}
                        title="Responder"
                        className={cn(ACCION_DE_MENSAJE, "hover:text-foreground")}
                        onClick={() => responder(comentario)}
                      >
                        <Reply className="size-3.5" />
                      </button>
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
                            className={cn(ACCION_DE_MENSAJE, "hover:text-destructive")}
                            onClick={() => setConfirmando(comentario.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        ))}
                    </div>
                    {(comentario.texto || comentario.respuesta_a) && (
                      <div
                        className={cn(
                          "flex max-w-full min-w-0 flex-col gap-1 rounded-2xl px-3 py-2 text-sm",
                          mio ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-muted"
                        )}
                      >
                        {comentario.respuesta_a && (
                          <CitaMensaje
                            original={original}
                            perfil={perfilDe(original)}
                            deMi={Boolean(original && esMio(original))}
                            enMio={mio}
                            onIr={original && (() => irAlMensaje(original.id))}
                          />
                        )}
                        {comentario.texto && (
                          <p className="m-0 break-words whitespace-pre-wrap">{formatear(comentario.texto, perfiles, yo, mio)}</p>
                        )}
                      </div>
                    )}
                    {comentario.archivos.length > 0 && (
                      <div className={cn("flex max-w-full flex-col gap-1", mio && "items-end")}>
                        {comentario.archivos.map((archivo) =>
                          esImagenVisible(archivo) ? (
                            <MiniaturaArchivo
                              key={archivo.id}
                              credenciales={credenciales}
                              archivo={archivo}
                              onAbrir={() => setAgrandada(imagenesDelChat.findIndex((imagen) => imagen.id === archivo.id))}
                            />
                          ) : (
                            <ChipArchivo key={archivo.id} archivo={archivo} onAbrir={() => abrirArchivo(credenciales, archivo).catch(fallar)} />
                          )
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
      <VisorImagenes
        imagenes={imagenesDelChat}
        cargar={cargarImagen}
        inicial={agrandada}
        etiqueta="Imágenes del chat"
        onCerrar={() => setAgrandada(null)}
        onAbrirOriginal={(imagen) => {
          const archivo = imagenesDelChat.find((a) => a.id === imagen.id)
          if (archivo) abrirArchivo(credenciales, archivo).catch(fallar)
        }}
      />
      {error && (
        <p role="alert" className="m-0 px-4 pb-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Popover open={sugerencias.length > 0} onOpenChange={(abierto) => !abierto && setMencion(null)}>
        <PopoverAnchor asChild>
          <form
            ref={formulario}
            onSubmit={enviar}
            className={cn("flex flex-col gap-2 border-t p-3 transition-colors", encima && "bg-primary/10")}
            onDragOver={(event) => {
              if (!traeArchivos(event)) return
              event.preventDefault()
              setEncima(true)
            }}
            onDragLeave={() => setEncima(false)}
            onDrop={(event) => {
              if (!traeArchivos(event)) return
              event.preventDefault()
              setEncima(false)
              adjuntar(event.dataTransfer.files)
            }}
          >
            {respondiendo && (
              <div className="flex items-start gap-1" aria-label="Respondiendo a">
                <CitaMensaje
                  original={respondiendo}
                  perfil={perfilDe(respondiendo)}
                  deMi={esMio(respondiendo)}
                  enMio={false}
                  onIr={() => irAlMensaje(respondiendo.id)}
                  className="bg-muted"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label="No responder"
                  onClick={() => setRespondiendo(null)}
                >
                  <X />
                </Button>
              </div>
            )}
            {adjuntos.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Archivos para enviar">
                {adjuntos.map((adjunto) => (
                  <ChipArchivo
                    key={adjunto.clave}
                    archivo={adjunto.archivo ?? adjunto}
                    subiendo={!adjunto.archivo}
                    nota={!adjunto.archivo && adjunto.avance ? `${Math.round(adjunto.avance * 100)} %` : undefined}
                    onQuitar={() => setAdjuntos((actuales) => actuales.filter((a) => a.clave !== adjunto.clave))}
                  />
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                aria-label="Adjuntar archivos"
                title="Adjuntar archivos (también puedes pegarlos o soltarlos aquí)"
                onClick={() => entrada.current?.click()}
              >
                <Paperclip />
              </Button>
              {revision && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground"
                  aria-label="Pedir revisión"
                  title="Pedir revisión: le avisa a un compañero hasta que lo apruebe o lo rebote (también con /revisar)"
                  aria-expanded={pidiendoRevision}
                  onClick={() => setPidiendoRevision((abierto) => !abierto)}
                >
                  <ScanEye />
                </Button>
              )}
              <input
                ref={entrada}
                type="file"
                multiple
                hidden
                aria-label="Archivos para el mensaje"
                onChange={(event) => {
                  if (event.target.files) adjuntar(event.target.files)
                  event.target.value = ""
                }}
              />
              <Textarea
                ref={campo}
                aria-label="Mensaje"
                aria-autocomplete="list"
                aria-controls={sugerencias.length > 0 ? idSugerencias : undefined}
                placeholder={`Escribe un mensaje… (@ para mencionar, /ia para redactar con IA${revision ? ", /revisar para pedir revisión" : ""})`}
                value={texto}
                onChange={(event) => {
                  setTexto(event.target.value)
                  if (!revisarIA(event.target)) revisarMencion(event.target)
                }}
                onSelect={(event) => revisarMencion(event.currentTarget)}
                onPaste={(event) => {
                  // Una captura o un archivo copiado se adjunta; el texto se pega como siempre.
                  if (event.clipboardData.files.length === 0) return
                  event.preventDefault()
                  adjuntar(event.clipboardData.files)
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  // Con la lista de menciones abierta, las flechas eligen y Enter o Tab mencionan.
                  if (sugerida) {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault()
                      const paso = event.key === "ArrowDown" ? 1 : -1
                      setElegido((sugerencias.indexOf(sugerida) + paso + sugerencias.length) % sugerencias.length)
                      return
                    }
                    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                      event.preventDefault()
                      mencionar(sugerida)
                      return
                    }
                  }
                  // Enter envía; Shift+Enter hace un salto de línea.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    enviar()
                  }
                }}
                maxLength={2000}
                rows={1}
                className="max-h-32 min-h-9 resize-none py-2"
              />
              <Button type="submit" size="icon" className="shrink-0" disabled={!puedeEnviar} aria-label="Enviar mensaje">
                <SendHorizontal />
              </Button>
            </div>
          </form>
        </PopoverAnchor>
        {/* El foco se queda en el mensaje mientras se elige; Escape cierra solo la lista. */}
        <PopoverContent
          side="top"
          align="start"
          className="w-64 p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (formulario.current?.contains(event.target as Node)) event.preventDefault()
          }}
        >
          <Command
            shouldFilter={false}
            value={sugerida?.id ?? ""}
            onValueChange={(id) => setElegido(Math.max(sugerencias.findIndex((perfil) => perfil.id === id), 0))}
          >
            <CommandList id={idSugerencias}>
              <CommandGroup heading="Mencionar y avisar a">
                {sugerencias.map((perfil) => (
                  <CommandItem key={perfil.id} value={perfil.id} onSelect={() => mencionar(perfil)}>
                    <PerfilAvatar perfil={perfil} size="sm" />
                    {perfil.nombre}
                    {!perfil.tiene_contrasena && (
                      <span className="ml-auto text-xs text-muted-foreground" title="Verá el aviso cuando entre con su perfil">
                        aún no entra
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {/* El pedido de revisión también sale encima del mensaje. */}
      {revision && (
        <Popover open={pidiendoRevision} onOpenChange={setPidiendoRevision}>
          <PopoverAnchor virtualRef={anclaMensaje} />
          <PopoverContent
            side="top"
            align="start"
            className="w-[min(22rem,calc(100vw-2rem))] p-3"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              campo.current?.focus()
            }}
          >
            <PedirRevision pendiente={revision.pendiente} candidatos={revision.candidatos} onPedir={pedirRevision} />
          </PopoverContent>
        </Popover>
      )}
      {/* El campo de /ia sale encima del mensaje; al cerrarlo, el foco vuelve al mensaje. */}
      <Popover open={ia !== null} onOpenChange={(abierto) => !abierto && setIa(null)}>
        <PopoverAnchor virtualRef={anclaMensaje} />
        <PopoverContent
          side="top"
          align="start"
          className="w-[min(28rem,calc(100vw-2rem))] p-3"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            campo.current?.focus()
            campo.current?.setSelectionRange(cursorTrasIA.current, cursorTrasIA.current)
          }}
        >
          {ia && <RedactarIA previo={ia.previo} redactar={redactar} onUsar={usarRedaccion} />}
        </PopoverContent>
      </Popover>
    </div>
  )
}
