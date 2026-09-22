/**
 * Vercel Cron Job — mantiene el Maestro de Productos cacheado en la base.
 *
 * Dos horarios, un solo path (las expresiones exactas están en `crons`, en `vercel.json`):
 *
 *   cada 5 minutos   INCREMENTAL — sólo lo modificado desde la corrida anterior. 1 consulta, ~3 s.
 *   06:10 UTC        COMPLETO    — barre el maestro entero y reconcilia bajas. 6 consultas, ~29 s.
 *
 * Cuál corre lo decide la cabecera `x-vercel-cron-schedule`, que Vercel manda con la expresión que
 * disparó la invocación.
 *
 * El completo va a las 06:10 y no a las 06:00 para no solaparse con el del padrón de clientes: los
 * dos barren tableros grandes contra la misma cuenta de Monday, y correrlos juntos suma sus dos
 * consumos dentro de la misma ventana de rate limit sin que haga falta.
 *
 * ── Por qué no es un barrido completo cada 5 minutos ──
 * Medido sobre el tablero real: 1285 productos, 6 páginas, 29 s por barrido. Cada 5 minutos son
 * ~2,3 h/día de función para encontrar, casi siempre, cero cambios —una lista de precios se
 * actualiza por tanda, no continuamente—. Pedirle a Monday sólo lo modificado deja el mismo frescor
 * por ~3 s por corrida.
 *
 * ── Idempotencia ──
 * Vercel documenta que la entrega es "best effort": puede saltearse una corrida y puede repetir
 * otra. Todo acá es reconciliación, no incrementos: correrlo dos veces con los mismos datos deja
 * exactamente el mismo estado —`actualizado_en` ni se mueve si el contenido no cambió— y saltearse
 * una corrida se recupera sola en la siguiente, porque la marca de agua no avanzó.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mondayServidorConEspera } from '../_mondayApi.js'
import {
  BOARD_PRODUCTOS,
  CAMPOS_PRODUCTO,
  clasificarPagina,
  mapProductoCache,
  type ItemMonday,
  type ProductoCache,
} from '../_productos.js'
import {
  anularBajas,
  barrerNoVistos,
  cerrarCorrida,
  guardarProductos,
  leerEstado,
  soltarLock,
  tomarLock,
} from '../_productosDb.js'

/** La expresión del cron que pide el barrido completo. Tiene que coincidir con `vercel.json`. */
const CRON_COMPLETO = '10 6 * * *'

/**
 * Ítems por página.
 *
 * 250 y no 500 por el cupo POR MINUTO de `display_value`: el maestro tiene once columnas fórmula o
 * mirror (los ocho precios de lista, dos márgenes y el costo), así que cada ítem consume once de
 * ese cupo. Medido contra el tablero real: a 250 el barrido entero pasa en 6 páginas y 29 s; a 500
 * la primera página ya vuelve con `FIELD_MINUTE_RATE_LIMIT_EXCEEDED`.
 *
 * Igual no se confía sólo en el número: las consultas van por `mondayServidorConEspera`, que espera
 * y reintenta si el cupo se agotó por tráfico de la app en paralelo.
 */
const PAGINA = 250

/**
 * Solapamiento hacia atrás de la corrida incremental. Los relojes del servidor y de Monday no son
 * el mismo, y un ítem modificado en el segundo exacto del corte se perdería para siempre: la marca
 * ya habría avanzado por encima de él. Dos minutos de repetición cuestan nada —el upsert es
 * idempotente— y cierran ese agujero.
 */
const SOLAPE_MS = 2 * 60_000

/**
 * Tope de páginas de la incremental. Si se supera, es que pasó algo masivo (una actualización de
 * lista de precios, una importación) y sale más barato barrer entero que seguir paginando lo
 * modificado.
 */
const TOPE_PAGINAS_INCREMENTAL = 4

/**
 * Presupuesto de tiempo. `maxDuration` está en 300 s (`vercel.json`); se corta antes por las buenas
 * para poder cerrar la corrida y soltar el lock, en vez de que la función muera a mitad.
 *
 * El margen es amplio a propósito: el barrido limpio son 29 s, pero cada espera por el cupo de
 * `display_value` suma ~16 s, y con la app operando en paralelo puede tocar más de una.
 */
const PRESUPUESTO_MS = 260_000

interface PaginaItems {
  cursor: string | null
  items: ItemMonday[]
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  /* Falla CERRADA, igual que el cron del padrón: sin `CRON_SECRET` configurada nadie entra. Si el
     secreto faltante dejara pasar, esta ruta sería un barrido del maestro entero a pedido de
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
      productos: resultado.productos,
      duracionMs: Date.now() - arranque,
      error: null,
    })
    return responder(res, 200, { ...resultado, duracionMs: Date.now() - arranque })
  } catch (e) {
    const mensaje = (e as Error).message
    /* El error queda guardado —no sólo en el log— para que se pueda ver desde afuera que el
       catálogo dejó de actualizarse y por qué. La marca NO avanza: la próxima corrida reintenta el
       mismo tramo y no se saltea lo que no llegó a procesarse. */
    await cerrarCorrida({
      marca: null,
      completo: false,
      productos: 0,
      duracionMs: Date.now() - arranque,
      error: mensaje,
    }).catch(() => {})
    console.error('[cron productos]', mensaje)
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
  productos: number
  bajas: number
  paginas: number
  marca: string | null
}

/**
 * Barrido COMPLETO: el maestro entero.
 *
 * Al terminar da de baja lo que no se vio en esta vuelta. Es la única corrida que puede hacerlo,
 * porque es la única que ve el catálogo completo: la incremental sólo ve lo modificado y "no lo vi"
 * ahí no significa nada.
 */
async function barridoCompleto(inicio: Date, arranque: number): Promise<Resultado> {
  let cursor: string | null = null
  let paginas = 0
  let productos = 0
  let masNueva: string | null = null

  do {
    if (Date.now() - arranque > PRESUPUESTO_MS) {
      /* Cortado por tiempo: NO se barren los no vistos. Lo que no se alcanzó a recorrer figuraría
         como ausente y se daría de baja medio catálogo de un saque. */
      throw new Error(`barrido completo cortado por tiempo tras ${paginas} páginas`)
    }
    const pagina: PaginaItems = await traerPagina(cursor, true)
    const lote = pagina.items.map(mapProductoCache)
    if (lote.length > 0) {
      await guardarProductos(lote)
      await anularBajas(lote.map((p) => p.id))
    }
    masNueva = masReciente(masNueva, pagina.items)
    productos += lote.length
    cursor = pagina.cursor
    paginas++
  } while (cursor)

  const bajas = await barrerNoVistos(inicio)
  return { modo: 'completo', completo: true, productos, bajas, paginas, marca: masNueva }
}

/**
 * Barrido INCREMENTAL: lo modificado desde la marca, ordenado por fecha de modificación
 * descendente, cortando en cuanto se llega a lo ya procesado.
 *
 * No hay bajas acá, y no es un olvido: en el maestro un producto no "deja de estar", se elimina, y
 * un ítem eliminado no vuelve en ninguna consulta. Esa reconciliación es del barrido completo, que
 * es el único que ve todo el tablero (ver `barrerNoVistos`). Es la diferencia con el padrón de
 * clientes, donde la incremental SÍ da de baja al que pasó a INACTIVO.
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
  const entran: ProductoCache[] = []

  for (;;) {
    if (Date.now() - arranque > PRESUPUESTO_MS) {
      throw new Error(`barrido incremental cortado por tiempo tras ${paginas} páginas`)
    }
    if (paginas >= TOPE_PAGINAS_INCREMENTAL) {
      /* Se tocó medio maestro de una (una actualización de lista de precios, una importación): sale
         más barato barrer entero que seguir paginando lo modificado. Se escala ACÁ MISMO y no
         dejándoselo al cron del día siguiente: lo recogido hasta acá se descarta a propósito,
         porque el barrido completo lo vuelve a traer y además reconcilia las bajas.

         El tope es 4 y no 30 como en el padrón porque el catálogo entero son 6 páginas: pasadas 4,
         seguir con la incremental ya no ahorra nada. */
      console.warn(
        `[cron productos] la incremental superó ${TOPE_PAGINAS_INCREMENTAL} páginas: se escala a barrido completo`,
      )
      return barridoCompleto(inicio, arranque)
    }

    const pagina: PaginaItems = await traerPagina(cursor, false)
    paginas++

    const clasificada = clasificarPagina(pagina.items, corte, masNueva)
    masNueva = clasificada.masNueva
    entran.push(...clasificada.entran)

    if (clasificada.alcanzado || !pagina.cursor) break
    cursor = pagina.cursor
  }

  if (entran.length > 0) {
    await guardarProductos(entran)
    await anularBajas(entran.map((p) => p.id))
  }

  return {
    modo: 'incremental',
    completo: false,
    productos: entran.length,
    bajas: 0,
    paginas,
    marca: masNueva,
  }
}

/**
 * Una página del maestro. Con `todo`, el tablero en su orden natural; sin eso, ordenado por fecha
 * de modificación descendente, que es lo que le permite a la incremental cortar temprano.
 *
 * `next_items_page` conserva el orden de la consulta que abrió el cursor, así que las páginas
 * siguientes son iguales en los dos casos.
 */
async function traerPagina(cursor: string | null, todo: boolean): Promise<PaginaItems> {
  if (cursor) {
    const data = await mondayServidorConEspera<{ next_items_page: PaginaItems }>(
      `query { next_items_page(limit: ${PAGINA}, cursor: ${JSON.stringify(cursor)}) {
         cursor items { ${CAMPOS_PRODUCTO} }
       } }`,
      {},
    )
    return data.next_items_page
  }

  /* El barrido completo va sin `query_params`: no hay ningún producto que haya que excluir del
     catálogo, así que cualquier regla sería trabajo de más para el servidor de Monday. */
  const params = todo
    ? ''
    : `, query_params: {order_by: [{column_id: "__last_updated__", direction: desc}]}`

  const data = await mondayServidorConEspera<{ boards: { items_page: PaginaItems }[] }>(
    `query { boards(ids: [${BOARD_PRODUCTOS}]) {
       items_page(limit: ${PAGINA}${params}) {
         cursor items { ${CAMPOS_PRODUCTO} }
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
