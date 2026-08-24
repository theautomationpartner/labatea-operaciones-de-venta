/**
 * Compila las funciones serverless COMO LO HACE VERCEL y comprueba que cada una cargue.
 *
 * Existe por un fallo que llegó a producción y costó tres intentos entender: los imports relativos
 * de `api/` no resolvían y todas las funciones devolvían 500 antes de correr una línea.
 *
 * Lo que hace falta saber para que esto tenga sentido: **Vercel compila los `.ts` a `.js`** (en el
 * servidor quedan `monday.js` y su sourcemap, no `monday.ts`). O sea que en ESM el import tiene que
 * escribirse con la extensión del ARCHIVO EMITIDO —`./_guard.js`, aunque el fuente sea `_guard.ts`—,
 * que es la forma canónica de TypeScript. Sin extensión no resuelve; con `.ts` tampoco, porque ese
 * archivo no existe en el servidor.
 *
 * Y por qué no alcanzaba con lo que ya había:
 *  · `npm run typecheck` usa `moduleResolution: bundler`, que perdona los imports sin extensión;
 *  · `npm run build` (Vite) ni mira `api/`;
 *  · los tests pasan por esbuild, que resuelve con sus propias reglas.
 * Ninguno de los tres ve lo que ve el deploy. Este sí: compila con `tsconfig.api.json`
 * (`module: nodenext`, que EXIGE la extensión) y después importa lo emitido.
 *
 * Se corre con `npm run test:funciones`.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SALIDA = 'node_modules/.cache/api-build'

console.log('Compilando api/ como lo hace Vercel…')
rmSync(SALIDA, { recursive: true, force: true })
try {
  // Se invoca el tsc local por ruta, sin shell: no hay nada que escapar ni que interpretar.
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.api.json'], {
    stdio: 'inherit',
  })
} catch {
  console.error('\nfunciones: la compilación falló. En producción son 500.')
  process.exit(1)
}

/** Lo que Vercel publica como ruta: todo `api/**` menos los que empiezan con `_`. */
function entradas(dir, base = dir) {
  const encontradas = []
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name)
    if (entrada.isDirectory()) encontradas.push(...entradas(ruta, base))
    else if (entrada.name.endsWith('.js') && !entrada.name.startsWith('_')) encontradas.push(ruta)
  }
  return encontradas
}

const archivos = entradas(SALIDA)
let fallas = 0

for (const archivo of archivos) {
  try {
    await import(pathToFileURL(resolve(archivo)).href)
    console.log(`  OK    ${archivo}`)
  } catch (e) {
    fallas++
    console.log(`  FALLA ${archivo}`)
    console.log(`        ${e.name}: ${String(e.message).split('\n')[0]}`)
  }
}

if (fallas > 0) {
  console.error(`\nfunciones: ${fallas} de ${archivos.length} no cargan. En producción son 500.`)
  process.exit(1)
}

console.log(`\nfunciones: OK · ${archivos.length} endpoints compilan y cargan como en el deploy`)
