/**
 * No se envía un comprobante a un contacto que no puede recibirlo por el medio elegido.
 *
 * El caso que resuelve: se arma la lista de contactos, se elige "Email" y uno de los elegidos no
 * tiene email cargado. Antes el envío salía igual y ese contacto quedaba afuera EN SILENCIO —el
 * tablero despachaba a los demás y nadie se enteraba de que faltó uno—. Ahora se frena, se dice
 * quién y por qué, y se puede reintentar apenas se corrija.
 *
 * La excepción es "Ambos", y es deliberada: ahí el envío se reparte por contacto —a quien tiene
 * email le llega por email, a quien tiene teléfono por WhatsApp—, así que un dato ausente no impide
 * que el documento salga. Frenar ahí obligaría a depurar la lista para conseguir algo que ya iba a
 * pasar solo.
 *
 * Se corre con esbuild + node (`npm run test:envio-sin-via`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contactosSinVia, msgContactoSinVia, sinViaDeEnvio } from '@/lib/validaciones'
import type { MedioEnvio } from '@/types'

const c = (name: string, phone: string, email: string) => ({ name, phone, email })
const COMPLETA = c('Ana Perez', '3411234567', 'ana@acme.com')
const SIN_EMAIL = c('Beto Gomez', '3417654321', '')
const SIN_TEL = c('Caro Diaz', '', 'caro@acme.com')
const SIN_NADA = c('Dario Ruiz', '', '')
const LISTA = [COMPLETA, SIN_EMAIL, SIN_TEL, SIN_NADA]

const nombres = (medio: MedioEnvio) => contactosSinVia(LISTA, medio).map((x) => x.name)

/* ---------- EMAIL: frenan los que no tienen email ---------- */
assert.deepEqual(nombres('Email'), ['Beto Gomez', 'Dario Ruiz'], 'sin email no pueden recibirlo')
/* Tener teléfono no salva a nadie: el medio elegido es el email. */
assert.ok(!nombres('Email').includes('Caro Diaz'), 'a quien SÍ tiene email no se lo frena')

/* ---------- WHATSAPP: frenan los que no tienen teléfono ---------- */
assert.deepEqual(nombres('WhatsApp'), ['Caro Diaz', 'Dario Ruiz'], 'sin teléfono no pueden recibirlo')
assert.ok(!nombres('WhatsApp').includes('Beto Gomez'), 'a quien SÍ tiene teléfono no se lo frena')

/* ---------- AMBOS: no valida NADA ----------
   Ni siquiera al contacto que no tiene ninguno de los dos datos. Es la instrucción explícita: con
   "Ambos" el reparto lo resuelve el propio envío, contacto por contacto. */
assert.deepEqual(contactosSinVia(LISTA, 'Ambos'), [], 'con "Ambos" no se frena a nadie')
assert.deepEqual(contactosSinVia([SIN_NADA], 'Ambos'), [], 'ni al que no tiene ningún dato')
assert.equal(msgContactoSinVia('Dario Ruiz', 'Ambos'), '', 'y no hay mensaje que mostrar')

/* Una lista sana no frena nada, en ningún medio. */
for (const medio of ['Email', 'WhatsApp', 'Ambos'] as MedioEnvio[]) {
  assert.deepEqual(contactosSinVia([COMPLETA], medio), [], `${medio}: un contacto completo pasa`)
}

/* ---------- El mensaje nombra las tres cosas ----------
   El medio elegido, el contacto y qué le falta: sin las tres hay que ir a buscar algo. */
const msgEmail = msgContactoSinVia('Beto Gomez', 'Email')
assert.match(msgEmail, /email como medio de env/i, 'dice qué medio se eligió')
assert.match(msgEmail, /Beto Gomez/, 'nombra al contacto')
assert.match(msgEmail, /NO tiene una dirección de email cargada/, 'y qué le falta')

const msgWa = msgContactoSinVia('Caro Diaz', 'WhatsApp')
assert.match(msgWa, /whatsapp como medio de env/i)
assert.match(msgWa, /NO tiene un número de teléfono cargado/, 'para WhatsApp el dato es el teléfono')

/* ---------- Que la vista lo use ANTES de tocar la API ----------
   La regla no sirve de nada si el envío igual sale: se verifica que el freno esté cableado y que
   corra antes del `comprobante.enviar(...)`. */
const vista = readFileSync('src/features/shared/EnviarDocumento.tsx', 'utf8')
assert.match(vista, /if \(frenarPorContactoSinVia\(\)\) return/, 'el envío se frena')
assert.ok(
  vista.indexOf('frenarPorContactoSinVia()) return') < vista.indexOf('await comprobante.enviar'),
  'y se frena ANTES de llamar a la API, no después',
)
/* Deja el botón en rojo, que es lo que habilita reintentar (no lo deshabilita). */
assert.match(vista, /marcarError\(\)\s+return true/, 'el botón queda en error para reintentar')

/* `sinViaDeEnvio` es la regla por contacto que también pinta su ficha en rojo: las dos miran lo
   mismo, así que lo que el mensaje frena es exactamente lo que la lista marca. */
assert.equal(sinViaDeEnvio(SIN_EMAIL, 'Email'), true)
assert.equal(sinViaDeEnvio(SIN_EMAIL, 'Ambos'), false, 'con "Ambos" sigue siendo alcanzable')

/* ---------- El mensaje TIENE que verse ----------
   Frenar sin explicar es peor que no frenar: el botón se ponía rojo diciendo "Error de Envío" y el
   motivo se escribía en `state.log`, que NO lo renderizaba nadie —`LogEnvio` existía pero ningún
   componente lo montaba—. Las cuatro rutas de error del envío eran mudas. */
assert.match(vista, /className="enviar-avisos"/, 'el detalle del error se monta junto al botón')
assert.match(vista, /enviar-aviso--\$\{e\.tipo\}|enviar-aviso--/, 'y se pinta según su tipo')
assert.ok(
  vista.indexOf('enviar-avisos') > vista.indexOf('btn-block--enviar'),
  'va DESPUÉS del botón: el estado lo dice el botón y el detalle lo acompaña',
)

/* El aviso es SÓLO para lo que salió mal. El éxito lo dice el botón, que pasa a verde con "Enviado
   exitosamente"; un cartel al lado repitiéndolo es ruido, y encima dejaría un texto de éxito donde
   se espera un motivo de error. En el camino feliz el log se LIMPIA, para que no quede el rojo de
   un intento anterior al lado de un botón verde. */
assert.ok(
  !/tipo: 'ok'|Documento enviado correctamente/.test(vista),
  'el envío exitoso no escribe ningún mensaje',
)
assert.match(
  vista,
  /setDocumentoEnviado[\s\S]{0,400}?|entries: null/,
  'y el camino feliz limpia el aviso del intento anterior',
)

const estilos = readFileSync('src/styles/components.css', 'utf8')
assert.match(estilos, /\.enviar-aviso--err\s*\{[^}]*var\(--red\)/, 'el aviso de error va en rojo')

/* Y se limpia cuando el usuario hace algo que puede haberlo resuelto: quitar al contacto en falta o
   cambiar el medio. Si no, el rojo y el motivo viejo quedan a la vista y no se sabe si son de ahora. */
assert.match(vista, /const limpiarIntento = \(\)/, 'existe el reseteo del intento')
assert.ok(
  (vista.match(/limpiarIntento\(\)/g) ?? []).length >= 2,
  'se llama en los dos lugares: al quitar un contacto y al cambiar el medio',
)

console.log('OK · no se envía a un contacto sin la vía del medio elegido (salvo con "Ambos")')
