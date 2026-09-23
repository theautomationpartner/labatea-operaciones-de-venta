/**
 * El catálogo de productos en el navegador: se baja una vez, se revalida por delta y lo consume el
 * buscador para resolver la búsqueda en local.
 *
 * El servidor lo mantiene con un Vercel Cron Job (`api/cron/productos.ts`) y lo entrega por
 * `/api/productos`. Acá no se le pregunta nada a Monday para BUSCAR: ese es el punto del caché.
 *
 * ── Cómo se revalida ──
 * Se guarda la `version` que devolvió el servidor y en cada revalidación se la manda de vuelta; lo
 * que llega es sólo lo que cambió desde entonces —altas y modificaciones en `productos`, bajas en
 * `bajas`—. En régimen eso son dos arreglos vacíos. Sin el delta, cada recarga se bajaría los
 * 102 KB del catálogo entero para enterarse de que no cambió nada.
 *
 * ── Lo único que SÍ se le pregunta a Monday: el stock ──
 * El caché no trae cantidades (ver `api/_productos.ts`). Al ELEGIR un producto, `conStockFresco`
 * lee su ítem de "🧮Stock y Movimientos" contra Monday. Es una consulta por selección —no por
 * tecla—, y es lo que permite que el panel de stock nunca muestre un disponible que ya se vendió.
 *
 * ── Dónde vive ──
 * En memoria mientras la pestaña está viva, y espejado en `sessionStorage` para que recargar no
 * cueste la bajada completa. En `sessionStorage` y no en `localStorage` a propósito: son los costos
 * y los ocho precios de lista de toda la mercadería, y no tienen por qué sobrevivir a la sesión en
 * el disco de la máquina.
 */
import { PRODUCTOS } from '@/data/mock'
import { indexarCatalogo, type EntradaCatalogo } from '@/lib/busquedaProductos'
import { precioConIva, precioListaSinRedondear } from '@/lib/precios'
import { round2 } from '@/lib/format'
import type { ListaPrecio, Producto, ProductoCache, StockProducto } from '@/types'
import { COL } from './columns'
import { byId, numCol, sumaMirror, type MondayItem } from './parse'
import { cabecerasPropias, mondayApi, mondayHabilitado, verificarRespuesta } from './sdk'

const CLAVE_SESION = 'catalogo-productos-v1'

/** Cada cuánto se vuelve a preguntar por novedades. El cron corre cada 5 minutos; esto lo sigue. */
const REVALIDAR_CADA_MS = 5 * 60_000

interface RespuestaCatalogo {
  version: string | null
  completo: boolean
  productos: ProductoCache[]
  bajas: string[]
  sincronizado: string | null
  error: string | null
}

export interface Catalogo {
  /** Ya normalizado para buscar. Es lo que consume `buscarEnCatalogo`. */
  entradas: EntradaCatalogo[]
  /** Cuándo corrió por última vez —con éxito— la sincronización del servidor. */
  sincronizado: string | null
  /** El servidor no pudo actualizar el catálogo. La vista lo dice; no lo esconde. */
  error: string | null
}

/** Estado del módulo. Uno solo por pestaña: el catálogo es el mismo para toda la app. */
let porId = new Map<string, ProductoCache>()
let version: string | null = null
let sincronizado: string | null = null
let errorServidor: string | null = null
let indice: EntradaCatalogo[] | null = null
let ultimaRevalidacion = 0
let enCurso: Promise<Catalogo> | null = null

/** El índice se rearma sólo cuando el catálogo cambió; en cada tecla se reusa el de antes. */
function catalogoActual(): Catalogo {
  indice ??= indexarCatalogo([...porId.values()])
  return { entradas: indice, sincronizado, error: errorServidor }
}

function invalidarIndice(): void {
  indice = null
}

/**
 * El catálogo listo para buscar.
 *
 * La primera llamada lo baja; las siguientes devuelven lo que ya está y revalidan por detrás si
 * pasó el intervalo. Nunca hace esperar dos veces por lo mismo: las llamadas concurrentes comparten
 * la promesa en curso.
 */
export function getCatalogo(): Promise<Catalogo> {
  if (porId.size > 0) {
    if (Date.now() - ultimaRevalidacion > REVALIDAR_CADA_MS) void revalidarCatalogo()
    return Promise.resolve(catalogoActual())
  }
  enCurso ??= cargar().finally(() => {
    enCurso = null
  })
  return enCurso
}

/**
 * Fuerza una revalidación y espera el resultado. Lo usa la vista al entrar al paso de productos: es
 * el momento en que el frescor importa y en que la espera no molesta.
 */
export async function revalidarCatalogo(): Promise<Catalogo> {
  try {
    await pedir(version)
  } catch (e) {
    /* Un fallo al revalidar NO vacía lo que ya está: es mejor buscar sobre un catálogo de hace
       cinco minutos que quedarse sin buscador. Queda anotado para que la vista lo pueda decir. */
    console.warn('[catálogo] no se pudo revalidar:', (e as Error).message)
  }
  return catalogoActual()
}

async function cargar(): Promise<Catalogo> {
  /* En desarrollo no hay funciones serverless —`/api/*` no existe— y sin token tampoco hay a quién
     preguntarle. En los dos casos el buscador trabaja sobre el mock, que es chico y alcanza para
     probar la pantalla. */
  if (import.meta.env.DEV || !mondayHabilitado()) {
    porId = new Map(PRODUCTOS.map((p) => [p.id ?? p.codigo, cacheDesdeMock(p)]))
    invalidarIndice()
    return catalogoActual()
  }

  desdeSesion()
  try {
    await pedir(version)
  } catch (e) {
    /* Sin catálogo, el live search no funciona pero el botón Buscar sí: la app queda como estaba
       antes de este caché, no rota. Por eso esto no propaga el error. */
    console.warn('[catálogo] no se pudo cargar:', (e as Error).message)
    errorServidor = (e as Error).message
  }
  return catalogoActual()
}

/** Pide al servidor lo que falte desde `desde` y lo aplica. */
async function pedir(desde: string | null): Promise<void> {
  const res = await fetch('/api/productos', {
    method: 'POST',
    headers: await cabecerasPropias({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ desde }),
  })
  /* Misma lectura del rechazo que el resto de los pedidos: un 401 o un 403 acá tienen que levantar
     la ventana de seguridad igual que en cualquier otra consulta. */
  await verificarRespuesta(res, 'Catálogo de productos')
  aplicar((await res.json()) as RespuestaCatalogo)
}

function aplicar(data: RespuestaCatalogo): void {
  /* `completo` marca si lo que llegó REEMPLAZA el catálogo o se le suma. Sin ese dato, un delta
     vacío sería indistinguible de un catálogo vacío y el buscador se quedaría sin nada. */
  if (data.completo) porId = new Map()
  for (const producto of data.productos) porId.set(producto.id, producto)
  /* Las bajas se aplican DESPUÉS de las altas: un producto que se dio de baja y volvió llega en las
     dos listas, y lo que vale es que está de vuelta. El servidor lo desanota al recrearlo, así que
     esto es un cinturón además de los tirantes. */
  for (const id of data.bajas) if (!data.productos.some((p) => p.id === id)) porId.delete(id)

  version = data.version
  sincronizado = data.sincronizado
  errorServidor = data.error
  ultimaRevalidacion = Date.now()
  invalidarIndice()
  guardarEnSesion()
}

/* ── Por qué NO hay un `recordarProductos` ──────────────────────────────────────────────────────
 *
 * El padrón de clientes tiene su `recordarClientes`: el cliente que aparece por el botón Buscar se
 * suma al caché en memoria para que el live search lo conozca enseguida. Acá ese atajo sería un
 * error de precio.
 *
 * Un `Cliente` es el mismo para toda la app. Un `Producto` ya viene resuelto para UNA lista: la
 * búsqueda directa pide una sola columna de precio, la del cliente de esa operación. Guardarlo en
 * el caché obligaría a inventar las otras siete —replicando la que se trajo—, y la próxima
 * operación, con un cliente de otra lista, se llevaría ese precio inventado a un presupuesto.
 *
 * Así que el producto recién creado no entra al live search hasta que lo traiga el cron, como mucho
 * cinco minutos después. Mientras tanto se lo encuentra igual: los resultados del botón Buscar
 * quedan en pantalla y se vuelven a listar al hacer click en el campo. */

/* ── De `ProductoCache` al `Producto` que consume la app ────────────────────────────────────── */

/**
 * Materializa el producto para la lista de precio de ESTE cliente.
 *
 * Réplica exacta de la parte no-stock de `mapProducto` (`services/monday/presupuestar.ts`),
 * incluido el redondeo; lo verifica `npm run test:productos-columnas`, que corre los dos caminos
 * sobre el mismo ítem y exige el mismo `Producto`.
 *
 * Las siete cantidades de stock quedan en CERO y eso no es un valor: es un marcador de "todavía no
 * se leyó". Nadie tiene que ver este producto antes de que `conStockFresco` lo complete, y por eso
 * el buscador no llama a `onSelect` hasta tenerlo (ver `BuscadorProducto`).
 */
export function productoDesdeCache(
  pc: ProductoCache,
  lista: ListaPrecio,
  conIva: boolean,
): Producto {
  const precioLista = pc.precios[lista] ?? 0
  return {
    id: pc.id,
    codigo: pc.codigo,
    nombre: pc.nombre,
    precio: precioConIva(precioLista, pc.iva, conIva),
    precioBase: precioListaSinRedondear(precioLista, pc.iva, conIva),
    precioSinIva: round2(precioLista),
    /* El "Margen" sólo existe para L1..L3 en el board; para el resto no hay dato y va 0, igual que
       en la búsqueda directa (`margenCol ? numCol(...) : 0`). */
    rentabilidad: pc.margenes[lista] ?? 0,
    precioCosto: pc.precioCosto,
    provCod: pc.provCod,
    provNombre: pc.provNombre,
    provId: pc.provId,
    tipo: pc.tipo,
    moneda: pc.moneda,
    iva: pc.iva,
    comisionable: pc.comisionable,
    conRentabForzada: pc.conRentabForzada,
    rubro: pc.rubro,
    subrubro: pc.subrubro,
    categoria: pc.categoria,
    um: pc.um,
    peso: pc.peso,
    ingresos: 0,
    egresos: 0,
    pendEntregaVta: 0,
    pendRecepcionCompra: 0,
    fisico: 0,
    comercial: 0,
    disponible: 0,
    stockId: pc.stockId,
  }
}

/* ── El stock, que nunca se cachea ──────────────────────────────────────────────────────────── */

/**
 * Columnas del ítem de "🧮Stock y Movimientos". Mismas que usa la búsqueda directa.
 *
 * ── Los movimientos se piden sólo en la devolución ──
 * "Ingreso Total" y "Egreso Total" son MIRRORS, y evaluarlas le cuesta a Monday ~700 ms fijos.
 * Medido sobre 15 ítems, mediana de 5 corridas:
 *
 *   piso de red (sin columnas) .............  597 ms
 *   las 5 `number`/fórmula de siempre ....... 1390 ms
 *   las 7, con las dos mirrors .............. 2059 ms
 *
 * Presupuesto, venta y remito de entrega no usan esas dos cantidades: el panel de stock sólo las
 * muestra en modo ingreso, y `stockConIngreso` es la única función que las lee. Pedirlas ahí serían
 * 700 ms regalados en la etapa más tipeada de la app.
 */
const columnasStock = (conMovimientos: boolean): string =>
  JSON.stringify([
    COL.stockItem.pendEntregaVta,
    COL.stockItem.pendRecepcionCompra,
    COL.stockItem.fisico,
    COL.stockItem.comercial,
    COL.stockItem.disponible,
    ...(conMovimientos ? [COL.stockItem.ingresos, COL.stockItem.egresos] : []),
  ])

const SIN_STOCK: StockProducto = {
  ingresos: 0,
  egresos: 0,
  pendEntregaVta: 0,
  pendRecepcionCompra: 0,
  fisico: 0,
  comercial: 0,
  disponible: 0,
}

/**
 * Lee el stock de varios ítems de una. Se pide en lote porque a la API le cuesta lo mismo: medido,
 * un ítem tarda ~1,7 s y seis tardan ~1,9 s —la latencia se la lleva evaluar las fórmulas, no
 * contar ítems—.
 *
 * OJO con los fragmentos: el ítem de stock mezcla FÓRMULAS (los tres saldos) y MIRRORS (Ingreso y
 * Egreso Total, que espejan los subelementos de movimiento). Cada tipo necesita el suyo; el que
 * falte vuelve en cero sin avisar.
 */
export async function leerStock(
  stockIds: readonly string[],
  conMovimientos = false,
): Promise<Map<string, StockProducto>> {
  const ids = [...new Set(stockIds.filter(Boolean))]
  if (ids.length === 0) return new Map()

  const data = await mondayApi<{ items: MondayItem[] }>(
    `query ($ids: [ID!]!) {
      items(ids: $ids) {
        id
        column_values(ids: ${columnasStock(conMovimientos)}) {
          id text
          ... on FormulaValue { display_value }
          ... on MirrorValue { display_value }
        }
      }
    }`,
    { ids },
  )

  const porStock = new Map<string, StockProducto>()
  for (const item of data.items ?? []) {
    const s = byId(item)
    porStock.set(item.id, {
      /* Ingresos y egresos son MIRRORS de los subelementos de movimiento: su `display_value` puede
         venir como lista separada por comas, así que hay que sumarla y no pasarla por `num()`.
         Sin `conMovimientos` no se pidieron y quedan en 0; sólo la devolución las lee. */
      ingresos: sumaMirror(s[COL.stockItem.ingresos]),
      egresos: sumaMirror(s[COL.stockItem.egresos]),
      pendEntregaVta: numCol(s[COL.stockItem.pendEntregaVta]),
      pendRecepcionCompra: numCol(s[COL.stockItem.pendRecepcionCompra]),
      fisico: numCol(s[COL.stockItem.fisico]),
      comercial: numCol(s[COL.stockItem.comercial]),
      disponible: numCol(s[COL.stockItem.disponible]),
    })
  }
  return porStock
}

/**
 * El producto con su stock recién leído de Monday. Es el último paso antes de entregarlo a la
 * vista: un producto que salió del caché NO se muestra sin pasar por acá.
 *
 * Un producto sin `stockId` —el maestro tiene alguno— queda en cero, que es lo que ya devolvía la
 * búsqueda directa para ese mismo caso. Lo que no puede pasar es que un producto QUE SÍ tiene ítem
 * de stock se muestre en cero porque la lectura falló: eso se propaga y lo maneja quien llama.
 *
 * `conMovimientos` lo pide sólo la devolución, que es la única pantalla que muestra "Ingresos" y la
 * única que proyecta con `stockConIngreso`. Sin él, `ingresos` y `egresos` vuelven en 0 porque NO SE
 * PIDIERON —no porque valgan cero—, y ahorran ~700 ms. Nadie más los lee; si alguna vista nueva los
 * necesitara, tiene que pedir el stock con esta bandera, no asumir que el 0 es un dato.
 */
export async function conStockFresco(
  producto: Producto,
  conMovimientos = false,
): Promise<Producto> {
  if (!producto.stockId) return producto
  /* En modo local el stock sale del propio mock: no hay Monday a quien preguntarle, y devolverlo en
     cero dejaría el panel de stock inservible para desarrollar. */
  if (import.meta.env.DEV || !mondayHabilitado()) {
    return { ...producto, ...(stockMock.get(producto.stockId) ?? SIN_STOCK) }
  }
  const stock = await leerStock([producto.stockId], conMovimientos)
  return { ...producto, ...(stock.get(producto.stockId) ?? SIN_STOCK) }
}

/* ── El catálogo de ejemplo (modo local, sin token) ─────────────────────────────────────────── */

/**
 * Stock de los productos del mock, por id.
 *
 * Existe porque `ProductoCache` no tiene cantidades y en modo local no hay Monday a quien pedirlas.
 * Sin esto, el panel de stock mostraría cero para todo mientras se desarrolla, que es justo el
 * estado que hace imposible probar la pantalla.
 */
const stockMock = new Map<string, StockProducto>()

/** Un `Producto` del mock con la forma del caché. El precio del mock es el de la lista L1. */
function cacheDesdeMock(p: Producto): ProductoCache {
  const id = p.id ?? p.codigo
  const precio = p.precioSinIva ?? p.precio
  /* El mapa va indexado por el MISMO valor que después queda en `stockId`, no por el id del
     producto: `conStockFresco` busca por `stockId`, y en el mock los dos pueden no coincidir. */
  const stockId = p.stockId ?? id
  stockMock.set(stockId, {
    ingresos: p.ingresos,
    egresos: p.egresos,
    pendEntregaVta: p.pendEntregaVta,
    pendRecepcionCompra: p.pendRecepcionCompra,
    fisico: p.fisico,
    comercial: p.comercial,
    disponible: p.disponible,
  })
  const precios = Object.fromEntries(LISTAS.map((l) => [l, precio])) as Record<ListaPrecio, number>
  return {
    id,
    codigo: p.codigo,
    nombre: p.nombre,
    precios,
    margenes: { L1: p.rentabilidad, L2: p.rentabilidad, L3: p.rentabilidad },
    precioCosto: p.precioCosto ?? 0,
    iva: p.iva ?? 0,
    moneda: p.moneda ?? '',
    tipo: p.tipo,
    comisionable: p.comisionable ?? false,
    conRentabForzada: p.conRentabForzada ?? false,
    rubro: p.rubro ?? '',
    subrubro: p.subrubro ?? '',
    categoria: p.categoria ?? '',
    um: p.um,
    peso: p.peso ?? 0,
    provCod: p.provCod,
    provNombre: p.provNombre,
    provId: p.provId,
    stockId,
  }
}

const LISTAS: ListaPrecio[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']

/* ── Espejo en sessionStorage ───────────────────────────────────────────────────────────────── */

function desdeSesion(): void {
  try {
    const crudo = sessionStorage.getItem(CLAVE_SESION)
    if (!crudo) return
    const guardado = JSON.parse(crudo) as { version: string | null; productos: ProductoCache[] }
    if (!Array.isArray(guardado.productos)) return
    porId = new Map(guardado.productos.map((p) => [p.id, p]))
    version = guardado.version
    invalidarIndice()
  } catch {
    /* Un espejo ilegible —formato viejo, cuota llena, modo privado— no es un problema: se ignora y
       se baja el catálogo completo, que es el camino de la primera vez. */
  }
}

function guardarEnSesion(): void {
  try {
    sessionStorage.setItem(
      CLAVE_SESION,
      JSON.stringify({ version, productos: [...porId.values()] }),
    )
  } catch {
    /* Sin lugar en sessionStorage el catálogo sigue en memoria y todo funciona: sólo se pierde el
       atajo al recargar. No hay nada que avisar. */
  }
}
