/**
 * Registro de comisiones en "💲Registro de Comisiones" (18421035548).
 *
 * Se dispara al FINALIZAR la operación de venta (universal: cualquier tipo de venta o entrega),
 * con la venta ya creada y —si el cobro es POSTERIOR— la deuda ya registrada. El flujo es un
 * pre-flight con salida temprana:
 *   1) se lee del Maestro, por producto, si es comisionable ("✋️Comision" = "SI") y su % de comisión;
 *   2) se filtran SÓLO los comisionables; si no queda ninguno, se aborta en silencio (sin mutación);
 *   3) se crea el ítem padre de la comisión y, recién con su id, el bulk de subítems comisionables.
 *
 * El % de comisión sale del Maestro según el tipo de venta: "Porc Com Activa" (CON PRESUPUESTO
 * PREVIO) o "Porc Com Pasiva" (DIRECTA).
 */
import { round2 } from '@/lib/format'
import type { TipoPago, TipoVenta } from '@/types'
import { BOARDS, COL, personCol } from './columns'
import { byId, numCol, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Una línea de la venta candidata a comisión: producto, cantidad y precio unitario vendido. */
export interface LineaComision {
  /** Ítem del Maestro de Productos. Sin él la línea no se puede evaluar ni linkear. */
  productoId?: string
  /** Nombre del producto: es el nombre del subítem de comisión. */
  nombre: string
  cantidad: number
  precioUnitario: number
}

export interface DatosComision {
  /** Venta recién creada (board_relation_mm4d72qt). */
  ventaId: string
  /** Cliente de la venta (board_relation_mm5s28j3). */
  clienteId?: string
  /** ID del vendedor de la operación (usuario de Monday). Se asigna en la columna Person. */
  vendedorId?: string | null
  tipoVenta: TipoVenta
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

/** El producto es comisionable sólo si "✋️Comision" es exactamente "SI" (sin dato → no comisiona). */
const esComisionable = (texto: string | null | undefined): boolean =>
  (texto ?? '').trim().toUpperCase() === 'SI'

/**
 * Crea la comisión de la venta: ítem padre + un subítem por producto comisionable. Si ningún
 * producto del Maestro es comisionable ("SI"), no ejecuta ninguna mutación (salida temprana).
 * El bulk de subítems espera (`await`) el id del ítem padre antes de correr.
 */
export async function crearComisiones(datos: DatosComision): Promise<void> {
  const { ventaId, clienteId, vendedorId, tipoVenta, tipoPago, importeTotalVenta, fecha, pendienteCobroId, lineas } =
    datos
  if (!mondayHabilitado()) return

  const conProd = lineas.filter((l) => l.productoId && l.cantidad > 0)
  if (conProd.length === 0) return

  // Pre-fetch del Maestro: condición de comisión y los dos porcentajes, por producto.
  const productoIds = [...new Set(conProd.map((l) => l.productoId as string))]
  const data = await mondayApi<{ items: MondayItem[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        id
        column_values(ids: ["${COL.producto.comisionable}","${COL.producto.porcComActiva}","${COL.producto.porcComPasiva}"]) { id text }
      }
    }`,
    { ids: productoIds },
  )

  // productId → { comisionable, % activa (con presupuesto previo), % pasiva (directa) }.
  const metaPorProducto = new Map<string, { comisionable: boolean; pctActiva: number; pctPasiva: number }>()
  for (const it of data.items ?? []) {
    const c = byId(it)
    metaPorProducto.set(it.id, {
      comisionable: esComisionable(c[COL.producto.comisionable]?.text),
      pctActiva: numCol(c[COL.producto.porcComActiva]),
      pctPasiva: numCol(c[COL.producto.porcComPasiva]),
    })
  }

  // GUARDRAIL: sólo los productos comisionables ("SI"). Sin ninguno, se aborta sin mutar el board.
  const comisionables = conProd.filter((l) => metaPorProducto.get(l.productoId as string)?.comisionable)
  if (comisionables.length === 0) return

  // El % de comisión del producto sale del Maestro según el tipo de venta activo.
  const conPresupuestoPrevio = tipoVenta === 'CON PRESUPUESTO PREVIO'
  const pctComision = (productoId: string): number => {
    const meta = metaPorProducto.get(productoId)
    if (!meta) return 0
    return conPresupuestoPrevio ? meta.pctActiva : meta.pctPasiva
  }

  // MÓDULO 1: monto pendiente de cobro. POSTERIOR = total de la venta; SIMULTANEO = 0 explícito.
  const montoPendiente = tipoPago === 'POSTERIOR' ? round2(importeTotalVenta) : 0

  // MÓDULO 3: ítem padre de la comisión. La relación con el cobro sólo va si es POSTERIOR. El monto
  // pendiente va como NÚMERO (no string); el estado nace en "Pend de Cobro" (por label). La comisión
  // total en $ NO se escribe acá: la consolida el board por mirror desde los subítems comisionables.
  const cabecera: Record<string, unknown> = {
    [COL.comision.fecha]: { date: fecha },
    [COL.comision.venta]: { item_ids: [Number(ventaId)] },
    [COL.comision.pendienteCobro]: montoPendiente,
    [COL.comision.estado]: { label: 'Pend de Cobro' },
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

  // Bulk de subítems, uno por producto comisionable, con alias en una sola solicitud. Cada subítem
  // se nombra con su producto.
  const variables: Record<string, unknown> = { parentId }
  const campos = comisionables.map((l, i) => {
    const cv: Record<string, unknown> = {
      [COL.comisionSub.producto]: { item_ids: [Number(l.productoId)] },
      [COL.comisionSub.cantidad]: String(round2(l.cantidad)),
      [COL.comisionSub.precioUnit]: String(round2(l.precioUnitario)),
      [COL.comisionSub.comision]: String(round2(pctComision(l.productoId as string))),
    }
    variables[`sn${i}`] = l.nombre
    variables[`scv${i}`] = JSON.stringify(cv)
    return `s${i}: create_subitem(parent_item_id: $parentId, item_name: $sn${i}, column_values: $scv${i}) { id }`
  })
  const decl = comisionables.map((_, i) => `$sn${i}: String!, $scv${i}: JSON!`).join(', ')
  await mondayApi(`mutation ($parentId: ID!, ${decl}) { ${campos.join('\n')} }`, variables)
}
