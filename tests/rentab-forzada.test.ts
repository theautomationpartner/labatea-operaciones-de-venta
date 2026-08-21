/**
 * Rentabilidad Forzada: a QUÉ líneas se aplica y qué deja calculado.
 *
 * Son dos motivos independientes para aplicarla, y alcanza con uno:
 *   1. el maestro habilita el producto ("Con Rentab Forzada");
 *   2. su precio unitario quedó POR DEBAJO del costo —el caso que la funcionalidad resuelve—.
 *
 * Lo segundo es la razón de ser del test: la condición se evalúa contra el precio ya pisado por el
 * administrador, así que la única forma de verla es armando el override de verdad. Además la regla
 * vive en UN solo lugar (`aceptaRentabForzada`) porque la comparten el reducer y la
 * previsualización de la carga: si divergieran, lo que se muestra antes de agregar no sería lo que
 * se aplica.
 *
 * También se fija lo que NO se muestra pero SÍ se calcula: el Nuevo Precio de Costo y la Nota de
 * Crédito x Comisión salieron de la pantalla, pero son lo que viaja a Monday.
 *
 * Se corre con esbuild + node (`npm run test:rentab-forzada`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { lineasDeVenta } from '@/lib/lineasVenta'
import { productoConPrecio } from '@/lib/precios'
import { aceptaRentabForzada, rentabilidadFinalLinea } from '@/lib/selectors'
import { initialState, reducer } from '@/state/appState'
import type { AppState } from '@/state/appState'
import type { LineaPresupuesto, Producto } from '@/types'

/** Costo 120 y precio de lista 204: de fábrica gana plata (+70%). */
const PRODUCTO = {
  codigo: '2294',
  nombre: 'ACAY',
  precio: 204,
  precioSinIva: 204,
  precioCosto: 120,
  rentabilidad: 70,
  conRentabForzada: false,
  um: 'UN',
  tipo: 'COM',
} as unknown as Producto

const PCT = 15

/** Estado con una línea de ese producto y la rentabilidad forzada YA encendida al `PCT`. */
function conForzada(producto: Producto, cantidad = 2): LineaPresupuesto {
  const linea = { id: 'L1', producto, cantidad, descuento: 0 } as LineaPresupuesto
  const st = reducer({ ...initialState, lineas: [linea] } as AppState, {
    type: 'toggleRentabForzada',
    porcentaje: PCT,
  })
  return st.lineas[0]
}

/* ---------- Motivo 1: lo habilita el maestro ---------- */
const habilitado = { ...PRODUCTO, conRentabForzada: true }
assert.ok(aceptaRentabForzada(habilitado), 'el producto que el maestro habilita la acepta')
assert.equal(conForzada(habilitado).rentabForzadaAplicada, PCT, 'y el reducer se la aplica')

/* ---------- Motivo 2: el precio pisado lo deja en pérdida ---------- */
/* Sin tocar el precio no hay pérdida: vende a 204 un producto que cuesta 120. */
assert.ok(!aceptaRentabForzada(PRODUCTO), 'a precio de lista, y sin habilitar, NO la acepta')
assert.equal(
  conForzada(PRODUCTO).rentabForzadaAplicada,
  undefined,
  'así que el interruptor encendido no lo toca',
)

// El administrador pisa el precio a 100, por debajo de los 120 que cuesta: rentabilidad −16,67%.
const enPerdida = productoConPrecio(PRODUCTO, 100)
assert.ok(
  aceptaRentabForzada(enPerdida),
  'con el precio por debajo del costo la acepta AUNQUE el maestro no lo habilite',
)
const linea = conForzada(enPerdida)
assert.equal(linea.rentabForzadaAplicada, PCT, 'y el reducer se la aplica igual')
assert.equal(rentabilidadFinalLinea(linea), PCT, 'el % forzado pasa a ser la rentabilidad FINAL')

/* El override NO mueve el costo: es lo que sostiene toda la cuenta de acá abajo. */
assert.equal(enPerdida.precioCosto, 120, 'el Precio de Costo del maestro no se toca al pisar el precio')

/* ---------- Lo que ya no se muestra pero se sigue calculando ----------
   Nuevo Precio de Costo = Precio Unitario × (1 − %/100) = 100 × 0,85 = 85
   Nota de Crédito x Comisión (por unidad) = Costo Original − Nuevo Precio de Costo = 120 − 85 = 35 */
const nuevoPrecioCosto = 100 * (1 - PCT / 100)
assert.equal(nuevoPrecioCosto, 85, 'el Nuevo Precio de Costo sale del precio vigente')
assert.equal(
  linea.montoDifNotaDeCreditoComision,
  35,
  'la Nota de Crédito x Comisión por unidad se sigue calculando aunque no se muestre',
)

/* ---------- Y llega a la venta que se manda a Monday ---------- */
const [lv] = lineasDeVenta({ ...initialState, lineas: [linea] } as never)
assert.equal(lv.notaCreditoComision, 35, 'la NC por unidad viaja en la línea de la venta')
assert.equal(lv.rentabilidad, PCT, 'y la rentabilidad de la línea es el % forzado')

/* ---------- Apagar revierte, sin dejar rastro ---------- */
const apagado = reducer(
  reducer({ ...initialState, lineas: [{ id: 'L1', producto: enPerdida, cantidad: 2, descuento: 0 } as LineaPresupuesto] } as AppState,
    { type: 'toggleRentabForzada', porcentaje: PCT }),
  { type: 'toggleRentabForzada', porcentaje: PCT },
).lineas[0]
assert.equal(apagado.rentabForzadaAplicada, undefined, 'apagada, la línea no conserva el %')
assert.equal(apagado.montoDifNotaDeCreditoComision, undefined, 'ni la nota de crédito')
assert.equal(apagado.producto.precio, 100, 'y el precio pisado sigue siendo el del administrador')

console.log('OK · rentabilidad forzada: se aplica por maestro o por precio en pérdida')
