/**
 * La decisión que toma la corrida INCREMENTAL del cron de productos, sin la base ni la red.
 *
 * `clasificarPagina` es la única lógica del cron que se puede equivocar en silencio: decide dónde
 * cortar la paginación y hasta dónde avanzar la marca de agua. Un error acá no rompe nada visible
 * —el cron sigue devolviendo 200— pero deja el catálogo desactualizado o, peor, hace que la marca
 * salte por encima de productos que nunca se procesaron.
 *
 *   npm run test:productos-sync
 */
import assert from 'node:assert/strict'
import { clasificarPagina, type ItemMonday } from '../api/_productos'

let asserts = 0
const ok = (nombre: string, cond: boolean) => {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const T = (iso: string) => Date.parse(iso)

/** Un ítem del maestro con lo mínimo para clasificarlo. */
const item = (id: string, updated: string): ItemMonday => ({
  id,
  name: `PRODUCTO ${id}`,
  updated_at: updated,
  column_values: [{ id: 'text_mm5ghnv7', text: id }],
})

/* La página llega SIEMPRE ordenada por fecha de modificación descendente: así la pide el cron. */
const PAGINA = [
  item('1', '2026-09-22T12:00:00Z'),
  item('2', '2026-09-22T11:00:00Z'),
  item('3', '2026-09-22T10:00:00Z'),
  item('4', '2026-09-20T09:00:00Z'),
  item('5', '2026-09-19T09:00:00Z'),
]

console.log('Caso 1 · Se corta en el primer ítem ya procesado:')
const corte = clasificarPagina(PAGINA, T('2026-09-22T09:30:00Z'))
ok('entran sólo los tres modificados después del corte', corte.entran.length === 3)
ok('y son los tres más nuevos', corte.entran.map((p) => p.id).join(',') === '1,2,3')
ok('se marca que se alcanzó lo ya procesado', corte.alcanzado === true)
ok(
  'la marca avanza al `updated_at` más nuevo de la página',
  corte.masNueva === '2026-09-22T12:00:00Z',
)

console.log('\nCaso 2 · Nada cambió desde la corrida anterior:')
const sinCambios = clasificarPagina(PAGINA, T('2026-09-23T00:00:00Z'))
ok('no entra ningún producto', sinCambios.entran.length === 0)
ok('se corta en el primero', sinCambios.alcanzado === true)
/* Esto es lo que hace que una corrida sin trabajo igual sirva de algo: sin avanzar la marca, la
   siguiente volvería a pedir el mismo tramo para siempre. */
ok('la marca AVANZA igual', sinCambios.masNueva === '2026-09-22T12:00:00Z')

console.log('\nCaso 3 · Toda la página es nueva (hay que pedir la siguiente):')
const todoNuevo = clasificarPagina(PAGINA, T('2026-01-01T00:00:00Z'))
ok('entran los cinco', todoNuevo.entran.length === 5)
ok('NO se corta: puede haber más en la página que sigue', todoNuevo.alcanzado === false)

console.log('\nCaso 4 · La marca arrastra entre páginas:')
/* La página 2 es más vieja que la 1, así que su ítem más nuevo NO puede pisar la marca ya vista. */
const pagina2 = [item('6', '2026-09-18T08:00:00Z')]
const arrastre = clasificarPagina(pagina2, T('2026-01-01T00:00:00Z'), '2026-09-22T12:00:00Z')
ok('la marca sigue siendo la más nueva de las dos páginas', arrastre.masNueva === '2026-09-22T12:00:00Z')
ok('y el producto de la página 2 entra igual', arrastre.entran.length === 1)

console.log('\nCaso 5 · El borde exacto del corte se reprocesa, no se pierde:')
/* `<=` y no `<`: el ítem modificado en el segundo exacto de la marca ya se procesó. El solape de
   dos minutos que aplica el cron (SOLAPE_MS) es el que cubre el desfasaje de relojes. */
const borde = clasificarPagina([item('7', '2026-09-22T10:00:00Z')], T('2026-09-22T10:00:00Z'))
ok('el ítem justo en la marca no se reprocesa', borde.entran.length === 0)
ok('y corta la paginación ahí', borde.alcanzado === true)

console.log('\nCaso 6 · Un ítem sin `updated_at` no frena el barrido:')
const sinFecha: ItemMonday = { id: '8', name: 'SIN FECHA', column_values: [] }
const raro = clasificarPagina([sinFecha, item('9', '2026-09-22T12:00:00Z')], T('2026-09-01T00:00:00Z'))
ok('el ítem sin fecha entra (ante la duda, se procesa)', raro.entran.some((p) => p.id === '8'))
ok('y no corta la página', raro.alcanzado === false)

console.log('\nCaso 7 · Una página vacía es inofensiva:')
const vacia = clasificarPagina([], T('2026-09-01T00:00:00Z'), '2026-09-22T12:00:00Z')
ok('no entra nada', vacia.entran.length === 0)
ok('no se corta', vacia.alcanzado === false)
ok('la marca que venía se conserva', vacia.masNueva === '2026-09-22T12:00:00Z')

console.log(`\n${asserts} verificaciones OK`)
