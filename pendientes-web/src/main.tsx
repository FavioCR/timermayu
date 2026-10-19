import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// La plantilla activa el tema oscuro con la clase .dark; se sigue el tema del sistema.
const temaOscuro = window.matchMedia('(prefers-color-scheme: dark)')
const aplicarTema = () => document.documentElement.classList.toggle('dark', temaOscuro.matches)
aplicarTema()
temaOscuro.addEventListener('change', aplicarTema)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
