/**
 * PRESUPUESTO: NO se aplica descuento por forma de pago. En ninguna parte.
 *
 * El check "¿Desea aplicar la leyenda de descuentos por forma de pago?" hace UNA sola cosa: tildar
 * `boolean_mm6dnwf1` en el ítem, que es lo que le pide al PDF incluir la leyenda de las formas
 * bonificadas. Los precios salen SIEMPRE de lista, con el descuento manual de cada línea y nada más.
 *
 * Antes ese check habilitaba un control de Forma de Pago cuyo % mordía el precio unitario de cada
 * producto, y el subelemento declaraba ese descuento en dos columnas propias. Se retiró entero: el
 * presupuesto no cotiza un precio bonificado, informa que hay bonificaciones disponibles.
 *
 * Lo que se fija acá es lo que un refactor podría reintroducir sin que nada falle: que las dos
 * columnas del descuento por forma de pago NO se escriban, y que "Descuento TOTAL" lleve el
 * descuento en pesos de la línea.
 *
 * Se corre con esbuild + node (`npm run test:presup-sin-desc`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { construirBulkSubitems } from '@/services/monday/carritoSubitems'
import { COL } from '@/services/monday/columns'
import type { LineaPresupuesto, Producto } from '@/types'

const PRECIO = 1000
const producto = {
  codigo: '2294',
  nombre: 'ACAY',
  precio: PRECIO,
  precioSinIva: PRECIO,
  rentabilidad: 70,
  um: 'UN',
  tipo: 'COM',
  moneda: 'Pesos',
} as unknown as Producto

/** Columnas del subelemento de una línea con ese descuento manual. */
function columnas(descuento: number): Record<string, unknown> {
  const bulk = construirBulkSubitems([
    { id: 'L1', producto, cantidad: 2, descuento } as LineaPresupuesto,
  ])
  assert.ok(bulk, 'la línea tiene que producir un subelemento')
  return JSON.parse(bulk!.variables.cv0 as string) as Record<string, unknown>
}

/* ---------- Las columnas del descuento por forma de pago NO se escriben ----------
   Siguen existiendo en el board; lo que no puede volver es que la app las mande. */
for (const descuento of [0, 10]) {
  const cv = columnas(descuento)
  for (const columna of ['numeric_mm6e2zs9', 'numeric_mm6ehr78']) {
    assert.ok(
      !(columna in cv),
      `${columna} no se escribe: el presupuesto no aplica descuento por forma de pago`,
    )
  }
}

/* ---------- "Descuento TOTAL" lleva el descuento EN PESOS de la línea ---------- */
assert.equal(columnas(0)[COL.presupuestoSub.descTotal], '0', 'sin descuento va 0, no el precio')
assert.equal(
  columnas(10)[COL.presupuestoSub.descTotal],
  '100',
  'con 10% sobre $1.000 el descuento por unidad son $100',
)
/* Y coincide con el descuento por producto: sin la cascada de la forma de pago, son lo mismo. */
assert.equal(
  columnas(10)[COL.presupuestoSub.descTotal],
  columnas(10)[COL.presupuestoSub.descProdMonto],
  'sin forma de pago, el descuento TOTAL es el manual',
)

/* ---------- El check sólo marca su casilla ---------- */
assert.equal(COL.presupuesto.descuentoFormaPago, 'boolean_mm6dnwf1')
const servicio = readFileSync('src/services/monday/presupuestar.ts', 'utf8')
assert.match(
  servicio,
  /descuentoFormaPago\]: \{ checked: descuentoPagoAplicado \? 'true' : 'false' \}/,
  'el check escribe true/false en su columna, tal cual',
)

/* ---------- Y no quedó nada del descuento en el presupuesto ----------
   Se busca por CONSTRUCCIONES de código (`<select`, el nombre de la función) y no por palabras
   sueltas: "selector" aparece en los comentarios que explican qué se retiró, y hacer fallar el test
   por documentar el cambio sería absurdo. */
const componente = readFileSync('src/features/productos/DescuentoPagoPresupuesto.tsx', 'utf8')
assert.match(
  componente,
  /leyenda de descuentos por forma de pago\?/,
  'la pregunta habla de la LEYENDA, no de aplicar descuentos',
)
assert.ok(!componente.includes('<select'), 'ya no hay control de forma de pago')
assert.ok(!componente.includes('FORMAS_PAGO'), 'ni su catálogo de opciones')
assert.ok(!componente.includes('descuentoDeFormaPago('), 'ni el cálculo del descuento')
assert.ok(!componente.includes('Descuento (%) x Producto'), 'ni el indicador del %')
assert.ok(!componente.includes('se aplicara al precio unitario'), 'ni su aclaración')

const emision = readFileSync('src/features/emision/EmisionView.tsx', 'utf8')
assert.ok(!emision.includes('descuentoDeFormaPago('), 'la emisión tampoco lo calcula')

const carrito = readFileSync('src/services/monday/carritoSubitems.ts', 'utf8')
assert.ok(!carrito.includes('descFormaPago'), 'y el bulk del presupuesto ni lo conoce')

console.log('OK · el presupuesto no aplica descuento por forma de pago; el check sólo pide la leyenda')
