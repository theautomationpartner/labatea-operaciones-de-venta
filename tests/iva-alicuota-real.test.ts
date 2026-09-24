/**
 * El IVA se liquida SIEMPRE con la alícuota real del producto, nunca con un 21% plano.
 *
 * Pasó de verdad, y con plata: la venta DIRECTA calculaba su total con `neto × 1,21` mientras el
 * comprobante declaraba la alícuota de cada producto. Con un producto al 10,5% adentro, la venta
 * VTA-129 quedó registrada en $ 3.271.339,82 y sus dos facturas sumaban $ 3.022.084,61. Esos
 * $ 249.255,21 de diferencia son los que la app le exigió cobrar al vendedor —y los que el recibo
 * RECIBO-082 asentó como entrados a caja— sin ninguna factura detrás; la cabecera del recibo, encima,
 * declaraba diferencia CERO.
 *
 * La misma cuenta rige a la PROFORMA: la card de "Emitir Proforma" sumaba los dos descuentos en vez
 * de componerlos en cascada y liquidaba un 21% plano, así que el vendedor veía un total y se emitía
 * otro (PROFORMA-022: $ 275.113,82 en pantalla, $ 275.847,44 en el tablero y en el PDF del cliente).
 *
 * Se corre con esbuild + node (`npm run test:iva-alicuota`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { alicuotaDeclarada, descuentoUnitario, ivaLinea } from '@/lib/descuentos'
import { comprobantesDeVenta, totalesComprobantes } from '@/lib/facturacion'
import { trunc2 } from '@/lib/format'
import {
  resumenPresupuesto,
  resumenPresupuestoBimoneda,
  totalVentaOperacion,
} from '@/lib/selectors'
import { COL } from '@/services/monday/columns'
import { fragmentoSubitem } from '@/services/monday/carritoSubitems'
import { crearPresupuesto } from '@/services/monday/presupuestar'
import { crearProforma } from '@/services/monday/proformas'
import { crearVenta } from '@/services/monday/venta'
import type { LineaVenta } from '@/services/monday/venta'
import type { LineaPresupuesto, Producto } from '@/types'

/* ---------- 1) La alícuota declarada ---------- */

assert.equal(alicuotaDeclarada(10.5), 10.5, 'una tasa de AFIP se declara tal cual')
assert.equal(alicuotaDeclarada(21), 21)
assert.equal(alicuotaDeclarada(undefined), 21, 'sin dato, el 21% por defecto')
assert.equal(alicuotaDeclarada(0), 21, 'un 0 no cargado tampoco es una tasa: cae al default')
assert.equal(alicuotaDeclarada(11), 10.5, 'una tasa que no existe se resuelve a la más cercana')

/* ---------- 2) Venta DIRECTA: el total del documento == el total facturado ---------- */

const producto = (iva: number, precio: number): Producto =>
  ({
    id: `p-${iva}`,
    codigo: String(iva),
    nombre: `PRODUCTO ${iva}`,
    precio,
    precioSinIva: precio,
    rentabilidad: 30,
    provCod: '',
    provNombre: '',
    tipo: 'COM',
    iva,
    um: 'Unidad',
    ingresos: 0,
    egresos: 0,
    pendEntregaVta: 0,
    pendRecepcionCompra: 0,
    fisico: 0,
    comercial: 0,
    disponible: 0,
  }) as Producto

const linea = (p: Producto, cantidad: number, descuento = 0): LineaPresupuesto => ({
  id: `l-${p.codigo}`,
  producto: p,
  cantidad,
  descuento,
})

const P21 = producto(21, 76_478)
const P105 = producto(10.5, 2_525_382)
const LINEAS = [linea(P21, 2), linea(P105, 1, 4)]
const DESC_FP = 6

/* El resumen que ve el vendedor en "Seleccionar Productos" (ResumenBox). */
const resumen = resumenPresupuesto(LINEAS, true, DESC_FP)
const ivaEsperado = trunc2(
  LINEAS.reduce((acc, l) => {
    const bonif = descuentoUnitario(l.producto.precio, l.descuento, DESC_FP).total
    const neto = trunc2((l.producto.precio - bonif) * l.cantidad)
    return acc + ivaLinea(neto, alicuotaDeclarada(l.producto.iva))
  }, 0),
)
assert.equal(resumen.iva, ivaEsperado, 'el IVA del resumen es la suma del IVA de cada línea')
assert.notEqual(
  resumen.iva,
  trunc2(resumen.neto * 0.21),
  'y NO el 21% plano sobre el neto (si fueran iguales, el caso no prueba nada)',
)

/* El total de la operación (el que se escribe en "🤖Importe Total $", el que exige el cobro y el
   que viaja al recibo) contra el total de los comprobantes que efectivamente se emiten. */
const lineasVenta: LineaVenta[] = LINEAS.map((l) => ({
  productoId: l.producto.id,
  nombre: l.producto.nombre,
  cantidad: l.cantidad,
  precioUnitario: l.producto.precio,
  descuento: l.descuento,
  rentabilidad: l.producto.rentabilidad,
  tipoMercaderia: l.producto.tipo,
  iva: l.producto.iva,
}))

const totalVenta = totalVentaOperacion({
  cliente: null,
  operacion: 'VENTA',
  tipoVenta: 'DIRECTA',
  tipoEntrega: 'SIMULTANEA',
  lineas: LINEAS,
  ventaItems: [],
  facturaItems: [],
  proformaImporte: null,
  descFormaPago: DESC_FP,
}).total
const totalFacturado = totalesComprobantes(comprobantesDeVenta(lineasVenta, DESC_FP)).total

assert.equal(
  totalVenta,
  totalFacturado,
  `la venta DIRECTA se registra por lo mismo que facturan sus comprobantes (${totalVenta} vs ${totalFacturado})`,
)

/* ---------- 3) Proforma: lo que se ve es lo que se emite ---------- */

/* Los números de la card "Emitir Proforma" (CobroProforma), recalculados acá con las MISMAS
   funciones que usa la vista: cascada + alícuota declarada. */
const filasCard = lineasVenta.map((l) => {
  const bonifUnit = descuentoUnitario(l.precioUnitario, l.descuento, DESC_FP).total
  const totalLinea = trunc2((l.precioUnitario - bonifUnit) * l.cantidad)
  return { bonifUnit, totalLinea, iva: ivaLinea(totalLinea, alicuotaDeclarada(l.iva)) }
})
const netoCard = trunc2(filasCard.reduce((a, f) => a + f.totalLinea, 0))
const ivaCard = trunc2(filasCard.reduce((a, f) => a + f.iva, 0))
const totalCard = trunc2(netoCard + ivaCard)

/* Y lo que `crearProforma` manda a Monday, capturado del `fetch`. */
interface Llamada {
  query: string
  variables: Record<string, unknown>
}
let llamadas: Llamada[] = []
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const l = JSON.parse(init.body) as Llamada
  llamadas.push(l)
  const data: Record<string, unknown> = {}
  if (l.query.includes('create_item')) data.create_item = { id: '1' }
  if (l.query.includes('create_subitem')) data.create_subitem = { id: '2' }
  if (l.query.includes('settings_str')) {
    const meta = [{ columns: [{ settings_str: '{"labels":{}}' }] }]
    data.boards = meta
    data.item = meta
    data.sub = meta
  }
  for (const a of l.query.matchAll(/(\w+): create_subitem/g)) data[a[1]] = { id: '2' }
  for (const a of l.query.matchAll(/(\w+): create_item/g)) data[a[1]] = { id: '1' }
  if (l.query.includes('items(ids:')) data.items = [{ column_values: [{ id: 'x', text: '' }] }]
  return { ok: true, status: 200, json: async () => ({ data }) }
}) as unknown as typeof fetch

/** Corre `fn` y devuelve las solicitudes que salieron hacia Monday. */
const capturar = async (fn: () => Promise<unknown>): Promise<Llamada[]> => {
  llamadas = []
  await fn()
  return llamadas
}

await crearProforma({
  clienteId: '12524661079',
  vendedorId: null,
  nombre: 'QA',
  tipoVenta: 'DIRECTA',
  tipoEntrega: 'SIMULTANEA',
  rentabilidad: 30,
  descFormaPago: DESC_FP,
  lineas: lineasVenta,
})

const alta = llamadas.find((l) => l.query.includes('create_item'))
assert.ok(alta, 'la proforma tiene que crear su cabecera')
const cabecera = JSON.parse(alta!.variables.cv as string) as Record<string, number>

assert.equal(
  cabecera[COL.proforma.total],
  totalCard,
  `el TOTAL emitido es el que muestra la card (${cabecera[COL.proforma.total]} vs ${totalCard})`,
)
assert.equal(cabecera[COL.proforma.ivaTotal], ivaCard, 'y su IVA también')

/* Y ese total es, además, el que después va a facturar la VENTA PROFORMA. */
assert.equal(
  cabecera[COL.proforma.total],
  totalFacturado,
  'la proforma vale lo mismo que la factura que sale de ella',
)

/* ---------- 4) El cableado de la card: que no vuelva a sumar los descuentos ---------- */

const vista = readFileSync('src/features/cobro/CobroProforma.tsx', 'utf8')
assert.ok(
  /descuentoUnitario\(l\.precioUnitario, l\.descuento, descFormaPago\)\.total/.test(vista),
  'la card compone los descuentos en CASCADA, con la misma función que el resto de la app',
)
assert.ok(
  !/l\.descuento \+ descFormaPago/.test(vista),
  'y NO los suma: sumarlos daba un descuento mayor al real',
)
assert.ok(
  /ivaLinea\(totalLinea, alicuotaDeclarada\(l\.iva\)\)/.test(vista),
  'y liquida el IVA con la alícuota del producto, no con una tasa única',
)
assert.ok(
  !/IVA_RATE/.test(vista),
  'la card ya no depende del 21% plano',
)

/* ---------- 5) El PRESUPUESTO no liquida IVA. Nunca. ----------
   El presupuesto cotiza precios de LISTA: no declara IVA ni en la card, ni en el resumen, ni en lo
   que se escribe en Monday. Lo único que hace con la alícuota es ARRASTRARLA en el subelemento
   (numeric_mm5wt7hg) para que la venta CON PRESUPUESTO PREVIO la lea al tomar el producto y recién
   ahí la liquide. */

const resumenPresu = resumenPresupuesto(LINEAS, false, 0)
assert.equal(resumenPresu.iva, 0, 'el presupuesto no liquida IVA')
assert.equal(resumenPresu.total, resumenPresu.neto, 'y por eso su TOTAL es el neto, sin agregados')

// Con descuento por forma de pago tampoco: el presupuesto ni siquiera lo aplica.
assert.equal(resumenPresupuesto(LINEAS, false, DESC_FP).iva, 0, 'sigue sin IVA con cualquier descuento')

// El bimonetario, que es el que alimenta los totales del ítem, tampoco lo declara.
const bimoneda = resumenPresupuestoBimoneda(LINEAS, 1500)
assert.equal(
  bimoneda.ars.neto,
  resumenPresupuesto(LINEAS, false).neto,
  'el total bimonetario es el neto del presupuesto, sin IVA',
)

/* Y lo que se escribe en el tablero: el TOTAL EN PESOS es el neto y no viaja ninguna columna de
   IVA en la cabecera. */
const presu = await capturar(() =>
  crearPresupuesto({
    cliente: { id: '12524661079', name: 'QA' } as never,
    vendedor: null,
    lineas: LINEAS,
    fechaEmision: '17/09/2026',
    fechaVencimiento: '01/10/2026',
    diasVigencia: 14,
    rentabilidad: resumenPresu.rentabilidad,
    moneda: 'Pesos',
    totalPesos: bimoneda.ars.neto,
    totalUsd: bimoneda.usd.neto,
  }),
)
const altaPresu = presu.find((l) => l.query.includes('create_item'))
assert.ok(altaPresu, 'el presupuesto crea su cabecera')
const cabPresu = JSON.parse(altaPresu.variables.cv as string) as Record<string, unknown>
assert.equal(
  Number(cabPresu[COL.presupuesto.totalPesos]),
  resumenPresu.neto,
  'el "TOTAL EN PESOS" del presupuesto es el neto, sin IVA',
)
assert.ok(
  !Object.keys(cabPresu).some((c) => c === COL.venta.ivaTotal || c === COL.proforma.ivaTotal),
  'el presupuesto no escribe ninguna columna de IVA total',
)

// El PUENTE con la venta: el subelemento SÍ lleva la alícuota del producto.
const sub = fragmentoSubitem(LINEAS[1], 0)
const colsSub = JSON.parse(sub.variables.cv0 as string) as Record<string, unknown>
assert.equal(
  colsSub[COL.presupuestoSub.iva],
  String(P105.iva),
  'el subelemento del presupuesto arrastra la alícuota real del producto (10,5%)',
)

// Y el cableado de la vista: `conIva` es `esVenta`, así que en PRESUPUESTAR llega en false.
const productosView = readFileSync('src/features/productos/ProductosView.tsx', 'utf8')
assert.ok(
  /resumenPresupuesto\(lineas, esVenta, descFormaPago\)/.test(productosView),
  'la seleccion de productos liquida IVA solo cuando es VENTA',
)
assert.ok(
  /esVenta = operacion === 'VENTA'/.test(productosView),
  'y esVenta excluye a PRESUPUESTAR',
)

/* ---------- 6) La venta no manda la columna de TOTAL que ya no existe ----------
   `numeric_mm5s9zx5` se borró del tablero de Ventas. La app se la siguió mandando y Monday la
   descartaba en silencio: una escritura que parecía funcionar y no llegaba a ningún lado. El TOTAL
   vive en "TOTAL $" (numeric_mm5qbwer, `importeTotalPesos`). */
const vta = await capturar(() =>
  crearVenta({
    clienteId: '12524661079',
    vendedorId: null,
    nombre: 'QA',
    tipoVenta: 'DIRECTA',
    tipoEntrega: 'SIMULTANEA',
    tipoPago: 'SIMULTANEO',
    rentabilidad: 30,
    descFormaPago: DESC_FP,
    importeTotalPesos: totalFacturado,
    lineas: lineasVenta,
  }),
)
const altaVta = vta.find((l) => l.query.includes('create_item'))
assert.ok(altaVta, 'la venta crea su cabecera')
const cabVta = JSON.parse(altaVta.variables.cv as string) as Record<string, unknown>
assert.ok(
  !('numeric_mm5s9zx5' in cabVta),
  'la venta NO manda numeric_mm5s9zx5: esa columna ya no existe en el tablero',
)
assert.equal(
  Number(cabVta[COL.venta.importeTotalPesos]),
  totalFacturado,
  'el TOTAL de la venta va en "TOTAL $" y es el de sus facturas',
)

console.log('OK · el IVA se liquida con la alícuota real: venta, comprobantes y proforma dan lo mismo')
console.log('OK · el presupuesto NO liquida IVA; solo arrastra la alicuota para la venta')
