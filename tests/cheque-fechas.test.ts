/**
 * Las DOS fechas del cheque: la de PAGO, que se carga, y la de VENCIMIENTO, que sale de ella.
 *
 * El vendedor completa una sola. El vencimiento es fecha de pago + `DIAS_VIGENCIA_CHEQUE`, se
 * muestra de sólo lectura y NO se guarda en el movimiento: se recalcula donde haga falta. Esa
 * decisión es la que este test protege, porque es la que puede romperse en silencio de dos formas
 * distintas y ninguna de las dos falla en pantalla:
 *
 * 1) El recibo. Son dos columnas de fecha DISTINTAS del mismo subelemento ("🤖Fecha Pago" y
 *    "🤖Fecha Venc"), y mandar la misma fecha en las dos —o cruzarlas— produce un recibo que se
 *    crea perfecto y dice cualquier cosa. Peor: escribir una columna que no existe hace que Monday
 *    rechace la mutación ENTERA, así que el subelemento del cheque no se crearía en absoluto (ya
 *    pasó con las dos columnas del nro de comprobante).
 *
 * 2) El campo derivado. Si alguien lo volviera editable o lo guardara en el borrador, las dos
 *    fechas podrían separarse —una leída del cheque, la otra tipeada— y el plazo del recibo dejaría
 *    de salir de la fecha de pago.
 *
 * Se corre con esbuild + node (`npm run test:cheque-fechas`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DIAS_VIGENCIA_CHEQUE, SIN_DESCUENTOS_PAGO, balancePagos, vencimientoCheque } from '@/lib/cobros'
import { formatDate } from '@/lib/dates'
import { registrarCobro } from '@/services/monday/cobrar'
import { COL } from '@/services/monday/columns'
import type { MovimientoPago } from '@/types'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}
const llamadas: Llamada[] = []

globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const l = JSON.parse(init.body) as Llamada
  llamadas.push(l)
  const alias = [...l.query.matchAll(/(m\d+): create_subitem/g)].map((m) => m[1])
  return {
    ok: true,
    json: async () => ({
      data: alias.length
        ? Object.fromEntries(alias.map((a, i) => [a, { id: `${900 + i}` }]))
        : { create_item: { id: '123' } },
    }),
  }
}) as unknown as typeof fetch

const diaRelativo = (dias: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return formatDate(d)
}
/* La fecha de pago del único cheque que la operación acepta: la de HOY, que es lo que lo vuelve un
   pago de contado. El vencimiento cae 30 días después, así que son dos días distintos —que es lo
   que deja ver si las columnas se cruzaron o si se mandó la misma fecha en las dos—. */
const FECHA_PAGO = diaRelativo(0)
const VENC_ESPERADO = diaRelativo(DIAS_VIGENCIA_CHEQUE)

assert.equal(vencimientoCheque(FECHA_PAGO), VENC_ESPERADO, 'el vencimiento es pago + vigencia')

const cheque = {
  formaPago: 'Cheque',
  importe: 10000,
  chequeFechaPago: FECHA_PAGO,
  numeroCheque: '00123456',
  fechaEmisionCheque: diaRelativo(-2),
  bancoEmisor: 'Banco Galicia',
  cuitEmisor: '20-45037195-6',
} as MovimientoPago

await registrarCobro({
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  totalVenta: 10000,
  facturas: [{ facturaId: '501', importe: 10000 }],
  balances: balancePagos([cheque], SIN_DESCUENTOS_PAGO),
})

/* ---------- 1) Las dos fechas viajan a DOS columnas distintas ---------- */
const sub = llamadas[1]
const cols = (n: number) => JSON.parse(sub.variables[`c${n}`] as string) as Record<string, unknown>
/* El subelemento 0 es la factura cancelada; el 1, el movimiento del cheque. */
assert.equal(sub.variables.n1, 'Cheque', 'el segundo subelemento es el movimiento del cheque')
const mov = cols(1)

const iso = (ddmmaaaa: string) => ddmmaaaa.split('/').reverse().join('-')

assert.equal(COL.cobroSub.fechaPago, 'date_mm6v7nvg', '"🤖Fecha Pago" del board de subelementos')
assert.equal(COL.cobroSub.vencimiento, 'date_mm5y4zxa', 'y "🤖Fecha Venc"')
assert.notEqual(COL.cobroSub.fechaPago, COL.cobroSub.vencimiento, 'son dos columnas distintas')

assert.deepEqual(
  mov[COL.cobroSub.fechaPago],
  { date: iso(FECHA_PAGO) },
  'la fecha de PAGO es la que se cargó',
)
assert.deepEqual(
  mov[COL.cobroSub.vencimiento],
  { date: iso(VENC_ESPERADO) },
  'y el VENCIMIENTO es el calculado, no la misma fecha repetida',
)

/* ---------- 2) El vencimiento NO se guarda en el movimiento ----------
   No alcanza con que hoy se calcule bien: lo que lo mantiene atado a la fecha de pago es que no
   exista un segundo lugar donde vivir. */
assert.ok(
  !('chequeVencimiento' in cheque),
  'el movimiento no lleva un vencimiento propio: es derivado',
)

/* ---------- 3) En pantalla el vencimiento es de SÓLO LECTURA ----------
   Se afirma sobre el formulario porque es la única forma de ver que el campo no se puede tocar:
   renderizado no hay con qué intentar escribirlo, y un `onChange` agregado sin querer lo volvería
   editable sin romper nada más. */
const form = readFileSync('src/features/cobro/FormularioCobro.tsx', 'utf8')
const campoVenc = form.slice(form.indexOf('id="cobro-cheque-venc"'))
const cierre = campoVenc.indexOf('/>')
assert.ok(cierre > 0, 'el campo del vencimiento sigue existiendo en el formulario')
const attrs = campoVenc.slice(0, cierre)
assert.ok(attrs.includes('readOnly'), 'el vencimiento se muestra, no se carga')
assert.ok(!attrs.includes('onChange'), 'y nada lo puede escribir desde el campo')
assert.ok(
  attrs.includes('value={vencCheque}'),
  'su valor sale del cálculo, no de un campo del borrador',
)

console.log(
  `OK · el cheque manda sus dos fechas a dos columnas (pago y pago + ${DIAS_VIGENCIA_CHEQUE} días)`,
)
