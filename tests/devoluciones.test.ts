/**
 * Reglas de la DEVOLUCIÓN de ventas (REMITO · DEVOLUCION): el rechazo de los biológicos, el plazo
 * de 30 días corridos, el consumo del remito más nuevo hacia atrás, las devoluciones sucesivas y
 * el armado de la nota de crédito.
 *
 * Se corre con esbuild + node (`npm run test:devoluciones`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import {
  construirNotasCredito,
  type PrecioLinea,
  DIAS_MAX_DEVOLUCION,
  diasCorridos,
  esBiologico,
  hayImputacion,
  hayLineasInvalidas,
  imputarDevolucion,
  lineaInvalida,
  notaCreditoAMonday,
  type RemitoEntrega,
} from '@/lib/devoluciones'

// ---------- Biológicos: no se aceptan, esté la marca en el rubro o en la categoría ----------
assert.equal(esBiologico({ rubro: 'BIOLOGICOS' }), true, 'rubro BIOLOGICOS → rechazado')
assert.equal(esBiologico({ categoria: 'BIOLOGICOS' }), true, 'categoría BIOLOGICOS → rechazado')
// Las dos columnas son multi-valor: la etiqueta puede venir entre otras.
assert.equal(
  esBiologico({ rubro: 'PROD VETERINARIOS, BIOLOGICOS' }),
  true,
  'la etiqueta puede venir entre otras',
)
// Con tilde y en minúsculas es el mismo rubro: la comparación normaliza.
assert.equal(esBiologico({ categoria: 'Biológicos' }), true, 'con tilde y minúsculas, igual')
assert.equal(esBiologico({ rubro: 'FERRETERIA', categoria: 'ALAMBRADOS' }), false, 'no biológico')
assert.equal(esBiologico({}), false, 'sin taxonomía no se asume nada')

// ---------- Días corridos ----------
assert.equal(diasCorridos('01/08/2026', '31/08/2026'), 30, '30 días corridos exactos')
assert.equal(diasCorridos('10/08/2026', '10/08/2026'), 0, 'el mismo día son 0 días')
assert.equal(diasCorridos('no es fecha', '10/08/2026'), null, 'sin fecha legible no hay plazo')
assert.equal(DIAS_MAX_DEVOLUCION, 30, 'el plazo del requerimiento son 30 días')

/* ---------- El ejemplo del requerimiento ----------
   Pamela devuelve 10 unidades del producto Z, y se consume del remito más nuevo hacia atrás:
   Rto A (6 entregadas) → 6; Rto B (2) → 2; Rto C (10) → lo que falte. */
const HOY = '20/08/2026'
const PRODUCTO = 'p-z'
const rto = (id: string, fecha: string, entregada: number, devuelta = 0): RemitoEntrega => ({
  id,
  nro: id,
  fecha,
  ventaIds: [`vta-${id}`],
  lineas: [{ subitemId: `sub-${id}`, productoId: PRODUCTO, entregada, devuelta }],
})
/** El precio y la factura de una línea, tal como los devuelve `getPreciosDeLineas`. */
const precio = (
  subitemId: string,
  precioUnitario: number,
  iva: number,
  vencimientoFactura?: string,
  extra: Partial<PrecioLinea> = {},
): PrecioLinea => ({ subitemId, precioUnitario, iva, vencimientoFactura, ...extra })
const z = { uid: 'u1', productoId: PRODUCTO, codigo: 'Z', nombre: 'Producto Z', um: 'Unidad' }

/* Los remitos llegan DESORDENADOS a propósito: el orden lo tiene que poner la imputación, no la
   consulta. */
const ejemplo = imputarDevolucion(
  [{ ...z, cantidad: 10 }],
  [rto('Rto B', '07/08/2026', 2), rto('Rto C', '09/06/2026', 10), rto('Rto A', '10/08/2026', 6)],
  HOY,
)[0]
/* "Rto C" es del 09/06 y a 72 días de HOY se pasa del plazo, así que sólo entran A (6) y B (2): 8
   de las 10 unidades. Las 2 que faltan NO se descuentan en silencio —se cargan sobre la última
   línea consumida, que queda por encima de lo que ese remito podía devolver— para que el operador
   tenga que corregirlas a mano antes de cerrar. */
assert.equal(ejemplo.imputada, 10, 'lo declarado por el operador se imputa entero')
assert.equal(ejemplo.sinCubrir, 0, 'no queda nada escondido como "sin cubrir"')
assert.deepEqual(
  ejemplo.lineas.map((l) => [l.remitoNro, l.imputada]),
  [
    ['Rto A', 6],
    ['Rto B', 4],
  ],
  'del más nuevo hacia atrás; el excedente cae sobre la última línea',
)
// Y esa última línea queda marcada: "Rto B" sólo había entregado 2 unidades.
assert.equal(lineaInvalida(ejemplo.lineas[0]), false, 'la primera línea está dentro de lo posible')
assert.equal(lineaInvalida(ejemplo.lineas[1]), true, 'la última excede lo que ese remito entregó')
assert.equal(hayLineasInvalidas([ejemplo]), true, 'y por eso la operación no se puede cerrar')
assert.deepEqual(
  ejemplo.descartados.map((d) => [d.remitoNro, d.motivo]),
  [['Rto C', 'PLAZO']],
  'el remito viejo se informa como descartado por plazo',
)
/* Se LISTA, pero no se imputa: ni en el reparto normal ni al cargarle el excedente a la última
   línea. Un remito fuera de plazo no puede recibir una sola unidad. */
const descartados = new Set(ejemplo.descartados.map((d) => d.remitoId))
assert.equal(
  ejemplo.lineas.some((l) => descartados.has(l.remitoId)),
  false,
  'ningún remito descartado recibe unidades',
)

// ---------- La regla de los 30 días es un borde, no una zona ----------
const enElBorde = imputarDevolucion(
  [{ ...z, cantidad: 5 }],
  // 21/07 → 30 días exactos (entra). 20/07 → 31 días (no entra).
  [rto('justo', '21/07/2026', 3), rto('tarde', '20/07/2026', 99)],
  HOY,
)[0]
// El remito de 30 días clavados entra; las 2 unidades que no cubre se le cargan igual, en rojo.
assert.equal(enElBorde.lineas[0].disponible, 3, 'a los 30 días clavados el remito todavía sirve')
assert.equal(enElBorde.imputada, 5, 'se imputa lo declarado, no lo que entraba')
assert.equal(hayLineasInvalidas([enElBorde]), true, 'la línea queda para corregir a mano')
assert.deepEqual(
  enElBorde.descartados.map((d) => d.remitoNro),
  ['tarde'],
  'a los 31 días el remito ya no es elegible',
)

// ---------- Ningún remito cumple el plazo: no se emite remito de devolución ----------
const todosVencidos = imputarDevolucion(
  [{ ...z, cantidad: 4 }],
  [rto('viejo', '01/01/2026', 50)],
  HOY,
)
assert.equal(todosVencidos[0].imputada, 0, 'sin remitos en plazo no se imputa nada')
assert.equal(hayImputacion(todosVencidos), false, 'y por lo tanto no hay devolución que emitir')

// ---------- Devoluciones sucesivas: lo ya devuelto no se vuelve a imputar ----------
const sucesiva = imputarDevolucion(
  [{ ...z, cantidad: 5 }],
  // Del más nuevo quedan 1 (6 entregadas − 5 ya devueltas); del siguiente, 4.
  [rto('nuevo', '10/08/2026', 6, 5), rto('previo', '05/08/2026', 4, 0)],
  HOY,
)[0]
assert.deepEqual(
  sucesiva.lineas.map((l) => [l.remitoNro, l.imputada]),
  [
    ['nuevo', 1],
    ['previo', 4],
  ],
  'de cada remito sólo se toma lo que todavía no se devolvió',
)
assert.equal(hayLineasInvalidas([sucesiva]), false, 'todo entró donde podía entrar')
// Una línea agotada no aparece ni como imputada ni como descartada: no aporta información.
const agotado = imputarDevolucion([{ ...z, cantidad: 2 }], [rto('lleno', '10/08/2026', 3, 3)], HOY)[0]
assert.equal(agotado.lineas.length, 0, 'el remito ya devuelto por completo no se lista')
assert.equal(agotado.descartados.length, 0, 'ni se informa como descartado')
/* Sin ninguna línea consumida no hay dónde cargar el excedente: ahí sí queda como sin cubrir. */
assert.equal(agotado.sinCubrir, 2, 'las 2 unidades quedan sin cubrir')
assert.equal(todosVencidos[0].sinCubrir, 4, 'lo mismo cuando ningún remito cumple el plazo')

// ---------- Varios productos en la misma devolución, cada uno con sus remitos ----------
const OTRO = 'p-w'
const mixto: RemitoEntrega = {
  id: 'Rto M',
  nro: 'Rto M',
  fecha: '12/08/2026',
  ventaIds: ['vta-M'],
  lineas: [
    { subitemId: 'sub-z', productoId: PRODUCTO, entregada: 3, devuelta: 0 },
    { subitemId: 'sub-w', productoId: OTRO, entregada: 8, devuelta: 0 },
  ],
}
const dos = imputarDevolucion(
  [
    { ...z, cantidad: 2 },
    { uid: 'u2', productoId: OTRO, codigo: 'W', nombre: 'Producto W', um: 'Litro', cantidad: 8 },
  ],
  [mixto],
  HOY,
)
assert.equal(dos[0].lineas[0].subitemId, 'sub-z', 'cada producto imputa contra SU línea del remito')
assert.equal(dos[1].lineas[0].subitemId, 'sub-w', 'y no contra la del otro producto')
assert.deepEqual([dos[0].imputada, dos[1].imputada], [2, 8], 'ambos quedan cubiertos')

/* ---------- La factura vencida saca a la línea de la imputación ----------
   No se acredita contra un comprobante que ya venció: esa línea no aporta unidades, se informa
   como descartada y lo que no cubre se carga sobre la última línea que sí entró. */
const conVencida = imputarDevolucion(
  [{ ...z, cantidad: 5 }],
  [rto('vigente', '10/08/2026', 2), rto('facturaVieja', '12/08/2026', 99)],
  HOY,
  [
    precio('sub-vigente', 100, 21, '30/09/2026', { origenId: 'v-vigente', origenNro: 'VTA-1' }),
    // Venció el 01/08, doce días antes de la devolución.
    precio('sub-facturaVieja', 100, 21, '01/08/2026', { origenId: 'v-vieja', origenNro: 'VTA-0' }),
  ],
)[0]
assert.deepEqual(
  conVencida.descartados.map((d) => [d.remitoNro, d.motivo]),
  [['facturaVieja', 'FACTURA_VENCIDA']],
  'el remito con la factura vencida queda afuera, aunque esté en plazo',
)
assert.deepEqual(
  conVencida.lineas.map((l) => [l.remitoNro, l.imputada]),
  [['vigente', 5]],
  'sólo imputa el de factura vigente; el excedente se le carga a él',
)
/* Remito POSTERIOR cuyo pendiente todavía no se facturó: NO se devuelve. Sin comprobante no hay
   contra qué acreditar, y su precio ni siquiera es el definitivo (el descuento por forma de pago
   se decide al facturar). El servicio la manda marcada con `sinFacturar`. */
const sinFacturar = imputarDevolucion(
  [{ ...z, cantidad: 2 }],
  [rto('posterior', '10/08/2026', 5)],
  HOY,
  [{ subitemId: 'sub-posterior', precioUnitario: 0, iva: 0, sinFacturar: true }],
)[0]
assert.equal(sinFacturar.imputada, 0, 'lo no facturado no se imputa')
assert.deepEqual(
  sinFacturar.descartados.map((d) => [d.remitoNro, d.motivo]),
  [['posterior', 'SIN_FACTURAR']],
  'y se informa con su propio motivo',
)
assert.equal(sinFacturar.sinCubrir, 2, 'las 2 unidades quedan sin cubrir')

/* ---------- UNA nota de crédito por factura ----------
   El ejemplo imputa contra dos remitos; si cada uno pertenece a una venta distinta, salen dos
   notas, cada una con su vencimiento y su venta enlazada. */
const notas = construirNotasCredito(
  [ejemplo],
  [
    precio('sub-Rto A', 100, 21, '30/09/2026', { origenId: 'v-016', origenNro: 'VTA-016' }),
    precio('sub-Rto B', 50, 10.5, '15/10/2026', { origenId: 'v-011', origenNro: 'VTA-011' }),
  ],
)
assert.equal(notas.length, 2, 'dos facturas, dos notas de crédito')
assert.deepEqual(
  notas.map((n) => [n.origenNro, n.vencimiento, n.lineas.length]),
  [
    ['VTA-016', '30/09/2026', 1],
    ['VTA-011', '15/10/2026', 1],
  ],
  'cada nota lleva su venta, su vencimiento y sus propias líneas',
)
// 6 × 100 + 21% de IVA; y 4 × 50 + 10,5%.
assert.equal(notas[0].totalPesos, 726, 'el total de la primera nota')
assert.equal(notas[1].totalPesos, 221, 'y el de la segunda')
assert.equal(notas[0].incompleta, false, 'las dos tienen precio')

// Dos remitos de la MISMA factura se acreditan en una sola nota.
const unaSola = construirNotasCredito(
  [ejemplo],
  [
    precio('sub-Rto A', 100, 21, '30/09/2026', { origenId: 'v-016', origenNro: 'VTA-016' }),
    precio('sub-Rto B', 100, 21, '30/09/2026', { origenId: 'v-016', origenNro: 'VTA-016' }),
  ],
)
assert.equal(unaSola.length, 1, 'misma venta, una sola nota')
assert.equal(unaSola[0].lineas.length, 2, 'con las dos líneas adentro')

// Una línea sin precio no se puede agrupar con nadie: queda en su nota, marcada como incompleta.
const sinPrecio = construirNotasCredito(
  [ejemplo],
  [precio('sub-Rto A', 100, 21, '30/09/2026', { origenId: 'v-016', origenNro: 'VTA-016' })],
)
assert.equal(sinPrecio.length, 2, 'la línea sin precio no se mezcla con la que sí lo tiene')
assert.equal(sinPrecio[1].incompleta, true, 'y su nota queda marcada')

/* ---------- En dólares, al cambio de la factura que corrige ---------- */
const enDolares = notaCreditoAMonday(
  construirNotasCredito(
    [ejemplo],
    [
      precio('sub-Rto A', 100, 21, '30/09/2026', { origenId: 'v-016', origenNro: 'VTA-016' }),
      precio('sub-Rto B', 10, 21, '30/09/2026', {
        origenId: 'v-016',
        origenNro: 'VTA-016',
        enDolares: true,
        tipoCambio: 1500,
      }),
    ],
  )[0],
)
assert.equal(enDolares.origenId, 'v-016', 'la nota se enlaza a su venta')
assert.equal(enDolares.vencimiento, '30/09/2026', 'con el vencimiento de esa factura')
assert.deepEqual(
  enDolares.lineas.map((l) => [l.cantidad, l.precioUnitario, l.subtotal, l.iva]),
  [
    // 6 × $100 en pesos, IVA 21% = $126.
    [6, 100, 600, 126],
    // 4 × u$10 al cambio de 1500 = $15.000 por unidad, $60.000 la línea, IVA $12.600.
    [4, 15_000, 60_000, 12_600],
  ],
  'los dólares se llevan a pesos al cambio de la factura que corrigen, IVA incluido',
)
assert.equal(enDolares.subtotal, 60_600, 'el subtotal es la suma de las líneas, ya en pesos')
assert.equal(enDolares.iva, 126 + 12_600, 'el IVA se suma de todas las líneas, convertido a pesos')
assert.equal(enDolares.total, 60_600 + 12_726, 'el total va con el IVA incluido')

console.log(
  'OK · biológicos, plazo, factura vencida, imputación por remito y una nota de crédito por factura',
)
