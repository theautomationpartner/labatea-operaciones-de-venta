/**
 * La lista de resultados del buscador de productos: navegación por teclado y crecimiento continuo.
 *
 * Dos cosas que este estado tiene que garantizar y que son fáciles de romper sin darse cuenta:
 *
 * 1. **Elegir un producto repliega la lista pero NO la destruye.** Los resultados, el cursor y la
 *    fila en la que estaba parado el usuario siguen ahí, para poder tomar otro producto de la misma
 *    búsqueda sin volver a consultar.
 * 2. **El resaltado no se mueve solo.** Es lo que carga Enter; si un tramo que llega por detrás se
 *    lo corriera, el usuario cargaría un producto distinto del que estaba mirando.
 *
 * Lo que este estado NO guarda es qué fila va marcada como "Seleccionado": esa marca es del producto
 * cargado AHORA en «Producto seleccionado» y la aporta el padre (`codigoCargado`). Cuando vivía acá
 * se acumulaba —todo lo elegido quedaba en gris para siempre—.
 *
 *   npm run test:resultados
 */
import assert from 'node:assert/strict'
import {
  SIN_ACTIVO,
  SIN_RESULTADOS,
  cerrado,
  conMasResultados,
  conPrimerosResultados,
  conResultadosLocales,
  convieneTraerMas,
  mover,
  productoActivo,
  reabierto,
  replegado,
  resaltar,
  sinMasResultados,
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

const tramo1 = { productos: ['1', '2', '3', '4', '5'].map(prod), cursor: 'cursor-2' }
const tramo2 = { productos: ['6', '7'].map(prod), cursor: null }

console.log('Caso 1 · La primera fila viene resaltada:')
const primera = conPrimerosResultados(tramo1)
/* Lo que se busca es, casi siempre, lo primero. Que arranque resaltado deja cargarlo con Enter sin
   tocar una sola flecha, que es el punto de todo esto. */
ok('arranca en la fila 0', primera.activo === 0)
ok('y la lista se abre sola', primera.abierto === true)
ok('con el cursor para seguir trayendo', primera.cursor === 'cursor-2')
ok('Enter cargaría el primero', productoActivo(primera)?.codigo === '1')

const vacia = conPrimerosResultados({ productos: [], cursor: null })
ok('sin resultados no hay nada resaltado', vacia.activo === SIN_ACTIVO)
ok('ni lista que abrir', vacia.abierto === false)
ok('y Enter no carga nada', productoActivo(vacia) === null)

console.log('\nCaso 2 · Las flechas recorren la lista y frenan en los bordes:')
ok('bajar una', mover(primera, 1).activo === 1)
ok('bajar y subir vuelve al mismo lugar', mover(mover(primera, 1), -1).activo === 0)
/* Sin wrap a propósito: la lista CRECE sola cerca del final, así que saltar del último al primero
   dejaría al usuario arriba justo cuando estaba por aparecer más. */
ok('subir en la primera no da la vuelta', mover(primera, -1).activo === 0)
const enUltima = mover(primera, 99)
ok('un salto grande frena en la última', enUltima.activo === 4)
ok('bajar en la última no da la vuelta', mover(enUltima, 1).activo === 4)
ok('AvPág salta de a varias', mover(primera, 10).activo === 4)
/* Sin cambio, el mismo objeto: evita rerenders que cortarían el scroll suave. */
ok('si no se mueve, devuelve el mismo estado', mover(enUltima, 1) === enUltima)
ok('sobre una lista vacía no hace nada', mover(SIN_RESULTADOS, 1) === SIN_RESULTADOS)

console.log('\nCaso 3 · Sin nada resaltado, se entra por la punta que corresponde:')
const sinActivo = { ...primera, activo: SIN_ACTIVO }
ok('bajar entra por la primera', mover(sinActivo, 1).activo === 0)
ok('subir entra por la última', mover(sinActivo, -1).activo === 4)

console.log('\nCaso 4 · La lista crece sin moverle el piso al usuario:')
const bajando = mover(primera, 3)
ok('el usuario está en la fila 3', bajando.activo === 3)
const crecida = conMasResultados(bajando, tramo2)
ok('se agregaron los dos nuevos al final', crecida.productos.length === 7)
/* Lo importante del caso: el tramo llega por detrás mientras el usuario baja. Correrle el
   resaltado le haría cargar un producto distinto del que estaba mirando. */
ok('el resaltado NO se movió', crecida.activo === 3)
ok('el orden se respeta', crecida.productos[5].codigo === '6')
ok('y el cursor se actualiza', crecida.cursor === null)

console.log('\nCaso 5 · Cuándo conviene ir pidiendo más:')
/* Se dispara ANTES del final para que el tramo llegue mientras todavía se está bajando; esperar a
   tocar la última fila dejaría la flecha clavada en cada borde. */
ok('en la fila 0 de 5, todavía no', convieneTraerMas(primera, 2) === false)
ok('en la fila 3 de 5, con margen 2, sí', convieneTraerMas(mover(primera, 3), 2) === true)
ok('sin cursor no se pide nunca', convieneTraerMas(crecida, 5) === false)
const agotado = sinMasResultados(bajando)
ok('un cursor agotado apaga el pedido', convieneTraerMas(agotado, 5) === false)
ok('pero no toca lo ya traído', agotado.productos.length === 5)

console.log('\nCaso 6 · Elegir repliega, volver relista donde estaba:')
const trasElegir = replegado(bajando)
ok('la lista se repliega para despejar "Producto seleccionado"', trasElegir.abierto === false)
ok('los resultados son los MISMOS', trasElegir.productos === bajando.productos)
ok('y el resaltado quedó donde estaba', trasElegir.activo === 3)
ok('el estado anterior no se mutó', bajando.abierto === true)
/* Replegada, Enter no puede cargar nada: lo que no se ve no se elige. */
ok('replegada, no hay producto activo', productoActivo(trasElegir) === null)

const relistada = reabierto(trasElegir)
ok('vuelve a verse', relistada.abierto === true)
ok('en la misma fila', relistada.activo === 3)
ok('y Enter cargaría ese mismo producto', productoActivo(relistada)?.codigo === '4')
ok('sin resultados guardados no se abre nada', reabierto(SIN_RESULTADOS).abierto === false)

console.log('\nCaso 7 · El mouse resalta, sin pelearse con el teclado:')
ok('pasar por la fila 1 la resalta', resaltar(relistada, 1).activo === 1)
ok('un índice fuera de rango se ignora', resaltar(relistada, 99) === relistada)
ok('un índice negativo también', resaltar(relistada, -1) === relistada)
ok('resaltar la que ya estaba no genera estado nuevo', resaltar(relistada, 3) === relistada)

console.log('\nCaso 8 · Los resultados del caché vienen completos:')
const locales = conResultadosLocales(['a', 'b', 'c'].map(prod), true)
ok('están los tres', locales.productos.length === 3)
/* El caché resolvió la búsqueda en memoria: no hay nada más que pedirle a nadie. */
ok('no hay cursor que seguir', locales.cursor === null)
ok('nunca pide más', convieneTraerMas(locales, 99) === false)
ok('arranca resaltando el primero', locales.activo === 0)
ok('marca que la lista quedó cortada', locales.truncado === true)
ok('y se distingue de los de Monday', locales.origen === 'cache')
ok('sin coincidencias no se abre', conResultadosLocales([]).abierto === false)

console.log('\nCaso 9 · Cerrar oculta sin perder nada:')
const cerrada = cerrado(relistada)
ok('se oculta', cerrada.abierto === false)
ok('sin perder lo traído', cerrada.productos.length === 5)
ok('lo oculto se puede volver a listar', reabierto(cerrada).abierto === true)
ok('cerrar lo ya cerrado no genera estado nuevo', cerrado(cerrada) === cerrada)

console.log(`\n${asserts} verificaciones OK`)
