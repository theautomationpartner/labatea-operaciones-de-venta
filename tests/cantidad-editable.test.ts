/**
 * El campo "Cantidad" de la carga de producto se puede DEJAR VACÍO mientras se escribe.
 *
 * Antes corregía en cada tecla (`Math.max(1, Number(v) || 1)` en el `onChange`), así que el "1" no
 * se podía borrar: para cargar 30 había que pararse a la derecha del 1 y borrar hacia atrás. El
 * campo se defendía de un estado inválido pisando lo que la persona estaba escribiendo.
 *
 * La regla ahora es otra: se acepta el vacío MIENTRAS se edita y se resuelve al salir del campo.
 *
 * Se corre con esbuild + node (`npm run test:cantidad`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cantidadEfectiva, soloCantidad } from '@/lib/validaciones'

/* ---------- Se puede borrar el 1 y escribir otro número ---------- */
const tecleo = ['', '3', '30'].map(soloCantidad)
assert.deepEqual(tecleo, ['', '3', '30'], 'el campo acepta quedar vacío y después llenarse')
assert.equal(soloCantidad(''), '', 'el vacío NO se corrige mientras se escribe: eso era el bug')

/* Y los cálculos de al lado nunca ven un cero: con el campo vacío la cantidad efectiva es 1. */
assert.equal(cantidadEfectiva(''), 1, 'campo vacío = 1 para los cálculos')
assert.equal(cantidadEfectiva('3'), 3)
assert.equal(cantidadEfectiva('30'), 30)

/* ---------- Al salir del campo se resuelve ----------
   Lo que se muestra al perder el foco es la MISMA cantidad efectiva, así que lo que se ve y lo que
   se calcula no pueden discrepar. */
const alSalir = (texto: string) => String(cantidadEfectiva(texto))
assert.equal(alSalir(''), '1', 'vacío vuelve a 1')
assert.equal(alSalir('0'), '1', 'cero tampoco es una cantidad')
assert.equal(alSalir('00'), '1')
assert.equal(alSalir('007'), '7', 'y los ceros a la izquierda se normalizan')
assert.equal(alSalir('5'), '5', 'una cantidad válida no se toca')

/* ---------- Lo que no puede entrar ----------
   `type="number"` deja pasar el signo, el punto y la notación científica; cualquiera de los tres
   rompe el valor, así que se filtran antes de que lleguen al estado. */
assert.equal(soloCantidad('-5'), '5', 'sin negativos')
assert.equal(soloCantidad('2.5'), '25', 'sin decimales: las unidades son enteras')
assert.equal(soloCantidad('1e3'), '13', 'sin notación científica')
assert.equal(soloCantidad('abc'), '', 'sin letras')
/* Ninguna entrada rara puede terminar en una cantidad menor a 1. */
for (const raro of ['-5', '-0', 'abc', '', '0', '.', 'NaN']) {
  assert.ok(cantidadEfectiva(soloCantidad(raro)) >= 1, `"${raro}" nunca baja de 1`)
}

/* ---------- Que el componente use esto y NO vuelva a corregir al tipear ---------- */
const vista = readFileSync('src/features/productos/CargaLinea.tsx', 'utf8')
assert.match(vista, /onChange=\{\(e\) => setCantidadTexto\(soloCantidad\(e\.target\.value\)\)\}/, 'el onChange sólo filtra')
assert.match(vista, /onBlur=\{\(\) => setCantidadTexto\(String\(cantidad\)\)\}/, 'y el vacío se resuelve al salir')
/* El estado es el TEXTO: con un número no hay forma de representar "vacío" y vuelve el bug. */
assert.match(vista, /useState\('1'\)/, 'la cantidad vive como texto mientras se edita')

console.log('OK · la cantidad se puede borrar mientras se edita y vuelve a 1 al salir del campo')
