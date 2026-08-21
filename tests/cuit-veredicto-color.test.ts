/**
 * El veredicto del CUIT del emisor se ve: cuadrado VERDE con tilde si el cheque se puede recibir,
 * ROJO con cruz si es del cliente y no le tomamos cheques.
 *
 * Parece de más tener un test para dos colores, pero este circuito ya falló dos veces y las dos en
 * silencio: primero el badge llegó SIN estilos —se portó el markup y no su CSS, así que el veredicto
 * se dibujaba como texto suelto—, y antes una regla genérica `:disabled` le comía el fondo a un
 * botón de estado. Ni el typecheck, ni el build, ni ningún otro test miran esto.
 *
 * Se afirma sobre las dos mitades que lo producen: que el markup pida las clases, y que la hoja de
 * estilos las defina con el formato y los colores que corresponden.
 *
 * Se corre con esbuild + node (`npm run test:cuit-veredicto`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/styles/cobro.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const tsx = readFileSync('src/features/cobro/FormularioCobro.tsx', 'utf8')

/** Cuerpo de la regla de un selector, buscándolo como texto: sin regex no hay nada que escapar. */
const bloque = (sel: string): string => {
  const i = css.indexOf(sel + ' {')
  assert.notEqual(i, -1, `no existe la regla ${sel}: el veredicto se dibujaría sin formato`)
  const desde = css.indexOf('{', i) + 1
  return css.slice(desde, css.indexOf('}', desde))
}

/** Valor de una propiedad dentro de esa regla, o null si no la declara. */
const decl = (sel: string, prop: string): string | null => {
  for (const linea of bloque(sel).split(';')) {
    const [k, ...resto] = linea.split(':')
    if (k.trim() === prop) return resto.join(':').trim()
  }
  return null
}

/* ---------- 1) El markup pide las tres clases ---------- */
for (const clase of ['cobro-cuit-estado', 'cobro-cuit-estado--ok', 'cobro-cuit-estado--err']) {
  assert.ok(tsx.includes(clase), `el formulario tiene que pedir .${clase}`)
}
/* El ícono es el que comunica; el color acompaña. Un veredicto que dependiera sólo del verde y el
   rojo no diría nada a quien no distingue esos dos colores. */
assert.ok(tsx.includes('fa-check'), 'el tilde del CUIT aceptado')
assert.ok(tsx.includes('fa-xmark'), 'la cruz del rechazado')

/* ---------- 2) El formato: un cuadrado del alto del campo ---------- */
const base = '.cobro-v2 .cobro-cuit-estado'
assert.equal(decl(base, 'width'), '40px', 'mismo ancho que alto: es un cuadrado')
assert.equal(decl(base, 'height'), '40px', 'y del alto de los tramos del CUIT')
assert.equal(decl(base, 'color'), '#fff', 'el ícono va en blanco sobre el color de fondo')
assert.ok(decl(base, 'border-radius'), 'con las esquinas redondeadas del resto de los controles')

/* ---------- 3) Los colores ---------- */
assert.equal(
  decl('.cobro-v2 .cobro-cuit-estado--ok', 'background'),
  'var(--c-success)',
  'aceptado: verde',
)
assert.equal(
  decl('.cobro-v2 .cobro-cuit-estado--err', 'background'),
  'var(--c-danger)',
  'rechazado: rojo',
)
/* Sin veredicto el cuadrado se dibuja igual, VACÍO: es lo que evita que los tramos del CUIT se
   corran de lugar cuando aparece el resultado. Así que la regla base no puede pintar el fondo. */
assert.equal(decl(base, 'background'), null, 'sin veredicto todavía, el cuadrado no lleva color')

console.log('OK · el veredicto del CUIT se ve verde con tilde o rojo con cruz')
