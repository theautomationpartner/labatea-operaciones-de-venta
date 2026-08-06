/**
 * Registro de comisiones en "💲Registro de Comisiones" (18421035548).
 *
 * Se dispara al FINALIZAR la operación de venta (universal: cualquier tipo de venta o entrega),
 * con la venta ya creada y —si el cobro es POSTERIOR— la deuda ya registrada:
 *   1) se filtran SÓLO las líneas comisionables; si no queda ninguna, se aborta en silencio;
 *   2) se crea el ítem padre de la comisión y, recién con su id, el bulk de subítems.
 *
 * Ya NO hay comisión por producto: la tasa es ÚNICA por tipo de venta y sale del tablero de
 * configuración ("Comision por Venta": Activa = CON PRESUPUESTO PREVIO, Pasiva = DIRECTA). El
 * producto sólo decide si comisiona, y eso ya viene resuelto en la línea —del Maestro en la venta
 * DIRECTA, del subelemento del presupuesto en la CON PRESUPUESTO PREVIO—, así que este servicio no
 * vuelve a consultar el Maestro.
 */
import { round2 } from '@/lib/format'
import { comisionLinea, tasaComision } from '@/lib/selectors'
import type { ComisionesVenta, TipoPago, TipoVenta } from '@/types'
import { BOARDS, COL, COMISION_ESTADO_PENDIENTE_LABEL, personCol } from './columns'
import { mondayApi, mondayHabilitado } from './sdk'

/** Una línea de la venta candidata a comisión: producto, cantidad y precio unitario vendido. */
export interface LineaComision {
  /** Ítem del Maestro de Productos. Sin él la línea no se puede linkear. */
  productoId?: string
  /** Nombre del producto: es el nombre del subítem de comisión. */
  nombre: string
  cantidad: number
  precioUnitario: number
  /**
   * Importe NETO de la línea: precio SIN IVA y con el descuento total ya aplicado. Es la base
   * sobre la que se calcula la comisión, la misma que muestra el resumen de la venta.
   */
  neto: number
  /** El producto comisiona ("Comision" = SI), resuelto al seleccionar los productos de la venta. */
  comisionable: boolean
}

export interface DatosComision {
  /** Venta recién creada (board_relation_mm4d72qt). */
  ventaId: string
  /** Cliente de la venta (board_relation_mm5s28j3). */
  clienteId?: string
  /** ID del vendedor de la operación (usuario de Monday). Se asigna en la columna Person. */
  vendedorId?: string | null
  tipoVenta: TipoVenta
  /** Tasas del tablero de configuración: de acá sale el % que se escribe en cada subítem. */
  comisiones: ComisionesVenta
  /** Tipo de cobro de la operación: define el monto pendiente (POSTERIOR = total; SIMULTANEO = 0). */
  tipoPago: TipoPago
  /** Importe total de la venta (con IVA). Es el monto pendiente cuando el cobro es POSTERIOR. */
  importeTotalVenta: number
  /** Fecha de emisión de la factura, en YYYY-MM-DD. */
  fecha: string
  /** POSTERIOR: id de la "Vta Pend de Cobro" (deuda). SIMULTANEO: undefined → se omite la columna. */
  pendienteCobroId?: string
  lineas: LineaComision[]
}

/**
 * Crea la comisión de la venta: ítem padre + un subítem por producto comisionable. Si NINGÚN
 * producto de la venta comisiona no se escribe nada: una venta sin comisión no deja registro.
 * El bulk de subítems espera (`await`) el id del ítem padre antes de correr.
 */
export async function crearComisiones(datos: DatosComision): Promise<void> {
  const {
    ventaId,
    clienteId,
    vendedorId,
    tipoVenta,
    comisiones,
    tipoPago,
    importeTotalVenta,
    fecha,
    pendienteCobroId,
    lineas,
  } = datos
  // Sin venta creada no hay a qué colgar la comisión.
  if (!mondayHabilitado() || !ventaId) return

  /* GUARDRAIL: sólo las líneas comisionables y con producto linkeable. La condición ya viene
     resuelta de la selección de productos. Sin ninguna, se aborta sin tocar el board. */
  const comisionables = lineas.filter((l) => l.productoId && l.cantidad > 0 && l.comisionable)
  if (comisionables.length === 0) return

  // Una sola tasa para toda la venta, según su tipo. Es la que se asienta en cada subítem.
  const pctComision = tasaComision(comisiones, tipoVenta)
  /* Comisión FINAL de la venta: la tasa sobre el neto de cada línea comisionable. Es exactamente
     el número que el vendedor vio en el resumen, calculado con el mismo helper. */
  const comisionTotal = round2(
    comisionables.reduce((acc, l) => acc + comisionLinea(l.neto, true, pctComision), 0),
  )

  // MÓDULO 1: monto pendiente de cobro. POSTERIOR = total de la venta; SIMULTANEO = 0 explícito.
  const montoPendiente = tipoPago === 'POSTERIOR' ? round2(importeTotalVenta) : 0

  /* Ítem padre de la comisión. La relación con el cobro sólo va si es POSTERIOR. Los importes van
     como NÚMERO (no string) y el estado nace en "Pend de Cobro" (por label). */
  const cabecera: Record<string, unknown> = {
    [COL.comision.fecha]: { date: fecha },
    [COL.comision.venta]: { item_ids: [Number(ventaId)] },
    [COL.comision.pendienteCobro]: montoPendiente,
    [COL.comision.total]: comisionTotal,
    // Nace "Pend de Liquidar": el label que se mandaba antes ("Pend de Cobro") no existe en el board.
    [COL.comision.estado]: { label: COMISION_ESTADO_PENDIENTE_LABEL },
  }
  // MÓDULO 1: se linkea el cliente de la venta en la cabecera de la comisión.
  if (clienteId && Number.isFinite(Number(clienteId))) {
    cabecera[COL.comision.cliente] = { item_ids: [Number(clienteId)] }
  }
  // Vendedor de la operación (columna Person): el seleccionado en el encabezado.
  const personaVendedor = personCol(vendedorId)
  if (personaVendedor) cabecera[COL.comision.vendedor] = personaVendedor
  if (pendienteCobroId && Number.isFinite(Number(pendienteCobroId))) {
    cabecera[COL.comision.cobroPendiente] = { item_ids: [Number(pendienteCobroId)] }
  }

  // El ítem raíz nace con el nombre general del tablero; su ID lo asigna la customKey del board.
  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    { boardId: BOARDS.comisiones, name: 'Comisiones', cv: JSON.stringify(cabecera) },
  )
  const parentId = creado.create_item.id

  /* Bulk de subítems, uno por producto comisionable, con alias en una sola solicitud. Cada subítem
     se nombra con su producto. */
  const variables: Record<string, unknown> = { parentId }
  const campos = comisionables.map((l, i) => {
    const cv: Record<string, unknown> = {
      [COL.comisionSub.producto]: { item_ids: [Number(l.productoId)] },
      [COL.comisionSub.cantidad]: String(round2(l.cantidad)),
      [COL.comisionSub.precioUnit]: String(round2(l.precioUnitario)),
      [COL.comisionSub.comision]: String(round2(pctComision)),
    }
    variables[`sn${i}`] = l.nombre
    variables[`scv${i}`] = JSON.stringify(cv)
    return `s${i}: create_subitem(parent_item_id: $parentId, item_name: $sn${i}, column_values: $scv${i}) { id }`
  })
  const decl = comisionables.map((_, i) => `$sn${i}: String!, $scv${i}: JSON!`).join(', ')
  await mondayApi(`mutation ($parentId: ID!, ${decl}) { ${campos.join('\n')} }`, variables)
}
