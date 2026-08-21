/**
 * ANTICIPO dentro del recibo: el subelemento del excedente y DÓNDE va en la query bulk.
 *
 * El anticipo se carga como un MEDIO DE COBRO más —se elige del mismo selector—, pero en el recibo
 * no es un cobro: va del lado de lo que se cancela, con su propia etiqueta.
 *
 * El orden no es cosmético: el recibo se lee "qué se canceló · qué quedó a favor · con qué se pagó",
 * así que el anticipo cierra la columna del debe junto a las facturas en vez de mezclarse con los
 * medios de cobro. Un `create_subitem` mal ubicado no falla —Monday los crea igual—, sólo deja el
 * recibo ilegible, que es exactamente el tipo de error que ningún otro control atrapa.
 *
 * Se corre con esbuild + node (`npm run test:anticipo-subitem`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { SIN_DESCUENTOS_PAGO, balancePagos } from '@/lib/cobros'
import { registrarCobro, ReciboDesbalanceado } from '@/services/monday/cobrar'
import { CAJA_INDEX, COL } from '@/services/monday/columns'
import type { MovimientoPago } from '@/types'

interface Llamada {
  query: string
  variables: Record<string, unknown>
}
let llamadas: Llamada[] = []

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

/* Una venta partida en DOS comprobantes (mercadería común + consignada) por 10.000, cobrada con
   12.500 en efectivo: sobran 2.500 que el usuario decide dejar a favor del cliente. */
const FACTURAS = [
  { facturaId: '501', importe: 6000 },
  { facturaId: '502', importe: 4000 },
]
/** Movimientos del cobro. El ANTICIPO se elige del MISMO selector que el efectivo o el cheque. */
const movs = (...ms: [string, number][]) =>
  balancePagos(
    ms.map(([formaPago, importe]) => ({ formaPago, importe }) as MovimientoPago),
    SIN_DESCUENTOS_PAGO,
  )

await registrarCobro({
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  totalVenta: 10000,
  totalCobrado: 12500,
  facturas: FACTURAS,
  balances: movs(['Efectivo', 12500], ['Anticipo', 2500]),
})

const sub = llamadas[1]
const nombre = (n: number) => sub.variables[`n${n}`]
const cols = (n: number) => JSON.parse(sub.variables[`c${n}`] as string) as Record<string, unknown>

assert.equal(sub.query.match(/create_subitem/g)?.length, 4, 'dos facturas + anticipo + movimiento')

/* ---------- El ORDEN: facturas, anticipo, movimientos ---------- */
assert.equal(nombre(0), 'Fact Cancelada', 'primero la factura común')
assert.equal(nombre(1), 'Fact Cancelada', 'después la consignada')
assert.equal(nombre(2), 'Anticipo', 'el anticipo va DESPUÉS de las facturas…')
assert.equal(nombre(3), 'Efectivo', '…y ANTES de los medios de cobro')

/* ---------- El subelemento del anticipo ---------- */
const ant = cols(2)
/* Etiqueta de sistema: va por ÍNDICE. "Anticipo" es el 11 en este board y no se puede crear al
   vuelo, así que mandarla por texto sería atarse a un rótulo que se renombra desde Monday. */
assert.deepEqual(ant[COL.cobroSub.formaPago], { index: CAJA_INDEX.anticipo }, 'la etiqueta Anticipo')
assert.equal(CAJA_INDEX.anticipo, 11, 'que es el índice 11')
assert.equal(ant[COL.cobroSub.importeCancelado], '2500', 'y el importe del anticipo')
/* No se imputa a ningún comprobante: es plata que todavía no tiene factura a la que aplicarse. */
assert.ok(!(COL.cobroSub.factCancelada in ant), 'el anticipo no linkea ninguna factura')

/* ---------- Sin anticipo, el recibo no lleva ese subelemento ---------- */
llamadas = []
await registrarCobro({
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  totalVenta: 10000,
  totalCobrado: 10000,
  facturas: FACTURAS,
  balances: movs(['Efectivo', 10000]),
})
assert.equal(llamadas[1].query.match(/create_subitem/g)?.length, 3, 'dos facturas + un movimiento')
assert.ok(
  ![0, 1, 2].some((n) => llamadas[1].variables[`n${n}`] === 'Anticipo'),
  'sin excedente no hay nada que dejar a favor',
)

/* ---------- La validación ESTRICTA: con anticipo, el recibo cierra o no se escribe ----------
   El anticipo existe para absorber la diferencia; si después de sumarlo sigue sin cerrar, el
   importe está mal y asentarlo dejaría descuadrado el saldo del cliente. */
llamadas = []
await assert.rejects(
  registrarCobro({
    clienteId: '111',
    nombreCliente: 'AGRO LUCIA S.A.',
    totalVenta: 10000,
    totalCobrado: 12500,
    facturas: FACTURAS,
    // 2.000 no alcanza: 10.000 + 2.000 ≠ 12.500.
    balances: movs(['Efectivo', 12500], ['Anticipo', 2000]),
  }),
  ReciboDesbalanceado,
  'un anticipo que no cuadra frena el recibo',
)
assert.equal(llamadas.length, 0, 'y NO se escribe nada en Monday: se valida antes de crear el ítem')

console.log('OK · el anticipo entra al recibo entre las facturas y los cobros, y sólo si cierra')
