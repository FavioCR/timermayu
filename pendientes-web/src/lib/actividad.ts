import type { Actividad, Perfil } from "@/lib/api"
import { COLUMNAS } from "@/lib/estados"

const nombreDeEstado = (estado: string | null | undefined) => COLUMNAS.find((columna) => columna.id === estado)?.name ?? estado ?? ""

// Lo que hizo el autor, para poner después de su nombre: "Diego" + " movió «Facturación» a Haciendo".
// Dentro del detalle de un pendiente (conTitulo false) no se repite su título.
// Con `yo`, lo que le toca a esa persona se dice en segunda persona ("te asignó").
export function describir(actividad: Actividad, { conTitulo = true, yo = null }: { conTitulo?: boolean; yo?: string | null } = {}) {
  const titulo = `«${actividad.texto_pendiente}»`
  const datos = actividad.datos ?? {}
  const aMi = (id: string | null | undefined) => Boolean(yo) && id === yo
  switch (actividad.tipo) {
    case "creado": {
      const base = conTitulo ? `creó ${titulo}` : "creó el pendiente"
      if (!datos.asignado) return base
      return aMi(datos.asignado_id) ? `${base} y te lo asignó` : `${base} y se lo asignó a ${datos.asignado}`
    }
    case "texto":
      return conTitulo ? `renombró «${datos.de}» a «${datos.a}»` : `cambió el título a «${datos.a}»`
    case "estado":
      return conTitulo ? `movió ${titulo} a ${nombreDeEstado(datos.a)}` : `lo movió a ${nombreDeEstado(datos.a)}`
    case "asignado":
      if (!datos.a) return conTitulo ? `dejó ${titulo} sin asignar` : "lo dejó sin asignar"
      if (aMi(datos.a_id)) return conTitulo ? `te asignó ${titulo}` : "te lo asignó"
      return conTitulo ? `asignó ${titulo} a ${datos.a}` : `se lo asignó a ${datos.a}`
    case "proyecto":
      if (!datos.a) return conTitulo ? `quitó ${titulo} de ${datos.de}` : `lo quitó de ${datos.de}`
      return conTitulo ? `movió ${titulo} a ${datos.a}` : `lo movió a ${datos.a}`
    case "descripcion":
      return conTitulo ? `editó la descripción de ${titulo}` : "editó la descripción"
    case "comentario":
      if (yo && datos.menciones?.includes(yo)) return conTitulo ? `te mencionó en ${titulo}` : "te mencionó"
      return conTitulo ? `comentó en ${titulo}` : "comentó"
    case "borrado":
      return `borró ${titulo}`
  }
}

const relativo = new Intl.RelativeTimeFormat("es", { numeric: "auto" })
const fechaCorta = new Intl.DateTimeFormat("es", { day: "numeric", month: "short" })
const fechaDia = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" })
export const fechaCompleta = new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short" })

export function haceCuanto(iso: string, ahora = Date.now()) {
  const segundos = Math.round((new Date(iso).getTime() - ahora) / 1000)
  if (Math.abs(segundos) < 45) return "ahora"
  const minutos = Math.round(segundos / 60)
  if (Math.abs(minutos) < 60) return relativo.format(minutos, "minute")
  const horas = Math.round(minutos / 60)
  if (Math.abs(horas) < 24) return relativo.format(horas, "hour")
  const dias = Math.round(horas / 24)
  if (Math.abs(dias) < 7) return relativo.format(dias, "day")
  return fechaCorta.format(new Date(iso))
}

// "Hoy", "Ayer" o "lunes, 19 de octubre", para agrupar el historial por día.
export function dia(iso: string) {
  const fecha = new Date(iso)
  const hoy = new Date()
  const ayer = new Date(hoy)
  ayer.setDate(hoy.getDate() - 1)
  if (fecha.toDateString() === hoy.toDateString()) return "Hoy"
  if (fecha.toDateString() === ayer.toDateString()) return "Ayer"
  const texto = fechaDia.format(fecha)
  return texto[0].toUpperCase() + texto.slice(1)
}

export function enlaceDePendiente(id: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}?p=${id}`
}

// Abre WhatsApp con el mensaje escrito. Sin teléfono guardado, WhatsApp deja elegir el chat.
export function enlaceWhatsApp({
  perfil,
  pendiente,
  proyecto,
  quien,
}: {
  perfil: Perfil
  pendiente: { id: string; texto: string }
  proyecto: string | null
  quien: string | null
}) {
  const asigno = quien ? `${quien} te asignó` : "te asignaron"
  const texto = `Hola ${perfil.nombre}, ${asigno} un pendiente: «${pendiente.texto}»${proyecto ? ` (${proyecto})` : ""}.\nÁbrelo aquí: ${enlaceDePendiente(pendiente.id)}`
  return `https://wa.me/${perfil.telefono ?? ""}?text=${encodeURIComponent(texto)}`
}
