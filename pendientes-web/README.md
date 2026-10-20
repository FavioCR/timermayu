# Pendientes

Tablero de pendientes del equipo en `https://timer.practi.dev/pendientes/`. App aparte del timer: no comparte código ni estilos con `timer-app`.

- Plantilla: [shadcn/ui](https://ui.shadcn.com) (preset Nova, Radix) + [Kibo UI Kanban](https://www.kibo-ui.com/components/kanban), ambas MIT.
- `src/components/kibo-ui/kanban` es el componente de Kibo copiado al proyecto; los cambios locales son los umbrales de arrastre, los textos en español y que `KanbanBoard` acepta `style` (cada columna se tiñe con su color vía `--tono`).
- Del tablero: campo con ícono (`InputGroup`), selector de proyecto que también crea (`Combobox` = `Popover` + `Command`), columnas vacías con `Empty` y dibujos propios (`ilustraciones.tsx`), menú de columna con "Agregar pendiente aquí" y "Borrar los hechos" (`AlertDialog`).
- Al tocar una tarjeta se abre su detalle (`detalle-pendiente.tsx`) con la descripción en [BlockNote](https://www.blocknotejs.org) (MPL-2.0, variante shadcn): bloques con `/`, imágenes pegadas, arrastradas o subidas, y archivos (PDF, Word…) en sus líneas con el bloque "Archivo" (`editor-descripcion.tsx`): se suben a los Archivos del pendiente y la línea los abre con la contraseña. El editor se carga aparte para que el tablero no lo espere.
- Proyectos dentro de organizaciones (`proyectos-dialog.tsx`): el selector los agrupa por organización y crea nuevos dentro de la que se elija; los filtros van por organización y luego por proyecto.
- Los filtros van de lo general a lo particular: organización, proyecto y persona. Organización y proyecto se comprimen en una línea "Organización › Proyecto" (`Collapsible`).
- Cada organización compartida tiene sus involucrados (`involucrados-menu.tsx`, también en Proyectos): son las personas que salen en el filtro y en el responsable cuando el proyecto es de esa organización. Una privada solo tiene a su dueño; una sin involucrados ofrece a todos.
- Al marcar filtros, el formulario de "Agregar" toma ese proyecto y esa persona. Filtros, campos y si está comprimido se guardan en `localStorage` (`pendientes.selecciones`) y siguen así al volver.
- Cada pendiente tiene al costado de su detalle un chat (`chat-pendiente.tsx`: al escribir `@` sugiere perfiles, la mención sale con la imagen de la persona y el mencionado recibe "te mencionó"; como en WhatsApp, un mensaje se responde con su botón o deslizándolo a la derecha en el celular, la respuesta lleva la cita y quien escribió el original recibe "te respondió") y su historial (`historial.tsx`). "Actividad" (`actividad-sheet.tsx`) muestra todo lo que pasó en el tablero.
- Archivos (`archivos.tsx`): cada pendiente tiene una fila "Archivos" y su chat un clip (también se pueden pegar o soltar). Cualquier archivo de hasta 10 MB. Se guardan en el disco del servidor, en `DATA_DIR/archivos/`, igual que las imágenes. Imágenes y PDF se abren en otra pestaña y lo demás se descarga; nada se ejecuta como página del sitio. Lo subido para un mensaje que no se envía se borra al día siguiente. En el chat las imágenes se achican como las de la descripción; en la fila "Archivos" se guarda el original.
- Un pendiente hecho se puede "Pasar a otra persona" (`pasar-dialog.tsx`, desde la tarjeta o el detalle): vuelve a Por hacer con el nuevo responsable y una nota opcional de lo que le toca, y conserva su historial, su chat y sus archivos.
- La campana (`notificaciones.tsx`, solo al entrar con un perfil) avisa lo que te asignan, los cambios en lo que tienes asignado o creaste, y los mensajes en los pendientes donde participas o te mencionan con @nombre. Se consulta cada 30 s; con la pestaña en segundo plano y permiso, avisa también con una notificación del navegador. Con la página cerrada no hay avisos (no hay service worker).
- Al crear un pendiente para otra persona sale un aviso (`sonner`) con un botón de WhatsApp, y el detalle tiene "Avisar por WhatsApp": abren `wa.me` con el mensaje y el enlace `?p=<id>` al pendiente. Con el teléfono guardado en Perfiles va directo a su chat; sin él, WhatsApp deja elegir a quién. El campo de WhatsApp (`ui/phone-input.tsx`, al estilo de shadcn-phone-input sobre [react-phone-number-input](https://gitlab.com/catamphetamine/react-phone-number-input), MIT) elige el país con bandera y buscador, Costa Rica por defecto, y revisa que el número sea de ese país. Perfiles se carga aparte porque trae las banderas.
- Los datos viven en `../pendientes-api`: SQLite en `DATA_DIR/pendientes.db` y las imágenes en `DATA_DIR/imagenes/` (solo PNG, JPG, GIF y WebP, hasta 10 MB; se leen con la misma contraseña). Antes de subir, el navegador achica las PNG y JPG (`lib/comprimir-imagen.ts`): lado mayor a 2000 px y WebP al 85 %; GIF y WebP van tal cual, y si el WebP no pesa menos se sube la original.

## Desarrollo

```bash
# Terminal 1: API
cd ../pendientes-api && AUTH_PASSWORD=dev DATA_DIR=./data npm start

# Terminal 2: tablero (cuenta del equipo: usuario "pendientes", contraseña "dev")
npm install && npm run dev   # http://localhost:5173/pendientes/
```

## Cuentas y privacidad

- Cada perfil entra con su nombre (o su correo, que es opcional) y su contraseña. La contraseña se guarda con scrypt; tras 10 intentos fallidos con un mismo usuario, ese usuario espera 15 minutos.
- La cuenta del equipo (`PENDIENTES_USER`/`PENDIENTES_PASSWORD` del `.env` del servidor) sirve para entrar la primera vez y ponerle contraseña a cada perfil. Solo ve lo compartido y lo que crea es del equipo.
- Mientras un perfil no tiene contraseña, cualquiera puede ponérsela o editarlo. Ya con contraseña, solo esa persona puede cambiarlo o quitarlo.
- Una organización privada, con sus proyectos y pendientes, solo la ve su dueño. Las compartidas las ve todo el equipo, y cualquiera agrega o mueve proyectos en ellas; solo su dueño la renombra, la borra o la vuelve privada. Los pendientes sin proyecto, o con un proyecto sin organización, los ve todo el equipo.
- Si alguien olvida su contraseña, se le quita en el servidor y la vuelve a poner desde Perfiles:

```bash
cd /root/projects/timermayu && docker compose exec pendientes_api node --disable-warning=ExperimentalWarning src/server.mjs quitar-contrasena Diego
```
