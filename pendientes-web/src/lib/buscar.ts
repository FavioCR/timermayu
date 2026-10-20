// Buscar sin importar mayúsculas ni tildes: cada palabra de la búsqueda tiene que estar en el texto.
export const sinTildes = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()

export function coincide(texto: string, busqueda: string) {
  const donde = sinTildes(texto)
  return sinTildes(busqueda)
    .split(/\s+/)
    .filter(Boolean)
    .every((palabra) => donde.includes(palabra))
}
