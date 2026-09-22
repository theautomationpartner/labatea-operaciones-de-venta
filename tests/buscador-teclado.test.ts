/**
 * El buscador de productos se maneja con el teclado sin que la PÁGINA se mueva ni el foco se pierda.
 *
 * Los dos bugs que este test congela aparecieron juntos en producción y tenían la misma raíz: el
 * manejador de teclas colgaba del `<input>`.
 *
 *   1. Al apretar «Buscar» con el MOUSE, el foco queda en el BOTÓN. Desde ahí las flechas no
 *      llegaban al manejador y el navegador hacía lo suyo —scrollear la página—, y Enter volvía a
 *      activar el botón en vez de cargar el producto resaltado. Para el usuario: "las flechas
 *      mueven la página" y "Enter no hace nada".
 *   2. Aun con el foco bien puesto, `scrollIntoView` desplaza TODOS los ancestros scrolleables hasta
 *      dejar el elemento a la vista, incluida la ventana. La página se movía en cada flecha aunque
 *      la fila ya estuviera visible dentro del desplegable.
 *
 * Por qué se testea sobre el FUENTE y no simulando teclas: los dos son bugs de cableado —de qué
 * elemento escucha y de qué API se usa para scrollear—, no de lógica. La lógica de navegación
 * (`mover`, `productoActivo`, dónde frena) ya está cubierta, y pura, en `test:resultados`; ninguna
 * de esas dos fallas la habría hecho fallar. Sin un DOM real en los tests, mirar el cableado es lo
 * que queda, y es el mismo recurso que usa `test:asociar-actividades`.
 *
 *   npm run test:buscador-teclado
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let asserts = 0
const ok = (nombre: string, cond: boolean) => {
  assert.ok(cond, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const fuente = readFileSync('src/features/productos/BuscadorProducto.tsx', 'utf8')

console.log('Caso 1 · La página no se mueve al navegar:')
/* `scrollIntoView` scrollea la ventana además del desplegable. El reemplazo toca un solo
   `scrollTop`, el de la lista, así que nada afuera del componente se entera. */
ok('no se usa scrollIntoView en ningún lado', !/\.scrollIntoView\s*\(/.test(fuente))
ok('se desplaza a mano el scroll de la lista', fuente.includes('cont.scrollTop -='))
ok('y en las dos direcciones', fuente.includes('cont.scrollTop +='))
/* Por rectángulos y no por `offsetTop`, que se mide contra el ancestro posicionado más cercano y
   se rompería en silencio si el CSS cambiara un `position`. */
ok('midiendo por rectángulos', fuente.includes('getBoundingClientRect()'))

console.log('\nCaso 2 · Las teclas llegan esté donde esté el foco dentro del buscador:')
/* En el CONTENEDOR y no en el input: así el evento burbujea desde el input, desde el botón Buscar
   o desde una fila, y las flechas y Enter funcionan igual en los tres casos. */
ok(
  'la variante v2 escucha el teclado en el contenedor',
  fuente.includes('<div className="search-row" ref={ref} onKeyDown={alPresionarTecla}>'),
)
ok(
  'la variante clásica también',
  fuente.includes('<div className="searchc" ref={ref} onKeyDown={alPresionarTecla}>'),
)
/* Si además quedara en el input, el manejador correría dos veces por tecla y el resaltado saltaría
   de a dos filas. */
ok('y el input ya NO lo escucha por su cuenta', !fuente.includes('onKeyDown: alPresionarTecla'))
ok(
  'el manejador está tipado para el contenedor',
  fuente.includes('alPresionarTecla = (e: React.KeyboardEvent<HTMLDivElement>)'),
)

console.log('\nCaso 3 · El foco vuelve al campo después de buscar:')
/* Es la otra mitad del arreglo: quien apretó «Buscar» con el mouse tiene que poder seguir con las
   flechas sobre los resultados que acaban de llegar, sin volver a clickear el campo. */
ok('hay una referencia al input', fuente.includes('const inputRef = useRef<HTMLInputElement>(null)'))
ok('que se le pasa al campo', fuente.includes('ref: inputRef'))
ok('y recibe el foco al terminar de buscar', fuente.includes('inputRef.current?.focus()'))

console.log('\nCaso 4 · Elegir con el mouse no rompe el teclado:')
/* El mousedown por defecto le saca el foco al campo y se lo da a la fila; desde ahí las flechas
   vuelven a scrollear la página. */
ok(
  'el mousedown de la fila se cancela para no robar el foco',
  fuente.includes('onMouseDown={(e) => e.preventDefault()}'),
)

console.log('\nCaso 5 · Enter carga lo resaltado; sólo busca si no hay nada resaltado:')
ok('Enter cancela la acción por defecto', /case 'Enter':\s*\n\s*e\.preventDefault\(\)/.test(fuente))
/* El orden importa: con el foco en «Buscar», si Enter no eligiera primero, el navegador sintetiza
   un click y se dispara una búsqueda encima de la selección. */
ok(
  'y elige antes de buscar',
  fuente.includes('if (marcado) void elegir(marcado)') && fuente.includes('else void buscar()'),
)

console.log('\nCaso 6 · Escribir sigue siendo escribir:')
/* Inicio/Fin NO se interceptan: la lista está abierta casi todo el tiempo mientras se tipea, así
   que apropiárselas le sacaría al usuario el salto al principio y al final de lo que escribe. */
ok("no se intercepta 'Home'", !fuente.includes("case 'Home':"))
ok("ni 'End'", !fuente.includes("case 'End':"))
/* AvPág/RePág sí, porque en un campo de una línea no hacen nada útil. */
ok("AvPág se usa para saltar", fuente.includes("case 'PageDown':"))

console.log(`\n${asserts} verificaciones OK`)
