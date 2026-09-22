/**
 * `POST /api/personas` — el padrón cacheado, para que las apps puedan buscar sin consultar Monday.
 *
 * Lo que devuelve sale de la base (la llena el Cron Job, ver `api/cron/personas.ts`), no de Monday:
 * este endpoint no consulta el tablero ni una vez. Es todo el punto del caché — la búsqueda del
 * cliente deja de costar una vuelta de paginación por cada intento de escritura.
 *
 * ── Dos consumidores, una sola base ──
 * El padrón guarda clientes Y proveedores. `categoria` decide cuál de los dos se lleva cada uno:
 * la app de ventas pide `'cliente'` (2681 registros) y otra app pide `'proveedor'` (1225). El
 * filtro se resuelve en Postgres con el índice GIN; sin él, cada app se bajaría las 3906 personas
 * para descartar la mitad en memoria.
 *
 * ── El delta ──
 * El consumidor manda la `version` que ya tiene y recibe sólo lo que cambió desde entonces. El
 * padrón de clientes son ~81 KB comprimidos; el delta, en régimen, son dos arreglos vacíos. Sin
 * esto, cada recarga de la app se bajaría todo de nuevo para enterarse de que no cambió nada.
 *
 * Detrás de las tres capas de siempre (`endpointDatos`: firma del session token + lista blanca +
 * segundo factor). El padrón es la cartera de clientes entera con sus límites de crédito y sus
 * saldos: no es un catálogo público.
 */
import type { ServerResponse } from 'node:http'
import { endpointDatos, type Pedido } from './_http.js'
import { leerDelta, leerEstado } from './_padronDb.js'

/** Las categorías que se pueden pedir. Cualquier otra cosa se ignora y se devuelve el padrón entero. */
const CATEGORIAS = ['cliente', 'proveedor'] as const

interface Cuerpo {
  /** La versión que el consumidor ya tiene. Sin ella se devuelve el padrón completo. */
  desde?: string
  /** `'cliente'` | `'proveedor'`. Sin esto vienen las dos. */
  categoria?: string
}

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  await endpointDatos<Cuerpo>(req, res, async ({ cuerpo }) => {
    /* Sólo se acepta una fecha válida. Un `desde` basura no puede hacer que la consulta devuelva
       vacío y el consumidor concluya que el padrón no tiene a nadie: ante la duda, todo. */
    const desde = fechaValida(cuerpo?.desde)
    const categoria = categoriaValida(cuerpo?.categoria)
    const [delta, estado] = await Promise.all([leerDelta(desde, categoria), leerEstado()])

    return {
      version: delta.version,
      categoria,
      /* `completo` le dice al consumidor si lo que recibe REEMPLAZA su padrón o se le suma. Sin
         este dato, un delta vacío sería indistinguible de un padrón vacío. */
      completo: desde === null,
      personas: delta.personas,
      bajas: delta.bajas,
      /* Cuándo se sincronizó por última vez y si la última corrida falló. La app lo usa para poder
         decir "el padrón está viejo" en vez de mostrar resultados incompletos como si fueran
         todos los que hay. */
      sincronizado: estado.ultimo_ok,
      error: estado.error,
    }
  })
}

function fechaValida(valor: string | undefined): string | null {
  if (typeof valor !== 'string' || !valor.trim()) return null
  return Number.isFinite(Date.parse(valor)) ? valor : null
}

/**
 * La categoría pedida, o `null` para no filtrar.
 *
 * Se valida contra una lista cerrada y no se pasa lo que venga: el valor termina en una condición
 * SQL, y aunque viaje por parámetro, aceptar cualquier texto significa que un typo
 * (`"clientes"` en plural) devolvería CERO personas en silencio y el buscador se vería vacío sin
 * que nada diga por qué.
 */
function categoriaValida(valor: string | undefined): string | null {
  const v = valor?.trim().toLowerCase()
  return CATEGORIAS.find((c) => c === v) ?? null
}
