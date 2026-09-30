/**
 * Lectura del comprobante por el escenario de Make: la NORMALIZACIÓN de lo que devuelve.
 *
 * Es la pieza con más superficie de error de todo el circuito y la única enteramente pura, así que
 * es donde un test rinde: el escenario se arma del OTRO lado —en Make—, nombra los campos como le
 * queda cómodo y puede devolverlos sueltos o envueltos. Que renombrar un campo allá no rompa la app
 * es justamente el contrato que se fija acá.
 *
 * Se corre con esbuild + node (`npm run test:comprobante-make`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { archivoNoSoportado, procesarComprobante } from '@/services/make'

/** Responde como el escenario, con el JSON que se le pase. */
const responder = (cuerpo: unknown, ok = true, status = 200) => {
  globalThis.fetch = (async () => ({
    ok,
    status,
    text: async () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
  })) as unknown as typeof fetch
}

const archivo = new File([new Uint8Array([1, 2, 3])], 'cheque.pdf', { type: 'application/pdf' })

/* ---------- Alias: el escenario nombra los campos como quiere ---------- */
responder({
  // Envuelto en `datos`, con tildes, mayúsculas, separadores y conectores de por medio.
  datos: {
    'Número de Cheque': '00123456',
    'Fecha de Emisión': '2026-08-01',
    fecha_vencimiento: '12/08/2026',
    Banco: 'GALICIA',
    CUIT: '20450371956',
    importe: '$ 1.234,56',
  },
})
const cheque = await procesarComprobante(archivo, 'Cheque')
assert.equal(cheque.datos.numeroCheque, '00123456', 'el número, tal cual')
assert.equal(cheque.datos.fechaEmisionCheque, '01/08/2026', 'ISO → dd/MM/yyyy')
/* La única fecha que se lee del cheque es la de PAGO. El escenario la sigue nombrando
   "vencimiento" —en el papel es esa casilla— y ese alias tiene que seguir cayendo acá: el
   vencimiento de verdad ya no se lee, se calcula. */
assert.equal(cheque.datos.chequeFechaPago, '12/08/2026', 'y el formato del papel se respeta')
assert.equal(cheque.datos.bancoEmisor, 'GALICIA')
/* El CUIT vuelve en los TRES tramos que espera el formulario, aunque haya venido de corrido. */
assert.equal(cheque.datos.cuitEmisor, '20-45037195-6', 'el CUIT se arma con guiones')
/* "$ 1.234,56" es mil doscientos treinta y cuatro con 56, no 1,23456. */
assert.equal(cheque.datos.importe, 1234.56, 'el importe con formato AR')
/* 7 y no 6: "Fecha de Emisión" alimenta TAMBIÉN la emisión de la retención, que comparte alias con
   la del cheque. No se mezclan en pantalla: el formulario se queda sólo con los del medio elegido. */
assert.equal(cheque.datos.fechaEmisionRetencion, '01/08/2026', 'la emisión comparte alias')
assert.ok(cheque.respondioJson && cheque.campos === 7, 'y se cuentan los campos que entraron')

/* ---------- Retención: la respuesta REAL del escenario (contrato RETENCION_V1) ----------
   Trae la fecha de emisión del certificado, que va a "Fecha Emisión" del subelemento. */
responder({
  contrato: 'RETENCION_V1',
  resultado: 'PROCESADO',
  tiene_incidencias: false,
  documento_valido: true,
  datos_completos: true,
  datos: {
    tipo_retencion: 'IVA',
    cuit_emisor: '30-50431221-2',
    cuit_sujeto_retenido: '30-70906788-1',
    numero_comprobante: 'RIV-00006373',
    fecha_emision: '2026-03-23',
    anio_emision: 2026,
    importe_retencion: 57002.4,
  },
  incidencias: [],
})
const ret = await procesarComprobante(archivo, 'Retencion IVA')
assert.equal(ret.datos.fechaEmisionRetencion, '23/03/2026', 'la fecha de emisión del certificado')
assert.equal(ret.datos.anioRetencion, '2026', 'el año')
assert.equal(ret.datos.importe, 57002.4, 'el importe retenido')

/* ---------- Un campo vacío NO es un dato ----------
   Volcar un "" borraría lo que el usuario ya hubiera cargado a mano. */
responder({ numeroCheque: '', bancoEmisor: '   ', importe: 500 })
const parcial = await procesarComprobante(archivo, 'Cheque')
assert.deepEqual(Object.keys(parcial.datos), ['importe'], 'sólo entra lo que trae algo adentro')

/* ---------- El escenario RECHAZA el documento ----------
   Leyó bien y lo que leyó no sirve. Vuelve como RESULTADO y NO como excepción: una excepción lo
   mete en el mismo cajón que el servidor caído, y en pantalla terminaba de rojo y con la palabra
   "error fatal" encima de algo que se arregla cambiando el archivo. La diferencia no la ve ningún
   typecheck —`rechazo` es opcional—, así que se fija acá. */
responder({ tipoValido: false, tipoDetectado: 'Factura A' })
const otroTipo = await procesarComprobante(archivo, 'Cheque')
assert.deepEqual(
  otroTipo.rechazo,
  { motivo: 'tipo', tipoDetectado: 'Factura A' },
  'el documento equivocado se informa, con el tipo que SÍ se reconoció',
)
assert.deepEqual(otroTipo.datos, {}, 'y no se vuelca nada sobre el formulario')

/* El comprobante es del tipo correcto pero no lo emitió el cliente de la operación. Es el rechazo
   MÁS específico: cuando el escenario manda las dos banderas, gana éste. */
responder({ clienteValido: false, tipoValido: false, tipoDetectado: 'Cheque' })
assert.deepEqual(
  (await procesarComprobante(archivo, 'Cheque')).rechazo,
  { motivo: 'cliente' },
  '"no es de este cliente" explica más que "no sirve"',
)

/* La AUSENCIA de la bandera no es un "no": un escenario que todavía no valida el cliente no puede
   empezar a rechazar todos los comprobantes de golpe. */
responder({ numeroCheque: '00123456' })
assert.equal(
  (await procesarComprobante(archivo, 'Cheque')).rechazo,
  undefined,
  'sin bandera no hay rechazo',
)

/* ---------- Error declarado por el escenario, con un 200 igual ---------- */
responder({ ok: false, error: 'No se pudo leer el documento adjunto.' })
await assert.rejects(
  procesarComprobante(archivo, 'Transferencia'),
  /No se pudo leer el documento adjunto\./,
  'se muestra SU mensaje, nunca el JSON crudo',
)

/* ---------- Sin módulo de respuesta en Make ----------
   Make acusa recibo con "Accepted" y corta: no hubo lectura. No se inventa un éxito. */
responder('Accepted')
const acuse = await procesarComprobante(archivo, 'Cheque')
assert.equal(acuse.respondioJson, false, 'se distingue del JSON vacío')
assert.equal(acuse.campos, 0, 'y no se completó ningún campo')

/* ---------- Lo que ni se manda ----------
   Validar acá evita hacerle esperar al usuario un viaje de ida y vuelta por algo que se sabe ya. */
assert.equal(archivoNoSoportado(archivo), null, 'un PDF se acepta')
assert.match(
  archivoNoSoportado(new File(['x'], 'nota.docx', { type: 'application/msword' })) ?? '',
  /PDF o una imagen/,
  'un .docx no',
)
assert.match(
  archivoNoSoportado(new File([new Uint8Array(5 * 1024 * 1024)], 'grande.pdf', { type: 'application/pdf' })) ?? '',
  /supera los 4 MB/,
  'ni uno que se pasa del tope del proxy',
)
assert.match(
  archivoNoSoportado(new File([], 'vacio.pdf', { type: 'application/pdf' })) ?? '',
  /vacío/,
  'ni uno vacío',
)

console.log('OK · la lectura del comprobante normaliza lo que devuelve el escenario de Make')
