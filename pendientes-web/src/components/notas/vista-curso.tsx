import { useState, type FormEvent, type ReactNode } from "react"
import { FileText, Paperclip, Plus } from "lucide-react"

import { RecursosCurso } from "@/components/notas/recursos-curso"
import type { useSubidas } from "@/hooks/use-subidas"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { haceCuanto } from "@/lib/actividad"
import { ICONOS_CURSO, type Curso, type Nota, type Recurso } from "@/lib/notas"

// La cuadrícula de íconos para un curso; también se puede pegar cualquier emoji.
export function ElegirIcono({ valor, onElegir }: { valor: string; onElegir: (icono: string) => void }) {
  const [otro, setOtro] = useState("")
  return (
    <div className="flex flex-col gap-2">
      <div role="listbox" aria-label="Íconos" className="grid grid-cols-6 gap-1">
        {ICONOS_CURSO.map((icono) => (
          <button
            key={icono}
            type="button"
            role="option"
            aria-selected={icono === valor}
            onClick={() => onElegir(icono)}
            className="flex size-9 items-center justify-center rounded-md text-xl outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-selected:bg-primary/10 aria-selected:ring-1 aria-selected:ring-primary/40"
          >
            {icono}
          </button>
        ))}
      </div>
      <Input
        aria-label="Otro ícono"
        placeholder="O pega un emoji"
        value={otro}
        maxLength={16}
        onChange={(event) => {
          setOtro(event.target.value)
          if (event.target.value.trim()) onElegir(event.target.value.trim())
        }}
        className="h-8"
      />
    </div>
  )
}

export function NuevoCurso({ abierto, onCerrar, onCrear }: { abierto: boolean; onCerrar: () => void; onCrear: (nombre: string, icono: string) => Promise<void> }) {
  const [nombre, setNombre] = useState("")
  const [icono, setIcono] = useState(ICONOS_CURSO[0])
  const [creando, setCreando] = useState(false)

  async function crear(event: FormEvent) {
    event.preventDefault()
    if (!nombre.trim() || creando) return
    setCreando(true)
    try {
      await onCrear(nombre.trim(), icono)
      setNombre("")
      setIcono(ICONOS_CURSO[0])
    } finally {
      setCreando(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(valor) => !valor && onCerrar()}>
      <DialogContent>
        <form onSubmit={crear} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Nuevo curso</DialogTitle>
            <DialogDescription>Agrupa tus notas y los recursos del curso (PDF, guías, presentaciones).</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-xl">
              {icono}
            </span>
            <Input
              aria-label="Nombre del curso"
              placeholder="Por ejemplo: Cálculo II"
              value={nombre}
              maxLength={80}
              onChange={(event) => setNombre(event.target.value)}
              autoFocus
            />
          </div>
          <ElegirIcono valor={icono} onElegir={setIcono} />
          <DialogFooter>
            <Button type="submit" disabled={!nombre.trim() || creando}>
              {creando ? "Creando…" : "Crear curso"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// La portada de un curso: su ícono y nombre (se editan ahí mismo), sus notas y sus recursos.
export function VistaCurso({
  credenciales,
  curso,
  notas,
  recursos,
  verRecursos,
  subidas,
  onVerRecursos,
  onCambiarCurso,
  onNuevaNota,
  onAbrirNota,
  onAbrirRecurso,
  onRecursoCambiado,
  onRecursoBorrado,
  onNoAutorizado,
  hrefDeNota,
}: {
  credenciales: string
  curso: Curso
  notas: Nota[]
  recursos: Recurso[]
  verRecursos: boolean
  subidas: ReturnType<typeof useSubidas>
  onVerRecursos: (ver: boolean) => void
  onCambiarCurso: (cambios: Partial<Pick<Curso, "nombre" | "icono">>) => void
  onNuevaNota: () => void
  onAbrirNota: (nota: Nota) => void
  onAbrirRecurso: (recurso: Recurso) => void
  onRecursoCambiado: (recurso: Recurso) => void
  onRecursoBorrado: (id: string) => void
  onNoAutorizado: () => void
  hrefDeNota: (nota: Nota) => string
}) {
  const [nombre, setNombre] = useState(curso.nombre)
  const [iconos, setIconos] = useState(false)

  function guardarNombre() {
    const limpio = nombre.trim()
    if (!limpio) return setNombre(curso.nombre)
    if (limpio !== curso.nombre) onCambiarCurso({ nombre: limpio })
  }

  const recientes = [...notas].sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en))

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-10 pb-24 md:pt-14">
      <header className="flex flex-col gap-3">
        <Popover open={iconos} onOpenChange={setIconos}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Cambiar el ícono del curso"
              className="flex size-16 items-center justify-center rounded-xl text-5xl outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {curso.icono}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2">
            <ElegirIcono
              valor={curso.icono}
              onElegir={(icono) => {
                onCambiarCurso({ icono })
                setIconos(false)
              }}
            />
          </PopoverContent>
        </Popover>
        <input
          aria-label="Nombre del curso"
          value={nombre}
          maxLength={80}
          onChange={(event) => setNombre(event.target.value)}
          onBlur={guardarNombre}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
            if (event.key === "Escape") {
              setNombre(curso.nombre)
              requestAnimationFrame(() => event.currentTarget?.blur())
            }
          }}
          className="w-full bg-transparent text-3xl font-bold tracking-tight outline-none md:text-4xl"
        />
        <p className="text-sm text-muted-foreground">
          {notas.length} {notas.length === 1 ? "nota" : "notas"} · {recursos.length} {recursos.length === 1 ? "recurso" : "recursos"}
        </p>
      </header>

      <Tabs value={verRecursos ? "recursos" : "notas"} onValueChange={(valor) => onVerRecursos(valor === "recursos")}>
        <div className="flex items-center gap-2">
          <TabsList>
            <TabsTrigger value="notas">
              <FileText /> Notas
            </TabsTrigger>
            <TabsTrigger value="recursos">
              <Paperclip /> Recursos
            </TabsTrigger>
          </TabsList>
          {!verRecursos && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={onNuevaNota}>
              <Plus /> Nueva nota
            </Button>
          )}
        </div>
        <TabsContent value="notas" className="mt-4">
          {recientes.length === 0 ? (
            <Vacio>
              Todavía no hay notas.{" "}
              <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={onNuevaNota}>
                Escribe la primera
              </button>
              .
            </Vacio>
          ) : (
            <ul aria-label="Notas del curso" className="flex flex-col divide-y rounded-xl border">
              {recientes.map((nota) => (
                <li key={nota.id}>
                  <a
                    href={hrefDeNota(nota)}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                      event.preventDefault()
                      onAbrirNota(nota)
                    }}
                    className="flex items-center gap-3 px-3 py-2.5 text-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{nota.titulo || "Sin título"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{haceCuanto(nota.actualizado_en)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="recursos" className="mt-4">
          <RecursosCurso
            credenciales={credenciales}
            curso={curso}
            recursos={recursos}
            subidas={subidas.subidas.filter((subida) => subida.curso_id === curso.id)}
            onSubir={(archivos) => subidas.subir(curso.id, archivos)}
            onDescartar={subidas.descartar}
            onAbrir={onAbrirRecurso}
            onCambiado={onRecursoCambiado}
            onBorrado={onRecursoBorrado}
            onNoAutorizado={onNoAutorizado}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
}
