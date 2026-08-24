/**
 * Quien no pasó el borde no ve la app, y el aviso que recibe no le ofrece nada que no sirva.
 *
 * El caso concreto: alguien consigue el enlace de la app y lo abre fuera de Monday. Antes veía el
 * header con los selectores de operación y vendedor —o sea, la app— más una ventana que le sugería
 * "Recargar", que desde afuera de Monday da exactamente el mismo rechazo.
 *
 * Lo que se fija acá:
 *  · el aviso del 401 dice el código en el título y una sola línea de motivo;
 *  · su única acción es "Entendido": nada de invitar a insistir con algo que no depende de quien
 *    aprieta el botón;
 *  · cerrar el aviso NO desbloquea la app. El "Entendido" baja el cartel, no abre la puerta;
 *  · los rechazos que pueden ser pasajeros (5xx, límite de intentos) NO tapan la app: desmontar la
 *    vista en medio de una carga de venta tiraría el trabajo hecho.
 *
 * Se corre con esbuild + node (`npm run test:bloqueo`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModalErrorSeguridad } from '@/components/ui/ModalErrorSeguridad'
import {
  bloqueaLaApp,
  cerrarAvisoSeguridad,
  estadoSeguridadActual,
  notificarErrorSeguridad,
  reiniciarErrorSeguridad,
  type ClaseErrorSeguridad,
} from '@/lib/errorSeguridad'

const render = (clase: ClaseErrorSeguridad, status: number) =>
  renderToStaticMarkup(createElement(ModalErrorSeguridad, { error: { clase, status } }))

// ── El aviso de quien no pasó la Capa 1 ─────────────────────────────────────────────────────────
const html = render('fueraDeMonday', 401)

assert.ok(html.includes('ERROR 401 NO Autorizado'), 'el título tiene que declarar el código')
assert.ok(
  html.includes('Su dominio no está autorizado a utilizar la aplicación'),
  'falta el motivo, en una sola línea',
)
assert.ok(html.includes('Entendido'), 'falta la única acción')
assert.ok(!html.includes('Recargar'), 'recargar desde afuera de Monday da el mismo rechazo')
assert.ok(!html.includes('Código 401'), 'el código ya está en el título; repetirlo es ruido')

/* Lo que NO se dice también importa: nada de "tu sesión venció" ni de hablar con soporte. A alguien
   que no tendría que estar ahí no se le explica cómo entrar. */
assert.ok(!/venci/i.test(html), 'no corresponde hablar de sesiones vencidas')
assert.ok(!/soporte/i.test(html), 'no corresponde ofrecer soporte a quien no está autorizado')

// Los otros avisos sí conservan su detalle y su salida.
assert.ok(render('servidor', 500).includes('Código 500'), 'el 5xx sí lleva el código para reportar')
assert.ok(render('servidor', 500).includes('Recargar'), 'un 5xx puede ser pasajero: reintentar sirve')

// ── Qué rechazo tapa la app ─────────────────────────────────────────────────────────────────────
assert.equal(bloqueaLaApp('fueraDeMonday'), true, 'dominio no autorizado: no ve nada')
assert.equal(bloqueaLaApp('sinSesionDeMonday'), true, 'sin sesión no se puede trabajar')
assert.equal(bloqueaLaApp('sesion'), true, 'sesión que no valida: tampoco')
assert.equal(bloqueaLaApp('configuracion'), true, 'servidor sin configurar: no hay nada que hacer')
assert.equal(bloqueaLaApp('sinPermiso'), true, 'sin alta en la lista blanca: no ve nada')
assert.equal(bloqueaLaApp('segundoFactor'), true, 'sin segundo factor: no ve nada')
assert.equal(bloqueaLaApp('servidor'), false, 'un 5xx puede ser pasajero; no se tira la pantalla')
assert.equal(bloqueaLaApp('demasiadosIntentos'), false, 'el límite se pasa solo en 15 minutos')

// ── Cerrar el aviso no abre la puerta ───────────────────────────────────────────────────────────
reiniciarErrorSeguridad()
assert.equal(estadoSeguridadActual().error, null, 'arranca sin rechazos')

notificarErrorSeguridad('fueraDeMonday', 401)
assert.equal(estadoSeguridadActual().visible, true, 'el aviso aparece')
assert.equal(bloqueaLaApp(estadoSeguridadActual().error!.clase), true, 'y la app queda tapada')

cerrarAvisoSeguridad()
assert.equal(estadoSeguridadActual().visible, false, 'el "Entendido" baja el cartel')
assert.ok(estadoSeguridadActual().error, 'pero el rechazo sigue en pie')
assert.equal(
  bloqueaLaApp(estadoSeguridadActual().error!.clase),
  true,
  'y la app sigue tapada: de un rechazo del borde se sale recargando, no cerrando la ventana',
)

reiniciarErrorSeguridad()

// ── Cada rechazo dice lo que de verdad pasó ─────────────────────────────────────────────────────
/* El caso que lo motivó: un usuario DENTRO de Monday recibía "su dominio no está autorizado", que
   era falso —el dominio estaba bien— y no lo llevaba a ningún lado. */
const sesion = render('sesion', 401)
assert.ok(!sesion.includes('dominio'), 'adentro de Monday el dominio NO es el problema')
assert.ok(/soporte de TAP/.test(sesion), 'tiene que decir a quién avisarle')
assert.ok(sesion.includes('Recargar'), 'una sesión vencida sí se arregla recargando')

const sinPermiso = render('sinPermiso', 403)
assert.ok(sinPermiso.includes('ERROR 403'), 'el 403 se declara como 403, no como 401')
assert.ok(
  sinPermiso.includes('no tiene permisos para utilizar la aplicación'),
  'falta el motivo real: el usuario no está dado de alta',
)
assert.ok(/soporte de TAP/.test(sinPermiso), 'y a quién pedirle el alta')
assert.ok(!sinPermiso.includes('Recargar'), 'recargar no da de alta a nadie')

const config = render('configuracion', 401)
assert.ok(config.includes('del lado del servidor'), 'tiene que decir dónde está el problema')
assert.ok(
  !config.includes('no tiene permisos'),
  'una variable faltante no es lo mismo que un usuario sin alta: confundirlos manda a pedir un' +
    ' alta que no va a resolver nada',
)
assert.ok(/soporte de TAP/.test(config), 'lo único útil es a quién avisarle')

/* "Monday no entregó sesión" y "tu sesión no valida" son problemas distintos con dueños distintos:
   el primero es de la instalación de la app, el segundo puede ser del propio usuario. Confundirlos
   manda a la persona equivocada a resolverlo. */
const sinSesion = render('sinSesionDeMonday', 401)
assert.ok(sinSesion.includes('no entregó una sesión'), 'falta el motivo real')
/* La confusión que importa no es que aparezca la palabra "permisos" —el texto justamente aclara
   que no tienen nada que ver— sino que mande a pedir un alta que no resolvería nada. */
assert.ok(
  !/den de alta|no tiene permisos para utilizar/i.test(sinSesion),
  'no puede mandar a pedir un alta: el alta no arregla una sesión que nunca llegó',
)
assert.ok(!sinSesion.includes('dominio'), 'el dominio está bien: está adentro de Monday')

console.log('bloqueo-seguridad: OK')
