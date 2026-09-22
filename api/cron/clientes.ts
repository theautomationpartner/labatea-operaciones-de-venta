/**
 * Vercel Cron Job — mantiene el padrón de clientes cacheado en la base.
 *
 * Dos horarios, un solo path (las expresiones exactas están en `crons`, en `vercel.json`):
 *
 *   cada 5 minutos   INCREMENTAL — sólo lo modificado desde la corrida anterior. 1 consulta, ~2 s.
 *   06:00 UTC        COMPLETO    — barre el tablero entero y reconcilia bajas. 27 consultas, ~59 s.
 *
 * Cuál corre lo decide la cabecera `x-vercel-cron-schedule`, que Vercel manda con la expresión que
 * disparó la invocación.
 *
 * ── Por qué no es un barrido completo cada 5 minutos ──
 * Medido sobre el tablero real: 2681 clientes operables, 27 páginas, 58,7 s por barrido. Cada 5
 * minutos son ~4,7 h/día de función para encontrar, casi siempre, cero cambios —el padrón se toca
 * un puñado de veces por día—. Pedirle a Monday sólo lo modificado deja el mismo frescor por ~2 s
 * por corrida.
 *
 * ── Idempotencia ──
 * Vercel documenta que la entrega es "best effort": puede saltearse una corrida y puede repetir
 * otra. Todo acá es reconciliación, no incrementos: correrlo dos veces con los mismos datos deja
 * exactamente el mismo estado —`actualizado_en` ni se mueve si el contenido no cambió— y saltearse
 * una corrida se recupera sola en la siguiente, porque la marca de agua no avanzó.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mondayServidor } from '../_mondayApi.js'
import {
  BOARD_PERSONAS,
  CAMPOS_CLIENTE,
  REGLAS_OPERABLE,
  clasificarPagina,
  mapClienteCache,
  type ClienteCache,
  type ItemMonday,
} from '../_padron.js'
import {
  anularBajas,
  barrerNoVistos,
  cerrarCorrida,
  darDeBaja,
  guardarClientes,
  leerEstado,
  soltarLock,
  tomarLock,
} from '../_padronDb.js'

/** La expresión del cron que pide el barrido completo. Tiene que coincidir con `vercel.json`. */
const CRON_COMPLETO = '0 6 * * *'

/** Ítems por página. 100 y no 500 porque cada persona trae su cta cte anidada: de a 500, la API corta. */
const PAGINA = 100

/**
 * Solapamiento hacia atrás de la corrida incremental. Los relojes del servidor y de Monday no son
 * el mismo, y un ítem modificado en el segundo exacto del corte se perdería para siempre: la marca
 * ya habría avanzado por encima de él. Dos minutos de repetición cuestan nada —el upsert es
 * idempotente— y cierran ese agujero.
 */
const SOLAPE_MS = 2 * 60_000

/**
 * Tope de páginas de la incremental. Si se supera, es que pasó algo masivo (una importación, una
 * edición en bloque) y sale más barato barrer entero que seguir paginando lo modificado.
 */
const TOPE_PAGINAS_INCREMENTAL = 30

/**
 * Presupuesto de tiempo. `maxDuration` está en 120 s (`vercel.json`); se corta antes por las
 * buenas para poder cerrar la corrida y soltar el lock, en vez de que la función muera a mitad.
 */
const PRESUPUESTO_MS = 100_000

interface PaginaItems {
  cursor: string | null
  items: ItemMonday[]
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  /* Falla CERRADA, igual que la lista blanca: sin `CRON_SECRET` configurada nadie entra. Si el
     secreto faltante dejara pasar, esta ruta sería un barrido del tablero entero a pedido de
     cualquiera que la encuentre. Vercel manda el valor como `Authorization: Bearer <secreto>`. */
  const secreto = process.env.CRON_SECRET?.trim()
  if (!secreto || req.headers.authorization !== `Bearer ${secreto}`) {
    return responder(res, 401, { error: 'No autorizado' })
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  const forzado = url.searchParams.get('modo')
  const programa = cabecera(req, 'x-vercel-cron-schedule')

  if (!(await tomarLock())) {
    /* 200 y no error: que otra corrida esté trabajando es el funcionamiento normal, no un fallo.
       Un 500 acá sólo ensuciaría los logs del cron con alarmas que nadie tiene que atender. */
    return responder(res, 200, { omitido: 'ya hay una corrida en curso' })
  }

  const arranque = Date.now()
  const inicio = new Date()
  try {
    const estado = await leerEstado()
    /* Sin marca previa no hay "desde dónde": la primera corrida de la vida es completa, aunque la
       haya disparado el cron de 5 minutos. */
    const completo = forzado === 'completo' || programa === CRON_COMPLETO || !estado.marca

    const resultado = completo
      ? await barridoCompleto(inicio, arranque)
      : await barridoIncremental(estado.marca as Date, inicio, arranque)

    await cerrarCorrida({
      marca: resultado.marca,
      completo: resultado.completo,
      clientes: resultado.clientes,
      duracionMs: Date.now() - arranque,
      error: null,
    })
    return responder(res, 200, { ...resultado, duracionMs: Date.now() - arranque })
  } catch (e) {
    const mensaje = (e as Error).message
    /* El error queda guardado —no sólo en el log— para que se pueda ver desde afuera que el padrón
       dejó de actualizarse y por qué. La marca NO avanza: la próxima corrida reintenta el mismo
       tramo y no se saltea lo que no llegó a procesarse. */
    await cerrarCorrida({
      marca: null,
      completo: false,
      clientes: 0,
      duracionMs: Date.now() - arranque,
      error: mensaje,
    }).catch(() => {})
    console.error('[cron clientes]', mensaje)
    return responder(res, 500, { error: mensaje })
  } finally {
    /* Sin esto, una corrida que revienta deja el lock tomado y frena TODAS las siguientes hasta
       que vence. Por eso va en `finally` y no al final del `try`. */
    await soltarLock().catch(() => {})
  }
}

interface Resultado {
  modo: 'completo' | 'incremental'
  completo: boolean
  clientes: number
  bajas: number
  paginas: number
  marca: string | null
}

/**
 * Barrido COMPLETO: el tablero entero, ya filtrado por operable en la consulta.
 *
 * Al terminar da de baja lo que no se vio en esta vuelta. Es la única corrida que puede hacerlo,
 * porque es la única que ve el padrón completo: la incremental sólo ve lo modificado y "no lo vi"
 * ahí no significa nada.
 */
async function barridoCompleto(inicio: Date, arranque: number): Promise<Resultado> {
  let cursor: string | null = null
  let paginas = 0
  let clientes = 0
  let masNueva: string | null = null

  do {
    if (Date.now() - arranque > PRESUPUESTO_MS) {
      /* Cortado por tiempo: NO se barren los no vistos. Lo que no se alcanzó a recorrer figuraría
         como ausente y se daría de baja el resto del padrón de un saque. */
      throw new Error(`barrido completo cortado por tiempo tras ${paginas} páginas`)
    }
    const pagina: PaginaItems = await traerPagina(cursor, true)
    const lote = pagina.items.map(mapClienteCache)
    if (lote.length > 0) {
      await guardarClientes(lote)
      await anularBajas(lote.map((c) => c.id))
    }
    masNueva = masReciente(masNueva, pagina.items)
    clientes += lote.length
    cursor = pagina.cursor
    paginas++
  } while (cursor)

  const bajas = await barrerNoVistos(inicio)
  return { modo: 'completo', completo: true, clientes, bajas, paginas, marca: masNueva }
}

/**
 * Barrido INCREMENTAL: lo modificado desde la marca, ordenado por fecha de modificación
 * descendente, cortando en cuanto se llega a lo ya procesado.
 *
 * Va SIN las reglas de operable, y ese es el punto fino. Si el filtro viajara en la consulta, el
 * cliente que pasa a INACTIVO —o que deja de ser categoría "Clientes"— desaparecería del resultado
 * y quedaría vivo en el caché para siempre, elegible para vender. Sin filtro llega igual y acá se
 * decide: operable entra, no operable se da de baja.
 */
async function barridoIncremental(
  marca: Date,
  inicio: Date,
  arranque: number,
): Promise<Resultado> {
  const corte = marca.getTime() - SOLAPE_MS
  let cursor: string | null = null
  let paginas = 0
  let masNueva: string | null = null
  const entran: ClienteCache[] = []
  const salen: string[] = []

  for (;;) {
    if (Date.now() - arranque > PRESUPUESTO_MS) {
      throw new Error(`barrido incremental cortado por tiempo tras ${paginas} páginas`)
    }
    if (paginas >= TOPE_PAGINAS_INCREMENTAL) {
      /* Se modificó media base de una (una importación, una edición en bloque): sale más barato
         barrer entero que seguir paginando lo modificado. Se escala ACÁ MISMO y no dejándoselo al
         cron del día siguiente: lo recogido hasta acá se descarta a propósito, porque el barrido
         completo lo vuelve a traer y además reconcilia las bajas. */
      console.warn(`[cron clientes] la incremental superó ${TOPE_PAGINAS_INCREMENTAL} páginas: se escala a barrido completo`)
      return barridoCompleto(inicio, arranque)
    }

    const pagina: PaginaItems = await traerPagina(cursor, false)
    paginas++

    const clasificada = clasificarPagina(pagina.items, corte, masNueva)
    masNueva = clasificada.masNueva
    entran.push(...clasificada.entran)
    salen.push(...clasificada.salen)

    if (clasificada.alcanzado || !pagina.cursor) break
    cursor = pagina.cursor
  }

  if (entran.length > 0) {
    await guardarClientes(entran)
    await anularBajas(entran.map((c) => c.id))
  }
  const bajas = await darDeBaja(salen)

  return {
    modo: 'incremental',
    completo: false,
    clientes: entran.length,
    bajas,
    paginas,
    marca: masNueva,
  }
}

/**
 * Una página del tablero. Con `operables`, filtrada por categoría y estado; sin eso, todo el
 * tablero ordenado por fecha de modificación descendente.
 *
 * `next_items_page` conserva el filtro y el orden de la consulta que abrió el cursor, así que las
 * páginas siguientes son iguales en los dos casos.
 */
async function traerPagina(cursor: string | null, operables: boolean): Promise<PaginaItems> {
  if (cursor) {
    const data = await mondayServidor<{ next_items_page: PaginaItems }>(
      `query { next_items_page(limit: ${PAGINA}, cursor: ${JSON.stringify(cursor)}) {
         cursor items { ${CAMPOS_CLIENTE} }
       } }`,
      {},
    )
    return data.next_items_page
  }

  const params = operables
    ? `query_params: {rules: [${REGLAS_OPERABLE}]}`
    : `query_params: {order_by: [{column_id: "__last_updated__", direction: desc}]}`

  const data = await mondayServidor<{ boards: { items_page: PaginaItems }[] }>(
    `query { boards(ids: [${BOARD_PERSONAS}]) {
       items_page(limit: ${PAGINA}, ${params}) {
         cursor items { ${CAMPOS_CLIENTE} }
       }
     } }`,
    {},
  )
  return data.boards?.[0]?.items_page ?? { cursor: null, items: [] }
}

/** La fecha de modificación más nueva vista. Es la marca desde la que arranca la corrida siguiente. */
function masReciente(actual: string | null, items: ItemMonday[]): string | null {
  let maxima = actual
  for (const it of items) {
    if (!it.updated_at) continue
    if (!maxima || it.updated_at > maxima) maxima = it.updated_at
  }
  return maxima
}

function cabecera(req: IncomingMessage, nombre: string): string {
  const valor = req.headers[nombre]
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? ''
}

function responder(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(data))
}
