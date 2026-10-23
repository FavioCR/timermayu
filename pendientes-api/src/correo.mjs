// El correo con los avisos que alguien no vio: un resumen de esa actividad, con un enlace a cada pendiente.
import nodemailer from 'nodemailer';

const ESTADOS = { pendiente: 'Por hacer', haciendo: 'Haciendo', hecho: 'Hecho' };
// "Favio", "Favio y Kenny", "Favio, Kenny y Junior".
const unir = (nombres = []) => new Intl.ListFormat('es', { type: 'conjunction' }).format(nombres);

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
    case 'aprobado':
      return `aprobó ${titulo}`;
    case 'aprobacion_quitada':
      return `quitó su aprobación de ${titulo}`;
    case 'rebotado':
      return `rebotó ${titulo} a Haciendo`;
    case 'revision':
      return datos.revisores_ids?.includes(yo) ? `te pidió revisar ${titulo}` : `le pidió revisar ${titulo} a ${unir(datos.revisores)}`;
    case 'revisado':
      return `revisó ${titulo}`;
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

// Los colores de cada caja destacada del correo.
const ROJO = { fondo: '#fef2f2', borde: '#fecaca', acento: '#dc2626', titulo: '#b91c1c', texto: '#991b1b', enlace: '#7f1d1d', cita: '#fca5a5' };
const AZUL = { fondo: '#eff6ff', borde: '#bfdbfe', acento: '#2563eb', titulo: '#1d4ed8', texto: '#1e40af', enlace: '#1e3a8a', cita: '#93c5fd' };

// El correo para `perfil` con sus `avisos` (actividad, de la más vieja a la más nueva), los pendientes a su cargo que
// rebotaron y todavía no abrió (`rebotados`: id, texto, por, nota, rebotado_en) y los que le pidieron revisar y todavía no
// abrió (`porRevisar`: id, texto, por, pedido_en): asunto, texto y HTML. Rebotados y pedidos van primero, cada uno en su
// caja; su aviso no se repite en la lista.
export function armarResumen({ perfil, avisos, rebotados = [], porRevisar = [], urlTablero, ahora = Date.now() }) {
  const enlace = (pendienteId) => pendienteId && `${urlTablero}?p=${pendienteId}`;
  const frase = (actividad) => `${actividad.autor ?? 'Alguien'} ${describir(actividad, perfil.id)}`;
  const enCaja = { rebotado: new Set(rebotados.map((item) => item.id)), revision: new Set(porRevisar.map((item) => item.id)) };
  const lista = avisos.filter((actividad) => !enCaja[actividad.tipo]?.has(actividad.pendiente_id));
  const mostrados = lista.slice(-MAX_EN_CORREO).reverse();
  const resto = lista.length - mostrados.length;
  const asunto = rebotados.length > 0
    ? rebotados.length === 1 ? `⚠️ Rebotaron «${rebotados[0].texto}» y todavía no lo abres` : `⚠️ Tienes ${rebotados.length} pendientes rebotados sin abrir`
    : porRevisar.length > 0
      ? porRevisar.length === 1 ? `🔍 ${porRevisar[0].por ?? 'Alguien'} te pidió revisar «${porRevisar[0].texto}»` : `🔍 Tienes ${porRevisar.length} pendientes por revisar`
      : lista.length === 1 ? frase(lista[0]) : `Tienes ${lista.length} avisos sin ver en Pendientes`;
  const cajas = [
    rebotados.length > 0 && {
      titulo: rebotados.length === 1 ? '⚠️ Rebotado sin abrir' : '⚠️ Rebotados sin abrir',
      explicacion: rebotados.length === 1
        ? 'Lo revisaron, no lo aprobaron y volvió a Haciendo. Ábrelo para ver qué falta:'
        : 'Los revisaron, no los aprobaron y volvieron a Haciendo. Ábrelos para ver qué falta:',
      colores: ROJO,
      items: rebotados.map((item) => ({ ...item, pie: `lo rebotó ${item.por ?? 'alguien'} ${haceCuanto(item.rebotado_en, ahora)}` })),
    },
    porRevisar.length > 0 && {
      titulo: '🔍 Te pidieron revisar',
      explicacion: porRevisar.length === 1
        ? 'Ábrelo y apruébalo, o recházalo con «Rebotar» si falta algo:'
        : 'Ábrelos y apruébalos, o recházalos con «Rebotar» si falta algo:',
      colores: AZUL,
      items: porRevisar.map((item) => ({ ...item, nota: null, pie: `te lo pidió ${item.por ?? 'alguien'} ${haceCuanto(item.pedido_en, ahora)}` })),
    },
  ].filter(Boolean);
  const introAvisos = lista.length === 1 ? 'Esto pasó en Pendientes y todavía no lo viste:' : 'Esto pasó en Pendientes y todavía no lo viste (lo más nuevo primero):';
  const repetidos = rebotados.length > 0 && porRevisar.length > 0
    ? 'Lo rebotado y lo que te pidieron revisar se repiten en cada resumen hasta que los abras.'
    : rebotados.length > 0 ? 'Lo rebotado se repite en cada resumen hasta que lo abras.'
      : porRevisar.length > 0 ? 'Lo que te pidieron revisar se repite en cada resumen hasta que lo abras.' : null;
  const pie = [
    'Este resumen llega a las 9 de la mañana, como mucho cada 2 días, con los avisos que no viste.',
    repetidos,
    'Para no recibir estos correos, apágalos en el menú de tu cuenta, en «Avisos por correo».',
  ].filter(Boolean).join(' ');

  const texto = [
    `Hola, ${perfil.nombre}:`,
    '',
    ...cajas.flatMap((caja) => [
      `${caja.titulo}. ${caja.explicacion}`,
      '',
      ...caja.items.flatMap((item) => [
        `• «${item.texto}», ${item.pie}`,
        ...(item.nota ? item.nota.split('\n').map((linea) => `  > ${linea}`) : []),
        ...(enlace(item.id) ? [`  ${enlace(item.id)}`] : []),
        '',
      ]),
    ]),
    ...(lista.length > 0 ? [introAvisos, ''] : []),
    ...mostrados.flatMap((actividad) => [
      `• ${frase(actividad)} (${haceCuanto(actividad.creado_en, ahora)})`,
      ...(detalleDe(actividad) ? detalleDe(actividad).split('\n').map((linea) => `  > ${linea}`) : []),
      ...(enlace(actividad.pendiente_id) ? [`  ${enlace(actividad.pendiente_id)}`] : []),
      '',
    ]),
    ...(resto > 0 ? [`Y ${resto === 1 ? 'un aviso más' : `${resto} avisos más`} en el tablero.`, ''] : []),
    `Abrir el tablero: ${urlTablero}`,
    '',
    '—',
    pie,
  ].join('\n');

  const cajaHtml = ({ titulo, explicacion, colores: c, items }) => `<tr><td style="padding:8px 0 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.fondo};border:1px solid ${c.borde};border-left:4px solid ${c.acento};border-radius:8px;padding:12px 14px">
      <tr><td style="font-size:16px;font-weight:700;color:${c.titulo}">${escapar(titulo)}</td></tr>
      <tr><td style="font-size:14px;color:${c.texto};padding:4px 0 8px">${escapar(explicacion)}</td></tr>
      ${items.map((item) => {
        const url = enlace(item.id);
        const nombre = url ? `<a href="${escapar(url)}" style="color:${c.enlace};text-decoration:none">«${escapar(item.texto)}»</a>` : `«${escapar(item.texto)}»`;
        return `<tr><td style="padding:8px 0;border-top:1px solid ${c.borde}">
        <div style="font-size:15px;line-height:1.4;font-weight:600">${nombre}</div>
        ${item.nota ? `<div style="margin-top:6px;padding-left:10px;border-left:3px solid ${c.cita};color:${c.enlace};font-size:14px;white-space:pre-line">${escapar(item.nota)}</div>` : ''}
        <div style="margin-top:4px;color:${c.texto};font-size:12px">${escapar(item.pie)}</div>
      </td></tr>`;
      }).join('')}
    </table>
  </td></tr>`;
  const filas = mostrados.map((actividad) => {
    const url = enlace(actividad.pendiente_id);
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
      <tr><td style="font-size:16px;padding-bottom:${cajas.length > 0 ? 12 : 4}px">Hola, ${escapar(perfil.nombre)}:</td></tr>
      ${cajas.map(cajaHtml).join('')}
      ${lista.length > 0 ? `<tr><td style="font-size:14px;color:#4b5563;padding-bottom:8px">${escapar(introAvisos)}</td></tr>` : ''}
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
