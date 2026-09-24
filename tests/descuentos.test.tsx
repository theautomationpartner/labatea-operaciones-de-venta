/**
 * Auditoría matemática de las métricas por producto (descuento en cascada, subtotal e IVA).
 * Verifica las fórmulas puras y, además, lo que efectivamente RENDERIZA la tabla, para que no
 * puedan divergir. Sin runner de DOM: `react-dom/server`, como el resto de los tests.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppProvider } from '@/state/AppProvider'
import { TablaProductos, type FilaProducto } from '@/features/productos/TablaProductos'
import {
  bonificacionLinea,
  descuentoCompuesto,
  descuentoUnitario,
  ivaLinea,
  netoLinea,
} from '@/lib/descuentos'
import { money, round2 } from '@/lib/format'
import { resumenPresupuesto } from '@/lib/selectors'
import type { LineaPresupuesto, Producto } from '@/types'

const PRECIO = 10000
const FP = 6 // % forma de pago
const MANUAL = 5 // % descuento por precio

const producto = {
  codigo: '150',
  nombre: 'CLORO GRANULADO x 1 KG.',
  precio: PRECIO,
  rentabilidad: 40,
  iva: 21,
  fisico: 0,
  comercial: 0,
  disponible: 0,
  provCod: '',
  provNombre: '',
  tipo: 'COM',
  moneda: 'ARS',
  comisionable: false,
} as unknown as Producto

// ---------- MÓDULO 1: descuento en cascada, por unidad ----------
const d = descuentoUnitario(PRECIO, MANUAL, FP)
assert.equal(d.formaPago, 600, 'monto forma de pago = precio × %fp')
assert.equal(d.manual, 470, 'monto manual = (precio − monto fp) × %manual')
assert.equal(d.total, 1070, 'descuento total = fp + manual (cascada, NO 1100 sumando %)')
assert.equal(d.precioFinal, 8930, 'precio final = precio − descuento total')
assert.equal(round2(d.pct), 10.7, '% compuesto = 1 − (1−fp)(1−manual)')
// La suma simple de porcentajes (lógica vieja) daría de más: es justamente lo que se corrigió.
assert.notEqual(d.total, round2((PRECIO * (MANUAL + FP)) / 100), 'volvió la suma de porcentajes')
// Casos borde: sin descuentos, sólo uno, y bonificación total.
assert.equal(descuentoUnitario(PRECIO, 0, 0).total, 0, 'sin descuentos no hay bonificación')
assert.equal(descuentoUnitario(PRECIO, 0, FP).total, 600, 'sólo forma de pago')
assert.equal(descuentoUnitario(PRECIO, MANUAL, 0).total, 500, 'sólo manual, sobre el de lista')
assert.equal(descuentoUnitario(PRECIO, 100, FP).precioFinal, 0, '100% manual → precio final 0')
assert.equal(descuentoCompuesto(100, FP), 100, '100% manual → 100% compuesto')
// Nunca puede descontar más que el precio, ni con valores fuera de rango.
assert.equal(descuentoUnitario(PRECIO, 999, 999).precioFinal, 0, 'el descuento no pasa del precio')

// ---------- MÓDULOS 2 y 3: subtotal e IVA, dependientes de la cantidad ----------
for (const cantidad of [1, 3, 20]) {
  assert.equal(
    netoLinea(PRECIO, cantidad, MANUAL, FP),
    round2(8930 * cantidad),
    `subtotal = precio final × cantidad (cantidad ${cantidad})`,
  )
  assert.equal(
    ivaLinea(netoLinea(PRECIO, cantidad, MANUAL, FP), 21),
    round2(8930 * cantidad * 0.21),
    `IVA = subtotal × alícuota (cantidad ${cantidad})`,
  )
  // "Importe Bonif $" del subelemento de facturación: la bonificación de la LÍNEA entera.
  assert.equal(
    bonificacionLinea(PRECIO, cantidad, MANUAL, FP),
    round2(1070 * cantidad),
    `bonificación = (desc. forma de pago + desc. manual) × cantidad (cantidad ${cantidad})`,
  )
  // Precio de lista = neto cobrado + bonificación: no se pierde ni se duplica plata.
  assert.equal(
    round2(netoLinea(PRECIO, cantidad, MANUAL, FP) + bonificacionLinea(PRECIO, cantidad, MANUAL, FP)),
    round2(PRECIO * cantidad),
    `neto + bonificación = precio de lista × cantidad (cantidad ${cantidad})`,
  )
}
assert.equal(bonificacionLinea(PRECIO, 4, 0, 0), 0, 'sin descuentos no hay importe bonificado')

// ---------- Lo que renderiza la tabla ----------
const fila = (cantidad: number): FilaProducto => ({
  id: 'l1',
  codigo: producto.codigo,
  nombre: producto.nombre,
  cantidad,
  precio: PRECIO,
  descuento: MANUAL,
  rentabilidad: producto.rentabilidad,
  producto,
})

const render = (cantidad: number) =>
  renderToStaticMarkup(
    createElement(
      AppProvider,
      null,
      createElement(TablaProductos, {
        titulo: 'Productos seleccionados',
        filas: [fila(cantidad)],
        onRemove: () => {},
        onCantidad: () => {},
        onDescuento: () => {},
        cantidadMin: 1,
        descFormaPago: FP,
      }),
    ),
  )

const una = render(1)
const cinco = render(5)

// El descuento total y el precio con descuento son POR UNIDAD: no se mueven con la cantidad.
for (const html of [una, cinco]) {
  assert.ok(html.includes(money(1070)), 'la fila no muestra el descuento total en cascada')
  assert.ok(html.includes(money(8930)), 'la fila no muestra el precio con descuento aplicado')
  assert.ok(!html.includes(money(1100)), 'la fila sigue sumando los porcentajes')
}
// El subtotal sí escala, y sin IVA.
assert.ok(una.includes(money(8930)), 'subtotal con 1 unidad')
assert.ok(cinco.includes(money(44650)), 'subtotal con 5 unidades = 8930 × 5')
assert.ok(!cinco.includes(money(54026.5)), 'el subtotal se está calculando con IVA')

// ---------- Coherencia fila ↔ totales del documento ----------
const lineas: LineaPresupuesto[] = [
  { id: 'a', producto, cantidad: 5, descuento: MANUAL },
  { id: 'b', producto: { ...producto, precio: 4500 }, cantidad: 2, descuento: 0 },
]
const resumen = resumenPresupuesto(lineas, true, FP)
const sumaFilas = round2(
  lineas.reduce((acc, l) => acc + netoLinea(l.producto.precio, l.cantidad, l.descuento, FP), 0),
)
assert.equal(resumen.neto, sumaFilas, 'el neto del resumen no es la suma de los subtotales')
assert.equal(resumen.neto, round2(44650 + 8460), 'neto esperado con la cascada')
assert.equal(resumen.iva, round2(resumen.neto * 0.21), 'el IVA del resumen sale del neto')
assert.equal(resumen.total, round2(resumen.neto + resumen.iva), 'total = neto + IVA')

console.log('OK · descuento en cascada, subtotal e IVA')
