/**
 * Rentabilidad Forzada: a QUÉ líneas se aplica y qué deja calculado.
 *
 * El comercio quiere asegurarse un % en ciertos productos aunque el precio no lo alcance; la
 * diferencia la cubre el proveedor con una nota de crédito. El precio de venta NO se toca. Se
 * contesta "¿cuánto nos tendría que haber costado para ganar exactamente el %?":
 *
 *   Nuevo Costo     = (Precio S/IVA con descuentos − Flete) / (1 + %)
 *   Nota de Crédito = Costo Final − Nuevo Costo            (por unidad)
 *   TOTAL NC        = Σ Nota de Crédito × cantidad
 *
 * Son dos motivos independientes para aplicarla, y alcanza con uno:
 *   1. el maestro habilita el producto ("Con Rentab Forzada");
 *   2. su precio unitario no cubre Costo + Flete —el caso que la funcionalidad resuelve—.
 *
 * Además fija lo que la cuenta vieja hacía mal —multiplicar por (1 − %) en lugar de dividir por
 * (1 + %), no restar el flete, tomar el precio CON IVA e ignorar los descuentos—, y que si el
 * producto ya rinde el % o más no se genera nota de crédito.
 *
 * Se corre con esbuild + node (`npm run test:rentab-forzada`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { round2 } from '@/lib/format'
import { lineasDeVenta } from '@/lib/lineasVenta'
import { productoConPrecio } from '@/lib/precios'
import {
  aceptaRentabForzada,
  costoEfectivoLinea,
  notaCreditoLinea,
  notaCreditoTotal,
  rentabForzadaLinea,
  rentabilidadDe,
  rentabilidadFinalLinea,
} from '@/lib/selectors'
import { fragmentoSubitem } from '@/services/monday/carritoSubitems'
import { COL } from '@/services/monday/columns'
import { initialState, reducer } from '@/state/appState'
import type { AppState } from '@/state/appState'
import type { LineaPresupuesto, Producto } from '@/types'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.equal(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}

/** El producto de la planilla, a precio L1 (Costo + Flete + 23%): de fábrica rinde 23%. */
const COSTO = 102_162.35
const FLETE = 175
const PRODUCTO = {
  codigo: '2294',
  nombre: 'PRODUCTO DE LA PLANILLA',
  precio: 125_834.691,
  precioSinIva: 125_834.691,
  precioCosto: COSTO,
  flete: FLETE,
  rentabilidad: 23,
  conRentabForzada: false,
  um: 'UN',
  tipo: 'COM',
} as unknown as Producto

const PCT = 23

/** Una línea del producto con la rentabilidad forzada encendida al `pct`, pasando por el reducer. */
function conForzada(producto: Producto, cantidad = 1, descuento = 0, pct = PCT): LineaPresupuesto {
  const linea = { id: 'L1', producto, cantidad, descuento } as LineaPresupuesto
  const st = reducer({ ...initialState, lineas: [linea] } as AppState, {
    type: 'toggleRentabForzada',
    porcentaje: pct,
  })
  return st.lineas[0]
}

/* ---------- 1) A qué productos se aplica ---------- */

console.log('Caso 1 · A qué productos se aplica:')

igual(aceptaRentabForzada({ ...PRODUCTO, conRentabForzada: true }), true, 'la acepta el producto que el maestro habilita')
igual(aceptaRentabForzada(PRODUCTO), false, 'a precio de lista, y sin habilitar, NO la acepta')
igual(conForzada(PRODUCTO).rentabForzadaAplicada, undefined, 'así que el interruptor encendido no lo toca')
igual(
  aceptaRentabForzada(productoConPrecio(PRODUCTO, 102_300)),
  true,
  'un precio que cubre el costo pero NO el flete lo deja en pérdida: la acepta aunque el maestro no lo habilite',
)

/* ---------- 2) El ejemplo: precio pisado a 110.000 ---------- */

console.log('\nCaso 2 · Precio pisado a $110.000, forzado al 23%:')

/* 110.000 cubre Costo + Flete (no hay pérdida), así que el que la habilita es el maestro. */
const pisado = productoConPrecio({ ...PRODUCTO, conRentabForzada: true }, 110_000)
const linea = conForzada(pisado)
igual(linea.rentabForzadaAplicada, PCT, 'el reducer marca el % en la línea')
igual(rentabilidadDe(110_000, COSTO, FLETE), 7.5, 'sin forzar, ese precio rinde 7,50%')

const f = rentabForzadaLinea(linea)!
igual(f.nuevoCosto, 89_288.62, 'Nuevo Costo = (110.000 − 175) / 1,23 = 89.288,62')
igual(f.notaCredito, 12_873.73, 'Nota de Crédito = 102.162,35 − 89.288,62 = 12.873,73 por unidad')
igual(rentabilidadDe(110_000, f.nuevoCosto, FLETE), 23, 'control: con el costo nuevo rinde exactamente 23,00%')
igual(rentabilidadFinalLinea(linea), PCT, 'la rentabilidad FINAL de la línea es el % forzado')
igual(costoEfectivoLinea(linea), 89_288.62, 'y la línea pesa en la general con el costo nuevo')
igual(linea.producto.precio, 110_000, 'el precio de venta no cambia')

/* La cuenta vieja: Nuevo Costo = Precio × (1 − %) = 84.700 → NC 17.462,35, y dejaba 29,66%. */
igual(round2(COSTO - 110_000 * 0.77), 17_462.35, 'la fórmula vieja le reclamaba $4.588,62 de más al proveedor')

/* ---------- 3) El IVA no entra ---------- */

console.log('\nCaso 3 · Cliente que paga IVA:')

// El precio le llega con el 21%; el precio sin IVA sigue siendo 110.000.
const conIva = { ...pisado, precio: round2(110_000 * 1.21) }
igual(
  rentabForzadaLinea(conForzada(conIva))?.notaCredito,
  12_873.73,
  'la nota de crédito es la misma: se mide sobre el precio SIN IVA (antes daba −15.077,83 con IVA)',
)

/* ---------- 4) Los descuentos bajan el precio, y con él el Nuevo Costo ---------- */

console.log('\nCaso 4 · Descuentos:')

// 10% por forma de pago: se cobra 99.000 → Nuevo Costo (99.000 − 175) / 1,23 = 80.345,53
const conDesc = rentabForzadaLinea(linea, 10)!
igual(conDesc.nuevoCosto, 80_345.53, 'con 10% por forma de pago, Nuevo Costo = (99.000 − 175) / 1,23')
igual(conDesc.notaCredito, round2(COSTO - 80_345.53), 'y la nota de crédito crece en la misma medida')

// El descuento manual cambiado DESPUÉS de forzar: la nota de crédito se recalcula sola.
const reducida = { ...linea, descuento: 10 }
igual(
  notaCreditoLinea(reducida),
  conDesc.notaCredito,
  'cambiar el descuento después de forzar recalcula la nota de crédito (no queda un valor viejo)',
)

/* ---------- 5) Si ya rinde el % o más, no hay nota de crédito ---------- */

console.log('\nCaso 5 · El producto ya rinde el % pedido:')

const yaRinde = conForzada({ ...PRODUCTO, conRentabForzada: true }, 1, 0, 20)
igual(yaRinde.rentabForzadaAplicada, 20, 'el producto habilitado queda marcado al 20%')
igual(rentabForzadaLinea(yaRinde), null, 'pero rinde 23%: el costo necesario supera al real y no hay nada que compensar')
igual(notaCreditoLinea(yaRinde), undefined, 'no genera nota de crédito (no una negativa de −2.554,06)')
igual(rentabilidadFinalLinea(yaRinde), 23, 'y la línea muestra su rentabilidad REAL')

/* ---------- 6) El TOTAL es por cantidad ---------- */

console.log('\nCaso 6 · TOTAL Nota de Crédito x Comisión:')

const tres = conForzada(pisado, 3)
igual(notaCreditoLinea(tres), 12_873.73, 'la nota de crédito de la línea sigue siendo POR UNIDAD')
igual(notaCreditoTotal([tres]), 38_621.19, 'el TOTAL la multiplica por la cantidad: 12.873,73 × 3')
igual(
  notaCreditoTotal([tres, conForzada(PRODUCTO, 5)]),
  38_621.19,
  'las líneas sin rentabilidad forzada no suman',
)

/* ---------- 7) Lo que viaja a Monday ---------- */

console.log('\nCaso 7 · Lo que se graba:')

const [lv] = lineasDeVenta({ ...initialState, lineas: [tres] } as never)
igual(lv.notaCreditoComision, 12_873.73, 'la venta lleva la nota de crédito por unidad en la línea')
igual(lv.rentabilidad, PCT, 'y la rentabilidad de la línea es el % forzado')
igual(lv.costoUnitario, 89_288.62, 'y el costo con el que pesa en la general es el nuevo')

const cv = JSON.parse(fragmentoSubitem(tres, 0).variables.cv0 as string) as Record<string, unknown>
igual(cv[COL.presupuestoSub.rentabilidad], '23', 'el subelemento del presupuesto graba la rentabilidad final')
igual(cv[COL.presupuestoSub.costoPesos], '89288.62', 'el costo que graba es el nuevo')
igual(cv[COL.presupuestoSub.notaCreditoComision], '12873.73', 'y la nota de crédito, por unidad')
igual(cv[COL.presupuestoSub.flete], '175', 'el subelemento del presupuesto graba el flete por unidad')
igual(lv.flete, FLETE, 'y la línea de venta lo lleva, para grabarlo en la proforma')

/* ---------- 8) Apagar revierte, sin dejar rastro ---------- */

console.log('\nCaso 8 · Apagar:')

const apagado = reducer(
  reducer(
    { ...initialState, lineas: [{ id: 'L1', producto: pisado, cantidad: 2, descuento: 0 } as LineaPresupuesto] } as AppState,
    { type: 'toggleRentabForzada', porcentaje: PCT },
  ),
  { type: 'toggleRentabForzada', porcentaje: PCT },
).lineas[0]
igual(apagado.rentabForzadaAplicada, undefined, 'apagada, la línea no conserva el %')
igual(notaCreditoLinea(apagado), undefined, 'ni la nota de crédito')
igual(apagado.producto.precio, 110_000, 'y el precio pisado sigue siendo el del administrador')

console.log(`\nOK · rentabilidad forzada: Nuevo Costo = (Precio − Flete) / (1 + %) (${asserts} verificaciones)`)
