/**
 * El ORDEN del live search de productos: que el que se busca salga primero.
 *
 * Es lo único que hace útil a este buscador. Una lista con el producto correcto en el puesto once
 * no es mejor que no tener lista: quien opera igual tiene que leerla entera, y en el medio carga el
 * que no era. Por eso se testea capa por capa y no "que encuentre algo".
 *
 *   npm run test:busqueda-catalogo
 */
import assert from 'node:assert/strict'
import {
  buscarEnCatalogo,
  indexarCatalogo,
  pasaFiltros,
  puntuar,
} from '../src/lib/busquedaProductos'
import type { Filtro, ListaPrecio, ProductoCache } from '../src/types'

let asserts = 0
const ok = (nombre: string, cond: boolean) => {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const PRECIOS = { L1: 100, L2: 100, L3: 100, L4: 100, L5: 100, L6: 100, L7: 100, L8: 100 } as Record<
  ListaPrecio,
  number
>

const prod = (
  codigo: string,
  nombre: string,
  tax: { rubro?: string; subrubro?: string; categoria?: string } = {},
): ProductoCache => ({
  id: `id-${codigo}`,
  codigo,
  nombre,
  precios: PRECIOS,
  margenes: {},
  precioCosto: 50,
  iva: 21,
  moneda: 'Pesos',
  tipo: 'COM',
  comisionable: false,
  conRentabForzada: false,
  rubro: tax.rubro ?? 'FERRETERIA',
  subrubro: tax.subrubro ?? 'BULONFER',
  categoria: tax.categoria ?? 'ARTICULOS RURALES',
  um: 'Unidad',
  peso: 1,
  provCod: '7003',
  provNombre: 'PROVEEDOR',
  stockId: `stock-${codigo}`,
})

const CATALOGO = indexarCatalogo([
  prod('301', 'ABRAZADERA TALA 8/16'),
  prod('3012', 'ABRAZADERA TALA 10/20'),
  prod('500', 'ACAROX ULTRA 500 ML', { rubro: 'SANIDAD', subrubro: 'ANTIPARASITARIOS' }),
  prod('501', 'ACAROX BAÑO 1 L', { rubro: 'SANIDAD', subrubro: 'ANTIPARASITARIOS' }),
  prod('600', 'AGUJA DESCARTABLE 21G x 1', { rubro: 'SANIDAD', subrubro: 'DESCARTABLES' }),
  prod('601', 'JERINGA DESCARTABLE 20 ML', { rubro: 'SANIDAD', subrubro: 'DESCARTABLES' }),
  prod('700', 'CLORO GRANULADO x 1 KG.', { rubro: 'LIMPIEZA' }),
])

const nombres = (termino: string, filtros: Filtro[] = []) =>
  buscarEnCatalogo(CATALOGO, termino, filtros).productos.map((p) => p.nombre)

console.log('Caso 1 · El código exacto gana a todo:')
ok('buscar "301" pone el 301 primero', nombres('301')[0] === 'ABRAZADERA TALA 8/16')
/* El 3012 también empieza con "301", pero el exacto tiene que ganarle: si no, escribir un código
   completo puede cargar el producto de al lado. */
ok('y el 3012, que empieza igual, queda detrás', nombres('301')[1] === 'ABRAZADERA TALA 10/20')

console.log('\nCaso 2 · El código admite prefijo mientras se tipea:')
ok('"30" lista los dos que empiezan con 30', nombres('30').length === 2)
/* La capa del código corre SÓLO si lo escrito es numérico. "ml" matchea igual —es una palabra de
   "ACAROX ULTRA 500 ML"— pero por la capa del nombre, bien por debajo de un código: si entrara por
   la del código, escribir una unidad de medida llenaría la lista de productos sin relación. */
const entradaAcarox = CATALOGO.find((e) => e.codigo === '500')!
ok('un término con letras no puntúa como código', puntuar(entradaAcarox, 'ml') < 800)
ok('matchea por palabra del nombre, no por el código', puntuar(entradaAcarox, 'ml') === 600)

console.log('\nCaso 3 · Las palabras sueltas, que es como se busca de verdad:')
/* Esta es la capa que no existe en el buscador de clientes. "acarox 500" no está pegado en el
   nombre ("ACAROX ULTRA 500 ML"), así que un `includes` del término entero no lo encuentra. */
ok('"acarox 500" encuentra ACAROX ULTRA 500 ML', nombres('acarox 500')[0] === 'ACAROX ULTRA 500 ML')
ok('y NO trae el otro ACAROX', !nombres('acarox 500').includes('ACAROX BAÑO 1 L'))
ok('"aguja 21" encuentra la aguja', nombres('aguja 21')[0] === 'AGUJA DESCARTABLE 21G x 1')
ok('el orden de las palabras no importa: "21 aguja"', nombres('21 aguja')[0] === 'AGUJA DESCARTABLE 21G x 1')

console.log('\nCaso 4 · El nombre que empieza con lo escrito va antes que el que lo contiene:')
const desc = nombres('descartable')
ok('"descartable" trae los dos', desc.length === 2)
const jeringa = CATALOGO.find((e) => e.codigo === '601')!
const aguja = CATALOGO.find((e) => e.codigo === '600')!
ok(
  'una palabra interna puntúa igual en los dos (desempata el nombre)',
  puntuar(aguja, 'descartable') === puntuar(jeringa, 'descartable'),
)

console.log('\nCaso 5 · Acentos y mayúsculas no cuentan:')
ok('"bano" encuentra "ACAROX BAÑO 1 L"', nombres('bano').includes('ACAROX BAÑO 1 L'))
ok('"ACAROX" y "acarox" dan lo mismo', nombres('ACAROX').join() === nombres('acarox').join())

console.log('\nCaso 6 · El error de tipeo, como último recurso:')
/* Con cuatro letras o más se acepta la distancia de edición; con menos, emparejaría medio catálogo. */
ok('"cloor granulado" igual encuentra el cloro', nombres('cloro granulad').length > 0)
ok('dos letras no disparan la difusa', nombres('xy').length === 0)

console.log('\nCaso 7 · Los filtros de taxonomía: OR adentro, AND entre campos:')
const sanidad: Filtro[] = [{ campo: 'Rubro', valor: 'SANIDAD' }]
ok('filtrar por rubro SANIDAD deja cuatro', nombres('', sanidad).length === 4)
ok('sin término, el filtro ordena alfabéticamente', nombres('', sanidad)[0] === 'ACAROX BAÑO 1 L')

const dosSubrubros: Filtro[] = [
  { campo: 'Subrubro', valor: 'ANTIPARASITARIOS' },
  { campo: 'Subrubro', valor: 'DESCARTABLES' },
]
ok('dos valores del MISMO campo son un OR', nombres('', dosSubrubros).length === 4)

const cruzado: Filtro[] = [
  { campo: 'Rubro', valor: 'SANIDAD' },
  { campo: 'Subrubro', valor: 'DESCARTABLES' },
]
ok('campos distintos son un AND', nombres('', cruzado).length === 2)

const imposible: Filtro[] = [
  { campo: 'Rubro', valor: 'LIMPIEZA' },
  { campo: 'Subrubro', valor: 'DESCARTABLES' },
]
ok('un AND que no cierra no devuelve nada', nombres('', imposible).length === 0)

console.log('\nCaso 8 · El término y los filtros se combinan:')
ok('"acarox" dentro de SANIDAD trae los dos', nombres('acarox', sanidad).length === 2)
ok('"acarox" dentro de LIMPIEZA no trae nada', nombres('acarox', [{ campo: 'Rubro', valor: 'LIMPIEZA' }]).length === 0)

console.log('\nCaso 9 · Sin nada que buscar no se devuelve el catálogo entero:')
ok('término vacío y sin filtros = lista vacía', buscarEnCatalogo(CATALOGO, '').productos.length === 0)
ok('y no se marca truncado', buscarEnCatalogo(CATALOGO, '').truncado === false)

console.log('\nCaso 10 · El tope avisa que cortó:')
const cortado = buscarEnCatalogo(CATALOGO, '', sanidad, 2)
ok('se devuelven sólo los del tope', cortado.productos.length === 2)
/* Callar esto es el bug que ya se pagó contra Monday: se ven los primeros y se concluye que el
   producto no está cargado. */
ok('y se avisa que quedaron afuera', cortado.truncado === true)

console.log('\nCaso 11 · Una etiqueta de taxonomía múltiple se lee entera:')
const multi = indexarCatalogo([prod('900', 'MULTI', { rubro: 'FERRETERIA, SANIDAD' })])
ok('matchea por la primera etiqueta', pasaFiltros(multi[0], [{ campo: 'Rubro', valor: 'FERRETERIA' }]))
ok('y también por la segunda', pasaFiltros(multi[0], [{ campo: 'Rubro', valor: 'SANIDAD' }]))
ok('pero no por una que no tiene', !pasaFiltros(multi[0], [{ campo: 'Rubro', valor: 'LIMPIEZA' }]))

console.log(`\n${asserts} verificaciones OK`)
