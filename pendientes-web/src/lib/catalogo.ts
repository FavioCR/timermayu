import type { Organizacion, Proyecto } from "@/lib/api"

// Organizaciones y proyectos que ve quien entró. Lo privado de otros ni siquiera llega del servidor.
export type Catalogo = { organizaciones: Organizacion[]; proyectos: Proyecto[] }

export type Grupo = { organizacion: Organizacion | null; proyectos: Proyecto[] }

// Marca en los filtros a lo que no está en ninguna organización.
export const SIN_ORGANIZACION = "sin-organizacion"

// Cada organización con sus proyectos y, al final, los proyectos sueltos.
export function agrupar({ organizaciones, proyectos }: Catalogo): Grupo[] {
  const grupos: Grupo[] = organizaciones.map((organizacion) => ({
    organizacion,
    proyectos: proyectos.filter((proyecto) => proyecto.organizacion_id === organizacion.id),
  }))
  return [...grupos, { organizacion: null, proyectos: proyectos.filter((proyecto) => proyecto.organizacion_id === null) }]
}

export function organizacionDe(catalogo: Catalogo, proyectoId: string | null) {
  const proyecto = catalogo.proyectos.find((p) => p.id === proyectoId)
  return proyecto?.organizacion_id ? (catalogo.organizaciones.find((o) => o.id === proyecto.organizacion_id) ?? null) : null
}

// Mismo orden que el servidor: por nombre, sin distinguir mayúsculas.
const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" })

export const conOrganizacion = (catalogo: Catalogo, organizacion: Organizacion): Catalogo => ({
  ...catalogo,
  organizaciones: [...catalogo.organizaciones.filter((o) => o.id !== organizacion.id), organizacion].sort(porNombre),
})

// Al borrar una organización el servidor borra también sus proyectos.
export const sinOrganizacion = (catalogo: Catalogo, id: string): Catalogo => ({
  organizaciones: catalogo.organizaciones.filter((o) => o.id !== id),
  proyectos: catalogo.proyectos.filter((p) => p.organizacion_id !== id),
})

export const conProyecto = (catalogo: Catalogo, proyecto: Proyecto): Catalogo => ({
  ...catalogo,
  proyectos: [...catalogo.proyectos.filter((p) => p.id !== proyecto.id), proyecto].sort(porNombre),
})

export const sinProyecto = (catalogo: Catalogo, id: string): Catalogo => ({
  ...catalogo,
  proyectos: catalogo.proyectos.filter((p) => p.id !== id),
})
