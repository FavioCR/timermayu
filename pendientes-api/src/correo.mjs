// El correo con los avisos que alguien no vio: un resumen de esa actividad, con un enlace a cada pendiente.
import nodemailer from 'nodemailer';

const ESTADOS = { pendiente: 'Por hacer', haciendo: 'Haciendo', hecho: 'Hecho' };

// Lo mismo que dice la campana del tablero (lib/actividad.ts), siempre con el título y en segunda persona para `yo`:
// "Diego" + " te asignó «Facturación»".
export function describir(actividad, yo) {
  const titulo = `«${actividad.texto_pendiente}»`;
  const datos = actividad.datos ?? {};
  const aMi = (id) => Boolean(yo) && id === yo;
  switch (actividad.tipo) {
    case 'creado':
      if (!datos.asignado) return `creó ${titulo}`;
      return aMi(datos.asignado_id) ? `creó ${titulo} y te lo asignó` : `creó ${titulo} y se lo asignó a ${datos.asignado}`;
    case 'texto':
      return `renombró «${datos.de}» a «${datos.a}»`;
    case 'estado':
      return `movió ${titulo} a ${ESTADOS[datos.a] ?? datos.a}`;
    case 'asignado':
      if (!datos.a) return `dejó ${titulo} sin asignar`;
      return aMi(datos.a_id) ? `te asignó ${titulo}` : `asignó ${titulo} a ${datos.a}`;
    case 'proyecto':
      return datos.a ? `movió ${titulo} a ${datos.a}` : `quitó ${titulo} de ${datos.de}`;
    case 'descripcion':
      return datos.menciones?.includes(yo) ? `te mencionó en la descripción de ${titulo}` : `editó la descripción de ${titulo}`;
    case 'comentario': {
      if (yo && datos.respondido_id === yo) return `te respondió en ${titulo}`;
      if (datos.menciones?.includes(yo)) return `te mencionó en ${titulo}`;
      const archivos = datos.adjuntos?.length ?? 0;
      if (!datos.extracto && archivos > 0) return `envió ${archivos === 1 ? 'un archivo' : `${archivos} archivos`} en ${titulo}`;
      return `comentó en ${titulo}`;
    }
    case 'traspaso': {
      const termino = datos.estado === 'hecho' && actividad.perfil_id !== null && actividad.perfil_id === datos.de_id ? 'terminó su parte y ' : '';
      return aMi(datos.a_id) ? `${termino}te pasó ${titulo}` : `${termino}le pasó ${titulo} a ${datos.a}`;
    }
    case 'archivo':
      return `adjuntó «${datos.nombre}» en ${titulo}`;
    case 'etiquetas': {
      const lista = (nombres = []) => nombres.map((nombre) => `«${nombre}»`).join(', ');
      const partes = [datos.agregadas?.length && `le puso ${lista(datos.agregadas)}`, datos.quitadas?.length && `le quitó ${lista(datos.quitadas)}`];
      return `${partes.filter(Boolean).join(' y ')} a ${titulo}`;
    }
    case 'tipo':
      return datos.a ? `marcó ${titulo} como ${datos.a}` : `le quitó el tipo a ${titulo}`;
    case 'borrado':
      return `borró ${titulo}`;
    default:
      return `cambió ${titulo}`;
  }
}

// Lo que va debajo de la frase: el texto del mensaje (y sus archivos) o la nota de un traspaso.
function detalleDe(actividad) {
  const datos = actividad.datos ?? {};
  const archivos = datos.adjuntos?.length ? `📎 ${datos.adjuntos.join(', ')}` : null;
  return [datos.extracto || datos.nota, archivos].filter(Boolean).join('\n') || null;
}

const relativo = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function haceCuanto(iso, ahora) {
  const minutos = Math.round((Date.parse(iso) - ahora) / 60_000);
  if (Math.abs(minutos) < 60) return relativo.format(minutos, 'minute');
  const horas = Math.round(minutos / 60);
  if (Math.abs(horas) < 24) return relativo.format(horas, 'hour');
  return relativo.format(Math.round(horas / 24), 'day');
}

const escapar = (texto) => String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Como mucho estos en el correo; del resto se dice cuántos hay.
const MAX_EN_CORREO = 20;

// El correo para `perfil` con sus `avisos` (actividad, de la más vieja a la más nueva): asunto, texto y HTML.
export function armarResumen({ perfil, avisos, urlTablero, ahora = Date.now() }) {
  const enlace = (actividad) => actividad.pendiente_id && `${urlTablero}?p=${actividad.pendiente_id}`;
  const frase = (actividad) => `${actividad.autor ?? 'Alguien'} ${describir(actividad, perfil.id)}`;
  const mostrados = avisos.slice(-MAX_EN_CORREO).reverse();
  const resto = avisos.length - mostrados.length;
  const asunto = avisos.length === 1 ? frase(avisos[0]) : `Tienes ${avisos.length} avisos sin ver en Pendientes`;
  const pie = 'Este resumen llega a las 9 de la mañana, como mucho cada 2 días, con los avisos que no viste. Para no recibir estos correos, apágalos en el menú de tu cuenta, en «Avisos por correo».';

  const texto = [
    `Hola, ${perfil.nombre}:`,
    '',
    avisos.length === 1 ? 'Esto pasó en Pendientes y todavía no lo viste:' : 'Esto pasó en Pendientes y todavía no lo viste (lo más nuevo primero):',
    '',
    ...mostrados.flatMap((actividad) => [
      `• ${frase(actividad)} (${haceCuanto(actividad.creado_en, ahora)})`,
      ...(detalleDe(actividad) ? detalleDe(actividad).split('\n').map((linea) => `  > ${linea}`) : []),
      ...(enlace(actividad) ? [`  ${enlace(actividad)}`] : []),
      '',
    ]),
    ...(resto > 0 ? [`Y ${resto === 1 ? 'un aviso más' : `${resto} avisos más`} en el tablero.`, ''] : []),
    `Abrir el tablero: ${urlTablero}`,
    '',
    '—',
    pie,
  ].join('\n');

  const filas = mostrados.map((actividad) => {
    const url = enlace(actividad);
    const titulo = url ? `<a href="${escapar(url)}" style="color:#111827;text-decoration:none">${escapar(frase(actividad))}</a>` : escapar(frase(actividad));
    const detalle = detalleDe(actividad);
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb">
      <div style="font-size:15px;line-height:1.4;font-weight:600">${titulo}</div>
      ${detalle ? `<div style="margin-top:6px;padding-left:10px;border-left:3px solid #d1d5db;color:#4b5563;font-size:14px;white-space:pre-line">${escapar(detalle)}</div>` : ''}
      <div style="margin-top:4px;color:#6b7280;font-size:12px">${escapar(haceCuanto(actividad.creado_en, ahora))}</div>
    </td></tr>`;
  }).join('');
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:24px">
      <tr><td style="font-size:16px;padding-bottom:4px">Hola, ${escapar(perfil.nombre)}:</td></tr>
      <tr><td style="font-size:14px;color:#4b5563;padding-bottom:8px">Esto pasó en Pendientes y todavía no lo viste${avisos.length > 1 ? ' (lo más nuevo primero)' : ''}:</td></tr>
      ${filas}
      ${resto > 0 ? `<tr><td style="padding-top:12px;font-size:14px;color:#4b5563">Y ${resto === 1 ? 'un aviso más' : `${resto} avisos más`} en el tablero.</td></tr>` : ''}
      <tr><td style="padding-top:20px"><a href="${escapar(urlTablero)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px">Abrir el tablero</a></td></tr>
      <tr><td style="padding-top:24px;font-size:12px;color:#6b7280">${escapar(pie)}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject: asunto, text: texto, html };
}

// Por SMTP (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD; MAIL_FROM es el remitente).
// null si falta el servidor o el remitente: entonces no se manda nada.
export function crearCorreo(env = process.env) {
  if (!env.SMTP_HOST || !env.MAIL_FROM) return null;
  const port = Number(env.SMTP_PORT || 587);
  const transporte = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    // SMTP_SECURE acepta true/1; sin ponerlo, el 465 va cifrado desde el principio y los demás con STARTTLS.
    secure: env.SMTP_SECURE ? ['true', '1'].includes(env.SMTP_SECURE.toLowerCase()) : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
  });
  return { enviar: (mensaje) => transporte.sendMail({ from: env.MAIL_FROM, ...mensaje }) };
}
