/**
 * El padrón de clientes contra Postgres: lo que escribe el cron y lo que lee `/api/clientes`.
 *
 * Esquema en `db/clientes.sql`. Todo lo que toca la base vive acá para que el cron se ocupe sólo de
 * hablar con Monday y decidir qué entra, y el endpoint de lectura sólo de servir.
 */
import { consultar } from './_db.js'
import type { ClienteCache } from './_padron.js'

/** Cuántas filas entran en cada `insert` del upsert por lotes. */
const LOTE = 500

/**
 * Cuánto puede durar una corrida antes de que se la considere colgada y otra pueda tomar el lock.
 * Más que el techo de la función (120 s) y con margen: si una corrida murió por timeout, el lock
 * no puede quedar tomado hasta el fin de los tiempos.
 */
const LOCK_VENCIDO = '10 minutes'

export interface EstadoSync {
  marca: Date | null
  ultimo_ok: Date | null
  ultimo_completo: Date | null
  clientes: number
  duracion_ms: number | null
  error: string | null
}

/**
 * Toma el lock de corrida. `false` = hay otra corriendo y esta invocación se retira.
 *
 * Es un `update` condicional y no un `select` seguido de un `update`: entre esas dos sentencias
 * entran dos corridas a la vez. Acá el que pierde se entera porque no le vuelve ninguna fila.
 */
export async function tomarLock(): Promise<boolean> {
  const filas = await consultar<{ id: number }>(
    `update clientes_sync
        set corriendo_desde = now()
      where id = 1
        and (corriendo_desde is null or corriendo_desde < now() - interval '${LOCK_VENCIDO}')
      returning id`,
  )
  return filas.length > 0
}

/** Libera el lock. Va SIEMPRE en un `finally`: un lock que no se suelta frena todas las corridas. */
export async function soltarLock(): Promise<void> {
  await consultar(`update clientes_sync set corriendo_desde = null where id = 1`)
}

export async function leerEstado(): Promise<EstadoSync> {
  const filas = await consultar<EstadoSync>(
    `select marca, ultimo_ok, ultimo_completo, clientes, duracion_ms, error
       from clientes_sync where id = 1`,
  )
  return (
    filas[0] ?? {
      marca: null,
      ultimo_ok: null,
      ultimo_completo: null,
      clientes: 0,
      duracion_ms: null,
      error: null,
    }
  )
}

/**
 * Guarda el cierre de una corrida. `marca` es el `updated_at` más nuevo ya procesado: de ahí
 * arranca la incremental siguiente.
 *
 * La marca NUNCA retrocede (`greatest`), y no es una precaución teórica: el barrido completo sólo
 * mira personas OPERABLES, así que la fecha más nueva que ve puede ser anterior a la que dejó una
 * incremental —que mira el tablero entero, proveedores incluidos—. Sin el `greatest`, cada barrido
 * diario correría la marca para atrás y la incremental siguiente volvería a recorrer días de
 * modificaciones ya procesadas hasta chocar con el tope de páginas.
 */
export async function cerrarCorrida(datos: {
  marca: string | null
  completo: boolean
  clientes: number
  duracionMs: number
  error: string | null
}): Promise<void> {
  await consultar(
    `update clientes_sync
        set marca           = case
                                when $1::timestamptz is null then marca
                                else greatest(coalesce(marca, $1::timestamptz), $1::timestamptz)
                              end,
            ultimo_ok       = case when $5::text is null then now() else ultimo_ok end,
            ultimo_completo = case when $2::boolean and $5::text is null
                                   then now() else ultimo_completo end,
            clientes        = $3::int,
            duracion_ms     = $4::int,
            error           = $5::text
      where id = 1`,
    [datos.marca, datos.completo, datos.clientes, datos.duracionMs, datos.error],
  )
}

/**
 * Mete o actualiza clientes, de a lotes.
 *
 * El detalle que hace funcionar todo lo demás: `actualizado_en` **sólo se mueve si los datos
 * cambiaron de verdad** (`is distinct from`). Si se pisara en cada corrida, el barrido diario
 * marcaría los 2681 clientes como nuevos y todos los navegadores se volverían a bajar el padrón
 * entero cada noche, que es justo lo que este caché viene a evitar. `visto_en`, en cambio, se pisa
 * siempre: es lo que le permite al barrido completo saber qué filas ya no están en el tablero.
 */
export async function guardarClientes(clientes: ClienteCache[]): Promise<void> {
  /* Sin ids repetidos. Postgres rechaza el statement entero —"ON CONFLICT DO UPDATE command cannot
     affect row a second time"— si el mismo `item_id` aparece dos veces en el mismo `insert`, y eso
     puede pasar: la incremental acumula varias páginas y el solapamiento de 2 minutos está puesto
     justamente para repetir ítems del borde. Gana la última versión vista. */
  const unicos = [...new Map(clientes.map((c) => [c.id, c])).values()]

  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE)
    const valores: unknown[] = []
    const filas = lote.map((c, n) => {
      const b = n * 5
      valores.push(c.id, c.codigo, c.name, c.cuit, JSON.stringify(c))
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb)`
    })
    await consultar(
      `insert into clientes_cache (item_id, codigo, nombre, cuit, datos)
       values ${filas.join(', ')}
       on conflict (item_id) do update set
         codigo         = excluded.codigo,
         nombre         = excluded.nombre,
         cuit           = excluded.cuit,
         datos          = excluded.datos,
         visto_en       = now(),
         actualizado_en = case
           when clientes_cache.datos is distinct from excluded.datos then now()
           else clientes_cache.actualizado_en
         end`,
      valores,
    )
  }
}

/**
 * Da de baja clientes por id: los saca del padrón y los anota para que la baja pueda VIAJAR en el
 * delta. Sin ese registro, el cliente desaparece del servidor pero sigue vivo —y elegible— en el
 * navegador de quien ya se lo había bajado.
 */
export async function darDeBaja(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const borradas = await consultar<{ item_id: string }>(
    `delete from clientes_cache where item_id = any($1::text[]) returning item_id`,
    [ids],
  )
  if (borradas.length === 0) return 0
  await consultar(
    `insert into clientes_bajas (item_id)
     select unnest($1::text[])
     on conflict (item_id) do update set baja_en = now()`,
    [borradas.map((b) => b.item_id)],
  )
  return borradas.length
}

/**
 * Cierre del barrido COMPLETO: lo que no se vio en esta vuelta ya no está en el tablero (se
 * eliminó, dejó de ser categoría "Clientes" o pasó a INACTIVO). `desde` es el instante en que
 * arrancó la corrida.
 */
export async function barrerNoVistos(desde: Date): Promise<number> {
  const perdidos = await consultar<{ item_id: string }>(
    `select item_id from clientes_cache where visto_en < $1`,
    [desde],
  )
  return darDeBaja(perdidos.map((p) => p.item_id))
}

/**
 * Un cliente que vuelve al padrón deja de estar dado de baja. Hace falta porque la baja es
 * permanente en la tabla: sin esto, un cliente reactivado llegaría en el delta como alta Y como
 * baja a la vez, y el navegador que aplica primero el alta y después la baja lo perdería.
 */
export async function anularBajas(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await consultar(`delete from clientes_bajas where item_id = any($1::text[])`, [ids])
}

export interface Delta {
  /** Identidad del snapshot y cursor del próximo pedido: el `actualizado_en` más nuevo. */
  version: string | null
  clientes: ClienteCache[]
  bajas: string[]
}

/**
 * Lo que el navegador todavía no tiene.
 *
 * Sin `desde` devuelve el padrón entero (medido: 884 KB crudos, 81 KB gzip). Con `desde`, sólo lo
 * que cambió después de esa marca más las bajas posteriores; en régimen eso son dos arreglos
 * vacíos y el pedido se resuelve en nada.
 */
export async function leerDelta(desde: string | null): Promise<Delta> {
  const clientes = await consultar<{ datos: ClienteCache }>(
    desde
      ? `select datos from clientes_cache where actualizado_en > $1::timestamptz order by nombre`
      : `select datos from clientes_cache order by nombre`,
    desde ? [desde] : [],
  )

  /* La versión sale de TODA la tabla, no de las filas del delta: con el delta vacío igual hay que
     poder devolver la versión vigente, o el navegador pediría de nuevo desde la misma marca para
     siempre.

     Se formatea en JS y no con `to_char`: el driver devuelve un `Date` y `toISOString()` da UTC sin
     ambigüedad, mientras que una máscara de `to_char` hay que leerla dos veces para saber si la
     "Z" que emite es de verdad UTC o un literal que quedó pegado. Lo que viaja al navegador es la
     clave con la que después pide el delta: no es lugar para adivinar husos. */
  const marca = await consultar<{ version: Date | null }>(
    `select max(actualizado_en) as version from clientes_cache`,
  )

  const bajas = desde
    ? await consultar<{ item_id: string }>(
        `select item_id from clientes_bajas where baja_en > $1::timestamptz`,
        [desde],
      )
    : []

  return {
    version: marca[0]?.version?.toISOString() ?? null,
    clientes: clientes.map((c) => c.datos),
    bajas: bajas.map((b) => b.item_id),
  }
}
