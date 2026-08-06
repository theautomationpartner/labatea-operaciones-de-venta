/**
 * Datos de contacto exigidos por el medio de envío.
 *
 * La regla que importa: con "Ambos" alcanza con UNO de los dos datos. Que a un contacto le falte
 * el email o el WhatsApp no lo deja fuera ni frena el envío; se despacha por el canal que tenga.
 * Sólo queda sin vía de envío el que no tiene NINGUNO de los dos.
 *
 * Se corre con esbuild + node (`npm run test:envio-contactos`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { faltaParaMedio, sinViaDeEnvio } from '@/lib/validaciones'

const contacto = (phone: string, email: string) => ({ phone, email })
const completo = contacto('1155667788', 'a@b.com')
const soloTel = contacto('1155667788', '')
const soloMail = contacto('', 'a@b.com')
const vacio = contacto('', '   ')

// ---------- Qué dato falta (informativo: alimenta los rótulos de la ficha) ----------
assert.deepEqual(faltaParaMedio(completo, 'Ambos'), { telefono: false, email: false })
assert.deepEqual(faltaParaMedio(soloTel, 'Ambos'), { telefono: false, email: true })
assert.deepEqual(faltaParaMedio(soloMail, 'Ambos'), { telefono: true, email: false })
// Cada medio simple sólo mira SU dato: al de Email no le importa el teléfono.
assert.deepEqual(faltaParaMedio(soloMail, 'Email'), { telefono: false, email: false })
assert.deepEqual(faltaParaMedio(soloTel, 'WhatsApp'), { telefono: false, email: false })
// Un dato en blanco cuenta como ausente.
assert.equal(faltaParaMedio(vacio, 'Email').email, true, 'un email con espacios no es un email')

// ---------- AMBOS: falta uno → se envía igual (la regla nueva) ----------
assert.ok(!sinViaDeEnvio(completo, 'Ambos'), 'con los dos datos, obviamente se envía')
assert.ok(!sinViaDeEnvio(soloTel, 'Ambos'), 'sin email pero con teléfono: se envía por WhatsApp')
assert.ok(!sinViaDeEnvio(soloMail, 'Ambos'), 'sin teléfono pero con email: se envía por Email')
// Sin ninguno de los dos no hay a dónde mandarlo.
assert.ok(sinViaDeEnvio(vacio, 'Ambos'), 'sin ningún dato no hay vía de envío')

// ---------- Medios simples: sigue exigiéndose SU dato ----------
assert.ok(sinViaDeEnvio(soloTel, 'Email'), 'Email sin correo no llega')
assert.ok(!sinViaDeEnvio(soloMail, 'Email'), 'Email con correo llega')
assert.ok(sinViaDeEnvio(soloMail, 'WhatsApp'), 'WhatsApp sin teléfono no llega')
assert.ok(!sinViaDeEnvio(soloTel, 'WhatsApp'), 'WhatsApp con teléfono llega')

/* Cierre de la regla: en "Ambos", un contacto al que le falta UN dato ya no se considera
   incompleto, que era lo que lo marcaba como problemático. */
for (const c of [soloTel, soloMail]) {
  const falta = faltaParaMedio(c, 'Ambos')
  assert.ok(falta.telefono || falta.email, 'le falta un dato (se rotula en la ficha)')
  assert.ok(!sinViaDeEnvio(c, 'Ambos'), 'pero NO se lo trata como incompleto')
}

console.log('OK · con "Ambos", que falte un dato de contacto no frena el envío')
