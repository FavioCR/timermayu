// Crear pendientes a partir de un texto con la IA que configure el equipo: Gemini, OpenAI u OpenRouter.
// Cada proveedor se llama con su API nativa pidiendo JSON con esquema (structured outputs):
// - Gemini: Interactions API, POST /v1beta/interactions con response_format (GA desde junio de 2026).
// - OpenAI: Responses API, POST /v1/responses con text.format json_schema en modo estricto.
// - OpenRouter: POST /api/v1/chat/completions con response_format json_schema (igual que OpenAI Chat Completions).

export const PROVEEDORES_IA = {
  gemini: { nombre: 'Gemini', modelo: 'gemini-3.5-flash-lite', url: 'https://generativelanguage.googleapis.com' },
  openai: { nombre: 'OpenAI', modelo: 'gpt-6-luna', url: 'https://api.openai.com' },
  openrouter: { nombre: 'OpenRouter', modelo: 'openai/gpt-6-luna', url: 'https://openrouter.ai' },
};

export const MAX_SUGERENCIAS = 30;
const ESPERA_MS = 60_000;
// Redactar es interactivo: mejor un error claro antes de que nginx corte la respuesta (a los 12 s).
const ESPERA_REDACCION_MS = 11_000;
const ESTADOS = ['pendiente', 'haciendo', 'hecho'];
const TIPOS = ['feat', 'fix', 'refactor', 'perf', 'docs', 'test', 'style', 'chore', 'ci'];
const MAX_TITULO = 500;
const MAX_DETALLE = 4000;
const MAX_DETALLE_ERROR = 300;

// Lo que tiene que devolver la IA. Cumple las reglas del modo estricto de OpenAI (todo requerido, sin propiedades
// extra, null para "no se sabe") y el JSON Schema que aceptan Gemini y OpenRouter.
export const ESQUEMA_PENDIENTES = {
  type: 'object',
  properties: {
    pendientes: {
      type: 'array',
      description: 'Las tareas concretas que salen del texto, en el orden en que aparecen.',
      items: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'Qué hay que hacer: corto, accionable, empieza con un verbo.' },
          detalle: { type: ['string', 'null'], description: 'Contexto útil del texto (fechas, enlaces, criterios) o null.' },
          responsable: { type: ['string', 'null'], description: 'Nombre exacto de una persona de la lista, o null.' },
          proyecto: { type: ['string', 'null'], description: 'Nombre exacto de un proyecto de la lista, o null.' },
          etiquetas: { type: 'array', items: { type: 'string' }, description: 'Nombres exactos de etiquetas de la lista que apliquen.' },
          // anyOf y no enum con null: Gemini solo acepta enum de textos.
          tipo: { anyOf: [{ type: 'string', enum: TIPOS }, { type: 'null' }], description: 'Tipo de trabajo como en los commits convencionales, o null.' },
          estado: { type: 'string', enum: ESTADOS },
          imagenes: { type: 'array', items: { type: 'integer' }, description: 'Números de las imágenes adjuntas que muestran esta tarea (1 es «Imagen 1»), o lista vacía.' },
        },
        required: ['titulo', 'detalle', 'responsable', 'proyecto', 'etiquetas', 'tipo', 'estado', 'imagenes'],
        additionalProperties: false,
      },
    },
  },
  required: ['pendientes'],
  additionalProperties: false,
};

// Para elegir solo el tipo de un pendiente que se creó sin tipo.
export const ESQUEMA_TIPO = {
  type: 'object',
  properties: {
    tipo: { anyOf: [{ type: 'string', enum: TIPOS }, { type: 'null' }], description: 'Tipo de trabajo como en los commits convencionales, o null.' },
  },
  required: ['tipo'],
  additionalProperties: false,
};

// Un borrador del chat o de la descripción, bien redactado.
export const ESQUEMA_REDACCION = {
  type: 'object',
  properties: {
    texto: { type: 'string', description: 'El texto final, listo para usar tal cual.' },
  },
  required: ['texto'],
  additionalProperties: false,
};

function iaError(status, codigo, detalle) {
  return Object.assign(new Error(codigo), { statusCode: status, ...(detalle && { detalle }) });
}

// Los mensajes de error de los proveedores a veces repiten parte de la clave: nunca salen tal cual.
function limpiar(mensaje, clave) {
  let texto = typeof mensaje === 'string' ? mensaje : JSON.stringify(mensaje ?? '');
  if (clave) texto = texto.split(clave).join('…');
  return texto.replace(/\b(sk-|AIza)[\w*.-]{4,}/g, '…').slice(0, MAX_DETALLE_ERROR);
}

export function instruccionesIA({ personas, proyectos, etiquetas, proyectoPorDefecto, extra, hoy }) {
  return [
    'Eres el asistente del tablero de pendientes de un equipo. Del texto que te pasan, saca las tareas concretas que alguien tiene que hacer y devuélvelas como pendientes.',
    '- Un pendiente por tarea. No repitas tareas ni inventes las que el texto no pide. Si no hay ninguna, devuelve la lista vacía.',
    '- titulo: corto y accionable, empieza con un verbo, en el idioma del texto (máximo 120 caracteres).',
    '- detalle: lo que haga falta para entenderla (fechas, enlaces, criterios de aceptación), o null si el título basta.',
    '- responsable: solo si el texto lo dice o es evidente; escribe exactamente uno de los nombres de "Personas", o null.',
    `- proyecto: escribe exactamente uno de los nombres de "Proyectos" si la tarea encaja ahí; si no, ${proyectoPorDefecto ? `"${proyectoPorDefecto}"` : 'null'}.`,
    '- etiquetas: solo nombres exactos de "Etiquetas" que el texto mencione o que claramente apliquen (un sprint, por ejemplo); si ninguna, lista vacía.',
    '- tipo: como en los commits convencionales: feat (algo nuevo), fix (corregir un error), refactor, perf, docs, test, style, chore (mantenimiento) o ci (despliegue); null si no es trabajo de software o no está claro.',
    '- estado: "pendiente", salvo que el texto diga que ya se está haciendo ("haciendo") o que ya está terminado ("hecho").',
    '- Si vienen imágenes (capturas de pantalla, fotos de una pizarra o de un papel, conversaciones), saca también de ellas las tareas; en el detalle anota lo que se ve que haga falta para entenderlas.',
    '- imagenes: los números de las imágenes (vienen como «Imagen 1», «Imagen 2»…) que muestran esa tarea, para adjuntarlas al pendiente; lista vacía si no hay imágenes o ninguna es de esa tarea.',
    `- ${MARCAS_DE_TIEMPO} Si el texto dice en qué minutos de una grabación (reunión, video, audio) se habla de la tarea, ponlos así en su detalle.`,
    `Hoy es ${hoy}.`,
    `Personas: ${personas.length ? personas.join(', ') : '(ninguna)'}`,
    `Proyectos: ${proyectos.length ? proyectos.join(' | ') : '(ninguno)'}`,
    `Etiquetas: ${etiquetas.length ? etiquetas.join(' | ') : '(ninguna)'}`,
    ...(extra ? ['Indicaciones del equipo (síguelas si no contradicen lo anterior):', extra] : []),
  ].join('\n');
}

export function instruccionesTipo({ extra }) {
  return [
    'Eres el asistente del tablero de pendientes de un equipo. Te pasan un pendiente que se creó sin tipo: elige su tipo de trabajo como en los commits convencionales.',
    '- feat: algo nuevo. fix: corregir un error. refactor: reordenar código sin cambiar lo que hace. perf: rendimiento. docs: documentación. test: pruebas. style: formato. chore: mantenimiento. ci: despliegue y automatización.',
    '- null si no es trabajo de software o no está claro.',
    ...(extra ? ['Indicaciones del equipo (síguelas si no contradicen lo anterior):', extra] : []),
  ].join('\n');
}

// Cómo se escriben las marcas de tiempo, que en la descripción se tocan para abrir el video o el audio en ese momento.
const MARCAS_DE_TIEMPO = 'Un momento de un video o audio se marca entre corchetes: [mm:ss], o un tramo [mm:ss–mm:ss] (con horas, [h:mm:ss]).';

export function instruccionesRedaccion({ donde, personas, pendiente, contexto, medios = [] }) {
  return [
    'Eres el asistente del tablero de pendientes de un equipo. Te pasan un borrador, o una indicación de lo que se quiere decir, y devuelves el texto bien redactado y listo para usar.',
    '- Escribe en el idioma del borrador, claro y directo, con buena ortografía. Conserva el sentido, los datos, los enlaces y los nombres; no agregues nada que el borrador no diga.',
    '- Si el borrador es una indicación ("dile a Junior que…", "anota los pasos para…"), escribe el texto final, no una explicación de lo que harías.',
    '- Para nombrar a alguien del equipo usa @ y su nombre exacto de "Personas" (por ejemplo @Junior): así le llega el aviso.',
    donde === 'chat'
      ? '- Es un mensaje del chat del pendiente: breve, en tono de conversación entre compañeros, texto plano sin Markdown.'
      : '- Es parte de la descripción del pendiente: usa Markdown sencillo (listas con -, pasos con 1., **negrita**) solo si ordena mejor la información; sin títulos salvo que el texto sea largo.',
    ...(donde === 'chat'
      ? []
      : [
          `- ${MARCAS_DE_TIEMPO} Al tocarla se abre el adjunto en ese momento. Si el pendiente tiene más de uno, agrega · y su nombre exacto: [00:51–02:04 · reunion.mp4]. Úsalas cuando el borrador hable de minutos o momentos de un video o audio, y conserva tal cual las que ya vengan.`,
        ]),
    `Pendiente: ${pendiente}`,
    ...contexto,
    ...(donde === 'chat' ? [] : [`Videos y audios adjuntos: ${medios.length ? medios.join(' | ') : '(ninguno todavía)'}`]),
    `Personas: ${personas.length ? personas.join(', ') : '(ninguna)'}`,
  ].join('\n');
}

// /ia en las notas privadas: apuntes de un curso, no un tablero de equipo (no hay personas que mencionar).
export function instruccionesApuntes({ curso, titulo, contexto }) {
  return [
    'Eres el asistente de los apuntes de estudio de una persona. Te pasan un borrador, o una indicación de lo que quiere anotar, y devuelves el texto bien redactado, listo para pegar en sus apuntes.',
    '- Escribe en el idioma del borrador, claro y ordenado, con buena ortografía. Conserva el sentido, los datos, las fórmulas, el código y los enlaces; no inventes datos.',
    '- Si el borrador es una indicación ("resume…", "explica…", "haz una lista de…"), escribe directamente el texto final, no una explicación de lo que harías. Si te piden explicar o dar ejemplos, agrega lo necesario, correcto y breve.',
    '- Usa Markdown sencillo (subtítulos con ##, listas con -, pasos con 1., **negrita**, `código`) cuando ordene mejor la información.',
    `Curso: ${curso}`,
    `Nota: ${titulo || '(sin título)'}`,
    ...(contexto ? [`La nota hasta ahora (el principio): ${contexto}`] : []),
  ].join('\n');
}

// Al reescribir lo que se seleccionó en el editor: solo el reemplazo de ese fragmento y, si viene, cómo reescribirlo.
export function indicacionesDeSeleccion({ seleccion, indicacion }) {
  return [
    ...(seleccion
      ? ['- El borrador es un fragmento que la persona seleccionó en su texto: devuelve solo lo que lo reemplaza, en la misma forma (si es parte de una frase o de un párrafo, sin saltos de línea ni Markdown; si son varias líneas o una lista, conserva esa forma).']
      : []),
    ...(indicacion ? [`- Reescríbelo siguiendo esta indicación de la persona: «${indicacion}».`] : []),
  ];
}

// Cada imagen va después de su rótulo («Imagen 1:»…), para que la IA diga cuáles son de cada pendiente.
const conRotulos = (imagenes, rotulo, parte) => imagenes.flatMap((imagen, i) => [rotulo(`Imagen ${i + 1}:`), parte(imagen)]);

const PEDIDOS = {
  gemini: ({ modelo, clave, sistema, texto, esquema, imagenes = [] }) => ({
    ruta: '/v1beta/interactions',
    headers: { 'x-goog-api-key': clave },
    body: {
      model: modelo,
      system_instruction: sistema,
      input: imagenes.length
        ? [
          { type: 'text', text: texto },
          ...conRotulos(imagenes, (text) => ({ type: 'text', text }), (imagen) => ({ type: 'image', data: imagen.datos, mime_type: imagen.tipo })),
        ]
        : texto,
      response_format: { type: 'text', mime_type: 'application/json', schema: esquema },
      store: false,
    },
    // La respuesta trae pasos; el texto del modelo está en los de tipo model_output.
    leer: (data) => {
      if (data.status === 'failed') throw iaError(502, 'ia_fallo', limpiar(data.errors ?? data.error, clave));
      return data.output_text ?? (data.steps ?? [])
        .filter((paso) => paso.type === 'model_output')
        .flatMap((paso) => paso.content ?? [])
        .filter((parte) => parte.type === 'text')
        .map((parte) => parte.text)
        .join('');
    },
  }),
  openai: ({ modelo, clave, sistema, texto, esquema, nombre, imagenes = [], esfuerzo }) => ({
    ruta: '/v1/responses',
    headers: { Authorization: `Bearer ${clave}` },
    body: {
      model: modelo,
      instructions: sistema,
      // Cuánto razona (solo los modelos que razonan lo aceptan).
      ...(esfuerzo && { reasoning: { effort: esfuerzo } }),
      input: imagenes.length
        ? [{
          role: 'user',
          content: [
            { type: 'input_text', text: texto },
            ...conRotulos(imagenes, (text) => ({ type: 'input_text', text }), (imagen) => ({ type: 'input_image', image_url: `data:${imagen.tipo};base64,${imagen.datos}` })),
          ],
        }]
        : texto,
      text: { format: { type: 'json_schema', name: nombre, schema: esquema, strict: true } },
      store: false,
    },
    // El JSON llega en output[] → message → content[] de tipo output_text; si el modelo se niega, viene un refusal.
    leer: (data) => {
      const partes = (data.output ?? []).filter((item) => item.type === 'message').flatMap((item) => item.content ?? []);
      const negativa = partes.find((parte) => parte.type === 'refusal');
      if (negativa) throw iaError(422, 'ia_se_nego', limpiar(negativa.refusal));
      if (data.status === 'incomplete') throw iaError(502, 'ia_incompleta', data.incomplete_details?.reason);
      return partes.filter((parte) => parte.type === 'output_text').map((parte) => parte.text).join('');
    },
  }),
  openrouter: ({ modelo, clave, sistema, texto, esquema, nombre, imagenes = [] }) => ({
    ruta: '/api/v1/chat/completions',
    // Opcionales: identifican la app en OpenRouter.
    headers: { Authorization: `Bearer ${clave}`, 'HTTP-Referer': 'https://timer.practi.dev/pendientes/', 'X-OpenRouter-Title': 'Pendientes' },
    body: {
      model: modelo,
      messages: [
        { role: 'system', content: sistema },
        // El texto va antes de las imágenes, como recomienda OpenRouter.
        {
          role: 'user',
          content: imagenes.length
            ? [
              { type: 'text', text: texto },
              ...conRotulos(imagenes, (text) => ({ type: 'text', text }), (imagen) => ({ type: 'image_url', image_url: { url: `data:${imagen.tipo};base64,${imagen.datos}` } })),
            ]
            : texto,
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: nombre, strict: true, schema: esquema } },
    },
    leer: (data) => {
      // OpenRouter puede responder 200 con el error del proveedor de fondo.
      if (data.error) throw iaError(502, 'ia_fallo', limpiar(data.error.message ?? data.error, clave));
      const mensaje = data.choices?.[0]?.message;
      if (mensaje?.refusal) throw iaError(422, 'ia_se_nego', limpiar(mensaje.refusal));
      const contenido = mensaje?.content;
      return Array.isArray(contenido) ? contenido.map((parte) => parte.text ?? '').join('') : contenido;
    },
  }),
};

function errorDelProveedor(status, data, clave) {
  const mensaje = limpiar(data?.error?.message ?? data?.error ?? '', clave);
  const crudo = JSON.stringify(data?.error ?? '');
  // OpenAI: el modelo no razona (gpt-4.1, gpt-4o…) y no acepta que se le diga cuánto.
  if (data?.error?.param === 'reasoning.effort') return iaError(400, 'ia_sin_esfuerzo', mensaje);
  if (status === 401 || status === 403 || /API_KEY_INVALID|invalid_api_key/.test(crudo)) return iaError(422, 'ia_clave_invalida');
  if (status === 402) return iaError(422, 'ia_sin_saldo', mensaje);
  if (/image|vision/i.test(mensaje) && /support|not allowed|no endpoints|unsupported|invalid/i.test(mensaje)) return iaError(422, 'ia_sin_imagenes', mensaje);
  if (status === 429) return iaError(429, 'ia_limite', mensaje);
  if (status === 404 || /model/i.test(mensaje) && /not found|does not exist|not a valid|invalid model|unknown/i.test(mensaje)) {
    return iaError(422, 'ia_modelo_invalido', mensaje);
  }
  return iaError(502, 'ia_fallo', mensaje || `HTTP ${status}`);
}

async function pedir(url, opciones, clave, espera = ESPERA_MS) {
  let respuesta;
  try {
    respuesta = await fetch(url, { ...opciones, signal: AbortSignal.timeout(espera) });
  } catch (error) {
    if (error.name === 'TimeoutError') throw iaError(504, 'ia_tardo');
    throw iaError(502, 'ia_sin_conexion');
  }
  const data = await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw errorDelProveedor(respuesta.status, data, clave);
  if (!data || typeof data !== 'object') throw iaError(502, 'ia_respuesta_invalida');
  return data;
}

function leerJson(texto) {
  if (typeof texto !== 'string' || !texto.trim()) throw iaError(502, 'ia_respuesta_invalida');
  try {
    return JSON.parse(texto);
  } catch {
    // Algún modelo de OpenRouter ignora el esquema y lo envuelve en ```json … ```.
    try {
      return JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
    } catch {
      throw iaError(502, 'ia_respuesta_invalida');
    }
  }
}

// Lo que devolvió la IA, ya revisado: títulos no vacíos, textos recortados y estados válidos.
export function leerPendientes(texto) {
  const datos = leerJson(texto);
  const lista = Array.isArray(datos) ? datos : datos?.pendientes;
  if (!Array.isArray(lista)) throw iaError(502, 'ia_respuesta_invalida');
  const textoO = (valor, maximo) => (typeof valor === 'string' && valor.trim() ? valor.trim().slice(0, maximo) : null);
  return lista.slice(0, MAX_SUGERENCIAS).flatMap((item) => {
    const titulo = textoO(item?.titulo, MAX_TITULO);
    if (!titulo) return [];
    return [{
      titulo,
      detalle: textoO(item.detalle, MAX_DETALLE),
      responsable: textoO(item.responsable, 200),
      proyecto: textoO(item.proyecto, 200),
      etiquetas: (Array.isArray(item.etiquetas) ? item.etiquetas : []).map((nombre) => textoO(nombre, 200)).filter(Boolean),
      tipo: TIPOS.includes(item.tipo) ? item.tipo : null,
      estado: ESTADOS.includes(item.estado) ? item.estado : 'pendiente',
      imagenes: [...new Set((Array.isArray(item.imagenes) ? item.imagenes : []).filter(Number.isInteger))],
    }];
  });
}

export function leerTipo(texto) {
  const { tipo } = leerJson(texto) ?? {};
  return TIPOS.includes(tipo) ? tipo : null;
}

export function leerRedaccion(texto, maximo) {
  const { texto: redactado } = leerJson(texto) ?? {};
  if (typeof redactado !== 'string' || !redactado.trim()) throw iaError(502, 'ia_respuesta_invalida');
  return redactado.trim().slice(0, maximo);
}

async function consultar({ proveedor, modelo, clave, base, sistema, texto, esquema, nombre, imagenes, espera, esfuerzo }) {
  const pedido = PEDIDOS[proveedor]({ modelo, clave, sistema, texto, esquema, nombre, imagenes, esfuerzo });
  const data = await pedir(`${base}${pedido.ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...pedido.headers },
    body: JSON.stringify(pedido.body),
  }, clave, espera);
  return pedido.leer(data);
}

export async function pedirPendientes(opciones) {
  return leerPendientes(await consultar({ ...opciones, esquema: ESQUEMA_PENDIENTES, nombre: 'pendientes' }));
}

// El tipo de un pendiente (feat, fix…) a partir de su título y su proyecto, o null.
export async function pedirTipo(opciones) {
  return leerTipo(await consultar({ ...opciones, esquema: ESQUEMA_TIPO, nombre: 'tipo' }));
}

// Los modelos de OpenAI que no aceptan cuánto razonar: se recuerdan para no volver a preguntar.
const sinEsfuerzo = new Set();

// El borrador bien redactado, hasta `maximo` caracteres. A OpenAI se le pide razonar poco: redactar no lo necesita y
// gpt-6-luna contesta en la mitad del tiempo (si el modelo no razona, se vuelve a pedir sin eso).
export async function pedirRedaccion({ maximo, ...opciones }) {
  const pedido = { ...opciones, esquema: ESQUEMA_REDACCION, nombre: 'redaccion', espera: ESPERA_REDACCION_MS };
  const conEsfuerzo = opciones.proveedor === 'openai' && !sinEsfuerzo.has(opciones.modelo);
  try {
    return leerRedaccion(await consultar(conEsfuerzo ? { ...pedido, esfuerzo: 'low' } : pedido), maximo);
  } catch (error) {
    if (!conEsfuerzo || error.message !== 'ia_sin_esfuerzo') throw error;
    sinEsfuerzo.add(opciones.modelo);
    return leerRedaccion(await consultar(pedido), maximo);
  }
}

// Los modelos de texto de cada proveedor, para elegir en la configuración. OpenRouter no pide clave para listarlos
// y se quedan solo los que aceptan JSON con esquema.
const SIN_TEXTO = /(embedding|tts|image|banana|live|audio|realtime|transcribe|robotics|omni|veo|lyria|moderation|search|aqa|whisper|dall-e|sora)/i;

export async function listarModelos({ proveedor, clave, base }) {
  if (proveedor === 'gemini') {
    const data = await pedir(`${base}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': clave } }, clave);
    return (data.models ?? [])
      .map((modelo) => ({ id: String(modelo.name ?? '').replace(/^models\//, ''), nombre: modelo.displayName ?? null }))
      .filter((modelo) => modelo.id.startsWith('gemini') && !SIN_TEXTO.test(modelo.id))
      .map((modelo) => ({ id: modelo.id, nombre: modelo.nombre ?? modelo.id }));
  }
  if (proveedor === 'openai') {
    const data = await pedir(`${base}/v1/models`, { headers: { Authorization: `Bearer ${clave}` } }, clave);
    return (data.data ?? [])
      .map((modelo) => String(modelo.id ?? ''))
      .filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !SIN_TEXTO.test(id))
      .sort((a, b) => b.localeCompare(a))
      .map((id) => ({ id, nombre: id }));
  }
  const data = await pedir(`${base}/api/v1/models`, { headers: clave ? { Authorization: `Bearer ${clave}` } : {} }, clave);
  return (data.data ?? [])
    .filter((modelo) => (modelo.supported_parameters ?? []).some((parametro) => parametro === 'structured_outputs' || parametro === 'response_format'))
    .map((modelo) => ({ id: String(modelo.id), nombre: modelo.name ?? String(modelo.id) }));
}
