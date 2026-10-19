# Pendientes

Tablero de pendientes del equipo en `https://timer.practi.dev/pendientes/`. App aparte del timer: no comparte código ni estilos con `timer-app`.

- Plantilla: [shadcn/ui](https://ui.shadcn.com) (preset Nova, Radix) + [Kibo UI Kanban](https://www.kibo-ui.com/components/kanban), ambas MIT.
- `src/components/kibo-ui/kanban` es el componente de Kibo copiado al proyecto; los cambios locales son los umbrales de arrastre, los textos en español y que `KanbanBoard` acepta `style` (cada columna se tiñe con su color vía `--tono`).
- Del tablero: campo con ícono (`InputGroup`), selector de proyecto que también crea (`Combobox` = `Popover` + `Command`), columnas vacías con `Empty` y dibujos propios (`ilustraciones.tsx`), menú de columna con "Agregar pendiente aquí" y "Borrar los hechos" (`AlertDialog`).
- Al tocar una tarjeta se abre su detalle (`detalle-pendiente.tsx`) con la descripción en [BlockNote](https://www.blocknotejs.org) (MPL-2.0, variante shadcn): bloques con `/`, imágenes pegadas, arrastradas o subidas. El editor se carga aparte para que el tablero no lo espere.
- Proyectos dentro de organizaciones (`proyectos-dialog.tsx`): el selector los agrupa por organización y crea nuevos dentro de la que se elija; los filtros van por organización y luego por proyecto.
- Los datos viven en `../pendientes-api`: SQLite en `DATA_DIR/pendientes.db` y las imágenes en `DATA_DIR/imagenes/` (solo PNG, JPG, GIF y WebP, hasta 10 MB; se leen con la misma contraseña).

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
