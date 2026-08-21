/**
 * Cheque del PROPIO cliente cuando el CRM no se los recibe.
 *
 * La regla vive en `chequeDelClienteVedado` (ya cubierta en `cobro-validaciones`); acá se verifica
 * lo otro: que el formulario efectivamente la MUESTRE debajo del CUIT del emisor. Se renderiza con
 * `react-dom/server` —no hay runner de DOM—, así que se afirma sobre el markup: alcanza para ver
 * qué mensaje queda montado y con qué campos en rojo.
 *
 * Lo que NO se puede afirmar renderizando en el servidor es el click en "+ Agregar". Eso se cubre
 * del lado de la regla: `validarCuitEmisor` decide el veredicto (cubierto en `cobro-validaciones`)
 * y el rechazo entra en `faltantes`, con lo que `agregar()` corta en `!completo`.
 *
 * Se corre con esbuild + node (`npm run test:cheque-cuit`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormularioCobro, ROTULO_CUIT } from '@/features/cobro/FormularioCobro'
import { MSG_CHEQUE_CLIENTE_NO, validarCuitEmisor } from '@/lib/cobros'
import { AppProvider } from '@/state/AppProvider'
import type { Cliente } from '@/types'

const CUIT = '20-45037195-6'

const cliente = (cuit: string, aceptaCheques: boolean) =>
  ({ id: '1', name: 'CLIENTE DE PRUEBA', cuit, aceptaCheques }) as Cliente

const render = (c: Cliente | null) =>
  renderToStaticMarkup(
    createElement(AppProvider, null, createElement(FormularioCobro, { cliente: c })),
  )

/* El formulario arranca en "Efectivo": el bloque del cheque —y con él el CUIT— sólo se monta al
   elegir ese medio, que es un cambio de estado imposible de disparar en el render del servidor.
   Así que lo que se verifica acá es lo que SÍ es estático: que el cheque se OFREZCA siempre. */
const html = render(cliente(CUIT, false))
assert.ok(
  html.includes('<option value="Cheque">Cheque</option>'),
  'el cheque se ofrece habilitado aunque el CRM del cliente diga NO: la veda es por CUIT de emisor',
)
assert.ok(!html.includes('disabled'), 'ya no queda ningún medio de cobro deshabilitado en el selector')
assert.ok(
  !html.includes('cobro-op--vedada'),
  'y tampoco el tachado rojo del bloqueo anterior, que era del medio entero',
)

/* "Validar" es parte del bloque del cheque, no de la fila principal: con "Efectivo" no se monta.
   Es la contracara de lo anterior: el medio se ofrece siempre, pero la validación aparece recién
   cuando hay un CUIT de emisor que validar. */
assert.ok(!html.includes('Validar'), 'no hay botón de validar: el CUIT se contrasta solo')

/* El mensaje es el pedido, palabra por palabra: es lo que ve el vendedor debajo del CUIT. */
assert.equal(
  MSG_CHEQUE_CLIENTE_NO,
  'No se reciben cheques del cliente seleccionado. Ingrese otro CUIT.',
)

/* Sin cliente el formulario igual se monta: el cobro no depende de haberlo cargado. */
assert.ok(render(null).includes('Seleccionar Medio de Cobro'), 'sin cliente el formulario se monta')

/* ---------- El veredicto del CUIT se anuncia ----------
   La validación corre SOLA apenas están los once dígitos —ya no hay botón "Validar"—, y el
   resultado se lee sólo por el ícono y el color. Ahí el nombre accesible es lo único que le queda a
   un lector de pantalla, así que los dos veredictos tienen que tenerlo y decir cosas distintas. */
assert.equal(ROTULO_CUIT.pendiente, '', 'sin veredicto todavía no se anuncia nada')
assert.ok(ROTULO_CUIT.ok.trim().length > 0, 'el CUIT aceptado se anuncia')
assert.ok(/rechaz/i.test(ROTULO_CUIT.error), 'y el rechazado dice que no sirve')
assert.notEqual(ROTULO_CUIT.ok, ROTULO_CUIT.error, 'y no dicen lo mismo')

/* ---------- Qué pasa con el CUIT según el resultado ----------
   El efecto vive en el handler de "Validar" (`validarCuit`), que no se puede clickear con un render
   de servidor; lo que sí se puede fijar acá es la regla que lo decide, que es la misma que dispara
   el veredicto. El rechazado NO se borra: queda a la vista, en rojo, para ver cuál fue el que no
   sirve mientras se escribe otro. */
const casos = [
  { que: 'el cliente SÍ recibe cheques', cuit: CUIT, cli: cliente(CUIT, true) },
  { que: 'el CUIT es de un tercero', cuit: '30-71234567-4', cli: cliente(CUIT, false) },
] as const
for (const c of casos) {
  assert.equal(
    validarCuitEmisor(c.cli, c.cuit),
    'validado',
    `${c.que}: el CUIT queda validado y el cheque se puede cargar`,
  )
}
assert.equal(
  validarCuitEmisor(cliente(CUIT, false), CUIT),
  'rechazado',
  'el cheque propio de un cliente al que no le recibimos cheques se rechaza',
)

console.log('OK · cheque siempre ofrecido y veda por CUIT, validada sola contra el cliente')
