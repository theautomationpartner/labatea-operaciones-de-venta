/**
 * Capa de servicio de la DEVOLUCIÓN de ventas (REMITO · DEVOLUCION).
 *
 * Tres consultas y dos escrituras, en este orden:
 *   1) los remitos de entrega del cliente que contienen los productos a devolver,
 *   2) el precio de venta de cada LÍNEA imputada (precio, moneda y vencimiento de la NC),
 *   3) el registro: un movimiento de ingreso por producto en "🧮Stock y Movimientos" y la
 *      cantidad devuelta acumulada en cada línea de remito imputada,
 *   4) la nota de crédito pendiente de emitir, con un subelemento por producto devuelto.
 *
 * Las dos escrituras son BULK: una sola solicitud a la API con tantos alias como alteraciones.
 * Las reglas (30 días, orden, imputación) NO viven acá: son de `lib/devoluciones`, que es puro.
 */
import { addDays, desdeIso, hoy } from '@/lib/dates'
import type { PrecioLinea, RemitoEntrega } from '@/lib/devoluciones'
import { round2 } from '@/lib/format'
import { memoPorCliente, registrarLimpieza } from './cache'
import {
  BOARDS,
  COL,
  NOTA_CREDITO_ESTADO,
  personCol,
  STOCK_MOV_LABEL,
} from './columns'
import { byId, numCol, valor, type CV, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Alteraciones por solicitud, igual que el resto de las escrituras en lote de la app. */
const POR_TANDA = 25

/**
 * Índice del primer label cuyo texto coincide con alguno de los candidatos. Se resuelve leyendo
 * la metadata de la columna, no con un número fijo: el board puede reordenar o reescribir sus
 * etiquetas y la escritura tiene que seguir cayendo donde corresponde.
 */
const indiceDeLabel = (settingsStr: string | undefined, candidatos: readonly string[]): number | null => {
  if (!settingsStr) return null
  const labels = (JSON.parse(settingsStr).labels ?? {}) as Record<string, string>
  for (const cand of candidatos) {
    const entrada = Object.entries(labels).find(([, l]) => l === cand)
    if (entrada) return Number(entrada[0])
  }
  return null
}

/* ===== 1 · Remitos de entrega del cliente que contienen los productos a devolver ===== */

/** Un subelemento con su ítem padre resuelto en la misma consulta. */
type SubitemConPadre = MondayItem & { parent_item: MondayItem | null }

/** Lo que un pendiente de entrega aporta a la línea de remito que lo referencia. */
interface OrigenPendiente {
  productoId: string
  /** Subelemento de la VENTA: es donde vive el precio con el que se vendió esa línea. */
  ventaSubitemId?: string
}

/**
 * Pendientes de entrega del cliente por alguno de los productos a devolver, indexados por su id.
 *
 * Hacen de puente: la línea de un remito ANTERIOR no apunta al producto sino a SU pendiente
 * (ver `crearRemito`), y el pendiente es el único que sabe de qué subelemento de venta salió
 * —y por lo tanto a qué precio se vendió—.
 */
async function getPendientesDelCliente(
  clienteId: number,
  productos: number[],
): Promise<Map<string, OrigenPendiente>> {
  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query ($cliente: CompareValue!, $productos: CompareValue!) {
      boards(ids: [${BOARDS.pendientesEntrega}]) {
        items_page(
          limit: 500,
          query_params: {rules: [
            {column_id: "${COL.pendienteEntregaItem.cliente}", compare_value: $cliente, operator: any_of},
            {column_id: "${COL.pendienteEntregaItem.producto}", compare_value: $productos, operator: any_of}
          ]}
        ) {
          items {
            id
            column_values(ids: ["${COL.pendienteEntregaItem.producto}","${COL.pendienteEntregaItem.ventaSubelemento}"]) {
              id text
              ... on BoardRelationValue { linked_item_ids }
            }
          }
        }
      }
    }`,
    { cliente: [clienteId], productos },
  )
  const porId = new Map<string, OrigenPendiente>()
  for (const it of data.boards[0]?.items_page?.items ?? []) {
    const c = byId(it)
    const productoId = c[COL.pendienteEntregaItem.producto]?.linked_item_ids?.[0]
    if (!productoId) continue
    porId.set(it.id, {
      productoId: String(productoId),
      ventaSubitemId: c[COL.pendienteEntregaItem.ventaSubelemento]?.linked_item_ids?.[0],
    })
  }
  return porId
}

/**
 * Remitos de entrega emitidos a un cliente que contienen alguno de los productos a devolver.
 *
 * La consulta ataca el board de SUBELEMENTOS y filtra por lo que la línea tenga conectado en
 * "✋Producto", que según el tipo de remito es una cosa u otra:
 *   · POSTERIOR — el producto del Maestro (la mercadería salió del catálogo, no hay venta previa).
 *   · ANTERIOR  — el PENDIENTE de entrega, que arrastra el producto y el subelemento de venta.
 * Por eso primero se resuelven los pendientes del cliente por esos productos y después se filtra
 * por la unión de ambos conjuntos de ids: es la misma columna, así que va en una sola regla.
 *
 * El cliente y la emisión se validan del lado de la app: un remito sin "🤖Fecha Emision" todavía
 * no se emitió y no puede recibir una devolución.
 *
 * El orden y el plazo de 30 días NO se aplican acá: los resuelve `imputarDevolucion`.
 */
async function getRemitosEntregaClienteImpl({
  clienteId,
  productoIds,
}: ConsultaRemitos): Promise<RemitoEntrega[]> {
  const productos = productoIds.map(Number).filter((n) => Number.isFinite(n))
  if (productos.length === 0) return []
  if (!mondayHabilitado()) return remitosMock(productoIds)
  const idCliente = Number(clienteId)
  if (!Number.isFinite(idCliente)) return []

  const pendientes = await getPendientesDelCliente(idCliente, productos)
  const origenes = [...productos, ...[...pendientes.keys()].map(Number)].filter((n) =>
    Number.isFinite(n),
  )

  const data = await mondayApi<{ boards: { items_page: { items: SubitemConPadre[] } }[] }>(
    `query ($origenes: CompareValue!) {
      boards(ids: [${BOARDS.remitosSub}]) {
        items_page(
          limit: 500,
          query_params: {rules: [{column_id: "${COL.remitoSub.producto}", compare_value: $origenes, operator: any_of}]}
        ) {
          items {
            id
            column_values(ids: ["${COL.remitoSub.producto}","${COL.remitoSub.cantEntregada}","${COL.remitoSub.cantDevuelta}"]) {
              id text
              ... on BoardRelationValue { linked_item_ids }
            }
            parent_item {
              id name
              column_values(ids: ["${COL.remito.fechaEmision}","${COL.remito.pulseId}","${COL.remito.cliente}","${COL.remito.ventas}","${COL.remito.vtaPendFacturar}"]) {
                id text
                ... on BoardRelationValue { linked_item_ids }
              }
            }
          }
        }
      }
    }`,
    { origenes },
  )

  // Un remito puede aportar varias líneas: se agrupan por su ítem padre.
  const porRemito = new Map<string, RemitoEntrega>()
  for (const sub of data.boards[0]?.items_page?.items ?? []) {
    const padre = sub.parent_item
    if (!padre) continue
    const p = byId(padre)
    // Sólo remitos DE ESTE cliente y ya emitidos (con fecha de emisión asentada).
    const clientes = (p[COL.remito.cliente]?.linked_item_ids ?? []).map(String)
    if (!clientes.includes(String(clienteId))) continue
    const fechaIso = p[COL.remito.fechaEmision]?.text?.trim() ?? ''
    if (!fechaIso) continue

    const c = byId(sub)
    const origen = c[COL.remitoSub.producto]?.linked_item_ids?.[0]
    if (!origen) continue
    /* El conectado es el pendiente (ANTERIOR) o el producto (POSTERIOR). Con el pendiente, el
       producto y el subelemento de venta salen de él; sin él, el conectado ES el producto. */
    const desdePendiente = pendientes.get(String(origen))
    const productoId = desdePendiente?.productoId ?? String(origen)
    // Una línea de otro producto del mismo remito no interesa para esta devolución.
    if (!productoIds.includes(productoId)) continue

    let remito = porRemito.get(padre.id)
    if (!remito) {
      remito = {
        id: padre.id,
        // El ID visible ("RTOVTA-04") sale de la customKey; si faltara, el nombre del ítem.
        nro: valor(p[COL.remito.pulseId]) || padre.name,
        fecha: desdeIso(fechaIso),
        ventaIds: (p[COL.remito.ventas]?.linked_item_ids ?? []).map(String),
        /* Linaje del remito POSTERIOR: su venta no cuelga de "📈Ventas" sino del pendiente de
           facturar, que recién al facturarse la enlaza. Viaja para resolverlo al buscar precios. */
        vtaPendIds: (p[COL.remito.vtaPendFacturar]?.linked_item_ids ?? []).map(String),
        lineas: [],
      }
      porRemito.set(padre.id, remito)
    }
    remito.lineas.push({
      subitemId: sub.id,
      productoId,
      entregada: numCol(c[COL.remitoSub.cantEntregada]),
      devuelta: numCol(c[COL.remitoSub.cantDevuelta]),
      // ANTERIOR: por acá se llega al precio con el que se vendió ESTA línea.
      ventaSubitemId: desdePendiente?.ventaSubitemId,
    })
  }

  return [...porRemito.values()]
}

/** Cliente y productos de una consulta de remitos: juntos son su identidad. */
interface ConsultaRemitos {
  clienteId: string
  productoIds: string[]
}

/* La consulta depende del cliente Y de los productos, así que la clave los junta a los dos. Los
   ids se ordenan: la misma devolución cargada en otro orden es la MISMA consulta. */
const claveRemitos = ({ clienteId, productoIds }: ConsultaRemitos): string =>
  `${clienteId}|${[...productoIds].sort().join(',')}`

/* Promesa memoizada (comparte el fetch en curso entre montajes) e índice de lo YA resuelto.
   El índice existe para poder contestar SIN esperar: volver a la etapa con el stepper tiene que
   mostrar la tabla ya armada, no un "cargando" de un frame contra un resultado que ya estaba. */
const remitosMemo = memoPorCliente(getRemitosEntregaClienteImpl, claveRemitos)
const remitosResueltos = new Map<string, RemitoEntrega[]>()
registrarLimpieza(() => remitosResueltos.clear())

/**
 * Remitos de entrega del cliente para los productos a devolver, cacheados por (cliente, productos).
 *
 * Se consulta UNA sola vez por combinación: agregar un producto en el paso anterior cambia la
 * clave y dispara una consulta nueva, pero ir y volver con el stepper —que no cambia nada de la
 * operación— reutiliza lo ya traído. La caché se vacía al cambiar de operación, junto con el resto.
 */
export async function getRemitosEntregaCliente(
  clienteId: string,
  productoIds: string[],
): Promise<RemitoEntrega[]> {
  const consulta = { clienteId, productoIds }
  const remitos = await remitosMemo(consulta)
  remitosResueltos.set(claveRemitos(consulta), remitos)
  return remitos
}

/** Lo ya traído para esa combinación, sin esperar. `null` = todavía no se consultó. */
export const remitosEntregaEnCache = (
  clienteId: string,
  productoIds: string[],
): RemitoEntrega[] | null => remitosResueltos.get(claveRemitos({ clienteId, productoIds })) ?? null

/* ===== 2 · Precio de venta de cada línea imputada (para la nota de crédito) ===== */

/** ¿El comprobante se emitió en dólares? La etiqueta del board es "Dolares (USD)" o similar. */
const facturadoEnDolares = (moneda: string): boolean => /d[oó]lar|usd/i.test(moneda)

/** Datos del comprobante y de la venta que encabezan una línea acreditada. */
interface CabeceraVenta {
  ventaId?: string
  ventaNro?: string
  vencimientoFactura?: string
  enDolares?: boolean
  tipoCambio?: number
}

/** Precio unitario de una línea de venta y la alícuota de IVA de su producto. */
interface PrecioSubVenta {
  precioUnitario: number
  iva: number
}

/** Columnas de la VENTA que hacen falta para la NC, y las de su comprobante. */
const CAMPOS_VENTA = `column_values(ids: ["${COL.venta.idVta}","${COL.venta.tasaCambio}","${COL.venta.facturacion}"]) {
  id text
  ... on BoardRelationValue { linked_items { id name column_values(ids: ["${COL.facturacion.fechaVtoPago}","${COL.facturacion.moneda}","${COL.facturacion.tipoCambio}","${COL.facturacion.tipoComprobante}"]) { id text } } }
}`

/** Columnas del SUBELEMENTO de venta: el precio de la línea y el IVA de su producto. */
const CAMPOS_VENTA_SUB = `column_values(ids: ["${COL.ventaSub.producto}","${COL.ventaSub.precioUnit}","${COL.ventaSub.precioBonif}","${COL.ventaSub.precioUnitUsd}"]) {
  id text
  ... on BoardRelationValue { linked_items { id name column_values(ids: ["${COL.producto.iva}"]) { id text } } }
}`

/** Lee la cabecera de una venta: su número, y del comprobante el vencimiento, la moneda y el TC. */
function leerCabeceraVenta(venta: MondayItem): CabeceraVenta {
  const c = byId(venta)
  /* Comprobante de la venta: puede haber más de uno (mercadería común y consignada se parten).
     Alcanza con el primero que sea una factura: todos comparten moneda y vencimiento. */
  const comprobante = (c[COL.venta.facturacion]?.linked_items ?? []).find(
    (f) => !/cr[eé]dito|d[eé]bito/i.test(valor(byId(f)[COL.facturacion.tipoComprobante])),
  )
  const fc: Record<string, CV> = comprobante ? byId(comprobante) : {}
  return {
    ventaId: venta.id,
    ventaNro: valor(c[COL.venta.idVta]),
    vencimientoFactura: desdeIso(fc[COL.facturacion.fechaVtoPago]?.text?.trim() ?? ''),
    enDolares: facturadoEnDolares(valor(fc[COL.facturacion.moneda])),
    /* Tipo de cambio de la FACTURA original; si el comprobante no lo trae, el que la venta
       registró como auditoría. Nunca el del día: la NC no se recotiza. */
    tipoCambio: numCol(fc[COL.facturacion.tipoCambio]) || numCol(c[COL.venta.tasaCambio]),
  }
}

/** Precio e IVA de un subelemento de venta, en la moneda del comprobante. */
function leerPrecioSubVenta(sub: MondayItem, enDolares: boolean): PrecioSubVenta {
  const s = byId(sub)
  const producto = s[COL.ventaSub.producto]?.linked_items?.[0]
  const enPesos = numCol(s[COL.ventaSub.precioBonif]) || numCol(s[COL.ventaSub.precioUnit])
  const enUsd = numCol(s[COL.ventaSub.precioUnitUsd])
  return {
    /* En dólares vale el precio ORIGINAL en dólares, no el convertido: la NC se emite en la
       moneda del comprobante que corrige, con el tipo de cambio de aquella factura. */
    precioUnitario: enDolares && enUsd > 0 ? enUsd : enPesos,
    iva: producto ? numCol(byId(producto)[COL.producto.iva]) : 0,
  }
}

/**
 * ANTERIOR — el precio de cada línea sale de SU subelemento de venta, el que el pendiente dejó
 * anotado en la línea del remito. Una sola consulta: del subelemento se lee el precio, de su
 * producto conectado el IVA, y de su ítem PADRE (la venta) el comprobante con vencimiento y TC.
 *
 * Es acá donde se cumple lo que pide el requerimiento: si el mismo producto entró al remito desde
 * dos ventas distintas, cada línea trae el precio de la suya, no un precio "del producto".
 */
async function preciosPorSubelementoDeVenta(
  lineas: { subitemId: string; ventaSubitemId: string }[],
): Promise<PrecioLinea[]> {
  const ids = [...new Set(lineas.map((l) => l.ventaSubitemId))]
  const data = await mondayApi<{ items: (MondayItem & { parent_item: MondayItem | null })[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        ${CAMPOS_VENTA_SUB}
        parent_item { id name ${CAMPOS_VENTA} }
      }
    }`,
    { ids },
  )

  const porSubVenta = new Map<string, Omit<PrecioLinea, 'subitemId'>>()
  for (const sub of data.items ?? []) {
    const cabecera = sub.parent_item ? leerCabeceraVenta(sub.parent_item) : {}
    const precio = leerPrecioSubVenta(sub, cabecera.enDolares === true)
    porSubVenta.set(sub.id, { ...cabecera, ...precio })
  }

  return lineas.flatMap((l) => {
    const datos = porSubVenta.get(l.ventaSubitemId)
    return datos ? [{ subitemId: l.subitemId, ...datos }] : []
  })
}

/**
 * POSTERIOR — el remito salió del catálogo, así que su línea no tiene subelemento de venta: la
 * venta aparece recién cuando se factura el pendiente ("Vtas Pends de Facturar"). Se llega a ella
 * por ahí y se busca el producto entre sus subelementos. Sin venta todavía, la línea queda sin
 * precio y la NC lo marca.
 */
async function preciosPorVentaDelPendiente(
  lineas: { subitemId: string; productoId: string; vtaPendIds: string[] }[],
): Promise<PrecioLinea[]> {
  const pendIds = [...new Set(lineas.flatMap((l) => l.vtaPendIds))]
  if (pendIds.length === 0) return []

  const pend = await mondayApi<{ items: MondayItem[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        column_values(ids: ["${COL.vtaPendFacturar.venta}"]) {
          id text
          ... on BoardRelationValue { linked_item_ids }
        }
      }
    }`,
    { ids: pendIds },
  )
  const ventaPorPendiente = new Map<string, string>()
  for (const it of pend.items ?? []) {
    const venta = byId(it)[COL.vtaPendFacturar.venta]?.linked_item_ids?.[0]
    if (venta) ventaPorPendiente.set(it.id, String(venta))
  }

  // Venta de cada línea: la primera de sus pendientes de facturar que ya se haya facturado.
  const ventaPorLinea = new Map<string, string>()
  for (const l of lineas) {
    for (const p of l.vtaPendIds) {
      const venta = ventaPorPendiente.get(p)
      if (venta) {
        ventaPorLinea.set(l.subitemId, venta)
        break
      }
    }
  }
  const ventaIds = [...new Set(ventaPorLinea.values())]
  if (ventaIds.length === 0) return []

  const data = await mondayApi<{ items: (MondayItem & { subitems: MondayItem[] })[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        ${CAMPOS_VENTA}
        subitems { id ${CAMPOS_VENTA_SUB} }
      }
    }`,
    { ids: ventaIds },
  )

  /* Acá el precio SÍ se indexa por producto: el remito POSTERIOR no arrastra de qué línea de venta
     salió cada unidad, simplemente porque la venta no existía cuando se remitió. */
  const porVenta = new Map<string, { cabecera: CabeceraVenta; precios: Map<string, PrecioSubVenta> }>()
  for (const venta of data.items ?? []) {
    const cabecera = leerCabeceraVenta(venta)
    const precios = new Map<string, PrecioSubVenta>()
    for (const sub of venta.subitems ?? []) {
      const producto = byId(sub)[COL.ventaSub.producto]?.linked_items?.[0]
      if (producto) {
        precios.set(String(producto.id), leerPrecioSubVenta(sub, cabecera.enDolares === true))
      }
    }
    porVenta.set(venta.id, { cabecera, precios })
  }

  return lineas.flatMap((l) => {
    const ventaId = ventaPorLinea.get(l.subitemId)
    const venta = ventaId ? porVenta.get(ventaId) : undefined
    const precio = venta?.precios.get(l.productoId)
    return venta && precio ? [{ subitemId: l.subitemId, ...venta.cabecera, ...precio }] : []
  })
}

/**
 * Precio de venta de cada línea de remito imputada, indexado por el subelemento del REMITO.
 *
 * Los dos caminos corren en paralelo porque son independientes: las líneas ANTERIORES van por su
 * subelemento de venta (preciso por línea) y las POSTERIORES por la venta que facturó su pendiente
 * (por producto, que es todo lo que existe en ese caso). Una línea sin precio no rompe nada: la
 * nota de crédito la muestra marcada y se declara incompleta.
 */
export async function getPreciosDeLineas(remitos: RemitoEntrega[]): Promise<PrecioLinea[]> {
  if (!mondayHabilitado()) return []
  const conVentaSub: { subitemId: string; ventaSubitemId: string }[] = []
  const porPendiente: { subitemId: string; productoId: string; vtaPendIds: string[] }[] = []
  for (const r of remitos) {
    for (const l of r.lineas) {
      if (l.ventaSubitemId) {
        conVentaSub.push({ subitemId: l.subitemId, ventaSubitemId: l.ventaSubitemId })
      } else if (r.vtaPendIds?.length) {
        porPendiente.push({ subitemId: l.subitemId, productoId: l.productoId, vtaPendIds: r.vtaPendIds })
      }
    }
  }
  const [anteriores, posteriores] = await Promise.all([
    conVentaSub.length > 0 ? preciosPorSubelementoDeVenta(conVentaSub) : Promise.resolve([]),
    porPendiente.length > 0 ? preciosPorVentaDelPendiente(porPendiente) : Promise.resolve([]),
  ])
  return [...anteriores, ...posteriores]
}

/* ===== 3 · Registro de la devolución ===== */

/** Un producto que entra al stock por la devolución. */
export interface LineaStockDevolucion {
  /** Ítem de "🧮Stock y Movimientos" del producto, si el Maestro ya lo tiene conectado. */
  stockId?: string
  /** Nombre del producto: es la clave con la que se lo busca en el board de stock. */
  nombre: string
  cantidad: number
}

export interface ResultadoStockDevolucion {
  /** Movimientos de ingreso efectivamente creados. */
  creados: number
  /** Productos que no tienen ítem en el board de stock: su devolución NO impactó el saldo. */
  sinItemDeStock: string[]
}

/**
 * Suma al stock la mercadería devuelta: un subelemento de movimiento por producto en
 * "🧮Stock y Movimientos" (18421752251), con el estado "RTO Venta Devolucion", la fecha de la
 * devolución y la cantidad en "🤖Ingreso". El stock físico del board es una fórmula
 * (ingresos − egresos), así que con el movimiento alcanza: no se pisa ningún saldo a mano.
 *
 * Una sola solicitud de lectura (metadata del estado + los ítems de stock que falta resolver por
 * nombre) y una sola de escritura por tanda, con un alias por producto.
 *
 * `fechaIso` viaja en YYYY-MM-DD, el formato de las columnas date de Monday.
 */
export async function registrarDevolucionStock(
  lineas: LineaStockDevolucion[],
  fechaIso: string,
): Promise<ResultadoStockDevolucion> {
  const conCantidad = lineas.filter((l) => l.cantidad > 0)
  if (conCantidad.length === 0) return { creados: 0, sinItemDeStock: [] }
  if (!mondayHabilitado()) return { creados: conCantidad.length, sinItemDeStock: [] }

  /* Los productos sin `stockId` se buscan POR NOMBRE en el board de stock, donde cada ítem se
     llama exactamente como el producto del Maestro. Va en la misma solicitud que la metadata del
     estado: son dos lecturas que no dependen una de la otra. */
  const aResolver = [...new Set(conCantidad.filter((l) => !l.stockId).map((l) => l.nombre))]
  /* La declaración de `$nombres` va SÓLO cuando hay algo que buscar: una variable declarada y no
     usada es un error de validación de GraphQL, y tumbaría la consulta entera. */
  const buscaPorNombre = aResolver.length > 0
  const meta = await mondayApi<{
    estado: { columns: { settings_str: string }[] }[]
    stock?: { items_page: { items: { id: string; name: string }[] } }[]
  }>(
    `query ${buscaPorNombre ? '($nombres: CompareValue!) ' : ''}{
      estado: boards(ids: [${BOARDS.stockMovimientosSub}]) { columns(ids: ["${COL.stockMovSub.estado}"]) { settings_str } }
      ${
        buscaPorNombre
          ? `stock: boards(ids: [${BOARDS.stockMovimientos}]) {
               items_page(limit: 100, query_params: {rules: [{column_id: "name", compare_value: $nombres, operator: any_of}]}) {
                 items { id name }
               }
             }`
          : ''
      }
    }`,
    buscaPorNombre ? { nombres: aResolver } : {},
  )
  const estadoIdx = indiceDeLabel(meta.estado[0]?.columns?.[0]?.settings_str, STOCK_MOV_LABEL.devolucion)
  const porNombre = new Map(
    (meta.stock?.[0]?.items_page?.items ?? []).map((it) => [it.name.trim(), it.id]),
  )

  const conStock: { stockId: string; nombre: string; cantidad: number }[] = []
  const sinItemDeStock: string[] = []
  for (const l of conCantidad) {
    const stockId = l.stockId ?? porNombre.get(l.nombre.trim())
    if (stockId) conStock.push({ stockId, nombre: l.nombre, cantidad: l.cantidad })
    else sinItemDeStock.push(l.nombre)
  }
  if (conStock.length === 0) return { creados: 0, sinItemDeStock }

  let creados = 0
  for (let desde = 0; desde < conStock.length; desde += POR_TANDA) {
    const tanda = conStock.slice(desde, desde + POR_TANDA)
    const variables: Record<string, unknown> = {}
    const campos = tanda.map((l, i) => {
      const n = desde + i
      const cv: Record<string, unknown> = {
        [COL.stockMovSub.ingreso]: String(round2(l.cantidad)),
        [COL.stockMovSub.fecha]: { date: fechaIso },
      }
      if (estadoIdx != null) cv[COL.stockMovSub.estado] = { index: estadoIdx }
      variables[`p${n}`] = l.stockId
      variables[`n${n}`] = l.nombre
      variables[`cv${n}`] = JSON.stringify(cv)
      return `s${n}: create_subitem(parent_item_id: $p${n}, item_name: $n${n}, column_values: $cv${n}) { id }`
    })
    const decl = tanda.map((_, i) => `$p${desde + i}: ID!, $n${desde + i}: String!, $cv${desde + i}: JSON!`)
    const res = await mondayApi<Record<string, { id: string } | null>>(
      `mutation (${decl.join(', ')}) { ${campos.join('\n')} }`,
      variables,
    )
    creados += tanda.filter((_, i) => res[`s${desde + i}`]?.id).length
  }

  return { creados, sinItemDeStock }
}

/** Cuántas unidades absorbe cada línea de remito imputada. */
export interface ImputacionARegistrar {
  subitemId: string
  imputada: number
}

/**
 * Deja asentado en cada línea de remito imputada cuánto se devolvió, ACUMULANDO sobre lo que ya
 * tenía: es lo que impide que una devolución posterior del mismo cliente y producto vuelva a
 * imputar un remito ya consumido.
 *
 * Devuelve `false` sin escribir nada si la columna todavía no existe en el board (ver
 * `COL.remitoSub.cantDevuelta`): la devolución se registra igual en el stock, y la vista avisa.
 */
export async function registrarDevolucionEnRemitos(
  imputaciones: ImputacionARegistrar[],
): Promise<boolean> {
  const col = COL.remitoSub.cantDevuelta
  if (!col) return false
  const porSub = new Map<string, number>()
  for (const it of imputaciones) {
    if (it.imputada > 0) {
      porSub.set(it.subitemId, round2((porSub.get(it.subitemId) ?? 0) + it.imputada))
    }
  }
  const subIds = [...porSub.keys()]
  if (subIds.length === 0) return true
  if (!mondayHabilitado()) return true

  // Lo ya devuelto se ACUMULA, así que primero hay que leerlo: una sola consulta para todos.
  const data = await mondayApi<{ items: { id: string; column_values: { text: string | null }[] }[] }>(
    `query ($ids: [ID!]) { items(ids: $ids) { id column_values(ids: ["${col}"]) { text } } }`,
    { ids: subIds },
  )
  const actual = new Map<string, number>()
  for (const it of data.items ?? []) actual.set(it.id, Number(it.column_values?.[0]?.text) || 0)

  for (let desde = 0; desde < subIds.length; desde += POR_TANDA) {
    const tanda = subIds.slice(desde, desde + POR_TANDA)
    const vars: Record<string, unknown> = {}
    const campos = tanda.map((id, i) => {
      const n = desde + i
      const nuevo = round2((actual.get(id) ?? 0) + (porSub.get(id) ?? 0))
      vars[`i${n}`] = id
      vars[`cv${n}`] = JSON.stringify({ [col]: String(nuevo) })
      return `d${n}: change_multiple_column_values(item_id: $i${n}, board_id: ${BOARDS.remitosSub}, column_values: $cv${n}) { id }`
    })
    const decl = tanda.map((_, i) => `$i${desde + i}: ID!, $cv${desde + i}: JSON!`)
    await mondayApi(`mutation (${decl.join(', ')}) { ${campos.join('\n')} }`, vars)
  }
  return true
}

/* ===== 4 · Nota de crédito pendiente de emitir (board 18428263659) ===== */

/** Una línea de la nota de crédito, ya en pesos. */
export interface LineaNotaCreditoMonday {
  /** Ítem del Maestro de Productos, para linkear la línea. */
  productoId?: string
  nombre: string
  /** Unidad de venta del producto (dropdown; se crea si el board todavía no la tiene). */
  um?: string
  cantidad: number
  precioUnitario: number
  /** IVA de la línea, en pesos. */
  iva: number
  /** cantidad × precio unitario. Se manda calculado: el board no lo deriva. */
  subtotal: number
}

/** Datos para crear la nota de crédito y sus líneas. */
export interface DatosNotaCredito {
  /** Nombre con el que nace el ítem. El board no tiene customKey, así que sin esto quedarían
   *  todas iguales: se usa el del cliente. */
  nombre: string
  clienteId?: string
  vendedorId?: string | null
  /** Vencimiento de la nota de crédito, en YYYY-MM-DD. */
  vencimientoIso?: string
  /** Importe total a acreditar (con IVA), en pesos. */
  total: number
  /** IVA de toda la nota, en pesos: la suma del de sus líneas. */
  iva: number
  lineas: LineaNotaCreditoMonday[]
}

/**
 * Crea la nota de crédito pendiente de emitir con su cabecera y un subelemento por producto
 * devuelto, en dos solicitudes: la del ítem y UNA sola —con alias por tanda— para todas sus líneas.
 *
 * Nace en "Pend de Emitir" (índice resuelto por metadata, no fijo) y con el importe emitido en 0:
 * lo que se acredita efectivamente lo carga después quien emita el comprobante.
 *
 * El board es MONO-MONEDA (sus columnas son "$"), así que las líneas llegan ya convertidas a pesos
 * por el llamador. Ver `notaCreditoAMonday`.
 */
export async function crearNotaCredito(datos: DatosNotaCredito): Promise<{ id: string; subitemsCreados: number }> {
  const { nombre, clienteId, vendedorId, vencimientoIso, total, iva, lineas } = datos
  if (!mondayHabilitado()) {
    return { id: `mock-nc-${lineas.length}`, subitemsCreados: lineas.length }
  }

  const meta = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.notasCredito}]) { columns(ids: ["${COL.notaCredito.estadoEmision}"]) { settings_str } } }`,
  )
  const pendienteIdx = indiceDeLabel(meta.boards[0]?.columns?.[0]?.settings_str, [
    NOTA_CREDITO_ESTADO.pendiente,
  ])

  const cabecera: Record<string, unknown> = {
    [COL.notaCredito.total]: String(round2(total)),
    [COL.notaCredito.iva]: String(round2(iva)),
    // Todavía no se emitió nada: el pendiente de emitir (fórmula del board) arranca en el total.
    [COL.notaCredito.importeEmitido]: '0',
  }
  if (clienteId) cabecera[COL.notaCredito.cliente] = { item_ids: [Number(clienteId)] }
  const persona = personCol(vendedorId)
  if (persona) cabecera[COL.notaCredito.vendedor] = persona
  if (vencimientoIso) cabecera[COL.notaCredito.vencimiento] = { date: vencimientoIso }
  if (pendienteIdx != null) cabecera[COL.notaCredito.estadoEmision] = { index: pendienteIdx }

  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    { boardId: BOARDS.notasCredito, name: nombre, cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id

  // Los productos van en tandas, cada una en UNA sola solicitud con alias.
  let subitemsCreados = 0
  for (let desde = 0; desde < lineas.length; desde += POR_TANDA) {
    const tanda = lineas.slice(desde, desde + POR_TANDA)
    const variables: Record<string, unknown> = { parentId: itemId }
    const campos = tanda.map((l, i) => {
      const n = desde + i
      const cv: Record<string, unknown> = {
        [COL.notaCreditoSub.cantImputada]: String(round2(l.cantidad)),
        [COL.notaCreditoSub.precioUnit]: String(round2(l.precioUnitario)),
        [COL.notaCreditoSub.iva]: String(round2(l.iva)),
        [COL.notaCreditoSub.subtotal]: String(round2(l.subtotal)),
        [COL.notaCreditoSub.cantEmitida]: '0',
      }
      if (l.productoId) cv[COL.notaCreditoSub.producto] = { item_ids: [Number(l.productoId)] }
      if (l.um?.trim()) cv[COL.notaCreditoSub.unidadVenta] = { labels: [l.um.trim()] }
      variables[`n${n}`] = l.nombre
      variables[`cv${n}`] = JSON.stringify(cv)
      /* `create_labels_if_missing`: la "Unidad de Venta" del board nace SIN etiquetas, así que
         mandar una U.M. que todavía no tenga rechazaría la mutación entera. */
      return `s${n}: create_subitem(parent_item_id: $parentId, item_name: $n${n}, column_values: $cv${n}, create_labels_if_missing: true) { id }`
    })
    const decl = tanda
      .map((_, i) => `$n${desde + i}: String!, $cv${desde + i}: JSON!`)
      .join(', ')
    const res = await mondayApi<Record<string, { id: string } | null>>(
      `mutation ($parentId: ID!, ${decl}) { ${campos.join('\n')} }`,
      variables,
    )
    subitemsCreados += tanda.filter((_, i) => res[`s${desde + i}`]?.id).length
  }

  return { id: itemId, subitemsCreados }
}

/* ===== Modo local (sin token): remitos de mentira para poder recorrer el flujo ===== */

/**
 * Tres remitos por producto —de hace 5, 20 y 45 días— para que en local se vean las dos cosas que
 * definen la operatoria: el consumo del más nuevo hacia atrás y el remito que queda afuera por
 * pasarse de los 30 días.
 */
function remitosMock(productoIds: string[]): RemitoEntrega[] {
  const hace = (dias: number) => addDays(hoy(), -dias)
  return [
    { dias: 5, cantidad: 6 },
    { dias: 20, cantidad: 2 },
    { dias: 45, cantidad: 10 },
  ].map((r, i) => ({
    id: `mock-rto-${i}`,
    nro: `RTOVTA-${90 + i}`,
    fecha: hace(r.dias),
    ventaIds: [],
    lineas: productoIds.map((productoId, j) => ({
      subitemId: `mock-sub-${i}-${j}`,
      productoId,
      entregada: r.cantidad,
      devuelta: 0,
      ventaSubitemId: `mock-vtasub-${i}-${j}`,
    })),
  }))
}
