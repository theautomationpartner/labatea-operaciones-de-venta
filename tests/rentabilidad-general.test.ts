/**
 * RENTABILIDAD GENERAL de la operación: es un promedio ponderado, así que casi nunca da entero.
 * Se conserva con DOS DECIMALES —tanto en el cálculo como en lo que se muestra—, en los tres
 * resúmenes: PRESUPUESTO (catálogo), VENTA con presupuesto previo y VENTA con entrega ANTERIOR.
 *
 * Se corre con esbuild + node (`npm run test:rentabilidad-general`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { pctDec } from '@/lib/format'
import {
  rentabilidadEfectiva,
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
const mixto = [linea(10_000, 40, 1), linea(30_000, 25, 1)]
const rPresu = resumenPresupuesto(mixto, false).rentabilidad
assert.ok(!Number.isInteger(rPresu), 'el caso de prueba tiene que dar decimales')
assert.equal(rPresu, 28.75, '40% y 25% ponderados 1:3 → 28,75%')
assert.equal(pctDec(rPresu), '28,75%', 'se muestra con sus decimales, no redondeado a 29%')

// El descuento la baja y tampoco deja un entero.
const rConDto = resumenPresupuesto([linea(10_000, 40, 1, 6)], false).rentabilidad
assert.equal(rConDto, 36.17, '40% con 6% de descuento → 36,17%')
assert.equal(pctDec(rConDto), '36,17%', 'antes se mostraba 36%')
// Coincide con la fórmula por línea, que ya trabajaba con decimales.
assert.equal(rConDto, Math.round(rentabilidadEfectiva(40, 6) * 100) / 100, 'misma fórmula')

// Un solo producto sin descuento sí da entero: no se le agregan decimales de más.
assert.equal(pctDec(resumenPresupuesto([linea(10_000, 40)], false).rentabilidad), '40%')
// Sin líneas, cero.
assert.equal(resumenPresupuesto([], false).rentabilidad, 0, 'sin productos, 0')

// ---------- VENTA CON PRESUPUESTO PREVIO ----------
const item = (precio: number, rent: number, aVender = 1, desc = 0): VentaItem =>
  ({ uid: `u${precio}`, precio, aVender, desc, rent, iva: 21 }) as VentaItem

const rVenta = resumenVenta([item(10_000, 40), item(30_000, 25)], null, 'CON PRESUPUESTO PREVIO')
assert.equal(rVenta.rentabilidad, 28.75, 'el resumen de la venta también pondera con decimales')
assert.ok(!Number.isInteger(rVenta.rentabilidad), 'ya NO se redondea a entero en el origen')
assert.equal(
  resumenVenta([item(10_000, 40, 1, 6)], null, 'CON PRESUPUESTO PREVIO').rentabilidad,
  36.17,
  'con descuento de línea, 36,17%',
)

// ---------- VENTA CON ENTREGA ANTERIOR (lo remitido a facturar) ----------
const fact = (precio: number, rent: number, aFacturar = 1): FacturaItem =>
  ({ uid: `f${precio}`, precio, aFacturar, rent }) as unknown as FacturaItem

assert.equal(
  resumenFactura([fact(10_000, 40), fact(30_000, 25)], null, 0).rentabilidad,
  28.75,
  'el resumen de la factura también conserva los decimales',
)

console.log('OK · la rentabilidad general conserva sus decimales en presupuesto y venta')
