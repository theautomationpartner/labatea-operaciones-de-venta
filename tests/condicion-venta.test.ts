/**
 * La "Condición de Venta" del comprobante la decide la FORMA DE PAGO de la operación.
 *
 * Salía de `cliente.condicionPago` —la condición PACTADA en el CRM—, y por eso una venta cobrada al
 * contado a un cliente de cuenta corriente emitía un comprobante que declaraba "Cuenta Corriente"
 * con vencimiento el mismo día de la emisión y un recibo que ya la cancelaba. Pasó en las tres
 * ventas al contado y en las dos VENTA PROFORMA de la corrida de QA contra los clientes 7000 y 7001,
 * que tienen "CUENTA CORRIENTE" en la ficha.
 *
 * La condición pactada define QUÉ formas de pago se le ofrecen al vendedor (`formasPagoDeCliente`);
 * no cómo se declara la venta que terminó eligiendo.
 *
 * Se corre con esbuild + node (`npm run test:condicion-venta`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { tipoPagoOperacion } from '@/lib/cobros'
import { COL, FACT_CONDICION_VENTA } from '@/services/monday/columns'
import { crearComprobantes } from '@/services/monday/facturacion'
import type { ComprobanteAGenerar } from '@/lib/facturacion'
import type { Cliente, FormaPagoVenta, Operacion } from '@/types'

/** El cliente de la prueba tiene CUENTA CORRIENTE pactada: es el dato que ANTES mandaba. */
const CLIENTE = {
  id: '12524661079',
  name: '7001 - La Batea S.A TEST',
  cuit: '30-70906788-1',
  status: 'Responsable Inscripto',
  condicionPago: 'CUENTA CORRIENTE',
} as Cliente

const COMPROBANTE = {
  clave: 'COMUN',
  tipo: 'COMUN',
  proveedorId: null,
  proveedorNombre: null,
  titulo: 'Mercadería común',
  lineas: [
    {
      productoId: '1',
      nombre: 'PRODUCTO',
      cantidad: 1,
      precioUnitario: 1000,
      descuento: 0,
      rentabilidad: 30,
      iva: 21,
    },
  ],
  bruto: 1000,
  descuento: 0,
  subtotal: 1000,
  iva: 210,
  total: 1210,
} as ComprobanteAGenerar

/** Emite un comprobante y devuelve la "Condición de Venta" que viajó a Monday. */
async function condicionDeclarada(
  formaPago: FormaPagoVenta | null,
  operacion: Operacion,
): Promise<string> {
  let cv: Record<string, { labels: string[] }> = {}
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const l = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> }
    const data: Record<string, unknown> = {}
    if (l.query.includes('create_item')) {
      cv = JSON.parse(l.variables.cv0 as string)
      data.f0 = { id: '1' }
    }
    for (const a of l.query.matchAll(/(\w+): create_subitem/g)) data[a[1]] = { id: '2' }
    for (const a of l.query.matchAll(/(\w+): change_multiple_column_values/g)) data[a[1]] = { id: '1' }
    return { ok: true, status: 200, json: async () => ({ data }) }
  }) as unknown as typeof fetch

  await crearComprobantes([COMPROBANTE], {
    cliente: CLIENTE,
    moneda: 'Pesos (ARS)',
    tipoCambio: 0,
    letra: 'A',
    ivaReceptor: 'Responsable Inscripto',
    fechaEmision: '17/09/2026',
    diasVencimiento: 30,
    observaciones: '',
    formaPago,
    operacion,
  })
  return cv[COL.facturacion.condicionVenta]?.labels?.[0] ?? ''
}

/* ---------- La tabla completa ---------- */

const CASOS: [FormaPagoVenta | null, Operacion, string][] = [
  ['CONTADO', 'VENTA', FACT_CONDICION_VENTA.contado],
  ['TARJETA DE DEBITO', 'VENTA', FACT_CONDICION_VENTA.contado],
  ['TARJETA DE CREDITO', 'VENTA', FACT_CONDICION_VENTA.contado],
  ['CUENTA CORRIENTE', 'VENTA', FACT_CONDICION_VENTA.cuentaCorriente],
  // La VENTA PROFORMA no elige forma de pago: se cobra siempre en el acto.
  [null, 'VENTA PROFORMA', FACT_CONDICION_VENTA.contado],
]

for (const [formaPago, operacion, esperada] of CASOS) {
  const declarada = await condicionDeclarada(formaPago, operacion)
  assert.equal(
    declarada,
    esperada,
    `${formaPago ?? '(sin forma de pago)'} en ${operacion} → "${esperada}" (declaró "${declarada}")`,
  )
}

/* El cliente tiene CUENTA CORRIENTE pactada y aun así la venta al contado declara "Contado": es
   exactamente el caso que estaba mal. */
assert.equal(CLIENTE.condicionPago, 'CUENTA CORRIENTE', 'el cliente de la prueba opera a cuenta')
assert.equal(
  await condicionDeclarada('CONTADO', 'VENTA'),
  FACT_CONDICION_VENTA.contado,
  'la condición pactada del cliente ya NO decide la del comprobante',
)

/* Y sale de la MISMA regla que el "✋Tipo de Cobro" de la venta: si el tablero dice que la venta se
   cobró en el acto, el comprobante no puede declarar que se financió. */
for (const [formaPago, operacion, esperada] of CASOS) {
  const simultaneo = tipoPagoOperacion(formaPago, operacion) === 'SIMULTANEO'
  assert.equal(
    simultaneo,
    esperada === FACT_CONDICION_VENTA.contado,
    `${formaPago ?? 'proforma'}: la condición del comprobante y el tipo de cobro de la venta concuerdan`,
  )
}

console.log('OK · la Condición de Venta del comprobante sale de la forma de pago de la operación')
