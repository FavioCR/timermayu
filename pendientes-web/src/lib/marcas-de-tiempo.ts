import type { Archivo } from "@/lib/api"

// Un video o audio adjunto, al que lleva una marca de tiempo.
export type Medio = Pick<Archivo, "id" | "nombre" | "tipo">

// Una marca de tiempo escrita en la descripción: [00:51], un tramo [00:51–02:04], con horas [1:02:03] y, para elegir
// entre varios adjuntos, con su nombre: [00:51 · reunion.mp4]. La IA las escribe igual (ver ia.mjs).
const TIEMPO = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}`
const MARCA = new RegExp(String.raw`\[(${TIEMPO})(?:\s*[–—-]\s*(${TIEMPO}))?(?:\s*·\s*([^\]\n]+?))?\s*\]`, "g")

export type Marca = { inicio: number; fin: number; desde: number; hasta: number | null; nombre: string | null }

// "01:02:03" → 3723. null si no es un tiempo (minutos o segundos de 60 o más, después del primero).
function segundos(texto: string) {
  const partes = texto.split(":").map(Number)
  return partes.slice(1).some((parte) => parte >= 60) ? null : partes.reduce((total, parte) => total * 60 + parte, 0)
}

const dos = (numero: number) => String(numero).padStart(2, "0")

// 51 → "00:51"; 3723 → "1:02:03".
export function tiempoLegible(total: number) {
  const entero = Math.max(0, Math.floor(total))
  const horas = Math.floor(entero / 3600)
  const minutos = Math.floor((entero % 3600) / 60)
  return horas ? `${horas}:${dos(minutos)}:${dos(entero % 60)}` : `${dos(minutos)}:${dos(entero % 60)}`
}

export const tramoLegible = (desde: number, hasta: number | null) =>
  hasta === null ? tiempoLegible(desde) : `${tiempoLegible(desde)}–${tiempoLegible(hasta)}`

// Las marcas de un texto (un tramo que termina antes de empezar no es marca).
export function marcasEn(texto: string): Marca[] {
  return [...texto.matchAll(MARCA)].flatMap((encontrada) => {
    const desde = segundos(encontrada[1])
    const hasta = encontrada[2] ? segundos(encontrada[2]) : null
    if (desde === null || (encontrada[2] && (hasta === null || hasta <= desde))) return []
    const inicio = encontrada.index
    return [{ inicio, fin: inicio + encontrada[0].length, desde, hasta, nombre: encontrada[3]?.trim() || null }]
  })
}

const normal = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()

// El adjunto al que lleva una marca: el que nombra (o, si no, el único que hay). null: hay varios y hay que elegir.
export function medioDeMarca(medios: Medio[], nombre: string | null) {
  if (nombre) {
    const buscado = normal(nombre)
    const nombrado =
      medios.find((medio) => normal(medio.nombre) === buscado) ??
      medios.find((medio) => normal(medio.nombre).startsWith(buscado)) ??
      medios.find((medio) => normal(medio.nombre).includes(buscado))
    if (nombrado) return nombrado
  }
  return medios.length === 1 ? medios[0] : null
}
