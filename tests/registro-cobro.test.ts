/**
 * El recibo se pone en "Registrar" RECIÉN cuando está completo.
 *
 * "🤖Estado Registro de Cobro" (color_mm5zkr61) no es un dato: es el DISPARADOR de la automatización
 * que asienta el cobro en el sistema. Puesto antes de que existan los subelementos, la automatización
 * corre sobre un recibo sin facturas ni movimientos y registra un cobro vacío —y nada falla: el
 * ítem existe, el estado es válido y el error recién se ve en la caja—.
 *
 * Por eso lo que se verifica es el ORDEN de las llamadas, no sólo el payload.
 *
 * Se corre con esbuild + node (`npm run test:registro-cobro`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { SIN_DESCUENTOS_PAGO, balancePagos } from '@/lib/cobros'
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
  balancePagos([{ formaPago: 'Efectivo', importe } as MovimientoPago], SIN_DESCUENTOS_PAGO)

/* ---------- Una venta de CONTADO cobrada en el acto ---------- */
await registrarCobro({
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  totalVenta: 10000,
  facturas: [{ facturaId: '501', importe: 10000 }],
  balances: cobro(10000),
})

/* El orden es la regla: primero el ítem, después sus subelementos, y el estado AL FINAL. */
assert.equal(orden[0], 'item', 'primero se crea el recibo')
assert.equal(orden[1], 'subitems', 'después sus subelementos')
assert.equal(orden[2], 'estado', 'y RECIÉN ahí se dispara el registro')
assert.ok(
  orden.indexOf('estado') > orden.indexOf('subitems'),
  'el disparo nunca puede adelantarse a los subelementos: registraría un cobro vacío',
)

/* ---------- El payload del disparo ---------- */
const disparo = cuerpos[orden.indexOf('estado')]
assert.equal(disparo.variables.item, '123', 'sobre el recibo recién creado')
const cv = JSON.parse(disparo.variables.cv as string) as Record<string, unknown>
/* Va por ÍNDICE: es una columna de sistema y el rótulo se renombra desde Monday sin avisar. */
assert.deepEqual(
  cv[COL.cobro.estadoRegistro],
  { index: COBRO_REGISTRO_INDEX.registrar },
  'se pone en "Registrar", por índice',
)
assert.equal(COBRO_REGISTRO_INDEX.registrar, 4, 'que es el 4 en este tablero')
assert.deepEqual(Object.keys(cv), [COL.cobro.estadoRegistro], 'y no toca ninguna otra columna')

/* ---------- Sin movimientos NO se dispara ----------
   Un recibo sin cobros cargados no tiene nada que registrar: pedirle a la automatización que lo
   asiente sería mandarla a trabajar sobre la nada. */
orden = []
cuerpos = []
await registrarCobro({
  clienteId: '111',
  nombreCliente: 'AGRO LUCIA S.A.',
  totalVenta: 10000,
  facturas: [{ facturaId: '501', importe: 10000 }],
  balances: [],
})
assert.ok(orden.includes('subitems'), 'la factura cancelada sí deja su subelemento')
assert.ok(!orden.includes('estado'), 'pero el registro no se dispara sin un cobro cargado')

console.log('OK · el recibo se pone en "Registrar" recién con sus subelementos ya creados')
