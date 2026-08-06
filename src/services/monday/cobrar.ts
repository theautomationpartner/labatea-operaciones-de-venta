/**
 * Capa de servicio del cierre de venta. SIEMPRE se crea un recibo en "➡️Recibos y Cobros"
 * (18421035524), sea el cobro simultáneo o posterior; lo que cambia es el payload y los
 * subelementos:
 *
 *   SIMULTÁNEO → recibo con los totales de la venta, el vínculo a la venta creada y un
 *                subelemento por movimiento de pago (cada medio completa sus columnas).
 *   POSTERIOR  → recibo apuntando a la deuda de "💰Fact Vtas Pends de Cobro" (18421035508),
 *                SIN subelementos.
 *
 * El recibo es un efecto SECUNDARIO de la venta: se dispara una vez que la venta existe y sin
 * bloquear al usuario. En el POSTERIOR hay una dependencia real —el id de la deuda—, así que esa
 * sí se espera antes de disparar el recibo.
 *
 * Igual que el resto de la capa, sin token (`mondayHabilitado`) no se escribe nada y se
 * devuelven ids simulados para que el prototipo siga corriendo en local.
 */
import { cuitCompleto, esRetencion, valorPorCuota, type BalancePago } from '@/lib/cobros'
import { aIso } from '@/lib/dates'
import { round2 } from '@/lib/format'
import type { MovimientoPago, TipoPago } from '@/types'
import {
  BOARDS,
  COL,
  personCol,
  CHEQUE_ORIGEN_LABEL,
  FACT_PENDIENTE_ESTADO_INDEX,
  FORMA_PAGO_LABEL,
  TIPO_COBRO_LABEL,
} from './columns'
import { mondayApi, mondayHabilitado, mondaySubirArchivo } from './sdk'

/* ===== 1) El recibo del cobro (board 18421035524) ===== */

/** Movimientos por solicitud, igual que en los subitems del presupuesto. */
const MOVIMIENTOS_POR_TANDA = 25

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
    [COL.cobroSub.importe]: String(round2(m.importe)),
  }

  if (m.formaPago === 'Transferencia') {
    const banco = relacion(m.cuentaPropiaId)
    if (banco) cv[COL.cobroSub.bancoAcreditacion] = banco
    return cv
  }

  if (m.formaPago === 'Cheque') {
    // El número de cheque va a una columna numérica: sólo los dígitos.
    const nro = (m.numeroCheque ?? '').replace(/\D/g, '')
    if (nro) cv[COL.cobroSub.nroCheque] = nro
    /* El CUIT va a una columna de TEXTO, así que se escribe tal como se cargó, con los guiones del
       formato ("20-45037195-6"). Sólo se manda completo: un CUIT a medio cargar no es un dato. */
    if (cuitCompleto(m.cuitEmisor)) cv[COL.cobroSub.cuit] = m.cuitEmisor
    const emision = fechaCol(m.fechaEmisionCheque)
    if (emision) cv[COL.cobroSub.fechaEmisionCheque] = emision
    const vencimiento = fechaCol(m.chequeVencimiento)
    if (vencimiento) cv[COL.cobroSub.vencimientoCheque] = vencimiento
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
    if (m.numeroTarjeta) cv[COL.cobroSub.nroTarjeta] = m.numeroTarjeta
    if (m.titularTarjeta) cv[COL.cobroSub.titularTarjeta] = m.titularTarjeta
    const tipo = dropdown(m.tipoTarjeta)
    if (tipo) cv[COL.cobroSub.tipoTarjeta] = tipo
    const vencimiento = fechaCol(m.vencimientoTarjeta)
    if (vencimiento) cv[COL.cobroSub.vencimientoTarjeta] = vencimiento
    // Banco de ACREDITACIÓN (cuenta propia de La Batea donde impacta el cobro).
    const banco = relacion(m.cuentaPropiaId)
    if (banco) cv[COL.cobroSub.bancoAcreditacion] = banco
    // El crédito suma el plan de cuotas: cantidad y cuánto sale cada una.
    if (m.formaPago === 'Tarjeta de crédito' && m.cuotas && m.cuotas > 0) {
      cv[COL.cobroSub.cuotas] = String(m.cuotas)
      cv[COL.cobroSub.valorCuota] = String(valorPorCuota(m.importe, m.cuotas) ?? 0)
    }
    return cv
  }

  /* Efectivo y retenciones no agregan columnas de VALOR: les alcanza con el medio y el importe.
     La retención sí adjunta su comprobante, pero eso es un archivo y va en la subida posterior. */
  return cv
}

export interface DatosCobro {
  /** SIMULTANEO escribe totales y subelementos; POSTERIOR, el vínculo a la deuda. */
  tipoPago: TipoPago
  /** Cliente de la venta: va a la relación "🤖Persona" del recibo. */
  clienteId: string
  /** Nombre del cliente: es el nombre provisorio del ítem hasta que lo renombra la customKey. */
  nombreCliente: string
  /** Vendedor de la operación (usuario de Monday), para la columna Person. */
  vendedorId?: string | null
  /** SIMULTÁNEO: la venta recién creada, que este recibo cobra. */
  ventaId?: string | null
  /** POSTERIOR: la deuda de "Fact Vtas Pends de Cobro" que respalda el cobro. */
  vtaPendienteId?: string | null
  /** SIMULTÁNEO: total de la venta y lo efectivamente cobrado (la diferencia se deriva). */
  totalVenta?: number
  totalCobrado?: number
  /** SIMULTÁNEO: un subelemento por movimiento de pago. En POSTERIOR se ignora. */
  balances?: BalancePago[]
}

/**
 * Crea el recibo del cobro y, si es SIMULTÁNEO, sus movimientos. El ítem raíz nace con el nombre
 * del cliente; su ID definitivo ("RECIBO-01") lo asigna la customKey del board.
 */
export async function registrarCobro(datos: DatosCobro): Promise<{ id: string }> {
  const {
    tipoPago,
    clienteId,
    nombreCliente,
    vendedorId,
    ventaId,
    vtaPendienteId,
    totalVenta = 0,
    totalCobrado = 0,
    balances = [],
  } = datos
  if (!mondayHabilitado()) return { id: `mock-cobro-${Date.now()}` }

  const esSimultaneo = tipoPago === 'SIMULTANEO'
  const cabecera: Record<string, unknown> = {
    [COL.cobro.tipoCobro]: { label: TIPO_COBRO_LABEL[tipoPago] },
  }
  const persona = relacion(clienteId)
  if (persona) cabecera[COL.cobro.cliente] = persona
  const personaVendedor = personCol(vendedorId)
  if (personaVendedor) cabecera[COL.cobro.vendedor] = personaVendedor

  if (esSimultaneo) {
    /* La venta ya existe cuando se crea el recibo, así que el vínculo va de entrada: no hace falta
       un segundo update para cerrarlo. */
    const venta = relacion(ventaId)
    if (venta) cabecera[COL.cobro.venta] = venta
    cabecera[COL.cobro.totalVenta] = String(round2(totalVenta))
    cabecera[COL.cobro.totalCobrado] = String(round2(totalCobrado))
    cabecera[COL.cobro.diferencia] = String(round2(totalVenta - totalCobrado))
  } else {
    // POSTERIOR: el recibo cuelga de la deuda que quedó pendiente de cobro.
    const pendiente = relacion(vtaPendienteId)
    if (pendiente) cabecera[COL.cobro.vtaPendiente] = pendiente
  }

  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv, create_labels_if_missing: true) { id }
    }`,
    { boardId: BOARDS.cobros, name: nombreCliente, cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id

  /* Se detalla UN subelemento por cada movimiento cargado, sin importar el tipo de cobro: en la
     venta con TARJETA (que es POSTERIOR) cada CUPÓN es un subelemento; en la cuenta corriente sin
     cobro en el acto no hay movimientos y no se crea ninguno. Los comprobantes (cupones/archivos)
     van en un segundo paso, porque necesitan el id del subelemento ya creado. */
  if (balances.length > 0) {
    const subitemIds = await crearMovimientos(itemId, balances)
    await subirComprobantes(subitemIds, balances)
  }

  return { id: itemId }
}

/**
 * Un subelemento por movimiento de pago, en tandas de una sola solicitud cada una (alias `m0`,
 * `m1`…). Cada subelemento se nombra con su medio de cobro. Devuelve el id de cada subelemento
 * en el MISMO orden que los balances, para poder colgarles después su comprobante.
 */
async function crearMovimientos(itemId: string, balances: BalancePago[]): Promise<string[]> {
  const ids: string[] = []
  for (let desde = 0; desde < balances.length; desde += MOVIMIENTOS_POR_TANDA) {
    const tanda = balances.slice(desde, desde + MOVIMIENTOS_POR_TANDA)
    const variables: Record<string, unknown> = { parentId: itemId }
    const partes = tanda.map((b, i) => {
      const n = desde + i
      variables[`n${n}`] = b.movimiento.formaPago
      variables[`c${n}`] = JSON.stringify(columnasMovimiento(b))
      return `m${n}: create_subitem(parent_item_id: $parentId, item_name: $n${n}, column_values: $c${n}, create_labels_if_missing: true) { id }`
    })
    const declaraciones = tanda
      .map((_, i) => `$n${desde + i}: String!, $c${desde + i}: JSON!`)
      .join(', ')
    const data = await mondayApi<Record<string, { id: string } | null>>(
      `mutation ($parentId: ID!, ${declaraciones}) { ${partes.join('\n')} }`,
      variables,
    )
    // Los alias se leen por posición: `m0`, `m1`… mantienen el orden de los balances.
    tanda.forEach((_, i) => ids.push(data[`m${desde + i}`]?.id ?? ''))
  }
  return ids
}

/**
 * Sube el comprobante de cada movimiento a la columna `file` que le corresponde (comprobante de
 * transferencia o cupón de tarjeta). Es el único camino: `column_values` sólo transporta JSON.
 *
 * Cada subida es INDEPENDIENTE y best-effort: que falle el comprobante de un movimiento no puede
 * tumbar los demás ni al recibo, que ya quedó creado con todos sus datos.
 */
async function subirComprobantes(subitemIds: string[], balances: BalancePago[]): Promise<void> {
  const subidas = balances.flatMap((b, i) => {
    const archivo = b.movimiento.comprobanteArchivo
    const columna = columnaComprobante(b.movimiento)
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
  /** Importe total a cobrar de la venta: la deuda que se genera. */
  total: number
  /** Nombre del ítem de deuda (p. ej. el cliente y la fecha). */
  concepto: string
}

/**
 * Camino POSTERIOR: la factura queda pendiente de cobro en "💰Fact Vtas Pends de Cobro",
 * conectada a la VENTA que la originó y con el estado en "Pend de Cobrar 100%".
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
  const { ventaId, total, concepto } = datos
  if (!mondayHabilitado()) return { deudaId: `mock-deuda-${Date.now()}` }

  const deuda = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    {
      boardId: BOARDS.factPendientes,
      name: concepto,
      cv: JSON.stringify({
        [COL.factPendiente.venta]: { item_ids: [Number(ventaId)] },
        [COL.factPendiente.total]: String(round2(total)),
        // Nace sin un peso cobrado: el estado lo irán moviendo los cobros posteriores.
        [COL.factPendiente.estado]: { index: FACT_PENDIENTE_ESTADO_INDEX.pendienteDeCobro },
      }),
    },
  )

  return { deudaId: deuda.create_item.id }
}
