/**
 * Flujo "Proforma y Retenciones" (cliente agente de retención). Opera sobre el ítem de la venta
 * ("📈Ventas", 18421035510) ya creado: emite la factura proforma (columna estado color_mm4dqxq3) y
 * la despacha a los contactos (board_relation_mm5njnad + dropdown_mm5njprp + estado color_mm5n6zrn).
 *
 * Los índices de las etiquetas se resuelven por metadata (settings_str), no se hardcodean.
 */
import type { MedioEnvio } from '@/types'
import { BOARDS, COL, MEDIO_ENVIO_LABELS } from './columns'
import { mondayApi, mondayHabilitado } from './sdk'

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Etiquetas de la emisión de la proforma. Se buscan por texto en la metadata de la columna. */
export const PROFORMA_ESTADO = {
  emitir: 'Emitir',
  emitiendo: 'Emitiendo',
  emitido: 'Emitido',
  error: 'Error',
} as const

/** Etiqueta que dispara el envío de la proforma. */
const PROFORMA_ENVIO_ENVIAR = 'Enviar'
const PROFORMA_ENVIO_ENVIADO = 'Enviado'

/** Índice de una etiqueta en una columna status del board de Ventas, leído de su metadata. */
async function indiceEstadoVenta(columnId: string, label: string): Promise<number | null> {
  const data = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.ventas}]) { columns(ids: ["${columnId}"]) { settings_str } } }`,
  )
  const raw = data.boards[0]?.columns?.[0]?.settings_str
  if (!raw) return null
  const labels = (JSON.parse(raw).labels ?? {}) as Record<string, string>
  const entrada = Object.entries(labels).find(([, l]) => l === label)
  return entrada ? Number(entrada[0]) : null
}

/** Escribe una columna status del ítem de la venta por índice. */
async function setEstadoVenta(ventaId: string, columnId: string, index: number): Promise<void> {
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    { id: ventaId, board: BOARDS.ventas, cv: JSON.stringify({ [columnId]: { index } }) },
  )
}

/** Lee el texto de una columna status del ítem de la venta. */
async function getEstadoVenta(ventaId: string, columnId: string): Promise<string> {
  const data = await mondayApi<{ items: { column_values: { text: string | null }[] }[] }>(
    `query ($ids: [ID!]) { items(ids: $ids) { column_values(ids: ["${columnId}"]) { text } } }`,
    { ids: [ventaId] },
  )
  return data.items[0]?.column_values[0]?.text?.trim() ?? ''
}

/**
 * Emite la factura proforma: pone "🤖Estado Proforma" (color_mm4dqxq3) en "Emitir" —por índice
 * dinámico—, lo que dispara la generación por backend.
 */
export async function emitirProforma(ventaId: string): Promise<void> {
  if (!mondayHabilitado()) return
  const idx = await indiceEstadoVenta(COL.venta.estadoProforma, PROFORMA_ESTADO.emitir)
  if (idx == null) return
  await setEstadoVenta(ventaId, COL.venta.estadoProforma, idx)
}

/** Estado actual de la emisión de la proforma, tal cual el board. */
export async function getEstadoProforma(ventaId: string): Promise<string> {
  if (!mondayHabilitado()) return PROFORMA_ESTADO.emitido
  return getEstadoVenta(ventaId, COL.venta.estadoProforma)
}

/**
 * Sigue la emisión de la proforma hasta que la columna llega a "Emitido" (o a un estado de error).
 * Avisa cada cambio por `onEstado`. En modo local simula la secuencia.
 */
export async function seguirEmisionProforma(
  ventaId: string,
  onEstado: (estado: string) => void,
  { intentos = 40, intervalo = 3000 }: { intentos?: number; intervalo?: number } = {},
): Promise<string> {
  if (!mondayHabilitado()) {
    onEstado(PROFORMA_ESTADO.emitiendo)
    await esperar(1200)
    onEstado(PROFORMA_ESTADO.emitido)
    return PROFORMA_ESTADO.emitido
  }
  let ultimo = ''
  for (let i = 0; i < intentos; i++) {
    const estado = await getEstadoProforma(ventaId)
    if (estado && estado !== ultimo) {
      ultimo = estado
      onEstado(estado)
    }
    if (estado === PROFORMA_ESTADO.emitido || /error/i.test(estado)) return estado
    await esperar(intervalo)
  }
  return ultimo
}

/**
 * Paso 1 del envío de la proforma: deja en el ítem de la venta a quién y por dónde mandarla —los
 * contactos en board_relation_mm5njnad y el medio en dropdown_mm5njprp—. No dispara nada todavía.
 */
export async function asignarDestinatariosProforma(
  ventaId: string,
  contactoItemIds: string[],
  medio: MedioEnvio,
): Promise<void> {
  if (!mondayHabilitado()) return
  const ids = contactoItemIds.map(Number).filter((n) => Number.isFinite(n))
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: ventaId,
      board: BOARDS.ventas,
      cv: JSON.stringify({
        [COL.venta.contactosProforma]: { item_ids: ids },
        [COL.venta.medioEnvioProforma]: { labels: MEDIO_ENVIO_LABELS[medio] },
      }),
    },
  )
}

/** Paso 2: pone "Estado Envío Proforma" (color_mm5n6zrn) en "Enviar" —por índice—: dispara el envío. */
export async function dispararEnvioProforma(ventaId: string): Promise<void> {
  if (!mondayHabilitado()) return
  const idx = await indiceEstadoVenta(COL.venta.estadoEnvioProforma, PROFORMA_ENVIO_ENVIAR)
  if (idx == null) return
  await setEstadoVenta(ventaId, COL.venta.estadoEnvioProforma, idx)
}

/** Lee el estado de envío de la proforma. */
export async function getEstadoEnvioProforma(ventaId: string): Promise<string> {
  if (!mondayHabilitado()) return PROFORMA_ENVIO_ENVIADO
  return getEstadoVenta(ventaId, COL.venta.estadoEnvioProforma)
}

/** Sigue el envío de la proforma hasta "Enviado" o error. En modo local simula la secuencia. */
export async function seguirEnvioProforma(
  ventaId: string,
  onEstado: (estado: string) => void,
  { intentos = 30, intervalo = 2000 }: { intentos?: number; intervalo?: number } = {},
): Promise<string> {
  if (!mondayHabilitado()) {
    onEstado('Enviando')
    await esperar(1200)
    onEstado(PROFORMA_ENVIO_ENVIADO)
    return PROFORMA_ENVIO_ENVIADO
  }
  let ultimo = ''
  for (let i = 0; i < intentos; i++) {
    const estado = await getEstadoEnvioProforma(ventaId)
    if (estado && estado !== ultimo) {
      ultimo = estado
      onEstado(estado)
    }
    if (estado === PROFORMA_ENVIO_ENVIADO || /error/i.test(estado)) return estado
    await esperar(intervalo)
  }
  return ultimo
}
