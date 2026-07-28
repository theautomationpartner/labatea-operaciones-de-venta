/**
 * Servicio de actualización de la Cuenta Corriente del cliente ("Cta Cte", 18421858736).
 *
 * Por ahora sólo acumula el "🤖Remito Pends de Facturar" (numeric_mm5f2npa): cuando un remito de
 * venta POSTERIOR entrega mercadería que todavía no se facturó, ese importe se suma al saldo
 * existente de la columna.
 */
import { round2 } from '@/lib/format'
import { BOARDS, COL } from './columns'
import { mondayApi, mondayHabilitado } from './sdk'

/**
 * Suma `importe` al "🤖Remito Pends de Facturar" (numeric_mm5f2npa) de la cuenta corriente `ctaCteId`.
 *
 * Es una actualización INCREMENTAL: lee el saldo actual, lo acumula y reescribe el total. Si la
 * columna viene vacía, `null` o no numérica, se toma 0 para la sumatoria (nunca NaN ni reemplazos
 * incorrectos). No hace nada sin token, sin cuenta o con un importe no positivo.
 */
export async function sumarRemitoPendienteFacturar(
  ctaCteId: string | undefined,
  importe: number,
): Promise<void> {
  if (!mondayHabilitado() || !ctaCteId || !(importe > 0)) return

  // Saldo actual de la columna numérica: su valor llega como texto ("1234.5"); vacío/null → 0.
  const data = await mondayApi<{
    items: { column_values: { id: string; text: string | null }[] }[]
  }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) { column_values(ids: ["${COL.ctaCte.remitosPendFacturar}"]) { id text } }
    }`,
    { ids: [ctaCteId] },
  )
  const textoActual = data.items[0]?.column_values?.[0]?.text
  const saldoActual = Number(textoActual)
  const base = Number.isFinite(saldoActual) ? saldoActual : 0
  const nuevoSaldo = round2(base + importe)

  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: ctaCteId,
      board: BOARDS.ctaCte,
      cv: JSON.stringify({ [COL.ctaCte.remitosPendFacturar]: String(nuevoSaldo) }),
    },
  )
}
