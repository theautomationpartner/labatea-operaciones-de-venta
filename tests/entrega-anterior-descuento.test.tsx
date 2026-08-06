/**
 * VENTA con entrega ANTERIOR: el descuento por FORMA DE PAGO tiene que aplicarse sobre los
 * productos pendientes de facturar.
 *
 * El remito ya salió, así que la línea no lleva descuento propio (no se edita). Pero la forma de
 * pago se elige en ese mismo paso, y su descuento rebaja el precio unitario de cada producto: de
 * ahí salen el subtotal, el IVA, la comisión y el TOTAL de la venta que se le cobra al cliente.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppProvider } from '@/state/AppProvider'
import { TablaProductos, type FilaProducto } from '@/features/productos/TablaProductos'
import { descuentoUnitario, netoLinea } from '@/lib/descuentos'
import { money, round2 } from '@/lib/format'
import { resumenFactura, totalVentaOperacion } from '@/lib/selectors'
import type { Cliente, FacturaItem } from '@/types'

const FP = 6 // % de descuento por forma de pago

const items: FacturaItem[] = [
  {
    uid: 'r1-0',
    nombre: 'AGUA OXIGENADA',
    codigo: '2294',
    cantRemito: 5,
    cantFacturada: 0,
    pendiente: 5,
    aFacturar: 3,
    precio: 10000,
    rent: 40,
    iva: 21,
    comisionable: true,
  },
  {
    uid: 'r1-1',
    nombre: 'TRAJE DE AGUA',
    codigo: '3278',
    cantRemito: 2,
    cantFacturada: 0,
    pendiente: 2,
    aFacturar: 2,
    precio: 8000,
    rent: 30,
    iva: 21,
    comisionable: false,
  },
]

const cliente = { limit: 0, disponible: 0 } as unknown as Cliente

// Descuento total por unidad, con la fórmula compartida (sin descuento de línea).
const dtoUnit = (precio: number) => descuentoUnitario(precio, 0, FP).total
const neto = (it: FacturaItem) => netoLinea(it.precio, it.aFacturar, 0, FP)

// ---------- El resumen del paso ----------
const sin = resumenFactura(items, cliente, 0, 10, 0)
const con = resumenFactura(items, cliente, 0, 10, FP)

const bruto = round2(items.reduce((acc, it) => acc + it.precio * it.aFacturar, 0))
assert.equal(sin.subtotal, bruto, 'el bruto no depende de la forma de pago')
assert.equal(con.subtotal, bruto, 'el bruto no debería cambiar con el descuento')
assert.equal(sin.descuento, 0, 'sin forma de pago no hay descuento')
assert.equal(
  con.descuento,
  round2(items.reduce((acc, it) => acc + dtoUnit(it.precio) * it.aFacturar, 0)),
  'el descuento no es la bonificación por forma de pago de cada línea',
)
assert.equal(
  con.neto,
  round2(items.reduce((acc, it) => acc + neto(it), 0)),
  'el neto no aplica el descuento por forma de pago',
)
assert.equal(round2(con.subtotal - con.descuento), con.neto, 'Subtotal − Descuento ≠ Neto')
assert.ok(con.neto < sin.neto, 'el descuento por forma de pago no bajó el neto')
// El IVA se liquida sobre el importe YA bonificado, con la alícuota de cada producto.
assert.equal(con.iva, round2(con.neto * 0.21), 'el IVA no sale del neto bonificado')
assert.ok(con.iva < sin.iva, 'el IVA sigue calculándose sobre el bruto')
// "TOTAL A FACTURAR" = gravado + IVA. No puede ser el neto pelado.
assert.equal(con.total, round2(con.neto + con.iva), 'el TOTAL a facturar no incluye el IVA')
assert.ok(con.total > con.neto, 'el TOTAL a facturar sigue siendo el neto sin IVA')
// La comisión (10%) sólo cuenta el producto comisionable, sobre su neto bonificado.
assert.equal(con.comision, round2(neto(items[0]) * 0.1), 'la comisión no usa el neto bonificado')
// La rentabilidad general baja: se cobra menos por la misma mercadería.
assert.ok(con.rentabilidad < sin.rentabilidad, 'la rentabilidad ignora el descuento')

// ---------- El TOTAL de la venta que se le cobra al cliente ----------
const datos = {
  cliente,
  operacion: 'VENTA' as const,
  tipoVenta: 'DIRECTA' as const,
  tipoEntrega: 'ANTERIOR' as const,
  lineas: [],
  ventaItems: [],
  facturaItems: items,
  proformaImporte: null,
}
const totalSin = totalVentaOperacion({ ...datos, descFormaPago: 0 })
const totalCon = totalVentaOperacion({ ...datos, descFormaPago: FP })
assert.equal(totalCon.neto, con.neto, 'el TOTAL VENTA no usa el mismo neto que el resumen del paso')
assert.ok(totalCon.total < totalSin.total, 'el TOTAL VENTA ignora el descuento por forma de pago')
// El TOTAL VENTA del cobro y el TOTAL A FACTURAR de este paso son el mismo número.
assert.equal(totalCon.total, con.total, 'TOTAL VENTA y TOTAL A FACTURAR divergen')

// ---------- Lo que renderiza la tabla "Productos a facturar" ----------
const filas: FilaProducto[] = items.map((it) => ({
  id: it.uid,
  codigo: it.codigo,
  nombre: it.nombre,
  cantidad: it.aFacturar,
  precio: it.precio,
  descuento: 0,
  rentabilidad: it.rent,
}))
const html = renderToStaticMarkup(
  createElement(
    AppProvider,
    null,
    createElement(TablaProductos, {
      titulo: 'Productos a facturar',
      filas,
      onRemove: () => {},
      descFormaPago: FP,
    }),
  ),
)
for (const it of items) {
  assert.ok(
    html.includes(money(dtoUnit(it.precio))),
    `la fila no muestra el descuento por forma de pago (${it.codigo})`,
  )
  assert.ok(
    html.includes(money(round2(it.precio - dtoUnit(it.precio)))),
    `la fila no muestra el precio unitario ya rebajado (${it.codigo})`,
  )
  assert.ok(html.includes(money(neto(it))), `el subtotal de la fila no está bonificado (${it.codigo})`)
}

console.log('OK · la entrega ANTERIOR aplica el descuento por forma de pago')
