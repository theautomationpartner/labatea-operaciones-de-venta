import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  /* Prefijo vacío para leer TAMBIÉN las variables sin `VITE_`. Se usan sólo acá, en el proceso de
     Vite: nada de esto entra en `import.meta.env`, así que no llega al navegador. */
  const env = loadEnv(mode, process.cwd(), '')

  /* Destino real del escenario de Make que lee los comprobantes. En producción lo resuelve
     `api/make-comprobantes.ts` con la misma variable; en desarrollo no hay funciones serverless, así
     que el proxy de Vite hace de servidor y la dirección queda igual de lejos del bundle.
     Sin configurar, la ruta no existe y la llamada da 404: el mismo faltante que en producción, y el
     aviso lo da la app. */
  const webhook = env.MAKE_WEBHOOK_COMPROBANTES?.trim()
  const proxyMake: Record<string, ProxyOptions> = webhook
    ? {
        '/make-comprobantes': {
          target: new URL(webhook).origin,
          changeOrigin: true,
          rewrite: () => new URL(webhook).pathname,
          /* El escenario tiene un módulo de IA leyendo el documento: los 30 s por defecto de
             http-proxy lo cortarían a mitad de camino. Acompaña al tope del cliente. */
          timeout: 120_000,
          proxyTimeout: 120_000,
        },
      }
    : {}

  return {
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
      ...proxyMake,
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
  }
})
