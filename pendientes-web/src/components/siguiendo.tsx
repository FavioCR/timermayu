import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import type { Perfil } from "@/lib/api"

// Mientras se sigue a alguien: un marco de su color alrededor de la pantalla y abajo quién es, dónde anda y cómo
// dejar de seguirlo (también con Esc o al tocar, hacer scroll o escribir). data-seguimiento-barra: tocarla no lo
// deja de seguir ni cierra el pendiente abierto.
export function Siguiendo({ perfil, donde, onDejar }: { perfil: Perfil; donde: string; onDejar: () => void }) {
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[90] border-4" style={{ borderColor: perfil.color }} />
      <div
        role="status"
        data-seguimiento-barra
        className="pointer-events-auto fixed bottom-4 left-1/2 z-[101] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full py-1 pr-1 pl-1.5 text-sm text-white shadow-lg"
        style={{ backgroundColor: perfil.color }}
      >
        <PerfilAvatar perfil={perfil} size="sm" className="shrink-0 ring-2 ring-white/70" />
        <span className="min-w-0 truncate">
          <span className="font-semibold">Siguiendo a {perfil.nombre}</span> · {donde}
        </span>
        <Button size="xs" variant="secondary" className="shrink-0 rounded-full" onClick={onDejar}>
          Dejar de seguir
        </Button>
      </div>
    </>
  )
}
