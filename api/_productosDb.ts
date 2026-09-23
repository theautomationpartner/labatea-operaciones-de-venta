/**
 * El catálogo de productos contra Postgres: lo que escribe el cron y lo que lee `/api/productos`.
 *
 * Esquema en `db/productos.sql`. Todo lo que toca la base vive acá para que el cron se ocupe sólo
 * de hablar con Monday y decidir qué entra, y el endpoint de lectura sólo de servir.
 *
 * Es el gemelo de `_padronDb.ts`. Se mantienen separados —y no se factoriza un módulo genérico—
 * porque las dos tablas divergen donde importa: el padrón tiene bajas por dejar de ser operable
 * (un cliente que pasa a INACTIVO), y el catálogo sólo las tiene por eliminación del tablero.
 * Un helper con un booleano para esa diferencia esconde justo lo que hay que poder leer de un
 * vistazo cuando algo no se sincroniza.
 */
import { VERSION_CACHE, consultar } from './_db.js'
import type { ProductoCache } from './_productos.js'

/** Cuántas filas entran en cada `insert` del upsert por lotes. */
const LOTE = 500

/**
 * Cuánto puede durar una corrida antes de que se la considere colgada y otra pueda tomar el lock.
 * Más que el techo de la función (300 s, ver `vercel.json`) y con margen: si una corrida murió por
 * timeout, el lock no puede quedar tomado hasta el fin de los tiempos.
 */
const LOCK_VENCIDO = '15 minutes'

export interface EstadoSync {
  marca: Date | null
  ultimo_ok: Date | null
  ultimo_completo: Date | null
  productos: number
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
    `update productos_sync
        set corriendo_desde = now()
      where id = 1
        and (corriendo_desde is null or corriendo_desde < now() - interval '${LOCK_VENCIDO}')
      returning id`,
  )
  return filas.length > 0
}

/** Libera el lock. Va SIEMPRE en un `finally`: un lock que no se suelta frena todas las corridas. */
export async function soltarLock(): Promise<void> {
  await consultar(`update productos_sync set corriendo_desde = null where id = 1`)
}

export async function leerEstado(): Promise<EstadoSync> {
  const filas = await consultar<EstadoSync>(
    `select marca, ultimo_ok, ultimo_completo, productos, duracion_ms, error
       from productos_sync where id = 1`,
  )
  return (
    filas[0] ?? {
      marca: null,
      ultimo_ok: null,
      ultimo_completo: null,
      productos: 0,
      duracion_ms: null,
      error: null,
    }
  )
}

/**
 * Guarda el cierre de una corrida. `marca` es el `updated_at` más nuevo ya procesado: de ahí
 * arranca la incremental siguiente.
 */
export async function cerrarCorrida(datos: {
  marca: string | null
  completo: boolean
  productos: number
  duracionMs: number
  error: string | null
}): Promise<void> {
  await consultar(
    `update productos_sync
        set marca           = coalesce($1::timestamptz, marca),
            ultimo_ok       = case when $5::text is null then now() else ultimo_ok end,
            ultimo_completo = case when $2::boolean and $5::text is null
                                   then now() else ultimo_completo end,
            productos       = $3::int,
            duracion_ms     = $4::int,
            error           = $5::text
      where id = 1`,
    [datos.marca, datos.completo, datos.productos, datos.duracionMs, datos.error],
  )
}

/**
 * Mete o actualiza productos, de a lotes.
 *
 * El detalle que hace funcionar todo lo demás: `actualizado_en` **sólo se mueve si los datos
 * cambiaron de verdad** (`is distinct from`). Si se pisara en cada corrida, el barrido diario
 * marcaría los 1285 productos como nuevos y todos los navegadores se volverían a bajar el catálogo
 * entero cada noche, que es justo lo que este caché viene a evitar. `visto_en`, en cambio, se pisa
 * siempre: es lo que le permite al barrido completo saber qué filas ya no están en el tablero.
 */
export async function guardarProductos(productos: ProductoCache[]): Promise<void> {
  for (let i = 0; i < productos.length; i += LOTE) {
    const lote = productos.slice(i, i + LOTE)
    const valores: unknown[] = []
    const filas = lote.map((p, n) => {
      const b = n * 7
      valores.push(p.id, p.codigo, p.nombre, p.rubro, p.subrubro, p.categoria, JSON.stringify(p))
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::jsonb)`
    })
    await consultar(
      `insert into productos_cache (item_id, codigo, nombre, rubro, subrubro, categoria, datos)
       values ${filas.join(', ')}
       on conflict (item_id) do update set
         codigo         = excluded.codigo,
         nombre         = excluded.nombre,
         rubro          = excluded.rubro,
         subrubro       = excluded.subrubro,
         categoria      = excluded.categoria,
         datos          = excluded.datos,
         visto_en       = now(),
         actualizado_en = case
           when productos_cache.datos is distinct from excluded.datos then now()
           else productos_cache.actualizado_en
         end`,
      valores,
    )
  }
}

/**
 * Da de baja productos por id: los saca del catálogo y los anota para que la baja pueda VIAJAR en
 * el delta. Sin ese registro, el producto desaparece del servidor pero sigue vivo —y cargable— en
 * el navegador de quien ya se lo había bajado.
 */
export async function darDeBaja(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const borradas = await consultar<{ item_id: string }>(
    `delete from productos_cache where item_id = any($1::text[]) returning item_id`,
    [ids],
  )
  if (borradas.length === 0) return 0
  await consultar(
    `insert into productos_bajas (item_id)
     select unnest($1::text[])
     on conflict (item_id) do update set baja_en = now()`,
    [borradas.map((b) => b.item_id)],
  )
  return borradas.length
}

/**
 * Cierre del barrido COMPLETO: lo que no se vio en esta vuelta ya no está en el tablero. `desde` es
 * el instante en que arrancó la corrida.
 */
export async function barrerNoVistos(desde: Date): Promise<number> {
  const perdidos = await consultar<{ item_id: string }>(
    `select item_id from productos_cache where visto_en < $1`,
    [desde],
  )
  return darDeBaja(perdidos.map((p) => p.item_id))
}

/**
 * Un producto que vuelve al catálogo deja de estar dado de baja. Hace falta porque la baja es
 * permanente en la tabla: sin esto, un producto recreado llegaría en el delta como alta Y como baja
 * a la vez, y el navegador que aplica primero el alta y después la baja lo perdería.
 */
export async function anularBajas(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await consultar(`delete from productos_bajas where item_id = any($1::text[])`, [ids])
}

export interface Delta {
  /** Identidad del snapshot y cursor del próximo pedido: el `actualizado_en` más nuevo. */
  version: string | null
  productos: ProductoCache[]
  bajas: string[]
}

/**
 * Lo que el navegador todavía no tiene.
 *
 * Sin `desde` devuelve el catálogo entero (medido: 612 KB crudos, 102 KB gzip). Con `desde`, sólo
 * lo que cambió después de esa marca más las bajas posteriores; en régimen eso son dos arreglos
 * vacíos y el pedido se resuelve en nada.
 */
export async function leerDelta(desde: string | null): Promise<Delta> {
  /* La versión se lee ANTES que las filas, y las filas se acotan a ella. El orden importa: leída
     después, una escritura del cron colada entre las dos consultas quedaría fuera del delta pero
     dentro de la versión, y el navegador no volvería a pedir esa fila NUNCA —`actualizado_en` no se
     mueve si los datos no cambian, así que ningún barrido posterior la rescata—. Leída antes, el
     peor caso es repetir una fila en el pedido siguiente, que es inofensivo.

     Sale como TEXTO y con la precisión completa (ver `VERSION_CACHE`): leerla como `Date` pierde
     los microsegundos y deja al producto más nuevo afuera de su propia versión.

     La versión sale de TODA la tabla y no sólo de las filas del delta: con el delta vacío igual hay
     que poder devolver la versión vigente, o se pediría de nuevo desde la misma marca para siempre. */
  const marca = await consultar<{ version: string | null }>(
    `select ${VERSION_CACHE} as version from productos_cache`,
  )
  const version = marca[0]?.version ?? null

  const condiciones: string[] = []
  const params: unknown[] = []
  if (desde) {
    params.push(desde)
    condiciones.push(`actualizado_en > $${params.length}::timestamptz`)
  }
  if (version) {
    params.push(version)
    condiciones.push(`actualizado_en <= $${params.length}::timestamptz`)
  }
  const donde = condiciones.length ? `where ${condiciones.join(' and ')}` : ''

  const productos = await consultar<{ datos: ProductoCache }>(
    `select datos from productos_cache ${donde} order by nombre`,
    params,
  )

  const bajas = desde
    ? await consultar<{ item_id: string }>(
        `select item_id from productos_bajas where baja_en > $1::timestamptz`,
        [desde],
      )
    : []

  return {
    version,
    productos: productos.map((p) => p.datos),
    bajas: bajas.map((b) => b.item_id),
  }
}
