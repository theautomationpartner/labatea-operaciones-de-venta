/**
 * QA E2E · Arnés headless.
 *
 * Corre los MISMOS servicios que usa la UI (src/services/monday, src/lib) contra la cuenta real
 * de Monday, para simular a un vendedor usando la app. No es un test unitario: escribe en los
 * tableros de verdad y dispara los escenarios de Make.com, igual que la app en producción.
 *
 * El bundle se arma con esbuild definiendo `import.meta.env.DEV = true`, así que `sdk.ts` pega
 * contra el proxy `/monday-api`; acá se reescribe ese destino al endpoint real.
 */

const REAL = 'https://api.monday.com/v2'
const nativo = globalThis.fetch.bind(globalThis)

/** Cuántas solicitudes se le hicieron a Monday (para medir el costo de cada recorrido). */
export const contador = { llamadas: 0 }

globalThis.fetch = ((url: string, init?: RequestInit) => {
  let destino = String(url)
  if (destino.startsWith('/monday-api-file')) destino = `${REAL}/file`
  else if (destino.startsWith('/monday-api')) destino = REAL
  else if (destino.startsWith('/monday-files')) {
    destino = `https://files-monday-com.s3.amazonaws.com${destino.slice('/monday-files'.length)}`
  }
  if (destino.startsWith(REAL)) contador.llamadas++
  return nativo(destino, init)
}) as typeof fetch

/* ===== Registro del recorrido ===== */

export type Severidad = 'INFO' | 'OK' | 'WARN' | 'BUG'

export interface Hallazgo {
  severidad: Severidad
  caso: string
  titulo: string
  detalle: string
}

export const hallazgos: Hallazgo[] = []
let casoActual = '(sin caso)'

export const abrirCaso = (nombre: string) => {
  casoActual = nombre
  console.log(`\n${'='.repeat(78)}\nCASO ${nombre}\n${'='.repeat(78)}`)
}

export const paso = (texto: string) => console.log(`  · ${texto}`)

export const anotar = (severidad: Severidad, titulo: string, detalle: string) => {
  hallazgos.push({ severidad, caso: casoActual, titulo, detalle })
  const icono = { INFO: 'i', OK: '✓', WARN: '!', BUG: '✗' }[severidad]
  console.log(`  ${icono} [${severidad}] ${titulo}${detalle ? ` — ${detalle}` : ''}`)
}

/** Comprueba una expectativa y la deja anotada con el resultado. */
export const chequear = (ok: boolean, titulo: string, detalle = '', severidadFallo: Severidad = 'BUG') => {
  anotar(ok ? 'OK' : severidadFallo, titulo, detalle)
  return ok
}

export const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export const dinero = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Resumen final de todos los hallazgos. */
export function informe() {
  console.log(`\n\n${'#'.repeat(78)}\nINFORME QA\n${'#'.repeat(78)}`)
  const porSev = (s: Severidad) => hallazgos.filter((h) => h.severidad === s)
  console.log(`OK: ${porSev('OK').length} · WARN: ${porSev('WARN').length} · BUG: ${porSev('BUG').length}`)
  for (const s of ['BUG', 'WARN'] as Severidad[]) {
    const lista = porSev(s)
    if (lista.length === 0) continue
    console.log(`\n--- ${s} ---`)
    for (const h of lista) console.log(`[${h.caso}] ${h.titulo}\n    ${h.detalle}`)
  }
  console.log(`\nSolicitudes a Monday: ${contador.llamadas}`)
}
