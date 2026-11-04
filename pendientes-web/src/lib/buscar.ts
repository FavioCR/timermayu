// Buscar sin importar mayúsculas ni tildes: cada palabra de la búsqueda tiene que estar en el texto.
export const sinTildes = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()

// Un número de pendiente (#73) se busca entero: #7 no trae al #73.
export function coincide(texto: string, busqueda: string) {
  const donde = sinTildes(texto)
  const palabras = ` ${donde.split(/\s+/).join(" ")} `
  return sinTildes(busqueda)
    .split(/\s+/)
    .filter(Boolean)
    .every((palabra) => (/^#\d+$/.test(palabra) ? palabras.includes(` ${palabra} `) : donde.includes(palabra)))
}
