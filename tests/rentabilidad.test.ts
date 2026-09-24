/**
 * La RENTABILIDAD de un producto es la cuenta que definió el comercio (planilla "cálculo de
 * rentab"):
 *
 *   Resultado bruto = Precio de venta S/IVA − Costo Final − Flete
 *   Rentabilidad %  = Resultado bruto / Costo Final × 100
 *
 * El flete se resta del resultado pero NO entra en el denominador; todo va SIN IVA; y los
 * descuentos bajan el precio, no el costo ni el flete. Este test fija las tres reglas con el caso
 * de la planilla, y además el error que la planilla marca: sin restar el flete, la rentabilidad da
 * 23,17% en vez de 23,00% —el flete se cuenta como ganancia—.
 *
 * Se corre con esbuild + node (`npm run test:rentabilidad`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { trunc2 } from '@/lib/format'
import { productoConPrecio } from '@/lib/precios'
import {
  costoDe,
  precioDaPerdida,
  rentabilidadConDescuento,
  rentabilidadDe,
  rentabilidadItemPresupuesto,
  rentabilidadItemRemito,
  rentabilidadProductoDe,
} from '@/lib/selectors'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.equal(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}

/* ---------- 1) El caso de la planilla ---------- */

console.log('Caso 1 · El ejemplo de la planilla:')

const COSTO = 102_162.35
const FLETE = 175
const MARGEN_L1 = 23
/** Precio L1 del maestro: ROUND(Costo + Flete + Costo × Margen L1, 3). */
const PRECIO_L1 = Math.round((COSTO + FLETE + COSTO * (MARGEN_L1 / 100)) * 1000) / 1000

// El maestro redondea a 3 decimales; la planilla lo muestra a 2 (125.834,69).
igual(PRECIO_L1, 125_834.691, 'el precio L1 se arma como Costo + Flete + Costo × Margen')
igual(rentabilidadDe(PRECIO_L1, COSTO, FLETE), 23, 'la rentabilidad es 23,00%: el Margen L1 tal cual')
igual(
  trunc2(((PRECIO_L1 - COSTO) / COSTO) * 100),
  23.17,
  'la cuenta vieja —sin restar el flete— daba 23,17% (el error que marca la planilla)',
)
igual(rentabilidadDe(PRECIO_L1, COSTO), 23.17, 'y es lo que da la fórmula si se le olvida el flete')
igual(
  trunc2(((PRECIO_L1 - COSTO - FLETE) / (COSTO + FLETE)) * 100),
  22.96,
  'dividir por Costo + Flete también da mal (22,96%): el flete NO va en el denominador',
)

/* ---------- 2) Un descuento baja el precio, no el costo ni el flete ---------- */

console.log('\nCaso 2 · Descuentos (L2/L3 y los de la operación):')

/* L2 = L1 × (1 − Descuento L2). Con 10%: 125.834,69 × 0,9 = 113.251,22.
   Resultado = 113.251,22 − 102.162,35 − 175 = 10.913,87 → 10.913,87 / 102.162,35 = 10,68% */
igual(
  rentabilidadConDescuento(PRECIO_L1, COSTO, FLETE, 10),
  10.68,
  'L1 con 10% de descuento rinde 10,68% (el flete se sigue pagando entero)',
)
igual(
  trunc2((1.23 * 0.9 - 1) * 100),
  10.7,
  'el atajo del markup —(1 + m)(1 − d) − 1— daba 10,70%: se olvida de que el flete no se descuenta',
)
igual(
  rentabilidadConDescuento(PRECIO_L1, COSTO, FLETE, 0),
  rentabilidadDe(PRECIO_L1, COSTO, FLETE),
  'sin descuento, es la rentabilidad a precio de lista',
)
assert.ok(
  rentabilidadConDescuento(PRECIO_L1, COSTO, FLETE, 5) < rentabilidadDe(PRECIO_L1, COSTO, FLETE),
  'el descuento tiene que bajar la rentabilidad',
)
asserts++
console.log('  ✓ el descuento baja la rentabilidad, nunca la sube')

/* ---------- 3) Todo va SIN IVA ---------- */

console.log('\nCaso 3 · El IVA no es ganancia:')

/** El producto de la planilla, cargado para un Consumidor Final: el precio le llega con el 21%. */
const CON_IVA = {
  precio: trunc2(PRECIO_L1 * 1.21),
  precioSinIva: PRECIO_L1,
  precioCosto: COSTO,
  flete: FLETE,
  rentabilidad: MARGEN_L1,
}
igual(rentabilidadProductoDe(CON_IVA), 23, 'con el precio con IVA a la vista, la rentabilidad sigue siendo 23%')
igual(
  rentabilidadProductoDe({ ...CON_IVA, precio: PRECIO_L1 }),
  rentabilidadProductoDe(CON_IVA),
  'es la misma que la de un Responsable Inscripto (sin IVA en el precio)',
)

/* ---------- 4) Productos reales sin flete: se reproduce el Margen L1 del maestro ---------- */

console.log('\nCaso 4 · Productos reales del maestro (flete 0):')

/** "🤖Costo Final", "✋Margen L1" y "🤖Precio S/Iva L1" de productos reales. */
const PRODUCTOS = [
  { nombre: 'ABRAZADERA TALA 8/16', costo: 727.935, margenL1: 99.39, precioL1: 1451.43 },
  { nombre: 'ACAY x 100 grs.', costo: 206.26, margenL1: 223.6, precioL1: 667.457 },
  { nombre: 'ACEDAN X 50 Ml', costo: 13184.75, margenL1: 30.58, precioL1: 17216.647 },
  { nombre: 'ACEITE CAMION x 20 lts', costo: 97115.26, margenL1: 10, precioL1: 106826.786 },
]
for (const p of PRODUCTOS) {
  igual(rentabilidadDe(p.precioL1, p.costo, 0), p.margenL1, `"${p.nombre}" reproduce su Margen L1`)
}

/* ---------- 5) L7 y L8: sin columna de margen, la rentabilidad sale igual ---------- */

console.log('\nCaso 5 · Listas sin "Margen" publicado (L7/L8):')

/* L7 = Costo + Flete + Costo × Margen L7. El maestro no publica el margen de L7 y el producto llega
   con `rentabilidad: 0`: antes la ficha decía 0%. Ahora la cuenta sale del costo y el flete. */
const L7 = { precio: 130_943.8, precioSinIva: 130_943.8, precioCosto: COSTO, flete: FLETE, rentabilidad: 0 }
igual(
  rentabilidadProductoDe(L7),
  rentabilidadDe(130_943.8, COSTO, FLETE),
  'la ficha de L7 muestra la rentabilidad real, no el 0% del margen que falta',
)
assert.ok(rentabilidadProductoDe(L7) > 0)
asserts++

/* ---------- 6) Bordes ---------- */

console.log('\nCaso 6 · Bordes:')

igual(rentabilidadDe(200, 100), 100, 'precio al doble del costo, sin flete → 100%')
igual(rentabilidadDe(110, 100, 10), 0, 'precio que cubre justo Costo + Flete → 0%')
igual(rentabilidadDe(105, 100, 10), -5, 'cubre el costo pero no el flete → pierde plata')
igual(rentabilidadDe(0, 100), -100, 'regalado sin flete: se pierde el costo entero')
igual(rentabilidadDe(0, 100, 10), -110, 'regalado con flete: se pierden el costo Y el flete')
igual(rentabilidadDe(1000, 0, 10), 0, 'sin costo cargado no se inventa rentabilidad')
igual(rentabilidadConDescuento(200, 100, 0, 100), -100, '100% de descuento sin flete → −100%')
igual(rentabilidadDe(200, 100, -5), 100, 'un flete negativo no suma ganancia: se toma como 0')
igual(
  precioDaPerdida({ precio: 105, precioCosto: 100, flete: 10, rentabilidad: 0 }),
  true,
  'un precio que no cubre Costo + Flete es PÉRDIDA, aunque cubra el costo',
)

/* ---------- 7) Pisar el precio: el costo y el flete no se mueven ---------- */

console.log('\nCaso 7 · Override del administrador:')

const base = { precio: 214, precioSinIva: 214, precioCosto: 120, flete: 10, rentabilidad: 70 }
igual(rentabilidadProductoDe(base), 70, 'el caso parte de su propia base: (214 − 120 − 10) / 120 = 70%')

const pisado = productoConPrecio(base, 130)
igual(pisado.precioCosto, 120, 'pisar el precio no mueve el costo')
igual(pisado.flete, 10, 'ni el flete')
igual(rentabilidadProductoDe(pisado), 0, 'la rentabilidad sigue al precio: (130 − 120 − 10) / 120 = 0%')

const dosVeces = productoConPrecio(pisado, 150)
const unaVez = productoConPrecio(base, 150)
igual(dosVeces.precioCosto, unaVez.precioCosto, 'dos overrides seguidos dejan el mismo costo que uno')
igual(dosVeces.precioSinIva, unaVez.precioSinIva, 'y el mismo precio neto')

/* Sin Costo Final, se despeja del precio y el margen ORIGINALES con la fórmula del maestro dada
   vuelta: costo = (precio − flete) / (1 + margen) = (214 − 10) / 1,7 = 120. */
const sinCosto = { precio: 214, precioSinIva: 214, flete: 10, rentabilidad: 70 }
igual(costoDe(sinCosto), 120, 'sin Costo Final, el costo se despeja restando el flete')
igual(productoConPrecio(sinCosto, 100).precioCosto, 120, 'y queda fijado al pisar el precio')

/* ---------- 8) Líneas que vienen de un documento ya emitido ---------- */

console.log('\nCaso 8 · Presupuesto previo y entrega ANTERIOR:')

// Presupuesto: precio sin IVA + costo y flete del maestro → la cuenta con importes.
const itPresupuesto = { precio: PRECIO_L1, rent: 23, descuento: 0, costo: COSTO, flete: FLETE }
igual(
  rentabilidadItemPresupuesto(itPresupuesto, 10),
  10.68,
  'la línea del presupuesto con 10% en la venta rinde lo mismo que en la venta DIRECTA',
)
// Sin costo: se lleva la registrada al descuento nuevo (sin flete, es lo mejor que hay).
igual(
  rentabilidadItemPresupuesto({ precio: 100, rent: 20, descuento: 0 }, 10),
  8,
  'sin costo conocido: (1,20 × 0,90) − 1 = 8%',
)
igual(
  rentabilidadItemPresupuesto({ precio: 100, rent: 8, descuento: 10 }, 10),
  8,
  'sin costo, con el mismo descuento que tenía el presupuesto, queda la registrada',
)

/* Remito: el precio puede venir con IVA, así que se reconstruye el precio SIN IVA de la
   rentabilidad registrada, el costo y el flete —P = C × (1 + r) + F— y se lo descuenta. */
const itRemito = { rent: 23, costo: COSTO, flete: FLETE }
igual(rentabilidadItemRemito(itRemito, 0), 23, 'sin descuento por forma de pago, queda la registrada')
igual(
  rentabilidadItemRemito(itRemito, 10),
  10.68,
  'con 10% por forma de pago rinde lo mismo que la venta DIRECTA',
)
igual(rentabilidadItemRemito({ rent: 20 }, 10), 8, 'sin costo conocido: (1,20 × 0,90) − 1 = 8%')

console.log(`\nOK · rentabilidad = (precio S/IVA − costo − flete) / costo (${asserts} verificaciones)`)
