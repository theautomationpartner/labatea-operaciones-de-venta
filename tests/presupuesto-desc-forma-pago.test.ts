/**
 * PRESUPUESTO · descuento OPCIONAL por forma de pago.
 *
 * La pregunta "¿Desea aplicar descuentos por forma de pago?" es la que habilita el selector; con
 * ella apagada el presupuesto sale a precios de lista. Con ella encendida y una forma elegida, el
 * % de pronto pago muerde el PRECIO UNITARIO de cada producto —en cascada con el descuento manual,
 * las mismas fórmulas que la venta— y eso es lo que se asienta en Monday.
 *
 * Se corre con esbuild + node (`npm run test:presup-desc-pago`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { FORMAS_PAGO_PRESUPUESTO, descuentoDeFormaPago, type DescuentosPago } from '@/lib/cobros'
import { descuentoUnitario, netoLinea } from '@/lib/descuentos'
import { round2 } from '@/lib/format'
import { resumenPresupuesto, resumenPresupuestoBimoneda } from '@/lib/selectors'
import { fragmentoSubitem } from '@/services/monday/carritoSubitems'
import { COL } from '@/services/monday/columns'
import { initialState, reducer } from '@/state/appState'
import type { LineaPresupuesto, Producto } from '@/types'

const producto = (precio: number, moneda = 'Pesos'): Producto =>
  ({
    codigo: `P${precio}`,
    nombre: `Prod ${precio}`,
    precio,
    rentabilidad: 40,
    iva: 21,
    moneda,
  }) as unknown as Producto

const linea = (precio: number, cantidad = 1, descuento = 0, moneda = 'Pesos'): LineaPresupuesto =>
  ({
    id: `l${precio}${moneda}`,
    producto: producto(precio, moneda),
    cantidad,
    descuento,
  }) as LineaPresupuesto

const DESCUENTOS = {
  Efectivo: 6,
  Transferencia: 6,
  Cheque: 6,
  'Tarjeta de débito': 4,
  'Tarjeta de crédito': 2,
  'Retencion IVA': 0,
  'Retencion IIBB': 0,
  'Retencion GAN': 0,
  'Retencion CCSS': 0,
} as unknown as DescuentosPago

/* ---------- 1) Opciones ofrecidas: sin CUENTA CORRIENTE ---------- */
assert.deepEqual(
  [...FORMAS_PAGO_PRESUPUESTO],
  ['CONTADO', 'TARJETA DE CREDITO', 'TARJETA DE DEBITO'],
  'el presupuesto ofrece las tres formas, en ese orden',
)
assert.ok(
  !FORMAS_PAGO_PRESUPUESTO.includes('CUENTA CORRIENTE'),
  'la cuenta corriente no bonifica: no se ofrece',
)
// Cada forma trae su propio %, leído de la config del sistema.
assert.equal(descuentoDeFormaPago('CONTADO', DESCUENTOS), 6)
assert.equal(descuentoDeFormaPago('TARJETA DE DEBITO', DESCUENTOS), 4)
assert.equal(descuentoDeFormaPago('TARJETA DE CREDITO', DESCUENTOS), 2)

/* ---------- 2) El interruptor: apagarlo descarta la forma de pago ---------- */
const encendido = reducer(
  reducer(initialState, { type: 'setDescuentoPagoActivo', value: true }),
  { type: 'setFormaPago', value: 'CONTADO' },
)
assert.equal(encendido.descuentoPagoActivo, true)
assert.equal(encendido.formaPago, 'CONTADO')
const apagado = reducer(encendido, { type: 'setDescuentoPagoActivo', value: false })
assert.equal(apagado.descuentoPagoActivo, false)
assert.equal(apagado.formaPago, null, 'apagar la pregunta deja el selector en blanco')
// Por defecto nace apagado: un presupuesto sale a precios de lista salvo que lo pidan.
assert.equal(initialState.descuentoPagoActivo, false)
assert.equal(initialState.formaPago, null)

/* ---------- 3) Totales: cascada, igual que en la VENTA ---------- */
// Un producto de 10.000 con 10% manual y 6% de CONTADO: primero el 6% sobre la lista, el 10%
// después sobre el precio ya rebajado. Los dos NO se suman.
const CASO = [linea(10_000, 2, 10)]
const dto = descuentoUnitario(10_000, 10, 6)
assert.equal(dto.formaPago, 600, 'el 6% muerde el precio de lista')
assert.equal(dto.manual, 940, 'el 10% manual muerde los 9.400 que quedaron, no los 10.000')
assert.equal(dto.total, 1540, 'descuento total por unidad')
assert.ok(dto.total < 600 + 1000, 'la cascada descuenta menos que sumar los dos porcentajes')
assert.equal(dto.precioFinal, 8460)

const sinDto = resumenPresupuesto(CASO, false)
const conDto = resumenPresupuesto(CASO, false, 6)
assert.equal(sinDto.neto, 18_000, 'sin forma de pago, sólo el descuento manual')
assert.equal(conDto.neto, 16_920, 'con CONTADO, el neto baja por el precio unitario')
assert.equal(conDto.subtotal, sinDto.subtotal, 'el bruto (precio de lista) no cambia')
assert.equal(conDto.descuento, round2(conDto.subtotal - conDto.neto))
assert.ok(conDto.rentabilidad < sinDto.rentabilidad, 'la rentabilidad final baja con el descuento')
// El presupuesto no liquida IVA ni con descuento por forma de pago.
assert.equal(conDto.iva, 0)
assert.equal(conDto.total, conDto.neto)

/* ---------- 4) Bimonetario: el % aplica a las dos monedas ---------- */
const MIXTO = [linea(10_000, 2, 10), linea(100, 3, 0, 'Dolares')]
const bimSin = resumenPresupuestoBimoneda(MIXTO, 1000)
const bimCon = resumenPresupuestoBimoneda(MIXTO, 1000, 6)
assert.equal(bimSin.ars.neto, 18_000)
assert.equal(bimSin.usd.neto, 300, 'los dólares no se convierten')
assert.equal(bimCon.ars.neto, 16_920, 'los pesos bajan por el pronto pago')
assert.equal(bimCon.usd.neto, 282, 'los dólares también: 100 − 6% = 94, × 3')
assert.equal(
  bimCon.netoProyectado,
  round2(16_920 + 282 * 1000),
  'el neto proyectado a pesos sale de los netos ya descontados',
)
assert.ok(bimCon.rentabilidad < bimSin.rentabilidad, 'el donut refleja el descuento')
// Sin descuento por forma de pago, nada cambia respecto de lo que ya hacía.
assert.equal(bimSin.netoProyectado, round2(18_000 + 300 * 1000))

/* ---------- 5) Lo que se escribe en el subelemento de Monday ---------- */
const cv = (l: LineaPresupuesto, descFp: number) =>
  JSON.parse(fragmentoSubitem(l, 0, descFp).variables.cv0 as string) as Record<string, string>

const sub = cv(CASO[0], 6)
const C = COL.presupuestoSub
assert.equal(sub[C.precioUnit], '10000', 'el precio unitario es SIEMPRE el de lista')
assert.equal(sub[C.descuento], '10', '"Desc % x Prod" es el descuento manual del vendedor')
assert.equal(sub[C.descProdMonto], '940', '"Desc $ x Prod" = el manual sobre el precio ya rebajado')
assert.equal(sub[C.descFormaPagoPct], '6', '"Desc % x Forma de Pago" = el % de pronto pago')
assert.equal(sub[C.descFpMonto], '600', '"Desc $ x Forma de Pago" = su monto sobre el precio de lista')
// La identidad que define la columna: Descuento TOTAL = los DOS montos sumados.
assert.equal(sub[C.descTotal], '1540', '"Descuento TOTAL" = Desc $ x Prod + Desc $ x Forma de Pago')
assert.equal(
  Number(sub[C.descTotal]),
  Number(sub[C.descProdMonto]) + Number(sub[C.descFpMonto]),
  'los dos montos tienen que sumar exactamente el Descuento TOTAL',
)
assert.equal(sub[C.precioConDescTotal], '8460', 'precio de lista − Descuento TOTAL')
assert.equal(
  Number(sub[C.precioConDescTotal]),
  Number(sub[C.precioUnit]) - Number(sub[C.descTotal]),
  'el precio con descuento total sale del precio de lista menos el descuento total',
)
assert.equal(sub[C.totalPesos], '16920', 'el subtotal de la línea = precio final × cantidad')
/* El subtotal del subelemento y el neto del resumen son el MISMO número: el board no puede decir
   una cosa y la pantalla otra. */
assert.equal(Number(sub[C.totalPesos]), conDto.neto)
assert.equal(Number(sub[C.totalPesos]), netoLinea(10_000, 2, 10, 6))

// Sólo descuento manual: la mitad de forma de pago queda en 0 y el total es sólo el manual.
const subSin = cv(CASO[0], 0)
assert.equal(subSin[C.descProdMonto], '1000')
assert.equal(subSin[C.descFormaPagoPct], '0')
assert.equal(subSin[C.descFpMonto], '0')
assert.equal(subSin[C.descTotal], '1000')
assert.equal(subSin[C.precioConDescTotal], '9000')
assert.equal(subSin[C.totalPesos], '18000')

/* SIN NINGÚN descuento el "Descuento TOTAL" va en 0: NO se escribe ahí el precio unitario, que era
   lo que hacía antes y dejaba la columna diciendo lo contrario de lo que se llama. */
const subLimpio = cv(linea(10_000), 0)
assert.equal(subLimpio[C.descTotal], '0', 'sin descuentos, el Descuento TOTAL es 0')
assert.notEqual(subLimpio[C.descTotal], subLimpio[C.precioUnit], 'nunca el precio unitario')
assert.equal(subLimpio[C.descProdMonto], '0')
assert.equal(subLimpio[C.descFpMonto], '0')
// Y el precio con descuento total coincide con el de lista: no se descontó nada.
assert.equal(subLimpio[C.precioConDescTotal], '10000')
assert.equal(subLimpio[C.totalPesos], '10000')

// Con SÓLO descuento por forma de pago: el total es ese monto, sin nada del lado manual.
const subSoloFp = cv(linea(10_000), 6)
assert.equal(subSoloFp[C.descProdMonto], '0')
assert.equal(subSoloFp[C.descFormaPagoPct], '6')
assert.equal(subSoloFp[C.descFpMonto], '600')
assert.equal(subSoloFp[C.descTotal], '600')
assert.equal(subSoloFp[C.precioConDescTotal], '9400')

// Producto en dólares: los importes van a las columnas $u y los montos, en su moneda.
const subUsd = cv(linea(100, 3, 0, 'Dolares'), 6)
assert.equal(subUsd[C.precioUnitUsd], '100')
assert.equal(subUsd[C.totalUsd], '282')
assert.equal(subUsd[C.descFpMonto], '6', 'el monto del pronto pago queda en la moneda del producto')
assert.equal(subUsd[C.descTotal], '6')
assert.equal(subUsd[C.precioConDescTotal], '94', 'el precio con descuento total queda en dólares')

console.log('OK · presupuesto con descuento por forma de pago')
