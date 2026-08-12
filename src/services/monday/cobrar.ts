/**
 * Capa de servicio del cierre de venta. El recibo en "➡️Recibos y Cobros" (18421035524) se crea
 * SÓLO cuando la venta se cobra en el acto:
 *
 *   SIMULTÁNEO → recibo con los totales de la venta, un subelemento por FACTURA emitida (qué se
 *                cancela y por cuánto) y, a continuación, un subelemento por movimiento de pago
 *                (cada medio completa sus propias columnas). La venta con TARJETA entra por acá:
 *                se cobra en el acto y detalla cada cupón.
 *   POSTERIOR  → NO deja recibo. La venta a CUENTA CORRIENTE todavía no cobró nada, así que lo
 *                único que se escribe es su deuda en "💰Fact Vtas Pends de Cobro" (18421035508).
 *                El recibo lo va a crear el cobro de esa deuda, cuando ocurra.
 *
 * El recibo es un efecto SECUNDARIO de la venta: se dispara una vez que la venta existe y sin
 * bloquear al usuario.
 *
 * Igual que el resto de la capa, sin token (`mondayHabilitado`) no se escribe nada y se
 * devuelven ids simulados para que el prototipo siga corriendo en local.
 */
import { cuitCompleto, esRetencion, type BalancePago } from '@/lib/cobros'
import { aIso } from '@/lib/dates'
import { round2 } from '@/lib/format'
import type { MovimientoPago } from '@/types'
import {
  BOARDS,
  CAJA_INDEX,
  COL,
  personCol,
  CHEQUE_ORIGEN_LABEL,
  FACT_PENDIENTE_ESTADO_INDEX,
  FORMA_PAGO_LABEL,
  TIPO_COBRO_LABEL,
} from './columns'
import { mondayApi, mondayHabilitado, mondaySubirArchivo } from './sdk'
import { leerIdVenta } from './venta'

/* ===== 1) El recibo del cobro (board 18421035524) ===== */

/** Subelementos por solicitud, igual que en los subitems del presupuesto. */
const SUBITEMS_POR_TANDA = 25

/** Relación a un ítem de otro board, o `null` si el id no sirve (para poder omitir la columna). */
const relacion = (id: string | null | undefined): { item_ids: number[] } | null => {
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? { item_ids: [n] } : null
}

/** Fecha dd/MM/yyyy → el `{ date: 'yyyy-MM-dd' }` que piden las columnas date, o null si no hay. */
const fechaCol = (valor: string | undefined): { date: string } | null => {
  const iso = aIso(valor ?? '')
  return iso ? { date: iso } : null
}

/** Dropdown por etiqueta. Las que no están en el board se crean (`create_labels_if_missing`). */
const dropdown = (label: string | null | undefined): { labels: string[] } | null =>
  label?.trim() ? { labels: [label.trim()] } : null

/**
 * Columna `file` donde va el comprobante de un movimiento, o null si ese medio no adjunta nada
 * (el efectivo). Las columnas de archivo NO se completan acá: se llenan después, subiendo el
 * binario (ver `subirComprobantes`).
 */
const columnaComprobante = (m: MovimientoPago): string | null => {
  if (m.formaPago === 'Transferencia') return COL.cobroSub.compTransferencia
  if (m.formaPago === 'Tarjeta de débito' || m.formaPago === 'Tarjeta de crédito') {
    return COL.cobroSub.cupon
  }
  // Todas las retenciones (IVA, IIBB, GAN y las que se sumen) comparten la misma columna.
  if (esRetencion(m.formaPago)) return COL.cobroSub.compRetencion
  return null
}

/**
 * Columnas del subelemento de un movimiento de pago. Las dos primeras (medio e importe) las lleva
 * todo movimiento; el resto depende del medio de cobro.
 */
const columnasMovimiento = (b: BalancePago): Record<string, unknown> => {
  const m: MovimientoPago = b.movimiento
  const cv: Record<string, unknown> = {
    [COL.cobroSub.formaPago]: { label: FORMA_PAGO_LABEL[m.formaPago] ?? m.formaPago },
    // Lo RECIBIDO por este medio. Lo cancelado es de la factura, y va en su propio subelemento.
    [COL.cobroSub.importeRecibido]: String(round2(m.importe)),
  }

  if (m.formaPago === 'Transferencia') {
    const banco = relacion(m.cuentaPropiaId)
    if (banco) cv[COL.cobroSub.bancoAcreditacion] = banco
    return cv
  }

  if (m.formaPago === 'Cheque') {
    /* El número del cheque va a "🤖Nro Comprobante", la MISMA columna que usa el certificado de
       retención. Es de texto: se manda tal cual se cargó, sin recortarle nada. */
    const nro = (m.numeroCheque ?? '').trim()
    if (nro) cv[COL.cobroSub.nroComprobante] = nro
    /* El CUIT va a una columna de TEXTO, así que se escribe tal como se cargó, con los guiones del
       formato ("20-45037195-6"). Sólo se manda completo: un CUIT a medio cargar no es un dato. */
    if (cuitCompleto(m.cuitEmisor)) cv[COL.cobroSub.cuit] = m.cuitEmisor
    const emision = fechaCol(m.fechaEmisionCheque)
    if (emision) cv[COL.cobroSub.fechaEmisionCheque] = emision
    // "🤖Fecha Venc" es la MISMA columna que usa el vencimiento de la tarjeta.
    const vencimiento = fechaCol(m.chequeVencimiento)
    if (vencimiento) cv[COL.cobroSub.vencimiento] = vencimiento
    const origen = dropdown(m.formatoCheque ? CHEQUE_ORIGEN_LABEL[m.formatoCheque] : null)
    if (origen) cv[COL.cobroSub.origenCheque] = origen
    const banco = dropdown(m.bancoEmisor)
    if (banco) cv[COL.cobroSub.bancoEmisorCheque] = banco
    return cv
  }

  if (m.formaPago === 'Tarjeta de débito' || m.formaPago === 'Tarjeta de crédito') {
    // Banco EMISOR de la tarjeta (dropdown de texto libre), distinto del banco de acreditación.
    const bancoEmisor = dropdown(m.bancoTarjeta)
    if (bancoEmisor) cv[COL.cobroSub.bancoEmisorCheque] = bancoEmisor
    /* Número de cupón del posnet: es la referencia con la que se concilia la acreditación. Va a
       "🤖Nro Comprobante", la MISMA columna que el nro de cheque y el del certificado. */
    if (m.numeroCupon?.trim()) cv[COL.cobroSub.nroComprobante] = m.numeroCupon.trim()
    const tipo = dropdown(m.tipoTarjeta)
    if (tipo) cv[COL.cobroSub.tipoTarjeta] = tipo
    // "🤖Fecha Venc" es la MISMA columna que usa el vencimiento del cheque.
    const vencimiento = fechaCol(m.vencimientoTarjeta)
    if (vencimiento) cv[COL.cobroSub.vencimiento] = vencimiento
    // Banco de ACREDITACIÓN (cuenta propia de La Batea donde impacta el cobro).
    const banco = relacion(m.cuentaPropiaId)
    if (banco) cv[COL.cobroSub.bancoAcreditacion] = banco
    return cv
  }

  /* RETENCIONES (IVA, IIBB, GAN… y las que se sumen): el certificado que las respalda. Se
     reconocen por el prefijo del medio de cobro, así que una retención nueva entra sola. */
  if (esRetencion(m.formaPago)) {
    /* El número del certificado va a "🤖Nro Comprobante", de TEXTO, así que se guarda tal como lo
       tipeó el vendedor: "0001-00001234" llega con sus guiones y sus ceros a la izquierda. El AÑO
       sigue siendo una columna numérica, y ahí sí viajan sólo los dígitos. */
    const nro = (m.nroComprobanteRetencion ?? '').trim()
    if (nro) cv[COL.cobroSub.nroComprobante] = nro
    const anio = (m.anioRetencion ?? '').replace(/\D/g, '')
    if (anio) cv[COL.cobroSub.anioRet] = anio
    return cv
  }

  /* Efectivo: no agrega ninguna columna de VALOR, le alcanza con el medio y el importe. El
     comprobante de la retención es un archivo, así que va en la subida posterior. */
  return cv
}

/** Nombre del subelemento de una factura cancelada, igual que la etiqueta de "✋Caja". */
const FACT_CANCELADA_LABEL = 'Fact Cancelada'

/**
 * Columnas del subelemento de una FACTURA CANCELADA: qué comprobante se está cancelando y por
 * cuánto. Son tres y siempre las mismas —no dependen del medio de cobro, que es lo que detallan
 * los subelementos de movimiento.
 */
const columnasFactura = (f: FacturaCancelada): Record<string, unknown> => {
  const cv: Record<string, unknown> = {
    // Etiqueta de sistema: va por índice, no por label (no se puede crear al vuelo).
    [COL.cobroSub.formaPago]: { index: CAJA_INDEX.factCancelada },
    [COL.cobroSub.importeCancelado]: String(round2(f.importe)),
  }
  // El ítem de "🧾Facturación" (18422405731). Sin id válido la columna se omite, no se manda vacía.
  const comprobante = relacion(f.facturaId)
  if (comprobante) cv[COL.cobroSub.factCancelada] = comprobante
  return cv
}

/** Una factura emitida por la venta, que este cobro cancela. */
export interface FacturaCancelada {
  /** Ítem del comprobante en "🧾Facturación" (18422405731). */
  facturaId: string
  /** Importe cancelado de ESA factura (su total con IVA). */
  importe: number
}

/**
 * Un subelemento del recibo, ya resuelto: cómo se llama y qué columnas lleva. `balance` sólo lo
 * traen los movimientos de pago, y es lo que permite colgarles después su comprobante (archivo).
 */
interface SubitemRecibo {
  nombre: string
  columnas: Record<string, unknown>
  balance?: BalancePago
}

export interface DatosCobro {
  /** Cliente de la venta: va a la relación "🤖Persona" del recibo. */
  clienteId: string
  /** Nombre del cliente: es el nombre provisorio del ítem hasta que lo renombra la customKey. */
  nombreCliente: string
  /** Vendedor de la operación (usuario de Monday), para la columna Person. */
  vendedorId?: string | null
  /** Total de la venta y lo efectivamente cobrado. La diferencia se deriva. */
  totalVenta?: number
  totalCobrado?: number
  /**
   * Un subelemento por factura emitida en la venta. Van ANTES que los movimientos de pago: primero
   * se declara QUÉ se cancela y después CON QUÉ se pagó. La división de mercadería puede emitir
   * más de un comprobante, y cada uno lleva su propio subelemento.
   */
  facturas?: FacturaCancelada[]
  /** Un subelemento por movimiento de pago cargado. */
  balances?: BalancePago[]
}

/**
 * Crea el recibo del cobro con un subelemento por cada factura cancelada y otro por cada
 * movimiento cargado, en ese orden. El ítem raíz nace con el nombre del cliente; su ID definitivo
 * ("RECIBO-01") lo asigna la customKey del board.
 *
 * SÓLO lo llama el cierre SIMULTÁNEO: es el único momento en que entra plata junto con la venta.
 * La venta a CUENTA CORRIENTE no deja recibo —no hay nada que recibir todavía—, sólo su deuda en
 * "💰Fact Vtas Pends de Cobro".
 */
export async function registrarCobro(datos: DatosCobro): Promise<{ id: string }> {
  const {
    clienteId,
    nombreCliente,
    vendedorId,
    totalVenta = 0,
    totalCobrado = 0,
    facturas = [],
    balances = [],
  } = datos
  if (!mondayHabilitado()) return { id: `mock-cobro-${Date.now()}` }

  const cabecera: Record<string, unknown> = {
    [COL.cobro.tipoCobro]: { label: TIPO_COBRO_LABEL.SIMULTANEO },
    [COL.cobro.totalVenta]: String(round2(totalVenta)),
    [COL.cobro.totalCobrado]: String(round2(totalCobrado)),
    [COL.cobro.diferencia]: String(round2(totalVenta - totalCobrado)),
  }
  const persona = relacion(clienteId)
  if (persona) cabecera[COL.cobro.cliente] = persona
  const personaVendedor = personCol(vendedorId)
  if (personaVendedor) cabecera[COL.cobro.vendedor] = personaVendedor
  /* El vínculo con la venta NO va acá: el board eliminó "📈Ventas" (board_relation_mm4kwppn) del
     ítem —ahora vive en el subelemento— y mandarla rebota la mutación entera. */

  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv, create_labels_if_missing: true) { id }
    }`,
    { boardId: BOARDS.cobros, name: nombreCliente, cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id

  /* Los subelementos del recibo, en el orden en que se leen: PRIMERO qué se cancela (un
     subelemento por factura emitida, que con división de mercadería es más de una) y DESPUÉS con
     qué se pagó (un subelemento por movimiento cargado, sin importar el tipo de cobro: en la venta
     con TARJETA cada CUPÓN es un subelemento). Los comprobantes (cupones/archivos) van en un
     segundo paso, porque necesitan el id del subelemento ya creado. */
  const subitems: SubitemRecibo[] = [
    ...facturas.map((f) => ({
      nombre: FACT_CANCELADA_LABEL,
      columnas: columnasFactura(f),
    })),
    ...balances.map((b) => ({
      nombre: b.movimiento.formaPago,
      columnas: columnasMovimiento(b),
      balance: b,
    })),
  ]
  if (subitems.length > 0) {
    const subitemIds = await crearSubitems(itemId, subitems)
    await subirComprobantes(subitemIds, subitems)
  }

  return { id: itemId }
}

/**
 * Los subelementos del recibo, en tandas de una sola solicitud cada una (alias `m0`, `m1`…).
 * Devuelve el id de cada uno en el MISMO orden en que se pidieron, para poder colgarle después su
 * comprobante al que lo tenga.
 */
async function crearSubitems(itemId: string, subitems: SubitemRecibo[]): Promise<string[]> {
  const ids: string[] = []
  for (let desde = 0; desde < subitems.length; desde += SUBITEMS_POR_TANDA) {
    const tanda = subitems.slice(desde, desde + SUBITEMS_POR_TANDA)
    const variables: Record<string, unknown> = { parentId: itemId }
    const partes = tanda.map((s, i) => {
      const n = desde + i
      variables[`n${n}`] = s.nombre
      variables[`c${n}`] = JSON.stringify(s.columnas)
      return `m${n}: create_subitem(parent_item_id: $parentId, item_name: $n${n}, column_values: $c${n}, create_labels_if_missing: true) { id }`
    })
    const declaraciones = tanda
      .map((_, i) => `$n${desde + i}: String!, $c${desde + i}: JSON!`)
      .join(', ')
    const data = await mondayApi<Record<string, { id: string } | null>>(
      `mutation ($parentId: ID!, ${declaraciones}) { ${partes.join('\n')} }`,
      variables,
    )
    // Los alias se leen por posición: `m0`, `m1`… mantienen el orden pedido.
    tanda.forEach((_, i) => ids.push(data[`m${desde + i}`]?.id ?? ''))
  }
  return ids
}

/**
 * Sube el comprobante de cada movimiento a la columna `file` que le corresponde (comprobante de
 * transferencia o cupón de tarjeta). Es el único camino: `column_values` sólo transporta JSON.
 * Los subelementos de factura cancelada no adjuntan nada: se saltean por no tener `balance`.
 *
 * Cada subida es INDEPENDIENTE y best-effort: que falle el comprobante de un movimiento no puede
 * tumbar los demás ni al recibo, que ya quedó creado con todos sus datos.
 */
async function subirComprobantes(
  subitemIds: string[],
  subitems: SubitemRecibo[],
): Promise<void> {
  const subidas = subitems.flatMap((s, i) => {
    if (!s.balance) return []
    const archivo = s.balance.movimiento.comprobanteArchivo
    const columna = columnaComprobante(s.balance.movimiento)
    /* El id va INLINE en la mutación: en un multipart la única variable es el archivo. Por eso se
       exige que sea numérico, y no un texto cualquiera metido en la query. */
    const subitemId = Number(subitemIds[i])
    if (!archivo || !columna || !Number.isFinite(subitemId) || subitemId <= 0) return []
    return [
      mondaySubirArchivo(
        `mutation ($file: File!) {
          add_file_to_column(item_id: ${subitemId}, column_id: "${columna}", file: $file) { id }
        }`,
        archivo,
      ),
    ]
  })
  // `allSettled`: se intentan todas y ninguna cancela a las otras.
  await Promise.allSettled(subidas)
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

/* ===== 3) Cobro POSTERIOR: la deuda pendiente de cobro ===== */

export interface DatosDeudaPosterior {
  /** Ítem de la venta (board 18421035510) que deja esta deuda. Es lo que la identifica. */
  ventaId: string
  /** Ítem del cliente en Personas (18420688238): quién queda debiendo. */
  clienteId: string
  /** Razón social del cliente: cierra el nombre del ítem. */
  nombreCliente: string
  /** Importe total a cobrar de la venta: la deuda que se genera. */
  total: number
  /**
   * Emisión y vencimiento de la factura que deja la deuda, en dd/MM/yyyy. Son LOS MISMOS que
   * declara el comprobante: la deuda vence cuando vence la factura, no en una fecha propia.
   */
  fechaEmision?: string
  vencimiento?: string
}

/**
 * Camino POSTERIOR: la factura queda pendiente de cobro en "💰Fact Vtas Pends de Cobro",
 * conectada a la VENTA que la originó y al CLIENTE que queda debiendo, con el estado en
 * "Pend de Cobrar 100%".
 *
 * La deuda NO se conecta a la cuenta corriente del cliente ("💵Cta Cte Cliente",
 * board_relation_mkwbweqx): ese vínculo —y el asiento en la cuenta— los resuelve el propio
 * tablero a partir de la venta, así que la app no los escribe.
 *
 * Por eso hace falta el id de la venta, y por eso este paso corre DESPUÉS de que la creación de
 * la venta terminó. Su propio id es la única dependencia real del recibo POSTERIOR (va en
 * "💰Vtas Pends de Cobro" del board de Cobros), y por eso también se espera antes del recibo.
 */
export async function registrarDeudaPosterior(
  datos: DatosDeudaPosterior,
): Promise<{ deudaId: string }> {
  const { ventaId, clienteId, nombreCliente, total, fechaEmision, vencimiento } = datos
  if (!mondayHabilitado()) return { deudaId: `mock-deuda-${Date.now()}` }

  /* El ítem se llama «ID VTA - Cliente» ("VTA-070 - AGRO LUCIA S.A."), así la deuda dice de qué
     venta salió y de quién es sin abrirla. El "🤖ID Venta" lo completa el propio tablero al crear
     el ítem, así que se lee después (con reintentos); si no llegó a tiempo se usa el id de Monday,
     que identifica la venta igual. */
  const idVta = (await leerIdVenta(ventaId).catch(() => '')) || ventaId
  const concepto = `${idVta} - ${nombreCliente}`

  const cv: Record<string, unknown> = {
    [COL.factPendiente.venta]: { item_ids: [Number(ventaId)] },
    [COL.factPendiente.total]: String(round2(total)),
    // Nace sin un peso cobrado: el estado lo irán moviendo los cobros posteriores.
    [COL.factPendiente.estado]: { index: FACT_PENDIENTE_ESTADO_INDEX.pendienteDeCobro },
  }
  // "🤖Personas": quién queda debiendo. Sin id válido la columna se omite, no se manda vacía.
  const persona = relacion(clienteId)
  if (persona) cv[COL.factPendiente.cliente] = persona
  /* Emisión y vencimiento de la factura: es el plazo que tiene el cliente para pagar esta deuda.
     Una fecha vacía o mal formada se omite, igual que el resto de las columnas. */
  const emision = fechaCol(fechaEmision)
  if (emision) cv[COL.factPendiente.fechaEmision] = emision
  const vence = fechaCol(vencimiento)
  if (vence) cv[COL.factPendiente.vencimiento] = vence

  const deuda = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    {
      boardId: BOARDS.factPendientes,
      name: concepto,
      cv: JSON.stringify(cv),
    },
  )

  return { deudaId: deuda.create_item.id }
}
