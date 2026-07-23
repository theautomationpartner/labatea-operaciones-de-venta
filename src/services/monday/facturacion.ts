/**
 * Creación de los comprobantes en el board "Facturación" (18422405731).
 *
 * Corre al tocar "Emitir factura": la venta ya está creada y ya se evaluó su mercadería
 * (`comprobantesDeVenta`), así que acá sólo se escriben los ítems que salieron de esa
 * evaluación —uno por mercadería común y uno por proveedor de mercadería consignada—.
 *
 * Son 1 + N solicitudes: UNA mutation con todos los comprobantes (alias `f0`, `f1`, …) y
 * después UNA mutation por comprobante con todas sus líneas (alias `s0`, `s1`, …). Los
 * subelementos no pueden ir en la misma solicitud que los ítems porque necesitan el id del
 * padre, que recién se conoce cuando la primera vuelve.
 */
import { addDays } from '@/lib/dates'
import { alicuotaDe, precioFacturado, type ComprobanteAGenerar } from '@/lib/facturacion'
import type {
  Cliente,
  ComprobanteEmitido,
  CondicionIVA,
  LetraComprobante,
  MonedaFactura,
} from '@/types'
import {
  BOARDS,
  COL,
  FACT_CONDICION_VENTA,
  FACT_MONEDA_LABEL,
  FACT_PUNTO_VENTA_DEFAULT,
  FACT_SIT_IVA_LABEL,
  FACT_SUB_PROD_SERV,
  FACT_SUB_UNIDAD_MEDIDA,
  FACT_TIPO_COMPROBANTE,
  FACT_VENCIMIENTO_DIAS,
} from './columns'
import { mondayApi, mondayHabilitado } from './sdk'

/** Líneas por solicitud, igual que en el presupuesto y en la venta. */
const LINEAS_POR_TANDA = 25

/** Datos de la cabecera, comunes a todos los comprobantes de la misma venta. */
export interface DatosFacturacion {
  cliente: Cliente
  moneda: MonedaFactura
  /** Sólo se escribe en comprobantes en dólares. */
  tipoCambio: number
  letra: LetraComprobante
  /** Condición del receptor frente al IVA, ya resuelta por la ficha. */
  ivaReceptor: CondicionIVA
  /** Fecha de emisión en dd/MM/yyyy (formato del ERP). */
  fechaEmision: string
  observaciones: string
  /** Ítem de la venta en "📈Ventas", para dejar el comprobante conectado a ella. */
  ventaId?: string | null
}

/** Un comprobante ya escrito en el board. Es lo que la vista guarda en el estado. */
export type ComprobanteCreado = ComprobanteEmitido

/** dd/MM/yyyy → yyyy-MM-dd (formato que espera la columna date de Monday). */
const fechaMonday = (v: string): string | null => {
  const [d, m, y] = v.split('/')
  return d && m && y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null
}

/**
 * "Condición de Venta" a partir de la condición de pago del cliente. El board tiene tres
 * etiquetas y el cliente cinco condiciones posibles: las que hablan de contado van a
 * "Contado" y las demás (cuenta corriente y los plazos de proveedor) a "Cuenta Corriente".
 */
const condicionVentaDe = (condicionPago: string): string =>
  /contado/i.test(condicionPago) ? FACT_CONDICION_VENTA.contado : FACT_CONDICION_VENTA.cuentaCorriente

/** El CUIT va a una columna numérica: se manda sin guiones ni espacios. */
const soloDigitos = (v: string): string => (v ?? '').replace(/\D/g, '')

/**
 * Cabecera del comprobante. Todos los dropdown se escriben por label, como están en el board.
 * Es igual para los tres comprobantes de una misma venta: lo único que los distingue —qué
 * mercadería lleva cada uno— queda en el nombre del ítem y en sus líneas.
 */
function columnasComprobante(
  comprobante: ComprobanteAGenerar,
  datos: DatosFacturacion,
): Record<string, unknown> {
  const { cliente, moneda, tipoCambio, letra, ivaReceptor, fechaEmision } = datos
  const emision = fechaMonday(fechaEmision)
  /* El vencimiento es por comprobante: cada uno puede tener el suyo. Sin elegir, van los 30
     días por defecto contados desde la emisión. */
  const vencimiento = fechaMonday(
    comprobante.vencimiento || addDays(fechaEmision, FACT_VENCIMIENTO_DIAS),
  )

  const cv: Record<string, unknown> = {
    // La app sólo emite facturas: las notas de crédito y débito no salen de este flujo.
    [COL.facturacion.tipoComprobante]: { labels: [FACT_TIPO_COMPROBANTE] },
    [COL.facturacion.moneda]: { labels: [FACT_MONEDA_LABEL[moneda]] },
    [COL.facturacion.razonSocial]: cliente.name,
    [COL.facturacion.cuit]: soloDigitos(cliente.cuit),
    [COL.facturacion.sitIva]: { labels: [FACT_SIT_IVA_LABEL[ivaReceptor]] },
    /* Punto de venta fijo en "5" por ahora. El de la ficha ("0001"…) no existe en el board,
       así que mandarlo dejaría la columna vacía; se conecta cuando se definan los puntos. */
    [COL.facturacion.puntoVenta]: { labels: [FACT_PUNTO_VENTA_DEFAULT] },
    [COL.facturacion.condicionVenta]: { labels: [condicionVentaDe(cliente.condicionPago)] },
    [COL.facturacion.letra]: { labels: [letra] },
    [COL.facturacion.observaciones]: datos.observaciones,
  }
  if (emision) cv[COL.facturacion.fechaEmision] = { date: emision }
  // Vencimiento del pago: emisión + 30 días por defecto, hasta que sea configurable.
  if (vencimiento) cv[COL.facturacion.fechaVtoPago] = { date: vencimiento }
  // En pesos el tipo de cambio no significa nada, así que la columna queda vacía.
  if (moneda === 'Dólares (USD)' && tipoCambio > 0) {
    cv[COL.facturacion.tipoCambio] = String(tipoCambio)
  }
  // Los comprobantes de una venta quedan colgados de ella: es como se sabe qué facturó qué.
  if (datos.ventaId) cv[COL.facturacion.venta] = { item_ids: [Number(datos.ventaId)] }
  return cv
}

/**
 * Columnas de una línea del comprobante. El precio va ya bonificado: el subelemento no tiene
 * columna de descuento y su subtotal es `cantidad × precio unitario`.
 *
 * En dólares las fórmulas del board leen "Precio Unitario u$" y no "Precio Unitario $", así
 * que el precio se escribe en la columna que corresponde a la moneda del comprobante.
 */
function columnasLinea(
  linea: ComprobanteAGenerar['lineas'][number],
  moneda: MonedaFactura,
): Record<string, unknown> {
  const precio = String(precioFacturado(linea))
  const cv: Record<string, unknown> = {
    [COL.facturacionSub.unidadMedida]: { labels: [FACT_SUB_UNIDAD_MEDIDA] },
    [COL.facturacionSub.cantidad]: String(linea.cantidad),
    [COL.facturacionSub.precioUnit]: precio,
    [COL.facturacionSub.prodServ]: { labels: [FACT_SUB_PROD_SERV] },
    // La alícuota es la del producto, resuelta contra las que acepta el board.
    [COL.facturacionSub.alicuotaIva]: { labels: [String(alicuotaDe(linea))] },
  }
  if (moneda === 'Dólares (USD)') cv[COL.facturacionSub.precioUnitUsd] = precio
  return cv
}

/** Nombre del ítem: el cliente y qué mercadería factura este comprobante. */
const nombreComprobante = (c: ComprobanteAGenerar, cliente: Cliente): string =>
  `${cliente.name} · ${c.titulo}`

/**
 * Crea todos los comprobantes de la venta con sus líneas. Devuelve uno por cada grupo, con
 * cuántas líneas se escribieron: si no son todas, el comprobante quedó incompleto y la vista
 * tiene que decirlo en vez de darlo por emitido.
 */
export async function crearComprobantes(
  comprobantes: ComprobanteAGenerar[],
  datos: DatosFacturacion,
): Promise<ComprobanteCreado[]> {
  if (comprobantes.length === 0) return []

  if (!mondayHabilitado()) {
    return comprobantes.map((c, i) => ({
      clave: c.clave,
      titulo: c.titulo,
      id: `mock-fact-${Date.now()}-${i}`,
      lineasCreadas: c.lineas.length,
      lineasEsperadas: c.lineas.length,
    }))
  }

  // 1) Todos los comprobantes en UNA sola solicitud, con alias.
  const variables: Record<string, unknown> = { boardId: BOARDS.facturacion }
  const campos = comprobantes.map((c, i) => {
    variables[`n${i}`] = nombreComprobante(c, datos.cliente)
    variables[`cv${i}`] = JSON.stringify(columnasComprobante(c, datos))
    return `f${i}: create_item(board_id: $boardId, item_name: $n${i}, column_values: $cv${i}) { id }`
  })
  const declaraciones = comprobantes.map((_, i) => `$n${i}: String!, $cv${i}: JSON!`).join(', ')

  const creados = await mondayApi<Record<string, { id: string } | null>>(
    `mutation ($boardId: ID!, ${declaraciones}) { ${campos.join('\n')} }`,
    variables,
  )

  // 2) Las líneas de cada comprobante, una solicitud por comprobante.
  const resultado: ComprobanteCreado[] = []
  for (const [i, comprobante] of comprobantes.entries()) {
    const itemId = creados[`f${i}`]?.id
    // Sin cabecera no hay dónde colgar las líneas: se informa y se sigue con los demás.
    if (!itemId) {
      resultado.push({
        clave: comprobante.clave,
        titulo: comprobante.titulo,
        id: '',
        lineasCreadas: 0,
        lineasEsperadas: comprobante.lineas.length,
      })
      continue
    }
    resultado.push({
      clave: comprobante.clave,
      titulo: comprobante.titulo,
      id: itemId,
      lineasCreadas: await crearLineas(itemId, comprobante, datos.moneda),
      lineasEsperadas: comprobante.lineas.length,
    })
  }

  return resultado
}

/** Las líneas de un comprobante, en tandas de una sola solicitud cada una. */
async function crearLineas(
  itemId: string,
  comprobante: ComprobanteAGenerar,
  moneda: MonedaFactura,
): Promise<number> {
  let creadas = 0
  for (let desde = 0; desde < comprobante.lineas.length; desde += LINEAS_POR_TANDA) {
    const tanda = comprobante.lineas.slice(desde, desde + LINEAS_POR_TANDA)
    const variables: Record<string, unknown> = { parentId: itemId }
    const campos = tanda.map((linea, i) => {
      const n = desde + i
      variables[`n${n}`] = linea.nombre
      variables[`cv${n}`] = JSON.stringify(columnasLinea(linea, moneda))
      return `s${n}: create_subitem(parent_item_id: $parentId, item_name: $n${n}, column_values: $cv${n}) { id }`
    })
    const declaraciones = tanda
      .map((_, i) => `$n${desde + i}: String!, $cv${desde + i}: JSON!`)
      .join(', ')

    const res = await mondayApi<Record<string, { id: string } | null>>(
      `mutation ($parentId: ID!, ${declaraciones}) { ${campos.join('\n')} }`,
      variables,
    )
    creadas += tanda.filter((_, i) => res[`s${desde + i}`]?.id).length
  }
  return creadas
}
