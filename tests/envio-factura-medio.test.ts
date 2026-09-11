/**
 * Envío de la FACTURA (VENTA y VENTA PROFORMA): el Email va siempre y WhatsApp se suma con un
 * check. No hay selector ni opción "Ambos".
 *
 * Tildar WhatsApp es, en el tablero, exactamente "Ambos": las dos etiquetas en "🤖Enviar Fact por:"
 * (dropdown_mm5gkf4f). Por eso se reusa ese valor en vez de inventar un medio nuevo, y la regla de
 * contactos sigue siendo la que ya estaba: con Email solo se exige el email de cada contacto; con
 * WhatsApp sumado, el envío se reparte por contacto y no se frena a nadie.
 *
 * Los OTROS comprobantes (presupuesto, remito, proforma) comparten el componente y conservan su
 * selector: el cambio es sólo para la factura.
 *
 * Se corre con esbuild + node (`npm run test:envio-factura`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MEDIO_ENVIO_LABELS } from '@/services/monday/columns'
import { contactosSinVia } from '@/lib/validaciones'

/* ---------- 1) Lo que llega al tablero ----------
   Las etiquetas tienen que ser EXACTAMENTE las del board ("Whatsapp", "Email"): con
   `labels` una grafía distinta no engancha la etiqueta existente. */
assert.deepEqual(MEDIO_ENVIO_LABELS.Email, ['Email'], 'sin tildar: sólo Email')
assert.ok(MEDIO_ENVIO_LABELS.Ambos.includes('Email'), 'tildado: el Email sigue estando')
assert.ok(MEDIO_ENVIO_LABELS.Ambos.includes('Whatsapp'), 'y se agrega la etiqueta Whatsapp')

/* ---------- 2) Qué se le exige a cada contacto ---------- */
const conMail = { name: 'Ana', phone: '', email: 'ana@x.com' }
const soloTel = { name: 'Beto', phone: '3415551234', email: '' }
assert.deepEqual(
  contactosSinVia([conMail, soloTel], 'Email').map((c) => c.name),
  ['Beto'],
  'con Email solo, el contacto sin email no puede recibirla',
)
assert.deepEqual(
  contactosSinVia([conMail, soloTel], 'Ambos'),
  [],
  'con WhatsApp sumado, a quien le falta el email se le manda por WhatsApp',
)

/* ---------- 3) La pantalla ----------
   Se afirma sobre el código fuente: el cambio es de UI y el render del servidor no puede tildar
   un check. Lo que puede romperse en silencio es que la factura vuelva a mostrar el selector, o
   que el envío deje de usar el medio normalizado. */
const vista = readFileSync('src/features/shared/EnviarDocumento.tsx', 'utf8')
assert.ok(vista.includes("const esFactura = documento === 'factura'"), 'la rama es sólo de la factura')
assert.ok(
  vista.includes('¿Desea realizar también un envío por WhatsApp?'),
  'la factura pregunta por WhatsApp con un check',
)
assert.ok(
  vista.includes("value: e.target.checked ? 'Ambos' : 'Email'"),
  'tildar suma WhatsApp; destildar vuelve a Email solo',
)
assert.ok(vista.includes('medio: medioEfectivo,'), 'el envío usa el medio normalizado, no el crudo')
/* El estado del medio es GLOBAL: un "WhatsApp" solo que viniera de otro comprobante no existe en
   la factura y se tiene que tratar como Email. */
assert.ok(
  vista.includes("esFactura ? (conWhatsapp ? 'Ambos' : 'Email') : medioEnvio"),
  'en la factura nada que no sea "Ambos" puede salir como otra cosa que Email',
)
/* Y los otros comprobantes conservan el selector de siempre. */
assert.ok(
  vista.includes("const MEDIOS: readonly MedioEnvio[] = ['Email', 'WhatsApp', 'Ambos']"),
  'presupuesto, remito y proforma siguen con su selector',
)

console.log('OK · la factura se envía por Email y suma WhatsApp con un check, sin "Ambos"')
