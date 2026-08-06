/**
 * Capa de servicio de la venta CON PROFORMA contra el board de Proformas de La Batea
 * (18424580497). Trae las proformas del cliente elegido y todos sus productos (subelementos),
 * en modo lectura: la venta CON PROFORMA no edita cantidades ni precios, sólo los valida.
 *
 * Como en los presupuestos, el filtro por `board_relation` (cliente) no se delega a
 * `query_params`: se traen los ítems del board y se filtran en memoria por el id del cliente.
 */
import { PRESUPUESTOS } from '@/data/mock'
import { num, numCol, valor, byId, type CV, type MondayItem } from './parse'
import { descuentoUnitario, ivaLinea } from '@/lib/descuentos'
import { round2 } from '@/lib/format'
import { memoPorCliente } from './cache'
import type { MedioEnvio, PresupuestoProducto, TipoEntrega, TipoVenta } from '@/types'
import { BOARDS, COL, MEDIO_ENVIO_LABELS, personCol } from './columns'
import type { LineaVenta } from './venta'
import { mondayApi, mondayHabilitado } from './sdk'

/** Una proforma del cliente, con todos sus productos. */
export interface ProformaVigente {
  /** ID del ítem en Monday. */
  id: string
  /** Nombre de la proforma (el `name` del ítem). */
  nro: string
  /** "🤖Rentabilidad % GENERAL" del board. */
  rentabilidad: number
  /** Importe total de la proforma (lookup del board). */
  importe: number
  /** "✋️Tipo De Vta" de la proforma (color_mm5142e4): define la tasa de comisión (Activa/Pasiva). */
  tipoVenta: TipoVenta
  productos: PresupuestoProducto[]
}

/**
 * Mapea un subelemento de la proforma a la línea que consume la venta. La proforma es de sólo
 * lectura: la cantidad vendida es la totalidad de la línea (no hay "pendiente" ni "vendido"
 * parcial), y el descuento no se edita.
 */
function mapProformaProducto(sub: MondayItem): PresupuestoProducto {
  const c = byId(sub)
  const producto = c[COL.proformaSub.producto]?.linked_items?.[0]
  const prodCols = producto ? byId(producto) : {}
  const cantidad = numCol(c[COL.proformaSub.cantidad])
  return {
    // El nombre y la referencia salen del producto conectado, no del nombre del subítem (que se
    // renombra con IDs). Sin producto conectado se avisa, en vez de mostrar el ID.
    nombre: producto?.name || 'Producto sin asignar',
    codigo: valor(prodCols[COL.producto.codigo]),
    // Todo o nada: la cantidad de la línea es la de la proforma, sin parcialidad.
    total: cantidad,
    vend: 0,
    pend: cantidad,
    precio: numCol(c[COL.proformaSub.precioUnit]),
    // Rentabilidad de la línea, leída del subelemento (numeric_mm4cmpa6).
    rent: numCol(c[COL.proformaSub.rentabilidad]),
    // "🤖Comision" espejada del Maestro (lookup_mm5zgkdr): "SI" habilita la comisión de la venta.
    comisionable: valor(c[COL.proformaSub.comisionable]).trim().toUpperCase() === 'SI',
    // Descuento manual del producto tal como quedó guardado en la proforma (numeric_mm472cqy).
    descuento: numCol(c[COL.proformaSub.descuento]),
    // Descuento por forma de pago guardado en la proforma (numeric_mm5svkh2).
    descFormaPago: numCol(c[COL.proformaSub.descFormaPago]),
    // Montos $ por unidad de cada descuento, guardados en la proforma (independientes por origen).
    descProdMonto: numCol(c[COL.proformaSub.descProdMonto]), // Desc $ x Prod (numeric_mm5xxrkw)
    descFpMonto: numCol(c[COL.proformaSub.descFpMonto]), // Desc $ x Forma de Pago (numeric_mm5x79vt)
    tipo: valor(prodCols[COL.producto.tipoMercaderia]),
    iva: numCol(prodCols[COL.producto.iva]),
    // U.M. del subelemento (lookup); si no vino, la del producto conectado.
    um: valor(c[COL.proformaSub.unidadMedida]) || valor(prodCols[COL.producto.unidadMedida]),
    // Valores YA calculados guardados en la proforma: se muestran tal cual en la tabla.
    impBonificado: numCol(c[COL.proformaSub.impBonificado]),
    ivaMonto: numCol(c[COL.proformaSub.iva]),
    totalLinea: numCol(c[COL.proformaSub.total]),
    productoId: producto?.id,
    subitemId: sub.id,
  }
}

/** Ids de las proformas cuyo cliente conectado es el elegido. Se filtra en memoria. */
/**
 * Labels reales del "Estado Proforma" (color_mm5smnqe) en el board. Se usan tal cual: una proforma
 * nace "Pendiente de Venta" (disponible) y pasa a "Usada" al facturarse (ya no se puede reutilizar).
 */
const PROFORMA_ESTADO_PENDIENTE = 'Pendiente de Venta'
const PROFORMA_ESTADO_USADA = 'Usada'

async function idsProformasCliente(clienteItemId: string): Promise<string[]> {
  const data = await mondayApi<{
    boards: { items_page: { items: { id: string; column_values: CV[] }[] } }[]
  }>(
    `query {
      boards(ids: [${BOARDS.proformas}]) {
        items_page(limit: 200) {
          items {
            id
            column_values(ids: ["${COL.proforma.cliente}","${COL.proforma.estadoVenta}"]) {
              id text
              ... on BoardRelationValue { linked_item_ids }
            }
          }
        }
      }
    }`,
  )
  return (data.boards[0]?.items_page?.items ?? [])
    .filter((it) => {
      const c = byId(it)
      const linked = c[COL.proforma.cliente]?.linked_item_ids ?? []
      const esDelCliente = linked.map(String).includes(String(clienteItemId))
      // Sólo las proformas "Pendiente de Venta" están disponibles: el resto (Usada / No usar) se excluye.
      const disponible = (c[COL.proforma.estadoVenta]?.text ?? '').trim() === PROFORMA_ESTADO_PENDIENTE
      return esDelCliente && disponible
    })
    .map((it) => it.id)
}

/**
 * Proformas del cliente, con todos sus productos. Va en dos consultas: primero los ítems del
 * board filtrando por cliente en memoria —el filtro por `board_relation` no se delega a
 * `query_params`—, y después sólo esos ítems con sus subelementos.
 */
async function getProformasClienteImpl(clienteItemId: string): Promise<ProformaVigente[]> {
  // Sin token el prototipo sigue corriendo: se reusan los presupuestos mock del cliente como proformas.
  if (!mondayHabilitado()) {
    return PRESUPUESTOS.filter((p) => p.clienteId === clienteItemId).map((p) => ({
      id: p.id,
      nro: p.id,
      rentabilidad: p.rent,
      importe: p.importe,
      tipoVenta: 'CON PRESUPUESTO PREVIO',
      productos: p.productos,
    }))
  }

  const ids = await idsProformasCliente(clienteItemId)
  if (ids.length === 0) return []

  const data = await mondayApi<{ items: (MondayItem & { subitems: MondayItem[] })[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        id name
        column_values(ids: ["${COL.proforma.importe}","${COL.proforma.rentabilidad}","${COL.proforma.total}","${COL.proforma.tipoVenta}"]) {
          id text
          ... on MirrorValue { display_value }
        }
        subitems {
          id name
          column_values(ids: ["${COL.proformaSub.producto}","${COL.proformaSub.comisionable}","${COL.proformaSub.unidadMedida}","${COL.proformaSub.cantidad}","${COL.proformaSub.precioUnit}","${COL.proformaSub.descuento}","${COL.proformaSub.descFormaPago}","${COL.proformaSub.descProdMonto}","${COL.proformaSub.descFpMonto}","${COL.proformaSub.impBonificado}","${COL.proformaSub.iva}","${COL.proformaSub.total}","${COL.proformaSub.rentabilidad}","${COL.proformaSub.subtotal}"]) {
            id text
            ... on MirrorValue { display_value }
            ... on FormulaValue { display_value }
            ... on BoardRelationValue {
              linked_items {
                id name
                column_values(ids: ["${COL.producto.codigo}","${COL.producto.iva}","${COL.producto.tipoMercaderia}","${COL.producto.unidadMedida}"]) {
                  id text
                  ... on FormulaValue { display_value }
                }
              }
            }
          }
        }
      }
    }`,
    { ids },
  )

  return (data.items ?? []).map((it) => {
    const c = byId(it)
    const productos = (it.subitems ?? []).map(mapProformaProducto)
    // El TOTAL de la proforma se lee de su columna (numeric_mm5sw8n2); si no vino, se suma de las
    // líneas ya calculadas (total + IVA), y como último recurso, del importe base.
    const totalBoard = num(c[COL.proforma.total]?.text)
    const importe =
      totalBoard ||
      round2(productos.reduce((acc, p) => acc + (p.totalLinea ?? 0) + (p.ivaMonto ?? 0), 0)) ||
      num(valor(c[COL.proforma.importe]))
    // "✋️Tipo De Vta" (color_mm5142e4): "C/ Presup Previo" → CON PRESUPUESTO PREVIO (comisión Activa);
    // cualquier otro ("Directa") → DIRECTA (comisión Pasiva).
    const tipoVenta: TipoVenta = valor(c[COL.proforma.tipoVenta]).includes('Presup')
      ? 'CON PRESUPUESTO PREVIO'
      : 'DIRECTA'
    return {
      id: it.id,
      nro: it.name,
      rentabilidad: num(c[COL.proforma.rentabilidad]?.text),
      importe,
      tipoVenta,
      productos,
    }
  })
}

/**
 * Proformas del cliente, cacheadas por id: se consultan UNA sola vez por cliente y reentrar al
 * paso con el stepper reutiliza el resultado sin volver a pegarle a la API.
 */
export const getProformasCliente = memoPorCliente(getProformasClienteImpl, (id) => id)

/* ===== Emisión de una proforma (crea el ítem, sus subelementos y dispara el PDF) ===== */

/** Etiquetas de estado del board de Proformas. */
const PROFORMA_PDF_EMITIR = 'Emitir'
const PROFORMA_ENVIO_ENVIAR = 'Enviar'

/* Los status del board escriben las etiquetas con su propia grafía (no en mayúsculas como la app):
   hay que mandar el label EXACTO o Monday rechaza el create_item entero. */
const PROFORMA_TIPO_VENTA_LABEL: Record<TipoVenta, string> = {
  'CON PRESUPUESTO PREVIO': 'C/ Presup Previo',
  DIRECTA: 'Directa',
}
const PROFORMA_TIPO_ENTREGA_LABEL: Record<TipoEntrega, string> = {
  POSTERIOR: 'Posterior',
  ANTERIOR: 'Anterior',
  SIMULTANEA: 'Simultánea',
}
/** "✋Tipo de Cobro": la proforma es siempre contado → "Simultaneo" (grafía del board). */
const PROFORMA_TIPO_COBRO_SIMULTANEO = 'Simultaneo'

/** Índice de una etiqueta en una columna status del board de Proformas, leído de su metadata. */
async function indiceEstadoProforma(columnId: string, label: string): Promise<number | null> {
  const data = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.proformas}]) { columns(ids: ["${columnId}"]) { settings_str } } }`,
  )
  const raw = data.boards[0]?.columns?.[0]?.settings_str
  if (!raw) return null
  const labels = (JSON.parse(raw).labels ?? {}) as Record<string, string>
  const entrada = Object.entries(labels).find(([, l]) => l === label)
  return entrada ? Number(entrada[0]) : null
}

/** id numérico de un board_relation; null si no es un número válido. */
const numId = (v?: string): number | null => {
  const n = Number(v)
  return v != null && Number.isFinite(n) ? n : null
}

/** Datos para materializar la proforma en Monday. Vienen del cobro de contado. */
export interface DatosProforma {
  clienteId: string
  /** ID del vendedor de la operación (usuario de Monday). Se asigna en la columna Person. */
  vendedorId?: string | null
  /** Nombre del ítem de la proforma (se usa el del cliente). */
  nombre: string
  tipoVenta: TipoVenta
  tipoEntrega: TipoEntrega
  /** Rentabilidad general de la proforma (%). */
  rentabilidad: number
  /** Descuento por forma de pago (pronto pago CONTADO), en %. Se compone con el desc. manual. */
  descFormaPago?: number
  /** Tasa de cambio del dólar usada en la operación. Se registra a nivel ítem (auditoría). */
  tasaCambio?: number | null
  lineas: LineaVenta[]
}

/** Alícuota de IVA por defecto cuando el producto no trae la suya. */
const IVA_DEFECTO_PROFORMA = 21

/** Resultado de crear la proforma: su id y cuántos subelementos entraron. */
export interface ProformaCreada {
  id: string
  subitemsCreados: number
}

/**
 * Emite una proforma: crea el ítem cabecera en el board de Proformas (18424580497) con su tipo de
 * venta/entrega, el cobro SIMULTANEO fijo y la rentabilidad general; un subelemento por producto
 * (producto conectado, cantidad, precio, rentabilidad y stock); y dispara la generación del PDF
 * poniendo el estado en "Emitir". Devuelve el id del ítem y cuántos subelementos se crearon.
 */
export async function crearProforma(datos: DatosProforma): Promise<ProformaCreada> {
  if (!mondayHabilitado()) {
    return { id: `mock-${Date.now()}`, subitemsCreados: datos.lineas.length }
  }
  const {
    clienteId,
    vendedorId,
    tipoVenta,
    tipoEntrega,
    rentabilidad,
    descFormaPago = 0,
    tasaCambio,
    lineas,
  } = datos

  /* Valores por línea (mismas fórmulas que la tabla de la factura proforma), calculados una vez:
     alimentan tanto los totales del ítem cabecera como cada subelemento. */
  const filas = lineas.map((l) => {
    // Descuento por unidad compuesto EN CASCADA (forma de pago primero, manual sobre el resto).
    const bonifUnit = descuentoUnitario(l.precioUnitario, l.descuento, descFormaPago).total
    const totalLinea = round2((l.precioUnitario - bonifUnit) * l.cantidad)
    return { l, bonifUnit, totalLinea, ivaLinea: ivaLinea(totalLinea, l.iva ?? IVA_DEFECTO_PROFORMA) }
  })
  // Totales de la venta: descuento (suma de importes bonificados), IVA total y TOTAL (neto + IVA).
  const descuentoTotal = round2(filas.reduce((a, f) => a + f.bonifUnit * f.l.cantidad, 0))
  const ivaTotal = round2(filas.reduce((a, f) => a + f.ivaLinea, 0))
  const netoTotal = round2(filas.reduce((a, f) => a + f.totalLinea, 0))
  const totalVenta = round2(netoTotal + ivaTotal)

  // 1) Cabecera de la proforma. Los status van con el label EXACTO del board (grafía propia).
  const cabecera: Record<string, unknown> = {
    [COL.proforma.tipoVenta]: { label: PROFORMA_TIPO_VENTA_LABEL[tipoVenta] },
    [COL.proforma.tipoEntrega]: { label: PROFORMA_TIPO_ENTREGA_LABEL[tipoEntrega] },
    // La proforma exige pago contado: el tipo de cobro es siempre "Simultaneo".
    [COL.proforma.tipoCobro]: { label: PROFORMA_TIPO_COBRO_SIMULTANEO },
    // Nace disponible: "Pendiente de Venta". Al facturarse pasa a "Usada" (ver marcarProformaUsada).
    [COL.proforma.estadoVenta]: { label: PROFORMA_ESTADO_PENDIENTE },
    // Rentabilidad general CON DECIMALES (no se redondea a entero).
    [COL.proforma.rentabilidad]: round2(rentabilidad),
    // Totales de la venta (auditoría a nivel ítem).
    [COL.proforma.descuentoTotal]: descuentoTotal,
    ...(tasaCambio != null && tasaCambio > 0
      ? { [COL.proforma.tasaCambio]: round2(tasaCambio) }
      : {}),
    [COL.proforma.ivaTotal]: ivaTotal,
    [COL.proforma.total]: totalVenta,
  }
  const clienteNum = numId(clienteId)
  if (clienteNum != null) cabecera[COL.proforma.cliente] = { item_ids: [clienteNum] }
  // Vendedor de la operación (columna Person): el seleccionado en el encabezado.
  const personaVendedor = personCol(vendedorId)
  if (personaVendedor) cabecera[COL.proforma.vendedor] = personaVendedor

  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    // El ítem raíz nace con el nombre general del tablero; su ID lo asigna la customKey del board.
    { boardId: BOARDS.proformas, name: 'Proformas', cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id

  // 2) Un create_subitem por producto. Un fallo suelto no corta la creación de los demás.
  let subitemsCreados = 0
  for (const { l, bonifUnit, totalLinea, ivaLinea } of filas) {
    /* Desglose INDEPENDIENTE de cada descuento por unidad: cada monto sobre el precio de LISTA por
       separado (NO en cascada), con su "precio con dto" = precio − ese monto. Informativas. */
    const descProdUnit = round2((l.precioUnitario * l.descuento) / 100)
    const descFpUnit = round2((l.precioUnitario * descFormaPago) / 100)
    const cv: Record<string, unknown> = {
      [COL.proformaSub.cantidad]: l.cantidad,
      // Precio unitario en pesos (ya convertido si el producto estaba en dólares).
      [COL.proformaSub.precioUnit]: l.precioUnitario,
      // Descuento manual del producto: 0 si no se aplicó ninguno.
      [COL.proformaSub.descuento]: l.descuento,
      // Descuento por forma de pago (pronto pago CONTADO).
      [COL.proformaSub.descFormaPago]: descFormaPago,
      // Desglose independiente de cada descuento por unidad (montos y precio ya descontado).
      [COL.proformaSub.descProdMonto]: descProdUnit,
      [COL.proformaSub.precioConDescProd]: round2(l.precioUnitario - descProdUnit),
      [COL.proformaSub.descFpMonto]: descFpUnit,
      [COL.proformaSub.precioConDescFp]: round2(l.precioUnitario - descFpUnit),
      // Imp. Bonificado POR UNIDAD (desc manual + desc forma de pago).
      [COL.proformaSub.impBonificado]: bonifUnit,
      // Precio Bonif = precio unitario (en pesos, ya convertido) menos la bonificación por unidad.
      [COL.proformaSub.precioBonif]: round2(l.precioUnitario - bonifUnit),
      // IVA ($) de la línea sobre el total ya bonificado.
      [COL.proformaSub.iva]: ivaLinea,
      // Total de la línea (precio − Imp. Bonificado) × cantidad.
      [COL.proformaSub.total]: totalLinea,
      // Rentabilidad de la línea CON DECIMALES (no se redondea a entero).
      [COL.proformaSub.rentabilidad]: round2(l.rentabilidad),
    }
    // Precio en DÓLARES: sólo si el producto estaba en dólares (auditoría de la conversión).
    if (l.precioUsd != null) cv[COL.proformaSub.precioUnitUsd] = round2(l.precioUsd)
    const prodNum = numId(l.productoId)
    if (prodNum != null) cv[COL.proformaSub.producto] = { item_ids: [prodNum] }
    const stockNum = numId(l.stockId)
    if (stockNum != null) cv[COL.proformaSub.stock] = { item_ids: [stockNum] }
    try {
      const res = await mondayApi<{ create_subitem: { id: string } | null }>(
        `mutation ($parentId: ID!, $name: String!, $cv: JSON!) {
          create_subitem(parent_item_id: $parentId, item_name: $name, column_values: $cv) { id }
        }`,
        { parentId: itemId, name: l.nombre, cv: JSON.stringify(cv) },
      )
      if (res.create_subitem?.id) subitemsCreados++
    } catch {
      /* Un subelemento que falla se informa por el conteo; no aborta la emisión. */
    }
  }

  // 3) Trigger PDF: estado "Emitir" (por índice dinámico de la metadata).
  const idx = await indiceEstadoProforma(COL.proforma.estadoPdf, PROFORMA_PDF_EMITIR)
  if (idx != null) {
    await mondayApi(
      `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
        change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
      }`,
      {
        id: itemId,
        board: BOARDS.proformas,
        cv: JSON.stringify({ [COL.proforma.estadoPdf]: { index: idx } }),
      },
    )
  }

  return { id: itemId, subitemsCreados }
}

/**
 * Despacha la proforma a los contactos elegidos: asigna los contactos y el medio de envío, y pone
 * la "Acción de Envío" en "Enviar" —lo que dispara la integración de correo/WhatsApp—. Se llama al
 * confirmar el envío en la interfaz.
 */
export async function enviarProforma(
  proformaId: string,
  contactoItemIds: string[],
  medio: MedioEnvio,
): Promise<void> {
  if (!mondayHabilitado()) return
  const ids = contactoItemIds.map(Number).filter((n) => Number.isFinite(n))
  const idx = await indiceEstadoProforma(COL.proforma.estadoEnvio, PROFORMA_ENVIO_ENVIAR)
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: proformaId,
      board: BOARDS.proformas,
      cv: JSON.stringify({
        [COL.proforma.contactos]: { item_ids: ids },
        [COL.proforma.medioEnvio]: { labels: MEDIO_ENVIO_LABELS[medio] },
        [COL.proforma.estadoEnvio]:
          idx != null ? { index: idx } : { label: PROFORMA_ENVIO_ENVIAR },
      }),
    },
  )
}

/**
 * Marca la proforma como "Usada" (color_mm5smnqe). Se dispara al facturar con éxito una venta
 * originada en una VENTA PROFORMA: la retira del listado disponible (el fetch sólo lista las
 * "Pendiente de Venta") y evita que se vuelva a facturar el mismo documento.
 */
export async function marcarProformaUsada(proformaId: string): Promise<void> {
  if (!mondayHabilitado() || !proformaId) return
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: proformaId,
      board: BOARDS.proformas,
      cv: JSON.stringify({ [COL.proforma.estadoVenta]: { label: PROFORMA_ESTADO_USADA } }),
    },
  )
}
