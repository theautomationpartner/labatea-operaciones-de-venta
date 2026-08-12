/**
 * La separación vertical entre renglones del formulario de "Registrar cobro" es LA MISMA para los
 * cuatro medios: tarjeta de débito, de crédito, transferencia y cheque.
 *
 * Cada medio arma sus renglones con un contenedor distinto —el cobro con tarjeta apila `.cobro-fila`
 * dentro de `.cobro-form`; el cheque y la transferencia los meten adentro de un `.cobro-cond`—, así
 * que la separación se puede desalinear sin que se rompa nada: no hay typecheck ni test que mire el
 * layout, y la diferencia sólo se ve poniendo las dos pantallas al lado. Ya pasó: `.cobro-cond`
 * traía margen, relleno y una línea punteada propios, y elegir cheque abría 54px donde la tarjeta
 * mostraba 24.
 *
 * El test no mide píxeles renderizados (no hay navegador): verifica las dos cosas de las que sale
 * esa distancia —la reserva de cada campo y el `row-gap` del contenedor— y que ningún contenedor de
 * renglones agregue espacio por su cuenta.
 *
 * Se corre con esbuild + node (`npm run test:cobro-ritmo`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/styles/cobro.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Cuerpo de la regla de un selector exacto. */
function bloque(selector: string): string {
  const re = new RegExp(`(^|[,}])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')
  const m = re.exec(css)
  assert.ok(m, `no existe la regla ${selector}: cambió la hoja de estilos`)
  return m![2]
}

const declaracion = (sel: string, prop: string): string | null =>
  new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm').exec(bloque(sel))?.[1].trim() ?? null

/* ---------- 1) El ritmo se declara UNA vez, como variable ---------- */
const raiz = bloque('.cobro-v2')
const reserva = /--c-form-reserva:\s*([^;]+)/.exec(raiz)?.[1].trim()
const filaGap = /--c-form-fila-gap:\s*([^;]+)/.exec(raiz)?.[1].trim()
assert.equal(reserva, '20px', 'la reserva del mensaje de error de cada campo')
assert.equal(filaGap, '4px', 'el respiro que se suma a esa reserva entre renglones')

/* ---------- 2) Los tres contenedores de renglones usan esa misma variable ----------
   `.cobro-form` es el contenedor de la tarjeta; `.cobro-cond` el del cheque, la transferencia y las
   retenciones; `.cobro-fila` el de un renglón que se parte por falta de ancho. */
for (const cont of ['.cobro-v2 .cobro-form', '.cobro-v2 .cobro-cond', '.cobro-v2 .cobro-fila']) {
  assert.equal(
    declaracion(cont, 'row-gap'),
    'var(--c-form-fila-gap)',
    `${cont} tiene que separar sus renglones con el ritmo compartido, no con un número suelto`,
  )
  /* `gap` a secas pisaría el `row-gap` de arriba si se declarara después: la separación horizontal
     va por `column-gap`, que no puede tocar la vertical. */
  assert.equal(declaracion(cont, 'gap'), null, `${cont} no puede usar el atajo \`gap\``)
}

/* ---------- 3) Ningún contenedor de renglones suma espacio por su cuenta ----------
   Es lo que desalineaba al cheque: margen, relleno y línea divisoria arriba del bloque. */
for (const cont of ['.cobro-v2 .cobro-cond', '.cobro-v2 .cobro-fila']) {
  for (const prop of ['margin-top', 'padding-top', 'border-top']) {
    assert.equal(
      declaracion(cont, prop),
      null,
      `${cont} no puede agregar ${prop}: abre un hueco que los otros medios no tienen`,
    )
  }
}

/* ---------- 4) Los campos reservan todos lo mismo ----------
   El del cheque y la transferencia por `--val`; el de la tarjeta por su grilla, que se lo pone a
   TODOS los campos (ahí hay campos sin validación que igual tienen que alinearse por abajo). */
for (const campo of [
  '.cobro-v2 .cobro-form-campo--val',
  '.cobro-v2 .cobro-form--tarjeta .cobro-form-campo',
  '.cobro-v2 .cobro-form--tarjeta .cobro-form-campo--accion',
]) {
  assert.equal(
    declaracion(campo, 'padding-bottom'),
    'var(--c-form-reserva)',
    `${campo} tiene que reservar el alto compartido para su mensaje de error`,
  )
}

console.log(
  `OK · los cuatro medios de cobro separan sus renglones igual (${reserva} + ${filaGap} = 24px)`,
)
