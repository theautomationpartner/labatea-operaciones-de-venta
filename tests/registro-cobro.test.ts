/**
 * El recibo YA NO se pone en "Registrar".
 *
 * "🤖Estado Registro de Cobro" (color_mm5zkr61) era el DISPARADOR del escenario de Make que asentaba
 * el cobro (movimientos de caja, cheques, tarjetas, retenciones, anticipo). Ahora eso lo hace la app
 * (`registrarCobroSimultaneo`, ver tests/registro-cobro-simultaneo.test.ts): si `registrarCobro`
 * siguiera escribiendo "Registrar", el escenario registraría el mismo cobro por segunda vez.
 *
 * Lo que se verifica: el ítem y después sus subelementos, ningún disparo, y que se devuelva cada
 * subelemento con lo que lo originó —es lo que el registro necesita—.
 *
 * Se corre con esbuild + node (`npm run test:registro-cobro`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { balancePagos } from '@/lib/cobros'
import { registrarCobro } from '@/services/monday/cobrar'
import { COBRO_REGISTRO_INDEX, COL } from '@/services/monday/columns'
import type { MovimientoPago } from '@/types'

/** Qué operación fue cada llamada, en el orden en que salieron. */
let orden: string[] = []
let cuerpos: { query: string; variables: Record<string, unknown> }[] = []

const clasificar = (q: string): string => {
  if (q.includes('create_subitem')) return 'subitems'
  if (q.includes('change_multiple_column_values')) return 'estado'
  if (q.includes('create_item')) return 'item'
  return 'otra'
}

globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const cuerpo = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> }
  cuerpos.push(cuerpo)
  orden.push(clasificar(cuerpo.query))
  const alias = [...cuerpo.query.matchAll(/(m\d+): create_subitem/g)].map((m) => m[1])
  return {
    ok: true,
    json: async () => ({
      data: alias.length
        ? Object.fromEntries(alias.map((a, i) => [a, { id: `${900 + i}` }]))
        : { create_item: { id: '123' }, change_multiple_column_values: { id: '123' } },
    }),
  }
}) as unknown as typeof fetch

const cobro = (importe: number) =>
  balancePagos([{ formaPago: 'Efectivo', importe } as MovimientoPago])

/* ---------- Una venta de CONTADO cobrada en el acto ---------- */
await registrarCobro({
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  totalVenta: 10000,
  facturas: [{ facturaId: '501', importe: 10000 }],
  balances: cobro(10000),
})

/* Primero el ítem, después sus subelementos, y NINGÚN estado: el disparo del escenario se terminó. */
assert.equal(orden[0], 'item', 'primero se crea el recibo')
assert.equal(orden[1], 'subitems', 'después sus subelementos')
assert.ok(!orden.includes('estado'), 'y no se escribe "Registrar": el escenario de Make registraría el cobro de nuevo')
assert.ok(
  !cuerpos.some((c) => JSON.stringify(c.variables).includes(`"index":${COBRO_REGISTRO_INDEX.registrar}`) && JSON.stringify(c.variables).includes(COL.cobro.estadoRegistro)),
  'en ninguna llamada',
)

/* "🤖Estado de Envio" (color_mkwbzd3f) no se asigna al crear el recibo: sus etiquetas de emisión
   ("Emitido", "A emitir") no existen en el tablero, y con `create_labels_if_missing` se crearían. */
assert.ok(
  !cuerpos.some((c) => JSON.stringify(c.variables).includes('color_mkwbzd3f')),
  'ninguna llamada asigna "🤖Estado de Envio"',
)

/* ---------- Lo que devuelve: cada subelemento con su origen ---------- */
const hecho = await (async () => {
  orden = []
  cuerpos = []
  return registrarCobro({
    clienteId: '111',
    nombreCliente: 'AGRO LUCIA S.A.',
    totalVenta: 10000,
    facturas: [{ facturaId: '501', importe: 10000 }],
    balances: cobro(10000),
  })
})()
assert.equal(hecho.id, '123', 'el id del recibo')
assert.equal(hecho.lineas.length, 1, 'un movimiento de pago (la factura cancelada no se registra aparte)')
assert.equal(hecho.lineas[0].clase, 'pago', 'el efectivo')
assert.equal(hecho.lineas[0].id, '901', 'con el id de SU subelemento (el 900 es el de la factura)')

console.log('OK · el recibo se crea con sus subelementos y ya no dispara "Registrar"')
