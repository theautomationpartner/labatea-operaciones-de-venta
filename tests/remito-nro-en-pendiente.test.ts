/**
 * El subelemento de "Pends de Entrega" nace con el número del remito con el que salió la
 * mercadería, en "🤖Nro Remito" (text_mm6zv788).
 *
 * Ese número lo asigna el tablero cuando la emisión TERMINA, no al crear el remito. Es lo que fija
 * el orden que se verifica acá: leer → crear el subítem. Consultado antes vuelve vacío, y el
 * subítem quedaría sin número para siempre —no hay una segunda pasada que lo complete—.
 *
 * Tres cosas que ningún otro control mira:
 *
 *   1. Que la lectura ocurra DESPUÉS de que el remito esté emitido, no antes.
 *   2. Que el número viaje al `create_subitem` del pendiente, en su columna.
 *   3. Que un remito SIN número todavía no frene la conciliación: la entrega tiene que quedar
 *      registrada igual, porque si no, lo entregado no se descuenta de lo pendiente.
 *
 * Se corre con esbuild + node (`npm run test:remito-nro`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { afectarEntregaAnterior, leerNroRemito } from '@/services/monday/remitos'
import { BOARDS, COL } from '@/services/monday/columns'

const REMITO_ID = '12910314019'
const NRO_REMITO = '0002-00000451'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}
let llamadas: Llamada[] = []
let nroEnElTablero = NRO_REMITO

globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const l = JSON.parse(init.body) as Llamada
  llamadas.push(l)
  const data: Record<string, unknown> = {}
  // Metadata de columnas status (índices por label).
  if (l.query.includes('settings_str')) {
    data.boards = [{ columns: [{ settings_str: '{"labels":{"0":"RTO Entrega A Cliente"}}' }] }]
  }
  // Lectura del "🤖Nro Remito" del remito emitido.
  if (l.query.includes(COL.remito.nroRemito)) {
    data.items = [{ column_values: [{ id: COL.remito.nroRemito, text: nroEnElTablero }] }]
  }
  for (const a of l.query.matchAll(/(\w+): create_subitem/g)) data[a[1]] = { id: '1' }
  for (const a of l.query.matchAll(/(\w+): change_multiple_column_values/g)) data[a[1]] = { id: '1' }
  return { ok: true, json: async () => ({ data }) }
}) as unknown as typeof fetch

const lineas = [
  { cantidad: 3, nombre: 'PRODUCTO 1', pendienteEntregaId: '7001', ventaSubitemId: '8001' },
  { cantidad: 5, nombre: 'PRODUCTO 2', pendienteEntregaId: '7002', ventaSubitemId: '8002' },
]

/** Columnas de cada subelemento de PENDIENTE que salió en la corrida. */
const columnasDelPendiente = () => {
  const tanda = llamadas.find(
    (l) => l.query.includes('create_subitem') && String(l.variables.p0 ?? '').startsWith('700'),
  )
  assert.ok(tanda, 'no se crearon los subelementos del pendiente de entrega')
  return Object.entries(tanda!.variables)
    .filter(([k]) => k.startsWith('pcv'))
    .map(([, v]) => JSON.parse(v as string) as Record<string, unknown>)
}

assert.equal(COL.remito.nroRemito, 'text_mm6zr80p', '"🤖Nro Remito" del board de Remitos')
assert.equal(COL.pendienteEntregaSub.nroRemito, 'text_mm6zv788', 'y el del subelemento del pendiente')
assert.equal(BOARDS.pendientesEntrega, 18421035527, 'el board del pendiente de entrega')

/* ---------- 1) Con el remito ya emitido: se lee y baja al subítem ---------- */
const leido = await leerNroRemito(REMITO_ID)
assert.equal(leido, NRO_REMITO, 'se lee el número del remito emitido')

llamadas = []
await afectarEntregaAnterior(lineas, REMITO_ID, leido)
const conNro = columnasDelPendiente()
assert.equal(conNro.length, 2, 'un subelemento de historial por producto entregado')
for (const cv of conNro) {
  assert.equal(cv[COL.pendienteEntregaSub.nroRemito], NRO_REMITO, 'cada uno dice con qué remito salió')
  assert.ok(cv[COL.pendienteEntregaSub.cantRto], 'y sigue llevando la cantidad entregada')
}

/* ---------- 2) Sin número todavía: la entrega se registra IGUAL ----------
   Es lo que no puede romperse. Si la emisión tarda o falla, lo entregado tiene que descontarse de
   lo pendiente de todos modos; quedarse sin registrar sería mucho peor que quedarse sin el número. */
llamadas = []
await afectarEntregaAnterior(lineas, REMITO_ID, '')
const sinNro = columnasDelPendiente()
assert.equal(sinNro.length, 2, 'los subelementos se crean igual')
for (const cv of sinNro) {
  assert.ok(
    !(COL.pendienteEntregaSub.nroRemito in cv),
    'sin número no se manda la columna: en blanco dice la verdad',
  )
  assert.ok(cv[COL.pendienteEntregaSub.cantRto], 'pero la cantidad entregada se registra')
}

/* ---------- 3) El tablero todavía sin asignar el número ---------- */
nroEnElTablero = ''
assert.equal(await leerNroRemito(REMITO_ID), '', 'un remito sin número devuelve vacío, no un error')

/* ---------- 4) El ORDEN, en la vista ----------
   La lectura tiene que ir DESPUÉS de esperar el PDF —que es la señal de que la emisión terminó— y
   ANTES de la conciliación. Se afirma sobre el código de la vista porque el orden vive ahí, y
   moverlo no rompe el typecheck ni ningún otro test: simplemente el número deja de existir al
   momento de leerlo y todos los subítems nacen en blanco, en silencio. */
const vista = (await import('node:fs')).readFileSync(
  'src/features/remitir/RemitoEmisionView.tsx',
  'utf8',
)
const espera = vista.indexOf('await esperarRemitoPdf(')
const lectura = vista.indexOf('leerNroRemito(')
const concilia = vista.indexOf('afectarEntregaAnterior(')
assert.ok(espera > 0 && lectura > 0 && concilia > 0, 'las tres piezas siguen en la vista')
assert.ok(espera < lectura, 'el número se lee DESPUÉS de que la emisión termina')
assert.ok(lectura < concilia, 'y la conciliación corre DESPUÉS de tener el número')

console.log('OK · el subelemento del pendiente nace con el Nro de Remito del papel ya emitido')
