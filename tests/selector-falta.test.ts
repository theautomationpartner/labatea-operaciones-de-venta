/**
 * Los selectores que gobiernan el recorrido se pintan de ROJO cuando el usuario intenta avanzar y
 * falta elegirlos: tipo de venta, tipo de entrega, forma de pago, tipo de operación y "la venta
 * es…".
 *
 * Son cinco componentes en cuatro carpetas distintas, y cada uno podría resolver su clase por su
 * cuenta. No pueden: así fue como la app terminó con cuatro diseños distintos del botón "Volver".
 * Por eso la regla vive en `faltaSeleccion` y este test verifica que los cinco la usen.
 *
 * La otra mitad es que la marca se CALCULA —"se intentó avanzar Y sigue vacío"— en vez de
 * guardarse. Es lo que hace que se apague sola al elegir, sin que ningún componente tenga que
 * acordarse de bajarla; guardada, quedaría encendida sobre un campo ya completo.
 *
 * Se corre con esbuild + node (`npm run test:selector-falta`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { claseCajaSelector, claseSelector } from '@/features/shared/faltaSeleccion'

/* ---------- 1) La regla ---------- */
assert.equal(claseCajaSelector('DIRECTA', true), 'cfgbox', 'elegido y con intento: sin marca')
assert.equal(claseCajaSelector('DIRECTA', false), 'cfgbox', 'elegido y sin intento: sin marca')
assert.equal(claseCajaSelector(null, false), 'cfgbox', 'vacío pero sin intentar avanzar: sin marca')
assert.equal(
  claseCajaSelector(null, true),
  'cfgbox cfgbox--falta',
  'vacío Y se intentó avanzar: SE MARCA',
)
/* Se marca sólo lo que falta: elegir uno lo apaga sin tocar a los demás. */
assert.equal(claseCajaSelector('', true), 'cfgbox cfgbox--falta', 'el string vacío cuenta como vacío')
assert.equal(claseSelector(null), 'cfg-sel--ph', 'sin elegir, el texto va como placeholder')
assert.equal(claseSelector('DIRECTA'), '', 'elegido, en negro')

/* ---------- 2) Los CINCO selectores usan la regla compartida ---------- */
const SELECTORES = [
  ['src/features/cliente/VentaConfig.tsx', 'Tipo de venta · Tipo de entrega'],
  ['src/features/cliente/RemitoConfig.tsx', 'La venta es…'],
  ['src/features/productos/FormaPagoSelect.tsx', 'Forma de pago'],
  ['src/features/actividad/SelectorTipoOperacion.tsx', 'Tipo de operación'],
] as const

for (const [archivo, cual] of SELECTORES) {
  const fuente = readFileSync(archivo, 'utf8')
  assert.ok(
    fuente.includes('claseCajaSelector('),
    `${cual} (${archivo}) tiene que marcar su caja con la regla compartida`,
  )
  /* Y NO puede quedarse con una caja fija: ahí la marca no llegaría nunca. */
  assert.ok(
    !fuente.includes('className="cfgbox"'),
    `${cual} dejó una caja sin la marca: no se va a pintar cuando falte`,
  )
  assert.ok(
    fuente.includes('intentoAvanzar'),
    `${cual} tiene que leer del estado si se intentó avanzar`,
  )
}

/* ---------- 3) Todo lo que FRENA enciende la marca ----------
   La marca sin el disparo no sirve de nada: el selector se quedaría en violeta mientras la ventana
   dice que falta. Se verifica que cada punto que corta el avance por un selector la encienda. */
const FRENOS = [
  ['src/features/cliente/ClienteView.tsx', 'tipo de venta / entrega / emisión del remito'],
  ['src/features/productos/ProductosView.tsx', 'forma de pago'],
  ['src/features/actividad/ActividadView.tsx', 'tipo de operación al finalizar'],
  ['src/features/actividad/ActividadPersonaView.tsx', 'tipo de operación al continuar'],
] as const

for (const [archivo, cual] of FRENOS) {
  assert.ok(
    readFileSync(archivo, 'utf8').includes("dispatch({ type: 'intentoAvanzar' })"),
    `el freno por ${cual} (${archivo}) tiene que encender la marca`,
  )
}

/* ---------- 4) El estilo existe y es rojo ----------
   Sin la regla, los cinco componentes agregarían una clase que no pinta nada y el test de arriba
   seguiría en verde. */
const css = readFileSync('src/styles/views.css', 'utf8')
const regla = /\.cfgbox--falta\s*\{([^}]*)\}/.exec(css)
assert.ok(regla, '.cfgbox--falta tiene que estar definida')
assert.ok(/border-color:\s*var\(--red\)/.test(regla![1]), 'y pintar el borde de rojo')

/* Y se apaga al cambiar de etapa: lo señalado era de la etapa que se deja. */
const estado = readFileSync('src/state/appState.ts', 'utf8')
const goto = estado.indexOf("case 'goto'")
assert.ok(
  estado.slice(goto, goto + 1200).includes('intentoAvanzar: false'),
  'navegar a otra etapa apaga la marca',
)

console.log('OK · los cinco selectores del recorrido se marcan en rojo cuando frenan el avance')
