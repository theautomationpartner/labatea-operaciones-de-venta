import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Puerto fijo del proyecto: strictPort evita que Vite salte a otro si está ocupado.
  server: {
    port: 5180,
    strictPort: true,
    // Proxy hacia la API de Monday en desarrollo: evita CORS al pegar desde el navegador.
    proxy: {
      /* Subida de archivos a columnas `file`. Va ANTES de '/monday-api' porque Vite matchea por
         prefijo y '/monday-api-file' también empieza con '/monday-api'. */
      '/monday-api-file': {
        target: 'https://api.monday.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/monday-api-file/, '/v2/file'),
      },
      '/monday-api': {
        target: 'https://api.monday.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/monday-api/, '/v2'),
      },
      // Archivos del board (S3). El bucket no manda cabeceras CORS, así que sin este proxy
      // el navegador no puede leer los bytes del PDF para mostrarlo embebido.
      '/monday-files': {
        target: 'https://files-monday-com.s3.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/monday-files/, ''),
      },
    },
  },
})
