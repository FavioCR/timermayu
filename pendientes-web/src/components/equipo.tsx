import { Eye, UsersRound } from "lucide-react"
import { useState } from "react"
import { cn } from "cn"

import { PerfilAvatar } from "@/components/perfil-avatar"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Perfil } from "@/lib/api"
import { ultimaConexion, useEquipo } from "@/lib/presencia"
import { describirLugar, useLugares } from "@/lib/seguimiento"

// Quién del equipo está en línea (con el tablero o sus notas a la vista y en uso), dónde anda (el tablero, qué
// pendiente o sus notas) y, de los demás, su última conexión. A quien está en el tablero o en un pendiente se lo puede
// seguir, como en Miro. En el encabezado se ven las caras de quienes están en línea (en pantallas más chicas, cuántos son).
export function Equipo({
  credenciales,
  yo,
  perfiles,
  tituloDe,
  siguiendo,
  onSeguir,
}: {
  credenciales: string
  yo: string | null
  perfiles: Perfil[]
  tituloDe: (pendienteId: string) => string | undefined
  siguiendo: string | null
  onSeguir: (perfilId: string | null) => void
}) {
  const equipo = useEquipo(credenciales)
  const lugares = useLugares()
  const [abierto, setAbierto] = useState(false)
  const enLinea = (perfil: Perfil) => perfil.id === yo || equipo.get(perfil.id)?.en_linea === true
  const conectados = perfiles.filter(enLinea).sort((a, b) => (a.id === yo ? -1 : b.id === yo ? 1 : a.nombre.localeCompare(b.nombre)))
  // Los demás, primero quien estuvo hace menos; al final quien nunca entró.
  const visto = (perfil: Perfil) => equipo.get(perfil.id)?.visto_en ?? ""
  const desconectados = perfiles
    .filter((perfil) => !enLinea(perfil))
    .sort((a, b) => visto(b).localeCompare(visto(a)) || a.nombre.localeCompare(b.nombre))
  const otros = conectados.filter((perfil) => perfil.id !== yo)

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative", otros.length > 0 && "xl:w-auto xl:px-1.5")}
          aria-label={`Equipo: ${otros.length ? `${otros.length} en línea` : "nadie más en línea"}`}
          title="Equipo"
        >
          <UsersRound className={cn(otros.length > 0 && "xl:hidden")} />
          {otros.length > 0 && (
            <>
              <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] leading-none font-semibold text-white tabular-nums xl:hidden">
                {otros.length > 9 ? "9+" : otros.length}
              </span>
              <span className="hidden items-center -space-x-1.5 xl:flex">
                {otros.slice(0, 3).map((perfil) => (
                  <PerfilAvatar key={perfil.id} perfil={perfil} size="sm" className="size-6 ring-2 ring-background" />
                ))}
                {otros.length > 3 && (
                  <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold ring-2 ring-background">
                    +{otros.length - 3}
                  </span>
                )}
              </span>
              <span className="absolute right-0.5 bottom-0.5 hidden size-2.5 rounded-full bg-emerald-500 ring-2 ring-background xl:block" aria-hidden />
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex min-h-12 items-center justify-between gap-2 border-b px-4 py-2">
          <p className="m-0 font-medium">Equipo</p>
          <span className="text-xs text-muted-foreground">
            {conectados.length} en línea
          </span>
        </div>
        <ul className="m-0 max-h-[min(28rem,60svh)] list-none overflow-y-auto p-0 py-1" aria-label="Equipo">
          {[...conectados, ...desconectados].map((perfil) => {
            const conectado = enLinea(perfil)
            const presencia = equipo.get(perfil.id)
            const lugar = perfil.id === yo ? undefined : lugares.get(perfil.id)
            const seguible = conectado && (lugar?.lugar === "tablero" || lugar?.lugar === "pendiente")
            const estado = conectado
              ? lugar
                ? describirLugar(lugar, tituloDe)
                : "En línea"
              : !perfil.tiene_contrasena
                ? "Aún no entra con su nombre"
                : presencia?.visto_en
                  ? `Última conexión ${ultimaConexion(presencia.visto_en)}`
                  : "Desconectado"
            return (
              <li key={perfil.id} className="flex items-center gap-3 px-4 py-2">
                <span className="relative shrink-0">
                  <PerfilAvatar perfil={perfil} size="default" className={cn(!conectado && "opacity-70")} />
                  {conectado && (
                    <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-emerald-500 ring-2 ring-popover" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {perfil.nombre}
                    {perfil.id === yo && <span className="font-normal text-muted-foreground"> (tú)</span>}
                  </span>
                  <span
                    className={cn("block truncate text-xs", conectado ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}
                    title={estado}
                  >
                    {estado}
                  </span>
                </span>
                {seguible && (
                  <Button
                    size="xs"
                    variant={siguiendo === perfil.id ? "secondary" : "outline"}
                    className="shrink-0"
                    aria-pressed={siguiendo === perfil.id}
                    title={siguiendo === perfil.id ? "Dejar de seguir" : `Ver lo que ve ${perfil.nombre}`}
                    onClick={() => {
                      onSeguir(siguiendo === perfil.id ? null : perfil.id)
                      setAbierto(false)
                    }}
                  >
                    <Eye /> {siguiendo === perfil.id ? "Siguiendo" : "Seguir"}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
