import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { aparienciaRecordada, aplicarApariencia } from './lib/apariencia'
import { prepararInstalacion } from './lib/instalar'

// La plantilla activa el tema oscuro con la clase .dark; se sigue el tema del sistema.
const temaOscuro = window.matchMedia('(prefers-color-scheme: dark)')
const aplicarTema = () => document.documentElement.classList.toggle('dark', temaOscuro.matches)
aplicarTema()
temaOscuro.addEventListener('change', aplicarTema)
// La fuente y el tamaño de la última vez, antes de pintar nada (el tablero después aplica los del perfil).
aplicarApariencia(aparienciaRecordada())
// Antes de montar: el aviso de que se puede instalar llega muy temprano.
prepararInstalacion()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
