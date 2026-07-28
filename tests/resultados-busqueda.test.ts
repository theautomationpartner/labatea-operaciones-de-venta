/**
 * Persistencia de la lista de resultados del buscador de productos: elegir un ítem repliega la
 * lista pero NO destruye la búsqueda paginada, y volver al buscador la relista donde estaba.
 *
 *   npm run test:resultados
 */
import assert from 'node:assert/strict'
import {
  SIN_RESULTADOS,
  cerrado,
  conElegido,
  conPaginaSiguiente,
  conPrimeraPagina,
  cursorActual,
  enPagina,
  hayAnterior,
  haySiguiente,
  paginaActual,
  reabierto,
} from '../src/features/productos/resultadosBusqueda'
import type { Producto } from '../src/types'

let asserts = 0
const ok = (nombre: string, cond: boolean) => {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const prod = (codigo: string): Producto =>
  ({ codigo, nombre: `Producto ${codigo}`, precio: 0, rentabilidad: 0 }) as Producto

const pagina1 = { productos: [prod('1'), prod('2'), prod('3')], cursor: 'cursor-p2' }
const pagina2 = { productos: [prod('4'), prod('5')], cursor: null }

console.log('Caso 1 · Elegir un producto repliega la lista pero conserva la búsqueda:')
const abierta = conPrimeraPagina(pagina1)
const trasElegir = conElegido(abierta, pagina1.productos[0])
ok('la lista se repliega para despejar "Producto seleccionado"', trasElegir.abierto === false)
ok('el array de ítems descargados es el MISMO', trasElegir.paginas === abierta.paginas)
ok('sigue apuntando a la misma página', trasElegir.pagina === abierta.pagina)
ok('el cursor activo se conserva', cursorActual(trasElegir) === 'cursor-p2')
ok('el producto elegido queda marcado', trasElegir.elegidos.has('1'))
ok('los otros no', !trasElegir.elegidos.has('2'))
ok('el estado anterior no se mutó', abierta.elegidos.has('1') === false)

console.log('Caso 2 · Volver al buscador relista lo ya traído, sin consultar:')
const relistada = reabierto(trasElegir)
ok('la lista vuelve a verse (abierto === true)', relistada.abierto === true)
ok('con los mismos 3 productos en pantalla', paginaActual(relistada).length === 3)
ok('y el mismo array, no uno nuevo', relistada.paginas[0] === pagina1.productos)
ok('la marca de lo ya elegido sigue puesta', relistada.elegidos.has('1'))
ok('la flecha "Siguiente" sigue habilitada', haySiguiente(relistada) === true)
ok('sin resultados guardados no se abre nada', reabierto(SIN_RESULTADOS).abierto === false)

console.log('Caso 3 · La paginación sigue viva a través de las selecciones:')
const enDos = conPaginaSiguiente(relistada, pagina2)
ok('se pasa a la página 2', enDos.pagina === 1)
ok('la página 1 sigue en memoria', enDos.paginas.length === 2)
ok('"Anterior" se habilita', hayAnterior(enDos) === true)
ok('sin cursor nuevo, "Siguiente" se inactiva', haySiguiente(enDos) === false)
const elegidoEnDos = conElegido(enDos, pagina2.productos[0])
ok('elegir en la página 2 también repliega', elegidoEnDos.abierto === false)
ok('pero no cambia de página', elegidoEnDos.pagina === 1)
const devuelta = reabierto(elegidoEnDos)
ok('al reabrir vuelve a la página 2, donde estaba', devuelta.pagina === 1)
ok('con lo elegido de las dos páginas marcado', devuelta.elegidos.has('1') && devuelta.elegidos.has('4'))
const volviendo = enPagina(devuelta, 0)
ok('volver atrás no pierde las páginas traídas', volviendo.paginas.length === 2)
ok('ni consulta de nuevo (mismo array de la página 1)', volviendo.paginas[0] === pagina1.productos)

console.log('Caso 4 · Cierre y reemplazo:')
ok('click afuera sólo oculta', cerrado(devuelta).abierto === false)
ok('y no destruye lo traído', cerrado(devuelta).paginas.length === 2)
ok('lo oculto se puede volver a listar', reabierto(cerrado(devuelta)).abierto === true)
const nueva = conPrimeraPagina(pagina2)
ok('una búsqueda nueva reemplaza los resultados', nueva.paginas.length === 1)
ok('y limpia las marcas de la búsqueda anterior', nueva.elegidos.size === 0)

console.log(`\nOK · ${asserts} asserts pasaron.`)
