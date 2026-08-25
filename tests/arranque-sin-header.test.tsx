/**
 * Lo PRIMERO que hace la app es verificar de dónde viene el pedido. El header no existe hasta
 * entonces.
 *
 * Esto se vio en producción: al abrir el enlace fuera de Monday alcanzaba a verse el header con los
 * selectores de operación y vendedor, y recién después aparecía el rechazo. El motivo era el orden:
 * la app se dibujaba entera y el "no autorizado" llegaba con la primera consulta fallida.
 *
 * La regla que se fija: en el PRIMER pintado —antes de que corra ningún efecto ni vuelva ninguna
 * consulta— no hay nada de la operación en pantalla.
 *
 * Se corre con esbuild + node (`npm run test:arranque`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '@/App'
import { Cargando } from '@/components/ui/Cargando'
import { MfaGuard } from '@/components/ui/MfaGuard'
import { InicioView } from '@/features/inicio/InicioView'
import { initialState } from '@/state/appState'
import { DispatchContext, StateContext } from '@/state/context'

const render = (elemento: ReactElement) =>
  renderToStaticMarkup(
    createElement(
      StateContext.Provider,
      { value: initialState },
      createElement(DispatchContext.Provider, { value: () => {} }, elemento),
    ),
  )

/* Primero se comprueba que los textos que se van a buscar sean los correctos: si el header cambiara
   de palabras, este test tiene que fallar acá y no dar un falso "no se ve nada". */
const header = render(createElement(InicioView))
const SENAS = ['Seleccionar tipo de operación', 'Seleccionar vendedor']
for (const sena of SENAS) {
  assert.ok(header.includes(sena), `la vista de inicio ya no dice "${sena}"; revisar este test`)
}

/* El primer pintado de la app. `renderToStaticMarkup` no corre efectos, así que esto es exactamente
   lo que ve el navegador en el primer cuadro, antes de cualquier consulta. */
const primerPintado = render(createElement(App))

for (const sena of SENAS) {
  assert.ok(
    !primerPintado.includes(sena),
    `el header se ve antes de verificar el acceso: apareció "${sena}"`,
  )
}
assert.ok(!primerPintado.includes('Confirmar'), 'tampoco el botón de confirmar')

/* El muro del segundo factor (paso 3) tampoco deja ver nada de la operación: mientras está, es lo
   ÚNICO en pantalla. Se verifica sobre el componente porque el paso 3 sólo se alcanza después de
   dos viajes al servidor, y eso no ocurre en un render estático. */
const muro = renderToStaticMarkup(createElement(MfaGuard, { onListo: () => {} }))
for (const sena of SENAS) {
  assert.ok(!muro.includes(sena), `el muro deja ver el header: apareció "${sena}"`)
}

/* En su primer pintado el muro está preparando la verificación, y eso se muestra como animación
   SOBRE la app: sin caja, sin sombra y sin fondo que oscurezca. Una ventana modal dice
   "interrumpí lo que estabas haciendo", y acá todavía no había nada que interrumpir. */
assert.ok(muro.includes('cargando-pantalla'), 'la espera usa el indicador estándar')
assert.ok(!muro.includes('mfa-panel'), 'la espera NO se dibuja dentro de una card')

const carga = renderToStaticMarkup(createElement(Cargando, { mensaje: 'Verificando acceso' }))
assert.ok(carga.includes('Verificando acceso'), 'el mensaje va debajo de la animación')
assert.ok(!carga.includes('modal-'), 'sin ventana: nada de clases de modal')

/* El hueco del mensaje de error mide lo mismo esté vacío o lleno, para que el panel no cambie de
   altura cuando el error aparece. La regla es de CSS, así que se verifica ahí: alguien podría
   "simplificar" el vacío a `display: none` y el salto volvería sin que nada más se entere. */
const css = readFileSync('src/styles/views.css', 'utf8')
const desde = css.indexOf('.mfa-error {')
const inicioVacio = css.indexOf('.mfa-error--vacio')
// Hasta el cierre de la regla del vacío y ni un carácter más: si no, se cuela CSS de al lado.
/* Sin comentarios: lo que se verifica son las REGLAS. El comentario del propio CSS menciona
   `display: none` para explicar por qué NO se usa, y eso hacía fallar al test por leer prosa. */
const sinComentarios = (texto: string): string =>
  texto
    .split('/*')
    .map((parte, i) => (i === 0 ? parte : parte.slice(parte.indexOf('*/') + 2)))
    .join('')

const hueco = sinComentarios(css.slice(desde, css.indexOf('}', inicioVacio) + 1))
assert.match(hueco, /min-height/, 'el hueco del error tiene que reservar su altura')
assert.match(hueco, /visibility: hidden/, 'vacío se OCULTA, no se quita del flujo')
assert.doesNotMatch(hueco, /display: none/, 'display:none devolvería el salto de altura')

console.log('arranque-sin-header: OK')
