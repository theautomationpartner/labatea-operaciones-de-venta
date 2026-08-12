/**
 * El botón "Validar" del CUIT queda VERDE cuando la validación sale bien.
 *
 * Parece de más tener un test para un color, pero este falla en silencio y ya se escapó: el botón
 * validado está `disabled` —no queda nada que validar—, y al final de `cobro.css` vive un
 * `.cobro-v2 .cobro-btn:disabled` que pinta de gris CUALQUIER botón deshabilitado. Con una sola
 * clase, esa regla le gana por especificidad al verde y se lo come, sin que nada falle: ni el
 * typecheck ni el build ni ningún otro test miran la cascada.
 *
 * Así que se resuelve la cascada a mano: se juntan todas las reglas de `cobro.css` que matchean el
 * botón validado, se ordenan por (especificidad, orden de aparición) y se mira cuál termina
 * pintando. Es lo mismo que hace el navegador para una hoja de estilos sin `!important`.
 *
 * Se corre con esbuild + node (`npm run test:boton-validar`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/** Cómo se monta el botón validado: `<button class="…" disabled>` dentro de `.cobro-v2`. */
const CLASES = ['cobro-v2', 'cobro-btn', 'cobro-btn--validar', 'cobro-btn--validar-ok']
/** Pseudo-clases que el elemento SÍ tiene. Cualquier otra descarta la regla (no está en hover…). */
const ESTADOS = [':disabled']

const css = readFileSync('src/styles/cobro.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** La regla le aplica al botón: todo lo que pide está entre sus clases y sus estados. */
function matchea(selector: string): boolean {
  const sel = selector.trim()
  if (!sel || sel.includes('@') || !sel.includes('.cobro-btn')) return false
  // Se ignoran los combinadores: alcanza con que cada pieza pedida esté presente en el elemento.
  const piezas = sel.match(/[.:[][\w\-[\]()='"]+/g) ?? []
  return piezas.every((p) =>
    p.startsWith('.') ? CLASES.includes(p.slice(1)) : ESTADOS.includes(p),
  )
}

/** Sin ids ni `!important` en juego, la especificidad es cuántas clases y pseudo-clases pide. */
const especificidad = (sel: string) => (sel.match(/[.:[]/g) ?? []).length

interface Regla {
  esp: number
  orden: number
  selector: string
  background: string | null
  opacity: string | null
}

const reglas: Regla[] = []
const bloques = css.matchAll(/([^{}]+)\{([^{}]*)\}/g)
let orden = 0
for (const bloque of bloques) {
  const [, selectores, cuerpo] = bloque
  orden++
  for (const sel of selectores.split(',')) {
    if (!matchea(sel)) continue
    reglas.push({
      esp: especificidad(sel),
      orden,
      selector: sel.trim(),
      background: /background\s*:\s*([^;]+)/.exec(cuerpo)?.[1].trim() ?? null,
      opacity: /opacity\s*:\s*([^;]+)/.exec(cuerpo)?.[1].trim() ?? null,
    })
  }
}

// El navegador resuelve por especificidad y, a igualdad, por orden de aparición.
reglas.sort((a, b) => a.esp - b.esp || a.orden - b.orden)
const ultima = <K extends 'background' | 'opacity'>(prop: K) =>
  [...reglas].reverse().find((r) => r[prop])?.[prop] ?? null

assert.ok(reglas.length > 0, 'alguna regla tiene que alcanzar al botón: si no, cambió el markup')

assert.equal(
  ultima('background'),
  'var(--c-success)',
  'el botón validado tiene que quedar VERDE: alguna regla genérica le está ganando el fondo',
)
assert.ok(
  ultima('opacity') === null || ultima('opacity') === '1',
  'y sin atenuar: el verde es el acuse de recibo de la validación, no un botón apagado',
)

/* El rechazado NO está deshabilitado —se puede volver a validar—, así que el `:disabled` genérico
   ni lo toca. Alcanza con verificar que su rojo esté declarado con la misma fuerza que el verde. */
assert.ok(
  /\.cobro-v2 \.cobro-btn\.cobro-btn--validar-mal\s*\{[^}]*background:\s*var\(--c-danger\)/.test(css),
  'el rechazado se declara con la misma especificidad que el validado',
)

console.log('OK · el botón Validar queda verde al validar y rojo al rechazar')
