import "@blocknote/shadcn/style.css"

import { createContext, useContext, useMemo } from "react"
import { BlockNoteSchema, createFileBlockConfig, defaultBlockSpecs, defaultInlineContentSpecs, fileParse } from "@blocknote/core"
import { es } from "@blocknote/core/locales"
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
  FileBlockWrapper,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react"
import { BlockNoteView } from "@blocknote/shadcn"
import { cn } from "cn"

import { ChipArchivo } from "@/components/archivos"
import { PerfilAvatar } from "@/components/perfil-avatar"
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

const diccionario = {
  ...es,
  placeholders: { ...es.placeholders, default: "Escribe una descripción: / para más bloques, @ para mencionar, o pega una imagen o un archivo" },
}

// Se carga aparte (React.lazy) para que el tablero no espere al editor.
export default function EditorDescripcion({
  inicial,
  oscuro,
  onCambio,
  subirArchivo,
  resolverUrl,
  abrirArchivo,
  perfiles,
  yo,
}: {
  inicial: (typeof schema.PartialBlock)[] | undefined
  oscuro: boolean
  onCambio: (documento: DocumentoDescripcion) => void
  subirArchivo: (archivo: File) => Promise<string>
  resolverUrl: (url: string) => Promise<string>
  abrirArchivo: (url: string, nombre: string) => void
  perfiles: Perfil[]
  yo: string | null
}) {
  const editor = useCreateBlockNote({
    schema,
    initialContent: inicial,
    dictionary: diccionario,
    uploadFile: subirArchivo,
    resolveFileUrl: resolverUrl,
  })

  const personas = useMemo(() => ({ porId: new Map(perfiles.map((perfil) => [perfil.id, perfil])), yo }), [perfiles, yo])

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
        <BlockNoteView editor={editor} theme={oscuro ? "dark" : "light"} onChange={() => onCambio(editor.document)}>
          <SuggestionMenuController triggerCharacter="@" getItems={sugerencias} />
        </BlockNoteView>
      </Personas.Provider>
    </AbrirArchivo.Provider>
  )
}
