/**
 * Creación de la venta en el board "📈Ventas" (18421035510).
 *
 * Se dispara al pasar del cierre a la facturación: primero la cabecera con el cliente y las
 * tres clasificaciones de la operación, después un subelemento por producto, todos en UNA
 * sola mutation con alias (`s0`, `s1`, …), igual que el carrito del presupuesto.
 *
 * La venta se da por creada sólo si volvieron tantos subelementos como productos había: una
 * cabecera sin sus líneas no es una venta, y el paso siguiente no debe abrirse.
 */
import { VENTAS_ENTREGA } from '@/data/mock'
import { round2 } from '@/lib/format'
import type {
  Moneda,
  ResponsableEntrega,
  TipoEntrega,
  TipoPago,
  TipoVenta,
  VentaEntregaPendiente,
  VentaEntregaProducto,
} from '@/types'
import {
  BOARDS,
  COL,
  ENTREGA_RESPONSABLE_LABEL,
  VENTA_COBRO_INDEX,
  VENTA_ENTREGA_ESTADO_INDEX,
  VENTA_ENTREGA_INDEX,
  VENTA_TIPO_INDEX,
} from './columns'
import { byId, numCol, valor, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Subelementos por solicitud al actualizar la cantidad vendida de los presupuestos. */
const CANT_VENDIDA_POR_TANDA = 25

/** Subelementos por solicitud, igual que en el presupuesto. */
const PRODUCTOS_POR_TANDA = 25

/** Alícuota de IVA por defecto cuando el producto no trae la suya. */
const IVA_DEFECTO_VENTA = 21

/**
 * Un producto de la venta, ya normalizado desde el flujo que lo haya cargado. Además de lo
 * que necesita el board de Ventas, la línea arrastra los datos fiscales del producto: son los
 * que parten la venta en comprobantes y los que se declaran en cada línea de la factura.
 */
export interface LineaVenta {
  /** Ítem del Maestro de Productos. Sin él, el subelemento se crea sin la relación. */
  productoId?: string
  nombre: string
  cantidad: number
  precioUnitario: number
  /** Precio original en dólares del producto, antes de convertir a pesos. Sólo viene si la moneda
   *  del producto era "Dolares"; se registra como auditoría (numeric_mm5s58ej). */
  precioUsd?: number
  /** Descuento aplicado a la línea, en %. */
  descuento: number
  /** Rentabilidad de la línea, en %. */
  rentabilidad: number
  codigo?: string
  /** Unidad de medida del producto. Se muestra en la factura proforma. */
  um?: string
  /** Tipo de mercadería: 'CO' (consignada) o 'COM' (común). Sin dato se factura como común. */
  tipoMercaderia?: string
  /** Proveedor de la mercadería consignada: cada uno se factura por separado. */
  proveedorId?: string
  proveedorNombre?: string
  /** Alícuota de IVA del producto, en %. */
  iva?: number
  /** ID del ítem de "Stock y Movimientos" del producto. Enlaza el subítem y afecta el stock. */
  stockId?: string
}

export interface DatosVenta {
  /** Ítem del cliente en el board de Personas. */
  clienteId?: string
  /** Nombre con el que nace el ítem de la venta. */
  nombre: string
  tipoVenta: TipoVenta
  tipoEntrega: TipoEntrega
  /**
   * Tipo de pago de la operación, tal cual se registra en "✋Tipo de Cobro". SIMULTANEO = se
   * cobró con la factura (contado, o cuenta corriente cobrada en el acto); POSTERIOR = queda
   * como deuda en la cuenta corriente. Lo arma `datosCobroVenta` en `lib/cobros`.
   */
  tipoPago: TipoPago
  /** Rentabilidad general de la venta, en %. */
  rentabilidad: number
  /** Descuento por forma de pago (pronto pago), en %. Se compone con el desc. manual de cada línea. */
  descFormaPago?: number
  /** Tasa de cambio del dólar usada en la venta. Se registra como auditoría (numeric_mm5s5n54). */
  tasaCambio?: number | null
  /** Total en pesos de la venta (con IVA). Se escribe como número en "🤖Importe Total $". */
  importeTotalPesos?: number
  /** Responsable logístico elegido en el Cierre de Venta. Se escribe en "✋Entrega" (dropdown). */
  responsableEntrega?: ResponsableEntrega
  /** Ruta de entrega confirmada (sólo La Batea). Se linkea en la venta y baja a los pendientes. */
  rutaId?: string
  lineas: LineaVenta[]
  /** Sin uso todavía: la columna "✋Entrega" del board queda para una etapa posterior. */
  moneda?: Moneda
}

export interface VentaCreada {
  id: string
  /** Subelementos efectivamente creados: se compara contra la cantidad de productos. */
  subitemsCreados: number
}

/** Índice de "✋️Tipo De Vta" según lo elegido en el paso 1. */
const indiceTipoVenta = (t: TipoVenta): number =>
  t === 'DIRECTA' ? VENTA_TIPO_INDEX.directa : VENTA_TIPO_INDEX.conPresupuestoPrevio

/** Índice de "✋Tipo de Entrega". */
const indiceTipoEntrega = (t: TipoEntrega): number =>
  t === 'ANTERIOR'
    ? VENTA_ENTREGA_INDEX.anterior
    : t === 'SIMULTANEA'
      ? VENTA_ENTREGA_INDEX.simultanea
      : VENTA_ENTREGA_INDEX.posterior

/**
 * Columnas de un producto de la venta. El subtotal es fórmula del board: no se manda.
 * Con entrega SIMULTÁNEA la mercadería sale junto con la venta, así que lo vendido se asienta
 * también como cantidad entregada y la línea queda en "100% Entregada" (por índice). Con entrega
 * POSTERIOR nada salió todavía, así que la línea nace "0% Entregada" (índice 2 de color_mm5bhha).
 * En la entrega ANTERIOR la mercadería ya salió por remito: lo vendido se asienta como "Cant
 * Entregada Anterior" (numeric_mm54vcmr).
 */
const columnasLinea = (
  l: LineaVenta,
  entregaSimultanea: boolean,
  entregaPosterior: boolean,
  entregaAnterior: boolean,
  anteriorEstadoSubIdx: number | null,
  descFormaPago: number,
): Record<string, unknown> => {
  /* Descuento total de la línea (manual + forma de pago, topeado en 100%) y valores derivados:
     Imp. Bonificado, IVA en $ y TOTAL con IVA de la línea. */
  const descTotal = Math.min(l.descuento + descFormaPago, 100)
  const bonifUnit = round2((l.precioUnitario * descTotal) / 100)
  const impBonifLinea = round2(bonifUnit * l.cantidad)
  const totalLinea = round2((l.precioUnitario - bonifUnit) * l.cantidad)
  const ivaLinea = round2((totalLinea * (l.iva ?? IVA_DEFECTO_VENTA)) / 100)

  const cv: Record<string, unknown> = {
    [COL.ventaSub.cantidad]: String(l.cantidad),
    [COL.ventaSub.precioUnit]: String(round2(l.precioUnitario)),
    [COL.ventaSub.descuento]: String(l.descuento),
    // Descuento por forma de pago (pronto pago) elegido en la selección de productos.
    [COL.ventaSub.descFormaPago]: String(descFormaPago),
    // Imp. Bonificado de la línea = precio × cantidad × (desc prod + desc forma de pago)/100.
    [COL.ventaSub.impBonificado]: String(impBonifLinea),
    // IVA en $ de la línea, sobre el total ya bonificado.
    [COL.ventaSub.iva]: String(ivaLinea),
    // TOTAL de la línea con IVA = total bonificado + IVA.
    [COL.ventaSub.totalConIva]: String(round2(totalLinea + ivaLinea)),
    [COL.ventaSub.rentabilidad]: String(Math.round(l.rentabilidad)),
  }
  if (entregaSimultanea) {
    cv[COL.ventaSub.cantEntregadaSimult] = String(l.cantidad)
    cv[COL.ventaSub.estadoEntrega] = { index: VENTA_ENTREGA_ESTADO_INDEX.totalmenteEntregada }
  } else if (entregaPosterior) {
    // Entrega POSTERIOR: la mercadería todavía no salió, la línea nace "0% Entregada" (índice 2).
    cv[COL.ventaSub.estadoEntrega] = { index: VENTA_ENTREGA_ESTADO_INDEX.sinEntregar }
  } else if (entregaAnterior) {
    // Entrega ANTERIOR: la mercadería ya se entregó por remito; lo vendido = cantidad entregada anterior,
    // y la línea nace "100% Entregada" (índice resuelto por label, con respaldo en la constante).
    cv[COL.ventaSub.cantEntregadaAnterior] = String(l.cantidad)
    cv[COL.ventaSub.estadoEntrega] = {
      index: anteriorEstadoSubIdx ?? VENTA_ENTREGA_ESTADO_INDEX.totalmenteEntregada,
    }
  }
  // Auditoría USD: sólo para productos que estaban en dólares, el precio original antes de convertir.
  if (l.precioUsd != null) cv[COL.ventaSub.precioUnitUsd] = String(round2(l.precioUsd))
  // En el flujo de entrega ANTERIOR las líneas vienen del remito y no traen el producto.
  if (l.productoId) cv[COL.ventaSub.producto] = { item_ids: [Number(l.productoId)] }
  // Ítem de stock del producto (heredado del maestro o del presupuesto): se enlaza en el subítem.
  if (l.stockId) cv[COL.ventaSub.stock] = { item_ids: [Number(l.stockId)] }
  return cv
}

/** Índice del label cuyo texto coincide, leído de la metadata de la columna status. */
const indiceLabelVenta = (settingsStr: string | undefined, label: string): number | null => {
  if (!settingsStr) return null
  const labels = (JSON.parse(settingsStr).labels ?? {}) as Record<string, string>
  const entrada = Object.entries(labels).find(([, l]) => l === label)
  return entrada ? Number(entrada[0]) : null
}

/** Una línea de la venta con el ID de su subelemento ya creado (para el enlace relacional). */
interface LineaVentaCreada extends LineaVenta {
  ventaSubitemId?: string
}

/**
 * Crea (bulk) los ítems de "Pends de Entrega" (18421035527) de una venta POSTERIOR: uno por
 * producto, enlazando cliente, producto, venta y —clave— el SUBELEMENTO de la venta
 * (board_relation_mm5pcdfj = {"item_ids":[ID_SUBITEM]}), con la cantidad vendida y el estado "Pend
 * de Entregar 100%" (índice dinámico). El enlace al subelemento se inyecta EN LA CREACIÓN del
 * pendiente (no en un update posterior): el ID del subítem ya se conoce, y no depende del ID del
 * pendiente, así que es 100% compatible con el disparo fire-and-forget. La reflexión de la columna
 * (allowCreateReflectionColumn) hace visible el vínculo desde el subítem de venta sin una 2ª
 * escritura. La query bulk se arma dinámicamente a partir de las líneas.
 *
 * NO toca el stock: no lee ni escribe ninguna columna del tablero de Stock.
 */
async function crearPendientesEntrega(
  clienteId: string | undefined,
  ventaId: string,
  lineas: LineaVentaCreada[],
  rutaId?: string,
): Promise<void> {
  const conProd = lineas.filter((l) => l.productoId && l.cantidad > 0)
  if (conProd.length === 0) return
  const meta = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.pendientesEntrega}]) { columns(ids: ["${COL.pendienteEntregaItem.estado}"]) { settings_str } } }`,
  )
  const estadoIdx = indiceLabelVenta(
    meta.boards[0]?.columns?.[0]?.settings_str,
    'Pend de Entregar 100%',
  )
  const variables: Record<string, unknown> = {}
  const campos = conProd.map((l, i) => {
    const cv: Record<string, unknown> = {
      [COL.pendienteEntregaItem.cantidad]: String(round2(l.cantidad)),
      [COL.pendienteEntregaItem.venta]: { item_ids: [Number(ventaId)] },
    }
    if (clienteId) cv[COL.pendienteEntregaItem.cliente] = { item_ids: [Number(clienteId)] }
    if (l.productoId) cv[COL.pendienteEntregaItem.producto] = { item_ids: [Number(l.productoId)] }
    // Ítem de "Stock y Movimientos" del producto: se linkea a nivel ítem del pendiente (POSTERIOR).
    if (l.stockId) cv[COL.pendienteEntregaItem.stockMovimiento] = { item_ids: [Number(l.stockId)] }
    // Ruta de entrega de la venta: baja a cada pendiente para verla al remitar (venta ANTERIOR).
    if (rutaId && Number.isFinite(Number(rutaId))) {
      cv[COL.pendienteEntregaItem.ruta] = { item_ids: [Number(rutaId)] }
    }
    // Enlace al subelemento de la venta (unidireccional en el pendiente; visible del otro lado por reflexión).
    if (l.ventaSubitemId) {
      cv[COL.pendienteEntregaItem.ventaSubelemento] = { item_ids: [Number(l.ventaSubitemId)] }
    }
    if (estadoIdx != null) cv[COL.pendienteEntregaItem.estado] = { index: estadoIdx }
    // Ítem raíz del tablero de pendientes: nombre general; su ID lo asigna la customKey del board.
    variables[`pn${i}`] = 'Entregas Pendientes'
    variables[`pcv${i}`] = JSON.stringify(cv)
    return `p${i}: create_item(board_id: ${BOARDS.pendientesEntrega}, item_name: $pn${i}, column_values: $pcv${i}) { id }`
  })
  const decl = conProd.map((_, i) => `$pn${i}: String!, $pcv${i}: JSON!`).join(', ')
  await mondayApi(`mutation (${decl}) { ${campos.join('\n')} }`, variables)
}

/**
 * Crea (bulk) el movimiento de salida en el Stock del producto (subelemento en 18421752360) de una
 * venta SIMULTÁNEA: uno por producto, apuntando al ítem de stock vinculado en el subítem de la venta
 * (board_relation_mm5pz6kz → `l.stockId`), con el estado "Venta Simultanea" (índice dinámico), la
 * fecha del sistema y el egreso = cantidad vendida. La query bulk se arma dinámicamente a partir de
 * las líneas. No crea pendientes de entrega.
 */
async function crearMovimientosStockSimultanea(lineas: LineaVentaCreada[]): Promise<void> {
  const conStock = lineas.filter((l) => l.stockId && l.cantidad > 0)
  if (conStock.length === 0) return
  const fecha = new Date().toISOString().slice(0, 10)
  const meta = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.stockMovimientosSub}]) { columns(ids: ["${COL.stockMovSub.estado}"]) { settings_str } } }`,
  )
  const idx = indiceLabelVenta(meta.boards[0]?.columns?.[0]?.settings_str, 'Venta Simultanea')
  const variables: Record<string, unknown> = {}
  const campos = conStock.map((l, i) => {
    const cv: Record<string, unknown> = {
      [COL.stockMovSub.egreso]: String(round2(l.cantidad)),
      [COL.stockMovSub.fecha]: { date: fecha },
    }
    if (idx != null) cv[COL.stockMovSub.estado] = { index: idx }
    variables[`s${i}`] = l.stockId
    variables[`sn${i}`] = l.nombre
    variables[`scv${i}`] = JSON.stringify(cv)
    return `s${i}: create_subitem(parent_item_id: $s${i}, item_name: $sn${i}, column_values: $scv${i}) { id }`
  })
  const decl = conStock.map((_, i) => `$s${i}: ID!, $sn${i}: String!, $scv${i}: JSON!`).join(', ')
  await mondayApi(`mutation (${decl}) { ${campos.join('\n')} }`, variables)
}

/**
 * Crea la venta con todos sus productos. Lanza si la cabecera falla; si fallan subelementos,
 * devuelve cuántos se crearon para que la vista decida (y no avance).
 */
export async function crearVenta(datos: DatosVenta): Promise<VentaCreada> {
  const {
    clienteId,
    tipoVenta,
    tipoEntrega,
    tipoPago,
    rentabilidad,
    descFormaPago = 0,
    tasaCambio,
    importeTotalPesos,
    responsableEntrega,
    rutaId,
    lineas,
  } = datos

  /* Totales de la venta a nivel ítem: descuento total (suma de importes bonificados), IVA total y
     TOTAL (neto bonificado + IVA), con las mismas fórmulas que cada subelemento. */
  const totales = lineas.reduce(
    (acc, l) => {
      const descTotal = Math.min(l.descuento + descFormaPago, 100)
      const bonifUnit = round2((l.precioUnitario * descTotal) / 100)
      const totalLinea = round2((l.precioUnitario - bonifUnit) * l.cantidad)
      const ivaLinea = round2((totalLinea * (l.iva ?? IVA_DEFECTO_VENTA)) / 100)
      acc.desc += round2(bonifUnit * l.cantidad)
      acc.neto += totalLinea
      acc.iva += ivaLinea
      return acc
    },
    { desc: 0, neto: 0, iva: 0 },
  )
  const descuentoTotal = round2(totales.desc)
  const ivaTotal = round2(totales.iva)
  const totalVenta = round2(totales.neto + ivaTotal)

  if (!mondayHabilitado()) {
    return { id: `mock-venta-${Date.now()}`, subitemsCreados: lineas.length }
  }

  // Con entrega simultánea, cada subítem asienta también la cantidad entregada.
  const entregaSimultanea = tipoEntrega === 'SIMULTANEA'
  // Con entrega posterior, la venta y sus líneas nacen "0% Entregado": nada salió todavía.
  const entregaPosterior = tipoEntrega === 'POSTERIOR'
  // Con entrega anterior, la mercadería ya salió por remito: lo vendido va a "Cant Entregada Anterior".
  const entregaAnterior = tipoEntrega === 'ANTERIOR'

  /* Entrega ANTERIOR: como la mercadería ya se entregó, la venta y sus líneas nacen "100% Entregada".
     El índice se resuelve por LABEL de la metadata de cada columna (ítem color_mm58xjgj y subítem
     color_mm5bhha), no por un número fijo; si el label cambiara, se cae a la constante verificada. */
  let anteriorEstadoItemIdx: number | null = null
  let anteriorEstadoSubIdx: number | null = null
  if (entregaAnterior) {
    const meta = await mondayApi<{
      item: { columns: { settings_str: string }[] }[]
      sub: { columns: { settings_str: string }[] }[]
    }>(
      `query {
        item: boards(ids: [${BOARDS.ventas}]) { columns(ids: ["${COL.venta.estadoEntrega}"]) { settings_str } }
        sub: boards(ids: [${BOARDS.ventasSub}]) { columns(ids: ["${COL.ventaSub.estadoEntrega}"]) { settings_str } }
      }`,
    )
    anteriorEstadoItemIdx = indiceLabelVenta(meta.item[0]?.columns?.[0]?.settings_str, '100% Entregada')
    anteriorEstadoSubIdx = indiceLabelVenta(meta.sub[0]?.columns?.[0]?.settings_str, '100% Entregada')
  }

  const cabecera: Record<string, unknown> = {
    [COL.venta.tipoVenta]: { index: indiceTipoVenta(tipoVenta) },
    [COL.venta.tipoEntrega]: { index: indiceTipoEntrega(tipoEntrega) },
    /* El board guarda el tipo de cobro por índice, no por texto: 'SIMULTANEO' es el valor de
       negocio y acá se traduce a la etiqueta que corresponde. */
    [COL.venta.tipoCobro]: {
      index:
        tipoPago === 'SIMULTANEO' ? VENTA_COBRO_INDEX.simultaneo : VENTA_COBRO_INDEX.posterior,
    },
    [COL.venta.rentabilidad]: String(Math.round(rentabilidad)),
  }
  // Auditoría: tasa de cambio del dólar usada en la venta (registro inmutable).
  if (tasaCambio != null && tasaCambio > 0) {
    cabecera[COL.venta.tasaCambio] = round2(tasaCambio)
  }
  // Totales de la venta: descuento total, IVA total y TOTAL (neto + IVA).
  cabecera[COL.venta.descuentoTotal] = descuentoTotal
  cabecera[COL.venta.ivaTotal] = ivaTotal
  cabecera[COL.venta.total] = totalVenta
  // Total en pesos de la venta: se envía como NÚMERO (no string) para las fórmulas del board.
  if (importeTotalPesos != null) {
    cabecera[COL.venta.importeTotalPesos] = round2(importeTotalPesos)
  }
  // Con entrega simultánea la mercadería sale con la venta: nace "100% Entregada" (por índice).
  if (entregaSimultanea) {
    cabecera[COL.venta.estadoEntrega] = { index: VENTA_ENTREGA_ESTADO_INDEX.totalmenteEntregada }
  } else if (entregaPosterior) {
    // Entrega POSTERIOR: nada entregado todavía, la venta nace "0% Entregado" (índice 2).
    cabecera[COL.venta.estadoEntrega] = { index: VENTA_ENTREGA_ESTADO_INDEX.sinEntregar }
  } else if (entregaAnterior) {
    // Entrega ANTERIOR: la mercadería ya salió por remito, la venta nace "100% Entregada".
    cabecera[COL.venta.estadoEntrega] = {
      index: anteriorEstadoItemIdx ?? VENTA_ENTREGA_ESTADO_INDEX.totalmenteEntregada,
    }
  }
  if (clienteId) cabecera[COL.venta.cliente] = { item_ids: [Number(clienteId)] }
  // Responsable logístico → dropdown por label. Ruta → board_relation (sólo si La Batea la confirmó).
  if (responsableEntrega) {
    cabecera[COL.venta.responsableEntrega] = { labels: [ENTREGA_RESPONSABLE_LABEL[responsableEntrega]] }
  }
  if (rutaId && Number.isFinite(Number(rutaId))) {
    cabecera[COL.venta.ruta] = { item_ids: [Number(rutaId)] }
  }

  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    // El ítem raíz nace con el nombre general del tablero; su ID lo asigna la customKey del board.
    { boardId: BOARDS.ventas, name: 'Ventas', cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id

  // Los productos van en tandas, cada una en una sola solicitud con alias. Se captura el ID del
  // subelemento creado por línea (por índice global) para enlazarlo desde el pendiente.
  let subitemsCreados = 0
  const ventaSubitemIds: (string | undefined)[] = new Array(lineas.length)
  for (let desde = 0; desde < lineas.length; desde += PRODUCTOS_POR_TANDA) {
    const tanda = lineas.slice(desde, desde + PRODUCTOS_POR_TANDA)
    const variables: Record<string, unknown> = { parentId: itemId }
    const campos = tanda.map((l, i) => {
      const n = desde + i
      variables[`n${n}`] = l.nombre
      variables[`cv${n}`] = JSON.stringify(
        columnasLinea(
          l,
          entregaSimultanea,
          entregaPosterior,
          entregaAnterior,
          anteriorEstadoSubIdx,
          descFormaPago,
        ),
      )
      return `s${n}: create_subitem(parent_item_id: $parentId, item_name: $n${n}, column_values: $cv${n}) { id }`
    })
    const declaraciones = tanda
      .map((_, i) => `$n${desde + i}: String!, $cv${desde + i}: JSON!`)
      .join(', ')

    const res = await mondayApi<Record<string, { id: string } | null>>(
      `mutation ($parentId: ID!, ${declaraciones}) { ${campos.join('\n')} }`,
      variables,
    )
    tanda.forEach((_, i) => {
      ventaSubitemIds[desde + i] = res[`s${desde + i}`]?.id
    })
    subitemsCreados += tanda.filter((_, i) => res[`s${desde + i}`]?.id).length
  }

  // Cada línea, ya con el ID de su subelemento de venta (para el enlace relacional del pendiente).
  const lineasConSub: LineaVentaCreada[] = lineas.map((l, i) => ({
    ...l,
    ventaSubitemId: ventaSubitemIds[i],
  }))

  /* Con la venta y sus subelementos YA confirmados (IDs obtenidos), se dispara la logística en
     segundo plano —fire-and-forget: sin `await` bloqueante—. El registro de la venta retorna éxito
     y cierra la pantalla sin esperar su resolución.
       · POSTERIOR: crea los "Pends de Entrega", enlazados a su subelemento de venta. No toca stock.
       · SIMULTÁNEA: crea el movimiento de salida en el Stock del producto. No crea pendientes. */
  if (tipoEntrega === 'POSTERIOR') {
    void crearPendientesEntrega(clienteId, itemId, lineasConSub, rutaId).catch(() => {
      /* La creación de pendientes de entrega es best-effort y desacoplada. */
    })
  } else if (tipoEntrega === 'SIMULTANEA') {
    void crearMovimientosStockSimultanea(lineasConSub).catch(() => {
      /* La creación del movimiento de stock es best-effort y desacoplada. */
    })
  }

  return { id: itemId, subitemsCreados }
}

/**
 * Cantidad vendida a asentar en un subelemento del presupuesto.
 * `cantVendida` es el ACUMULADO: lo que ya estaba vendido más lo que se lleva ahora.
 */
export interface CantVendida {
  /** ID del subelemento del presupuesto ("Subelementos de 🧾Presupuestos", 18421035575). */
  subitemId: string
  cantVendida: number
}

/**
 * Asienta la cantidad vendida en los subelementos de presupuesto de una venta CON PRESUPUESTO
 * PREVIO. Cada producto de la venta viene de una línea de un presupuesto; su "🤖 Cant Vendida"
 * pasa a reflejar el total llevado hasta ahora. Se escribe en tandas, con alias en una sola
 * solicitud cada una. Los ítems sin `subitemId` (modo local) se saltean.
 */
export async function actualizarCantVendida(lineas: CantVendida[]): Promise<void> {
  const conId = lineas.filter((l) => l.subitemId)
  if (!mondayHabilitado() || conId.length === 0) return

  for (let desde = 0; desde < conId.length; desde += CANT_VENDIDA_POR_TANDA) {
    const tanda = conId.slice(desde, desde + CANT_VENDIDA_POR_TANDA)
    const variables: Record<string, unknown> = { board: BOARDS.presupuestosSub }
    const campos = tanda.map((l, i) => {
      const n = desde + i
      variables[`item${n}`] = l.subitemId
      variables[`cv${n}`] = JSON.stringify({
        [COL.presupuestoSub.cantVendida]: String(Math.round(l.cantVendida)),
      })
      return `u${n}: change_multiple_column_values(item_id: $item${n}, board_id: $board, column_values: $cv${n}) { id }`
    })
    const declaraciones = tanda
      .map((_, i) => `$item${desde + i}: ID!, $cv${desde + i}: JSON!`)
      .join(', ')
    await mondayApi(
      `mutation ($board: ID!, ${declaraciones}) { ${campos.join('\n')} }`,
      variables,
    )
  }
}

/* ===== Pendientes de entrega del cliente (origen del remito ANTERIOR) ===== */

/**
 * Un producto pendiente de entregar, tal como vive en "Pends de Entrega" (18421035527). El nombre,
 * el código, la U.M. y el peso salen del producto conectado en el Maestro; lo vendido, lo entregado
 * y lo pendiente, de las columnas del propio ítem. Se guarda el subelemento de VENTA
 * (board_relation_mm5pcdfj) para acumular lo entregado al emitir, y el ID del pendiente para su
 * subítem de historial.
 */
function mapPendienteEntrega(item: MondayItem): VentaEntregaProducto {
  const c = byId(item)
  const producto = c[COL.pendienteEntregaItem.producto]?.linked_items?.[0]
  const prodCols = producto ? byId(producto) : {}
  const venta = c[COL.pendienteEntregaItem.venta]?.linked_items?.[0]
  const ventaSub = c[COL.pendienteEntregaItem.ventaSubelemento]?.linked_items?.[0]
  const ruta = c[COL.pendienteEntregaItem.ruta]?.linked_items?.[0]
  const vendida = numCol(c[COL.pendienteEntregaItem.cantidad])
  const entregada = numCol(c[COL.pendienteEntregaItem.entregada])
  const pendiente = Math.max(numCol(c[COL.pendienteEntregaItem.pendiente]) || vendida - entregada, 0)
  const estado = c[COL.pendienteEntregaItem.estado]
  return {
    nombre: producto?.name || 'Producto sin asignar',
    codigo: producto ? valor(prodCols[COL.producto.codigo]) : '',
    // La U.M. sale de la columna espejo del pendiente (lookup_mm5pggg9), no del maestro.
    um: valor(c[COL.pendienteEntregaItem.unidadMedida]),
    // Ruta de entrega asignada al pendiente (board_relation_mm5pa9v3): se muestra al remitar.
    ruta: ruta?.name,
    vendida,
    entregada,
    pendiente,
    estadoEntrega: estado?.text ?? '',
    // Sólo se remite lo que todavía queda pendiente de entregar.
    seleccionable: pendiente > 0,
    // Subelemento de la VENTA (para acumular lo entregado al emitir), no del pendiente.
    subitemId: ventaSub?.id,
    productoId: producto?.id,
    ventaId: venta?.id,
    peso: producto ? numCol(prodCols[COL.producto.peso]) : 0,
    // Ítem de "Pends de Entrega": es el padre del subítem de historial de entrega que se crea al emitir.
    pendienteEntregaId: item.id,
  }
}

/**
 * Productos del cliente pendientes de entregar, agrupados por la venta que los originó. Es la
 * fuente del remito de emisión ANTERIOR: se lee de "Pends de Entrega" (18421035527) filtrando por
 * el cliente (board_relation_mm5p8hpc). Ya NO se consulta el board de Ventas (18421035510).
 */
export async function getVentasEntregaPendiente(clienteId: string): Promise<VentaEntregaPendiente[]> {
  if (!mondayHabilitado()) {
    return VENTAS_ENTREGA.filter(
      (v) => v.clienteId === clienteId && v.estado !== 'Entregada',
    ).map((v) => ({
      id: v.id,
      nro: v.id,
      estadoEntrega: v.estado,
      fecha: v.fecha,
      productos: v.productos.map((p) => ({ ...p, seleccionable: p.pendiente > 0 })),
    }))
  }
  const idNumerico = Number(clienteId)
  if (!Number.isFinite(idNumerico)) return []

  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query ($cliente: CompareValue!) {
      boards(ids: [${BOARDS.pendientesEntrega}]) {
        items_page(
          limit: 200,
          query_params: {rules: [
            {column_id: "${COL.pendienteEntregaItem.cliente}", compare_value: $cliente, operator: any_of}
          ]}
        ) {
          items {
            id name
            column_values(ids: ["${COL.pendienteEntregaItem.producto}","${COL.pendienteEntregaItem.venta}","${COL.pendienteEntregaItem.ventaSubelemento}","${COL.pendienteEntregaItem.ruta}","${COL.pendienteEntregaItem.cantidad}","${COL.pendienteEntregaItem.unidadMedida}","${COL.pendienteEntregaItem.entregada}","${COL.pendienteEntregaItem.pendiente}","${COL.pendienteEntregaItem.estado}"]) {
              id text
              ... on StatusValue { index }
              ... on FormulaValue { display_value }
              ... on MirrorValue { display_value }
              ... on BoardRelationValue {
                linked_items {
                  id name
                  column_values(ids: ["${COL.producto.codigo}","${COL.producto.unidadMedida}","${COL.producto.peso}"]) { id text }
                }
              }
            }
          }
        }
      }
    }`,
    { cliente: [idNumerico] },
  )

  // Se agrupan los pendientes por la venta de origen: cada card del panel es una venta.
  const porVenta = new Map<string, VentaEntregaPendiente>()
  for (const item of data.boards[0]?.items_page?.items ?? []) {
    const prod = mapPendienteEntrega(item)
    // Sólo entran los pendientes con algo por entregar.
    if (prod.pendiente <= 0) continue
    const ventaId = prod.ventaId || item.id
    const nombreVenta =
      byId(item)[COL.pendienteEntregaItem.venta]?.linked_items?.[0]?.name || ventaId
    if (!porVenta.has(ventaId)) {
      porVenta.set(ventaId, { id: ventaId, nro: nombreVenta, estadoEntrega: '', fecha: '', productos: [] })
    }
    porVenta.get(ventaId)!.productos.push(prod)
  }
  return [...porVenta.values()]
}

/** Unidades que todavía faltan entregar de la venta. Es lo que resume la card. */
export const pendienteDeVentaEntrega = (v: VentaEntregaPendiente): number =>
  v.productos.reduce((acc, p) => acc + p.pendiente, 0)

/**
 * Cantidad entregada a asentar en un subelemento de la venta al emitir el remito ANTERIOR.
 * `cantEntregada` es el ACUMULADO: lo que ya estaba entregado más lo que sale en este remito.
 */
export interface CantEntregada {
  /** ID del subelemento de la venta ("Subelementos de 📈Ventas", 18421035581). */
  subitemId: string
  cantEntregada: number
}

/**
 * Impacta la cantidad entregada en los subelementos de la venta (columna
 * "🤖Cant Entregada Posterior", numeric_mm54v0jd) al emitir un remito de emisión ANTERIOR.
 * Cada producto del remito viene de una línea de una venta con entrega posterior; su cant
 * entregada pasa a reflejar el total entregado hasta ahora.
 *
 * Se escribe con UNA solicitud bulk por tanda (alias `u0`, `u1`, …), igual que la cantidad
 * vendida del presupuesto. Los ítems sin `subitemId` (remito POSTERIOR o modo local) se saltean.
 */
export async function actualizarCantEntregada(lineas: CantEntregada[]): Promise<void> {
  const conId = lineas.filter((l) => l.subitemId)
  if (!mondayHabilitado() || conId.length === 0) return

  for (let desde = 0; desde < conId.length; desde += CANT_VENDIDA_POR_TANDA) {
    const tanda = conId.slice(desde, desde + CANT_VENDIDA_POR_TANDA)
    const variables: Record<string, unknown> = { board: BOARDS.ventasSub }
    const campos = tanda.map((l, i) => {
      const n = desde + i
      variables[`item${n}`] = l.subitemId
      variables[`cv${n}`] = JSON.stringify({
        [COL.ventaSub.cantEntregadaPosterior]: String(round2(l.cantEntregada)),
      })
      return `u${n}: change_multiple_column_values(item_id: $item${n}, board_id: $board, column_values: $cv${n}) { id }`
    })
    const declaraciones = tanda
      .map((_, i) => `$item${desde + i}: ID!, $cv${desde + i}: JSON!`)
      .join(', ')
    await mondayApi(
      `mutation ($board: ID!, ${declaraciones}) { ${campos.join('\n')} }`,
      variables,
    )
  }
}
