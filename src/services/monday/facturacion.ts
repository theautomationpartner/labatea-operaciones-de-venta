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
  MedioEnvio,
  MonedaFactura,
} from '@/types'
import {
  BOARDS,
  COL,
  ENVIO_FACTURA_ESTADO,
  FACT_CONDICION_VENTA,
  FACT_CREAR_COMPROBANTE_INDEX,
  FACT_MONEDA_LABEL,
  FACT_PUNTO_VENTA_DEFAULT,
  FACT_SIT_IVA_LABEL,
  FACT_SUB_PROD_SERV,
  FACT_SUB_UNIDAD_MEDIDA,
  FACT_TIPO_COMPROBANTE,
  FACT_VENCIMIENTO_DIAS,
  MEDIO_ENVIO_LABELS,
  VENTA_ENVIO_FACTURA_INDEX,
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

/** Nombre del ítem del comprobante: sólo el cliente, sin la mercadería que factura. */
const nombreComprobante = (cliente: Cliente): string => cliente.name

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
    variables[`n${i}`] = nombreComprobante(datos.cliente)
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

  // 3) Con los ítems y todas sus líneas ya creados: se dispara la emisión electrónica de cada
  //    comprobante (estado "Crear Comprobante") y se cuelgan de la venta, que es de donde el
  //    board espeja el PDF y desde donde después se envían.
  const ids = resultado.map((c) => c.id).filter(Boolean)
  if (ids.length > 0) {
    await marcarCrearComprobante(ids)
    if (datos.ventaId) await vincularComprobantesAVenta(datos.ventaId, ids)
  }

  return resultado
}

/**
 * Pone cada comprobante en "Crear Comprobante" (✋Comprobante, por índice): es lo que dispara
 * la emisión electrónica. Van todos en una sola solicitud, con alias.
 */
async function marcarCrearComprobante(itemIds: string[]): Promise<void> {
  const variables: Record<string, unknown> = { board: BOARDS.facturacion }
  const cv = JSON.stringify({
    [COL.facturacion.estadoComprobante]: { index: FACT_CREAR_COMPROBANTE_INDEX },
  })
  const campos = itemIds.map((id, i) => {
    variables[`item${i}`] = id
    variables[`cv${i}`] = cv
    return `u${i}: change_multiple_column_values(item_id: $item${i}, board_id: $board, column_values: $cv${i}) { id }`
  })
  const declaraciones = itemIds.map((_, i) => `$item${i}: ID!, $cv${i}: JSON!`).join(', ')
  await mondayApi(`mutation ($board: ID!, ${declaraciones}) { ${campos.join('\n')} }`, variables)
}

/**
 * Conecta los comprobantes creados al ítem de la venta (board_relation "Facturación"). De esa
 * relación cuelga el mirror del PDF, así que sin este vínculo el envío no tendría documento que
 * validar.
 */
async function vincularComprobantesAVenta(ventaId: string, itemIds: string[]): Promise<void> {
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: ventaId,
      board: BOARDS.ventas,
      cv: JSON.stringify({
        [COL.venta.facturacion]: { item_ids: itemIds.map(Number).filter(Number.isFinite) },
      }),
    },
  )
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

/* ===== Envío de la factura ===== */

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * ¿La factura ya tiene su PDF generado? El mirror "🤖Comprobante PDF" (lookup_mm5bf76j) de la
 * venta espeja el archivo de los comprobantes conectados, pero un mirror de archivo no siempre
 * expone su valor por la API. Así que se valida en la fuente: los `assets` del archivo
 * (file_mm1tg5w5) de las facturas conectadas a la venta (board_relation_mm5bvew3). Con al menos
 * un archivo, el documento existe; sin ninguno, la emisión electrónica todavía no terminó.
 */
export async function comprobanteFacturaGenerado(ventaId: string): Promise<boolean> {
  if (!mondayHabilitado()) return true
  const data = await mondayApi<{
    items: { column_values: { linked_items?: { assets: { id: string }[] }[] }[] }[]
  }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        column_values(ids: ["${COL.venta.facturacion}"]) {
          ... on BoardRelationValue {
            linked_items { assets(column_ids: ["${COL.facturacion.pdf}"]) { id } }
          }
        }
      }
    }`,
    { ids: [ventaId] },
  )
  const facturas = data.items[0]?.column_values[0]?.linked_items ?? []
  return facturas.some((f) => (f.assets?.length ?? 0) > 0)
}

/**
 * Paso 1 del envío de la factura: deja en el ítem de la venta a quién y por dónde mandarla —los
 * contactos en 👤Contactos (board_relation_mm5gq7z7) y el medio en 🤖Enviar por:
 * (dropdown_mm5gkf4f)—. No dispara nada: eso lo hace `dispararEnvioFactura`.
 */
export async function asignarDestinatariosFactura(
  ventaId: string,
  contactoItemIds: string[],
  medio: MedioEnvio,
): Promise<void> {
  if (!mondayHabilitado()) return
  const ids = contactoItemIds.map(Number).filter((n) => Number.isFinite(n))
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: ventaId,
      board: BOARDS.ventas,
      cv: JSON.stringify({
        [COL.venta.contactos]: { item_ids: ids },
        [COL.venta.medioEnvio]: { labels: MEDIO_ENVIO_LABELS[medio] },
      }),
    },
  )
}

/**
 * Paso 2: pone "🤖Estado de Envio Fact" (color_mm5bc1xy) en "Enviar" (por índice: la etiqueta
 * que dispara es "Enviar", id 3). Ese cambio es el que dispara el envío de la factura.
 */
export async function dispararEnvioFactura(ventaId: string): Promise<void> {
  if (!mondayHabilitado()) return
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    {
      id: ventaId,
      board: BOARDS.ventas,
      cv: JSON.stringify({ [COL.venta.estadoEnvioFactura]: { index: VENTA_ENVIO_FACTURA_INDEX } }),
    },
  )
}

/** Lee el estado de envío de la factura tal cual está en la columna del ítem de la venta. */
export async function getEstadoEnvioFactura(ventaId: string): Promise<string> {
  if (!mondayHabilitado()) return ENVIO_FACTURA_ESTADO.enviado
  const data = await mondayApi<{ items: { column_values: { text: string | null }[] }[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) { column_values(ids: ["${COL.venta.estadoEnvioFactura}"]) { text } }
    }`,
    { ids: [ventaId] },
  )
  return data.items[0]?.column_values[0]?.text?.trim() ?? ''
}

/** Estados en los que el envío de la factura ya terminó: no tiene sentido seguir consultando. */
const ENVIO_FACTURA_FINALES: readonly string[] = [
  ENVIO_FACTURA_ESTADO.enviado,
  ENVIO_FACTURA_ESTADO.error,
]

/**
 * Sigue el estado de envío de la factura hasta que la automatización lo cierra ("Enviada" o
 * "Error - Ver Updates"). Avisa cada cambio por `onEstado`. Sin token, simula la secuencia.
 */
export async function seguirEnvioFactura(
  ventaId: string,
  onEstado: (estado: string) => void,
  { intentos = 30, intervalo = 2000 }: { intentos?: number; intervalo?: number } = {},
): Promise<string> {
  if (!mondayHabilitado()) {
    onEstado(ENVIO_FACTURA_ESTADO.enviando)
    await esperar(1200)
    onEstado(ENVIO_FACTURA_ESTADO.enviado)
    return ENVIO_FACTURA_ESTADO.enviado
  }
  let ultimo = ''
  for (let i = 0; i < intentos; i++) {
    const estado = await getEstadoEnvioFactura(ventaId)
    if (estado && estado !== ultimo) {
      ultimo = estado
      onEstado(estado)
    }
    if (ENVIO_FACTURA_FINALES.includes(estado)) return estado
    await esperar(intervalo)
  }
  return ultimo
}
