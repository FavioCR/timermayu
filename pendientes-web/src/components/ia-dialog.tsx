import { useEffect, useState, type FormEvent } from "react"
import { Check, ChevronsUpDown, ExternalLink, KeyRound, LoaderCircle, Sparkles } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { api, esNoAutorizado, mensajeDeError, type AjustesIA, type CambiosIA, type ModeloIA, type ProveedorIA } from "@/lib/api"

// Dónde se saca la clave de cada proveedor.
const AYUDA: Record<ProveedorIA, { url: string; sitio: string; ejemplo: string; nota: string }> = {
  gemini: { url: "https://aistudio.google.com/apikey", sitio: "Google AI Studio", ejemplo: "AIza…", nota: "Tiene un nivel gratuito." },
  openai: { url: "https://platform.openai.com/api-keys", sitio: "la plataforma de OpenAI", ejemplo: "sk-…", nota: "Se paga por uso." },
  openrouter: {
    url: "https://openrouter.ai/settings/keys",
    sitio: "OpenRouter",
    ejemplo: "sk-or-…",
    nota: "Una sola clave para modelos de muchos proveedores, algunos gratis.",
  },
}

// Combobox de shadcn para el modelo: la lista viene del proveedor (con la clave guardada), y también se puede
// escribir cualquier nombre.
function ModeloCombobox({
  credenciales,
  proveedor,
  valor,
  porDefecto,
  puedeListar,
  onCambiar,
}: {
  credenciales: string
  proveedor: ProveedorIA
  valor: string
  porDefecto: string
  puedeListar: boolean
  onCambiar: (modelo: string) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  const [modelos, setModelos] = useState<ModeloIA[] | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!abierto || !puedeListar || modelos) return
    let vigente = true
    api.ia
      .modelos(credenciales, proveedor)
      .then((lista) => vigente && setModelos(lista))
      .catch((err) => vigente && setError(mensajeDeError(err)))
    return () => {
      vigente = false
    }
  }, [abierto, puedeListar, modelos, credenciales, proveedor])

  const escrito = busqueda.trim()
  const enLista = (modelos ?? []).some((modelo) => modelo.id === escrito)

  function elegir(modelo: string) {
    onCambiar(modelo)
    setAbierto(false)
    setBusqueda("")
  }

  return (
    <Popover open={abierto} onOpenChange={setAbierto} modal>
      <PopoverTrigger asChild>
        <Button id="ia-modelo" variant="outline" role="combobox" aria-expanded={abierto} className="w-full justify-between font-normal">
          <span className="truncate font-mono text-sm">{valor}</span>
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {valor === porDefecto && "recomendado"}
            <ChevronsUpDown className="size-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar o escribir un modelo…" value={busqueda} onValueChange={setBusqueda} />
          <CommandList>
            <CommandEmpty>
              {!puedeListar
                ? "Guarda la clave para ver la lista. Mientras, escribe el nombre del modelo."
                : error || (modelos ? "Ningún modelo con ese nombre." : "Cargando modelos…")}
            </CommandEmpty>
            {escrito && !enLista && (
              <CommandGroup>
                <CommandItem forceMount value={`usar ${escrito}`} onSelect={() => elegir(escrito)}>
                  Usar «<span className="font-mono">{escrito}</span>»
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {!modelos?.some((modelo) => modelo.id === porDefecto) && (
                <CommandItem value={porDefecto} onSelect={() => elegir(porDefecto)}>
                  <Check className={cn("size-4", valor === porDefecto ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono">{porDefecto}</span>
                  <span className="ml-auto text-xs text-muted-foreground">recomendado</span>
                </CommandItem>
              )}
              {(modelos ?? []).map((modelo) => (
                <CommandItem key={modelo.id} value={modelo.id} keywords={[modelo.nombre]} onSelect={() => elegir(modelo.id)}>
                  <Check className={cn("size-4", valor === modelo.id ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono">{modelo.id}</span>
                    {modelo.nombre !== modelo.id && <span className="text-muted-foreground"> · {modelo.nombre}</span>}
                  </span>
                  {modelo.id === porDefecto && <span className="text-xs text-muted-foreground">recomendado</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Formulario({
  credenciales,
  ajustes,
  onCancelar,
  onGuardado,
  onSalir,
}: {
  credenciales: string
  ajustes: AjustesIA
  onCancelar: () => void
  onGuardado: (ajustes: AjustesIA) => void
  onSalir: () => void
}) {
  const [proveedor, setProveedor] = useState<ProveedorIA>(ajustes.proveedor ?? "gemini")
  const [modelos, setModelos] = useState(() => Object.fromEntries(ajustes.proveedores.map((p) => [p.id, p.modelo])) as Record<ProveedorIA, string>)
  // Solo se mandan las claves que se escriben aquí; las guardadas nunca llegan al navegador.
  const [claves, setClaves] = useState<Partial<Record<ProveedorIA, string>>>({})
  const [quitar, setQuitar] = useState<Partial<Record<ProveedorIA, boolean>>>({})
  const [instrucciones, setInstrucciones] = useState(ajustes.instrucciones ?? "")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState("")

  const datos = ajustes.proveedores.find((p) => p.id === proveedor)!
  const ayuda = AYUDA[proveedor]
  const conClave = (id: ProveedorIA) => Boolean(claves[id]?.trim()) || (ajustes.proveedores.find((p) => p.id === id)!.tiene_clave && !quitar[id])

  async function guardar(event: FormEvent) {
    event.preventDefault()
    const cambios: CambiosIA = { proveedor, instrucciones: instrucciones.trim() || null, modelos: {}, claves: {} }
    for (const p of ajustes.proveedores) {
      if (modelos[p.id] !== p.modelo) cambios.modelos![p.id] = modelos[p.id] === p.modelo_por_defecto ? null : modelos[p.id]
      const nueva = claves[p.id]?.trim()
      if (nueva) cambios.claves![p.id] = nueva
      else if (quitar[p.id]) cambios.claves![p.id] = null
    }
    setGuardando(true)
    try {
      onGuardado(await api.ia.guardar(credenciales, cambios))
    } catch (err) {
      if (esNoAutorizado(err)) onSalir()
      setError(mensajeDeError(err))
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-col gap-6">
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">Proveedor</FieldLegend>
          <div role="radiogroup" aria-label="Proveedor" className="grid gap-2 sm:grid-cols-3">
            {ajustes.proveedores.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={proveedor === p.id}
                onClick={() => setProveedor(p.id)}
                className={cn(
                  "flex flex-col items-start gap-1 border bg-card px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
                  proveedor === p.id && "border-primary bg-primary/15 ring-3 ring-primary/25 hover:bg-primary/20"
                )}
              >
                <span className="font-medium">{p.nombre}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <KeyRound className="size-3" />
                  {conClave(p.id) ? (claves[p.id]?.trim() ? "Clave nueva" : `Clave ••••${p.clave_final}`) : "Sin clave"}
                </span>
              </button>
            ))}
          </div>
        </FieldSet>

        <Field>
          <FieldLabel htmlFor="ia-clave">Clave de {datos.nombre}</FieldLabel>
          <Input
            id="ia-clave"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={datos.tiene_clave && !quitar[proveedor] ? `Guardada, termina en ${datos.clave_final}. Escribe otra para cambiarla.` : ayuda.ejemplo}
            value={claves[proveedor] ?? ""}
            onChange={(event) => setClaves((actuales) => ({ ...actuales, [proveedor]: event.target.value }))}
            maxLength={500}
          />
          <FieldDescription className="flex flex-wrap items-center gap-x-1">
            Créala en{" "}
            <a href={ayuda.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5">
              {ayuda.sitio} <ExternalLink className="size-3" />
            </a>
            . {ayuda.nota}
            {datos.tiene_clave && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-destructive"
                onClick={() => setQuitar((actuales) => ({ ...actuales, [proveedor]: !actuales[proveedor] }))}
              >
                {quitar[proveedor] ? "No quitar la clave" : "Quitar la clave guardada"}
              </Button>
            )}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="ia-modelo">Modelo</FieldLabel>
          <ModeloCombobox
            key={proveedor}
            credenciales={credenciales}
            proveedor={proveedor}
            valor={modelos[proveedor]}
            porDefecto={datos.modelo_por_defecto}
            // OpenRouter lista sus modelos sin clave; los demás, con la clave ya guardada.
            puedeListar={proveedor === "openrouter" || (datos.tiene_clave && !quitar[proveedor])}
            onCambiar={(modelo) => setModelos((actuales) => ({ ...actuales, [proveedor]: modelo }))}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="ia-instrucciones">
            Indicaciones para la IA <span className="font-normal text-muted-foreground">(opcional)</span>
          </FieldLabel>
          <Textarea
            id="ia-instrucciones"
            rows={3}
            maxLength={2000}
            placeholder="Ej.: títulos cortos en infinitivo; si dice «urgente», ponle la etiqueta Urgente."
            value={instrucciones}
            onChange={(event) => setInstrucciones(event.target.value)}
          />
          <FieldDescription>Valen para todos los proveedores.</FieldDescription>
        </Field>
      </FieldGroup>

      <p className="m-0 border-l-2 border-primary/50 pl-3 text-xs text-muted-foreground">
        El texto que pegues, con los nombres de las personas, proyectos y etiquetas, se envía a {datos.nombre} para proponer los
        pendientes. Las claves quedan en el servidor del tablero y nunca se vuelven a mostrar.
      </p>

      {error && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={guardando || !modelos[proveedor]?.trim()}>
          {guardando ? <LoaderCircle className="animate-spin" /> : <Sparkles />} {guardando ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  )
}

// Qué IA usa "Crear con IA": Gemini, OpenAI u OpenRouter, con su clave y su modelo. Es del equipo: vale para todos.
export function IaDialog({
  abierto,
  onAbiertoChange,
  credenciales,
  onGuardado,
  onSalir,
}: {
  abierto: boolean
  onAbiertoChange: (abierto: boolean) => void
  credenciales: string
  onGuardado: (ajustes: AjustesIA) => void
  onSalir: () => void
}) {
  const [ajustes, setAjustes] = useState<AjustesIA | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    api.ia
      .leer(credenciales)
      .then((leidos) => {
        if (!vigente) return
        setAjustes(leidos)
        setError("")
      })
      .catch((err) => {
        if (!vigente) return
        if (esNoAutorizado(err)) onSalir()
        setError(mensajeDeError(err))
      })
    return () => {
      vigente = false
    }
  }, [abierto, credenciales, onSalir])

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" /> Inteligencia artificial
          </DialogTitle>
          <DialogDescription>La que usa «Crear con IA» para proponer pendientes a partir de un texto. Vale para todo el equipo.</DialogDescription>
        </DialogHeader>
        {ajustes ? (
          <Formulario
            // Se arma de nuevo cada vez que se abre, con lo guardado.
            key={`${abierto}`}
            credenciales={credenciales}
            ajustes={ajustes}
            onCancelar={() => onAbiertoChange(false)}
            onGuardado={(guardados) => {
              setAjustes(guardados)
              onGuardado(guardados)
              onAbiertoChange(false)
            }}
            onSalir={onSalir}
          />
        ) : (
          <p className={cn("m-0 text-sm", error ? "text-destructive" : "text-muted-foreground")}>{error || "Cargando…"}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
