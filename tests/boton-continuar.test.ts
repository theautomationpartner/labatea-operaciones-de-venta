/**
 * El botón que AVANZA de etapa se dibuja igual en todas: mismo azul, mismo radio, mismo relleno.
 *
 * Es el gemelo del test de "Volver", y por el mismo motivo. El botón de referencia vivía en
 * `.cobro-btn--primary`, scopeado a `.cobro-v2`, así que la etapa de Registrar Actividad —que vive
 * en `.actividad-v2`— no lo podía usar y terminó con `.btn-primary`: otro azul (#0073ea contra
 * #0052cc) y la mitad del radio (4px contra 6px). Nada lo detectaba: no hay typecheck que compare
 * estilos, y la diferencia sólo se ve poniendo las dos etapas al lado.
 *
 * Se corre con esbuild + node (`npm run test:boton-continuar`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const CLASE = 'btn-continuar'
const global = readFileSync('src/styles/components.css', 'utf8')

/* ---------- 1) La clase existe y es GLOBAL ---------- */
const abre = global.indexOf(`.${CLASE} {`)
assert.ok(abre >= 0, `.${CLASE} tiene que estar definida en components.css`)
const cuerpo = global.slice(abre, global.indexOf('}', abre))
/* Sin scope de vista: un `.algo .btn-continuar {` significa que vive dentro de UNA vista, y la
   próxima etapa que se agregue vuelve a quedar afuera —que es exactamente cómo empezó esto—. */
assert.ok(
  !global.includes(` .${CLASE} {`),
  `.${CLASE} no puede quedar scopeada a una vista: no llegaría a todas las etapas`,
)

for (const [prop, valor] of [
  ['background', '#0052cc'],
  ['border-radius', '6px'],
  ['padding', '10px 20px'],
  ['font-size', '14px'],
  ['font-weight', '600'],
  ['gap', '8px'],
] as const) {
  assert.ok(
    cuerpo.includes(`${prop}: ${valor};`),
    `.${CLASE} tiene que llevar ${prop}: ${valor}`,
  )
}

/* ---------- 3) La etapa de actividad la usa ---------- */
const vista = readFileSync('src/features/actividad/VentaActividadView.tsx', 'utf8')
assert.ok(
  vista.includes(`className="${CLASE}"`),
  'el botón de Registrar Actividad se dibuja con la clase compartida',
)
assert.ok(
  !vista.includes('className="btn btn-primary"'),
  'y no puede volver a `.btn-primary`, que es otro azul y otro radio',
)

/* ---------- 4) Y nombra bien el documento que sigue ----------
   La etapa existe en VENTA, VENTA PROFORMA y PRESUPUESTAR, y cada una emite lo suyo: decir
   "la Factura" en el presupuesto sería mandar al usuario a una etapa que no existe. */
assert.ok(vista.includes("VENTA: 'Emitir y Enviar la Factura'"), 'la VENTA sigue a la factura')
assert.ok(
  vista.includes("'VENTA PROFORMA': 'Emitir y Enviar la Factura'"),
  'la VENTA PROFORMA también',
)
assert.ok(
  vista.includes("PRESUPUESTAR: 'Emitir y Enviar el Presupuesto'"),
  'y el presupuesto sigue al presupuesto, no a una factura',
)

console.log('OK · el botón de avanzar de etapa es el mismo en todas, y nombra lo que sigue')
