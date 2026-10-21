import "@blocknote/shadcn/style.css"

import { createContext, useContext, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import {
  BlockNoteSchema,
  createFileBlockConfig,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  fileParse,
  filterSuggestionItems,
} from "@blocknote/core"
import { es } from "@blocknote/core/locales"
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
  FileBlockWrapper,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  GridSuggestionMenuController,
  SuggestionMenuController,
  useComponentsContext,
  useCreateBlockNote,
  useEditorState,
  type DefaultReactSuggestionItem,
} from "@blocknote/react"
import { BlockNoteView } from "@blocknote/shadcn"
import { Clock, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { TextSelection, type Transaction } from "prosemirror-state"
import { cn } from "cn"

import { ChipArchivo, ICONOS } from "@/components/archivos"
import { PerfilAvatar } from "@/components/perfil-avatar"
import { RedactarIA } from "@/components/redactar-ia"
import { VisorImagenes, type ImagenDelVisor } from "@/components/visor-imagenes"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import type { OpcionesRedaccion, Perfil } from "@/lib/api"
import { claseDeArchivo, tipoPorNombre } from "@/lib/archivos"
import { medioDeMarca, tramoLegible, type Medio } from "@/lib/marcas-de-tiempo"
import { claveMarcas, marcasDeTiempo } from "@/lib/marcas-en-editor"
import { comoImagenSubible, imagenesDelPortapapeles, nombreDeImagen, prepararHtml } from "@/lib/pegar-con-imagenes"

// Tocar un archivo de la descripción lo abre con la contraseña (un enlace directo no la lleva).
const AbrirArchivo = createContext<(url: string, nombre: string) => void>(() => {})

function EnlaceArchivo({ url, nombre }: { url: string; nombre: string }) {
  const abrir = useContext(AbrirArchivo)
  return (
    <div contentEditable={false} draggable={false} className="py-0.5">
      <ChipArchivo archivo={{ nombre: nombre || "Archivo", tipo: tipoPorNombre(nombre) }} onAbrir={() => abrir(url, nombre)} />
    </div>
  )
}

// El bloque de archivo de BlockNote, pero con el chip de Archivos: el archivo se sube a los del pendiente y la línea lo enlaza.
const bloqueArchivo = createReactBlockSpec(createFileBlockConfig, {
  parse: fileParse(),
  render: (props) => (
    <FileBlockWrapper {...props}>
      <EnlaceArchivo url={props.block.props.url} nombre={props.block.props.name} />
    </FileBlockWrapper>
  ),
})

// Las @menciones guardan el id del perfil (el servidor avisa a quien se menciona) y su nombre por si el perfil ya no está.
const Personas = createContext<{ porId: Map<string, Perfil>; yo: string | null }>({ porId: new Map(), yo: null })

function PildoraMencion({ id, nombre }: { id: string; nombre: string }) {
  const { porId, yo } = useContext(Personas)
  const perfil = porId.get(id)
  return (
    <span
      className={cn(
        "rounded-full bg-primary/10 py-px pr-1.5 pl-0.5 font-semibold whitespace-nowrap text-primary",
        id === yo && "bg-primary/20 ring-1 ring-primary/40"
      )}
    >
      <PerfilAvatar perfil={perfil} size="xs" className="mr-1" />@{perfil?.nombre ?? nombre}
    </span>
  )
}

const mencion = createReactInlineContentSpec(
  { type: "mencion", propSchema: { id: { default: "" }, nombre: { default: "" } }, content: "none" },
  { render: (props) => <PildoraMencion id={props.inlineContent.props.id} nombre={props.inlineContent.props.nombre} /> }
)

// Video y audio no se usan: un archivo de esos entra como bloque de archivo.
const { video: _video, audio: _audio, ...bloques } = defaultBlockSpecs
const schema = BlockNoteSchema.create({
  blockSpecs: { ...bloques, file: bloqueArchivo() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, mencion },
})

const sinTildes = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

export type DocumentoDescripcion = (typeof schema.Block)[]
type Bloque = typeof schema.Block

// El texto de una línea, con sus @menciones.
function textoDeBloque(bloque: Bloque) {
  if (!Array.isArray(bloque.content)) return ""
  return bloque.content
    .map((item) => {
      if (item.type === "text") return item.text
      if (item.type === "link") return item.content.map((parte) => parte.text).join("")
      if (item.type === "mencion") return `@${item.props.nombre}`
      return ""
    })
    .join("")
}

// Al revés, para mandarle a la IA lo seleccionado: las menciones van como @Nombre.
function conArrobas(bloques: Bloque[]): Bloque[] {
  const visitar = (bloque: Bloque): Bloque =>
    ({
      ...bloque,
      content: Array.isArray(bloque.content)
        ? bloque.content.map((item) => (item.type === "mencion" ? { type: "text", text: `@${item.props.nombre}`, styles: {} } : item))
        : bloque.content,
      children: bloque.children.map(visitar),
    }) as Bloque
  return bloques.map(visitar)
}

// Las imágenes del documento, también las anidadas.
function imagenesDe(bloques: Bloque[]): { id: string; url: string; nombre: string }[] {
  return bloques.flatMap((bloque) => [
    ...(bloque.type === "image" ? [{ id: bloque.id, url: bloque.props.url, nombre: bloque.props.name }] : []),
    ...imagenesDe(bloque.children as Bloque[]),
  ])
}

// Una dirección que solo sirve en esta página (lo pegado mientras se sube).
const esTemporal = (url: string) => /^(blob|data):/i.test(url)

const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Las @Nombre que escribe la IA pasan a ser menciones de verdad (como elegirlas con @: avisan a esa persona).
function conMenciones(bloques: Bloque[], perfiles: Perfil[]): Bloque[] {
  if (perfiles.length === 0) return bloques
  const porNombre = new Map(perfiles.map((perfil) => [perfil.nombre.toLowerCase(), perfil]))
  const nombres = perfiles.map((perfil) => perfil.nombre).sort((a, b) => b.length - a.length)
  const patron = new RegExp(`@(${nombres.map(escapar).join("|")})(?![\\p{L}\\p{N}_])`, "giu")
  const enLinea = (contenido: Bloque["content"]) => {
    if (!Array.isArray(contenido)) return contenido
    return contenido.flatMap((item) => {
      if (item.type !== "text") return [item]
      const partes: unknown[] = []
      let desde = 0
      for (const encontrado of item.text.matchAll(patron)) {
        const perfil = porNombre.get(encontrado[1].toLowerCase())
        if (!perfil) continue
        if (encontrado.index > desde) partes.push({ ...item, text: item.text.slice(desde, encontrado.index) })
        partes.push({ type: "mencion", props: { id: perfil.id, nombre: perfil.nombre } })
        desde = encontrado.index + encontrado[0].length
      }
      if (partes.length === 0) return [item]
      if (desde < item.text.length) partes.push({ ...item, text: item.text.slice(desde) })
      return partes
    }) as Bloque["content"]
  }
  const visitar = (bloque: Bloque): Bloque => ({ ...bloque, content: enLinea(bloque.content), children: bloque.children.map(visitar) }) as Bloque
  return bloques.map(visitar)
}

// La barra que sale al seleccionar texto, con «Reescribir con IA» primero cuando hay IA.
const Reescribir = createContext<(() => void) | null>(null)

function BotonReescribir() {
  const reescribir = useContext(Reescribir)
  const Components = useComponentsContext()
  // En el celular la barra está siempre sobre el teclado: el botón sale solo con algo seleccionado.
  const vacia = useEditorState({ on: "selection", selector: ({ editor }) => editor?.prosemirrorState.selection.empty ?? true })
  if (!reescribir || !Components || vacia) return null
  return (
    <Components.FormattingToolbar.Button
      label="Reescribir con IA"
      mainTooltip="Reescribir con IA"
      secondaryTooltip="Mejorarlo, acortarlo, cambiar el tono…"
      icon={<Sparkles className="text-primary" />}
      onClick={reescribir}
    >
      Reescribir
    </Components.FormattingToolbar.Button>
  )
}

function BarraDeFormato() {
  return (
    <FormattingToolbar>
      <BotonReescribir key="reescribir" />
      {getFormattingToolbarItems()}
    </FormattingToolbar>
  )
}

const SIN_MEDIOS: Medio[] = []

const noDespuesDeUnNumero = (tr: Transaction) => !/\d$/.test(tr.doc.textBetween(Math.max(0, tr.selection.from - 1), tr.selection.from))

const PISTA_DESCRIPCION = "Escribe una descripción: / para más bloques (/ia para escribir con IA), @ para mencionar, o pega una imagen o un archivo"

// Se carga aparte (React.lazy) para que el tablero no espere al editor. También es el editor de las notas privadas,
// sin perfiles (sin @menciones) y con su propia pista.
export default function EditorDescripcion({
  inicial,
  oscuro,
  onCambio,
  subirArchivo,
  resolverUrl,
  abrirArchivo,
  perfiles = [],
  yo = null,
  redactar,
  pista = PISTA_DESCRIPCION,
  medios = SIN_MEDIOS,
  onReproducir,
  traerImagen,
}: {
  inicial: (typeof schema.PartialBlock)[] | undefined
  oscuro: boolean
  onCambio: (documento: DocumentoDescripcion) => void
  subirArchivo: (archivo: File) => Promise<string>
  resolverUrl: (url: string) => Promise<string>
  abrirArchivo: (url: string, nombre: string) => void
  // Sin perfiles no hay @menciones.
  perfiles?: Perfil[]
  yo?: string | null
  // Sin IA (o sin quien pregunte) no sale «Escribir con IA» en el menú de / ni «Reescribir con IA» al seleccionar.
  redactar?: (texto: string, opciones?: OpcionesRedaccion) => Promise<string>
  // Lo que se lee en una línea vacía.
  pista?: string
  // Los videos y audios del pendiente: las marcas de tiempo escritas en el texto ([00:51], [00:51–02:04]) se tocan para
  // verlos en ese momento. Sin ellos (o en las notas) las marcas son texto.
  medios?: Medio[]
  onReproducir?: (medio: Medio, desde: number, hasta: number | null) => void
  // Una imagen pegada (de otra página, de otra tarjeta o nota, o ya en la página), para subirla aquí.
  traerImagen: (url: string) => Promise<Blob>
}) {
  const [extensionMarcas] = useState(marcasDeTiempo)
  const alPegar = useRef<(event: ClipboardEvent, porDefecto: () => boolean | undefined) => boolean | undefined>(() => undefined)
  const editor = useCreateBlockNote({
    schema,
    initialContent: inicial,
    dictionary: { ...es, placeholders: { ...es.placeholders, default: pista } },
    uploadFile: subirArchivo,
    resolveFileUrl: resolverUrl,
    extensions: [extensionMarcas],
    pasteHandler: ({ event, defaultPasteHandler }) => alPegar.current(event, defaultPasteHandler),
  })

  // Pegar texto con imágenes las trae tal cual: con imágenes manda el HTML (aunque el texto plano parezca Markdown, que
  // no las lleva), y cada imagen pegada se sube aquí, así no depende de la página, tarjeta o nota de donde vino. Mientras
  // se sube, la que solo existe en esta página (subiendo: id del bloque → su dirección) no se guarda.
  const subiendo = useRef(new Map<string, string>())
  const ultimos = useRef({ subirArchivo, traerImagen })
  ultimos.current = { subirArchivo, traerImagen }
  alPegar.current = (event, porDefecto) => {
    const datos = event.clipboardData
    const html = datos?.getData("text/html") ?? ""
    const antes = new Set(imagenesDe(editor.document as Bloque[]).map((imagen) => imagen.id))
    const enCodigo = Boolean(editor.prosemirrorState.selection.$from.parent.type.spec.code)
    let hecho: boolean | undefined = true
    let perdidas = 0
    let locales = false
    if (datos && !enCodigo && !datos.types.includes("blocknote/html") && /<img[\s>]/i.test(html)) {
      const preparado = prepararHtml(html, imagenesDelPortapapeles(datos))
      perdidas = preparado.perdidas
      locales = preparado.locales
      editor.pasteHTML(preparado.html)
    } else {
      hecho = porDefecto()
    }
    const nuevas = imagenesDe(editor.document as Bloque[]).filter((imagen) => !antes.has(imagen.id) && imagen.url)
    void subirPegadas(nuevas, perdidas, locales)
    return hecho
  }

  async function subirPegadas(imagenes: { id: string; url: string; nombre: string }[], perdidasAlPegar: number, locales: boolean) {
    let perdidas = perdidasAlPegar
    for (const { id, url } of imagenes) subiendo.current.set(id, url)
    const urlDe = (id: string) => (editor.getBlock(id)?.props as { url?: string } | undefined)?.url
    await Promise.all(
      imagenes.map(async ({ id, url, nombre }) => {
        try {
          const archivo = await comoImagenSubible(await ultimos.current.traerImagen(url), nombreDeImagen(nombre, url))
          const nueva = await ultimos.current.subirArchivo(archivo)
          if (urlDe(id) === url) editor.updateBlock(id, { props: { url: nueva } })
        } catch {
          // Lo de otra página o del tablero queda como vino; lo que solo existe aquí no se puede guardar.
          if (esTemporal(url) && urlDe(id) === url) {
            editor.removeBlocks([id])
            perdidas++
          }
        } finally {
          subiendo.current.delete(id)
          if (url.startsWith("blob:")) URL.revokeObjectURL(url)
        }
      })
    )
    if (perdidas > 0) {
      toast.warning(perdidas === 1 ? "No se pudo pegar 1 imagen" : `No se pudieron pegar ${perdidas} imágenes`, {
        description: locales
          ? perdidas === 1
            ? "Es un archivo de tu computadora (como las capturas de un Markdown) y el navegador no puede leerlo por su ruta. Cópiala desde un documento que la lleve dentro (HTML, Google Docs, Word) o pégala sola."
            : "Son archivos de tu computadora (como las capturas de un Markdown) y el navegador no puede leerlos por su ruta. Cópialas desde un documento que las lleve dentro (HTML, Google Docs, Word) o pégalas una por una."
          : perdidas === 1
            ? "La app de donde viene no la deja copiar junto al texto. Cópiala sola y pégala aquí."
            : "La app de donde vienen no las deja copiar junto al texto. Cópialas una por una y pégalas aquí.",
        duration: 12000,
      })
    }
  }

  // Lo que se guarda: sin las imágenes pegadas que todavía tienen una dirección de esta página.
  function paraGuardar(bloques: Bloque[]): Bloque[] {
    if (subiendo.current.size === 0) return bloques
    return bloques
      .filter((bloque) => !(bloque.type === "image" && subiendo.current.has(bloque.id) && esTemporal(bloque.props.url)))
      .map((bloque) => ({ ...bloque, children: paraGuardar(bloque.children as Bloque[]) }) as Bloque)
  }

  // Los adjuntos llegan (o se van) con el editor ya abierto: las marcas se resaltan, o dejan de hacerlo, enseguida.
  const conMedios = medios.length > 0 && onReproducir !== undefined
  useEffect(() => {
    try {
      const vista = editor.prosemirrorView
      vista.dispatch(vista.state.tr.setMeta(claveMarcas, conMedios))
    } catch {
      // Todavía sin montar.
    }
  }, [editor, conMedios])

  // Tocar una marca abre su video en ese momento; si hay varios y la marca no dice cuál, se elige.
  const [eligiendo, setEligiendo] = useState<{ desde: number; hasta: number | null } | null>(null)
  const cajaMarca = useRef(new DOMRect())
  const anclaMarca = useRef({ getBoundingClientRect: () => cajaMarca.current })
  function abrirMarca(event: MouseEvent) {
    const marca = event.target instanceof Element ? event.target.closest<HTMLElement>(".marca-de-tiempo") : null
    // Al seleccionar arrastrando sobre la marca no se abre.
    if (!marca || !onReproducir || !editor.prosemirrorState.selection.empty) return false
    const desde = Number(marca.dataset.desde)
    const hasta = marca.dataset.hasta ? Number(marca.dataset.hasta) : null
    const medio = medioDeMarca(medios, marca.dataset.nombre ?? null)
    if (medio) {
      onReproducir(medio, desde, hasta)
    } else {
      cajaMarca.current = marca.getBoundingClientRect()
      setEligiendo({ desde, hasta })
    }
    return true
  }

  // «Marca de tiempo» en el menú de /: deja [00:00] (con el nombre del primero si hay varios) con el tiempo seleccionado
  // para escribirlo encima.
  function insertarMarca() {
    const texto = medios.length > 1 ? `[00:00 · ${medios[0].nombre}]` : "[00:00]"
    editor.insertInlineContent(texto)
    const vista = editor.prosemirrorView
    const inicio = vista.state.selection.from - texto.length + 1
    vista.dispatch(vista.state.tr.setSelection(TextSelection.create(vista.state.doc, inicio, inicio + 5)))
    editor.focus()
  }

  const personas = useMemo(() => ({ porId: new Map(perfiles.map((perfil) => [perfil.id, perfil])), yo }), [perfiles, yo])

  // Tocar una imagen la agranda, con las demás del documento en carrusel (en su orden).
  const [agrandada, setAgrandada] = useState<{ imagenes: ImagenDelVisor[]; inicial: number } | null>(null)
  function agrandarImagen(event: MouseEvent) {
    if (!(event.target instanceof HTMLImageElement)) return
    const id = event.target.closest("[data-content-type=image]")?.closest<HTMLElement>("[data-id]")?.dataset.id
    if (!id) return
    const imagenes: ImagenDelVisor[] = []
    const recorrer = (bloques: Bloque[]) => {
      for (const bloque of bloques) {
        if (bloque.type === "image" && bloque.props.url) {
          imagenes.push({ id: bloque.id, nombre: bloque.props.name || bloque.props.caption || "Imagen", url: bloque.props.url })
        }
        recorrer(bloque.children as Bloque[])
      }
    }
    recorrer(editor.document as Bloque[])
    const inicial = imagenes.findIndex((imagen) => imagen.id === id)
    if (inicial >= 0) setAgrandada({ imagenes, inicial })
  }

  // /ia: el campo de la IA sale debajo de la línea donde se escribió, y lo redactado va ahí. «Reescribir con IA» (al
  // seleccionar texto): sale debajo de lo seleccionado y lo reemplaza.
  // `enteras`: las líneas seleccionadas, si se seleccionaron completas (y sin líneas anidadas): esas se reemplazan enteras.
  const [ia, setIa] = useState<
    { bloqueId: string; previo: string } | { seleccion: true; previo: string; enteras: { id: string; type: string }[] | null } | null
  >(null)
  const bloqueIA = useRef<string | null>(null)
  const anclaIA = useRef({
    getBoundingClientRect: () => {
      if (bloqueIA.current) {
        return editor.domElement?.querySelector(`[data-id="${bloqueIA.current}"] .bn-block-content`)?.getBoundingClientRect() ?? new DOMRect()
      }
      const caja = editor.getSelectionBoundingBox()
      return caja ? DOMRect.fromRect(caja) : new DOMRect()
    },
  })

  function abrirIA() {
    const bloque = editor.getTextCursorPosition().block
    bloqueIA.current = bloque.id
    setIa({ bloqueId: bloque.id, previo: textoDeBloque(bloque) })
  }

  // Lo seleccionado viaja como Markdown, para que vuelva con la misma forma (negritas, listas).
  function abrirReescribir() {
    const { blocks } = editor.getSelectionCutBlocks()
    const previo = editor.blocksToMarkdownLossy(conArrobas(blocks as Bloque[])).trim()
    if (!previo) return
    // Completas: del principio de la primera línea al final de la última, y líneas del editor (no celdas de una tabla).
    const { $from, $to } = editor.prosemirrorState.selection
    const deLinea = (lado: typeof $from) => lado.depth > 0 && lado.node(lado.depth - 1).type.name === "blockContainer"
    const completas = deLinea($from) && deLinea($to) && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size
    const lineas = editor.getSelection()?.blocks ?? []
    const enteras = completas && lineas.length > 0 && lineas.every((linea) => linea.children.length === 0) ? lineas : null
    bloqueIA.current = null
    setIa({ seleccion: true, previo, enteras: enteras && enteras.map(({ id, type }) => ({ id, type })) })
  }

  // En una línea vacía (o al mejorar lo que tenía) la reemplaza; si no, va debajo. Admite Markdown sencillo.
  function usarRedaccion(texto: string, reemplaza: boolean) {
    const nuevos = conMenciones(editor.tryParseMarkdownToBlocks(texto), perfiles)
    const bloque = ia && "bloqueId" in ia ? editor.getBlock(ia.bloqueId) : undefined
    const seleccion = ia && "seleccion" in ia ? ia : null
    setIa(null)
    if (nuevos.length === 0) return
    if (seleccion) {
      editor.focus()
      const { enteras } = seleccion
      // Una línea completa que vuelve como una línea del mismo tipo se pega encima: conserva lo suyo (nivel del título,
      // color, si está marcada).
      const mismaLinea = enteras?.length === 1 && nuevos.length === 1 && nuevos[0].type === enteras[0].type
      if (enteras && !mismaLinea && enteras.every((linea) => editor.getBlock(linea.id))) {
        const final = editor
          .replaceBlocks(
            enteras.map((linea) => linea.id),
            nuevos
          )
          .insertedBlocks.at(-1)
        if (final) editor.setTextCursorPosition(final, "end")
        return
      }
      // Lo seleccionado sigue seleccionado (el editor no la pierde mientras se usa el panel): se pega encima, como al
      // pegar, así un trozo de una frase queda dentro de su frase.
      editor.pasteHTML(editor.blocksToFullHTML(nuevos), true)
      return
    }
    const ultimo = editor.document[editor.document.length - 1]
    const insertados = !bloque
      ? editor.insertBlocks(nuevos, ultimo, "after")
      : reemplaza || textoDeBloque(bloque).trim() === ""
        ? editor.replaceBlocks([bloque], nuevos).insertedBlocks
        : editor.insertBlocks(nuevos, bloque, "after")
    editor.focus()
    const final = insertados.at(-1)
    if (final) editor.setTextCursorPosition(final, "end")
  }

  async function itemsDeBarra(consulta: string) {
    const conIA: DefaultReactSuggestionItem[] = redactar
      ? [
          {
            title: "Escribir con IA",
            subtext: "Escribe a la rápida y la IA lo redacta",
            aliases: ["ia", "ai", "redactar", "mejorar", "resumir", "explicar"],
            group: "IA",
            icon: <Sparkles size={18} />,
            onItemClick: abrirIA,
          },
        ]
      : []
    const items = getDefaultReactSlashMenuItems(editor)
    if (conMedios) {
      // Junto a los demás de «Medios» (el menú agrupa los que van seguidos).
      const despues = items.findLastIndex((item) => item.group === "Medios") + 1 || items.length
      items.splice(despues, 0, {
        title: "Marca de tiempo",
        subtext: "Lleva a un momento de un video o audio adjunto",
        aliases: ["marca", "minuto", "tiempo", "momento", "video", "audio"],
        group: "Medios",
        icon: <Clock size={18} />,
        onItemClick: insertarMarca,
      })
    }
    return filterSuggestionItems([...conIA, ...items], consulta)
  }

  // Al escribir @ salen los perfiles (menos uno mismo); elegir uno deja su mención y un espacio.
  async function sugerencias(consulta: string): Promise<DefaultReactSuggestionItem[]> {
    const buscada = sinTildes(consulta)
    return perfiles
      .filter((perfil) => perfil.id !== yo && sinTildes(perfil.nombre).includes(buscada))
      .map((perfil) => ({
        title: perfil.nombre,
        icon: <PerfilAvatar perfil={perfil} size="sm" />,
        onItemClick: () => editor.insertInlineContent([{ type: "mencion", props: { id: perfil.id, nombre: perfil.nombre } }, " "]),
      }))
  }

  return (
    <AbrirArchivo.Provider value={abrirArchivo}>
      <Personas.Provider value={personas}>
        <Reescribir.Provider value={redactar ? abrirReescribir : null}>
          <BlockNoteView
            onClick={(event) => abrirMarca(event) || agrandarImagen(event)}
            editor={editor}
            theme={oscuro ? "dark" : "light"}
            slashMenu={false}
            emojiPicker={false}
            formattingToolbar={false}
            onChange={() => onCambio(paraGuardar(editor.document as Bloque[]))}
          >
            <SuggestionMenuController triggerCharacter="/" getItems={itemsDeBarra} />
            {/* Los emojis de «:», como siempre, salvo después de un número: 01:30 es un tiempo (o una hora), no un emoji. */}
            <GridSuggestionMenuController triggerCharacter=":" columns={10} minQueryLength={2} shouldOpen={noDespuesDeUnNumero} />
            {perfiles.length > 0 && <SuggestionMenuController triggerCharacter="@" getItems={sugerencias} />}
            <FormattingToolbarController formattingToolbar={BarraDeFormato} />
          </BlockNoteView>
        </Reescribir.Provider>
        <Popover open={ia !== null} onOpenChange={(abierto) => !abierto && setIa(null)}>
          <PopoverAnchor virtualRef={anclaIA} />
          <PopoverContent
            data-ia-descripcion
            side="bottom"
            align="start"
            className="w-[min(28rem,calc(100vw-2rem))] p-3"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              editor.focus()
            }}
          >
            {ia && redactar && <RedactarIA previo={ia.previo} seleccion={"seleccion" in ia} redactar={redactar} onUsar={usarRedaccion} />}
          </PopoverContent>
        </Popover>
        <Popover open={eligiendo !== null} onOpenChange={(abierto) => !abierto && setEligiendo(null)}>
          <PopoverAnchor virtualRef={anclaMarca} />
          <PopoverContent side="bottom" align="start" className="w-72 gap-1 p-2">
            <p className="m-0 px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
              ¿Cuál ver {eligiendo?.hasta === null ? "desde" : "en"} {eligiendo && tramoLegible(eligiendo.desde, eligiendo.hasta)}?
            </p>
            {medios.map((medio) => {
              const Icono = ICONOS[claseDeArchivo(medio.nombre, medio.tipo)]
              return (
                <button
                  key={medio.id}
                  type="button"
                  onClick={() => {
                    setEligiendo(null)
                    if (eligiendo) onReproducir?.(medio, eligiendo.desde, eligiendo.hasta)
                  }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
                >
                  <Icono /> <span className="truncate">{medio.nombre}</span>
                </button>
              )
            })}
          </PopoverContent>
        </Popover>
        <VisorImagenes
          imagenes={agrandada?.imagenes ?? []}
          cargar={resolverUrl}
          inicial={agrandada?.inicial ?? null}
          onCerrar={() => setAgrandada(null)}
        />
      </Personas.Provider>
    </AbrirArchivo.Provider>
  )
}
