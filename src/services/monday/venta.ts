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
import { round2 } from '@/lib/format'
import type { Moneda, TipoEntrega, TipoVenta } from '@/types'
import {
  BOARDS,
  COL,
  VENTA_COBRO_INDEX,
  VENTA_ENTREGA_INDEX,
  VENTA_TIPO_INDEX,
} from './columns'
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
  /** El cobro se hizo con la factura (contado) o queda para después (cuenta corriente). */
  cobroSimultaneo: boolean
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
 * también como cantidad entregada; en los otros tipos de entrega esa columna queda vacía.
 */
const columnasLinea = (l: LineaVenta, entregaSimultanea: boolean): Record<string, unknown> => {
  const cv: Record<string, unknown> = {
    [COL.ventaSub.cantidad]: String(l.cantidad),
    [COL.ventaSub.precioUnit]: String(round2(l.precioUnitario)),
    [COL.ventaSub.descuento]: String(l.descuento),
    [COL.ventaSub.rentabilidad]: String(Math.round(l.rentabilidad)),
  }
  if (entregaSimultanea) cv[COL.ventaSub.cantEntregadaSimult] = String(l.cantidad)
  // En el flujo de entrega ANTERIOR las líneas vienen del remito y no traen el producto.
  if (l.productoId) cv[COL.ventaSub.producto] = { item_ids: [Number(l.productoId)] }
  return cv
}

/**
 * Crea la venta con todos sus productos. Lanza si la cabecera falla; si fallan subelementos,
 * devuelve cuántos se crearon para que la vista decida (y no avance).
 */
export async function crearVenta(datos: DatosVenta): Promise<VentaCreada> {
  const { clienteId, nombre, tipoVenta, tipoEntrega, cobroSimultaneo, rentabilidad, lineas } = datos

  if (!mondayHabilitado()) {
    return { id: `mock-venta-${Date.now()}`, subitemsCreados: lineas.length }
  }

  // Con entrega simultánea, cada subítem asienta también la cantidad entregada.
  const entregaSimultanea = tipoEntrega === 'SIMULTANEA'

  const cabecera: Record<string, unknown> = {
    [COL.venta.tipoVenta]: { index: indiceTipoVenta(tipoVenta) },
    [COL.venta.tipoEntrega]: { index: indiceTipoEntrega(tipoEntrega) },
    [COL.venta.tipoCobro]: {
      index: cobroSimultaneo ? VENTA_COBRO_INDEX.simultaneo : VENTA_COBRO_INDEX.posterior,
    },
    [COL.venta.rentabilidad]: String(Math.round(rentabilidad)),
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
      variables[`cv${n}`] = JSON.stringify(columnasLinea(l, entregaSimultanea))
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
