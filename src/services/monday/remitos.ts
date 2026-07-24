/**
 * Capa de servicio de los remitos de venta ("🧾🚚 Remitos Ventas", 18421035529).
 *
 * Es el origen de los productos cuando la entrega es ANTERIOR: la mercadería ya salió y lo
 * que falta es facturarla. Igual que el resto de la app, con token pega contra la API real y
 * sin token cae al mock para que el prototipo siga corriendo en local.
 */
import { CHOFERES, COMISIONISTAS, DESTINOS, REMITOS, VEHICULOS } from '@/data/mock'
import { round2 } from '@/lib/format'
import { clienteLlevaIva, precioConIva } from '@/lib/precios'
import type {
  Chofer,
  Cliente,
  Comisionista,
  Destino,
  ListaPrecio,
  MedioEnvio,
  RemitoProducto,
  ResponsableEntrega,
  TipoEmisionRemito,
  Vehiculo,
} from '@/types'
import {
  BOARDS,
  CATEGORIA_COMISIONISTA_INDEX,
  CATEGORIA_TRANSPORTISTA_INDEX,
  COL,
  MEDIO_ENVIO_LABELS,
  REMITO_EMISION_ESTADO,
  REMITO_ENVIO_ESTADO,
  REMITO_ESTADO_FACT_INDEX,
  REMITO_SUB_ESTADO_FACT_INDEX,
  REMITO_SUB_ESTADO_NO_SELECCIONABLE,
  REMITO_VENTA_INDEX,
} from './columns'
import { byId, numCol, valor, type CV, type MondayItem } from './parse'
import { mondayApi, mondayHabilitado } from './sdk'

/** Un remito del cliente con mercadería entregada que todavía hay que facturar. */
export interface RemitoPendiente {
  /** ID del ítem en Monday. */
  id: string
  /** ID del remito tal como se ve en el board ("RTOVTA-04"). */
  nro: string
  /** "🤖Nro Rto": el número impreso, cuando el remito ya se emitió. */
  nroRemito: string
  /** Fecha de emisión, en dd/MM/yyyy. */
  fecha: string
  /** "🤖Estado del Facturacion" del remito, tal cual está en el board. */
  estadoFacturacion: string
  productos: RemitoProducto[]
}

/** yyyy-MM-dd (Monday) → dd/MM/yyyy (el formato del ERP). Sin fecha devuelve '--'. */
const fechaErp = (iso: string): string => {
  const [y, m, d] = (iso ?? '').split('-')
  return y && m && d ? `${d}/${m}/${y}` : '--'
}

/**
 * Un producto entregado en el remito. El nombre y el código salen del producto conectado en
 * "✋Producto" (board_relation_mkwca4wb), nunca del nombre del subítem: ése se renombra con
 * IDs ("RTOVMOV-03") y no le dice nada al usuario.
 *
 * El precio y la rentabilidad no viven en el remito —documenta cantidades, no importes—, así
 * que se leen del Maestro de Productos por la lista del cliente, igual que en la búsqueda.
 */
function mapRemitoProducto(sub: MondayItem, lista: ListaPrecio, conIva: boolean): RemitoProducto {
  const c = byId(sub)
  const producto = c[COL.remitoSub.producto]?.linked_items?.[0]
  const prodCols = producto ? byId(producto) : {}
  const proveedor = prodCols[COL.producto.proveedor]?.linked_items?.[0]
  const entregada = numCol(c[COL.remitoSub.cantEntregada])
  const facturada = numCol(c[COL.remitoSub.cantFacturada])
  const estado = c[COL.remitoSub.estadoFacturacion]
  const margenCol = COL.margen[lista]
  return {
    nombre: producto?.name || 'Producto sin asignar',
    codigo: producto ? valor(prodCols[COL.producto.codigo]) : '',
    cantRemito: entregada,
    cantFacturada: facturada,
    // Pendiente de facturar = entregada − facturada. Nunca baja de cero.
    pendiente: Math.max(entregada - facturada, 0),
    precio: precioConIva(
      numCol(prodCols[COL.precioLista[lista]]),
      numCol(prodCols[COL.producto.iva]),
      conIva,
    ),
    rent: margenCol ? numCol(prodCols[margenCol]) : 0,
    um: valor(c[COL.remitoSub.unidadMedida]),
    /* Datos fiscales del producto: parten la venta en comprobantes (consignada por proveedor)
       y definen la alícuota que se declara en cada línea. */
    tipo: valor(prodCols[COL.producto.tipoMercaderia]),
    iva: numCol(prodCols[COL.producto.iva]),
    proveedorId: proveedor?.id,
    proveedorNombre: proveedor?.name ?? '',
    estadoFacturacion: estado?.text ?? '',
    /* Sólo se pueden llevar a la factura los productos cuyo estado NO es "Pend de Facturar"
       (índice 2 de color_mm54wrds). Se compara por índice, no por el texto de la etiqueta. */
    seleccionable: estado?.index !== REMITO_SUB_ESTADO_NO_SELECCIONABLE,
    subitemId: sub.id,
    productoId: producto?.id,
  }
}

/**
 * IDs de los remitos que hay que facturar: los de venta POSTERIOR (la mercadería salió antes
 * de la factura) cuyo estado de facturación no llegó todavía a "100% Facturado".
 *
 * Los dos filtros van por ÍNDICE en la consulta; el del cliente se aplica acá, porque
 * `query_params` no filtra sobre una columna `board_relation`. Un remito sin estado cargado
 * pasa: sin dato no se puede afirmar que ya esté facturado.
 */
async function idsRemitosAFacturar(clienteItemId: string): Promise<string[]> {
  const data = await mondayApi<{
    boards: { items_page: { items: { id: string; column_values: CV[] }[] } }[]
  }>(
    `query {
      boards(ids: [${BOARDS.remitos}]) {
        items_page(
          limit: 200,
          query_params: {rules: [
            {column_id: "${COL.remito.venta}", compare_value: [${REMITO_VENTA_INDEX.posterior}], operator: any_of},
            {column_id: "${COL.remito.estadoFacturacion}", compare_value: [${REMITO_ESTADO_FACT_INDEX.totalmenteFacturado}], operator: not_any_of}
          ]}
        ) {
          items {
            id
            column_values(ids: ["${COL.remito.cliente}"]) {
              id text
              ... on BoardRelationValue { linked_item_ids }
            }
          }
        }
      }
    }`,
  )
  return (data.boards[0]?.items_page?.items ?? [])
    .filter((it) => {
      const linked = byId(it)[COL.remito.cliente]?.linked_item_ids ?? []
      return linked.map(String).includes(String(clienteItemId))
    })
    .map((it) => it.id)
}

/**
 * Remitos del cliente pendientes de facturar, con todos sus productos (cantidad entregada,
 * facturada, pendiente y estado de facturación de la línea).
 *
 * Va en dos consultas, igual que los presupuestos vigentes: primero los ítems del board
 * filtrando por tipo de venta y estado, y después sólo esos ítems con sus subelementos y el
 * producto conectado, del que sale el precio de la lista del cliente.
 */
export async function getRemitosPendientesFacturar(cliente: Cliente): Promise<RemitoPendiente[]> {
  if (!mondayHabilitado()) {
    return REMITOS.filter((r) => r.estado !== 'Facturado').map((r) => ({
      id: r.id,
      nro: r.id,
      nroRemito: r.id,
      fecha: r.fecha,
      estadoFacturacion: r.estado,
      productos: r.productos.map((p) => ({ ...p, seleccionable: p.pendiente > 0 })),
    }))
  }

  const ids = await idsRemitosAFacturar(cliente.id)
  if (ids.length === 0) return []

  const lista = cliente.list ?? 'L1'
  // Monotributista, Consumidor Final y Exento pagan IVA; el Resp. Inscripto, no.
  const conIva = clienteLlevaIva(cliente.status)
  const columnasProducto = JSON.stringify([
    COL.producto.codigo,
    COL.producto.iva,
    COL.producto.tipoMercaderia,
    COL.producto.proveedor,
    COL.precioLista[lista],
    ...(COL.margen[lista] ? [COL.margen[lista] as string] : []),
  ])

  const data = await mondayApi<{ items: (MondayItem & { subitems: MondayItem[] })[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) {
        id name
        column_values(ids: ["${COL.remito.pulseId}","${COL.remito.nroRemito}","${COL.remito.fechaEmision}","${COL.remito.estadoFacturacion}"]) { id text }
        subitems {
          id name
          column_values(ids: ["${COL.remitoSub.producto}","${COL.remitoSub.cantEntregada}","${COL.remitoSub.cantFacturada}","${COL.remitoSub.estadoFacturacion}","${COL.remitoSub.unidadMedida}"]) {
            id text
            ... on StatusValue { index }
            ... on BoardRelationValue {
              linked_items {
                id name
                column_values(ids: ${columnasProducto}) {
                  id text
                  ... on FormulaValue { display_value }
                  ... on MirrorValue { display_value }
                  ... on BoardRelationValue { linked_items { id name } }
                }
              }
            }
          }
        }
      }
    }`,
    { ids },
  )

  return (data.items ?? []).map((it) => {
    const c = byId(it)
    return {
      id: it.id,
      // El ID del board ("RTOVTA-04") es lo que ve el usuario; el name puede estar sin renombrar.
      nro: c[COL.remito.pulseId]?.text?.trim() || it.name,
      nroRemito: c[COL.remito.nroRemito]?.text?.trim() ?? '',
      fecha: fechaErp(c[COL.remito.fechaEmision]?.text ?? ''),
      estadoFacturacion: c[COL.remito.estadoFacturacion]?.text ?? '',
      productos: (it.subitems ?? []).map((sub) => mapRemitoProducto(sub, lista, conIva)),
    }
  })
}

/** Unidades del remito que todavía no se facturaron. Es lo que resume la card. */
export const pendienteDeRemito = (r: RemitoPendiente): number =>
  r.productos.reduce((acc, p) => acc + p.pendiente, 0)

/** Unidades entregadas en el remito, facturadas o no. */
export const entregadoDeRemito = (r: RemitoPendiente): number =>
  r.productos.reduce((acc, p) => acc + p.cantRemito, 0)

/* ===== Especificación del envío (entrega por La Batea) ===== */

/**
 * Destinos de entrega del cliente. Se leen del board "📍Destinos" (18421035523) filtrando por
 * la columna "Cliente" (board_relation_mm57cgxx), que es multi-valor: un destino puede estar
 * conectado a varios clientes, así que se valida que el cliente esté ENTRE los conectados.
 * El id del cliente viaja como número, como en el resto de los filtros por board_relation.
 */
export async function getDestinosCliente(clienteId: string): Promise<Destino[]> {
  if (!mondayHabilitado()) return DESTINOS.filter((d) => d.clienteId === clienteId)
  const idNumerico = Number(clienteId)
  if (!Number.isFinite(idNumerico)) return []
  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query ($cliente: CompareValue!) {
      boards(ids: [${BOARDS.destinos}]) {
        items_page(
          limit: 200,
          query_params: {rules: [{column_id: "${COL.destino.cliente}", compare_value: $cliente, operator: any_of}]}
        ) {
          items {
            id name
            column_values(ids: ["${COL.destino.direccion}","${COL.destino.cliente}"]) {
              id text
              ... on BoardRelationValue { linked_item_ids }
            }
          }
        }
      }
    }`,
    { cliente: [idNumerico] },
  )
  return (data.boards[0]?.items_page?.items ?? [])
    // Doble control: además del filtro de la consulta, se valida el id contra los conectados.
    .filter((it) =>
      (byId(it)[COL.destino.cliente]?.linked_item_ids ?? [])
        .map(String)
        .includes(String(clienteId)),
    )
    .map((it) => ({
      id: it.id,
      nombre: it.name,
      direccion: valor(byId(it)[COL.destino.direccion]),
    }))
}

/**
 * Transportistas: personas cuya "✋Categoria" (dropdown_mm54e5ag, multi-valor) contiene
 * "Transportista". El filtro va por índice en la consulta y, por las dudas de que la etiqueta
 * conviva con otras, se revalida contra el texto. Devuelve nombre y CUIT (puede venir vacío).
 */
export async function getTransportistas(): Promise<Chofer[]> {
  if (!mondayHabilitado()) return CHOFERES
  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.personas}]) {
        items_page(
          limit: 200,
          query_params: {rules: [{column_id: "${COL.cliente.categoria}", compare_value: [${CATEGORIA_TRANSPORTISTA_INDEX}], operator: any_of}]}
        ) {
          items {
            id name
            column_values(ids: ["${COL.cliente.categoria}","${COL.cliente.cuit}"]) { id text }
          }
        }
      }
    }`,
  )
  return (data.boards[0]?.items_page?.items ?? [])
    .filter((it) => (byId(it)[COL.cliente.categoria]?.text ?? '').includes('Transportista'))
    .map((it) => ({
      id: it.id,
      name: it.name,
      cuit: byId(it)[COL.cliente.cuit]?.text?.trim() ?? '',
    }))
}

/**
 * Comisionistas: personas cuya "✋Categoria" (dropdown_mm54e5ag, multi-valor) contiene
 * "Comisionista". Mismo patrón que los transportistas: filtro por índice en la consulta y
 * revalidación contra el texto. Devuelve nombre y CUIT (el board no tiene zona).
 */
export async function getComisionistas(): Promise<Comisionista[]> {
  if (!mondayHabilitado()) return COMISIONISTAS
  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.personas}]) {
        items_page(
          limit: 200,
          query_params: {rules: [{column_id: "${COL.cliente.categoria}", compare_value: [${CATEGORIA_COMISIONISTA_INDEX}], operator: any_of}]}
        ) {
          items {
            id name
            column_values(ids: ["${COL.cliente.categoria}","${COL.cliente.cuit}"]) { id text }
          }
        }
      }
    }`,
  )
  return (data.boards[0]?.items_page?.items ?? [])
    .filter((it) => (byId(it)[COL.cliente.categoria]?.text ?? '').includes('Comisionista'))
    .map((it) => ({
      id: it.id,
      name: it.name,
      cuit: byId(it)[COL.cliente.cuit]?.text?.trim() ?? '',
    }))
}

/**
 * Vehículos de la flota, leídos del board "🚛Vehículos" (18421035528). Se muestra el nombre
 * del ítem; la patente ("✋Patente/Chasis") puede venir vacía.
 */
export async function getVehiculos(): Promise<Vehiculo[]> {
  if (!mondayHabilitado()) return VEHICULOS
  const data = await mondayApi<{ boards: { items_page: { items: MondayItem[] } }[] }>(
    `query {
      boards(ids: [${BOARDS.vehiculos}]) {
        items_page(limit: 200) {
          items { id name column_values(ids: ["${COL.vehiculo.patente}"]) { id text } }
        }
      }
    }`,
  )
  return (data.boards[0]?.items_page?.items ?? []).map((it) => ({
    id: it.id,
    name: it.name,
    patente: byId(it)[COL.vehiculo.patente]?.text?.trim() ?? '',
  }))
}

/* ===== Creación del remito en "🧾🚚 Remitos Ventas" (18421035529) ===== */

/** Subelementos por solicitud, igual que la venta y el presupuesto. */
const PRODUCTOS_POR_TANDA_REMITO = 25

/** Una línea de mercadería a impactar como subelemento del remito. */
export interface LineaRemito {
  /** Ítem del Maestro de Productos, para linkear la línea. */
  productoId?: string
  nombre: string
  cantidad: number
  /** Peso unitario del producto (kg). El peso de la línea es cantidad × este valor. */
  pesoUnitario: number
  /** Etiqueta de unidad de medida del producto (dropdown del subelemento). */
  um: string
}

/** Datos para crear el remito y sus líneas. Refleja el estado del paso de envío. */
export interface DatosRemito {
  /** Ítem del cliente del remito. */
  clienteId?: string
  /** Nombre con el que nace el ítem del remito. */
  nombre: string
  tipoEmision: TipoEmisionRemito
  responsable: ResponsableEntrega | null
  /* Entrega por La Batea. */
  destinoId?: string | null
  /** Chofer/transportista elegido (persona categoría "Transportista"). */
  transportistaId?: string | null
  vehiculoId?: string | null
  /* Entrega tercerizada. */
  comisionistaId?: string | null
  /* Retira el cliente. */
  clienteResponsable?: string
  /** Ventas de origen de la mercadería remitada (emisión ANTERIOR), sin repetir. */
  ventaIds: string[]
  lineas: LineaRemito[]
}

export interface RemitoCreado {
  id: string
  /** Subelementos efectivamente creados: se compara contra la cantidad de líneas. */
  subitemsCreados: number
}

/** Peso de una línea: cantidad remitada × peso unitario del producto. */
const pesoLinea = (l: LineaRemito): number => round2(l.cantidad * (l.pesoUnitario || 0))

/**
 * Columnas de un subelemento del remito. La cantidad remitada va tanto en "✋Cant a Entregar"
 * como en "🤖Cant Facturada", según lo pedido. La U.M. se escribe como etiqueta del dropdown
 * (se crea si el board no la tenía); el peso, ya calculado por línea.
 *
 * En la emisión ANTERIOR la línea nace "Pend de Facturar" (0% facturado, índice 2 de
 * color_mm54wrds); en la POSTERIOR esa columna queda vacía.
 */
const columnasLineaRemito = (l: LineaRemito, emisionAnterior: boolean): Record<string, unknown> => {
  const cv: Record<string, unknown> = {
    [COL.remitoSub.cantEntregada]: String(round2(l.cantidad)),
    [COL.remitoSub.cantFacturada]: String(round2(l.cantidad)),
    [COL.remitoSub.peso]: String(pesoLinea(l)),
  }
  if (emisionAnterior) {
    cv[COL.remitoSub.estadoFacturacion] = { index: REMITO_SUB_ESTADO_FACT_INDEX.pendDeFacturar }
  }
  if (l.productoId) cv[COL.remitoSub.producto] = { item_ids: [Number(l.productoId)] }
  if (l.um) cv[COL.remitoSub.unidadMedida] = { labels: [l.um] }
  return cv
}

/**
 * Crea el remito con su cabecera y un subelemento por producto, en una sola mutation con alias
 * por tanda (`s0`, `s1`, …), igual que la venta. El tipo de emisión va por índice a "✋Venta";
 * los datos de la entrega, según el responsable (La Batea: destino + transportista + vehículo;
 * comisionista; o el nombre de quien retira). El peso total es la suma del peso de las líneas.
 *
 * Lanza si la cabecera falla; si fallan subelementos, devuelve cuántos se crearon para que la
 * vista decida (y no avance). Con `create_labels_if_missing` las U.M. que el board no tenga se
 * agregan solas, así ninguna línea rompe la creación.
 */
export async function crearRemito(datos: DatosRemito): Promise<RemitoCreado> {
  const {
    clienteId,
    nombre,
    tipoEmision,
    responsable,
    destinoId,
    transportistaId,
    vehiculoId,
    comisionistaId,
    clienteResponsable,
    ventaIds,
    lineas,
  } = datos

  if (!mondayHabilitado()) {
    return { id: `mock-remito-${Date.now()}`, subitemsCreados: lineas.length }
  }

  const emisionIndex =
    tipoEmision === 'POSTERIOR' ? REMITO_VENTA_INDEX.posterior : REMITO_VENTA_INDEX.anterior
  // Emisión ANTERIOR: el remito y sus líneas nacen "0% Facturado".
  const emisionAnterior = tipoEmision === 'ANTERIOR'
  const pesoTotal = lineas.reduce((acc, l) => acc + pesoLinea(l), 0)

  const cabecera: Record<string, unknown> = {
    [COL.remito.venta]: { index: emisionIndex },
    [COL.remito.pesoTotal]: String(round2(pesoTotal)),
  }
  // Emisión ANTERIOR: el remito nace "0% Facturado" (índice 2 de color_mm5bf05j).
  if (emisionAnterior) {
    cabecera[COL.remito.estadoFacturacion] = { index: REMITO_ESTADO_FACT_INDEX.sinFacturar }
  }
  if (clienteId) cabecera[COL.remito.cliente] = { item_ids: [Number(clienteId)] }

  // Datos de la entrega según quién la hace. Cada conectada va con el id del ítem elegido.
  if (responsable === 'LA_BATEA') {
    if (destinoId) cabecera[COL.remito.destino] = { item_ids: [Number(destinoId)] }
    if (transportistaId) cabecera[COL.remito.transportista] = { item_ids: [Number(transportistaId)] }
    if (vehiculoId) cabecera[COL.remito.vehiculo] = { item_ids: [Number(vehiculoId)] }
  } else if (responsable === 'COMISIONISTA') {
    /* El comisionista NO se linkea por ahora: la columna "🤖Chofer/Comisionista"
       (COL.remito.comisionista, board_relation_mm59sbre) está conectada al tablero de Contactos
       (18420688239), y el comisionista sale de Personas (18420688238), así que Monday rechaza el
       vínculo (itemsNotInConnectedBoards). Sus datos igual quedan en el remito (resumen y PDF).
       Para reactivarlo, reconectá esa columna a Personas y descomentá:
         if (comisionistaId) cabecera[COL.remito.comisionista] = { item_ids: [Number(comisionistaId)] } */
    void comisionistaId
  } else if (responsable === 'CLIENTE') {
    if (clienteResponsable) cabecera[COL.remito.clienteResponsable] = clienteResponsable
  }

  // Ventas de origen (ANTERIOR): se linkean todas las que aportaron mercadería.
  const ventaItemIds = ventaIds.map(Number).filter((n) => Number.isFinite(n))
  if (ventaItemIds.length) cabecera[COL.remito.ventas] = { item_ids: ventaItemIds }

  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv, create_labels_if_missing: true) { id }
    }`,
    { boardId: BOARDS.remitos, name: nombre, cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id

  // Los productos van en tandas, cada una en una sola solicitud con alias.
  let subitemsCreados = 0
  for (let desde = 0; desde < lineas.length; desde += PRODUCTOS_POR_TANDA_REMITO) {
    const tanda = lineas.slice(desde, desde + PRODUCTOS_POR_TANDA_REMITO)
    const variables: Record<string, unknown> = { parentId: itemId }
    const campos = tanda.map((l, i) => {
      const n = desde + i
      variables[`n${n}`] = l.nombre
      variables[`cv${n}`] = JSON.stringify(columnasLineaRemito(l, emisionAnterior))
      return `s${n}: create_subitem(parent_item_id: $parentId, item_name: $n${n}, column_values: $cv${n}, create_labels_if_missing: true) { id }`
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

/* ===== Emisión y envío del remito (mismo flujo que el presupuesto) ===== */

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Índice de una etiqueta en una columna status del board de remitos. Se lee de la definición de
 * la columna, así el estado se escribe por índice y no por el texto de la etiqueta (que puede
 * reescribirse en el board). Devuelve null si la etiqueta ya no existe.
 */
async function indiceEstadoRemito(columnId: string, label: string): Promise<number | null> {
  const data = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.remitos}]) { columns(ids: ["${columnId}"]) { settings_str } } }`,
  )
  const raw = data.boards[0]?.columns?.[0]?.settings_str
  if (!raw) return null
  const labels = (JSON.parse(raw).labels ?? {}) as Record<string, string>
  const entrada = Object.entries(labels).find(([, l]) => l === label)
  return entrada ? Number(entrada[0]) : null
}

/**
 * Emite el remito: escribe las observaciones en "🤖Observaciones" (long_text_mm51vcrj) y pone
 * "🤖Estado Emision Remito" (color_mkwb12n1) en "Emitir" —por índice—, lo que dispara la
 * automatización que genera el PDF. Ambas cosas van en una sola escritura, así la observación ya
 * está cuando se dispara la generación.
 */
export async function emitirRemito(itemId: string, observaciones: string): Promise<void> {
  if (!mondayHabilitado()) return
  const idx = await indiceEstadoRemito(COL.remito.estadoEmision, REMITO_EMISION_ESTADO.emitir)
  const cv: Record<string, unknown> = { [COL.remito.observaciones]: observaciones ?? '' }
  if (idx != null) cv[COL.remito.estadoEmision] = { index: idx }
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    { id: itemId, board: BOARDS.remitos, cv: JSON.stringify(cv) },
  )
}

/** PDF del remito subido por la automatización a la columna file ("🤖RTO PDF"). */
export interface RemitoPdfDoc {
  url: string
  nombre: string
}

/**
 * Lee la columna file del remito (file_mkwbmr11) y devuelve el PDF subido, o null si todavía no
 * hay archivo. Igual que en el presupuesto, usa `assets` por la `public_url` firmada.
 */
export async function getRemitoPdf(itemId: string): Promise<RemitoPdfDoc | null> {
  if (!mondayHabilitado()) return null
  const data = await mondayApi<{ items: { assets: { name: string; public_url: string }[] }[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) { assets(column_ids: ["${COL.remito.pdf}"]) { name public_url } }
    }`,
    { ids: [itemId] },
  )
  const asset = data.items[0]?.assets?.[0]
  return asset?.public_url ? { url: asset.public_url, nombre: asset.name } : null
}

/**
 * Espera a que el PDF del remito aparezca en la columna file: consulta cada `intervalo` ms hasta
 * `intentos` veces. Devuelve el PDF apenas está disponible, o null si se agota la espera. En modo
 * local (sin token) simula la demora y no devuelve archivo.
 */
export async function esperarRemitoPdf(
  itemId: string,
  { intentos = 40, intervalo = 3000 }: { intentos?: number; intervalo?: number } = {},
): Promise<RemitoPdfDoc | null> {
  if (!mondayHabilitado()) {
    await esperar(2500)
    return null
  }
  for (let i = 0; i < intentos; i++) {
    const pdf = await getRemitoPdf(itemId)
    if (pdf) return pdf
    await esperar(intervalo)
  }
  return null
}

/**
 * Paso 1 del envío: deja en el remito a quién y por dónde mandarlo —contactos en la columna
 * conectada (board_relation_mm5g8hdv) y el medio en el dropdown "🤖Enviar por:"— y, de paso,
 * asegura el link a las ventas de origen (board_relation_mm54xs7v). No dispara nada todavía.
 */
export async function asignarDestinatariosRemito(
  itemId: string,
  contactoItemIds: string[],
  medio: MedioEnvio,
  ventaIds: string[] = [],
): Promise<void> {
  if (!mondayHabilitado()) return
  const ids = contactoItemIds.map(Number).filter((n) => Number.isFinite(n))
  const cv: Record<string, unknown> = {
    [COL.remito.contactos]: { item_ids: ids },
    [COL.remito.medioEnvio]: { labels: MEDIO_ENVIO_LABELS[medio] },
  }
  const ventaItemIds = ventaIds.map(Number).filter((n) => Number.isFinite(n))
  if (ventaItemIds.length) cv[COL.remito.ventas] = { item_ids: ventaItemIds }
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    { id: itemId, board: BOARDS.remitos, cv: JSON.stringify(cv) },
  )
}

/**
 * Paso 2: pone "🤖Estado Envio Remito" (color_mm5gpcbj) en "Enviar" —por índice—, lo que dispara
 * el envío.
 */
export async function dispararEnvioRemito(itemId: string): Promise<void> {
  if (!mondayHabilitado()) return
  const idx = await indiceEstadoRemito(COL.remito.estadoEnvio, REMITO_ENVIO_ESTADO.enviar)
  if (idx == null) return
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    { id: itemId, board: BOARDS.remitos, cv: JSON.stringify({ [COL.remito.estadoEnvio]: { index: idx } }) },
  )
}

/** Lee el estado de envío del remito tal cual está en la columna. */
export async function getEstadoEnvioRemito(itemId: string): Promise<string> {
  if (!mondayHabilitado()) return REMITO_ENVIO_ESTADO.enviado
  const data = await mondayApi<{ items: { column_values: { text: string | null }[] }[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) { column_values(ids: ["${COL.remito.estadoEnvio}"]) { text } }
    }`,
    { ids: [itemId] },
  )
  return data.items[0]?.column_values[0]?.text?.trim() ?? ''
}

/** El envío terminó cuando quedó "Enviado" o cayó en un estado de error. */
const envioRemitoFinal = (estado: string): boolean =>
  estado === REMITO_ENVIO_ESTADO.enviado || /error/i.test(estado)

/**
 * Sigue el estado de envío hasta que la automatización lo cierra ("Enviado" o error). Avisa cada
 * cambio por `onEstado`. Devuelve el último estado leído. En modo local simula la secuencia.
 */
export async function seguirEnvioRemito(
  itemId: string,
  onEstado: (estado: string) => void,
  { intentos = 30, intervalo = 2000 }: { intentos?: number; intervalo?: number } = {},
): Promise<string> {
  if (!mondayHabilitado()) {
    onEstado(REMITO_ENVIO_ESTADO.enviando)
    await esperar(1200)
    onEstado(REMITO_ENVIO_ESTADO.enviado)
    return REMITO_ENVIO_ESTADO.enviado
  }
  let ultimo = ''
  for (let i = 0; i < intentos; i++) {
    const estado = await getEstadoEnvioRemito(itemId)
    if (estado && estado !== ultimo) {
      ultimo = estado
      onEstado(estado)
    }
    if (envioRemitoFinal(estado)) return estado
    await esperar(intervalo)
  }
  return ultimo
}
