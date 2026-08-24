/**
 * Carga cada función serverless con el MISMO modo que usa el deploy.
 *
 * Existe por dos fallos que llegaron a producción sin que nada los frenara antes:
 *  1. imports relativos sin extensión (`./_guard`), que en ESM no resuelven;
 *  2. propiedades de constructor (`constructor(readonly x: T)`), que el modo strip-only de Node
 *     no puede transformar.
 *
 * Los dos pasaban `npm run typecheck` y `npm run build` en verde. No es casualidad: `tsc` resuelve
 * con sus propias reglas y esbuild TRANSFORMA la sintaxis, así que ninguno de los dos ve el mundo
 * como lo ve el runtime. Vercel corre los `.ts` tal cual, borrando tipos y nada más.
 *
 * Por eso este chequeo no bundlea ni compila: importa los archivos como los va a importar Vercel.
 * Si un endpoint no puede ni cargarse, acá se ve; en producción se ve como un 500 sin explicación.
 *
 * Se corre con `npm run test:funciones`.
 */
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

/** Los archivos que Vercel publica como ruta: todo `api/**` menos los que empiezan con `_`. */
function entradas(dir) {
  const encontradas = []
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name)
    if (entrada.isDirectory()) encontradas.push(...entradas(ruta))
    else if (entrada.name.endsWith('.ts') && !entrada.name.startsWith('_')) encontradas.push(ruta)
  }
  return encontradas
}

const archivos = entradas('api')
let fallas = 0

for (const archivo of archivos) {
  try {
    await import(pathToFileURL(archivo).href)
    console.log(`  OK    ${archivo}`)
  } catch (e) {
    fallas++
    console.log(`  FALLA ${archivo}`)
    console.log(`        ${e.name}: ${e.message.split('\n')[0]}`)
  }
}

if (fallas > 0) {
  console.error(`\nfunciones: ${fallas} de ${archivos.length} no cargan. En producción son 500.`)
  process.exit(1)
}

console.log(`\nfunciones: OK · ${archivos.length} endpoints cargan con el modo del deploy`)
