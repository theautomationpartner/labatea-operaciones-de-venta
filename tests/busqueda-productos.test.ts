/**
 * Constructor dinámico de la consulta de productos: verifica que las reglas de `query_params`
 * salgan sólo de los criterios que el usuario completó, y que la lógica sea OR dentro de un
 * criterio y AND entre criterios distintos.
 *
 *   npm run test:busqueda
 */
import { construirQueryProductos } from '../src/services/monday/presupuestar'
import { COL } from '../src/services/monday/columns'
import type { CampoFiltro, Filtro } from '../src/types'

let fallos = 0
const check = (ok: boolean, titulo: string, detalle = '') => {
  console.log(`${ok ? '  OK  ' : ' FALLA'} · ${titulo}${ok || !detalle ? '' : ` → ${detalle}`}`)
  if (!ok) fallos++
}

/** Ids de etiqueta tal como los devuelve `settings_str` de cada columna dropdown. */
const INDICES: Record<CampoFiltro, Record<string, number>> = {
  Rubro: { veterinaria: 1, ferretería: 2 },
  Subrubro: { antiparasitarios: 5 },
  Categoría: { insumos: 9 },
}

const f = (campo: CampoFiltro, valor: string): Filtro => ({ campo, valor })
const regla = (qp: ReturnType<typeof construirQueryProductos>, columna: string) =>
  qp?.rules.find((r) => r.column_id === columna)

/* 1) EL BUG: un único criterio elegido. Sólo puede viajar esa regla; los criterios sin
      selección se omiten por completo (una regla vacía devolvía 0 resultados). */
{
  const qp = construirQueryProductos('', [f('Rubro', 'Veterinaria')], INDICES)
  check(qp?.rules.length === 1, 'Un solo filtro genera exactamente UNA regla', `${qp?.rules.length}`)
  check(
    JSON.stringify(regla(qp, COL.producto.rubro)) ===
      JSON.stringify({ column_id: COL.producto.rubro, compare_value: [1], operator: 'any_of' }),
    'La regla del filtro elegido va por id de etiqueta y con any_of',
    JSON.stringify(regla(qp, COL.producto.rubro)),
  )
  check(
    !regla(qp, COL.producto.subrubro) && !regla(qp, COL.producto.categoria),
    'No se manda ninguna regla de los criterios vacíos',
  )
  check(qp?.operator === 'and', 'La raíz intersecta las reglas (operator: and)')
}

/* 2) OR intra-criterio: dos valores del mismo campo, un solo any_of. */
{
  const qp = construirQueryProductos(
    '',
    [f('Rubro', 'Veterinaria'), f('Rubro', 'Ferretería')],
    INDICES,
  )
  check(qp?.rules.length === 1, 'Dos valores del mismo campo siguen siendo UNA regla')
  check(
    JSON.stringify(regla(qp, COL.producto.rubro)?.compare_value) === '[1,2]',
    'Los dos valores van juntos en el any_of (OR)',
    JSON.stringify(regla(qp, COL.producto.rubro)?.compare_value),
  )
}

/* 3) AND inter-criterio: una regla por campo, todas bajo el and raíz. */
{
  const qp = construirQueryProductos(
    '',
    [f('Rubro', 'Veterinaria'), f('Rubro', 'Ferretería'), f('Subrubro', 'Antiparasitarios'), f('Categoría', 'Insumos')],
    INDICES,
  )
  check(qp?.rules.length === 3, 'Tres criterios distintos → tres reglas', `${qp?.rules.length}`)
  check(
    JSON.stringify(regla(qp, COL.producto.subrubro)?.compare_value) === '[5]' &&
      JSON.stringify(regla(qp, COL.producto.categoria)?.compare_value) === '[9]',
    'Cada criterio conserva sus propios valores',
  )
  check(qp?.operator === 'and', 'Los criterios distintos se intersectan (AND)')
}

/* 4) RAMA A · código: anula nombre y filtros, y consulta por valor exacto. */
{
  const qp = construirQueryProductos('3261', [f('Rubro', 'Veterinaria')], INDICES)
  check(qp?.rules.length === 1, 'El código deja una sola regla')
  check(
    JSON.stringify(qp?.rules[0]) ===
      JSON.stringify({ column_id: COL.producto.codigo, compare_value: ['3261'], operator: 'any_of' }),
    'La regla del código apunta al Código Interno, exacta',
    JSON.stringify(qp?.rules[0]),
  )
  check(!regla(qp, COL.producto.rubro), 'El código ignora los filtros activos')
}

/* 5) RAMA C · nombre + filtros: el nombre es un criterio más. */
{
  const qp = construirQueryProductos('acarox', [f('Subrubro', 'Antiparasitarios')], INDICES)
  check(qp?.rules.length === 2, 'Nombre y filtro conviven como dos reglas', `${qp?.rules.length}`)
  check(
    JSON.stringify(regla(qp, 'name')) ===
      JSON.stringify({ column_id: 'name', compare_value: 'acarox', operator: 'contains_text' }),
    'El nombre va como contains_text sobre el nombre del ítem',
    JSON.stringify(regla(qp, 'name')),
  )
}

/* 6) RAMA B · sólo nombre, sin filtros: no se inventan reglas de taxonomía. */
{
  const qp = construirQueryProductos('acarox', [], INDICES)
  check(qp?.rules.length === 1, 'Sin filtros sólo viaja la regla del nombre')
}

/* 7) Sin ningún criterio: no hay query_params que mandar. */
{
  check(
    construirQueryProductos('', [], INDICES) === undefined,
    'Sin término ni filtros no se arma query_params',
  )
}

/* 8) Una etiqueta que el board no tiene no puede romper la consulta. */
{
  const qp = construirQueryProductos('', [f('Rubro', 'Inexistente')], INDICES)
  check(qp === undefined, 'Un valor sin id de etiqueta no genera una regla inválida')
}

console.log(fallos === 0 ? '\nTodo OK' : `\n${fallos} fallo(s)`)
process.exit(fallos === 0 ? 0 : 1)
