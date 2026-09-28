/**
 * Servicio de validación previa de remitos: el talonario y la hoja (folio) con los que se numera.
 *
 * Antes de emitir un remito hay que tener un talonario "En USO" con al menos una hoja "Pend de Usar".
 * Los índices de esos estados se resuelven leyendo la metadata del board (nunca hardcodeados), así
 * el chequeo sobrevive a que se reordenen o reescriban las etiquetas.
 */
import { BOARDS, COL } from './columns'
import { mondayApi, mondayHabilitado } from './sdk'

/**
 * Lo que el talonario imprime en los PDF del remito: el número y el pie de imprenta con el CAI.
 * Las fechas van en dd/MM/yyyy, como las muestra la app.
 */
export interface DatosImprenta {
  /** "0091". */
  puntoVenta: string
  /** El correlativo de la hoja: "00000007". */
  numeroHoja: string
  /** Rango de numeración del talonario, con los ceros del papel: "00000001" / "00000020". */
  desde: string
  hasta: string
  habilitacionImprenta: string
  cai: string
  vencimientoCai: string
  fechaImpresion: string
}

/** Talonario activo + primera hoja disponible, listos para numerar el remito. */
export interface HojaTalonario {
  /** ID del subítem (hoja) a linkear en el remito. */
  hojaId: string
  /** Nombre del subítem: la "Hoja de Talonario". */
  hojaNombre: string
  /** Nombre del talonario activo (ítem principal "En USO"). */
  talonarioNombre: string
  /** Número y pie de imprenta, para los PDF. */
  imprenta: DatosImprenta
}

/**
 * El número del remito en los PDF: punto de venta y correlativo, como un comprobante con CAI
 * ("0091-00000007").
 */
export const numeroRemito = (d: Pick<DatosImprenta, 'puntoVenta' | 'numeroHoja'>): string =>
  [d.puntoVenta, d.numeroHoja].filter(Boolean).join('-')

/** yyyy-MM-dd (columna date de Monday) → dd/MM/yyyy. Vacío si no hay fecha. */
const fechaAr = (iso: string | null | undefined): string => {
  const [y, m, d] = (iso ?? '').split('-')
  return y && m && d ? `${d}/${m}/${y}` : ''
}

/** Un número del rango, con los 8 dígitos del papel (en Monday puede estar cargado como "1"). */
const conCeros = (v: string): string => (/^\d+$/.test(v) ? v.padStart(8, '0') : v)

/** Lo que devuelve Monday de una columna de estas: el texto y, en las fechas, el valor crudo. */
interface CV {
  id: string
  text?: string | null
  value?: string | null
  index?: number | null
}

const texto = (cvs: CV[], id: string): string => (cvs.find((c) => c.id === id)?.text ?? '').trim()

/** Fecha de una columna date: se lee del `value` ({"date":"2026-10-30"}), no del texto formateado. */
const fecha = (cvs: CV[], id: string): string => {
  const cv = cvs.find((c) => c.id === id)
  try {
    const v = cv?.value ? (JSON.parse(cv.value) as { date?: string }) : null
    return fechaAr(v?.date ?? cv?.text ?? '')
  } catch {
    return fechaAr(cv?.text ?? '')
  }
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
  column_values: CV[]
}

/** Un talonario con su estado (color_mm5hmyaj) y sus hojas, tal como vuelve de la consulta. */
interface TalonarioItem {
  id: string
  name: string
  column_values: CV[]
  subitems: SubHoja[]
}

/** Los datos de imprenta de un talonario y una de sus hojas. */
function imprentaDe(t: TalonarioItem, h: SubHoja): DatosImprenta {
  const c = t.column_values
  return {
    puntoVenta: texto(c, COL.talonario.puntoVenta),
    // El correlativo sale de la hoja; si faltara, del final de su nombre ("RTO 0091 - 00000007").
    numeroHoja: texto(h.column_values, COL.talonarioSub.numero) || (h.name.match(/(\d+)\s*$/)?.[1] ?? ''),
    desde: conCeros(texto(c, COL.talonario.desde)),
    hasta: conCeros(texto(c, COL.talonario.hasta)),
    habilitacionImprenta: texto(c, COL.talonario.habilitacionImprenta),
    cai: texto(c, COL.talonario.cai),
    vencimientoCai: fecha(c, COL.talonario.vencimientoCai),
    fechaImpresion: fecha(c, COL.talonario.fechaImpresion),
  }
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
      hoja: {
        hojaId: 'mock-hoja',
        hojaNombre: 'RTO 0091 - 00000001',
        talonarioNombre: 'TALON-01',
        imprenta: {
          puntoVenta: '0091',
          numeroHoja: '00000001',
          desde: '00000001',
          hasta: '00000020',
          habilitacionImprenta: '06/2027',
          cai: '1234567890123',
          vencimientoCai: '30/10/2026',
          fechaImpresion: '24/07/2026',
        },
      },
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
            column_values(ids: ["${COL.talonario.estado}", "${COL.talonario.puntoVenta}", "${COL.talonario.desde}", "${COL.talonario.hasta}", "${COL.talonario.habilitacionImprenta}", "${COL.talonario.cai}", "${COL.talonario.vencimientoCai}", "${COL.talonario.fechaImpresion}"]) {
              id text value
              ... on StatusValue { index }
            }
            subitems {
              id name
              column_values(ids: ["${COL.talonarioSub.estado}", "${COL.talonarioSub.numero}"]) {
                id text
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
    hoja: {
      hojaId: elegido.h.id,
      hojaNombre: elegido.h.name,
      talonarioNombre: elegido.t.name,
      imprenta: imprentaDe(elegido.t, elegido.h),
    },
  }
}

/**
 * La hoja sigue libre ("🤖Estado Rto" en "Pend de Usar"). Al emitir la app sólo la ASIGNA —la lee y
 * numera los PDF con ella—; la toma recién al registrar. Entre una cosa y la otra otro remito pudo
 * usarla, y por eso se vuelve a mirar antes de tomarla. Se compara por la etiqueta, no por el índice.
 */
export async function hojaDisponible(hojaId: string): Promise<boolean> {
  if (!mondayHabilitado() || hojaId === 'mock-hoja') return true
  const data = await mondayApi<{ items: { column_values: { text?: string | null }[] }[] }>(
    `query ($ids: [ID!]) { items(ids: $ids) { column_values(ids: ["${COL.talonarioSub.estado}"]) { text } } }`,
    { ids: [hojaId] },
  )
  return (data.items[0]?.column_values[0]?.text ?? '').trim() === 'Pend de Usar'
}

/**
 * Consume la hoja del talonario: pone su "🤖Estado Rto" (status) en "Usado", por índice dinámico
 * (metadata). Se llama al REGISTRAR el remito, después de confirmar que la hoja sigue libre
 * (`hojaDisponible`). Lanza si no puede: sin la hoja tomada, el remito no se registra.
 */
export async function marcarHojaUsada(hojaId: string): Promise<void> {
  if (!mondayHabilitado() || hojaId === 'mock-hoja') return
  if (!hojaId || !Number.isFinite(Number(hojaId))) throw new Error(`Hoja de talonario inválida: ${hojaId}`)
  const meta = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.talonariosSub}]) { columns(ids: ["${COL.talonarioSub.estado}"]) { settings_str } } }`,
  )
  const idx = indiceDeLabel(meta.boards[0]?.columns?.[0]?.settings_str, 'Usado')
  if (idx == null) throw new Error('El tablero de talonarios no tiene el estado "Usado".')
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
