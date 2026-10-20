import { UserRound } from "lucide-react"
import { cn } from "cn"

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

// "xs" va dentro del texto, como en las @menciones del chat.
export function PerfilAvatar({
  perfil,
  size = "sm",
  className,
}: {
  perfil: Perfil | null | undefined
  size?: "xs" | "sm" | "default" | "lg"
  className?: string
}) {
  const mini = size === "xs"
  return (
    <Avatar
      size={mini ? "sm" : size}
      title={perfil?.nombre ?? "Sin asignar"}
      className={cn(mini && "inline-flex align-middle data-[size=sm]:size-4", className)}
    >
      {perfil ? (
        <AvatarFallback
          className={cn("font-medium text-white", mini && "group-data-[size=sm]/avatar:text-[8px]")}
          style={{ backgroundColor: perfil.color }}
        >
          {iniciales(perfil.nombre)}
        </AvatarFallback>
      ) : (
        <AvatarFallback className="border border-dashed border-muted-foreground/50 bg-transparent">
          <UserRound className={mini ? "size-2.5" : "size-3"} />
        </AvatarFallback>
      )}
    </Avatar>
  )
}
