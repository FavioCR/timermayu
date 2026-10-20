// Las fotos y capturas se achican antes de subir: el lado más largo a 2000 px y WebP al 85 %.
// GIF (puede ser animado), WebP (ya viene comprimido) y lo que no es imagen se suben tal cual,
// igual que la original cuando la versión nueva no pesa menos o el navegador no sabe escribir WebP.
const LADO_MAXIMO = 2000
const CALIDAD = 0.85
const COMPRIMIBLES = ["image/png", "image/jpeg"]

export async function comprimirImagen(archivo: File): Promise<File> {
  if (!COMPRIMIBLES.includes(archivo.type)) return archivo
  try {
    const imagen = await createImageBitmap(archivo)
    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height))
    const lienzo = document.createElement("canvas")
    lienzo.width = Math.round(imagen.width * escala)
    lienzo.height = Math.round(imagen.height * escala)
    const contexto = lienzo.getContext("2d")
    if (!contexto) return archivo
    contexto.imageSmoothingQuality = "high"
    contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height)
    imagen.close()
    const webp = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, "image/webp", CALIDAD))
    // Sin soporte para WebP, el navegador entrega un PNG.
    if (!webp || webp.type !== "image/webp" || webp.size >= archivo.size) return archivo
    const nombre = archivo.name.replace(/\.[^.]*$/, "") || "imagen"
    return new File([webp], `${nombre}.webp`, { type: "image/webp", lastModified: archivo.lastModified })
  } catch {
    return archivo
  }
}
