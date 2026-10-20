import { useEffect, useState, type FormEvent } from "react"
import { Check, ChevronsUpDown, CircleAlert, CircleCheck, ExternalLink, KeyRound, LoaderCircle, Sparkles } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from "@/components/ui/field"
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
// Con `activo` en false no se busca nada (la sección que la usa está cerrada).
function useModelos(credenciales: string, proveedor: ProveedorIA, escrita: string, hayGuardada: boolean, activo = true): ListaModelos {
  const nueva = escrita.trim()
  const [quieta, setQuieta] = useState(nueva)
  useEffect(() => {
    const espera = window.setTimeout(() => setQuieta(nueva), 600)
    return () => window.clearTimeout(espera)
  }, [nueva])

  // Qué se pide: proveedor y clave nueva (vacía = la guardada). null = nada que pedir todavía.
  const pedido = !activo
    ? null
    : nueva
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

// Si el modelo elegido no está entre los que da la clave y el recomendado sí, queda el recomendado.
function modeloValido(lista: ListaModelos, elegido: string, porDefecto: string) {
  const disponibles = lista.estado === "lista" ? lista.modelos : []
  return disponibles.length && !disponibles.some((m) => m.id === elegido) && disponibles.some((m) => m.id === porDefecto) ? porDefecto : elegido
}

type DatosProveedor = AjustesIA["proveedores"][number]

// Gemini, OpenAI u OpenRouter, con el estado de su clave.
function ElegirProveedor({
  nombre,
  proveedores,
  valor,
  onCambiar,
  estadoClave,
}: {
  nombre: string
  proveedores: DatosProveedor[]
  valor: ProveedorIA
  onCambiar: (proveedor: ProveedorIA) => void
  estadoClave: (proveedor: DatosProveedor) => string
}) {
  return (
    <div role="radiogroup" aria-label={nombre} className="grid gap-2 sm:grid-cols-3">
      {proveedores.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={valor === p.id}
          onClick={() => onCambiar(p.id)}
          className={cn(
            "flex flex-col items-start gap-1 border bg-card px-3 py-2.5 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
            valor === p.id && "border-primary bg-primary/15 ring-3 ring-primary/25 hover:bg-primary/20"
          )}
        >
          <span className="font-medium">{p.nombre}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <KeyRound className="size-3" />
            {estadoClave(p)}
          </span>
        </button>
      ))}
    </div>
  )
}

// La clave de un proveedor. La guardada se ve como puntitos; al entrar al campo quedan seleccionados y lo que se pegue
// la reemplaza.
function CampoClave({
  id,
  datos,
  escrita,
  quitada,
  onEscribir,
  onQuitar,
}: {
  id: string
  datos: DatosProveedor
  escrita: string | undefined
  quitada: boolean
  onEscribir: (valor: string | undefined) => void
  onQuitar: () => void
}) {
  const ayuda = AYUDA[datos.id]
  const enPuntitos = datos.tiene_clave && !quitada && escrita === undefined
  return (
    <Field>
      <FieldLabel htmlFor={id}>Clave de {datos.nombre}</FieldLabel>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={ayuda.ejemplo}
        value={enPuntitos ? GUARDADA : (escrita ?? "")}
        onFocus={(event) => enPuntitos && event.currentTarget.select()}
        onChange={(event) => onEscribir(event.target.value.replaceAll("•", ""))}
        onBlur={() => !escrita?.trim() && onEscribir(undefined)}
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
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-destructive" onClick={onQuitar}>
            {quitada ? "No quitar la clave" : "Quitar la clave guardada"}
          </Button>
        )}
      </FieldDescription>
    </Field>
  )
}

// Combobox de shadcn para el modelo: la lista viene del proveedor, y también se puede escribir cualquier nombre.
function ModeloCombobox({
  id,
  lista,
  valor,
  porDefecto,
  onCambiar,
}: {
  id: string
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
        <Button id={id} variant="outline" role="combobox" aria-expanded={abierto} className="w-full justify-between font-normal">
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
  // "Escribir con IA" (/ia) puede usar otra IA, por ejemplo un modelo más rápido. Empieza con lo guardado o, si no hay,
  // con el modelo de cada proveedor.
  const [otraRedaccion, setOtraRedaccion] = useState(ajustes.redaccion !== null)
  const [proveedorRedaccion, setProveedorRedaccion] = useState<ProveedorIA>(ajustes.redaccion?.proveedor ?? ajustes.proveedor ?? "gemini")
  const [modelosRedaccion, setModelosRedaccion] = useState(
    () =>
      Object.fromEntries(
        ajustes.proveedores.map((p) => [p.id, ajustes.redaccion?.proveedor === p.id ? ajustes.redaccion.modelo : p.modelo])
      ) as Record<ProveedorIA, string>
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState("")

  const datosDe = (id: ProveedorIA) => ajustes.proveedores.find((p) => p.id === id)!
  const datos = datosDe(proveedor)
  const conClave = (id: ProveedorIA) => Boolean(claves[id]?.trim()) || (datosDe(id).tiene_clave && !quitar[id])
  const estadoClave = (p: DatosProveedor) => (conClave(p.id) ? (claves[p.id]?.trim() ? "Clave nueva" : `Clave ••••${p.clave_final}`) : "Sin clave")
  const lista = useModelos(credenciales, proveedor, claves[proveedor] ?? "", datos.tiene_clave && !quitar[proveedor])
  const modelo = modeloValido(lista, modelos[proveedor], datos.modelo_por_defecto)

  // Con el mismo proveedor de arriba, la lista de modelos es la misma.
  const datosRedaccion = datosDe(proveedorRedaccion)
  const mismoProveedor = proveedorRedaccion === proveedor
  const listaAparte = useModelos(
    credenciales,
    proveedorRedaccion,
    claves[proveedorRedaccion] ?? "",
    datosRedaccion.tiene_clave && !quitar[proveedorRedaccion],
    otraRedaccion && !mismoProveedor
  )
  const listaRedaccion = mismoProveedor ? lista : listaAparte
  const modeloRedaccion = modeloValido(listaRedaccion, modelosRedaccion[proveedorRedaccion], datosRedaccion.modelo_por_defecto)
  const redactaCon = otraRedaccion ? datosRedaccion : datos

  function escribirClave(id: ProveedorIA, valor: string | undefined) {
    setClaves((actuales) => {
      const nuevas = { ...actuales }
      if (valor === undefined) delete nuevas[id]
      else nuevas[id] = valor
      return nuevas
    })
  }

  const alternarQuitar = (id: ProveedorIA) => setQuitar((actuales) => ({ ...actuales, [id]: !actuales[id] }))

  async function guardar(event: FormEvent) {
    event.preventDefault()
    const cambios: CambiosIA = {
      proveedor,
      instrucciones: instrucciones.trim() || null,
      tipo_automatico: tipoAutomatico,
      redaccion: otraRedaccion ? { proveedor: proveedorRedaccion, modelo: modeloRedaccion.trim() } : null,
      modelos: {},
      claves: {},
    }
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
          <ElegirProveedor nombre="Proveedor" proveedores={ajustes.proveedores} valor={proveedor} onCambiar={setProveedor} estadoClave={estadoClave} />
        </FieldSet>

        <CampoClave
          id="ia-clave"
          datos={datos}
          escrita={claves[proveedor]}
          quitada={Boolean(quitar[proveedor])}
          onEscribir={(valor) => escribirClave(proveedor, valor)}
          onQuitar={() => alternarQuitar(proveedor)}
        />

        <Field>
          <FieldLabel htmlFor="ia-modelo">Modelo</FieldLabel>
          <ModeloCombobox
            key={proveedor}
            id="ia-modelo"
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
          <FieldDescription>Valen para todos los proveedores al crear pendientes.</FieldDescription>
        </Field>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend variant="label">Escribir con IA (/ia en el chat y la descripción)</FieldLegend>
          <Field orientation="horizontal">
            <Switch id="ia-otra-redaccion" checked={otraRedaccion} onCheckedChange={setOtraRedaccion} />
            <FieldContent>
              <FieldLabel htmlFor="ia-otra-redaccion">Usar otra IA para redactar</FieldLabel>
              <FieldDescription>
                {otraRedaccion
                  ? "Conviene un modelo rápido: si tarda más de 11 segundos, se corta."
                  : `Ahora usa la de arriba (${datos.nombre}, ${modelo}).`}
              </FieldDescription>
            </FieldContent>
          </Field>
          {otraRedaccion && (
            <>
              <ElegirProveedor
                nombre="Proveedor para redactar"
                proveedores={ajustes.proveedores}
                valor={proveedorRedaccion}
                onCambiar={setProveedorRedaccion}
                estadoClave={estadoClave}
              />
              {/* La clave es la misma del proveedor: aquí solo se pide si es otro que el de arriba. */}
              {!mismoProveedor && (
                <CampoClave
                  id="ia-clave-redaccion"
                  datos={datosRedaccion}
                  escrita={claves[proveedorRedaccion]}
                  quitada={Boolean(quitar[proveedorRedaccion])}
                  onEscribir={(valor) => escribirClave(proveedorRedaccion, valor)}
                  onQuitar={() => alternarQuitar(proveedorRedaccion)}
                />
              )}
              <Field>
                <FieldLabel htmlFor="ia-modelo-redaccion">Modelo para redactar</FieldLabel>
                <ModeloCombobox
                  key={proveedorRedaccion}
                  id="ia-modelo-redaccion"
                  lista={listaRedaccion}
                  valor={modeloRedaccion}
                  porDefecto={datosRedaccion.modelo_por_defecto}
                  onCambiar={(modelo) => setModelosRedaccion((actuales) => ({ ...actuales, [proveedorRedaccion]: modelo }))}
                />
                <FieldDescription>
                  <EstadoModelos lista={listaRedaccion} nombre={datosRedaccion.nombre} />
                </FieldDescription>
              </Field>
            </>
          )}
        </FieldSet>
      </FieldGroup>

      <p className="m-0 border-l-2 border-primary/50 pl-3 text-xs text-muted-foreground">
        El texto y las imágenes que pegues, con los nombres de las personas, proyectos y etiquetas, se envían a {datos.nombre} para proponer los
        pendientes{tipoAutomatico ? "; para elegir el tipo, el título y el proyecto de lo que se cree sin tipo" : ""}. Lo que escribas con /ia, con el
        título, la descripción y los últimos mensajes del pendiente, va a {redactaCon.nombre}. Las claves quedan en el servidor del tablero y nunca
        se vuelven a mostrar.
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
        <Button type="submit" disabled={guardando || !modelo?.trim() || (otraRedaccion && !modeloRedaccion?.trim())}>
          {guardando ? <LoaderCircle className="animate-spin" /> : <Sparkles />} {guardando ? "Guardando…" : "Guardar"}
        </Button>
      </DialogFooter>
    </form>
  )
}

// Qué IA usa "Crear con IA" (y, si no se elige otra, "Escribir con IA"): Gemini, OpenAI u OpenRouter, con su clave y su
// modelo. Es del equipo: vale para todos.
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
            La que usa «Crear con IA» para proponer pendientes a partir de un texto, la que le pone tipo a lo nuevo y la que redacta con /ia. Vale
            para todo el equipo.
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
