# Pendientes

Tablero de pendientes del equipo en `https://timer.practi.dev/pendientes/`. App aparte del timer: no comparte código ni estilos con `timer-app`.

- Plantilla: [shadcn/ui](https://ui.shadcn.com) (preset Nova, Radix) + [Kibo UI Kanban](https://www.kibo-ui.com/components/kanban), ambas MIT.
- `src/components/kibo-ui/kanban` es el componente de Kibo copiado al proyecto; el único cambio local son los umbrales de arrastre y los textos en español.
- Al tocar una tarjeta se abre su detalle (`detalle-pendiente.tsx`) con la descripción en [BlockNote](https://www.blocknotejs.org) (MPL-2.0, variante shadcn): bloques con `/`, imágenes pegadas, arrastradas o subidas. El editor se carga aparte para que el tablero no lo espere.
- Los datos viven en `../pendientes-api`: SQLite en `DATA_DIR/pendientes.db` y las imágenes en `DATA_DIR/imagenes/` (solo PNG, JPG, GIF y WebP, hasta 10 MB; se leen con la misma contraseña).

## Desarrollo

```bash
# Terminal 1: API
cd ../pendientes-api && AUTH_PASSWORD=dev DATA_DIR=./data npm start

# Terminal 2: tablero (usuario "pendientes", contraseña "dev")
npm install && npm run dev   # http://localhost:5173/pendientes/
```
