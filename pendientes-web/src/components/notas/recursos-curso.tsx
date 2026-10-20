import { useRef, useState, type DragEvent, type FormEvent } from "react"
import { Download, MoreHorizontal, Pencil, Trash2, Upload } from "lucide-react"
import { cn } from "cn"

import { ICONOS } from "@/components/archivos"
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
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { esNoAutorizado, mensajeDeError } from "@/lib/api"
import type { Subida } from "@/hooks/use-subidas"
import { haceCuanto } from "@/lib/actividad"
import { claseDeArchivo, tamanoLegible, traeArchivos } from "@/lib/archivos"
import { notasApi, type Curso, type Recurso } from "@/lib/notas"

export function IconoRecurso({ recurso, className }: { recurso: Pick<Recurso, "nombre" | "tipo">; className?: string }) {
  const clase = claseDeArchivo(recurso.nombre, recurso.tipo)
  const Icono = ICONOS[clase]
  const pdf = recurso.tipo === "application/pdf"
  return <Icono className={cn("shrink-0", pdf ? "text-red-500" : clase === "imagen" ? "text-sky-500" : "text-muted-foreground", className)} />
}

// Los recursos de un curso (PDF, guías, presentaciones…), a la mano: se sueltan aquí o se eligen, y se abren con un clic.
export function RecursosCurso({
  credenciales,
  curso,
  recursos,
  subidas,
  onSubir,
  onDescartar,
  onAbrir,
  onCambiado,
  onBorrado,
  onNoAutorizado,
}: {
  credenciales: string
  curso: Curso
  recursos: Recurso[]
  subidas: Subida[]
  onSubir: (archivos: File[]) => void
  onDescartar: (clave: string) => void
  onAbrir: (recurso: Recurso) => void
  onCambiado: (recurso: Recurso) => void
  onBorrado: (id: string) => void
  onNoAutorizado: () => void
}) {
  const elegir = useRef<HTMLInputElement>(null)
  const [encima, setEncima] = useState(false)
  const [renombrando, setRenombrando] = useState<Recurso | null>(null)
  const [nombre, setNombre] = useState("")
  const [borrando, setBorrando] = useState<Recurso | null>(null)
  const [error, setError] = useState("")

  function soltar(event: DragEvent) {
    if (!traeArchivos(event)) return
    event.preventDefault()
    setEncima(false)
    const archivos = [...event.dataTransfer.files]
    if (archivos.length) onSubir(archivos)
  }

  function fallo(err: unknown) {
    if (esNoAutorizado(err)) onNoAutorizado()
    else setError(mensajeDeError(err))
  }

  async function renombrar(event: FormEvent) {
    event.preventDefault()
    if (!renombrando || !nombre.trim()) return
    try {
      onCambiado(await notasApi.recursos.renombrar(credenciales, renombrando.id, nombre.trim()))
      setRenombrando(null)
    } catch (err) {
      fallo(err)
    }
  }

  async function borrar(recurso: Recurso) {
    try {
      await notasApi.recursos.borrar(credenciales, recurso.id)
      onBorrado(recurso.id)
    } catch (err) {
      fallo(err)
    }
  }

  async function descargar(recurso: Recurso) {
    try {
      const url = URL.createObjectURL(await notasApi.recursos.bajar(credenciales, recurso.id))
      const enlace = document.createElement("a")
      enlace.href = url
      enlace.download = recurso.nombre
      enlace.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      fallo(err)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="button"
        tabIndex={0}
        aria-label={`Subir recursos a ${curso.nombre}`}
        onClick={() => elegir.current?.click()}
        onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && elegir.current?.click()}
        onDragOver={(event) => {
          if (!traeArchivos(event)) return
          event.preventDefault()
          setEncima(true)
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={soltar}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
          encima && "border-primary bg-primary/5 text-foreground"
        )}
      >
        <Upload className="size-5" />
        <span>
          <span className="font-medium text-foreground">Suelta aquí PDFs u otros archivos</span> o haz clic para elegirlos
        </span>
        <span className="text-xs">Hasta 300 MB cada uno</span>
        <input
          ref={elegir}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const archivos = [...(event.target.files ?? [])]
            event.target.value = ""
            if (archivos.length) onSubir(archivos)
          }}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {subidas.length > 0 && (
        <ul aria-label="Subiendo" className="flex flex-col gap-2">
          {subidas.map((subida) => (
            <li key={subida.clave} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
              <IconoRecurso recurso={{ nombre: subida.nombre, tipo: "" }} className="size-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{subida.nombre}</p>
                {subida.error ? (
                  <p className="text-xs text-destructive">{subida.error}</p>
                ) : (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(subida.avance * 100)}%` }} />
                  </div>
                )}
              </div>
              {subida.error ? (
                <Button size="sm" variant="ghost" onClick={() => onDescartar(subida.clave)}>
                  Quitar
                </Button>
              ) : (
                <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{Math.round(subida.avance * 100)} %</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {recursos.length === 0 && subidas.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">Todavía no hay recursos en este curso.</p>
      ) : (
        <ul aria-label="Recursos" className="flex flex-col divide-y rounded-xl border">
          {recursos.map((recurso) => (
            <li key={recurso.id} className="group flex items-center gap-1 pr-1.5 hover:bg-muted/50">
              <button
                type="button"
                onClick={() => onAbrir(recurso)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <IconoRecurso recurso={recurso} className="size-5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{recurso.nombre}</span>
                  <span className="block text-xs text-muted-foreground">
                    {tamanoLegible(recurso.tamano)} · {haceCuanto(recurso.creado_en)}
                  </span>
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={`Más acciones de ${recurso.nombre}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => descargar(recurso)}>
                    <Download /> Descargar
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setNombre(recurso.nombre)
                      setRenombrando(recurso)
                    }}
                  >
                    <Pencil /> Renombrar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setBorrando(recurso)}>
                    <Trash2 /> Borrar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={renombrando !== null} onOpenChange={(abierto) => !abierto && setRenombrando(null)}>
        <DialogContent>
          <form onSubmit={renombrar} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Renombrar</DialogTitle>
            </DialogHeader>
            <Input aria-label="Nombre" value={nombre} onChange={(event) => setNombre(event.target.value)} maxLength={120} autoFocus />
            <DialogFooter>
              <Button type="submit" disabled={!nombre.trim()}>
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={borrando !== null} onOpenChange={(abierto) => !abierto && setBorrando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar «{borrando?.nombre}»?</AlertDialogTitle>
            <AlertDialogDescription>Se borra del curso y del servidor. No se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => borrando && borrar(borrando)}>
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
