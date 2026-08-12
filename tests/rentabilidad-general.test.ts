/**
 * RENTABILIDAD GENERAL de la operación: es un promedio ponderado, así que casi nunca da entero.
 * Se conserva con DOS DECIMALES —tanto en el cálculo como en lo que se muestra—, en los tres
 * resúmenes: PRESUPUESTO (catálogo), VENTA con presupuesto previo y VENTA con entrega ANTERIOR.
 *
 * Se corre con esbuild + node (`npm run test:rentabilidad-general`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { pctDec, round2 } from '@/lib/format'
import {
  rentabilidadDeMarkup,
  resumenFactura,
  resumenPresupuesto,
  resumenVenta,
} from '@/lib/selectors'
import type { FacturaItem, LineaPresupuesto, Producto, VentaItem } from '@/types'

const producto = (precio: number, rentabilidad: number): Producto =>
  ({ precio, rentabilidad, iva: 21 }) as unknown as Producto

const linea = (precio: number, rent: number, cantidad = 1, descuento = 0): LineaPresupuesto =>
  ({ id: `l${precio}`, producto: producto(precio, rent), cantidad, descuento }) as LineaPresupuesto

// ---------- PRESUPUESTO / VENTA DIRECTA ----------
/* Dos productos con rentabilidades distintas y pesos distintos: el promedio ponderado cae entre
   medio y NO es un entero. */
/* Los márgenes del maestro (40 y 25) son MARKUP sobre el costo: rinden 28,57% y 20%. Ponderados
   por su importe (10.000 y 30.000) dan el promedio de abajo, que no es entero. */
const ESPERADO_MIXTO = round2(
  (rentabilidadDeMarkup(40) * 10_000 + rentabilidadDeMarkup(25) * 30_000) / 40_000,
)
const mixto = [linea(10_000, 40, 1), linea(30_000, 25, 1)]
const rPresu = resumenPresupuesto(mixto, false).rentabilidad
assert.ok(!Number.isInteger(rPresu), 'el caso de prueba tiene que dar decimales')
assert.equal(rPresu, ESPERADO_MIXTO, 'el ponderado por importe no coincide')
assert.equal(pctDec(rPresu), pctDec(ESPERADO_MIXTO), 'se muestra con sus decimales, no redondeado')

// El descuento la baja y tampoco deja un entero.
const rConDto = resumenPresupuesto([linea(10_000, 40, 1, 6)], false).rentabilidad
assert.equal(rConDto, rentabilidadDeMarkup(40, 6), 'misma fórmula que la línea')
assert.ok(!Number.isInteger(rConDto), 'con descuento tampoco queda un entero')
assert.equal(pctDec(rConDto), pctDec(rentabilidadDeMarkup(40, 6)), 'se muestra con sus decimales')

// Un solo producto sin descuento: la rentabilidad de su markup, tal cual.
assert.equal(
  resumenPresupuesto([linea(10_000, 40)], false).rentabilidad,
  rentabilidadDeMarkup(40),
  'un solo producto rinde exactamente lo suyo',
)
// Sin líneas, cero.
assert.equal(resumenPresupuesto([], false).rentabilidad, 0, 'sin productos, 0')

// ---------- VENTA CON PRESUPUESTO PREVIO ----------
const item = (precio: number, rent: number, aVender = 1, desc = 0): VentaItem =>
  ({ uid: `u${precio}`, precio, aVender, desc, rent, iva: 21 }) as VentaItem

const rVenta = resumenVenta([item(10_000, 40), item(30_000, 25)], null, 'CON PRESUPUESTO PREVIO')
assert.equal(rVenta.rentabilidad, ESPERADO_MIXTO, 'la venta pondera igual que el presupuesto')
assert.ok(!Number.isInteger(rVenta.rentabilidad), 'ya NO se redondea a entero en el origen')
assert.equal(
  resumenVenta([item(10_000, 40, 1, 6)], null, 'CON PRESUPUESTO PREVIO').rentabilidad,
  rentabilidadDeMarkup(40, 6),
  'con descuento de línea, la misma fórmula',
)

// ---------- VENTA CON ENTREGA ANTERIOR (lo remitido a facturar) ----------
const fact = (precio: number, rent: number, aFacturar = 1): FacturaItem =>
  ({ uid: `f${precio}`, precio, aFacturar, rent }) as unknown as FacturaItem

assert.equal(
  resumenFactura([fact(10_000, 40), fact(30_000, 25)], null, 0).rentabilidad,
  ESPERADO_MIXTO,
  'el resumen de la factura pondera igual que los otros dos',
)

console.log('OK · la rentabilidad general conserva sus decimales en presupuesto y venta')
