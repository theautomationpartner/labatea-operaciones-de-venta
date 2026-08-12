/**
 * La RENTABILIDAD se calcula con la MISMA fórmula que el Maestro de Productos usa para sus
 * columnas "🤖Margen L1/L2/L3":
 *
 *   ROUND(((precio S/IVA / Costo Final) − 1) × 100, 2)
 *
 * Las dos puntas son netas: las columnas "🤖Precio S/Iva Lx" ya vienen sin IVA y el "🤖Costo Final"
 * también.
 *
 * La BASE del producto sale del margen de la lista del cliente (L1 → numeric_mm58135k,
 * L2 → formula_mm51nqvz, L3 → formula_mm51fjf5); la FINAL se recalcula con el precio vigente —el
 * que quedó después de los descuentos o del override del administrador— sobre el mismo costo.
 */
import assert from 'node:assert/strict'
import { round2 } from '@/lib/format'
import { productoConPrecio } from '@/lib/precios'
import { rentabilidadDe, rentabilidadDeMarkup, rentabilidadConDescuento } from '@/lib/selectors'

/** Productos REALES del Maestro: "🤖Costo Final", "✋Margen L1" y "🤖Precio S/Iva L1". */
const PRODUCTOS = [
  { nombre: 'ABRAZADERA TALA 8/16', costo: 727.935, margenL1: 99.39, precioL1: 1451.43 },
  { nombre: 'ACAY x 100 grs.', costo: 206.26, margenL1: 223.6, precioL1: 667.457 },
  { nombre: 'ACEDAN X 50 Ml', costo: 13184.75, margenL1: 30.58, precioL1: 17216.647 },
  { nombre: 'ACEITE CAMION x 20 lts', costo: 97115.26, margenL1: 10, precioL1: 106826.786 },
]

// ---------- Sin descuento, la fórmula REPRODUCE el margen que publica el board ----------
for (const p of PRODUCTOS) {
  assert.equal(
    rentabilidadDe(p.precioL1, p.costo),
    p.margenL1,
    `"${p.nombre}": la fórmula no reproduce el "✋Margen L1" del maestro`,
  )
}

// ---------- Con descuento se recalcula sobre el precio vigente ----------
for (const p of PRODUCTOS) {
  for (const desc of [0, 10, 25]) {
    const precioConDesc = p.precioL1 * (1 - desc / 100)
    const esperado = round2((precioConDesc / p.costo - 1) * 100)
    assert.equal(
      rentabilidadConDescuento(p.precioL1, p.costo, desc),
      esperado,
      `"${p.nombre}" con ${desc}%: no es (precio / costo − 1) × 100`,
    )
    /* El camino SIN costo —el de la venta sobre presupuesto/proforma, que sólo tiene el margen
       espejado— tiene que dar el mismo número: el costo se cancela. */
    assert.ok(
      Math.abs(rentabilidadDeMarkup(p.margenL1, desc) - esperado) <= 0.02,
      `"${p.nombre}" con ${desc}%: el camino sin costo da ${rentabilidadDeMarkup(p.margenL1, desc)}`,
    )
  }
}

// ---------- El descuento baja la rentabilidad, nunca la sube ----------
for (const p of PRODUCTOS) {
  const sin = rentabilidadConDescuento(p.precioL1, p.costo, 0)
  const con = rentabilidadConDescuento(p.precioL1, p.costo, 10)
  assert.ok(con < sin, `"${p.nombre}": el descuento tiene que bajar la rentabilidad`)
}

// ---------- Bordes ----------
assert.equal(rentabilidadDe(200, 100), 100, 'precio al doble del costo → 100%')
assert.equal(rentabilidadDe(100, 100), 0, 'vender al costo no deja rentabilidad')
assert.equal(rentabilidadDe(80, 100), -20, 'vender bajo el costo da rentabilidad negativa')
assert.equal(rentabilidadDe(0, 100), -100, 'regalado: se pierde el costo entero')
assert.equal(rentabilidadDe(1000, 0), 0, 'sin costo cargado no se inventa rentabilidad')
assert.equal(rentabilidadConDescuento(200, 100, 100), -100, '100% de descuento → −100%')
assert.equal(rentabilidadDeMarkup(0), 0, 'sin margen base, sin rentabilidad')

// ---------- Pisar el precio: la BASE es intocable, la FINAL sigue al precio ----------
/* La rentabilidad BASE es el dato de referencia del maestro. Ni los descuentos ni el override del
   administrador la mueven: lo único que cambia es la FINAL, que no se guarda —se deriva del precio
   vigente contra el costo cada vez que se muestra—. */
const base = { precio: 204, precioSinIva: 204, precioCosto: 120, rentabilidad: 70 }
assert.equal(rentabilidadDe(base.precioSinIva, base.precioCosto), base.rentabilidad, 'el caso parte de su propia base')

const pisado = productoConPrecio(base, 100)
assert.equal(pisado.rentabilidad, base.rentabilidad, 'pisar el precio movió la rentabilidad BASE')
assert.equal(pisado.precioCosto, 120, 'pisar el precio movió el costo')
assert.equal(
  rentabilidadDe(pisado.precioSinIva!, pisado.precioCosto!),
  round2((100 / 120 - 1) * 100),
  'la FINAL no siguió al precio pisado',
)

// Dos overrides seguidos dan lo mismo que uno solo: el costo queda fijo desde el primero.
const dosVeces = productoConPrecio(pisado, 150)
const unaVez = productoConPrecio(base, 150)
assert.equal(dosVeces.precioCosto, unaVez.precioCosto, 'el costo se corrió tras dos overrides')
assert.equal(dosVeces.precioSinIva, unaVez.precioSinIva, 'el precio neto no es idempotente')
assert.equal(dosVeces.rentabilidad, base.rentabilidad, 'la BASE se corrió tras dos overrides')

// Sin costo del maestro se despeja del precio y el margen ORIGINALES, y queda fijado.
const sinCosto = { precio: 204, precioSinIva: 204, rentabilidad: 70 }
const fijado = productoConPrecio(sinCosto, 100)
assert.equal(fijado.precioCosto, 120, 'el costo se despeja del precio y el margen originales')
assert.equal(fijado.rentabilidad, 70, 'la BASE tampoco se toca cuando el costo se despeja')

console.log('OK · la rentabilidad usa la fórmula del Maestro y la BASE nunca se recalcula')
