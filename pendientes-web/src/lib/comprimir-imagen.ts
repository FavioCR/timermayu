// Las fotos y capturas se achican antes de subir: el lado más largo a 2000 px y WebP al 85 %.
// GIF (puede ser animado), WebP (ya viene comprimido) y lo que no es imagen se suben tal cual,
// igual que la original cuando la versión nueva no pesa menos o el navegador no sabe escribir WebP.
const LADO_MAXIMO = 2000
const CALIDAD = 0.85
const COMPRIMIBLES = ["image/png", "image/jpeg"]
// Lo único que aceptan los tres proveedores de IA.
const PARA_IA = ["image/png", "image/jpeg", "image/webp"]

async function redibujar(archivo: File, tipo: string): Promise<Blob | null> {
  const imagen = await createImageBitmap(archivo)
  const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height))
  const lienzo = document.createElement("canvas")
  lienzo.width = Math.round(imagen.width * escala)
  lienzo.height = Math.round(imagen.height * escala)
  const contexto = lienzo.getContext("2d")
  if (!contexto) return null
  contexto.imageSmoothingQuality = "high"
  contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height)
  imagen.close()
  return new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, tipo, CALIDAD))
}

export async function comprimirImagen(archivo: File): Promise<File> {
  if (!COMPRIMIBLES.includes(archivo.type)) return archivo
  try {
    const webp = await redibujar(archivo, "image/webp")
    // Sin soporte para WebP, el navegador entrega un PNG.
    if (!webp || webp.type !== "image/webp" || webp.size >= archivo.size) return archivo
    const nombre = archivo.name.replace(/\.[^.]*$/, "") || "imagen"
    return new File([webp], `${nombre}.webp`, { type: "image/webp", lastModified: archivo.lastModified })
  } catch {
    return archivo
  }
}

// Para mandarle una imagen a la IA: se achica igual y, si queda en otro formato (GIF, HEIC en Safari, un WebP de
// más de 2000 px…), se redibuja como JPEG. Devuelve null si el navegador no la puede abrir.
export async function imagenParaIA(archivo: File): Promise<File | null> {
  const comprimida = await comprimirImagen(archivo)
  if (PARA_IA.includes(comprimida.type) && comprimida !== archivo) return comprimida
  try {
    const imagen = await createImageBitmap(archivo)
    const cabe = Math.max(imagen.width, imagen.height) <= LADO_MAXIMO
    imagen.close()
    if (PARA_IA.includes(archivo.type) && cabe) return archivo
    const jpeg = await redibujar(archivo, "image/jpeg")
    if (!jpeg) return null
    const nombre = archivo.name.replace(/\.[^.]*$/, "") || "imagen"
    return new File([jpeg], `${nombre}.jpg`, { type: "image/jpeg", lastModified: archivo.lastModified })
  } catch {
    return null
  }
}
