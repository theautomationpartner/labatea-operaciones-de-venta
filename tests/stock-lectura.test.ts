/**
 * Lectura del stock del producto: son cinco columnas de DOS tipos distintos en el mismo tablero
 * (fórmulas y mirrors), y cada tipo se lee de una forma. Leerlas mal no rompe nada visible —
 * devuelven cero— así que el error sólo aparece como un stock en cero en pantalla.
 *
 * Se corre con esbuild + node (`npm run test:stock-lectura`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { numCol, sumaMirror, type CV } from '@/services/monday/parse'

/* Respuesta REAL de la API para "BOOSTER ESSENTIAL LACTOREEMPLAZANTE x 20 Kgs.". Las mirror
   espejan CADA subelemento de movimiento, así que su `display_value` viene como lista. */
const ingreso: CV = { id: 'lookup_mm578v5m', text: null, display_value: '5000, 2, 5' }
const egreso: CV = { id: 'lookup_mm57sf80', text: null, display_value: '1, 1, 1, 1, 2, 1, 1, 9, 2, 3' }
const fisico: CV = { id: 'formula_mm57f9pn', text: '', display_value: '4985' }
const pendEntrega: CV = { id: 'numeric_mm5nscx', text: '0' }

// Las mirror se SUMAN: `numCol` borraría las comas y concatenaría los números.
assert.equal(sumaMirror(ingreso), 5007, 'el ingreso total es la suma de sus movimientos')
assert.equal(sumaMirror(egreso), 22, 'y el egreso también')
assert.equal(numCol(ingreso), 500025, 'leerla como número simple concatena: por eso NO se usa')

// Las fórmulas y las numéricas sí se leen directo.
assert.equal(numCol(fisico), 4985, 'la fórmula viene en display_value')
assert.equal(numCol(pendEntrega), 0, 'la numérica, en text')

// El físico del tablero es Ingreso − Egreso: la lectura tiene que reproducirlo.
assert.equal(sumaMirror(ingreso) - sumaMirror(egreso), numCol(fisico), 'ingreso − egreso = físico')

/* Una mirror pedida SIN el fragmento `... on MirrorValue` vuelve así: sin texto y sin valor
   calculado. Da cero sin avisar, que es exactamente el modo en que este error pasa desapercibido. */
assert.equal(sumaMirror({ id: 'lookup_mm578v5m', text: null }), 0, 'sin el fragmento, cero')

console.log('OK · lectura del stock: mirrors sumadas, fórmulas y numéricas directas')
