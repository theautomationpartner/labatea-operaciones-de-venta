/**
 * RENTABILIDAD GENERAL de la operación.
 *
 * Como la rentabilidad de cada línea es Resultado / Costo, la de la operación es
 *
 *   Σ Resultado bruto / Σ Costo
 *
 * que es el promedio de la rentabilidad de cada línea PONDERADO POR SU COSTO. No por su importe de
 * venta: eso le da más peso a las líneas que más ganan y deforma la general. El test fija:
 *   · la ponderación por costo (con el ejemplo que la distingue de la ponderación por venta);
 *   · que la general sale del MISMO % que muestra cada línea, con flete y descuentos;
 *   · que los cuatro resúmenes —PRESUPUESTO/VENTA DIRECTA, bimoneda, VENTA con presupuesto previo y
 *     entrega ANTERIOR— y lo que se graba en Monday (`rentabilidadGeneralDeLineas`) dicen lo mismo;
 *   · que conserva sus DOS DECIMALES.
 *
 * Se corre con esbuild + node (`npm run test:rentabilidad-general`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { pctDec, trunc2 } from '@/lib/format'
import { lineasDeVenta, rentabilidadGeneralDeLineas } from '@/lib/lineasVenta'
import {
  rentabilidadFinalLinea,
  rentabilidadGeneral,
  resumenFactura,
  resumenPresupuesto,
  resumenPresupuestoBimoneda,
  resumenVenta,
} from '@/lib/selectors'
import { initialState } from '@/state/appState'
import type { FacturaItem, LineaPresupuesto, Producto, VentaItem } from '@/types'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.equal(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}

/** Producto con precio de lista SIN IVA, Costo Final y Flete del maestro. */
const producto = (precio: number, costo: number, flete = 0, moneda = 'Pesos'): Producto =>
  ({ precio, precioSinIva: precio, precioCosto: costo, flete, rentabilidad: 0, iva: 21, moneda }) as unknown as Producto

let n = 0
const linea = (p: Producto, cantidad = 1, descuento = 0): LineaPresupuesto =>
  ({ id: `l${n++}`, producto: p, cantidad, descuento }) as LineaPresupuesto

/* ---------- 1) Se pondera por COSTO, no por venta ---------- */

console.log('Caso 1 · Ponderación por costo:')

/* A: costo 100, vende a 150  → resultado 50,  rent 50%
   B: costo 1000, vende a 1100 → resultado 100, rent 10%
   General = (50 + 100) / (100 + 1000) = 13,64%   (ponderando por venta daría 14,80%) */
const A = linea(producto(150, 100))
const B = linea(producto(1100, 1000))
igual(rentabilidadFinalLinea(A), 50, 'A rinde 50%')
igual(rentabilidadFinalLinea(B), 10, 'B rinde 10%')
igual(resumenPresupuesto([A, B], false).rentabilidad, 13.64, 'la general es Σ resultado / Σ costo = 13,64%')
igual(
  trunc2((50 * 150 + 10 * 1100) / 1250),
  14.8,
  'ponderar por el importe de venta —como se hacía— daba 14,80%',
)

/* ---------- 2) Con flete, cantidades y descuentos ---------- */

console.log('\nCaso 2 · El producto de la planilla junto a otro, con cantidades y descuentos:')

const PLANILLA = producto(125_834.691, 102_162.35, 175)
const OTRO = producto(2_000, 1_500, 20)
const lineas = [linea(PLANILLA, 2), linea(OTRO, 5, 10)]
const descFP = 3

/* Σ resultado / Σ costo, a mano. Cada línea cobra su precio con los descuentos compuestos en
   cascada (el manual y el de forma de pago) y paga su costo y su flete por unidad. */
const resultado = (precio: number, costo: number, flete: number, cant: number, desc: number) =>
  (precio * (1 - desc / 100) - costo - flete) * cant
const descOtro = (1 - (1 - 0.03) * (1 - 0.1)) * 100
const esperado = trunc2(
  ((resultado(125_834.691, 102_162.35, 175, 2, 3) + resultado(2_000, 1_500, 20, 5, descOtro)) /
    (102_162.35 * 2 + 1_500 * 5)) *
    100,
)
const rMixto = resumenPresupuesto(lineas, true, descFP).rentabilidad
igual(rMixto, esperado, 'la general es exactamente Σ resultado / Σ costo, con flete y descuentos')
igual(
  rMixto,
  rentabilidadGeneral(
    lineas.map((l) => ({
      rentabilidad: rentabilidadFinalLinea(l, descFP),
      costo: (l.producto.precioCosto ?? 0) * l.cantidad,
    })),
  ),
  'y sale del MISMO % que muestra cada línea en la tabla',
)
assert.ok(!Number.isInteger(rMixto), 'el caso de prueba tiene que dar decimales')
igual(pctDec(rMixto), pctDec(esperado), 'se muestra con sus decimales, no redondeado')

/* ---------- 3) Lo que se graba en Monday es lo que se ve ---------- */

console.log('\nCaso 3 · La cabecera de la venta dice lo mismo que el resumen:')

const lv = lineasDeVenta({ ...initialState, lineas, descFormaPago: descFP } as never)
igual(
  rentabilidadGeneralDeLineas(lv, descFP),
  rMixto,
  'la rentabilidad general que se graba es la del resumen',
)
igual(
  lv[1].rentabilidad,
  rentabilidadFinalLinea(lineas[1], descFP),
  'y la de cada subelemento, la de su fila (con el descuento por forma de pago incluido)',
)

/* ---------- 4) Bimoneda: el costo en dólares pesa convertido ---------- */

console.log('\nCaso 4 · Presupuesto bimonetario:')

const TASA = 1_000
// Una línea en pesos (costo 1000, rent 10%) y una en dólares (costo 1 U$S = 1000 $, rent 50%).
const bim = [linea(producto(1_100, 1_000)), linea(producto(1.5, 1, 0, 'Dolares'))]
igual(
  resumenPresupuestoBimoneda(bim, TASA).rentabilidad,
  30,
  'con los dos costos en la misma escala pesan igual: (10% + 50%) / 2 = 30%',
)

/* ---------- 5) VENTA CON PRESUPUESTO PREVIO ---------- */

console.log('\nCaso 5 · Venta con presupuesto previo:')

const item = (p: Producto, aVender = 1, desc = 0): VentaItem =>
  ({
    uid: `u${n++}`,
    precio: p.precio,
    aVender,
    desc,
    descuento: 0,
    rent: 0,
    costo: p.precioCosto,
    flete: p.flete,
    iva: 21,
  }) as VentaItem

igual(
  resumenVenta([item(PLANILLA, 2), item(OTRO, 5, 10)], null, 'CON PRESUPUESTO PREVIO', descFP)
    .rentabilidad,
  rMixto,
  'con el costo y el flete del maestro, rinde lo mismo que la venta DIRECTA',
)

/* ---------- 6) VENTA PROFORMA: la registrada, pesada por costo ---------- */

console.log('\nCaso 6 · Venta sobre proforma:')

const deProforma = (rent: number, costo: number): VentaItem =>
  ({ uid: `p${n++}`, precio: 1, aVender: 1, desc: 0, descFormaPago: 0, rent, costo }) as VentaItem
igual(
  resumenVenta([deProforma(50, 100), deProforma(10, 1_000)], null, 'DIRECTA').rentabilidad,
  13.64,
  'la proforma no se recalcula: usa su rentabilidad registrada y pondera por costo',
)

/* ---------- 7) ENTREGA ANTERIOR ---------- */

console.log('\nCaso 7 · Venta con entrega ANTERIOR:')

const fact = (rent: number, costo: number, flete: number, aFacturar = 1): FacturaItem =>
  ({ uid: `f${n++}`, precio: 1, aFacturar, rent, costo, flete }) as unknown as FacturaItem

igual(
  resumenFactura([fact(50, 100, 0), fact(10, 1_000, 0)], null, 0).rentabilidad,
  13.64,
  'el resumen de la factura pondera por costo igual que los otros',
)
igual(
  resumenFactura([fact(23, 102_162.35, 175)], null, 0, 0, 10).rentabilidad,
  10.68,
  'y con 10% por forma de pago la línea de la planilla rinde 10,68%, igual que en la DIRECTA',
)

/* ---------- 8) Bordes ---------- */

console.log('\nCaso 8 · Bordes:')

igual(resumenPresupuesto([], false).rentabilidad, 0, 'sin productos, 0')
igual(rentabilidadGeneral([{ rentabilidad: 40, costo: 0 }]), 0, 'sin costo medible, 0')
igual(
  rentabilidadGeneral([
    { rentabilidad: 40, costo: 0 },
    { rentabilidad: 10, costo: 500 },
  ]),
  10,
  'una línea sin costo no aporta: no hay contra qué medirla',
)

console.log(`\nOK · la rentabilidad general es Σ resultado / Σ costo (${asserts} verificaciones)`)
