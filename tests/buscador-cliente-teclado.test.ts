/**
 * El buscador de CLIENTES se maneja con el teclado, y Enter no sale a la red si ya hay resultados.
 *
 * Tres reglas que se sostienen entre sí:
 *
 *   1. Las flechas recorren la lista, sin que la PÁGINA se mueva.
 *   2. Enter carga el cliente resaltado. Sólo consulta a Monday cuando NO hay ningún resultado
 *      para lo escrito, que es el único caso en que hace falta: el padrón no lo tiene y puede ser
 *      un cliente dado de alta después de la última corrida del cron.
 *   3. La primera fila arranca resaltada. Sin eso, "Enter confirma un cliente" sería confirmar a
 *      ciegas: con la lista ordenada por cuánto matchea, Enter cargaría algo que el usuario no
 *      tiene marcado en pantalla. En este buscador eso no es un detalle —elegir al cliente
 *      equivocado es facturarle a otro—.
 *
 * Por qué se testea sobre el FUENTE: el proyecto no tiene runner de DOM (los tests `.tsx`
 * renderizan con `react-dom/server`, donde los efectos no corren), así que no hay forma de simular
 * una tecla. Y los dos bugs que esto previene son de CABLEADO —de qué elemento escucha y de qué
 * API se usa para scrollear—, no de lógica: ninguno haría fallar un test de la lógica de
 * navegación. Es el mismo recurso, y por la misma razón, que `test:buscador-teclado` en productos.
 *
 *   npm run test:buscador-cliente-teclado
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let asserts = 0
const ok = (nombre: string, cond: boolean) => {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const fuente = readFileSync('src/features/cliente/BuscarCliente.tsx', 'utf8')
const css = readFileSync('src/styles/cliente.css', 'utf8')

console.log('Caso 1 · La página no se mueve al navegar:')
/* `scrollIntoView` scrollea la ventana además del desplegable. El reemplazo toca un solo
   `scrollTop`, el de la lista, así que nada afuera del componente se entera. */
ok('no se usa scrollIntoView en ningún lado', !/\.scrollIntoView\s*\(/.test(fuente))
ok('se desplaza a mano el scroll de la lista', fuente.includes('cont.scrollTop -='))
ok('y en las dos direcciones', fuente.includes('cont.scrollTop +='))
/* Por rectángulos y no por `offsetTop`, que se mide contra el ancestro posicionado más cercano y
   se rompería en silencio si el CSS cambiara un `position`. */
ok('midiendo por rectángulos', fuente.includes('getBoundingClientRect()'))
/* Sin `preventDefault`, la flecha mueve el cursor dentro del texto Y scrollea la página. */
ok('las flechas cancelan el comportamiento del navegador', fuente.includes('e.preventDefault()'))

console.log('\nCaso 2 · Las teclas llegan esté donde esté el foco dentro del buscador:')
/* El campo y el botón Buscar son HERMANOS. Sin un padre común, apretar Buscar con el mouse deja el
   foco en el botón y desde ahí las flechas no llegan a ningún manejador: la página scrollea y
   Enter vuelve a disparar el botón. */
ok(
  'el teclado se escucha en un envoltorio que cubre el campo Y el botón',
  fuente.includes('<div className="search-teclado" onKeyDown={alPresionarTecla}>'),
)
/* `display: contents` lo borra del layout: los dos siguen siendo los ítems flex de la barra. Sin
   esa regla, el envoltorio se comería el `flex-grow` del campo y el buscador cambiaría de ancho. */
ok('y ese envoltorio no existe para el layout', /\.search-teclado\s*\{\s*display:\s*contents/.test(css))
/* Si además quedara en el input, el manejador correría dos veces por tecla y el resaltado saltaría
   de a dos filas. Se acota al elemento REAL —por su className— y no se busca `<input` a secas: eso
   también encuentra el `<input>` que aparece escrito dentro de un comentario. */
const marca = fuente.indexOf('className="search-input"')
const inputJsx = fuente.slice(fuente.lastIndexOf('<input', marca), fuente.indexOf('/>', marca))
ok('el input ya NO escucha teclas por su cuenta', !inputJsx.includes('onKeyDown'))
ok(
  'el manejador está tipado para el contenedor',
  fuente.includes('(e: React.KeyboardEvent<HTMLDivElement>)'),
)

console.log('\nCaso 3 · Enter confirma, y sólo busca si no hay nada:')
ok('Enter carga el cliente resaltado', fuente.includes('if (marcado) void elegir(marcado)'))
ok('y sólo si no hay ninguno sale a Monday', fuente.includes('else void buscar()'))
/* La regla de negocio pedida: con resultados a la vista, Enter NO consulta la red. Se verifica que
   la llamada a `buscar` esté detrás del `else` del resaltado y no suelta en el case. */
const enter = fuente.slice(fuente.indexOf("case 'Enter'"), fuente.indexOf("default:"))
ok(
  'el Enter no tiene ninguna otra salida a la red',
  enter.split('buscar()').length === 2 && enter.includes('else void buscar()'),
)

console.log('\nCaso 4 · La primera fila arranca resaltada, para que Enter nunca confirme a ciegas:')
ok('el resaltado arranca en la mejor coincidencia', fuente.includes('useState(0)'))
/* La lista cambia con cada tecla: un índice guardado puede quedar apuntando más allá del final. */
ok(
  'el índice se acota al largo de la lista en cada render',
  fuente.includes('Math.min(activo, resultados.length - 1)'),
)
ok(
  'y vuelve a la primera fila cuando cambia lo que se muestra',
  fuente.includes('setActivo(0)') && fuente.includes('}, [termino, remotos])'),
)
ok('la fila resaltada se marca en el DOM', fuente.includes("i === indiceActivo ? 'ritem--activo' : ''"))

console.log('\nCaso 5 · El mouse y el teclado no se pelean:')
/* El mousedown por defecto le saca el foco al campo y se lo da a la fila, y desde ahí las flechas
   vuelven a scrollear la página. */
ok('elegir con el mouse no le roba el foco al campo', fuente.includes('onMouseDown={(e) => e.preventDefault()}'))
/* El mouse recupera el mando al MOVERSE, no cuando la lista le pasa por debajo al scrollear. */
ok('el mouse quieto no roba el resaltado', fuente.includes('conTeclado.current = false'))
ok('y el teclado lo reclama al navegar', fuente.includes('conTeclado.current = true'))

console.log('\nCaso 6 · Lectores de pantalla:')
ok('la lista se anuncia como listbox', fuente.includes('role="listbox"'))
ok('cada fila como option', fuente.includes('role="option"'))
ok('y el campo dice cuál está activa', fuente.includes('aria-activedescendant'))

console.log(`\n${asserts} verificaciones OK · flechas para recorrer, Enter para confirmar`)
