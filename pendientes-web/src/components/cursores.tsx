import { useEffect, useRef, type CSSProperties } from "react"

import type { Perfil } from "@/lib/api"
import { asomar, mismoLugar, punteroDe, ubicar, useLugares, useVerCursores, type Lugar, type Puntero } from "@/lib/seguimiento"

// Cuánto se acerca en cada cuadro a donde llegó el mouse: llega unas 12 veces por segundo y así no salta.
const SUAVIDAD = 0.35
// Siguiendo a alguien, cada cuánto como mucho se desplaza para no perder su mouse de vista.
const ASOMAR_CADA_MS = 600

// Los cursores de quienes están en el mismo lugar (el tablero o el mismo pendiente), con su color y su nombre, como en
// Miro. Se mueven en cada cuadro sin pasar por React. Si se apagan en el menú de la cuenta, igual se ve el de quien se
// sigue.
export function Cursores({ lugar, perfilesPorId, siguiendo }: { lugar: Lugar; perfilesPorId: Map<string, Perfil>; siguiendo: string | null }) {
  const verCursores = useVerCursores()
  const lugares = useLugares()
  const nodos = useRef(new Map<string, HTMLDivElement>())
  const aqui = [...lugares]
    .filter(([perfilId, suyo]) => perfilesPorId.has(perfilId) && mismoLugar(suyo, lugar) && (verCursores || perfilId === siguiendo))
    .map(([perfilId]) => perfilId)
  const clave = aqui.join()

  useEffect(() => {
    if (!clave) return
    // Lo que se muestra, en las coordenadas del ancla: el scroll de esta pantalla no lo retrasa.
    const mostrados = new Map<string, Puntero>()
    let asomado = 0
    let cuadro = 0
    const pintar = () => {
      for (const [perfilId, nodo] of nodos.current) {
        const destino = punteroDe(perfilId)
        const antes = mostrados.get(perfilId)
        if (!destino) {
          mostrados.delete(perfilId)
          nodo.style.opacity = "0"
          continue
        }
        const actual =
          antes && antes.ancla === destino.ancla
            ? { ancla: destino.ancla, x: antes.x + (destino.x - antes.x) * SUAVIDAD, y: antes.y + (destino.y - antes.y) * SUAVIDAD }
            : destino
        mostrados.set(perfilId, actual)
        const punto = ubicar(actual)
        if (perfilId === siguiendo && !punto?.visible && Date.now() - asomado > ASOMAR_CADA_MS) {
          asomado = Date.now()
          asomar(destino)
        }
        if (!punto?.visible) {
          nodo.style.opacity = "0"
          continue
        }
        nodo.style.opacity = "1"
        nodo.style.transform = `translate(${punto.x}px, ${punto.y}px)`
      }
      cuadro = requestAnimationFrame(pintar)
    }
    cuadro = requestAnimationFrame(pintar)
    return () => cancelAnimationFrame(cuadro)
  }, [clave, siguiendo])

  if (aqui.length === 0) return null
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[100] overflow-hidden">
      {aqui.map((perfilId) => {
        const perfil = perfilesPorId.get(perfilId)!
        return (
          <div
            key={perfilId}
            ref={(nodo) => {
              if (nodo) nodos.current.set(perfilId, nodo)
              else nodos.current.delete(perfilId)
            }}
            className="absolute top-0 left-0 opacity-0 transition-opacity duration-150 will-change-transform"
            style={{ "--cursor": perfil.color } as CSSProperties}
          >
            <svg viewBox="0 0 16 16" className="size-5 drop-shadow-sm">
              <path
                d="M1.5 1.5v12l3.4-3.1 2.4 4.8 2.2-1.1-2.4-4.7h4.6z"
                fill="var(--cursor)"
                stroke="white"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span className="absolute top-4.5 left-3.5 rounded-full bg-(--cursor) px-2 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow-sm">
              {perfil.nombre}
            </span>
          </div>
        )
      })}
    </div>
  )
}
