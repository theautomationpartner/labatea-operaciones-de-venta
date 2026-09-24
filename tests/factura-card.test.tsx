/**
 * La card "Comprobante a generar" tiene que decir exactamente lo mismo que la lista "Productos
 * seleccionados" de la etapa anterior, y lo que se escribe en el board tiene que reproducir esos
 * mismos números al pasar por las fórmulas del subelemento de Facturación (18422405734):
 *
 *   Subtotal $ = (Cantidad × Precio Unitario $) − Importe Bonif $
 *   IVA $      = Subtotal $ × (Alícuota IVA % / 100)
 *   Total $    = Subtotal $ + IVA $
 *
 * Por eso "Precio Unitario $" lleva el precio de LISTA y el descuento viaja aparte: si fuera el
 * precio ya bonificado, la fórmula del board restaría el descuento dos veces.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComprobantesAGenerar } from '@/features/factura/ComprobantesAGenerar'
import { bonificacionLinea, netoLinea as netoConDescuento } from '@/lib/descuentos'
import { bonifLinea, comprobantesDeVenta, netoLinea } from '@/lib/facturacion'
import { money, trunc2 } from '@/lib/format'
import { resumenPresupuesto } from '@/lib/selectors'
import type { LineaVenta } from '@/services/monday/venta'
import type { LineaPresupuesto, Producto } from '@/types'

/** % de descuento por forma de pago de la operación: se compone con el manual de cada línea. */
const FP = 6

const catalogo = [
  { codigo: '2294', nombre: 'AGUA OXIGENADA', precio: 10000, rent: 40, um: 'Kilos', cant: 3, desc: 0 },
  { codigo: '3278', nombre: 'TRAJE DE AGUA', precio: 8000, rent: 30, um: 'Unidad', cant: 2, desc: 5 },
]

// Las mismas líneas, en las dos formas que usa la app.
const lineasVenta: LineaVenta[] = catalogo.map((p) => ({
  nombre: p.nombre,
  codigo: p.codigo,
  cantidad: p.cant,
  precioUnitario: p.precio,
  descuento: p.desc,
  rentabilidad: p.rent,
  um: p.um,
  iva: 21,
}))
const lineasProductos: LineaPresupuesto[] = catalogo.map((p, i) => ({
  id: `l${i}`,
  cantidad: p.cant,
  descuento: p.desc,
  producto: {
    codigo: p.codigo,
    nombre: p.nombre,
    precio: p.precio,
    rentabilidad: p.rent,
    iva: 21,
  } as unknown as Producto,
}))

const [comp] = comprobantesDeVenta(lineasVenta, FP)
const resumen = resumenPresupuesto(lineasProductos, true, FP)

// ---------- El pie de la card = el resumen de la selección de productos ----------
assert.equal(comp.bruto, resumen.subtotal, 'el Subtotal de la card no es el de la selección')
assert.equal(comp.descuento, resumen.descuento, 'el Descuento de la card no es el de la selección')
assert.equal(comp.subtotal, resumen.neto, 'el Gravado de la card no es el de la selección')
assert.equal(comp.iva, resumen.iva, 'el IVA de la card no es el de la selección')
assert.equal(comp.total, resumen.total, 'el TOTAL de la card no es el de la selección')
// El descuento del pie es la suma de la columna Imp.Bonif, no una diferencia calculada aparte.
assert.equal(
  comp.descuento,
  trunc2(lineasVenta.reduce((acc, l) => acc + bonifLinea(l, FP), 0)),
  'el Descuento del pie no suma la columna Imp.Bonif',
)
assert.equal(trunc2(comp.bruto - comp.descuento), comp.subtotal, 'Subtotal − Descuento ≠ Gravado')

// ---------- Las fórmulas del board sobre lo que se escribe en cada subelemento ----------
let subtotalBoard = 0
for (const l of lineasVenta) {
  // Lo que va a las columnas: cantidad, precio de LISTA y la bonificación de la línea entera.
  const cantidad = l.cantidad
  const precioUnit = trunc2(l.precioUnitario)
  const importeBonif = bonificacionLinea(l.precioUnitario, l.cantidad, l.descuento, FP)
  // formula_mm2kwwvk, tal cual está definida en el board.
  const subtotal = trunc2(cantidad * precioUnit - importeBonif)
  assert.equal(
    subtotal,
    netoLinea(l, FP),
    `el Subtotal $ del board no da la columna Subtotal de la card (${l.codigo})`,
  )
  assert.equal(
    subtotal,
    netoConDescuento(l.precioUnitario, l.cantidad, l.descuento, FP),
    `el Subtotal $ del board no da el subtotal de la selección de productos (${l.codigo})`,
  )
  subtotalBoard = trunc2(subtotalBoard + subtotal)
}
assert.equal(subtotalBoard, comp.subtotal, 'la suma de los subelementos no da el Gravado de la card')

// ---------- Lo que efectivamente renderiza la card ----------
const html = renderToStaticMarkup(
  createElement(ComprobantesAGenerar, {
    comprobantes: [comp],
    descFormaPago: FP,
    letra: 'B' as const,
    puntoVenta: '0000',
    fechaEmision: '05/08/2026',
    venceAPlazo: false,
    dias: {},
    emitidos: new Map(),
    emitiendo: false,
  }),
)

for (const th of ['Cant.', 'U.Medida', 'Unitario', 'Imp.Bonif', 'Subtotal']) {
  assert.ok(html.includes(`>${th}<`), `falta la columna "${th}" en la card`)
}
for (const l of lineasVenta) {
  assert.ok(html.includes(`>${l.um}<`), `la fila no muestra la unidad de venta (${l.codigo})`)
  assert.ok(html.includes(money(l.precioUnitario)), `el Unitario no es el de lista (${l.codigo})`)
  assert.ok(html.includes(money(bonifLinea(l, FP))), `el Imp.Bonif no es el esperado (${l.codigo})`)
  assert.ok(html.includes(money(netoLinea(l, FP))), `el Subtotal no es el esperado (${l.codigo})`)
}
// El bruto de la línea NO puede aparecer como subtotal: eso era la card sin bonificar.
assert.ok(!html.includes(money(30000)), 'la columna Subtotal sigue mostrando el bruto de la línea')

/* ---------- El estado de cada card mientras se emite ----------
   Todas las cards de la venta se emiten en la MISMA solicitud, así que están en curso a la vez:
   común y consignada tienen que mostrar lo mismo. Y lo que muestran es la animación compartida de
   la app (`fa-circle-notch spin`), sin la palabra "Emitiendo…" al lado: el anillo girando ya lo
   dice, y el texto movía el ancho de la cabecera al aparecer y desaparecer. */
const conDosCards = comprobantesDeVenta(
  [
    ...lineasVenta,
    { ...lineasVenta[0], tipoMercaderia: 'CO', proveedorId: '9', proveedorNombre: 'PROVEEDOR TEST' },
  ],
  FP,
)
assert.equal(conDosCards.length, 2, 'el caso necesita una card común y una consignada')

const enEstado = (emitiendo: boolean, emitidos: Map<string, never>) =>
  renderToStaticMarkup(
    createElement(ComprobantesAGenerar, {
      comprobantes: conDosCards,
      descFormaPago: FP,
      letra: 'B' as const,
      puntoVenta: '0000',
      fechaEmision: '05/08/2026',
      venceAPlazo: false,
      dias: {},
      emitidos,
      emitiendo,
    }),
  )

const emitiendoHtml = enEstado(true, new Map())
/* Sin los atributos: el `aria-label` del spinner SÍ nombra el estado —un anillo girando sin nombre
   accesible no le dice nada a un lector de pantalla—, pero en pantalla no se lee nada. */
const visible = emitiendoHtml.replace(/<[^>]+>/g, ' ')
assert.ok(
  !/Emitiendo/.test(visible),
  'la palabra "Emitiendo" no va más en las cards: la animación ya lo dice',
)
assert.ok(
  /aria-label="Emitiendo la factura"/.test(emitiendoHtml),
  'pero el spinner conserva su nombre accesible',
)
assert.equal(
  (emitiendoHtml.match(/fa-circle-notch spin/g) ?? []).length,
  2,
  'las DOS cards —común y consignada— muestran la animación compartida mientras se emite',
)
assert.ok(
  !/class="cobro-ok/.test(emitiendoHtml),
  'y mientras gira no se muestra el tilde: son estados distintos, no superpuestos',
)

// En reposo y ya emitida NO hay animación: el tilde vuelve a su lugar.
for (const [caso, html] of [
  ['en reposo', enEstado(false, new Map())],
  ['ya emitida', enEstado(false, new Map())],
] as const) {
  assert.ok(!/fa-circle-notch/.test(html), `${caso}: no tiene que haber animación`)
  assert.ok(/class="cobro-ok/.test(html), `${caso}: el tilde ocupa el lugar del estado`)
}

/* El hueco es el mismo en los dos estados, o la cabecera salta al terminar de emitir. */
const estilos = readFileSync('src/styles/factura.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const spin = estilos.slice(estilos.indexOf('.comp-estado-spin'))
assert.ok(/width: 24px/.test(spin.slice(0, 200)), '.comp-estado-spin mide lo mismo que el tilde')

console.log('OK · la card de factura refleja la selección de productos y las fórmulas del board')
console.log('OK · mientras se emite, las dos cards giran la animación compartida y sin texto')
