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

const FUENTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const escapar = (texto) => String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Como mucho estos en el correo; del resto se dice cuántos hay.
const MAX_EN_CORREO = 20;

// Los colores de cada caja destacada del correo y el ícono de su círculo.
const ROJO = { fondo: '#fff1f2', borde: '#fecdd3', acento: '#dc2626', titulo: '#c81e1e', item: '#fde4e7', icono: 'alerta' };
const AZUL = { fondo: '#eff6ff', borde: '#bfdbfe', acento: '#2563eb', titulo: '#1d4ed8', item: '#dfeafe', icono: 'lupa' };

// "Mayugo › Vendeizi", o solo el proyecto si no está en una organización.
const ubicacionDe = ({ organizacion, proyecto } = {}) => [organizacion, proyecto].filter(Boolean).join(' › ') || null;

// La base del HTML (reset y ajustes para el celular) sale de Cerberus (https://github.com/emailmonday/Cerberus, MIT): tablas
// con estilos en línea, que se ven igual en Gmail, Outlook y Apple Mail.
const CABECERA = `<meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<!--[if mso]><style>* { font-family: sans-serif !important; }</style><![endif]-->
<style>
  :root { color-scheme: light; supported-color-schemes: light; }
  html, body { margin: 0 auto !important; padding: 0 !important; height: 100% !important; width: 100% !important; }
  * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; }
  div[style*="margin: 16px 0"] { margin: 0 !important; }
  #MessageViewBody, #MessageWebViewDiv { width: 100% !important; }
  table, td { mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; }
  table { border-spacing: 0 !important; border-collapse: separate !important; margin: 0 auto !important; }
  a { text-decoration: none; }
  img { -ms-interpolation-mode: bicubic; }
  a[x-apple-data-detectors], .unstyle-auto-detected-links a, .aBn { border-bottom: 0 !important; cursor: default !important; color: inherit !important;
    text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
  .im { color: inherit !important; }
  .a6S { display: none !important; opacity: 0.01 !important; }
  img.g-img + div { display: none !important; }
  @media screen and (max-width: 600px) {
    .email-container { padding: 12px 8px !important; }
    .solo-ancho { display: none !important; width: 0 !important; }
    .cabecera { padding: 18px 16px !important; }
    .cuerpo { padding: 22px 14px 24px !important; }
    .icono-caja { display: none !important; }
    .texto-caja { padding-left: 16px !important; }
    .hora { width: 74px !important; }
  }
</style>`;

// El correo para `perfil` con sus `avisos` (actividad, de la más vieja a la más nueva), los pendientes a su cargo que
// rebotaron y todavía no abrió (`rebotados`: id, texto, por, nota, rebotado_en) y los que le pidieron revisar y todavía no
// abrió (`porRevisar`: id, texto, por, pedido_en): asunto, texto y HTML. Todo puede traer la organización y el proyecto de
// su pendiente. Rebotados y pedidos van primero, cada uno en su caja; su aviso no se repite en la lista. Las imágenes
// (PNG, porque Gmail no muestra SVG; el SVG de al lado es su fuente) se publican con el tablero, en /pendientes/correo.
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
      titulo: rebotados.length === 1 ? 'Rebotado sin abrir' : 'Rebotados sin abrir',
      explicacion: rebotados.length === 1
        ? 'Lo revisaron, no lo aprobaron y volvió a Haciendo. Ábrelo para ver qué falta.'
        : 'Los revisaron, no los aprobaron y volvieron a Haciendo. Ábrelos para ver qué falta.',
      colores: ROJO,
      // Lo rebotado lleva debajo, en rojo y con el reloj, quién lo rebotó y cuándo.
      items: rebotados.map((item) => ({ ...item, debajo: `Lo rebotó ${item.por ?? 'alguien'} ${haceCuanto(item.rebotado_en, ahora)}` })),
    },
    porRevisar.length > 0 && {
      titulo: 'Te pidieron revisar',
      explicacion: porRevisar.length === 1
        ? 'Ábrelo y apruébalo, o recházalo con «Rebotar» si falta algo.'
        : 'Ábrelos y apruébalos, o recházalos con «Rebotar» si falta algo.',
      colores: AZUL,
      // Lo pedido lleva dentro de su recuadro quién lo pidió y cuándo.
      items: porRevisar.map((item) => ({ ...item, dentro: `Te lo pidió ${item.por ?? 'alguien'} ${haceCuanto(item.pedido_en, ahora)}` })),
    },
  ].filter(Boolean);
  const tituloLista = cajas.length > 0 ? 'Otras actividades relacionadas' : 'Lo que no viste';
  const repetidos = rebotados.length > 0 && porRevisar.length > 0
    ? 'Lo rebotado y lo que te pidieron revisar se repiten en cada resumen hasta que los abras.'
    : rebotados.length > 0 ? 'Lo rebotado se repite en cada resumen hasta que lo abras.'
      : porRevisar.length > 0 ? 'Lo que te pidieron revisar se repite en cada resumen hasta que lo abras.' : null;
  const lineasPie = [
    'Este resumen llega a las 9 de la mañana, como mucho cada 2 días, con los avisos que no viste.',
    repetidos,
  ].filter(Boolean);
  const apagar = ['Para no recibir estos correos, ', 'apágalos en tu cuenta, en «Avisos por correo»', '.'];
  // Lo que se ve en la bandeja junto al asunto: cuánto hay de cada cosa.
  const avance = [
    rebotados.length > 0 && `${rebotados.length} ${rebotados.length === 1 ? 'rebotado' : 'rebotados'} sin abrir`,
    porRevisar.length > 0 && `${porRevisar.length} por revisar`,
    lista.length > 0 && `${lista.length} ${lista.length === 1 ? 'aviso' : 'avisos'} sin ver`,
  ].filter(Boolean).join(' · ');

  const texto = [
    `Hola, ${perfil.nombre}:`,
    '',
    ...cajas.flatMap((caja) => [
      `${caja.titulo.toUpperCase()}. ${caja.explicacion}`,
      '',
      ...caja.items.flatMap((item) => [
        `• «${item.texto}»${ubicacionDe(item) ? ` (${ubicacionDe(item)})` : ''}`,
        ...(item.nota ? item.nota.split('\n').map((linea) => `  > ${linea}`) : []),
        ...[item.dentro, item.debajo].filter(Boolean).map((linea) => `  ${linea}`),
        ...(enlace(item.id) ? [`  ${enlace(item.id)}`] : []),
        '',
      ]),
    ]),
    ...(lista.length > 0 ? [`${tituloLista.toUpperCase()} (lo más nuevo primero)`, ''] : []),
    ...mostrados.flatMap((actividad) => [
      `• ${frase(actividad)} (${haceCuanto(actividad.creado_en, ahora)})`,
      ...(ubicacionDe(actividad) ? [`  ${ubicacionDe(actividad)}`] : []),
      ...(detalleDe(actividad) ? detalleDe(actividad).split('\n').map((linea) => `  > ${linea}`) : []),
      ...(enlace(actividad.pendiente_id) ? [`  ${enlace(actividad.pendiente_id)}`] : []),
      '',
    ]),
    ...(resto > 0 ? [`Y ${resto === 1 ? 'un aviso más' : `${resto} avisos más`} en el tablero.`, ''] : []),
    `Abrir el tablero: ${urlTablero}`,
    '',
    '—',
    [...lineasPie, apagar.join('')].join(' '),
  ].join('\n');

  const imagen = (nombre, ancho, alto, alt = '', estilo = 'display:block') =>
    `<img src="${escapar(new URL(`correo/${nombre}.png`, urlTablero).href)}" width="${ancho}" height="${alto}" alt="${escapar(alt)}" style="border:0;outline:none;${estilo}">`;
  const separador = (alto) => `<div style="height:${alto}px;line-height:${alto}px;font-size:1px">&nbsp;</div>`;
  const conEnlace = (url, contenido, color) => url ? `<a href="${escapar(url)}" style="color:${color};text-decoration:none">${contenido}</a>` : contenido;
  const ubicacionHtml = (item) => ubicacionDe(item)
    ? `<div style="font-size:12px;line-height:16px;font-weight:600;color:#64748b;padding-bottom:3px">${imagen('organizacion', 12, 12, '', 'display:inline-block;vertical-align:-1px;margin-right:5px')}${escapar(ubicacionDe(item))}</div>`
    : '';
  // «Diego» en negrita, y los títulos entre comillas también.
  const fraseHtml = (actividad) => `<strong>${escapar(actividad.autor ?? 'Alguien')}</strong> ${escapar(describir(actividad, perfil.id)).replace(/«([^»]*)»/g, '<strong>«$1»</strong>')}`;

  const cajaHtml = ({ titulo, explicacion, colores: c, items }) => `<tr><td style="padding:0 0 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.fondo};border:1px solid ${c.borde};border-left:4px solid ${c.acento};border-radius:10px">
      <tr>
        <td class="icono-caja" width="64" valign="top" style="width:64px;padding:20px 0 20px 16px">${imagen(c.icono, 48, 48)}</td>
        <td class="texto-caja" valign="top" style="padding:19px 18px 18px 14px;font-family:${FUENTE}">
          <div style="font-size:18px;line-height:24px;font-weight:700;color:${c.titulo}">${escapar(titulo)}</div>
          <div style="font-size:15px;line-height:22px;color:#1f2937;padding-top:4px">${escapar(explicacion)}</div>
          ${items.map((item) => `${separador(14)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.item};border-radius:8px">
            <tr>
              <td width="30" valign="top" style="width:30px;padding:16px 0 14px 16px">${imagen('carta', 18, 18)}</td>
              <td valign="top" style="padding:13px 16px 14px 12px;font-family:${FUENTE}">
                ${ubicacionHtml(item)}
                <div style="font-size:15px;line-height:21px;font-weight:700;color:#111827">${conEnlace(enlace(item.id), `«${escapar(item.texto)}»`, '#111827')}</div>
                ${[item.nota, item.dentro].filter(Boolean).map((linea) => `<div style="font-size:13.5px;line-height:20px;color:#4b5563;padding-top:2px;white-space:pre-line">${escapar(linea)}</div>`).join('')}
              </td>
            </tr>
          </table>
          ${item.debajo ? `<div style="font-size:13.5px;line-height:18px;color:${c.acento};padding-top:10px">${imagen('reloj', 14, 14, '', 'display:inline-block;vertical-align:-2px;margin-right:6px')}${escapar(item.debajo)}</div>` : ''}`).join('')}
        </td>
      </tr>
    </table>
  </td></tr>`;

  // La lista como una línea de tiempo: lo más nuevo con el check verde, lo demás con un punto, unidos por una línea.
  const filas = mostrados.map((actividad, indice) => {
    const ultima = indice === mostrados.length - 1;
    const linea = mostrados.length === 1 ? ''
      : `background-image:url(${new URL('correo/linea.png', urlTablero).href});background-repeat:no-repeat;background-size:2px ${
        indice === 0 ? '100%;background-position:center 25px' : ultima ? '25px;background-position:center top' : '100%;background-position:center top'};`;
    const detalle = detalleDe(actividad);
    return `<tr>
      <td width="36" valign="top" align="center" style="width:36px;padding-top:14px;${linea}">${imagen(indice === 0 ? 'hecho' : 'punto', 22, 22, '', 'display:block;margin:0 auto')}</td>
      <td valign="top" style="padding:12px 0 12px 8px;${ultima ? '' : 'border-bottom:1px solid #e5e7eb;'}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="top" style="font-family:${FUENTE};font-size:14.5px;line-height:21px;color:#111827">
            ${ubicacionHtml(actividad)}
            ${conEnlace(enlace(actividad.pendiente_id), fraseHtml(actividad), '#111827')}
            ${detalle ? `<div style="font-size:13.5px;line-height:20px;color:#4b5563;padding-top:2px;white-space:pre-line">${escapar(detalle)}</div>` : ''}
          </td>
          <td class="hora" width="96" valign="top" align="right" style="width:96px;padding-left:8px;font-family:${FUENTE};font-size:13px;line-height:21px;color:#6b7280;white-space:nowrap">${escapar(haceCuanto(actividad.creado_en, ahora))}</td>
        </tr></table>
      </td>
    </tr>`;
  }).join('');
  const listaHtml = lista.length === 0 ? '' : `<tr><td style="padding:0 0 22px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;background:#ffffff">
      <tr><td style="padding:16px 20px 4px 16px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="42" valign="middle" style="width:42px">${imagen('documento', 32, 32)}</td>
          <td valign="middle" style="font-family:${FUENTE};font-size:16px;line-height:22px;font-weight:700;color:#111827">${escapar(tituloLista)}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:2px 20px 8px 20px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
        ${resto > 0 ? `<div style="font-family:${FUENTE};font-size:13.5px;line-height:20px;color:#4b5563;padding:6px 0 4px 44px">Y ${resto === 1 ? 'un aviso más' : `${resto} avisos más`} en el tablero.</div>` : ''}
      </td></tr>
    </table>
  </td></tr>`;

  const html = `<!doctype html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>${CABECERA}<title>${escapar(asunto)}</title></head>
<body width="100%" style="margin:0;padding:0 !important;mso-line-height-rule:exactly;background-color:#eef2f7">
<center role="article" aria-roledescription="email" lang="es" style="width:100%;background-color:#eef2f7">
  <div style="max-height:0;overflow:hidden;mso-hide:all;display:none" aria-hidden="true">${escapar(avance)}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
  <div style="max-width:600px;margin:0 auto;padding:24px 12px" class="email-container">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:auto">
      <tr><td class="cabecera" bgcolor="#1d4ed8" style="background-color:#1d4ed8;background-image:linear-gradient(115deg,#1a45d4 0%,#2563eb 55%,#3b7cf7 100%);border-radius:16px 16px 0 0;padding:22px 26px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="84" valign="middle" style="width:84px">${imagen('robot', 72, 72, 'Pendientebot')}</td>
          <td valign="middle" style="font-family:${FUENTE}">
            <div style="font-size:26px;line-height:32px;font-weight:800;color:#ffffff">Pendientebot</div>
            <div style="font-size:14.5px;line-height:20px;color:#dbeafe;padding-top:2px">Te mantiene al día con tus pendientes</div>
          </td>
          <td class="solo-ancho" width="150" align="right" valign="middle" style="width:150px">${imagen('sobre', 140, 93, '', 'display:block;margin-left:auto')}</td>
        </tr></table>
      </td></tr>
      <tr><td class="cuerpo" bgcolor="#ffffff" style="background-color:#ffffff;border-radius:0 0 16px 16px;padding:26px 28px 28px;box-shadow:0 8px 24px rgba(15,23,42,.06)">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="font-family:${FUENTE};padding:0 0 18px">
            <div style="font-size:20px;line-height:26px;font-weight:700;color:#111827">Hola, ${escapar(perfil.nombre)}:</div>
            <div style="font-size:15px;line-height:22px;color:#4b5563;padding-top:4px">Este es un resumen de lo que pasó en tus pendientes:</div>
          </td></tr>
          ${cajas.map(cajaHtml).join('')}
          ${listaHtml}
          <tr><td align="center" style="padding:2px 0 24px">
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>
              <td bgcolor="#1d4ed8" style="background-color:#1d4ed8;border-radius:8px">
                <a href="${escapar(urlTablero)}" style="display:inline-block;padding:14px 30px;font-family:${FUENTE};font-size:17px;line-height:22px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${imagen('enlace', 20, 20, '', 'display:inline-block;vertical-align:-4px;margin-right:10px')}Abrir el tablero${imagen('flecha', 20, 20, '', 'display:inline-block;vertical-align:-4px;margin-left:10px')}</a>
              </td>
            </tr></table>
          </td></tr>
          <tr><td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;border-radius:10px">
              <tr>
                <td width="58" valign="top" style="width:58px;padding:16px 0 16px 18px">${imagen('foco', 40, 40)}</td>
                <td valign="middle" style="padding:14px 18px 14px 4px;font-family:${FUENTE};font-size:13px;line-height:20px;color:#4b5563">
                  ${lineasPie.map(escapar).join('<br>')}<br>${escapar(apagar[0])}<strong style="color:#374151">${escapar(apagar[1])}</strong>${escapar(apagar[2])}
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>
</center>
</body>
</html>`;
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
