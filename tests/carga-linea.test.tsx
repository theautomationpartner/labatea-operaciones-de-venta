/**
 * Card del producto elegido: estructura en dos filas de dos columnas y los importes que muestra.
 *
 * Se renderiza con `react-dom/server` (no hay runner de DOM): alcanza para verificar qué queda
 * montado, con qué clases y con qué valores. Los cálculos de la conversión %↔$ se verifican
 * contra las fórmulas compartidas de `lib/descuentos`, que es de donde salen.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppProvider } from '@/state/AppProvider'
import { CargaLinea } from '@/features/productos/CargaLinea'
import { descuentoCompuesto, descuentoUnitario } from '@/lib/descuentos'
import { money, pctDec, round2 } from '@/lib/format'
import { rentabilidadEfectiva } from '@/lib/selectors'
import type { Producto } from '@/types'

const PRECIO = 89440.15
const FP = 6

const producto = {
  codigo: '2294',
  nombre: 'AGUA OXIGENADA 250 VOL. X 25 Kgs.',
  precio: PRECIO,
  rentabilidad: 32,
  iva: 21,
  fisico: 0,
  comercial: 0,
  disponible: 0,
  provCod: '',
  provNombre: '',
  tipo: 'COM',
  moneda: 'ARS',
} as unknown as Producto

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(
      AppProvider,
      null,
      createElement(CargaLinea, {
        producto,
        onAdd: () => {},
        descFormaPago: FP,
        ...props,
      } as never),
    ),
  )

const html = render()

// ---------- Estructura: dos filas de dos columnas ----------
for (const bloque of ['cl-top', 'cl-info', 'cl-oper', 'cl-mid', 'cl-resumen', 'cl-bottom', 'cl-stock']) {
  assert.ok(html.includes(bloque), `falta el bloque "${bloque}"`)
}
const orden = (...clases: string[]) => clases.map((c) => html.indexOf(c))
const enOrden = (ix: number[]) => ix.every((n, i) => n >= 0 && (i === 0 || n > ix[i - 1]))
// Fila 1: ficha | (inputs sobre el resumen). Fila 2: detalle | stock.
assert.ok(
  enOrden(orden('cl-top', 'cl-info', 'cl-oper', 'cl-mid', 'cl-resumen', 'cl-bottom')),
  'las dos filas están desordenadas',
)
// El stock bajó a la fila inferior, a la derecha del "Detalle".
assert.ok(html.indexOf('cl-bottom') < html.indexOf('cl-stock'), 'el stock no bajó a la fila 2')
assert.ok(html.indexOf('lindet-fin') < html.indexOf('cl-stock'), 'el stock debe ir tras el Detalle')
// Los campos y el botón quedaron arriba, donde antes estaba el stock.
assert.ok(html.indexOf('id="pdesc"') < html.indexOf('cl-bottom'), 'los campos no subieron')
assert.ok(html.indexOf('Agregar') < html.indexOf('cl-bottom'), 'el botón no subió con el resumen')

// ---------- MÓDULO 1: ficha del producto y stock ----------
assert.ok(html.includes(producto.nombre), 'falta el nombre del producto')
assert.ok(html.includes('Código 2294'), 'falta el código')
assert.ok(html.includes('Precio Unitario'), 'falta el precio unitario')
assert.ok(html.includes('Rentabilidad'), 'falta la rentabilidad')
// Sub-card del precio actual, con la descripción exacta pedida, UNA sola vez y en la fila de
// operación (reemplaza al input de "Precio Actual", que ya no existe).
assert.ok(html.includes('Precio Actual'), 'falta la sub-card del precio actual')
assert.equal(
  html.split('[Con Desc x Forma de Pago incluido]').length - 1,
  1,
  'la sub-card del precio actual está duplicada (o falta)',
)
assert.ok(!html.includes('id="pprice"'), 'quedó el input de Precio Actual')
assert.ok(
  html.indexOf('cl-mid') < html.indexOf('cl-subcard') &&
    html.indexOf('cl-subcard') < html.indexOf('id="pdesc"'),
  'la sub-card debe abrir la fila de operación, a la izquierda de los descuentos',
)
// Precio actual = precio de lista − descuento por forma de pago.
const soloFp = descuentoUnitario(PRECIO, 0, FP)
assert.equal(soloFp.formaPago, round2((PRECIO * FP) / 100), 'monto del pronto pago')
assert.ok(html.includes(money(soloFp.precioFinal)), 'la sub-card no muestra el precio actual')
// Columna de stock: título, las tres cajas y la barra de cobertura.
assert.ok(html.includes('Stock</h4>'), 'falta el encabezado "Stock"')
for (const caja of ['Stock físico', 'Stock comercial', 'Stock disponible']) {
  assert.ok(html.includes(caja), `falta la caja "${caja}"`)
}
assert.ok(html.includes('cov-bar'), 'falta la barra de cobertura')
assert.ok(html.includes('stock-tipo'), 'se perdió el tipo de mercadería')

// ---------- Fila de operación: la cuenta ----------
assert.ok(html.includes('id="pdesc"'), 'falta el campo Descuento (%)')
assert.ok(html.includes('id="pdescm"'), 'falta el campo Descuento ($)')
assert.ok(html.includes('>=<'), 'falta el igual entre los descuentos y el resultado')
assert.ok(html.includes('cl-cardfin'), 'falta la card del precio unitario final')
assert.ok(html.includes('Precio Unitario Final'), 'falta el rótulo del precio unitario final')
// Orden de la cuenta: precio actual → % → $ → = → resultado.
assert.ok(
  enOrden(orden('cl-subcard', 'id="pdesc"', 'id="pdescm"', 'cl-igual', 'cl-cardfin')),
  'la cuenta de la fila de operación está desordenada',
)

// ---------- Resumen: cantidad, descuento total, rentabilidad, subtotal y acción ----------
assert.ok(html.includes('id="pqty"'), 'falta el campo Cantidad')
assert.ok(html.includes('Rentabilidad Final'), 'falta la rentabilidad final en el resumen')
assert.ok(
  enOrden(orden('cl-resumen', 'id="pqty"', 'Descuento Total', 'Rentabilidad Final', 'Subtotal')),
  'el resumen está desordenado',
)
// El subtotal se lee 1px más grande que el resto de los importes del resumen.
assert.ok(html.includes('cl-metric-v--sub'), 'al subtotal le falta su tamaño propio')

/* Las DOS rentabilidades dicen cosas distintas: la de la ficha es la de CATÁLOGO y no se mueve al
   bonificar; la "Rentabilidad Final" del resumen es la que baja con el descuento total. Mostrar la
   bonificada en las dos las volvía la misma métrica repetida. */
const rentDe = (h: string, marca: string, clase: string) =>
  h.match(new RegExp(`${marca}</span><span class="${clase}"[^>]*>(.*?)<`))?.[1]
const rentFicha = (h: string) => rentDe(h, 'Rentabilidad', 'cl-kpi-v')
const rentFinal = (h: string) => rentDe(h, 'Rentabilidad Final', 'cl-metric-v')

assert.equal(rentFicha(html), pctDec(producto.rentabilidad), 'la ficha debe mostrar la de catálogo')
assert.notEqual(
  rentFinal(html),
  rentFicha(html),
  'con descuento por forma de pago las dos rentabilidades no pueden coincidir',
)
assert.equal(
  rentFinal(html),
  pctDec(rentabilidadEfectiva(producto.rentabilidad, descuentoCompuesto(0, FP))),
  'la Rentabilidad Final no aplica el descuento total',
)
// Sin ningún descuento, las dos coinciden: no hay bonificación que las separe.
const sinDto = render({ descFormaPago: 0 })
assert.equal(rentFicha(sinDto), pctDec(producto.rentabilidad), 'sin descuento, la ficha no cambia')
assert.equal(rentFinal(sinDto), rentFicha(sinDto), 'sin descuento las dos tienen que coincidir')

// ---------- Detalle ----------
assert.ok(html.includes('Dto. Forma de Pago'), 'falta el desglose de la forma de pago')
assert.ok(html.includes('Dto. por Precio'), 'falta el desglose del descuento manual')
assert.ok(html.includes('Descuento Total'), 'falta el descuento total')
assert.ok(html.includes('Equivale a 1 unidad'), 'falta el pie del subtotal')
assert.ok(html.includes('Agregar'), 'falta el botón de acción')
// El botón cierra el resumen, a la derecha de las métricas.
assert.ok(
  html.indexOf('cl-resumen') < html.indexOf('Agregar'),
  'el botón Agregar no está dentro del resumen',
)

// Con el producto recién elegido (sin descuento manual) el precio final es el precio actual.
assert.ok(html.includes(money(soloFp.precioFinal)), 'el precio final unitario no coincide')

// ---------- Equivalencia %↔$ del descuento manual ----------
/* El campo en pesos es el mismo descuento que el %, calculado sobre el PRECIO ACTUAL: teclear
   uno tiene que dar exactamente el otro (ida y vuelta), que es lo que hace la card. */
const precioActual = soloFp.precioFinal
for (const pct of [1, 2.5, 5]) {
  const enPesos = round2((precioActual * pct) / 100)
  assert.equal(descuentoUnitario(PRECIO, pct, FP).manual, enPesos, `${pct}% en pesos`)
  assert.equal(round2((enPesos / precioActual) * 100), pct, `${enPesos} pesos en %`)
}

// ---------- Remito: documento logístico, sin datos financieros ----------
const remito = render({ showFinancialData: false, descFormaPago: 0 })
assert.ok(remito.includes('id="pqty"'), 'el remito necesita la cantidad')
for (const campo of ['cl-subcard', 'id="pdesc"', 'id="pdescm"', 'cl-cardfin']) {
  assert.ok(!remito.includes(campo), `el remito no debería traer ${campo}`)
}
assert.ok(!remito.includes('Dto. Forma de Pago'), 'el remito no liquida descuentos')
assert.ok(!remito.includes('Subtotal'), 'el remito no muestra importes')
assert.ok(remito.includes('Agregar'), 'el remito sí necesita el botón')
assert.ok(remito.includes('cov-bar'), 'el remito sí muestra el stock')

// ---------- Sin producto: la card queda en su lugar, anunciando ----------
const vacio = render({ producto: null })
assert.ok(vacio.includes('selected-product-box--vacio'), 'falta el estado vacío')
assert.ok(vacio.includes('Ningún producto seleccionado'), 'falta el texto del estado vacío')
assert.ok(vacio.includes('stock-placeholder'), 'falta el aviso de stock del estado vacío')

console.log('OK · card de producto en dos filas de dos columnas')
