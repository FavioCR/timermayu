import { UserRound } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { Perfil } from "@/lib/api"

const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join("")
    .toUpperCase()

export function PerfilAvatar({ perfil, size = "sm" }: { perfil: Perfil | null | undefined; size?: "sm" | "default" | "lg" }) {
  return (
    <Avatar size={size} title={perfil?.nombre ?? "Sin asignar"}>
      {perfil ? (
        <AvatarFallback className="font-medium text-white" style={{ backgroundColor: perfil.color }}>
          {iniciales(perfil.nombre)}
        </AvatarFallback>
      ) : (
        <AvatarFallback className="border border-dashed border-muted-foreground/50 bg-transparent">
          <UserRound className="size-3" />
        </AvatarFallback>
      )}
    </Avatar>
  )
}
