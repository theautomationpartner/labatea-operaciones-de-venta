/**
 * Los TRES totales de la cabecera del recibo dicen lo mismo que la pantalla y que sus subelementos.
 *
 * Este falló en producción: con la diferencia en $ 0,00 a la vista, "🤖TOTAL $ Diferencia"
 * (numeric_mm5xfznj) quedó asentada en −$ 328.377,16. La cabecera calculaba
 * `totalVenta - totalCobrado` con dos valores que le llegaban hechos y que IGNORABAN el anticipo,
 * así que el tablero decía que faltaba cobrar una plata que ya estaba cobrada y asignada.
 *
 * Nada lo atrapaba: la venta se emitía bien, el cobro se registraba bien y los subelementos salían
 * bien. Sólo estaba mal el número de la cabecera.
 *
 * La regla que se fija: los tres totales se DERIVAN de lo que el recibo declara —nunca se reciben
 * hechos— y cierran entre sí. Cancelado − Recibido = Diferencia, siempre.
 *
 * Se corre con esbuild + node (`npm run test:recibo-totales`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { SIN_DESCUENTOS_PAGO, balancePagos } from '@/lib/cobros'
import { ReciboDesbalanceado, registrarCobro } from '@/services/monday/cobrar'
import { COL } from '@/services/monday/columns'
import type { MovimientoPago } from '@/types'

let cabecera: Record<string, unknown> = {}
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const cuerpo = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> }
  if (cuerpo.query.includes('create_item')) {
    cabecera = JSON.parse(cuerpo.variables.cv as string) as Record<string, unknown>
  }
  const alias = [...cuerpo.query.matchAll(/(m\d+): create_subitem/g)].map((m) => m[1])
  return {
    ok: true,
    json: async () => ({
      data: alias.length
        ? Object.fromEntries(alias.map((a, i) => [a, { id: `${900 + i}` }]))
        : { create_item: { id: '123' }, change_multiple_column_values: { id: '123' } },
    }),
  }
}) as unknown as typeof fetch

const mov = (formaPago: string, importe: number) => ({ formaPago, importe }) as MovimientoPago
const VENTA = 271622.84

/** Registra el cobro y devuelve los tres totales de la cabecera, ya numéricos. */
async function totales(...ms: MovimientoPago[]) {
  await registrarCobro({
    clienteId: '111',
    nombreCliente: 'AGRO LUCIA S.A.',
    totalVenta: VENTA,
    facturas: [{ facturaId: '501', importe: VENTA }],
    balances: balancePagos(ms, SIN_DESCUENTOS_PAGO),
  })
  return {
    cancelado: Number(cabecera[COL.cobro.totalVenta]),
    recibido: Number(cabecera[COL.cobro.totalCobrado]),
    diferencia: Number(cabecera[COL.cobro.diferencia]),
  }
}

/* ---------- EL CASO QUE FALLÓ: cobró de más y el excedente quedó a favor ----------
   600.000 recibidos contra una venta de 271.622,84: sobran 328.377,16 que se asientan como
   anticipo. La diferencia REAL es cero, y eso es lo que tiene que quedar escrito. */
const conAnticipo = await totales(mov('Cheque', 600000), mov('Anticipo', 328377.16))
assert.equal(conAnticipo.diferencia, 0, 'con el anticipo cargado la diferencia es CERO, no el excedente')
assert.equal(conAnticipo.cancelado, 600000, 'lo cancelado incluye lo que queda a favor del cliente')
assert.equal(conAnticipo.recibido, 600000, 'y lo recibido es lo que entró por los medios de cobro')

/* ---------- Los otros dos escenarios ---------- */
const exacto = await totales(mov('Efectivo', VENTA))
assert.equal(exacto.diferencia, 0, 'cobrado justo: diferencia cero')
assert.equal(exacto.cancelado, VENTA)
assert.equal(exacto.recibido, VENTA)

const falta = await totales(mov('Efectivo', 200000))
assert.equal(falta.diferencia, 71622.84, 'falta cobrar: la diferencia queda POSITIVA')

/* ---------- La invariante ----------
   Los tres cierran entre sí en TODOS los casos. Es lo que garantiza que la cabecera no pueda
   contradecir ni a la pantalla ni a sus propios subelementos. */
for (const t of [conAnticipo, exacto, falta]) {
  assert.equal(
    Math.round((t.cancelado - t.recibido) * 100) / 100,
    t.diferencia,
    'Cancelado − Recibido tiene que dar exactamente la Diferencia asentada',
  )
}

/* ---------- Y el anticipo que no cuadra sigue sin escribirse ---------- */
await assert.rejects(
  registrarCobro({
    clienteId: '111',
    nombreCliente: 'AGRO LUCIA S.A.',
    totalVenta: VENTA,
    facturas: [{ facturaId: '501', importe: VENTA }],
    balances: balancePagos([mov('Cheque', 600000), mov('Anticipo', 100)], SIN_DESCUENTOS_PAGO),
  }),
  ReciboDesbalanceado,
  'un anticipo que no cierra la diferencia frena el recibo',
)

console.log('OK · los tres totales del recibo cierran entre sí y la diferencia es la real')
