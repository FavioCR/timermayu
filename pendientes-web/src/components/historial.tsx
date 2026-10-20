import { useEffect, useState } from "react"
import {
  ArrowRightLeft,
  CircleCheck,
  FileText,
  Folder,
  Forward,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react"

import { api, esNoAutorizado, mensajeDeError, type Actividad, type TipoActividad } from "@/lib/api"
import { describir, detalleDe, dia, fechaCompleta, haceCuanto } from "@/lib/actividad"
import { COLUMNAS } from "@/lib/estados"

const ICONOS: Record<TipoActividad, typeof Plus> = {
  creado: Plus,
  texto: Pencil,
  estado: ArrowRightLeft,
  asignado: UserRound,
  proyecto: Folder,
  descripcion: FileText,
  comentario: MessageSquare,
  borrado: Trash2,
  traspaso: Forward,
  archivo: Paperclip,
}

function agruparPorDia(items: Actividad[]) {
  const grupos: [string, Actividad[]][] = []
  for (const item of items) {
    const nombre = dia(item.creado_en)
    const ultimo = grupos.at(-1)
    if (ultimo?.[0] === nombre) ultimo[1].push(item)
    else grupos.push([nombre, [item]])
  }
  return grupos
}

// Línea de tiempo agrupada por día, lo más nuevo arriba. Con onAbrir, cada entrada de un pendiente que
// todavía se puede abrir lleva a su detalle.
export function ListaActividad({
  items,
  conTitulo = true,
  yo = null,
  abribles,
  onAbrir,
}: {
  items: Actividad[]
  conTitulo?: boolean
  yo?: string | null
  abribles?: Set<string>
  onAbrir?: (pendienteId: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {agruparPorDia(items).map(([nombre, lista]) => (
        <section key={nombre} aria-label={nombre}>
          <h3 className="mb-3 text-xs font-medium text-muted-foreground">{nombre}</h3>
          <ol className="ml-3 flex flex-col gap-4 border-l pl-6">
            {lista.map((actividad) => {
              const Icono = actividad.tipo === "estado" && actividad.datos?.a === "hecho" ? CircleCheck : ICONOS[actividad.tipo]
              const color = actividad.tipo === "estado" ? COLUMNAS.find((columna) => columna.id === actividad.datos?.a)?.color : undefined
              const abrible = onAbrir && actividad.pendiente_id && abribles?.has(actividad.pendiente_id)
              const detalle = detalleDe(actividad)
              const frase = (
                <>
                  <span className="font-medium text-foreground">{actividad.autor}</span> {describir(actividad, { conTitulo, yo })}
                </>
              )
              return (
                <li key={actividad.id} className="relative">
                  <span
                    className="absolute top-0 -left-[2.3rem] flex size-6 items-center justify-center rounded-full border bg-popover text-muted-foreground [&_svg]:size-3.5"
                    style={color ? { color, borderColor: color } : undefined}
                  >
                    <Icono />
                  </span>
                  {abrible ? (
                    <button
                      type="button"
                      className="rounded-sm text-left text-sm text-muted-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onAbrir(actividad.pendiente_id!)}
                    >
                      {frase}
                    </button>
                  ) : (
                    <p className="m-0 text-sm text-muted-foreground">{frase}</p>
                  )}
                  {detalle && (
                    <p className="m-0 mt-1.5 line-clamp-3 rounded-md bg-muted px-2.5 py-1.5 text-xs break-words whitespace-pre-line text-foreground/80">
                      {detalle}
                    </p>
                  )}
                  <time
                    className="mt-0.5 block text-xs text-muted-foreground/80"
                    dateTime={actividad.creado_en}
                    title={fechaCompleta.format(new Date(actividad.creado_en))}
                  >
                    {haceCuanto(actividad.creado_en)}
                  </time>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}

// El historial de un pendiente. Se vuelve a pedir cuando cambia `version` (el pendiente se actualizó).
export function HistorialPendiente({
  credenciales,
  pendienteId,
  version,
  yo,
  onSalir,
}: {
  credenciales: string
  pendienteId: string
  version: string
  yo: string | null
  onSalir: () => void
}) {
  const [items, setItems] = useState<Actividad[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let vigente = true
    api.actividad
      .dePendiente(credenciales, pendienteId)
      .then((nuevos) => {
        if (!vigente) return
        setItems(nuevos)
        setError("")
      })
      .catch((err) => {
        if (!vigente) return
        if (esNoAutorizado(err)) onSalir()
        else setError(mensajeDeError(err))
      })
    return () => {
      vigente = false
    }
  }, [credenciales, pendienteId, version, onSalir])

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )
  }
  if (!items) return <p className="text-sm text-muted-foreground">Cargando…</p>
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin cambios anotados todavía. Desde ahora queda aquí cada cambio de este pendiente.</p>
  }
  return <ListaActividad items={items} conTitulo={false} yo={yo} />
}
