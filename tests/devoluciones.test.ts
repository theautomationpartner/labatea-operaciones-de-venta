/**
 * Reglas de la DEVOLUCIÓN de ventas (REMITO · DEVOLUCION): el rechazo de los biológicos, el plazo
 * de 30 días corridos, el consumo del remito más nuevo hacia atrás, las devoluciones sucesivas y
 * el armado de la nota de crédito.
 *
 * Se corre con esbuild + node (`npm run test:devoluciones`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import {
  construirNotaCredito,
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
/** El precio con el que se vendió una línea, tal como lo devuelve `getPreciosDeLineas`. */
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

// ---------- Nota de crédito: precio de la venta de CADA remito imputado ----------
const nc = construirNotaCredito(
  [ejemplo],
  [
    // Factura todavía vigente: la NC vence cuando vence ella.
    precio('sub-Rto A', 100, 21, '30/09/2026', { ventaNro: 'VTA-016' }),
    // Factura YA vencida: se toma el vencimiento del día.
    precio('sub-Rto B', 50, 10.5, '01/07/2026', { ventaNro: 'VTA-011' }),
  ],
  HOY,
)
assert.equal(nc.lineas.length, 2, 'una línea de NC por remito imputado')
const [ncA, ncB] = nc.lineas
assert.equal(ncA.total, 726, '6 × 100 + 21% de IVA')
assert.equal(ncA.vencimiento, '30/09/2026', 'la NC vence con la factura de su venta')
assert.equal(ncA.vencimientoDelDia, false, 'la factura seguía vigente')
assert.equal(ncB.vencimiento, HOY, 'factura vencida → vencimiento del día')
assert.equal(ncB.vencimientoDelDia, true, 'y se marca como tal')
// 4 × 50 = 200, más 10,5% de IVA.
assert.equal(ncB.total, 221, 'la segunda línea acredita las 4 unidades que se le imputaron')
assert.equal(nc.totalPesos, 726 + 221, 'el total suma las dos líneas en pesos')
assert.equal(nc.incompleta, false, 'las dos líneas tienen precio')

// ---------- En dólares: la NC hereda el tipo de cambio de la factura ORIGINAL ----------
const ncUsd = construirNotaCredito(
  [ejemplo],
  [precio('sub-Rto A', 12, 21, '30/09/2026', { enDolares: true, tipoCambio: 1200 })],
  HOY,
)
const enUsd = ncUsd.lineas[0]
assert.equal(enUsd.moneda, 'Dólares', 'la línea conserva la moneda del comprobante')
assert.equal(enUsd.tipoCambio, 1200, 'con el tipo de cambio de la factura original, no el del día')
assert.equal(ncUsd.totalDolares, 87.12, '6 × 12 + 21% de IVA, en dólares')
assert.equal(ncUsd.totalPesos, 0, 'nada cae en el total en pesos')
// La línea sin precio conocido queda marcada: la NC no se puede emitir así.
assert.equal(ncUsd.lineas[1].sinPrecio, true, 'sin la venta de esa línea no hay precio')
assert.equal(ncUsd.incompleta, true, 'y la NC queda marcada como incompleta')

/* ---------- El MISMO producto dos veces en el MISMO remito, desde dos ventas ----------
   Es el caso que obliga a que el precio se resuelva por LÍNEA y no por producto: el remito
   consolidó dos pendientes del mismo producto, cada uno de una venta con su propio precio. */
const dosVentas: RemitoEntrega = {
  id: 'Rto D',
  nro: 'Rto D',
  fecha: '15/08/2026',
  ventaIds: ['vta-cara', 'vta-barata'],
  lineas: [
    // Se listan con la cara primero para que el orden de las líneas no sea el que "acierta".
    { subitemId: 'sub-cara', productoId: PRODUCTO, entregada: 4, devuelta: 0, ventaSubitemId: 'vs-cara' },
    { subitemId: 'sub-barata', productoId: PRODUCTO, entregada: 6, devuelta: 0, ventaSubitemId: 'vs-barata' },
  ],
}
const consolidado = imputarDevolucion([{ ...z, cantidad: 10 }], [dosVentas], HOY)[0]
assert.equal(consolidado.lineas.length, 2, 'las dos líneas del remito se imputan por separado')
assert.deepEqual(
  consolidado.lineas.map((l) => [l.subitemId, l.imputada]),
  [
    ['sub-cara', 4],
    ['sub-barata', 6],
  ],
  'cada línea aporta lo suyo',
)

const ncDos = construirNotaCredito(
  [consolidado],
  [
    precio('sub-cara', 1000, 21, '30/09/2026', { ventaNro: 'VTA-100' }),
    precio('sub-barata', 400, 21, '30/09/2026', { ventaNro: 'VTA-050' }),
  ],
  HOY,
)
assert.deepEqual(
  ncDos.lineas.map((l) => [l.ventaNro, l.cantidad, l.precioUnitario]),
  [
    ['VTA-100', 4, 1000],
    ['VTA-050', 6, 400],
  ],
  'cada línea se acredita al precio de SU venta, no a uno solo para el producto',
)
// 4×1000 + 6×400 = 6400, más 21% de IVA.
assert.equal(ncDos.totalPesos, 7744, 'el total mezcla los dos precios, cada uno por su cantidad')

/* ---------- La nota de crédito, tal como se escribe en el tablero ----------
   El board es mono-moneda ("$"), así que las líneas en dólares se convierten con el tipo de cambio
   de SU factura original —no con el del día— y el vencimiento del documento es el más temprano. */
const aEmitir = notaCreditoAMonday(
  construirNotaCredito(
    [ejemplo],
    [
      precio('sub-Rto A', 100, 21, '30/09/2026', { ventaNro: 'VTA-016' }),
      precio('sub-Rto B', 10, 21, '15/09/2026', { enDolares: true, tipoCambio: 1500 }),
    ],
    HOY,
  ),
)
assert.equal(aEmitir.vencimiento, '15/09/2026', 'vence con la primera de sus facturas')
assert.deepEqual(
  aEmitir.lineas.map((l) => [l.cantidad, l.precioUnitario, l.subtotal, l.iva]),
  [
    // 6 × $100 en pesos, IVA 21% = $126.
    [6, 100, 600, 126],
    // 4 × u$10 al cambio de 1500 = $15.000 por unidad, $60.000 la línea, IVA $12.600.
    [4, 15_000, 60_000, 12_600],
  ],
  'los dólares se llevan a pesos al cambio de la factura que corrigen, IVA incluido',
)
assert.equal(aEmitir.subtotal, 60_600, 'el subtotal es la suma de las líneas, ya en pesos')
/* El IVA del documento es la suma del de sus líneas ($126 + $12.600), y el TOTAL lo incluye,
   como en el resto de los documentos de la app. */
assert.equal(aEmitir.iva, 126 + 12_600, 'el IVA se suma de todas las líneas, convertido a pesos')
assert.equal(aEmitir.total, 60_600 + 12_726, 'el total va con el IVA incluido')

// Una línea sin precio NO se acredita: emitir una nota en cero es peor que no emitirla.
const incompleta = notaCreditoAMonday(
  construirNotaCredito([ejemplo], [precio('sub-Rto A', 100, 21, '30/09/2026')], HOY),
)
assert.equal(incompleta.lineas.length, 1, 'la línea sin precio queda afuera')
assert.equal(incompleta.subtotal, 600, 'y no suma nada al subtotal')
assert.equal(incompleta.iva, 126, 'ni al IVA')

console.log('OK · biológicos, plazo de 30 días, imputación por remito y nota de crédito')
