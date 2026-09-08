/**
 * Un mismo movimiento no entra dos veces al cobro. Son DOS controles distintos y ninguno cubre al
 * otro:
 *
 *   · el LOCAL, contra lo que ya está en la tabla de la pantalla —que todavía no se guardó, así que
 *     ninguna consulta lo ve—;
 *   · el de MONDAY, contra el padrón de cheques ya recibidos —el duplicado de verdad no es cargar
 *     dos veces acá, es volver a presentar el mes que viene un cheque que ya entró—.
 *
 * Del segundo se fija la QUERY y no el resultado: la regla del cliente compara el id del ítem
 * linkeado y ese id tiene que viajar como NÚMERO. Entre comillas la regla no matchea nada y la
 * consulta vuelve vacía — o sea, "no hay duplicado" para todos los casos, que es la forma más
 * silenciosa posible de romper este control: no falla, no avisa, y deja pasar todo.
 *
 * Se corre con esbuild + node (`npm run test:cobro-duplicados`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { identidadMovimiento, movimientoRepetido } from '@/lib/cobros'
import { chequeDuplicado } from '@/services/monday/chequesCartera'
import { COL, BOARDS } from '@/services/monday/columns'
import type { MovimientoPago } from '@/types'

const mov = (m: Partial<MovimientoPago>): MovimientoPago =>
  ({ id: '1', importe: 100, chequeFechaPago: '', formaPago: 'Efectivo', ...m }) as MovimientoPago

/* ---------- 1) Qué hace único a cada movimiento ---------- */
const cheque = (nro: string, cuit: string) =>
  mov({ formaPago: 'Cheque', numeroCheque: nro, cuitEmisor: cuit })

/* El cheque son DOS datos juntos. El número solo no alcanza: cada banco numera su chequera por su
   cuenta, y dos emisores distintos repiten números todo el tiempo. */
assert.notEqual(
  identidadMovimiento(cheque('123', '20-45037195-6'))?.clave,
  identidadMovimiento(cheque('123', '30-71803864-9'))?.clave,
  'mismo número, otro emisor: son dos cheques distintos',
)
assert.equal(
  identidadMovimiento(cheque('00123', '20-45037195-6'))?.clave,
  identidadMovimiento(cheque('123', '20-45037195-6'))?.clave,
  'el mismo número con ceros adelante es EL MISMO cheque',
)
assert.equal(
  identidadMovimiento(cheque('123', '20450371956'))?.clave,
  identidadMovimiento(cheque('123', '20-45037195-6'))?.clave,
  'y el CUIT da igual con guiones o sin ellos',
)

/* Sin identificador NO hay identidad: no se inventa una clave vacía que volvería "duplicados" a
   todos los movimientos a medio cargar. */
assert.equal(identidadMovimiento(cheque('', '20-45037195-6')), null, 'sin número no hay identidad')
assert.equal(identidadMovimiento(cheque('123', '')), null, 'sin CUIT tampoco')
assert.equal(identidadMovimiento(mov({ formaPago: 'Efectivo' })), null, 'el efectivo no tiene número')
assert.equal(identidadMovimiento(mov({ formaPago: 'Anticipo' })), null, 'el anticipo tampoco')

/* Cada medio se identifica por SU papel, y el campo que lo lleva es el que se marca en rojo. */
const porMedio = [
  { m: mov({ formaPago: 'Transferencia', nroComprobanteTransferencia: 'OP-99' }), campo: 'nroCompTransf' },
  { m: mov({ formaPago: 'Tarjeta de débito', numeroCupon: '4501' }), campo: 'numeroCupon' },
  { m: mov({ formaPago: 'Tarjeta de crédito', numeroCupon: '4501' }), campo: 'numeroCupon' },
  { m: mov({ formaPago: 'Retencion IVA', nroComprobanteRetencion: '77' }), campo: 'nroCompRet' },
  { m: cheque('123', '20-45037195-6'), campo: 'numeroCheque' },
] as const
for (const { m, campo } of porMedio) {
  assert.equal(identidadMovimiento(m)?.campo, campo, `${m.formaPago} se identifica por ${campo}`)
}

/* La clave arranca con el MEDIO: el certificado 77 de una retención de IVA y el 77 de una de IIBB
   son dos papeles distintos, y confundirlos frenaría una carga legítima. */
assert.notEqual(
  identidadMovimiento(mov({ formaPago: 'Retencion IVA', nroComprobanteRetencion: '77' }))?.clave,
  identidadMovimiento(mov({ formaPago: 'Retencion IIBB', nroComprobanteRetencion: '77' }))?.clave,
  'el mismo número en dos retenciones distintas son dos certificados',
)

/* ---------- 2) Repetido contra la tabla ---------- */
const tabla = [cheque('123', '20-45037195-6'), mov({ formaPago: 'Efectivo' })]
assert.ok(movimientoRepetido(tabla, cheque('123', '20-45037195-6')), 'el mismo cheque no entra dos veces')
assert.ok(movimientoRepetido(tabla, cheque('0123', '20450371956')), 'ni escrito de otra forma')
assert.ok(!movimientoRepetido(tabla, cheque('124', '20-45037195-6')), 'otro número sí entra')
/* Dos pagos en efectivo por el mismo importe son dos pagos: sin identificador no hay duplicado. */
assert.ok(!movimientoRepetido(tabla, mov({ formaPago: 'Efectivo' })), 'el efectivo se repite a propósito')

/* ---------- 3) La consulta contra el padrón de Monday ---------- */
let query = ''
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  query = (JSON.parse(init.body) as { query: string }).query
  return { ok: true, json: async () => ({ data: { boards: [{ items_page: { items: [] } }] } }) }
}) as unknown as typeof fetch

await chequeDuplicado('12524661079', '30-71803864-9', '015935562')

assert.ok(query.includes(String(BOARDS.chequesCartera)), 'consulta el padrón de cheques en cartera')
/* El id SIN comillas. Es la línea entera del control: entre comillas la regla no matchea nada. */
assert.ok(
  query.includes(`{column_id: "${COL.chequeCartera.cliente}", compare_value: [12524661079], operator: any_of}`),
  'el id del cliente viaja como NÚMERO: entrecomillado, la consulta vuelve siempre vacía',
)
/* El número se pregunta en todas sus formas: el filtro del servidor es exacto, así que buscando
   "015935562" no encontraría al "15935562" que sí está cargado. */
for (const forma of ['015935562', '15935562']) {
  assert.ok(query.includes(`"${forma}"`), `el número también se busca como ${forma}`)
}

/* Sin los tres datos no se consulta: la respuesta honesta es "no se comprobó nada", y el alta la
   frenan igual las validaciones del formulario. */
query = ''
assert.equal(await chequeDuplicado(undefined, '30-71803864-9', '123'), null, 'sin cliente no consulta')
assert.equal(await chequeDuplicado('1', '', '123'), null, 'sin CUIT tampoco')
assert.equal(await chequeDuplicado('1', '30-71803864-9', ''), null, 'ni sin número')
assert.equal(query, '', 'y ninguna de las tres gastó una consulta')

/* ---------- El formulario AVISA que está consultando ----------
   La consulta al padrón tarda, y durante ese rato el "+ Agregar" no puede seguir diciendo lo
   mismo: invita a clickearlo de nuevo y a cargar el cheque dos veces.
 
   Se afirma sobre el código del formulario y no renderizando, porque el estado intermedio no se
   puede provocar desde afuera: sin acceso a Monday `chequeDuplicado` corta antes de consultar
   —está seis líneas más arriba—, y con acceso habría que pegarle al tablero de verdad. Lo que
   sí se puede fijar es que las tres piezas existan y estén atadas entre sí. */
const form = readFileSync('src/features/cobro/FormularioCobro.tsx', 'utf8')
assert.ok(form.includes('setValidando(true)'), 'el botón entra en "validando" antes de consultar')
/* Sale en un `finally`: si la consulta falla, el botón tiene que volver a su estado normal
   igual. Se busca la cercanía entre las dos piezas en vez de un texto exacto de varias líneas,
   que se rompe con cualquier reindentado. */
const cierre = form.indexOf('finally {')
assert.ok(cierre > 0, 'la consulta se cierra en un `finally`')
assert.ok(
  form.slice(cierre, cierre + 80).includes('setValidando(false)'),
  'y ahí adentro es donde el botón vuelve',
)
assert.ok(form.includes('Validando'), 'y mientras tanto lo dice')
assert.ok(form.includes('disabled={validando}'), 'y no se puede volver a apretar')
assert.ok(form.includes('cobro-btn-spin'), 'con la animación de espera')
/* La clase del spinner tiene que EXISTIR en la hoja: sin la regla, el botón dice "Validando" al
   lado de un span vacío. */
assert.ok(
  readFileSync('src/styles/cobro.css', 'utf8').includes('.cobro-btn-spin {'),
  'y la animación definida en la hoja de estilos',
)

console.log('OK · un movimiento no entra dos veces: por identificador acá, y por padrón en Monday')
