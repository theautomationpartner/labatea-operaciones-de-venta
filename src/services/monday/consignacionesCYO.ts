/**
 * Control de mercadería consignada CYO (cuenta y orden) en "Pend Venta de Liq CYO" (18421465215).
 *
 * Se dispara al FINALIZAR la venta, sólo si se emitió una factura de mercadería consignada. Por cada
 * producto consignado facturado se crea un ÍTEM principal (no subítem) con el producto, la fecha de
 * factura, la cantidad y el precio. Las cantidades y precios van como NÚMEROS reales (no strings),
 * para no romper las fórmulas de totales del tablero.
 *
 * La columna de archivo (file_mm5pb2vh) NO se toca en el create_item: adjuntar un binario/URL en el
 * JSON de column_values rompe la API. El PDF de la factura se adjunta APARTE, best-effort, en segundo
 * plano, referenciando el asset del comprobante ya emitido (asset_ids) — la UI no espera por esto.
 */
import { round2 } from '@/lib/format'
import { BOARDS, COL } from './columns'
import { mondayApi, mondayHabilitado } from './sdk'

/** Un producto consignado CYO facturado: producto, cantidad, precio y el comprobante que lo facturó. */
export interface LineaConsignacionCYO {
  /** Ítem del Maestro de Productos. Sin él, la línea no se puede linkear. */
  productoId?: string
  /** Nombre del producto, para rotular el ítem. */
  nombre: string
  cantidad: number
  precioUnitario: number
  /** Comprobante emitido (board 18422405731) que facturó este producto; de él sale el PDF. */
  comprobanteId?: string
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Lee el id del asset del PDF de un comprobante (columna file de Facturación). El PDF lo genera una
 * automatización tras la emisión, así que puede tardar: se reintenta unas veces. Devuelve null si no
 * apareció.
 */
async function pdfAssetDeComprobante(
  comprobanteId: string,
  { intentos = 8, intervalo = 3000 }: { intentos?: number; intervalo?: number } = {},
): Promise<string | null> {
  for (let i = 0; i < intentos; i++) {
    const data = await mondayApi<{ items: { assets: { id: string }[] }[] }>(
      `query ($ids: [ID!]) { items(ids: $ids) { assets(column_ids: ["${COL.facturacion.pdf}"]) { id } } }`,
      { ids: [comprobanteId] },
    )
    const assetId = data.items[0]?.assets?.[0]?.id
    if (assetId) return assetId
    await esperar(intervalo)
  }
  return null
}

/**
 * Adjunta (best-effort) el PDF del comprobante a la columna file de los ítems CYO, referenciando el
 * asset ya existente en monday (`{asset_ids:[...]}`) — sin subir binarios ni URLs. Va en una sola
 * solicitud con alias. Cualquier fallo se traga: los ítems ya quedaron creados.
 */
async function adjuntarPdfConsignacion(itemIds: string[], comprobanteId: string): Promise<void> {
  const assetId = await pdfAssetDeComprobante(comprobanteId)
  if (!assetId || itemIds.length === 0) return
  const cv = JSON.stringify({ [COL.consignacionCYO.pdf]: { asset_ids: [Number(assetId)] } })
  const variables: Record<string, unknown> = { board: BOARDS.consignacionesCYO }
  const campos = itemIds.map((id, i) => {
    variables[`item${i}`] = id
    variables[`cv${i}`] = cv
    return `a${i}: change_multiple_column_values(item_id: $item${i}, board_id: $board, column_values: $cv${i}) { id }`
  })
  const decl = itemIds.map((_, i) => `$item${i}: ID!, $cv${i}: JSON!`).join(', ')
  await mondayApi(`mutation ($board: ID!, ${decl}) { ${campos.join('\n')} }`, variables)
}

/**
 * Crea (bulk) un ítem por producto consignado CYO facturado. Devuelve sin mutar si no hay líneas con
 * producto (p. ej. venta 100% común). Tras crear los ítems, dispara —sin bloquear— la adjunción del
 * PDF de la factura por comprobante.
 *
 * `fecha` va en YYYY-MM-DD. Cantidad y precio se envían como NÚMEROS (no strings).
 */
export async function crearConsignacionesCYO(
  lineas: LineaConsignacionCYO[],
  fecha: string,
): Promise<void> {
  if (!mondayHabilitado()) return
  const conProd = lineas.filter((l) => l.productoId && l.cantidad > 0)
  // Guardrail: sin productos consignados no se crea NADA en el tablero (venta 100% propia/común).
  if (conProd.length === 0) return

  // 1) Bulk de ítems principales (sin la columna file). Números reales para las fórmulas de totales.
  const variables: Record<string, unknown> = { boardId: BOARDS.consignacionesCYO }
  const campos = conProd.map((l, i) => {
    const cv: Record<string, unknown> = {
      [COL.consignacionCYO.producto]: { item_ids: [Number(l.productoId)] },
      [COL.consignacionCYO.fecha]: { date: fecha },
      [COL.consignacionCYO.cantidad]: round2(l.cantidad),
      [COL.consignacionCYO.precio]: round2(l.precioUnitario),
    }
    variables[`n${i}`] = l.nombre
    variables[`cv${i}`] = JSON.stringify(cv)
    return `c${i}: create_item(board_id: $boardId, item_name: $n${i}, column_values: $cv${i}) { id }`
  })
  const decl = conProd.map((_, i) => `$n${i}: String!, $cv${i}: JSON!`).join(', ')
  const creados = await mondayApi<Record<string, { id: string } | null>>(
    `mutation ($boardId: ID!, ${decl}) { ${campos.join('\n')} }`,
    variables,
  )

  // 2) PDF por comprobante: se agrupan los ítems creados por su comprobante y se adjunta su PDF.
  //    Best-effort y desacoplado: no frena la finalización de la operación.
  const porComprobante = new Map<string, string[]>()
  conProd.forEach((l, i) => {
    const itemId = creados[`c${i}`]?.id
    if (!itemId || !l.comprobanteId) return
    const lista = porComprobante.get(l.comprobanteId) ?? []
    lista.push(itemId)
    porComprobante.set(l.comprobanteId, lista)
  })
  for (const [comprobanteId, itemIds] of porComprobante) {
    void adjuntarPdfConsignacion(itemIds, comprobanteId).catch(() => {
      /* La adjunción del PDF es best-effort: si falla, el ítem CYO igual quedó creado. */
    })
  }
}
