/**
 * Servicio de validación previa de remitos: el talonario y la hoja (folio) con los que se numera.
 *
 * Antes de emitir un remito hay que tener un talonario "En USO" con al menos una hoja "Pend de Usar".
 * Los índices de esos estados se resuelven leyendo la metadata del board (nunca hardcodeados), así
 * el chequeo sobrevive a que se reordenen o reescriban las etiquetas.
 */
import { BOARDS, COL } from './columns'
import { mondayApi, mondayHabilitado } from './sdk'

/** Talonario activo + primera hoja disponible, listos para numerar el remito. */
export interface HojaTalonario {
  /** ID del subítem (hoja) a linkear en el remito. */
  hojaId: string
  /** Nombre del subítem: la "Hoja de Talonario". */
  hojaNombre: string
  /** Nombre del talonario activo (ítem principal "En USO"). */
  talonarioNombre: string
}

/**
 * Resultado del chequeo previo:
 * - `ok`: hay talonario y hoja disponibles.
 * - `sin-talonario`: ningún talonario "En USO" → "No hay talonarios disponibles".
 * - `sin-hoja`: talonario "En USO" pero sin hojas "Pend de Usar" → "Sin hoja de talonario asignada".
 */
export type ResultadoTalonario =
  | { estado: 'ok'; hoja: HojaTalonario }
  | { estado: 'sin-talonario' }
  | { estado: 'sin-hoja' }

/** Índice del label cuyo texto coincide exactamente, leído de la metadata de la columna status. */
const indiceDeLabel = (settingsStr: string | undefined, label: string): number | null => {
  if (!settingsStr) return null
  const labels = (JSON.parse(settingsStr).labels ?? {}) as Record<string, string>
  const entrada = Object.entries(labels).find(([, l]) => l === label)
  return entrada ? Number(entrada[0]) : null
}

interface SubHoja {
  id: string
  name: string
  column_values: { id: string; index?: number | null }[]
}

/** Un talonario con su estado (color_mm5hmyaj) y sus hojas, tal como vuelve de la consulta. */
interface TalonarioItem {
  id: string
  name: string
  column_values: { id: string; index?: number | null }[]
  subitems: SubHoja[]
}

/**
 * Busca un talonario disponible y su primera hoja "Pend de Usar". El estado del talonario se filtra
 * con lógica OR ("En USO" O "Recibido Preimpreso"), y luego se prioriza en memoria: primero un
 * talonario "En USO" con hoja disponible; si no hay, uno "Recibido Preimpreso" con hoja. Todos los
 * índices se resuelven por metadata (nunca hardcodeados). En modo local devuelve una hoja simulada.
 */
export async function getHojaTalonario(): Promise<ResultadoTalonario> {
  if (!mondayHabilitado()) {
    return {
      estado: 'ok',
      hoja: { hojaId: 'mock-hoja', hojaNombre: 'NRTO-01', talonarioNombre: 'TALON-01' },
    }
  }

  // 1) Índices de "En USO"/"Recibido Preimpreso" (talonario) y "Pend de Usar" (hoja), por metadata.
  const meta = await mondayApi<{
    tal: { columns: { settings_str: string }[] }[]
    sub: { columns: { settings_str: string }[] }[]
  }>(
    `query {
      tal: boards(ids: [${BOARDS.talonarios}]) { columns(ids: ["${COL.talonario.estado}"]) { settings_str } }
      sub: boards(ids: [${BOARDS.talonariosSub}]) { columns(ids: ["${COL.talonarioSub.estado}"]) { settings_str } }
    }`,
  )
  const talSettings = meta.tal[0]?.columns?.[0]?.settings_str
  const enUsoIdx = indiceDeLabel(talSettings, 'En USO')
  const recibidoIdx = indiceDeLabel(talSettings, 'Recibido Preimpreso')
  const pendDeUsarIdx = indiceDeLabel(meta.sub[0]?.columns?.[0]?.settings_str, 'Pend de Usar')
  // Índices a incluir en el OR; si no se resuelve ninguno, no hay nada que consultar.
  const indicesEstado = [enUsoIdx, recibidoIdx].filter((x): x is number => x != null)
  if (indicesEstado.length === 0) return { estado: 'sin-talonario' }

  // 2) Talonarios cuyo estado sea "En USO" O "Recibido Preimpreso" (any_of), con sus hojas.
  const data = await mondayApi<{ boards: { items_page: { items: TalonarioItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.talonarios}]) {
        items_page(
          limit: 50,
          query_params: {rules: [
            {column_id: "${COL.talonario.estado}", compare_value: [${indicesEstado.join(', ')}], operator: any_of}
          ]}
        ) {
          items {
            id name
            column_values(ids: ["${COL.talonario.estado}"]) {
              id
              ... on StatusValue { index }
            }
            subitems {
              id name
              column_values(ids: ["${COL.talonarioSub.estado}"]) {
                id
                ... on StatusValue { index }
              }
            }
          }
        }
      }
    }`,
  )
  const talonarios = data.boards[0]?.items_page?.items ?? []

  // Estado del talonario e primera hoja "Pend de Usar" (orden correlativo de subítems).
  const estadoDe = (t: TalonarioItem) =>
    t.column_values.find((cv) => cv.id === COL.talonario.estado)?.index
  const primeraHoja = (t: TalonarioItem) =>
    (t.subitems ?? []).find(
      (s) => s.column_values.find((cv) => cv.id === COL.talonarioSub.estado)?.index === pendDeUsarIdx,
    )

  // 3) Priorización: 1º un talonario "En USO" con hoja; 2º uno "Recibido Preimpreso" con hoja.
  const buscar = (estadoIdx: number | null): { t: TalonarioItem; h: SubHoja } | null => {
    if (estadoIdx == null) return null
    for (const t of talonarios) {
      if (estadoDe(t) !== estadoIdx) continue
      const h = primeraHoja(t)
      if (h) return { t, h }
    }
    return null
  }
  const elegido = buscar(enUsoIdx) ?? buscar(recibidoIdx)
  if (!elegido) return { estado: 'sin-talonario' }

  return {
    estado: 'ok',
    hoja: { hojaId: elegido.h.id, hojaNombre: elegido.h.name, talonarioNombre: elegido.t.name },
  }
}

/**
 * Cierra la hoja del talonario tras consumirla: pone su "🤖Estado Rto" (status) en "Usado", por
 * índice dinámico (metadata). Se llama al emitir el remito, ya vinculada la hoja al documento, para
 * mantener el correlativo de talonario. Best-effort: no frena la emisión.
 */
export async function marcarHojaUsada(hojaId: string): Promise<void> {
  if (!mondayHabilitado() || !hojaId || !Number.isFinite(Number(hojaId))) return
  const meta = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.talonariosSub}]) { columns(ids: ["${COL.talonarioSub.estado}"]) { settings_str } } }`,
  )
  const idx = indiceDeLabel(meta.boards[0]?.columns?.[0]?.settings_str, 'Usado')
  if (idx == null) return
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: hojaId,
      board: BOARDS.talonariosSub,
      cv: JSON.stringify({ [COL.talonarioSub.estado]: { index: idx } }),
    },
  )
}
