import "@blocknote/shadcn/style.css"

import { createContext, useContext, useMemo, useRef, useState } from "react"
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
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react"
import { BlockNoteView } from "@blocknote/shadcn"
import { Sparkles } from "lucide-react"
import { cn } from "cn"

import { ChipArchivo } from "@/components/archivos"
import { PerfilAvatar } from "@/components/perfil-avatar"
import { RedactarIA } from "@/components/redactar-ia"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import type { Perfil } from "@/lib/api"
import { tipoPorNombre } from "@/lib/archivos"

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

const PISTA_DESCRIPCION =
  "Escribe una descripción: / para más bloques (/ia para escribir con IA), @ para mencionar, o pega una imagen o un archivo"

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
  // Sin IA (o sin quien pregunte) no sale «Escribir con IA» en el menú de /.
  redactar?: (texto: string) => Promise<string>
  // Lo que se lee en una línea vacía.
  pista?: string
}) {
  const editor = useCreateBlockNote({
    schema,
    initialContent: inicial,
    dictionary: { ...es, placeholders: { ...es.placeholders, default: pista } },
    uploadFile: subirArchivo,
    resolveFileUrl: resolverUrl,
  })

  const personas = useMemo(() => ({ porId: new Map(perfiles.map((perfil) => [perfil.id, perfil])), yo }), [perfiles, yo])

  // /ia: el campo de la IA sale debajo de la línea donde se escribió, y lo redactado va ahí.
  const [ia, setIa] = useState<{ bloqueId: string; previo: string } | null>(null)
  const bloqueIA = useRef<string | null>(null)
  const anclaIA = useRef({
    getBoundingClientRect: () =>
      editor.domElement?.querySelector(`[data-id="${bloqueIA.current}"] .bn-block-content`)?.getBoundingClientRect() ?? new DOMRect(),
  })

  function abrirIA() {
    const bloque = editor.getTextCursorPosition().block
    bloqueIA.current = bloque.id
    setIa({ bloqueId: bloque.id, previo: textoDeBloque(bloque) })
  }

  // En una línea vacía (o al mejorar lo que tenía) la reemplaza; si no, va debajo. Admite Markdown sencillo.
  function usarRedaccion(texto: string, reemplaza: boolean) {
    const nuevos = conMenciones(editor.tryParseMarkdownToBlocks(texto), perfiles)
    const bloque = ia ? editor.getBlock(ia.bloqueId) : undefined
    setIa(null)
    if (nuevos.length === 0) return
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
    return filterSuggestionItems([...conIA, ...getDefaultReactSlashMenuItems(editor)], consulta)
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
        <BlockNoteView editor={editor} theme={oscuro ? "dark" : "light"} slashMenu={false} onChange={() => onCambio(editor.document)}>
          <SuggestionMenuController triggerCharacter="/" getItems={itemsDeBarra} />
          {perfiles.length > 0 && <SuggestionMenuController triggerCharacter="@" getItems={sugerencias} />}
        </BlockNoteView>
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
            {ia && redactar && <RedactarIA previo={ia.previo} redactar={redactar} onUsar={usarRedaccion} />}
          </PopoverContent>
        </Popover>
      </Personas.Provider>
    </AbrirArchivo.Provider>
  )
}
