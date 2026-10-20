import type { ReactNode } from "react"
import { UserPlus } from "lucide-react"

import { PerfilAvatar } from "@/components/perfil-avatar"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Organizacion, Perfil } from "@/lib/api"

// Agrega o quita personas de una organización compartida. El menú queda abierto para marcar varias seguidas.
export function InvolucradosMenu({
  organizacion,
  perfiles,
  onCambiar,
  onNuevoPerfil,
  align = "end",
  children,
}: {
  organizacion: Organizacion
  perfiles: Perfil[]
  onCambiar: (miembros: string[]) => void
  onNuevoPerfil?: () => void
  align?: "start" | "end"
  children: ReactNode
}) {
  const { miembros } = organizacion
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-60">
        <DropdownMenuLabel className="font-normal text-muted-foreground">Involucrados en {organizacion.nombre}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {perfiles.map((perfil) => (
          <DropdownMenuCheckboxItem
            key={perfil.id}
            checked={miembros.includes(perfil.id)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(marcado) => onCambiar(marcado ? [...miembros, perfil.id] : miembros.filter((id) => id !== perfil.id))}
          >
            <PerfilAvatar perfil={perfil} size="sm" /> {perfil.nombre}
          </DropdownMenuCheckboxItem>
        ))}
        {onNuevoPerfil && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onNuevoPerfil}>
              <UserPlus /> Crear un perfil nuevo
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
