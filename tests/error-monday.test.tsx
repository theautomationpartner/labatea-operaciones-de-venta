/**
 * Los fallos de la API de Monday se comunican por UNA ventana emergente y sólo por ahí: ninguna
 * pantalla vuelve a pintar un cartel en línea con el motivo.
 *
 * Se verifica el ciclo completo —despachar el error, renderizar la ventana, cerrarla— y que la
 * ventana lleve el ícono de advertencia, el detalle de lo que falló y la salida a soporte de TAP.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModalErrorMonday } from '@/components/ui/ModalErrorMonday'
import { initialState, reducer, type AppState } from '@/state/appState'
import { DispatchContext, StateContext } from '@/state/context'

const render = (state: AppState) =>
  renderToStaticMarkup(
    createElement(
      StateContext.Provider,
      { value: state },
      createElement(DispatchContext.Provider, { value: () => {} }, createElement(ModalErrorMonday)),
    ),
  )

// ---------- Sin error no hay ventana ----------
assert.equal(initialState.errorMonday, null, 'la app no arranca con un error pendiente')
assert.equal(render(initialState), '', 'la ventana se monta sin haber ningún error')

// ---------- El error viaja por el reducer ----------
const conError = reducer(initialState, { type: 'errorMonday', accion: 'buscar el cliente' })
assert.equal(conError.errorMonday, 'buscar el cliente', 'el reducer no guardó la acción que falló')

const html = render(conError)
assert.ok(html.includes('No se pudo conectar con Monday'), 'falta el título de la ventana')
assert.ok(html.includes('buscar el cliente'), 'la ventana no dice QUÉ se estaba intentando hacer')
assert.ok(html.includes('fa-triangle-exclamation'), 'falta el ícono de advertencia')
assert.ok(/volv. a intentarlo/i.test(html), 'la ventana no invita a reintentar')
assert.ok(/soporte\s+de\s+TAP/i.test(html), 'la ventana no ofrece el soporte de TAP')

// ---------- Se cierra ----------
const cerrado = reducer(conError, { type: 'limpiarErrorMonday' })
assert.equal(cerrado.errorMonday, null, 'el error queda pendiente después de cerrar la ventana')
assert.equal(render(cerrado), '', 'la ventana sigue montada después de cerrarla')

console.log('OK · los errores de la API de Monday se avisan por una única ventana emergente')
