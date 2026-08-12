/**
 * Subelemento de una RETENCIÓN en el recibo: además del medio y el importe recibido, declara el
 * certificado que la respalda (año y número de comprobante).
 *
 * Las dos columnas del board son NUMÉRICAS, así que lo que viaja son sólo los dígitos.
 *
 * Se corre contra el servicio real con `fetch` interceptado: lo que se verifica es exactamente el
 * payload que sale hacia Monday.
 *
 *   npm run test:retencion-subitem
 */
import assert from 'node:assert/strict'
import { SIN_DESCUENTOS_PAGO, balancePagos } from '@/lib/cobros'
import { registrarCobro } from '@/services/monday/cobrar'
import type { FormaPago, MovimientoPago } from '@/types'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}

const llamadas: Llamada[] = []

globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const { query, variables } = JSON.parse(init.body) as Llamada
  llamadas.push({ query, variables })
  const alias = [...query.matchAll(/(m\d+): create_subitem/g)].map((m) => m[1])
  const data = alias.length
    ? Object.fromEntries(alias.map((a, i) => [a, { id: `${900 + i}` }]))
    : { create_item: { id: '123' } }
  return { ok: true, json: async () => ({ data }) }
}) as unknown as typeof fetch

const retencion = (formaPago: FormaPago): MovimientoPago =>
  ({
    formaPago,
    importe: 5000,
    anioRetencion: '2026',
    // Con guiones y ceros a la izquierda: es lo que el vendedor puede llegar a tipear.
    nroComprobanteRetencion: '0001-00001234',
  }) as MovimientoPago

/* Las TRES retenciones del catálogo + una que no existe todavía: el ramal se resuelve por el
   prefijo del medio de cobro, así que la que se sume mañana tiene que entrar igual. */
const FORMAS = [
  'Retencion IVA',
  'Retencion IIBB',
  'Retencion GAN',
  'Retencion SUSS',
] as unknown as FormaPago[]

await registrarCobro({
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  totalVenta: 20000,
  totalCobrado: 20000,
  balances: balancePagos(FORMAS.map(retencion), SIN_DESCUENTOS_PAGO),
})

const sub = llamadas[1]
const cols = (n: number) => JSON.parse(sub.variables[`c${n}`] as string) as Record<string, unknown>

assert.equal(sub.query.match(/create_subitem/g)?.length, 4, 'un subelemento por retención')

FORMAS.forEach((forma, n) => {
  const cv = cols(n)
  assert.equal(sub.variables[`n${n}`], forma, `m${n} se nombra con su medio de cobro`)
  assert.equal(cv['numeric_mm64dwpx'], '2026', `${forma}: el año del certificado`)
  /* Columna numérica: los guiones no viajan y el valor se manda como dígitos corridos. Los ceros
     a la izquierda salen en el payload, pero los pierde la propia columna al guardar el número. */
  assert.equal(
    cv['numeric_mm64qm1'],
    '000100001234',
    `${forma}: el nro de comprobante, sólo dígitos`,
  )
  assert.equal(cv['numeric_mm63j1mv'], '5000', `${forma}: el importe recibido`)
  assert.ok(!('numeric_mm4e61yk' in cv), `${forma}: no cancela una factura`)
})

/* Sin certificado cargado las dos columnas se OMITEN: no se manda un numérico vacío. Y el resto
   de los medios de cobro no las toca nunca. */
llamadas.length = 0
await registrarCobro({
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  totalVenta: 2000,
  totalCobrado: 2000,
  balances: balancePagos(
    [
      { formaPago: 'Retencion IVA', importe: 1000 } as MovimientoPago,
      { formaPago: 'Efectivo', importe: 1000 } as MovimientoPago,
    ],
    SIN_DESCUENTOS_PAGO,
  ),
})
const sinCert = JSON.parse(llamadas[1].variables.c0 as string) as Record<string, unknown>
assert.ok(!('numeric_mm64dwpx' in sinCert), 'sin año la columna no viaja')
assert.ok(!('numeric_mm64qm1' in sinCert), 'sin número la columna no viaja')
const efectivo = JSON.parse(llamadas[1].variables.c1 as string) as Record<string, unknown>
assert.ok(!('numeric_mm64dwpx' in efectivo), 'el efectivo no declara certificado')
assert.ok(!('numeric_mm64qm1' in efectivo), 'el efectivo no declara certificado')

console.log('OK · certificado de retención en el subelemento del recibo')
