import { useEffect, useState, type FormEvent } from "react"
import { Check, ChevronsUpDown, CircleAlert, CircleCheck, ExternalLink, KeyRound, LoaderCircle, Sparkles } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { api, ApiError, esNoAutorizado, mensajeDeError, type AjustesIA, type CambiosIA, type ModeloIA, type ProveedorIA } from "@/lib/api"

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

// Lo que se muestra en el campo de una clave guardada: puntitos. Nunca se envía.
const GUARDADA = "•".repeat(24)
// Una clave más corta todavía se está escribiendo.
const MIN_CLAVE = 12

type ListaModelos =
  | { estado: "sin-clave" }
  | { estado: "escribiendo" }
  | { estado: "cargando" }
  | { estado: "lista"; modelos: ModeloIA[]; conClaveNueva: boolean }
  | { estado: "error"; error: string; conClaveNueva: boolean }

// Los modelos disponibles se buscan solos: con la clave guardada al elegir el proveedor, o con la que se pega o escribe
// apenas se deja de escribir (así también se sabe si la clave sirve). OpenRouter los lista sin clave.
function useModelos(credenciales: string, proveedor: ProveedorIA, escrita: string, hayGuardada: boolean): ListaModelos {
  const nueva = escrita.trim()
  const [quieta, setQuieta] = useState(nueva)
  useEffect(() => {
    const espera = window.setTimeout(() => setQuieta(nueva), 600)
    return () => window.clearTimeout(espera)
  }, [nueva])

  // Qué se pide: proveedor y clave nueva (vacía = la guardada). null = nada que pedir todavía.
  const pedido = nueva
    ? nueva === quieta && nueva.length >= MIN_CLAVE
      ? `${proveedor}|${nueva}`
      : null
    : hayGuardada || proveedor === "openrouter"
      ? `${proveedor}|`
      : null
  const [resultado, setResultado] = useState<{ pedido: string; modelos?: ModeloIA[]; error?: string } | null>(null)

  useEffect(() => {
    if (!pedido) return
    let vigente = true
    const clave = pedido.slice(pedido.indexOf("|") + 1) || undefined
    api.ia
      .modelos(credenciales, proveedor, clave)
      .then((modelos) => vigente && setResultado({ pedido, modelos }))
      .catch(
        (err) =>
          vigente &&
          setResultado({
            pedido,
            // Aquí mismo se está configurando: el mensaje de siempre ("revísala en la configuración") no ayuda.
            error: err instanceof ApiError && err.code === "ia_clave_invalida" ? "Esta clave no sirve: el proveedor la rechazó." : mensajeDeError(err),
          })
      )
    return () => {
      vigente = false
    }
  }, [pedido, credenciales, proveedor])

  if (!pedido) return { estado: nueva ? "escribiendo" : "sin-clave" }
  if (resultado?.pedido !== pedido) return { estado: "cargando" }
  const conClaveNueva = Boolean(nueva)
  return resultado.error !== undefined
    ? { estado: "error", error: resultado.error, conClaveNueva }
    : { estado: "lista", modelos: resultado.modelos ?? [], conClaveNueva }
}

// Debajo del modelo: si se están buscando, cuántos hay o por qué no se pudo.
function EstadoModelos({ lista, nombre }: { lista: ListaModelos; nombre: string }) {
  if (lista.estado === "sin-clave") return <>Pega la clave y se buscan solos los modelos disponibles. También puedes escribir el nombre.</>
  if (lista.estado === "escribiendo") return <>Termina de pegar la clave para buscar los modelos.</>
  if (lista.estado === "cargando") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <LoaderCircle className="size-3.5 animate-spin" /> Buscando los modelos de {nombre}…
      </span>
    )
  }
  if (lista.estado === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive">
        <CircleAlert className="size-3.5 shrink-0" /> {lista.error}
      </span>
    )
  }
  const cuantos = `${lista.modelos.length} ${lista.modelos.length === 1 ? "modelo disponible" : "modelos disponibles"}`
  return (
    <span className="inline-flex items-center gap-1.5">
      <CircleCheck className="size-3.5 shrink-0 text-emerald-500" /> {lista.conClaveNueva ? `La clave funciona: ${cuantos}.` : `${cuantos}.`}
    </span>
  )
}

// Combobox de shadcn para el modelo: la lista viene del proveedor, y también se puede escribir cualquier nombre.
function ModeloCombobox({
  lista,
  valor,
  porDefecto,
  onCambiar,
}: {
  lista: ListaModelos
  valor: string
  porDefecto: string
  onCambiar: (modelo: string) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  const modelos = lista.estado === "lista" ? lista.modelos : null

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
              {lista.estado === "lista"
                ? "Ningún modelo con ese nombre."
                : lista.estado === "error"
                  ? lista.error
                  : lista.estado === "cargando"
                    ? "Buscando modelos…"
                    : "Pega la clave para ver la lista. Mientras, escribe el nombre del modelo."}
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
  const [tipoAutomatico, setTipoAutomatico] = useState(ajustes.tipo_automatico)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState("")

  const datos = ajustes.proveedores.find((p) => p.id === proveedor)!
  const ayuda = AYUDA[proveedor]
  const conClave = (id: ProveedorIA) => Boolean(claves[id]?.trim()) || (ajustes.proveedores.find((p) => p.id === id)!.tiene_clave && !quitar[id])
  const hayGuardada = datos.tiene_clave && !quitar[proveedor]
  // Con una clave guardada y sin tocar, el campo muestra puntitos.
  const enPuntitos = hayGuardada && claves[proveedor] === undefined
  const lista = useModelos(credenciales, proveedor, claves[proveedor] ?? "", hayGuardada)

  // Si el modelo elegido no está entre los que da la clave y el recomendado sí, queda el recomendado.
  const disponibles = lista.estado === "lista" ? lista.modelos : []
  const modelo =
    disponibles.length && !disponibles.some((m) => m.id === modelos[proveedor]) && disponibles.some((m) => m.id === datos.modelo_por_defecto)
      ? datos.modelo_por_defecto
      : modelos[proveedor]

  function escribirClave(valor: string | undefined) {
    setClaves((actuales) => {
      const nuevas = { ...actuales }
      if (valor === undefined) delete nuevas[proveedor]
      else nuevas[proveedor] = valor
      return nuevas
    })
  }

  async function guardar(event: FormEvent) {
    event.preventDefault()
    const cambios: CambiosIA = { proveedor, instrucciones: instrucciones.trim() || null, tipo_automatico: tipoAutomatico, modelos: {}, claves: {} }
    const elegidos = { ...modelos, [proveedor]: modelo }
    for (const p of ajustes.proveedores) {
      if (elegidos[p.id] !== p.modelo) cambios.modelos![p.id] = elegidos[p.id] === p.modelo_por_defecto ? null : elegidos[p.id]
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
            placeholder={ayuda.ejemplo}
            // La guardada se ve como puntitos; al entrar al campo quedan seleccionados y lo que se pegue la reemplaza.
            value={enPuntitos ? GUARDADA : (claves[proveedor] ?? "")}
            onFocus={(event) => enPuntitos && event.currentTarget.select()}
            onChange={(event) => escribirClave(event.target.value.replaceAll("•", ""))}
            onBlur={() => !claves[proveedor]?.trim() && escribirClave(undefined)}
            maxLength={500}
          />
          <FieldDescription className="flex flex-wrap items-center gap-x-1">
            {enPuntitos && <>Guardada, termina en {datos.clave_final}; pega otra para cambiarla. </>}
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
            lista={lista}
            valor={modelo}
            porDefecto={datos.modelo_por_defecto}
            onCambiar={(modelo) => setModelos((actuales) => ({ ...actuales, [proveedor]: modelo }))}
          />
          <FieldDescription>
            <EstadoModelos lista={lista} nombre={datos.nombre} />
          </FieldDescription>
        </Field>

        <Field orientation="horizontal">
          <Switch id="ia-tipo" checked={tipoAutomatico} onCheckedChange={setTipoAutomatico} />
          <FieldContent>
            <FieldLabel htmlFor="ia-tipo">Ponerle tipo a lo que se cree sin tipo</FieldLabel>
            <FieldDescription>Al agregar un pendiente sin «fix:», «feat:»…, la IA elige si es feat, fix, docs, etc.</FieldDescription>
          </FieldContent>
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
        pendientes{tipoAutomatico ? "; para elegir el tipo, el título y el proyecto de lo que se cree sin tipo" : ""}. Las claves quedan en el
        servidor del tablero y nunca se vuelven a mostrar.
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
        <Button type="submit" disabled={guardando || !modelo?.trim()}>
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
          <DialogDescription>
            La que usa «Crear con IA» para proponer pendientes a partir de un texto y la que le pone tipo a lo nuevo. Vale para todo el equipo.
          </DialogDescription>
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
