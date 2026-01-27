# Timer App

Aplicación de temporizador construida con React + Vite y Tailwind CSS.

## Requisitos Previos

Antes de instalar y ejecutar la aplicación, asegúrate de tener instalado:

- [Node.js](https://nodejs.org/) (versión 18 o superior)
- [npm](https://www.npmjs.com/) (incluido con Node.js) o [yarn](https://yarnpkg.com/)

## Instalación

1. **Clona o descarga el repositorio** (si aún no lo has hecho)

2. **Navega al directorio del proyecto:**
   ```bash
   cd timer-app
   ```

3. **Instala las dependencias:**
   ```bash
   npm install
   ```
   
   O si prefieres usar yarn:
   ```bash
   yarn install
   ```

## Ejecutar la Aplicación

Para iniciar el servidor de desarrollo:

```bash
npm run dev
```

O con yarn:

```bash
yarn dev
```

La aplicación estará disponible en `http://localhost:5173` (o el puerto que Vite asigne automáticamente).

## Construir para Producción

Para crear una versión optimizada para producción:

```bash
npm run build
```

Los archivos compilados se generarán en la carpeta `dist/`.

Para previsualizar la versión de producción:

```bash
npm run preview
```

## Scripts Disponibles

- `npm run dev` - Inicia el servidor de desarrollo
- `npm run build` - Construye la aplicación para producción
- `npm run preview` - Previsualiza la versión de producción
- `npm run lint` - Ejecuta el linter ESLint

## Tecnologías Utilizadas

- React 19
- Vite
- Tailwind CSS
- ESLint
