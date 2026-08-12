/**
 * Cheque del PROPIO cliente cuando el CRM no se los recibe.
 *
 * La regla vive en `chequeDelClienteVedado` (ya cubierta en `cobro-validaciones`); acá se verifica
 * lo otro: que el formulario efectivamente la MUESTRE debajo del CUIT del emisor. Se renderiza con
 * `react-dom/server` —no hay runner de DOM—, así que se afirma sobre el markup: alcanza para ver
 * qué mensaje queda montado y con qué campos en rojo.
 *
 * Lo que NO se puede afirmar renderizando en el servidor son los clicks —ni "Validar" ni
 * "+ Agregar"—. Eso se cubre del lado de la regla: `validarCuitEmisor` decide el estado (cubierto
 * en `cobro-validaciones`) y `cuitSinValidar` entra en `faltantes`, con lo que `agregar()` corta
 * en `!completo` mientras el CUIT no esté validado.
 *
 * Se corre con esbuild + node (`npm run test:cheque-cuit`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BOTON_VALIDAR, FormularioCobro } from '@/features/cobro/FormularioCobro'
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
assert.ok(!html.includes('Validar'), 'el botón de validar el CUIT sólo vive dentro del cheque')

/* El mensaje es el pedido, palabra por palabra: es lo que ve el vendedor debajo del CUIT. */
assert.equal(
  MSG_CHEQUE_CLIENTE_NO,
  'No se reciben cheques del cliente seleccionado. Ingrese otro CUIT.',
)

/* Sin cliente el formulario igual se monta: el cobro no depende de haberlo cargado. */
assert.ok(render(null).includes('Seleccionar Medio de Cobro'), 'sin cliente el formulario se monta')

/* ---------- El botón "Validar": un aspecto por estado ----------
   El bloque del cheque sólo se monta al elegir ese medio —un cambio de estado que el render del
   servidor no puede disparar—, así que el contrato visual se afirma sobre la tabla que lo define.
   Lo que importa: los dos resultados se leen SIN texto, y el ícono es el que los distingue. */
assert.equal(BOTON_VALIDAR.pendiente.texto, 'Validar', 'sin validar, el botón dice qué hace')
assert.equal(BOTON_VALIDAR.pendiente.icono, null, 'y no muestra ningún ícono todavía')

assert.equal(BOTON_VALIDAR.validado.texto, null, 'validado: ningún tipo de texto, sólo el tilde')
assert.equal(BOTON_VALIDAR.validado.icono, 'fa-check', 'el tilde del CUIT validado')
assert.equal(BOTON_VALIDAR.validado.clase, 'cobro-btn--validar-ok', 'que es la que lo pinta verde')

assert.equal(BOTON_VALIDAR.rechazado.texto, null, 'rechazado: tampoco texto, sólo la cruz')
assert.equal(BOTON_VALIDAR.rechazado.icono, 'fa-xmark', 'la cruz del CUIT rechazado')
assert.equal(BOTON_VALIDAR.rechazado.clase, 'cobro-btn--validar-mal', 'sobre el fondo rojo')

/* Sin texto visible, el nombre accesible es lo único que le queda a un lector de pantalla: los tres
   estados tienen que tenerlo, y distinto entre sí. */
const rotulos = Object.values(BOTON_VALIDAR).map((a) => a.rotulo)
assert.ok(
  rotulos.every((r) => r.trim().length > 0),
  'los tres estados tienen nombre accesible',
)
assert.equal(new Set(rotulos).size, 3, 'y cada uno dice algo distinto del anterior')

/* ---------- Qué pasa con el CUIT según el resultado ----------
   El efecto vive en el handler de "Validar" (`validarCuit`), que no se puede clickear con un render
   de servidor; lo que sí se puede fijar acá es la regla que lo decide, que es la misma que dispara
   el borrado y el bloqueo. Se BORRA el rechazado —el cheque no se va a poder cargar con ese
   emisor— y se BLOQUEA únicamente el validado. */
const casos = [
  { que: 'el cliente SÍ recibe cheques', cuit: CUIT, cli: cliente(CUIT, true) },
  { que: 'el CUIT es de un tercero', cuit: '30-71234567-4', cli: cliente(CUIT, false) },
] as const
for (const c of casos) {
  assert.equal(
    validarCuitEmisor(c.cli, c.cuit),
    'validado',
    `${c.que}: el CUIT queda validado, y por eso el input se bloquea`,
  )
}
assert.equal(
  validarCuitEmisor(cliente(CUIT, false), CUIT),
  'rechazado',
  'el cheque propio de un cliente al que no le recibimos cheques se rechaza, y su CUIT se borra',
)

console.log('OK · cheque siempre ofrecido, veda por CUIT y los tres estados del botón Validar')
