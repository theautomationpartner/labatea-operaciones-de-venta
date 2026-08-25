/**
 * "Tipo" de un cheque: las dos únicas opciones son "Cheque" y "eCheq", y son EXACTAMENTE lo que se
 * escribe en "🤖Origen Cheque" (dropdown_mm5yveka).
 *
 * Antes el papel se llamaba 'FISICO' adentro y viajaba como "Papel" —una etiqueta que NO existe en
 * esa columna—. El bulk crea las etiquetas que faltan, así que no fallaba nada: cada cheque de papel
 * iba sumando una "Papel" paralela a la "Cheque" del tablero, y los reportes quedaban partidos entre
 * dos etiquetas que significan lo mismo. Es el peor tipo de error de mapeo: silencioso y acumulativo.
 *
 * La regla que se fija: el VALOR del tipo es la etiqueta del tablero, sin tabla de traducción en el
 * medio que pueda quedar desfasada.
 *
 * Se corre con esbuild + node (`npm run test:cheque-formato`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { SIN_DESCUENTOS_PAGO, balancePagos } from '@/lib/cobros'
import { registrarCobro } from '@/services/monday/cobrar'
import { COL } from '@/services/monday/columns'
import type { FormatoCheque, MovimientoPago } from '@/types'

/** Las dos etiquetas del tablero, verificadas contra el board 18421035599. */
const DEL_TABLERO: readonly FormatoCheque[] = ['Cheque', 'eCheq']

let llamadas: { query: string; variables: Record<string, unknown> }[] = []
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const cuerpo = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> }
  llamadas.push(cuerpo)
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

/** Qué se escribe en la columna de origen al cargar un cheque con ese formato. */
async function origenEscrito(formato: FormatoCheque): Promise<unknown> {
  llamadas = []
  await registrarCobro({
    clienteId: '111',
    nombreCliente: 'AGRO LUCIA S.A.',
    totalVenta: 1000,
    facturas: [{ facturaId: '501', importe: 1000 }],
    balances: balancePagos(
      [{ formaPago: 'Cheque', importe: 1000, formatoCheque: formato } as MovimientoPago],
      SIN_DESCUENTOS_PAGO,
    ),
  })
  const sub = llamadas[1]
  const i = [0, 1, 2].find((n) => sub.variables[`n${n}`] === 'Cheque')
  assert.notEqual(i, undefined, 'tiene que haber un subelemento de cheque')
  const cv = JSON.parse(sub.variables[`c${i}`] as string) as Record<string, unknown>
  return cv[COL.cobroSub.origenCheque]
}

/* ---------- Cada opción se escribe TAL CUAL ---------- */
for (const formato of DEL_TABLERO) {
  assert.deepEqual(
    await origenEscrito(formato),
    { labels: [formato] },
    `"${formato}" tiene que llegar al tablero con ese mismo nombre`,
  )
}

/* ---------- Y "Papel" no puede volver ----------
   Es la etiqueta inventada que se venía creando sola. Si reaparece, los cheques de papel vuelven a
   quedar repartidos entre dos etiquetas. */
for (const formato of DEL_TABLERO) {
  const escrito = JSON.stringify(await origenEscrito(formato))
  assert.ok(!/papel/i.test(escrito), `"${formato}" no puede escribir "Papel"`)
}

/* ---------- El tipo NO admite otra cosa ----------
   `FormatoCheque` es la unión de las dos etiquetas, así que el typecheck es el que impide mandar un
   tercer valor. Acá se fija que la unión sea exactamente esas dos y no se le sume una por descuido. */
const todas: Record<FormatoCheque, true> = { Cheque: true, eCheq: true }
assert.deepEqual(
  Object.keys(todas).sort(),
  [...DEL_TABLERO].sort(),
  'las opciones del tipo son exactamente las dos etiquetas del tablero',
)

console.log('OK · el Tipo del cheque es "Cheque" o "eCheq", y llega al tablero tal cual')
