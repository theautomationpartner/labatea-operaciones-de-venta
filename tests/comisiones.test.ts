/**
 * Motor de comisiones: tasa ÚNICA por tipo de venta (del tablero de configuración) aplicada sobre
 * el neto de cada producto comisionable.
 *
 *   · MÓDULO 2 — la tasa sale de la COMBINACIÓN de venta, no sólo de su tipo: si hubo un
 *     presupuesto en el medio y si la cadena tiene actividades linkeadas. Son cuatro, y dos
 *     todavía no están definidas por negocio (ver `TASA_POR_COMBINACION`).
 *   · MÓDULO 3 — el producto sólo aporta si comisiona ("SI"); ya no aporta su propio porcentaje.
 *   · MÓDULO 4 — la base es el precio SIN IVA y con el descuento total (manual + forma de pago)
 *     ya aplicado.
 *
 * Se corre con esbuild + node (`npm run test:comisiones`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { netoLinea } from '@/lib/descuentos'
import {
  combinacionDeVenta,
  comisionLinea,
  comisionLineas,
  resumenVenta,
  tasaComision,
} from '@/lib/selectors'
import type { ComisionesVenta, LineaPresupuesto, Producto, VentaItem } from '@/types'

const TASAS: ComisionesVenta = { activa: 4, pasiva: 1.5 }

/* ---------- MÓDULO 2: qué tasa rige cada COMBINACIÓN de venta ----------
   No alcanza con el tipo de venta: la tasa sale de la cadena que originó la venta —presupuesto de
   por medio o no, y con gestión registrada o no—. Son cuatro combinaciones. */
assert.equal(combinacionDeVenta('CON PRESUPUESTO PREVIO', true), 'ACTIVIDADES-PRESUPUESTO-VENTA')
assert.equal(combinacionDeVenta('CON PRESUPUESTO PREVIO', false), 'PRESUPUESTO-VENTA')
assert.equal(combinacionDeVenta('DIRECTA', true), 'ACTIVIDADES-VENTA-DIRECTA')
assert.equal(combinacionDeVenta('DIRECTA', false), 'VENTA-DIRECTA')

/* La Activa la paga UNA sola combinación: la cadena completa. */
assert.equal(
  tasaComision(TASAS, 'CON PRESUPUESTO PREVIO', true),
  4,
  'ACTIVIDADES-PRESUPUESTO-VENTA: la cadena completa paga la Activa',
)

/* Las otras TRES pagan la Pasiva: sin alguno de los eslabones no hubo la gestión que la tasa alta
   remunera. La que cambió es PRESUPUESTO-VENTA —antes, tener presupuesto previo alcanzaba para la
   Activa—, y es justamente el caso que este test tiene que dejar clavado. */
assert.equal(
  tasaComision(TASAS, 'CON PRESUPUESTO PREVIO', false),
  1.5,
  'PRESUPUESTO-VENTA: un presupuesto SIN actividades ya no alcanza para la Activa',
)
assert.equal(
  tasaComision(TASAS, 'DIRECTA', true),
  1.5,
  'ACTIVIDADES-VENTA-DIRECTA: sin presupuesto en el medio, la Pasiva',
)
assert.equal(
  tasaComision(TASAS, 'DIRECTA', false),
  1.5,
  'VENTA-DIRECTA: sin presupuesto ni gestión previa, la Pasiva',
)

// Sin configuración leída no se inventa ninguna tasa.
assert.equal(tasaComision({ activa: 0, pasiva: 0 }, 'DIRECTA', false), 0, 'sin config, 0%')

// ---------- MÓDULO 3: sólo comisiona el producto marcado ----------
assert.equal(comisionLinea(100_000, true, 4), 4000, 'comisionable: neto × tasa')
assert.equal(comisionLinea(100_000, false, 4), 0, 'NO comisionable: no aporta nada')
assert.equal(comisionLinea(100_000, true, 0), 0, 'con tasa 0 no hay comisión')

// ---------- MÓDULO 4: la base es el neto (sin IVA, con el descuento total) ----------
const producto = (comisionable: boolean): Producto =>
  ({ precio: 100_000, rentabilidad: 40, iva: 21, comisionable }) as unknown as Producto

const linea = (comisionable: boolean, cantidad = 1, descuento = 0): LineaPresupuesto =>
  ({ id: 'l', producto: producto(comisionable), cantidad, descuento }) as LineaPresupuesto

// Sin descuentos: 100.000 × 1,5% (DIRECTA).
assert.equal(comisionLineas([linea(true)], TASAS, 'DIRECTA'), 1500, 'directa: 1,5% del neto')
/* La misma línea con presupuesto previo Y actividades paga la tasa Activa; sin actividades, la
   Pasiva, aunque haya presupuesto de por medio. */
assert.equal(
  comisionLineas([linea(true)], TASAS, 'CON PRESUPUESTO PREVIO', 0, true),
  4000,
  'activa: 4% con la cadena completa',
)
assert.equal(
  comisionLineas([linea(true)], TASAS, 'CON PRESUPUESTO PREVIO', 0, false),
  1500,
  'sin actividades linkeadas, el presupuesto previo paga la Pasiva',
)
// El producto no comisionable no suma, aunque haya tasa.
assert.equal(comisionLineas([linea(false)], TASAS, 'DIRECTA'), 0, 'sin "SI" no hay comisión')

/* El descuento BAJA la comisión: la base es el neto bonificado, no el precio de lista.
   Con 20% manual y 6% de forma de pago, el neto de la línea es el que calcula `netoLinea`. */
const netoConDto = netoLinea(100_000, 1, 20, 6)
assert.equal(
  comisionLineas([linea(true, 1, 20)], TASAS, 'DIRECTA', 6),
  Math.round(netoConDto * 1.5) / 100,
  'la comisión se mide sobre el neto ya bonificado',
)
assert.ok(
  comisionLineas([linea(true, 1, 20)], TASAS, 'DIRECTA', 6) < 1500,
  'con descuento la comisión tiene que bajar',
)

// La cantidad multiplica: la comisión es de la LÍNEA, no de una unidad suelta.
assert.equal(comisionLineas([linea(true, 3)], TASAS, 'DIRECTA'), 4500, '3 unidades → 3× la comisión')

// Suma de varias líneas: sólo las comisionables entran.
assert.equal(
  comisionLineas([linea(true), linea(false), linea(true, 2)], TASAS, 'DIRECTA'),
  1500 + 0 + 3000,
  'la comisión total es la suma de las líneas comisionables',
)

// ---------- Venta CON PRESUPUESTO PREVIO: el mismo motor dentro del resumen ----------
const item = (comisionable: boolean, desc = 0): VentaItem =>
  ({ uid: 'u', precio: 100_000, aVender: 1, desc, rent: 40, iva: 21, comisionable }) as VentaItem

/* El 7º argumento es "la cadena tiene actividades linkeadas"; el 6º (crédito) va en `undefined`
   para que rija su default. Con actividades, el resumen aplica la Activa. */
assert.equal(
  resumenVenta([item(true)], null, 'CON PRESUPUESTO PREVIO', 0, TASAS, undefined, true).comision,
  4000,
  'el resumen de la venta aplica la tasa Activa con la cadena completa',
)
assert.equal(
  resumenVenta([item(true)], null, 'CON PRESUPUESTO PREVIO', 0, TASAS, undefined, false).comision,
  1500,
  'y la Pasiva cuando el presupuesto no trae actividades',
)
assert.equal(
  resumenVenta([item(false)], null, 'CON PRESUPUESTO PREVIO', 0, TASAS).comision,
  0,
  'un producto no comisionable no aporta al resumen',
)
// Sin tasas cargadas el resumen no inventa comisión (es el default del selector).
assert.equal(
  resumenVenta([item(true)], null, 'CON PRESUPUESTO PREVIO').comision,
  0,
  'sin configuración leída, la comisión es 0',
)

console.log('OK · comisiones: una tasa por COMBINACIÓN de venta, sobre el neto del producto comisionable')
