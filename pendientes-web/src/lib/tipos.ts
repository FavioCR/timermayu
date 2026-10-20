import type { TipoTrabajo } from "@/lib/api"

// El tipo de trabajo, como en los commits convencionales. Cada uno con su color: el borde de la tarjeta lo toma.
export const TIPOS: { id: TipoTrabajo; descripcion: string; color: string }[] = [
  { id: "feat", descripcion: "Funcionalidad nueva", color: "#059669" },
  { id: "fix", descripcion: "Corregir un error", color: "#DC2626" },
  { id: "refactor", descripcion: "Reorganizar código", color: "#7C3AED" },
  { id: "perf", descripcion: "Rendimiento", color: "#EA580C" },
  { id: "docs", descripcion: "Documentación", color: "#2563EB" },
  { id: "test", descripcion: "Pruebas", color: "#0891B2" },
  { id: "style", descripcion: "Diseño y estilos", color: "#DB2777" },
  { id: "chore", descripcion: "Mantenimiento", color: "#64748B" },
  { id: "ci", descripcion: "Despliegue e integración", color: "#CA8A04" },
]

export const tipoDe = (id: TipoTrabajo | null | undefined) => TIPOS.find((tipo) => tipo.id === id) ?? null

// "fix: el login falla" o "feat(pagos): cobrar con tarjeta" → el tipo y el título sin el prefijo.
export function separarTipo(texto: string): { tipo: TipoTrabajo | null; texto: string } {
  const prefijo = /^\s*([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/is.exec(texto)
  const tipo = prefijo && tipoDe(prefijo[1].toLowerCase() as TipoTrabajo)
  return tipo && prefijo ? { tipo: tipo.id, texto: prefijo[2].trim() } : { tipo: null, texto }
}
