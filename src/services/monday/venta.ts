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
  TipoEntrega,
  TipoPago,
  TipoVenta,
  VentaEntregaPendiente,
  VentaEntregaProducto,
} from '@/types'
import {
  BOARDS,
  COL,
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
  /** Descuento aplicado a la línea, en %. */
  descuento: number
  /** Rentabilidad de la línea, en %. */
  rentabilidad: number
  codigo?: string
  /** Tipo de mercadería: 'CO' (consignada) o 'COM' (común). Sin dato se factura como común. */
  tipoMercaderia?: string
  /** Proveedor de la mercadería consignada: cada uno se factura por separado. */
  proveedorId?: string
  proveedorNombre?: string
  /** Alícuota de IVA del producto, en %. */
  iva?: number
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
 * En la entrega ANTERIOR esas columnas quedan vacías.
 */
const columnasLinea = (
  l: LineaVenta,
  entregaSimultanea: boolean,
  entregaPosterior: boolean,
): Record<string, unknown> => {
  const cv: Record<string, unknown> = {
    [COL.ventaSub.cantidad]: String(l.cantidad),
    [COL.ventaSub.precioUnit]: String(round2(l.precioUnitario)),
    [COL.ventaSub.descuento]: String(l.descuento),
    [COL.ventaSub.rentabilidad]: String(Math.round(l.rentabilidad)),
  }
  if (entregaSimultanea) {
    cv[COL.ventaSub.cantEntregadaSimult] = String(l.cantidad)
    cv[COL.ventaSub.estadoEntrega] = { index: VENTA_ENTREGA_ESTADO_INDEX.totalmenteEntregada }
  } else if (entregaPosterior) {
    // Entrega POSTERIOR: la mercadería todavía no salió, la línea nace "0% Entregada" (índice 2).
    cv[COL.ventaSub.estadoEntrega] = { index: VENTA_ENTREGA_ESTADO_INDEX.sinEntregar }
  }
  // En el flujo de entrega ANTERIOR las líneas vienen del remito y no traen el producto.
  if (l.productoId) cv[COL.ventaSub.producto] = { item_ids: [Number(l.productoId)] }
  return cv
}

/**
 * Crea la venta con todos sus productos. Lanza si la cabecera falla; si fallan subelementos,
 * devuelve cuántos se crearon para que la vista decida (y no avance).
 */
export async function crearVenta(datos: DatosVenta): Promise<VentaCreada> {
  const { clienteId, nombre, tipoVenta, tipoEntrega, tipoPago, rentabilidad, lineas } = datos

  if (!mondayHabilitado()) {
    return { id: `mock-venta-${Date.now()}`, subitemsCreados: lineas.length }
  }

  // Con entrega simultánea, cada subítem asienta también la cantidad entregada.
  const entregaSimultanea = tipoEntrega === 'SIMULTANEA'
  // Con entrega posterior, la venta y sus líneas nacen "0% Entregado": nada salió todavía.
  const entregaPosterior = tipoEntrega === 'POSTERIOR'

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
  // Con entrega simultánea la mercadería sale con la venta: nace "100% Entregada" (por índice).
  if (entregaSimultanea) {
    cabecera[COL.venta.estadoEntrega] = { index: VENTA_ENTREGA_ESTADO_INDEX.totalmenteEntregada }
  } else if (entregaPosterior) {
    // Entrega POSTERIOR: nada entregado todavía, la venta nace "0% Entregado" (índice 2).
    cabecera[COL.venta.estadoEntrega] = { index: VENTA_ENTREGA_ESTADO_INDEX.sinEntregar }
  }
  if (clienteId) cabecera[COL.venta.cliente] = { item_ids: [Number(clienteId)] }

  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    { boardId: BOARDS.ventas, name: nombre, cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id

  // Los productos van en tandas, cada una en una sola solicitud con alias.
  let subitemsCreados = 0
  for (let desde = 0; desde < lineas.length; desde += PRODUCTOS_POR_TANDA) {
    const tanda = lineas.slice(desde, desde + PRODUCTOS_POR_TANDA)
    const variables: Record<string, unknown> = { parentId: itemId }
    const campos = tanda.map((l, i) => {
      const n = desde + i
      variables[`n${n}`] = l.nombre
      variables[`cv${n}`] = JSON.stringify(columnasLinea(l, entregaSimultanea, entregaPosterior))
      return `s${n}: create_subitem(parent_item_id: $parentId, item_name: $n${n}, column_values: $cv${n}) { id }`
    })
    const declaraciones = tanda
      .map((_, i) => `$n${desde + i}: String!, $cv${desde + i}: JSON!`)
      .join(', ')

    const res = await mondayApi<Record<string, { id: string } | null>>(
      `mutation ($parentId: ID!, ${declaraciones}) { ${campos.join('\n')} }`,
      variables,
    )
    subitemsCreados += tanda.filter((_, i) => res[`s${desde + i}`]?.id).length
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

/* ===== Ventas del cliente con entrega pendiente (origen del remito ANTERIOR) ===== */

/** yyyy-MM-dd(THH…) → dd/MM/yyyy. Sin fecha devuelve '--'. */
const fechaErp = (iso: string): string => {
  const [y, m, d] = (iso ?? '').slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : '--'
}

/**
 * Un producto de la venta pendiente de entregar. El nombre sale del producto conectado en
 * "🤖Producto" (board_relation_mkwctrv6); el subelemento se renombra con IDs y no sirve para
 * mostrar. El pendiente es lo vendido menos lo ya entregado, nunca menor a cero.
 */
function mapProductoEntrega(sub: MondayItem, ventaId: string): VentaEntregaProducto {
  const c = byId(sub)
  const producto = c[COL.ventaSub.producto]?.linked_items?.[0]
  const vendida = numCol(c[COL.ventaSub.cantidad])
  const entregada = numCol(c[COL.ventaSub.cantEntregadaPosterior])
  const estado = c[COL.ventaSub.estadoEntrega]
  return {
    nombre: producto?.name || 'Producto sin asignar',
    codigo: '',
    // La U.M. y el peso salen de las columnas mirror del subelemento (espejan al producto
    // conectado); vienen por display_value.
    um: valor(c[COL.ventaSub.unidadMedida]),
    vendida,
    entregada,
    pendiente: Math.max(vendida - entregada, 0),
    estadoEntrega: estado?.text ?? '',
    /* Sólo se pueden remitar los productos cuyo estado NO es "100% Entregada" (índice 1 de
       color_mm5bhha). Se compara por índice, no por el texto de la etiqueta. */
    seleccionable: estado?.index !== VENTA_ENTREGA_ESTADO_INDEX.totalmenteEntregada,
    subitemId: sub.id,
    productoId: producto?.id,
    ventaId,
    peso: numCol(c[COL.ventaSub.peso]),
  }
}

/**
 * Ventas del cliente con entrega POSTERIOR todavía pendiente, con todos sus productos. Es el
 * origen del remito de emisión ANTERIOR: se entrega lo que quedó por entregar de esas ventas.
 *
 * Los tres filtros van en la consulta, por índice: tipo de entrega "Posterior" (color_mm489k2j),
 * estado de entrega distinto de "100% Entregada" (color_mm58xjgj) y el cliente conectado
 * (board_relation_mm582k6v). El cliente viaja como NÚMERO, no como string. Se trae en una sola
 * consulta con los subelementos.
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

  const data = await mondayApi<{
    boards: {
      items_page: {
        items: (MondayItem & { created_at?: string; subitems: MondayItem[] })[]
      }
    }[]
  }>(
    `query ($cliente: CompareValue!) {
      boards(ids: [${BOARDS.ventas}]) {
        items_page(
          limit: 100,
          query_params: {rules: [
            {column_id: "${COL.venta.tipoEntrega}", compare_value: [${VENTA_ENTREGA_INDEX.posterior}], operator: any_of},
            {column_id: "${COL.venta.estadoEntrega}", compare_value: [${VENTA_ENTREGA_ESTADO_INDEX.totalmenteEntregada}], operator: not_any_of},
            {column_id: "${COL.venta.cliente}", compare_value: $cliente, operator: any_of}
          ]}
        ) {
          items {
            id name created_at
            column_values(ids: ["${COL.venta.idVta}","${COL.venta.estadoEntrega}"]) { id text }
            subitems {
              id name
              column_values(ids: ["${COL.ventaSub.producto}","${COL.ventaSub.cantidad}","${COL.ventaSub.cantEntregadaPosterior}","${COL.ventaSub.estadoEntrega}","${COL.ventaSub.unidadMedida}","${COL.ventaSub.peso}"]) {
                id text
                ... on StatusValue { index }
                ... on MirrorValue { display_value }
                ... on BoardRelationValue { linked_items { id name } }
              }
            }
          }
        }
      }
    }`,
    { cliente: [idNumerico] },
  )

  return (data.boards[0]?.items_page?.items ?? []).map((it) => {
    const c = byId(it)
    return {
      id: it.id,
      // El ID VTA ("VTA-016") es lo que ve el usuario; el name puede ser el del cliente.
      nro: c[COL.venta.idVta]?.text?.trim() || it.name,
      estadoEntrega: c[COL.venta.estadoEntrega]?.text ?? '',
      fecha: fechaErp(it.created_at ?? ''),
      productos: (it.subitems ?? []).map((sub) => mapProductoEntrega(sub, it.id)),
    }
  })
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
