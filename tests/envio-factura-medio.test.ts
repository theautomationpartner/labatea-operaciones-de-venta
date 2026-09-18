/**
 * Envío en VENTA y VENTA PROFORMA: el Email va siempre y WhatsApp se suma con un check. No hay
 * selector ni opción "Ambos".
 *
 * Tildar WhatsApp es, en el tablero, exactamente "Ambos": las dos etiquetas en la columna de medio
 * de envío del documento. Por eso se reusa ese valor en vez de inventar un medio nuevo, y la regla
 * de contactos sigue siendo la que ya estaba: con Email solo se exige el email de cada contacto; con
 * WhatsApp sumado, el envío se reparte por contacto y no se frena a nadie.
 *
 * Manda la OPERACIÓN, no el documento. Dentro de una VENTA se despachan la factura y —cuando el
 * cliente es agente de retención— también la proforma: las dos preguntan lo mismo. PRESUPUESTAR y
 * REMITO conservan su selector de tres medios.
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
   un check. Lo que puede romperse en silencio es que la venta vuelva a mostrar el selector, que el
   envío deje de usar el medio normalizado, o que la rama se vuelva a atar al documento —y entonces
   la proforma de una VENTA quedaría preguntando distinto que su factura—. */
const vista = readFileSync('src/features/shared/EnviarDocumento.tsx', 'utf8')

assert.ok(
  vista.includes("const esVentaOProforma = operacion === 'VENTA' || operacion === 'VENTA PROFORMA'"),
  'la rama la decide la OPERACIÓN, no el documento',
)
assert.ok(
  !vista.includes("documento === 'factura'"),
  'y ya no se decide por `documento === factura`: dejaba afuera a la proforma de la VENTA',
)
assert.ok(vista.includes('{esVentaOProforma ? ('), 'esa es la condición que elige el bloque fijo')

/* El rótulo y el botón del Email, tal como se pidieron. */
assert.ok(
  vista.includes('Medio de Envío por defecto:'),
  'el rótulo dice "Medio de Envío por defecto:"',
)
assert.ok(
  /<div className="envio-medio-fila">[\s\S]{0,400}?envio-medio-lbl[\s\S]{0,200}?envio-medio-fijo/.test(
    vista,
  ),
  'el rótulo y el botón de Email van en la misma fila',
)
assert.ok(
  /<i className="fas fa-envelope" aria-hidden="true" \/> Email/.test(vista),
  'el botón muestra el sobre y la palabra Email',
)
assert.ok(
  vista.includes('¿Desea realizar también un envío por WhatsApp?'),
  'y debajo, el check que suma WhatsApp',
)
assert.ok(
  vista.includes("value: e.target.checked ? 'Ambos' : 'Email'"),
  'tildar suma WhatsApp; destildar vuelve a Email solo',
)
assert.ok(vista.includes('medio: medioEfectivo,'), 'el envío usa el medio normalizado, no el crudo')

/* El estado del medio es GLOBAL: un "WhatsApp" solo que viniera de otro comprobante no existe acá
   y se tiene que tratar como Email. */
assert.ok(
  /medioEfectivo: MedioEnvio = esVentaOProforma\s*\?\s*conWhatsapp\s*\?\s*'Ambos'\s*:\s*'Email'\s*:\s*medioEnvio/.test(
    vista,
  ),
  'en VENTA y VENTA PROFORMA nada que no sea "Ambos" puede salir como otra cosa que Email',
)

/* Y los otros comprobantes conservan el selector de siempre. */
assert.ok(
  vista.includes("const MEDIOS: readonly MedioEnvio[] = ['Email', 'WhatsApp', 'Ambos']"),
  'presupuesto y remito siguen con su selector',
)

/* La fila tiene que existir en la hoja de estilos, o el rótulo y el botón se apilan. */
const estilos = readFileSync('src/styles/views.css', 'utf8')
assert.ok(/\.envio-medio-fila \{[^}]*display: flex/.test(estilos), '.envio-medio-fila es flex')
assert.ok(
  !/\.envio-medio-lbl \{[^}]*display: block/.test(estilos),
  'y el rótulo ya no es `block`: eso lo mandaba a su propio renglón',
)

console.log('OK · VENTA y VENTA PROFORMA envían por Email y suman WhatsApp con un check')
