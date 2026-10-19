import type { Estado } from "@/lib/api"

// Dibujos de las columnas vacías. Usan el color de su columna y los tonos del tema.
const trazo = { fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const

function PorHacer() {
  return (
    <svg viewBox="0 0 160 110" className="h-24 w-36 text-slate-400" aria-hidden="true">
      <g stroke="currentColor" {...trazo}>
        <path d="M34 47l8 3M33 60l8-1" strokeWidth="3" />
        <rect x="54" y="31" width="42" height="48" rx="9" strokeWidth="4" transform="rotate(-10 75 55)" />
        <path d="M64 48l20-3.5M65.5 57.5l17-3M67 67l11-2" strokeWidth="4" />
        <path d="M92 19a32 32 0 0 1 25 43" strokeWidth="3" strokeDasharray="4 6" />
        <path d="M108 58l8.5 6 4-10" strokeWidth="3" />
      </g>
    </svg>
  )
}

function Haciendo() {
  return (
    <svg viewBox="0 0 160 110" className="h-24 w-36 text-amber-500" aria-hidden="true">
      <rect x="50" y="16" width="62" height="18" rx="5" className="fill-muted stroke-border" strokeWidth="1.5" />
      <path d="M62 25h38" className="stroke-muted-foreground/50" strokeWidth="3" {...trazo} />
      <rect x="38" y="42" width="84" height="26" rx="7" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="3" />
      <circle cx="53" cy="55" r="5.5" fill="currentColor" />
      <path d="M66 55h30" stroke="currentColor" strokeWidth="4" {...trazo} />
      <rect x="52" y="76" width="58" height="16" rx="5" className="fill-muted stroke-border" strokeWidth="1.5" />
      <path d="M63 84h36" className="stroke-muted-foreground/50" strokeWidth="3" {...trazo} />
      <path d="M128 30l6-7M131 41l10-2M124 25l1-7" stroke="currentColor" strokeWidth="3" {...trazo} />
    </svg>
  )
}

function Hecho() {
  return (
    <svg viewBox="0 0 160 110" className="h-24 w-36 text-emerald-500" aria-hidden="true">
      <circle cx="80" cy="58" r="29" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="4" />
      <path d="M67 58l9.5 9.5L94 50" stroke="currentColor" strokeWidth="5" {...trazo} />
      <path d="M42 38l7 6M38 55l9 1M112 30l6-7M116 44l10-2" stroke="currentColor" strokeWidth="3" {...trazo} />
    </svg>
  )
}

const DIBUJOS: Record<Estado, () => React.JSX.Element> = { pendiente: PorHacer, haciendo: Haciendo, hecho: Hecho }

export function IlustracionColumna({ estado }: { estado: Estado }) {
  const Dibujo = DIBUJOS[estado]
  return <Dibujo />
}
