// La fuente y el tamaño de letra de cada persona. Las fuentes vienen empaquetadas (Fontsource, licencia OFL): sus
// @font-face pesan poco y el navegador solo descarga los archivos de la que se usa.
import "@fontsource-variable/inter"
import "@fontsource-variable/roboto"
import "@fontsource-variable/nunito"
import "@fontsource-variable/atkinson-hyperlegible-next"
import "@fontsource-variable/lexend"
import "@fontsource-variable/source-serif-4"

export type Apariencia = { fuente: string; tamano: number }

export const FUENTES: { id: string; nombre: string; nota: string; familia: string }[] = [
  { id: "geist", nombre: "Geist", nota: "La de siempre", familia: "'Geist Variable', sans-serif" },
  {
    id: "sistema",
    nombre: "La del sistema",
    nota: "San Francisco en Mac, Segoe en Windows",
    familia: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
  { id: "inter", nombre: "Inter", nota: "Clara, para pantallas", familia: "'Inter Variable', sans-serif" },
  { id: "roboto", nombre: "Roboto", nota: "La de Android", familia: "'Roboto Variable', sans-serif" },
  { id: "nunito", nombre: "Nunito", nota: "Redondeada y amable", familia: "'Nunito Variable', sans-serif" },
  {
    id: "atkinson",
    nombre: "Atkinson Hyperlegible",
    nota: "Hecha para leer fácil",
    familia: "'Atkinson Hyperlegible Next Variable', sans-serif",
  },
  { id: "lexend", nombre: "Lexend", nota: "Lectura cómoda y espaciada", familia: "'Lexend Variable', sans-serif" },
  { id: "serif", nombre: "Source Serif", nota: "Con serifa, como un libro", familia: "'Source Serif 4 Variable', serif" },
]

// En % del tamaño normal (que en computadoras ya es un poco más chico que en el celular).
export const TAMANOS: { valor: number; nombre: string }[] = [
  { valor: 80, nombre: "Muy chica" },
  { valor: 90, nombre: "Chica" },
  { valor: 100, nombre: "Normal" },
  { valor: 112, nombre: "Grande" },
  { valor: 125, nombre: "Muy grande" },
]

export const APARIENCIA_NORMAL: Apariencia = { fuente: "geist", tamano: 100 }

// La última que se aplicó, para que al recargar no se vea un instante la de siempre antes de saber la del perfil.
const CLAVE = "pendientes.apariencia"

export const mismaApariencia = (a: Apariencia, b: Apariencia) => a.fuente === b.fuente && a.tamano === b.tamano

export function aplicarApariencia(apariencia: Apariencia) {
  const fuente = FUENTES.find((f) => f.id === apariencia.fuente) ?? FUENTES[0]
  const estilo = document.documentElement.style
  estilo.setProperty("--fuente", fuente.familia)
  estilo.setProperty("--escala-letra", String(apariencia.tamano / 100))
  try {
    if (mismaApariencia(apariencia, APARIENCIA_NORMAL)) localStorage.removeItem(CLAVE)
    else localStorage.setItem(CLAVE, JSON.stringify(apariencia))
  } catch {
    // Sin almacenamiento solo se pierde ese instante al recargar.
  }
}

export function aparienciaRecordada(): Apariencia {
  try {
    const guardada = JSON.parse(localStorage.getItem(CLAVE) ?? "null")
    if (typeof guardada?.fuente === "string" && typeof guardada?.tamano === "number") return guardada
  } catch {
    // Lo guardado no se entiende: la de siempre.
  }
  return APARIENCIA_NORMAL
}
