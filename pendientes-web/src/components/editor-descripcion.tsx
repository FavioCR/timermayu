import "@blocknote/shadcn/style.css"

import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core"
import { es } from "@blocknote/core/locales"
import { useCreateBlockNote } from "@blocknote/react"
import { BlockNoteView } from "@blocknote/shadcn"

// El servidor solo guarda imágenes: se quitan los bloques de video, audio y archivo.
const { video: _video, audio: _audio, file: _file, ...bloques } = defaultBlockSpecs
const schema = BlockNoteSchema.create({ blockSpecs: bloques })

export type DocumentoDescripcion = (typeof schema.Block)[]

const diccionario = {
  ...es,
  placeholders: { ...es.placeholders, default: "Escribe una descripción, usa / para más bloques o pega una imagen" },
}

// Se carga aparte (React.lazy) para que el tablero no espere al editor.
export default function EditorDescripcion({
  inicial,
  oscuro,
  onCambio,
  subirImagen,
  resolverUrl,
}: {
  inicial: (typeof schema.PartialBlock)[] | undefined
  oscuro: boolean
  onCambio: (documento: DocumentoDescripcion) => void
  subirImagen: (archivo: File) => Promise<string>
  resolverUrl: (url: string) => Promise<string>
}) {
  const editor = useCreateBlockNote({
    schema,
    initialContent: inicial,
    dictionary: diccionario,
    uploadFile: subirImagen,
    resolveFileUrl: resolverUrl,
  })

  return <BlockNoteView editor={editor} theme={oscuro ? "dark" : "light"} onChange={() => onCambio(editor.document)} />
}
