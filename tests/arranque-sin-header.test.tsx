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
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '@/App'
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

console.log('arranque-sin-header: OK')
