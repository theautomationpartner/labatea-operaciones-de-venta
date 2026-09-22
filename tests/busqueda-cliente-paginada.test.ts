/**
 * El buscador de clientes trae TODAS las coincidencias, siguiendo el cursor de Monday, e informa
 * cuando corta por el tope de seguridad.
 *
 * Antes pedía UNA página de 50 y lo que no entraba no existía para la app, sin ninguna señal.
 * Medido sobre el tablero real: "MARIA" coincide con 135 clientes y se veían 50 — 85 eran
 * inencontrables por ese término, y el vendedor concluía que el cliente no estaba cargado. Lo
 * mismo con JUAN (126), JOSE (108) y CARLOS (101).
 *
 * Seguir el cursor es lo que arregla eso, y es lo que se verifica acá.
 *
 * ── Sobre el cartel de "se muestran los primeros N" ──
 * Existió y se quitó a pedido. Lo que lo hacía necesario ya no está: el padrón entero vive
 * cacheado en el navegador, así que la lista se rearma con cada tecla sobre TODOS los clientes y
 * agregar una letra angosta el resultado al instante —no hay que adivinar que falta algo ni pedir
 * otra búsqueda—. Lo que sí quedó, porque protege contra elegir al cliente equivocado, es la regla
 * de que una lista cortada no auto-carga su único resultado (sección 4).
 *
 * Se corre con esbuild + node (`npm run test:busqueda-paginada`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { buscarClientes } from '@/services/monday/presupuestar'

interface Llamada {
  query: string
}

/** Un padrón de mentira: `n` clientes que coinciden con el término. */
function instalarBoard(total: number) {
  const llamadas: Llamada[] = []
  const PAGINA = 100
  let entregados = 0
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { query } = JSON.parse(init.body) as Llamada
    llamadas.push({ query })
    const cuantos = Math.min(PAGINA, total - entregados)
    const items = Array.from({ length: cuantos }, (_, i) => ({
      id: String(entregados + i + 1),
      name: `CLIENTE ${entregados + i + 1}`,
      column_values: [],
    }))
    entregados += cuantos
    const pagina = { cursor: entregados < total ? `c${entregados}` : null, items }
    /* La primera consulta viene aliasada por columna y anidada en `boards`; las siguientes son
       `next_items_page`, que es de nivel raíz. */
    const data = query.includes('next_items_page')
      ? { p0: pagina }
      : { q0: [{ items_page: pagina }] }
    return { ok: true, json: async () => ({ data }) }
  }) as unknown as typeof fetch
  return llamadas
}

/* ---------- 1) Más de una página: se siguen TODAS ---------- */
{
  const llamadas = instalarBoard(135)
  const { personas, truncado } = await buscarClientes('MARIA')
  assert.equal(personas.length, 135, 'vienen los 135, no los primeros 50')
  assert.equal(truncado, false, 'no se cortó nada, así que no hay nada que avisar')
  assert.equal(llamadas.length, 2, 'dos vueltas: la primera página y la siguiente')
  assert.ok(
    llamadas[1].query.includes('next_items_page'),
    'la segunda vuelta sigue el cursor en vez de repetir la consulta',
  )
}

/* ---------- 2) Una sola página: no se pide de más ---------- */
{
  const llamadas = instalarBoard(40)
  const { personas, truncado } = await buscarClientes('AGROPECUARIA')
  assert.equal(personas.length, 40)
  assert.equal(truncado, false)
  assert.equal(llamadas.length, 1, 'sin cursor abierto no se gasta una segunda consulta')
}

/* ---------- 3) El tope de seguridad: corta Y AVISA ----------
   Es la parte que no puede faltar. El bug no era el tope: era que fuera mudo. */
{
  instalarBoard(1000)
  const { personas, truncado } = await buscarClientes('MAR')
  assert.equal(personas.length, 300, 'se corta en el tope de seguridad')
  assert.equal(truncado, true, 'y se avisa que quedaron coincidencias afuera')
}

/* Justo en el borde no se avisa: 300 coincidencias entran enteras. */
{
  const { personas, truncado } = (instalarBoard(300), await buscarClientes('X'))
  assert.equal(personas.length, 300)
  assert.equal(truncado, false, 'con exactamente el tope no falta nada: avisar sería mentir')
}

/* ---------- 4) Una lista cortada NO auto-carga su único resultado ----------
   Es lo único que la pantalla sigue decidiendo con el `truncado`, y es lo que no se puede perder:
   con la lista cortada, el único cliente que llegó puede no ser el que se busca, y cargarlo por el
   usuario es decidir con información incompleta. De ahí sale una venta facturada a otro. */
const { readFileSync } = await import('node:fs')
const vista = readFileSync('src/features/cliente/BuscarCliente.tsx', 'utf8')
assert.ok(
  vista.includes('encontrados.length === 1 && !hayMas'),
  'una sola coincidencia se carga sola SOLO si la lista vino completa',
)

console.log('OK · el buscador trae todas las coincidencias y no auto-carga sobre una lista cortada')
