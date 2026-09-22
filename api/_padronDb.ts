/**
 * El padrón de PERSONAS contra Postgres: lo que escribe el cron y lo que lee `/api/personas`.
 *
 * Esquema en `db/personas.sql`. Todo lo que toca la base vive acá para que el cron se ocupe sólo de
 * hablar con Monday y decidir qué entra, y el endpoint de lectura sólo de servir.
 */
import { consultar } from './_db.js'
import type { PersonaCache } from './_padron.js'

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
  personas: number
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
    `update personas_sync
        set corriendo_desde = now()
      where id = 1
        and (corriendo_desde is null or corriendo_desde < now() - interval '${LOCK_VENCIDO}')
      returning id`,
  )
  return filas.length > 0
}

/** Libera el lock. Va SIEMPRE en un `finally`: un lock que no se suelta frena todas las corridas. */
export async function soltarLock(): Promise<void> {
  await consultar(`update personas_sync set corriendo_desde = null where id = 1`)
}

export async function leerEstado(): Promise<EstadoSync> {
  const filas = await consultar<EstadoSync>(
    `select marca, ultimo_ok, ultimo_completo, personas, duracion_ms, error
       from personas_sync where id = 1`,
  )
  return (
    filas[0] ?? {
      marca: null,
      ultimo_ok: null,
      ultimo_completo: null,
      personas: 0,
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
  personas: number
  duracionMs: number
  error: string | null
}): Promise<void> {
  await consultar(
    `update personas_sync
        set marca           = case
                                when $1::timestamptz is null then marca
                                else greatest(coalesce(marca, $1::timestamptz), $1::timestamptz)
                              end,
            ultimo_ok       = case when $5::text is null then now() else ultimo_ok end,
            ultimo_completo = case when $2::boolean and $5::text is null
                                   then now() else ultimo_completo end,
            personas        = $3::int,
            duracion_ms     = $4::int,
            error           = $5::text
      where id = 1`,
    [datos.marca, datos.completo, datos.personas, datos.duracionMs, datos.error],
  )
}

/**
 * Mete o actualiza personas, de a lotes.
 *
 * El detalle que hace funcionar todo lo demás: `actualizado_en` **sólo se mueve si los datos
 * cambiaron de verdad** (`is distinct from`). Si se pisara en cada corrida, el barrido diario
 * marcaría las 3906 personas como nuevas y todos los navegadores se volverían a bajar el padrón
 * entero cada noche, que es justo lo que este caché viene a evitar. `visto_en`, en cambio, se pisa
 * siempre: es lo que le permite al barrido completo saber qué filas ya no están en el tablero.
 */
export async function guardarPersonas(personas: PersonaCache[]): Promise<void> {
  /* Sin ids repetidos. Postgres rechaza el statement entero —"ON CONFLICT DO UPDATE command cannot
     affect row a second time"— si el mismo `item_id` aparece dos veces en el mismo `insert`, y eso
     puede pasar: la incremental acumula varias páginas y el solapamiento de 2 minutos está puesto
     justamente para repetir ítems del borde. Gana la última versión vista. */
  const unicos = [...new Map(personas.map((p) => [p.id, p])).values()]

  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE)
    const valores: unknown[] = []
    const filas = lote.map((p, n) => {
      const b = n * 6
      valores.push(p.id, p.codigo, p.name, p.cuit, p.categorias, JSON.stringify(p))
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::text[], $${b + 6}::jsonb)`
    })
    await consultar(
      `insert into personas_cache (item_id, codigo, nombre, cuit, categorias, datos)
       values ${filas.join(', ')}
       on conflict (item_id) do update set
         codigo         = excluded.codigo,
         nombre         = excluded.nombre,
         cuit           = excluded.cuit,
         categorias     = excluded.categorias,
         datos          = excluded.datos,
         visto_en       = now(),
         actualizado_en = case
           when personas_cache.datos is distinct from excluded.datos then now()
           else personas_cache.actualizado_en
         end`,
      valores,
    )
  }
}

/**
 * Da de baja personas por id: las saca del padrón y las anota para que la baja pueda VIAJAR en el
 * delta. Sin ese registro, la persona desaparece del servidor pero sigue viva —y elegible— en el
 * navegador de quien ya se la había bajado.
 */
export async function darDeBaja(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const borradas = await consultar<{ item_id: string }>(
    `delete from personas_cache where item_id = any($1::text[]) returning item_id`,
    [ids],
  )
  if (borradas.length === 0) return 0
  await consultar(
    `insert into personas_bajas (item_id)
     select unnest($1::text[])
     on conflict (item_id) do update set baja_en = now()`,
    [borradas.map((b) => b.item_id)],
  )
  return borradas.length
}

/**
 * Cierre del barrido COMPLETO: lo que no se vio en esta vuelta ya no está en el tablero (se
 * eliminó, dejó de ser cliente y proveedor, o pasó a INACTIVA). `desde` es el instante en que
 * arrancó la corrida.
 */
export async function barrerNoVistos(desde: Date): Promise<number> {
  const perdidos = await consultar<{ item_id: string }>(
    `select item_id from personas_cache where visto_en < $1`,
    [desde],
  )
  return darDeBaja(perdidos.map((p) => p.item_id))
}

/**
 * Una persona que vuelve al padrón deja de estar dada de baja. Hace falta porque la baja es
 * permanente en la tabla: sin esto, una persona reactivada llegaría en el delta como alta Y como
 * baja a la vez, y el navegador que aplica primero el alta y después la baja la perdería.
 */
export async function anularBajas(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await consultar(`delete from personas_bajas where item_id = any($1::text[])`, [ids])
}

export interface Delta {
  /** Identidad del snapshot y cursor del próximo pedido: el `actualizado_en` más nuevo. */
  version: string | null
  personas: PersonaCache[]
  bajas: string[]
}

/**
 * Lo que el consumidor todavía no tiene, acotado a una categoría.
 *
 * `categoria` es lo que separa a los dos consumidores del padrón: la app de ventas pide
 * `'cliente'` y se baja 2681 registros; la otra app pide `'proveedor'` y se baja 1225. Se resuelve
 * en Postgres con el índice GIN sobre `categorias`, no filtrando en el navegador: sin eso, cada
 * app tendría que bajarse las 3906 personas para descartar la mitad.
 *
 * Sin `desde` devuelve el padrón entero de esa categoría. Con `desde`, sólo lo que cambió después
 * de esa marca más las bajas posteriores; en régimen eso son dos arreglos vacíos y el pedido se
 * resuelve en nada.
 */
export async function leerDelta(
  desde: string | null,
  categoria?: string | null,
): Promise<Delta> {
  /* La versión se lee ANTES que las filas, y las filas se acotan a ella. El orden importa: leída
     después, una escritura del cron colada entre las dos consultas quedaría fuera del delta pero
     dentro de la versión, y el consumidor no volvería a pedir esa fila NUNCA —`actualizado_en` no
     se mueve si los datos no cambian, así que ningún barrido posterior la rescata—. Leída antes, el
     peor caso es repetir una fila en el pedido siguiente, que es inofensivo.

     Se formatea en JS y no con `to_char`: el driver devuelve un `Date` y `toISOString()` da UTC sin
     ambigüedad, mientras que una máscara de `to_char` hay que leerla dos veces para saber si la
     "Z" que emite es de verdad UTC o un literal que quedó pegado. Lo que viaja al consumidor es la
     clave con la que después pide el delta: no es lugar para adivinar husos.

     La versión sale de TODA la tabla y no sólo de las filas del delta: con el delta vacío igual hay
     que poder devolver la versión vigente, o se pediría de nuevo desde la misma marca para siempre. */
  const marca = await consultar<{ version: Date | null }>(
    `select max(actualizado_en) as version from personas_cache`,
  )
  const version = marca[0]?.version ?? null

  /* Las condiciones se arman por partes para no terminar con cuatro variantes de la misma consulta
     escritas a mano. Los valores siguen viajando SIEMPRE por parámetros. */
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
  if (categoria) {
    params.push([categoria])
    condiciones.push(`categorias @> $${params.length}::text[]`)
  }
  const donde = condiciones.length ? `where ${condiciones.join(' and ')}` : ''

  const personas = await consultar<{ datos: PersonaCache }>(
    `select datos from personas_cache ${donde} order by nombre`,
    params,
  )

  /* Las bajas NO se filtran por categoría: la fila ya no está en `personas_cache`, así que no hay
     de dónde leerle la categoría. Mandar de más es inofensivo —el consumidor borra un id que no
     tiene— y filtrar de menos sería dejarle vivo un registro dado de baja. */
  const bajas = desde
    ? await consultar<{ item_id: string }>(
        `select item_id from personas_bajas where baja_en > $1::timestamptz`,
        [desde],
      )
    : []

  return {
    version: version?.toISOString() ?? null,
    personas: personas.map((p) => p.datos),
    bajas: bajas.map((b) => b.item_id),
  }
}
