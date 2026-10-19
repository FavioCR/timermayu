# Pendientes

Tablero de pendientes del equipo en `https://timer.practi.dev/pendientes/`. App aparte del timer: no comparte código ni estilos con `timer-app`.

- Plantilla: [shadcn/ui](https://ui.shadcn.com) (preset Nova, Radix) + [Kibo UI Kanban](https://www.kibo-ui.com/components/kanban), ambas MIT.
- `src/components/kibo-ui/kanban` es el componente de Kibo copiado al proyecto; el único cambio local son los umbrales de arrastre y los textos en español.
- Los datos viven en `../pendientes-api`.

## Desarrollo

```bash
# Terminal 1: API
cd ../pendientes-api && AUTH_PASSWORD=dev DATA_DIR=./data npm start

# Terminal 2: tablero (usuario "pendientes", contraseña "dev")
npm install && npm run dev   # http://localhost:5173/pendientes/
```
