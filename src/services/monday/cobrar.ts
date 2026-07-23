/**
 * Capa de servicio del cierre de venta. El flujo se bifurca por el tipo de cobro y cada
 * camino escribe en tableros distintos:
 *
 *   SIMULTÁNEO → un recibo en "➡️Recibos y Cobros" (18421035524) con un subelemento por
 *                movimiento de pago. Exige que lo cobrado sea el 100% del total.
 *   POSTERIOR  → ningún recibo. Se crea la deuda en "💰Fact Vtas Pends de Cobro"
 *                (18421035508) y su movimiento en la Cta Cte del cliente (18421858762).
 *
 * Igual que el resto de la capa, sin token (`mondayHabilitado`) no se escribe nada y se
 * devuelven ids simulados para que el prototipo siga corriendo en local.
 */
import type { BalancePago } from '@/lib/cobros'
import { round2 } from '@/lib/format'
import {
  BOARDS,
  COL,
  FACT_PENDIENTE_ESTADO_INDEX,
  FORMA_PAGO_LABEL,
} from './columns'
import { mondayApi, mondayHabilitado } from './sdk'

/* ===== 1) Cobro SIMULTÁNEO: recibo + movimientos ===== */

/** Movimientos por solicitud, igual que en los subitems del presupuesto. */
const MOVIMIENTOS_POR_TANDA = 25

export interface DatosCobroSimultaneo {
  /** Total a cobrar de la venta. En simultáneo tiene que coincidir con lo cancelado. */
  totalACobrar: number
  /**
   * Deuda saldada por el cobro: lo que entra a caja más los descuentos por forma de pago.
   * Es el número que tiene que dar el 100%, no la caja sola. Lo que efectivamente entra
   * viaja en el `montoCobrado` de cada movimiento.
   */
  cancelado: number
  balances: BalancePago[]
  /** Ítem de Cta Cte del cliente, para dejar el recibo conectado a su cuenta. */
  ctaCteId?: string
  /** Nombre del cliente: es el nombre provisorio del ítem hasta que se lo renombra. */
  nombreCliente: string
}

/** Un movimiento de pago tal como se escribe en el subelemento del recibo. */
const columnasMovimiento = (b: BalancePago): Record<string, unknown> => {
  const cv: Record<string, unknown> = {
    [COL.cobroSub.formaPago]: { label: FORMA_PAGO_LABEL[b.movimiento.formaPago] },
    [COL.cobroSub.importe]: String(round2(b.movimiento.importe)),
    [COL.cobroSub.descuento]: String(b.descuentoPct),
    [COL.cobroSub.montoCobrado]: String(round2(b.montoCobrado)),
  }
  if (b.movimiento.referencia) cv[COL.cobroSub.referencia] = b.movimiento.referencia
  // El vencimiento sólo existe en el cheque, y la columna date lo quiere en yyyy-MM-dd.
  const [d, m, y] = b.movimiento.chequeVencimiento.split('/')
  if (d && m && y) {
    cv[COL.cobroSub.vencimiento] = { date: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` }
  }
  return cv
}

/**
 * Crea el recibo del cobro simultáneo: la cabecera con el importe que cancela y un
 * subelemento por movimiento de pago, todos en la misma solicitud (alias `m0`, `m1`…).
 *
 * La validación del 100% NO vive acá: es una regla de negocio (`cobroCompleto` en
 * `lib/cobros`) y la vista bloquea el registro antes de llamar a esta función. Igual se
 * revalida para no escribir un recibo incompleto si alguien la llama de otro lado.
 */
export async function registrarCobroSimultaneo(
  datos: DatosCobroSimultaneo,
): Promise<{ id: string }> {
  const { totalACobrar, cancelado, balances, ctaCteId, nombreCliente } = datos
  if (round2(cancelado) !== round2(totalACobrar)) {
    throw new Error('El cobro simultáneo exige cancelar el 100% del total de la venta.')
  }
  if (!mondayHabilitado()) return { id: `mock-cobro-${Date.now()}` }

  /* La cabecera lleva el importe que el recibo cancela (el total de la venta), igual que
     antes: lo que entra a caja se lee sumando el "monto cobrado" de los movimientos. */
  const cabecera: Record<string, unknown> = {
    [COL.cobro.totalCobrado]: String(round2(cancelado)),
  }
  if (ctaCteId) cabecera[COL.cobro.ctaCte] = { item_ids: [Number(ctaCteId)] }

  const creado = await mondayApi<{
    create_item: { id: string; column_values: { text: string | null }[] }
  }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) {
        id
        column_values(ids: ["${COL.cobro.pulseId}"]) { text }
      }
    }`,
    { boardId: BOARDS.cobros, name: nombreCliente, cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id
  const pulseRecibo = creado.create_item.column_values[0]?.text || itemId

  // Los movimientos van en tandas, en una sola solicitud cada una.
  for (let desde = 0; desde < balances.length; desde += MOVIMIENTOS_POR_TANDA) {
    const tanda = balances.slice(desde, desde + MOVIMIENTOS_POR_TANDA)
    const alias = tanda.map((_, i) => `m${desde + i}`)
    const variables: Record<string, unknown> = { parentId: itemId }
    const partes = tanda.map((b, i) => {
      const a = alias[i]
      variables[`n${desde + i}`] = `${pulseRecibo} - ${b.movimiento.formaPago}`
      variables[`c${desde + i}`] = JSON.stringify(columnasMovimiento(b))
      return `${a}: create_subitem(parent_item_id: $parentId, item_name: $n${desde + i}, column_values: $c${desde + i}) { id }`
    })
    const declaraciones = tanda
      .map((_, i) => `$n${desde + i}: String!, $c${desde + i}: JSON!`)
      .join(', ')
    await mondayApi(
      `mutation ($parentId: ID!, ${declaraciones}) { ${partes.join('\n')} }`,
      variables,
    )
  }

  // El recibo se renombra con su ID del board, igual que el presupuesto.
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $name: String!) {
      change_simple_column_value(item_id: $id, board_id: $board, column_id: "name", value: $name) { id }
    }`,
    { id: itemId, board: BOARDS.cobros, name: pulseRecibo },
  )

  return { id: itemId }
}

/**
 * Deja el recibo apuntando a la venta que cobra ("📈Ventas" en el board de Cobros). Se hace
 * al final del cierre porque la venta nace después que el recibo: cuando se registra el cobro
 * todavía no existe el ítem al que linkear.
 */
export async function vincularVentaAlCobro(cobroId: string, ventaId: string): Promise<void> {
  if (!mondayHabilitado() || !cobroId || !ventaId) return
  await mondayApi(
    `mutation ($itemId: ID!, $boardId: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $cv) { id }
    }`,
    {
      itemId: cobroId,
      boardId: BOARDS.cobros,
      cv: JSON.stringify({ [COL.cobro.venta]: { item_ids: [Number(ventaId)] } }),
    },
  )
}

/* ===== 2) Caja (pendiente): conciliación del cobro ===== */

/*
 * TODO(Caja): el tablero de Caja todavía no existe. Cuando se cree, este es el punto de
 * salida del cobro hacia la conciliación: recibe el recibo ya creado y sus movimientos, y
 * debería crear un ítem por movimiento en la caja que corresponda (la columna "✋Caja" del
 * subelemento ya trae esa clasificación).
 *
 * export interface DatosCaja {
 *   cobroId: string
 *   fecha: string
 *   movimientos: { formaPago: string; montoCobrado: number; referencia: string }[]
 * }
 *
 * export async function enviarCobroACaja(datos: DatosCaja): Promise<void> {
 *   if (!mondayHabilitado()) return
 *   await mondayApi(
 *     `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
 *       create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
 *     }`,
 *     { boardId: BOARDS.caja, name: datos.cobroId, cv: JSON.stringify({ ... }) },
 *   )
 * }
 */

/* ===== 3) Cobro POSTERIOR: deuda + movimiento de cuenta corriente ===== */

/**
 * Saldo final del último movimiento de la Cta Cte del cliente. Si la cuenta no tiene
 * movimientos, el saldo anterior del primero es 0. "Último" es el de creación más reciente,
 * no el que esté último en el board.
 */
export async function getSaldoAnteriorCtaCte(ctaCteId: string): Promise<number> {
  if (!mondayHabilitado()) return 0
  const data = await mondayApi<{
    items: {
      subitems: { id: string; created_at: string; column_values: { text: string | null }[] }[]
    }[]
  }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        subitems {
          id created_at
          column_values(ids: ["${COL.ctaCteSub.saldoFinal}"]) { text }
        }
      }
    }`,
    { ids: [ctaCteId] },
  )
  const subitems = data.items[0]?.subitems ?? []
  // Sin movimientos previos, el primero arranca de cero.
  if (subitems.length === 0) return 0
  /* Del más nuevo al más viejo, el primero que tenga saldo final cargado. Un movimiento
     recién creado y todavía sin calcular no debe arrastrar el saldo del cliente a cero. */
  const porFecha = [...subitems].sort((a, b) => b.created_at.localeCompare(a.created_at))
  for (const sub of porFecha) {
    const texto = String(sub.column_values[0]?.text ?? '').trim()
    if (!texto) continue
    const saldo = Number(texto.replace(/[^\d.-]/g, ''))
    if (Number.isFinite(saldo)) return saldo
  }
  return 0
}

export interface DatosDeudaPosterior {
  /** Ítem de Cta Cte del cliente: es la cuenta que se endeuda. */
  ctaCteId: string
  /** Importe total a cobrar de la venta: la deuda que se genera. */
  total: number
  /** Nombre del movimiento en la cuenta corriente (p. ej. el cliente y la fecha). */
  concepto: string
}

/**
 * Camino POSTERIOR: no se crea ningún recibo. Se endeuda la cuenta corriente del cliente y
 * se deja la factura pendiente de cobro que la respalda, en ese orden:
 *
 *   1. Subelemento en la Cta Cte con el saldo anterior arrastrado, la venta en "Ventas" y el
 *      saldo final ya calculado (saldo inicial + ventas − cobros).
 *   2. Ítem en "💰Fact Vtas Pends de Cobro" conectado a la Cta Cte, con el total de la venta
 *      y el estado en "Pend de Cobrar 100%".
 */
export async function registrarDeudaPosterior(
  datos: DatosDeudaPosterior,
): Promise<{ deudaId: string; movimientoId: string; saldoAnterior: number }> {
  const { ctaCteId, total, concepto } = datos
  if (!mondayHabilitado()) {
    return { deudaId: `mock-deuda-${Date.now()}`, movimientoId: `mock-mov-${Date.now()}`, saldoAnterior: 0 }
  }

  /* 1) El movimiento de la cuenta corriente arrastra el saldo del movimiento anterior y deja
        calculado el suyo: saldo inicial + ventas − cobros. Esta deuda no ingresa dinero, así
        que los cobros van en cero. El saldo final se escribe junto con el resto de las
        columnas: si quedara vacío, el movimiento siguiente arrancaría de la nada. */
  const saldoAnterior = await getSaldoAnteriorCtaCte(ctaCteId)
  const cobros = 0
  const saldoFinal = saldoAnterior + total - cobros
  const movimiento = await mondayApi<{ create_subitem: { id: string } }>(
    `mutation ($parentId: ID!, $name: String!, $cv: JSON!) {
      create_subitem(parent_item_id: $parentId, item_name: $name, column_values: $cv) { id }
    }`,
    {
      parentId: ctaCteId,
      name: concepto,
      cv: JSON.stringify({
        [COL.ctaCteSub.saldoAnterior]: String(round2(saldoAnterior)),
        [COL.ctaCteSub.ventas]: String(round2(total)),
        [COL.ctaCteSub.cobros]: String(round2(cobros)),
        [COL.ctaCteSub.saldoFinal]: String(round2(saldoFinal)),
      }),
    },
  )

  // 2) La factura pendiente de cobro, conectada a la cuenta corriente del cliente.
  const deuda = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    {
      boardId: BOARDS.factPendientes,
      name: concepto,
      cv: JSON.stringify({
        [COL.factPendiente.ctaCte]: { item_ids: [Number(ctaCteId)] },
        [COL.factPendiente.total]: String(round2(total)),
        // Nace sin un peso cobrado: el estado lo irán moviendo los cobros posteriores.
        [COL.factPendiente.estado]: { index: FACT_PENDIENTE_ESTADO_INDEX.pendienteDeCobro },
      }),
    },
  )

  return {
    deudaId: deuda.create_item.id,
    movimientoId: movimiento.create_subitem.id,
    saldoAnterior,
  }
}
