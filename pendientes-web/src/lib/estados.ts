import type { Estado } from "@/lib/api"

export const COLUMNAS: { id: Estado; name: string; color: string }[] = [
  { id: "pendiente", name: "Por hacer", color: "#94A3B8" },
  { id: "haciendo", name: "Haciendo", color: "#F59E0B" },
  { id: "hecho", name: "Hecho", color: "#10B981" },
]

// Radix Select no acepta "" como valor: este marca "sin asignar".
export const NADIE = "nadie"
