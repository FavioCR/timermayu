// Pegar texto con imágenes copiado de otro lado (una página, Google Docs, Word, un chat): el HTML trae cada imagen como
// un <img>, pero no todas se pueden ver desde aquí. Las de Word apuntan a un archivo de la computadora (file://), las de
// otras apps a algo que solo existe allá (blob:, cid:…): esas se sacan de las imágenes que vienen junto al texto en el
// portapapeles (archivos, o el RTF que deja Word). Las data: pasan a ser un enlace temporal de la página, para no
// guardar la imagen dentro del texto. Después, el editor sube cada una al pendiente (o a la nota).

export const TIPOS_SUBIBLES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

// Lo que se puede ver (y traer) desde aquí: de internet, del tablero o ya en la página.
function seVe(src: string) {
  return /^(https?:\/\/|data:image\/)/i.test(src) || src.startsWith("/api/pendientes/") || src.startsWith(`blob:${location.origin}/`)
}

function deDataUrl(src: string) {
  const coma = src.indexOf(",")
  const cabecera = src.slice(0, coma)
  const datos = src.slice(coma + 1)
  const tipo = /^data:([^;,]+)/i.exec(cabecera)?.[1] ?? "image/png"
  const texto = /;base64/i.test(cabecera) ? atob(datos) : decodeURIComponent(datos)
  const bytes = Uint8Array.from(texto, (letra) => letra.charCodeAt(0))
  return new Blob([bytes], { type: tipo })
}

// Las imágenes que vienen junto al texto: archivos (como al copiar una imagen) o, si no hay, las del RTF de Word.
export function imagenesDelPortapapeles(datos: DataTransfer): Blob[] {
  const archivos = [...datos.files].filter((archivo) => archivo.type.startsWith("image/"))
  if (archivos.length > 0) return archivos
  return datos.types.includes("text/rtf") ? imagenesDeRtf(datos.getData("text/rtf")) : []
}

// El HTML listo para pegar: cada imagen con algo que se ve, o fuera si no hay de dónde sacarla (`perdidas`).
// Si vienen tantas imágenes aparte como <img>, se usan esas (son las de verdad, sin pedir nada a nadie).
export function prepararHtml(html: string, aparte: Blob[]): { html: string; perdidas: number } {
  const documento = new DOMParser().parseFromString(html, "text/html")
  const imagenes = [...documento.body.querySelectorAll("img")]
  const todasAparte = aparte.length >= imagenes.length
  let siguiente = 0
  let perdidas = 0
  for (const imagen of imagenes) {
    const src = imagen.getAttribute("src")?.trim() ?? ""
    imagen.removeAttribute("srcset")
    if ((todasAparte || !seVe(src)) && siguiente < aparte.length) {
      imagen.setAttribute("src", URL.createObjectURL(aparte[siguiente++]))
    } else if (/^data:image\//i.test(src)) {
      try {
        imagen.setAttribute("src", URL.createObjectURL(deDataUrl(src)))
      } catch {
        imagen.remove()
        perdidas++
      }
    } else if (!seVe(src)) {
      imagen.remove()
      perdidas++
    }
  }
  return { html: documento.body.innerHTML, perdidas }
}

// Las imágenes PNG y JPEG del RTF (Word las guarda en hexadecimal dentro de cada grupo \pict). Lo que va en
// \nonshppict es la misma imagen para programas viejos: se salta.
export function imagenesDeRtf(rtf: string): Blob[] {
  type Grupo = { imagen: boolean; saltar: boolean; tipo: string | null; hex: string[] }
  const imagenes: Blob[] = []
  const pila: Grupo[] = []
  const palabra = /\\([a-z]+)(-?\d+)? ?|\\[^a-z]/iy
  const hexadecimal = /[0-9a-f\s]+/iy
  let i = 0
  while (i < rtf.length) {
    const letra = rtf[i]
    const grupo = pila.at(-1)
    if (letra === "{") {
      pila.push({ imagen: false, saltar: grupo?.saltar ?? false, tipo: null, hex: [] })
      i++
    } else if (letra === "}") {
      pila.pop()
      if (grupo?.imagen && !grupo.saltar && grupo.tipo) {
        const blob = blobDeHex(grupo.hex.join(""), grupo.tipo)
        if (blob) imagenes.push(blob)
      }
      i++
    } else if (letra === "\\") {
      palabra.lastIndex = i
      const encontrada = palabra.exec(rtf)
      if (!encontrada) break
      i = palabra.lastIndex
      const [, nombre, numero] = encontrada
      if (!grupo || !nombre) continue
      if (nombre === "pict") grupo.imagen = true
      else if (nombre === "nonshppict") grupo.saltar = true
      else if (nombre === "pngblip") grupo.tipo = "image/png"
      else if (nombre === "jpegblip") grupo.tipo = "image/jpeg"
      // Datos en binario: se saltan.
      else if (nombre === "bin") i += Number(numero ?? 0)
    } else if (grupo?.imagen) {
      hexadecimal.lastIndex = i
      if (hexadecimal.exec(rtf)) {
        grupo.hex.push(rtf.slice(i, hexadecimal.lastIndex))
        i = hexadecimal.lastIndex
      } else {
        i++
      }
    } else {
      i++
    }
  }
  return imagenes
}

function blobDeHex(texto: string, tipo: string) {
  const hex = texto.replace(/\s+/g, "")
  const bytes = new Uint8Array(hex.length >> 1)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  const esPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  const esJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  return (tipo === "image/png" ? esPng : esJpeg) ? new Blob([bytes], { type: tipo }) : null
}

// Lista para subir: PNG, JPEG, GIF y WebP tal cual; otro formato que el navegador sepa abrir (BMP, AVIF…), como PNG.
export async function comoImagenSubible(blob: Blob, nombre: string): Promise<File> {
  const base = nombre.replace(/\.[^.]*$/, "") || "imagen"
  if (TIPOS_SUBIBLES.includes(blob.type)) return new File([blob], `${base}.${blob.type.slice(6).replace("jpeg", "jpg")}`, { type: blob.type })
  const imagen = await createImageBitmap(blob)
  const lienzo = document.createElement("canvas")
  lienzo.width = imagen.width
  lienzo.height = imagen.height
  lienzo.getContext("2d")?.drawImage(imagen, 0, 0)
  imagen.close()
  const png = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, "image/png"))
  if (!png) throw new Error("imagen_invalida")
  return new File([png], `${base}.png`, { type: "image/png" })
}

// El nombre para la imagen subida: el que tenía el bloque, o el final de su dirección.
export function nombreDeImagen(nombre: string, url: string) {
  if (nombre) return nombre
  if (!/^https?:\/\//i.test(url)) return "imagen"
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "").slice(0, 80) || "imagen"
  } catch {
    return "imagen"
  }
}
