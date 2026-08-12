/**
 * Subelemento de una RETENCIÓN en el recibo: además del medio y el importe recibido, declara el
 * certificado que la respalda (año y número de comprobante).
 *
 * El número de comprobante va a "🤖Nro Comprobante" (text_mm654900), que es de TEXTO y COMPARTIDA
 * con el número de cheque: se manda tal cual se cargó, con guiones y ceros a la izquierda. El año
 * sí es numérico, así que de ahí viajan sólo los dígitos.
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
  /* Columna de TEXTO: el comprobante se guarda como lo tipeó el vendedor. Con la numérica anterior
     este mismo dato llegaba como "000100001234" y perdía el formato del certificado. */
  assert.equal(
    cv['text_mm654900'],
    '0001-00001234',
    `${forma}: el nro de comprobante, tal cual se cargó`,
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
assert.ok(!('text_mm654900' in sinCert), 'sin número la columna no viaja')
const efectivo = JSON.parse(llamadas[1].variables.c1 as string) as Record<string, unknown>
assert.ok(!('numeric_mm64dwpx' in efectivo), 'el efectivo no declara certificado')
assert.ok(!('text_mm654900' in efectivo), 'el efectivo no declara certificado')

/* ---------- "🤖Nro Comprobante" la comparten los TRES medios que traen un papel numerado ----------
   El certificado de la retención, el número del cheque y el cupón del posnet caen todos en la misma
   columna. Cada subelemento es de un solo medio, así que nunca compiten; lo que hay que sostener es
   que NINGUNO se desvíe a una columna propia, y que el número llegue tal cual se cargó (la columna
   es de texto: los guiones y los ceros a la izquierda sobreviven). */
llamadas.length = 0
await registrarCobro({
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  totalVenta: 13000,
  totalCobrado: 13000,
  balances: balancePagos(
    [
      { formaPago: 'Cheque', importe: 10000, numeroCheque: '00123456' } as MovimientoPago,
      {
        formaPago: 'Tarjeta de crédito',
        importe: 3000,
        numeroCupon: '0042-0007',
      } as MovimientoPago,
    ],
    SIN_DESCUENTOS_PAGO,
  ),
})
const compartida = (n: number) =>
  JSON.parse(llamadas[1].variables[`c${n}`] as string) as Record<string, unknown>

assert.equal(
  compartida(0)['text_mm654900'],
  '00123456',
  'el nro de cheque va a la columna compartida, con sus ceros a la izquierda',
)
assert.equal(
  compartida(1)['text_mm654900'],
  '0042-0007',
  'y el nro de cupón de la tarjeta también, con su guión',
)
/* La columna vieja del cupón sigue existiendo en el board pero ya no se escribe: si volviera a
   aparecer en el payload, el número quedaría partido en dos lugares distintos. */
assert.ok(
  !('text_mm5zs69e' in compartida(1)),
  'el cupón ya no se escribe además en su columna vieja',
)

console.log('OK · certificado de retención y "Nro Comprobante" compartido por cheque, tarjeta y retención')
