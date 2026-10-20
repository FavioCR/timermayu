import "@blocknote/shadcn/style.css"

import { createContext, useContext } from "react"
import { BlockNoteSchema, createFileBlockConfig, defaultBlockSpecs, fileParse } from "@blocknote/core"
import { es } from "@blocknote/core/locales"
import { createReactBlockSpec, FileBlockWrapper, useCreateBlockNote } from "@blocknote/react"
import { BlockNoteView } from "@blocknote/shadcn"

import { ChipArchivo } from "@/components/archivos"
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

// Video y audio no se usan: un archivo de esos entra como bloque de archivo.
const { video: _video, audio: _audio, ...bloques } = defaultBlockSpecs
const schema = BlockNoteSchema.create({ blockSpecs: { ...bloques, file: bloqueArchivo() } })

export type DocumentoDescripcion = (typeof schema.Block)[]

const diccionario = {
  ...es,
  placeholders: { ...es.placeholders, default: "Escribe una descripción, usa / para más bloques o pega una imagen o un archivo" },
}

// Se carga aparte (React.lazy) para que el tablero no espere al editor.
export default function EditorDescripcion({
  inicial,
  oscuro,
  onCambio,
  subirArchivo,
  resolverUrl,
  abrirArchivo,
}: {
  inicial: (typeof schema.PartialBlock)[] | undefined
  oscuro: boolean
  onCambio: (documento: DocumentoDescripcion) => void
  subirArchivo: (archivo: File) => Promise<string>
  resolverUrl: (url: string) => Promise<string>
  abrirArchivo: (url: string, nombre: string) => void
}) {
  const editor = useCreateBlockNote({
    schema,
    initialContent: inicial,
    dictionary: diccionario,
    uploadFile: subirArchivo,
    resolveFileUrl: resolverUrl,
  })

  return (
    <AbrirArchivo.Provider value={abrirArchivo}>
      <BlockNoteView editor={editor} theme={oscuro ? "dark" : "light"} onChange={() => onCambio(editor.document)} />
    </AbrirArchivo.Provider>
  )
}
