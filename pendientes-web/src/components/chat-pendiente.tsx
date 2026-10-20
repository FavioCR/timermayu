import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Paperclip, SendHorizontal, Trash2 } from "lucide-react"
import { cn } from "cn"

import { ChipArchivo } from "@/components/archivos"
import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { api, esNoAutorizado, MAX_IMAGEN_BYTES, mensajeDeError, type Archivo, type Comentario, type Perfil, type Usuario } from "@/lib/api"
import { fechaCompleta, haceCuanto } from "@/lib/actividad"
import { abrirArchivo, traeArchivos } from "@/lib/archivos"
import { comprimirImagen } from "@/lib/comprimir-imagen"

// Mientras el chat está abierto se buscan mensajes nuevos cada tanto (y al volver a la pestaña).
const CADA_MS = 10_000
const MAX_SUGERENCIAS = 6
const MAX_ADJUNTOS = 10

// Un archivo elegido para el próximo mensaje: mientras sube no tiene `archivo`.
type Adjunto = { clave: string; nombre: string; tipo: string; tamano: number; archivo?: Archivo }
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
  // La mención que se está escribiendo: desde la @ hasta el cursor.
  const [mencion, setMencion] = useState<{ inicio: number; fin: number; consulta: string } | null>(null)
  const [elegido, setElegido] = useState(0)
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([])
  const [encima, setEncima] = useState(false)
  const idSugerencias = useId()
  const entrada = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  const formulario = useRef<HTMLFormElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)
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

  const perfiles = useMemo(() => [...perfilesPorId.values()], [perfilesPorId])
  const yo = usuario?.perfil_id ?? null

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

  // Se suben apenas se eligen (como borradores del próximo mensaje); el mensaje solo los nombra al enviarse.
  async function adjuntar(lista: FileList | File[]) {
    const archivos = [...lista].slice(0, Math.max(MAX_ADJUNTOS - adjuntos.length, 0))
    if (archivos.length < lista.length) setError(`Un mensaje lleva hasta ${MAX_ADJUNTOS} archivos.`)
    for (const original of archivos) {
      const clave = crypto.randomUUID()
      const quitar = () => setAdjuntos((actuales) => actuales.filter((a) => a.clave !== clave))
      setAdjuntos((actuales) => [...actuales, { clave, nombre: original.name, tipo: original.type, tamano: original.size }])
      // Las fotos y capturas se achican a WebP antes de subir; los 10 MB cuentan después de eso.
      const archivo = await comprimirImagen(original)
      if (archivo.size > MAX_IMAGEN_BYTES) {
        quitar()
        setError(`«${original.name}» pesa más de 10 MB.`)
        continue
      }
      try {
        const subido = await api.archivos.subir(credenciales, pendienteId, archivo, true)
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
      const nuevo = await api.comentarios.crear(credenciales, pendienteId, limpio, listos)
      abajo.current = true
      setComentarios((actuales) => [...(actuales ?? []), nuevo])
      setTexto("")
      setAdjuntos([])
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
                <PerfilAvatar perfil={perfil} size="sm" />
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
                  {comentario.texto && (
                    <p
                      className={cn(
                        "m-0 rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap",
                        mio ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-muted"
                      )}
                    >
                      {formatear(comentario.texto, perfiles, yo, mio)}
                    </p>
                  )}
                  {comentario.archivos.length > 0 && (
                    <div className={cn("flex max-w-full flex-col gap-1", mio && "items-end")}>
                      {comentario.archivos.map((archivo) => (
                        <ChipArchivo key={archivo.id} archivo={archivo} onAbrir={() => abrirArchivo(credenciales, archivo).catch(fallar)} />
                      ))}
                    </div>
                  )}
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
            {adjuntos.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Archivos para enviar">
                {adjuntos.map((adjunto) => (
                  <ChipArchivo
                    key={adjunto.clave}
                    archivo={adjunto.archivo ?? adjunto}
                    subiendo={!adjunto.archivo}
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
                placeholder="Escribe un mensaje… (@ para mencionar)"
                value={texto}
                onChange={(event) => {
                  setTexto(event.target.value)
                  revisarMencion(event.target)
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
    </div>
  )
}
