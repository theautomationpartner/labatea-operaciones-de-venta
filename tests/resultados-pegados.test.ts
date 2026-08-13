/**
 * La lista de resultados del buscador de clientes cuelga PEGADA al campo.
 *
 * `.results` se posiciona con `top: 100%`, así que dónde cae depende de cuál sea su bloque
 * contenedor. Colgada de `.search-container` —que además del campo lleva el gap de la columna y el
 * renglón del aviso— la lista aparecía flotando 30px más abajo, separada del buscador. Se corrigió
 * envolviendo SÓLO al campo en `.search-anclaje`, que es lo que ahora la ancla.
 *
 * Nada más lo mira: no hay navegador ni runner de DOM, y el desplegable sólo se monta después de
 * una búsqueda con varias coincidencias, así que la regresión pasa desapercibida hasta que alguien
 * la ve en pantalla. Por eso se afirma sobre las dos piezas que la producen: el anidado del markup
 * y la geometría en la hoja de estilos.
 *
 * Se corre con esbuild + node (`npm run test:resultados-pegados`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tsx = readFileSync('src/features/cliente/BuscarCliente.tsx', 'utf8')
const css = readFileSync('src/styles/cliente.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/* ---------- 1) El markup: la lista vive DENTRO del anclaje ---------- */
const anclaje = tsx.indexOf('className="search-anclaje"')
const lista = tsx.indexOf('className="results"')
const cierreAnclaje = tsx.indexOf('{/* Debajo del campo ya NO va la ayuda')
assert.ok(anclaje > 0, 'el anclaje del desplegable tiene que existir')
assert.ok(
  anclaje < lista && lista < cierreAnclaje,
  'la lista de resultados tiene que estar dentro de `.search-anclaje`: fuera, vuelve a colgar del ' +
    'contenedor y reaparece el hueco',
)
/* El renglón del aviso queda FUERA del anclaje: si entrara, volvería a sumar su alto al `top`. */
assert.ok(
  tsx.indexOf('className={`search-helper') > cierreAnclaje - 1,
  'el renglón del aviso va fuera del anclaje',
)

/* ---------- 2) La geometría ---------- */
const bloque = (sel: string): string => {
  const re = new RegExp(`${sel.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{([^}]*)\\}`)
  const m = re.exec(css)
  assert.ok(m, `no existe la regla ${sel}: cambió la hoja de estilos`)
  return m![1]
}
const decl = (sel: string, prop: string): string | null =>
  new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm').exec(bloque(sel))?.[1].trim() ?? null

assert.equal(
  decl('.cliente-v2 .search-anclaje', 'position'),
  'relative',
  'el anclaje tiene que ser el bloque contenedor del desplegable',
)
/* Sólo envuelve al campo, así que su alto ES el del campo y el `top: 100%` cae en su borde. */
assert.ok(
  !/\.cliente-v2 \.search-container\s*\{[^}]*position:\s*relative/.test(css),
  'el contenedor NO puede volver a posicionarse: le ganaría el anclaje al desplegable',
)
/* La regla base de `.results` (views.css) trae `margin-top: 4px`; acá se anula. El -1px solapa los
   dos bordes de 1px para que no se dibuje una línea doble entre el campo y la lista. */
assert.equal(
  decl('.cliente-v2 .results', 'margin-top'),
  '-1px',
  'la lista no puede separarse del campo: sin esto vuelve el margen de la regla base',
)

console.log('OK · la lista de resultados queda pegada al campo del buscador')
