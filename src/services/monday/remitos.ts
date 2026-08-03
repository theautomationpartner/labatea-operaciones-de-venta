/**
 * Capa de servicio de los remitos de venta ("🧾🚚 Remitos Ventas", 18421035529).
 *
 * Es el origen de los productos cuando la entrega es ANTERIOR: la mercadería ya salió y lo
 * que falta es facturarla. Igual que el resto de la app, con token pega contra la API real y
 * sin token cae al mock para que el prototipo siga corriendo en local.
 */
import { CHOFERES, COMISIONISTAS, DESTINOS, REMITOS, VEHICULOS } from '@/data/mock'
import { round2 } from '@/lib/format'
import type {
  Chofer,
  Cliente,
  Comisionista,
  Destino,
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
  personCol,
  REMITO_EMISION_ESTADO,
  REMITO_ENVIO_ESTADO,
  REMITO_VENTA_INDEX,
} from './columns'
import { byId, numCol, valor, type MondayItem } from './parse'
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

/* La fuente de "pendientes de facturar" para la venta DIRECTA con entrega ANTERIOR ya NO sale de
   los remitos del board 18421035529: se lee de "Vtas Pends de Facturar" (18421033947), más abajo
   (`getVentasPendientesFacturar`). Las consultas de remitos a facturar quedaron deprecadas. */

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
  /** Precio unitario del producto. Sólo POSTERIOR: alimenta el "🤖Total $" del subelemento. */
  precioUnitario?: number
}

/** Datos para crear el remito y sus líneas. Refleja el estado del paso de envío. */
export interface DatosRemito {
  /** Ítem del cliente del remito. */
  clienteId?: string
  /** ID del vendedor de la operación (usuario de Monday). Se asigna en la columna Person. */
  vendedorId?: string | null
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
 * Columnas de un subelemento del remito: cantidad entregada, peso y —sólo POSTERIOR— el "🤖Total $"
 * de la línea. La U.M. va como etiqueta del dropdown (se crea si el board no la tenía). Las columnas
 * de facturación (cantidad facturada y estado) se eliminaron del board: ya no se escriben.
 */
const columnasLineaRemito = (l: LineaRemito, totalProducto: number | null): Record<string, unknown> => {
  const cv: Record<string, unknown> = {
    [COL.remitoSub.cantEntregada]: String(round2(l.cantidad)),
    [COL.remitoSub.peso]: String(pesoLinea(l)),
  }
  if (totalProducto != null) {
    cv[COL.remitoSub.totalProducto] = String(totalProducto)
  }
  if (l.productoId) cv[COL.remitoSub.producto] = { item_ids: [Number(l.productoId)] }
  if (l.um) cv[COL.remitoSub.unidadMedida] = { labels: [l.um] }
  return cv
}

/** Importe de una línea del remito: cantidad × precio unitario (0 si no hay precio). */
const totalLineaRemito = (l: LineaRemito): number => round2(l.cantidad * (l.precioUnitario ?? 0))

/**
 * Índice del primer label cuyo texto coincide con alguno de los candidatos, leído de la metadata
 * de la columna. Se mapea por texto (no por un índice fijo) para sobrevivir a que el board reordene
 * o reescriba etiquetas; los candidatos cubren sinónimos ("0% Facturado" vs "0% Facturada").
 */
const indiceDeLabel = (settingsStr: string | undefined, candidatos: string[]): number | null => {
  if (!settingsStr) return null
  const labels = (JSON.parse(settingsStr).labels ?? {}) as Record<string, string>
  for (const cand of candidatos) {
    const entrada = Object.entries(labels).find(([, l]) => l === cand)
    if (entrada) return Number(entrada[0])
  }
  return null
}

/**
 * Resuelve dinámicamente el índice de "Posterior"/"Anterior" en "✋Venta" (color_mkwbrkg6), leyendo
 * la metadata de la columna. Así la creación no depende de un índice numérico hardcodeado.
 */
async function indicesVentaRemito(): Promise<{ posterior: number | null; anterior: number | null }> {
  const data = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.remitos}]) { columns(ids: ["${COL.remito.venta}"]) { settings_str } } }`,
  )
  const str = data.boards[0]?.columns?.[0]?.settings_str
  return { posterior: indiceDeLabel(str, ['Posterior']), anterior: indiceDeLabel(str, ['Anterior']) }
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
    vendedorId,
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

  const esPosterior = tipoEmision === 'POSTERIOR'
  // "✋Venta": Posterior/Anterior resuelto por metadata (con respaldo por si el label cambió).
  const venta = await indicesVentaRemito()
  const ventaIndex = esPosterior
    ? venta.posterior ?? REMITO_VENTA_INDEX.posterior
    : venta.anterior ?? REMITO_VENTA_INDEX.anterior

  const pesoTotal = lineas.reduce((acc, l) => acc + pesoLinea(l), 0)

  const cabecera: Record<string, unknown> = {
    [COL.remito.venta]: { index: ventaIndex },
    [COL.remito.pesoTotal]: String(round2(pesoTotal)),
  }
  if (clienteId) cabecera[COL.remito.cliente] = { item_ids: [Number(clienteId)] }
  // Vendedor de la operación (columna Person): el seleccionado en el encabezado.
  const personaVendedor = personCol(vendedorId)
  if (personaVendedor) cabecera[COL.remito.vendedor] = personaVendedor

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
    // El ítem raíz nace con el nombre general del tablero; su ID lo asigna la customKey del board.
    { boardId: BOARDS.remitos, name: 'Remito', cv: JSON.stringify(cabecera) },
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
      // El "🤖Total $" sólo aplica al remito POSTERIOR (lo pendiente de facturar por línea).
      variables[`cv${n}`] = JSON.stringify(
        columnasLineaRemito(l, esPosterior ? totalLineaRemito(l) : null),
      )
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

/* ===== Registro en "Vtas Pends de Facturar" (board 18421033947) ===== */

/** Una línea del remito llevada a "Vtas Pends de Facturar": su producto y su precio unitario. */
export interface LineaVtaPendiente {
  productoId?: string
  precioUnitario: number
  /** Cantidad remitada del producto: se persiste como "Cant Entregada" (numeric_mm5nf0t6). */
  cantidad: number
  /** Tipo de mercadería del producto (CO / COM), leído del Maestro (color_mm48hm74). Se etiqueta
   *  en el subelemento (color_mm5preby) resolviendo el índice por label del board destino. */
  tipoMercaderia?: string
  /** Rentabilidad del producto según la lista del cliente, en %. Se persiste en "🤖Rentab %"
   *  (numeric_mm5p80xs) para reusarla al facturar la venta DIRECTA con entrega ANTERIOR. */
  rentabilidad?: number
}

/** Datos para crear el ítem de "Vtas Pends de Facturar" y sus subelementos. */
export interface DatosVtaPendienteFacturar {
  /** Nombre con el que nace el ítem (por lo general, el del cliente). */
  nombre: string
  /** Ítem del cliente en Personas (board_relation_mm5pd79g). Es por donde se filtra al facturar. */
  clienteId?: string
  /** Ítem de la cuenta corriente del cliente (board_relation_mkwbz75m). */
  ctaCteId?: string
  /** Remito POSTERIOR recién creado (board_relation_mkwbvma5). */
  remitoId: string
  /** Importe total del remito ("🤖Importe a Facturar $"). */
  importeTotal: number
  lineas: LineaVtaPendiente[]
}

/**
 * Crea, tras un remito POSTERIOR, el registro de "Vtas Pends de Facturar" (18421033947): cabecera
 * enlazada a la cuenta corriente y al remito, con el importe a facturar y el estado "0% Facturada"
 * (índice resuelto por metadata); y un subelemento por producto (bulk, con alias) con su precio
 * unitario, la cantidad facturada en 0 y el estado "0% Facturado" (también por índice dinámico).
 */
export async function crearVtaPendienteFacturar(
  datos: DatosVtaPendienteFacturar,
): Promise<{ id: string; subitemsCreados: number }> {
  const { nombre, clienteId, ctaCteId, remitoId, importeTotal, lineas } = datos
  if (!mondayHabilitado()) {
    return { id: `mock-vtapend-${Date.now()}`, subitemsCreados: lineas.length }
  }

  // Índices de "0% Facturada"/"0% Facturado" (ítem y subítem) y del "🤖Tipo" del subítem, resueltos
  // por metadata en una sola consulta. El tipo de mercadería se mapea por LABEL: los índices del board
  // destino (color_mm5preby: COM=0, CO=1) NO coinciden con los del Maestro (color_mm48hm74: COM=1, CO=2).
  const meta = await mondayApi<{
    item: { columns: { settings_str: string }[] }[]
    sub: { columns: { id: string; settings_str: string }[] }[]
  }>(
    `query {
      item: boards(ids: [${BOARDS.vtasPendFacturar}]) { columns(ids: ["${COL.vtaPendFacturar.estadoFacturacion}"]) { settings_str } }
      sub: boards(ids: [${BOARDS.vtasPendFacturarSub}]) { columns(ids: ["${COL.vtaPendFacturarSub.estadoFacturacion}","${COL.vtaPendFacturarSub.tipoMercaderia}"]) { id settings_str } }
    }`,
  )
  // El texto varía entre boards ("0% Facturada" en el ítem, "0% Facturado" en el subítem): se cubren ambos.
  const itemSinFactIdx = indiceDeLabel(meta.item[0]?.columns?.[0]?.settings_str, ['0% Facturada', '0% Facturado'])
  const subCols = meta.sub[0]?.columns ?? []
  const subSinFactStr = subCols.find((c) => c.id === COL.vtaPendFacturarSub.estadoFacturacion)?.settings_str
  const subTipoStr = subCols.find((c) => c.id === COL.vtaPendFacturarSub.tipoMercaderia)?.settings_str
  const subSinFactIdx = indiceDeLabel(subSinFactStr, ['0% Facturado', '0% Facturada'])
  // Índice del tipo de mercadería en el board destino, resuelto por label (CO / COM).
  const tipoIdx = (tipo?: string): number | null => {
    const t = (tipo ?? '').trim().toUpperCase()
    if (!t) return null
    return indiceDeLabel(subTipoStr, [t])
  }

  const cabecera: Record<string, unknown> = {
    [COL.vtaPendFacturar.remito]: { item_ids: [Number(remitoId)] },
    [COL.vtaPendFacturar.importeAFacturar]: String(round2(importeTotal)),
    [COL.vtaPendFacturar.importeFacturado]: '0',
  }
  if (ctaCteId) cabecera[COL.vtaPendFacturar.ctaCte] = { item_ids: [Number(ctaCteId)] }
  // Cliente obligatorio: es la columna por la que se filtran las ventas pendientes al facturar.
  if (clienteId) cabecera[COL.vtaPendFacturar.cliente] = { item_ids: [Number(clienteId)] }
  if (itemSinFactIdx != null) cabecera[COL.vtaPendFacturar.estadoFacturacion] = { index: itemSinFactIdx }

  const creado = await mondayApi<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv) { id }
    }`,
    // El ítem raíz nace con el nombre general del tablero; su ID lo asigna la customKey del board.
    { boardId: BOARDS.vtasPendFacturar, name: 'Vtas Pend de Facturar', cv: JSON.stringify(cabecera) },
  )
  const itemId = creado.create_item.id

  // Columnas de un subelemento: producto, precio unitario, cantidad facturada 0 y estado 0% Facturado.
  const columnasSub = (l: LineaVtaPendiente): Record<string, unknown> => {
    const cv: Record<string, unknown> = {
      [COL.vtaPendFacturarSub.precioUnit]: String(round2(l.precioUnitario)),
      // Cantidad remitada = cantidad entregada del producto (pendiente de facturar).
      [COL.vtaPendFacturarSub.cantEntregada]: String(round2(l.cantidad)),
      [COL.vtaPendFacturarSub.cantFacturada]: '0',
    }
    if (l.productoId) cv[COL.vtaPendFacturarSub.producto] = { item_ids: [Number(l.productoId)] }
    if (subSinFactIdx != null) cv[COL.vtaPendFacturarSub.estadoFacturacion] = { index: subSinFactIdx }
    // Tipo de producto (CO / COM) heredado del Maestro, mapeado al índice del board destino por label.
    const idxTipo = tipoIdx(l.tipoMercaderia)
    if (idxTipo != null) cv[COL.vtaPendFacturarSub.tipoMercaderia] = { index: idxTipo }
    // Rentabilidad del producto según la lista del cliente: se guarda para reusarla al facturar.
    if (l.rentabilidad != null) {
      cv[COL.vtaPendFacturarSub.rentabilidad] = String(round2(l.rentabilidad))
    }
    return cv
  }

  let subitemsCreados = 0
  for (let desde = 0; desde < lineas.length; desde += PRODUCTOS_POR_TANDA_REMITO) {
    const tanda = lineas.slice(desde, desde + PRODUCTOS_POR_TANDA_REMITO)
    const variables: Record<string, unknown> = { parentId: itemId }
    const campos = tanda.map((l, i) => {
      const n = desde + i
      variables[`n${n}`] = nombre
      variables[`cv${n}`] = JSON.stringify(columnasSub(l))
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

/* ===== Ventas pendientes de facturar (fuente de la venta DIRECTA con entrega ANTERIOR) ===== */

/** Importe pendiente de facturar de una venta pendiente: Σ (pendiente × precio) de sus productos. */
export const montoPendienteFacturar = (r: RemitoPendiente): number =>
  round2(r.productos.reduce((acc, p) => acc + p.pendiente * p.precio, 0))

/** Un subelemento de "Vtas Pends de Facturar" mapeado a la forma `RemitoProducto` que consume la UI. */
function mapVtaPendProducto(sub: MondayItem, ventaPendId: string): RemitoProducto {
  const c = byId(sub)
  const producto = c[COL.vtaPendFacturarSub.producto]?.linked_items?.[0]
  const prodCols = producto ? byId(producto) : {}
  const entregada = numCol(c[COL.vtaPendFacturarSub.cantEntregada])
  const facturada = numCol(c[COL.vtaPendFacturarSub.cantFacturada])
  const estado = c[COL.vtaPendFacturarSub.estadoFacturacion]
  const pendiente = Math.max(entregada - facturada, 0)
  return {
    nombre: producto?.name || 'Producto sin asignar',
    codigo: producto ? valor(prodCols[COL.producto.codigo]) : '',
    cantRemito: entregada,
    cantFacturada: facturada,
    // Pendiente de facturar = entregada − facturada. Nunca baja de cero.
    pendiente,
    precio: numCol(c[COL.vtaPendFacturarSub.precioUnit]),
    // Rentabilidad guardada al remitir ("🤖Rentab %"): alimenta la rentabilidad general al facturar.
    rent: numCol(c[COL.vtaPendFacturarSub.rentabilidad]),
    // Subtotal de la línea (fórmula del board, por display_value).
    subtotal: numCol(c[COL.vtaPendFacturarSub.subtotal]),
    estadoFacturacion: estado?.text ?? '',
    // Sólo se puede facturar lo que todavía tiene unidades pendientes.
    seleccionable: pendiente > 0,
    subitemId: sub.id,
    productoId: producto?.id,
    // Linaje: a qué venta pendiente (ítem padre) pertenece el subítem.
    ventaPendId,
  }
}

/**
 * Ventas del cliente pendientes de facturar, leídas de "Vtas Pends de Facturar" (18421033947).
 * REEMPLAZA a la fuente anterior (remitos del board 18421035529). Se filtra en la consulta por el
 * cliente (board_relation_mm5pd79g) y por estado distinto de "100% Facturada" (color_mm5ndgd5, por
 * índice dinámico), sin filtrar del lado del cliente. Cada subelemento se mapea a `RemitoProducto`.
 */
export async function getVentasPendientesFacturar(cliente: Cliente): Promise<RemitoPendiente[]> {
  if (!mondayHabilitado()) {
    // Modo local: se aproxima con el mock de remitos para que el prototipo siga corriendo.
    return REMITOS.filter((r) => r.estado !== 'Facturado').map((r) => ({
      id: r.id,
      nro: r.id,
      nroRemito: r.id,
      fecha: r.fecha,
      estadoFacturacion: r.estado,
      productos: r.productos.map((p) => ({ ...p, seleccionable: p.pendiente > 0 })),
    }))
  }
  const idNum = Number(cliente.id)
  if (!Number.isFinite(idNum)) return []

  // Índice de "100% Facturada" en color_mm5ndgd5, para excluirla por query_params (no hardcodeado).
  const meta = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.vtasPendFacturar}]) { columns(ids: ["${COL.vtaPendFacturar.estadoFacturacion}"]) { settings_str } } }`,
  )
  const completaIdx = indiceDeLabel(meta.boards[0]?.columns?.[0]?.settings_str, ['100% Facturada', '100% Facturado'])
  const reglaEstado =
    completaIdx != null
      ? `, {column_id: "${COL.vtaPendFacturar.estadoFacturacion}", compare_value: [${completaIdx}], operator: not_any_of}`
      : ''

  const data = await mondayApi<{
    boards: { items_page: { items: (MondayItem & { subitems: MondayItem[] })[] } }[]
  }>(
    `query ($cliente: CompareValue!) {
      boards(ids: [${BOARDS.vtasPendFacturar}]) {
        items_page(
          limit: 100,
          query_params: {rules: [
            {column_id: "${COL.vtaPendFacturar.cliente}", compare_value: $cliente, operator: any_of}${reglaEstado}
          ]}
        ) {
          items {
            id name
            column_values(ids: ["${COL.vtaPendFacturar.estadoFacturacion}"]) { id text }
            subitems {
              id name
              column_values(ids: ["${COL.vtaPendFacturarSub.producto}","${COL.vtaPendFacturarSub.precioUnit}","${COL.vtaPendFacturarSub.subtotal}","${COL.vtaPendFacturarSub.cantEntregada}","${COL.vtaPendFacturarSub.cantFacturada}","${COL.vtaPendFacturarSub.rentabilidad}","${COL.vtaPendFacturarSub.estadoFacturacion}"]) {
                id text
                ... on StatusValue { index }
                ... on FormulaValue { display_value }
                ... on BoardRelationValue { linked_items { id name column_values(ids: ["${COL.producto.codigo}"]) { id text } } }
              }
            }
          }
        }
      }
    }`,
    { cliente: [idNum] },
  )

  return (data.boards[0]?.items_page?.items ?? []).map((it) => {
    const c = byId(it)
    return {
      id: it.id,
      nro: it.name,
      nroRemito: '',
      fecha: '',
      estadoFacturacion: c[COL.vtaPendFacturar.estadoFacturacion]?.text ?? '',
      productos: (it.subitems ?? []).map((sub) => mapVtaPendProducto(sub, it.id)),
    }
  })
}

/** Una línea facturada en esta operatoria, con su linaje en "Vtas Pends de Facturar". */
export interface LineaFacturacionVtaPend {
  /** Subítem del producto (board 18421034035) — NIVEL A. */
  subitemId?: string
  /** Ítem padre de la venta pendiente (board 18421033947) — NIVEL B. */
  ventaPendId?: string
  /** Cantidad facturada en esta operatoria. */
  aFacturar: number
  /** Precio unitario, para el monto facturado (aFacturar × precio). */
  precio: number
}

/**
 * Cierre de facturación sobre "Vtas Pends de Facturar" (18421033947), en dos niveles y por lotes:
 *  - NIVEL A (subítems): acumula la cantidad facturada (numeric_mm5nadmz += aFacturar; nulo → 0).
 *  - NIVEL B (ítems padre): acumula el importe facturado (numeric_mm5n938k += Σ aFacturar×precio,
 *    agrupado por venta) y enlaza la venta creada (board_relation_mkwbb4w4).
 * Si el NIVEL A falla, no se ejecuta el NIVEL B (no se computa el monto de productos que no se
 * actualizaron), manteniendo la coherencia financiera.
 */
export async function registrarFacturacionVtasPend(
  items: LineaFacturacionVtaPend[],
  ventaId: string,
): Promise<void> {
  if (!mondayHabilitado()) return

  // NIVEL A: cantidad facturada acumulada por subítem (agregada por si un subítem se repite).
  const porSub = new Map<string, number>()
  for (const it of items) {
    if (it.subitemId && it.aFacturar > 0) {
      porSub.set(it.subitemId, round2((porSub.get(it.subitemId) ?? 0) + it.aFacturar))
    }
  }
  const subIds = [...porSub.keys()]
  if (subIds.length > 0) {
    const data = await mondayApi<{ items: { id: string; column_values: { text: string | null }[] }[] }>(
      `query ($ids: [ID!]) { items(ids: $ids) { id column_values(ids: ["${COL.vtaPendFacturarSub.cantFacturada}"]) { text } } }`,
      { ids: subIds },
    )
    const actual = new Map<string, number>()
    for (const it of data.items ?? []) actual.set(it.id, Number(it.column_values?.[0]?.text) || 0)
    const vars: Record<string, unknown> = {}
    const campos = subIds.map((id, i) => {
      const nuevo = round2((actual.get(id) ?? 0) + (porSub.get(id) ?? 0))
      vars[`i${i}`] = id
      vars[`cv${i}`] = JSON.stringify({ [COL.vtaPendFacturarSub.cantFacturada]: String(nuevo) })
      return `a${i}: change_multiple_column_values(item_id: $i${i}, board_id: ${BOARDS.vtasPendFacturarSub}, column_values: $cv${i}) { id }`
    })
    const decl = subIds.map((_, i) => `$i${i}: ID!, $cv${i}: JSON!`).join(', ')
    await mondayApi(`mutation (${decl}) { ${campos.join('\n')} }`, vars)
  }

  // NIVEL B: importe facturado acumulado por ítem padre (agrupado por venta) + enlace de la venta.
  const montoPorPadre = new Map<string, number>()
  for (const it of items) {
    if (it.ventaPendId && it.aFacturar > 0) {
      montoPorPadre.set(
        it.ventaPendId,
        round2((montoPorPadre.get(it.ventaPendId) ?? 0) + it.aFacturar * it.precio),
      )
    }
  }
  const padres = [...montoPorPadre.keys()]
  if (padres.length === 0) return
  const data = await mondayApi<{ items: { id: string; column_values: { text: string | null }[] }[] }>(
    `query ($ids: [ID!]) { items(ids: $ids) { id column_values(ids: ["${COL.vtaPendFacturar.importeFacturado}"]) { text } } }`,
    { ids: padres },
  )
  const actual = new Map<string, number>()
  for (const it of data.items ?? []) actual.set(it.id, Number(it.column_values?.[0]?.text) || 0)
  const vars: Record<string, unknown> = {}
  const campos = padres.map((id, i) => {
    const nuevo = round2((actual.get(id) ?? 0) + (montoPorPadre.get(id) ?? 0))
    const cv: Record<string, unknown> = { [COL.vtaPendFacturar.importeFacturado]: String(nuevo) }
    if (ventaId && Number.isFinite(Number(ventaId))) {
      cv[COL.vtaPendFacturar.venta] = { item_ids: [Number(ventaId)] }
    }
    vars[`i${i}`] = id
    vars[`cv${i}`] = JSON.stringify(cv)
    return `b${i}: change_multiple_column_values(item_id: $i${i}, board_id: ${BOARDS.vtasPendFacturar}, column_values: $cv${i}) { id }`
  })
  const decl = padres.map((_, i) => `$i${i}: ID!, $cv${i}: JSON!`).join(', ')
  await mondayApi(`mutation (${decl}) { ${campos.join('\n')} }`, vars)
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
 * automatización que genera el PDF. Si viene una hoja de talonario, además la linkea en
 * "🤖Num Remito Talonario" (board_relation_mm5jy3ke). Todo va en una sola escritura, así la
 * observación y la hoja ya están cuando se dispara la generación.
 */
export async function emitirRemito(
  itemId: string,
  observaciones: string,
  hojaTalonarioId?: string,
): Promise<void> {
  if (!mondayHabilitado()) return
  const idx = await indiceEstadoRemito(COL.remito.estadoEmision, REMITO_EMISION_ESTADO.emitir)
  const cv: Record<string, unknown> = { [COL.remito.observaciones]: observaciones ?? '' }
  if (idx != null) cv[COL.remito.estadoEmision] = { index: idx }
  // La hoja del talonario numera el remito: se enlaza como board_relation (item_ids).
  if (hojaTalonarioId && Number.isFinite(Number(hojaTalonarioId))) {
    cv[COL.remito.numRemitoTalonario] = { item_ids: [Number(hojaTalonarioId)] }
  }
  await mondayApi(
    `mutation ($id: ID!, $board: ID!, $cv: JSON!) {
      change_multiple_column_values(item_id: $id, board_id: $board, column_values: $cv) { id }
    }`,
    { id: itemId, board: BOARDS.remitos, cv: JSON.stringify(cv) },
  )
}

/* ===== Conciliación del remito ANTERIOR: Pendientes de Entrega + subelemento de la Venta ===== */

/** Una línea a conciliar al emitir el remito ANTERIOR: su cantidad y sus dos destinos. */
export interface LineaEntregaAnterior {
  cantidad: number
  /** Nombre del producto, para rotular el subítem de historial. */
  nombre: string
  /** Ítem de "Pends de Entrega" (Bulk A): padre del subítem de historial de entrega. */
  pendienteEntregaId?: string
  /** Subelemento de la Venta (Bulk B): destino del acumulado de cantidad entregada. */
  ventaSubitemId?: string
}

/**
 * BULK A: crea el subítem de historial de entrega en cada "Pends de Entrega" (por lote, con alias)
 * y, en la MISMA solicitud, linkea el remito emitido en la columna a nivel ítem del pendiente
 * (board_relation_mkwbvma5). El id del remito se reusa como `item_id` del cambio de columna.
 */
async function bulkAEntrega(items: LineaEntregaAnterior[], remitoId?: string): Promise<void> {
  const conPend = items.filter((l) => l.pendienteEntregaId && l.cantidad > 0)
  if (conPend.length === 0) return
  const meta = await mondayApi<{ boards: { columns: { settings_str: string }[] }[] }>(
    `query { boards(ids: [${BOARDS.pendientesEntregaSub}]) { columns(ids: ["${COL.pendienteEntregaSub.tipoRto}"]) { settings_str } } }`,
  )
  const idx = indiceDeLabel(meta.boards[0]?.columns?.[0]?.settings_str, ['RTO Entrega A Cliente'])
  // Valor del enlace al remito (mismo para todos los pendientes), sólo si vino un id válido.
  const rcv =
    remitoId && Number.isFinite(Number(remitoId))
      ? JSON.stringify({ [COL.pendienteEntregaItem.remito]: { item_ids: [Number(remitoId)] } })
      : null
  const variables: Record<string, unknown> = {}
  const campos: string[] = []
  const decls: string[] = []
  conPend.forEach((l, i) => {
    const cv: Record<string, unknown> = {
      [COL.pendienteEntregaSub.cantRto]: String(round2(l.cantidad)),
    }
    if (idx != null) cv[COL.pendienteEntregaSub.tipoRto] = { index: idx }
    variables[`p${i}`] = l.pendienteEntregaId
    variables[`pn${i}`] = l.nombre
    variables[`pcv${i}`] = JSON.stringify(cv)
    decls.push(`$p${i}: ID!, $pn${i}: String!, $pcv${i}: JSON!`)
    campos.push(
      `p${i}: create_subitem(parent_item_id: $p${i}, item_name: $pn${i}, column_values: $pcv${i}) { id }`,
    )
    // Enlace del remito a nivel ítem del pendiente, reutilizando su id como item_id.
    if (rcv) {
      variables[`rcv${i}`] = rcv
      decls.push(`$rcv${i}: JSON!`)
      campos.push(
        `r${i}: change_multiple_column_values(item_id: $p${i}, board_id: ${BOARDS.pendientesEntrega}, column_values: $rcv${i}) { id }`,
      )
    }
  })
  await mondayApi(`mutation (${decls.join(', ')}) { ${campos.join('\n')} }`, variables)
}

/** BULK B: acumula lo entregado en el subelemento de la Venta (numeric_mm54v0jd; nulo → 0). */
async function bulkBVenta(items: LineaEntregaAnterior[]): Promise<void> {
  const conSub = items.filter((l) => l.ventaSubitemId && l.cantidad > 0)
  if (conSub.length === 0) return
  const porSub = new Map<string, number>()
  for (const l of conSub) {
    const id = l.ventaSubitemId as string
    porSub.set(id, round2((porSub.get(id) ?? 0) + l.cantidad))
  }
  const subIds = [...porSub.keys()]
  const data = await mondayApi<{ items: { id: string; column_values: { text: string | null }[] }[] }>(
    `query ($ids: [ID!]) { items(ids: $ids) { id column_values(ids: ["${COL.ventaSub.cantEntregadaPosterior}"]) { text } } }`,
    { ids: subIds },
  )
  const actual = new Map<string, number>()
  for (const it of data.items ?? []) actual.set(it.id, Number(it.column_values?.[0]?.text) || 0)
  const vars: Record<string, unknown> = {}
  const campos = subIds.map((id, i) => {
    const nuevo = round2((actual.get(id) ?? 0) + (porSub.get(id) ?? 0))
    vars[`i${i}`] = id
    vars[`cv${i}`] = JSON.stringify({ [COL.ventaSub.cantEntregadaPosterior]: String(nuevo) })
    return `b${i}: change_multiple_column_values(item_id: $i${i}, board_id: ${BOARDS.ventasSub}, column_values: $cv${i}) { id }`
  })
  const decl = subIds.map((_, i) => `$i${i}: ID!, $cv${i}: JSON!`).join(', ')
  await mondayApi(`mutation (${decl}) { ${campos.join('\n')} }`, vars)
}

/**
 * Conciliación del remito ANTERIOR mediante dos operaciones bulk PARALELAS y DESACOPLADAS:
 *  - Bulk A: subítem de historial de entrega en cada "Pends de Entrega".
 *  - Bulk B: acumula lo entregado en el subelemento de la Venta.
 * Se lanzan con `Promise.all` (no encadenadas: NO se espera A para lanzar B). El llamador la dispara
 * sin bloquear el cierre del remito (fire-and-forget).
 */
export async function afectarEntregaAnterior(
  items: LineaEntregaAnterior[],
  remitoId?: string,
): Promise<void> {
  if (!mondayHabilitado()) return
  await Promise.all([bulkAEntrega(items, remitoId), bulkBVenta(items)])
}

/** Una línea a conciliar: su cantidad remitada y los ítems de pendiente/stock a afectar. */
export interface LineaAfectacionEntrega {
  cantidad: number
  /** Nombre del producto, para rotular los subítems de movimiento. */
  nombre: string
  /** Ítem de "Pends de Entrega" (board_relation_mm5psr2k). Sin él, la línea no se afecta ahí. */
  pendienteEntregaId?: string
  /** Ítem de "Stock y Movimientos" (board_relation_mm5pz6kz). Sin él, no se afecta el stock. */
  stockId?: string
}

/**
 * Conciliación en cascada tras emitir el remito (venta ANTERIOR). Por cada producto remitado:
 *   1) crea un subítem de entrega en su "Pends de Entrega" (Q RTO + "RTO Entrega A Cliente"),
 *   2) crea un subítem de movimiento en su "Stock y Movimientos" (egreso + "RTO Venta Entrega" +
 *      fecha + número de hoja del remito), y
 *   3) resta la cantidad entregada al saldo pendiente de entrega del ítem de stock.
 *
 * Todo por lotes (bulk con alias) para ahorrar llamadas. Los índices de estado se resuelven por
 * metadata (no hardcodeados). Las líneas sin relaciones (remito POSTERIOR / catálogo) se saltean.
 * `fecha` viaja en formato YYYY-MM-DD. No toca ninguna columna fuera de las indicadas.
 */
export async function afectarEntregaRemito(
  lineas: LineaAfectacionEntrega[],
  hojaNombre: string,
  fecha: string,
): Promise<void> {
  if (!mondayHabilitado()) return
  const conPend = lineas.filter((l) => l.pendienteEntregaId && l.cantidad > 0)
  const conStock = lineas.filter((l) => l.stockId && l.cantidad > 0)
  if (conPend.length === 0 && conStock.length === 0) return

  // Índices dinámicos de los estados de cada tablero, en una sola consulta de metadata.
  const meta = await mondayApi<{
    pend: { columns: { settings_str: string }[] }[]
    stock: { columns: { settings_str: string }[] }[]
  }>(
    `query {
      pend: boards(ids: [${BOARDS.pendientesEntregaSub}]) { columns(ids: ["${COL.pendienteEntregaSub.tipoRto}"]) { settings_str } }
      stock: boards(ids: [${BOARDS.stockMovimientosSub}]) { columns(ids: ["${COL.stockMovSub.estado}"]) { settings_str } }
    }`,
  )
  const tipoRtoIdx = indiceDeLabel(meta.pend[0]?.columns?.[0]?.settings_str, ['RTO Entrega A Cliente'])
  const movEstadoIdx = indiceDeLabel(meta.stock[0]?.columns?.[0]?.settings_str, ['RTO Venta Entrega'])
  const nombreMov = (l: LineaAfectacionEntrega) => hojaNombre || l.nombre

  // 1) Afectación 1 (bulk): un subítem de entrega por producto en su "Pends de Entrega".
  if (conPend.length > 0) {
    const variables: Record<string, unknown> = {}
    const campos = conPend.map((l, i) => {
      const cv: Record<string, unknown> = {
        [COL.pendienteEntregaSub.cantRto]: String(round2(l.cantidad)),
      }
      if (tipoRtoIdx != null) cv[COL.pendienteEntregaSub.tipoRto] = { index: tipoRtoIdx }
      variables[`p${i}`] = l.pendienteEntregaId
      variables[`pn${i}`] = nombreMov(l)
      variables[`pcv${i}`] = JSON.stringify(cv)
      return `p${i}: create_subitem(parent_item_id: $p${i}, item_name: $pn${i}, column_values: $pcv${i}) { id }`
    })
    const decl = conPend.map((_, i) => `$p${i}: ID!, $pn${i}: String!, $pcv${i}: JSON!`).join(', ')
    await mondayApi(`mutation (${decl}) { ${campos.join('\n')} }`, variables)
  }

  if (conStock.length === 0) return

  // 2) Afectación 2 (bulk): un subítem de movimiento por producto en su "Stock y Movimientos".
  {
    const variables: Record<string, unknown> = {}
    const campos = conStock.map((l, i) => {
      const cv: Record<string, unknown> = {
        [COL.stockMovSub.egreso]: String(round2(l.cantidad)),
        [COL.stockMovSub.fecha]: { date: fecha },
        [COL.stockMovSub.comprobante]: hojaNombre,
      }
      if (movEstadoIdx != null) cv[COL.stockMovSub.estado] = { index: movEstadoIdx }
      variables[`s${i}`] = l.stockId
      variables[`sn${i}`] = nombreMov(l)
      variables[`scv${i}`] = JSON.stringify(cv)
      return `s${i}: create_subitem(parent_item_id: $s${i}, item_name: $sn${i}, column_values: $scv${i}) { id }`
    })
    const decl = conStock.map((_, i) => `$s${i}: ID!, $sn${i}: String!, $scv${i}: JSON!`).join(', ')
    await mondayApi(`mutation (${decl}) { ${campos.join('\n')} }`, variables)
  }

  // 3) Afectación 3: restar lo entregado al saldo del ítem de stock. Se agrega por stockId (un
  //    producto puede venir en varias líneas) y se lee/escribe en bloque. Saldo nulo/indefinido → 0.
  const porStock = new Map<string, number>()
  for (const l of conStock) {
    const id = l.stockId as string
    porStock.set(id, round2((porStock.get(id) ?? 0) + l.cantidad))
  }
  const stockIds = [...porStock.keys()]
  const saldo = await mondayApi<{ items: { id: string; column_values: { text: string | null }[] }[] }>(
    `query ($ids: [ID!]) {
      items(ids: $ids) { id column_values(ids: ["${COL.stockItem.pendEntregaVta}"]) { text } }
    }`,
    { ids: stockIds },
  )
  const actualPorId = new Map<string, number>()
  for (const it of saldo.items ?? []) {
    const n = Number(it.column_values?.[0]?.text)
    actualPorId.set(it.id, Number.isFinite(n) ? n : 0)
  }
  const upVars: Record<string, unknown> = {}
  const upCampos = stockIds.map((id, i) => {
    const nuevo = round2((actualPorId.get(id) ?? 0) - (porStock.get(id) ?? 0))
    upVars[`u${i}`] = id
    upVars[`ucv${i}`] = JSON.stringify({ [COL.stockItem.pendEntregaVta]: String(nuevo) })
    return `u${i}: change_multiple_column_values(item_id: $u${i}, board_id: ${BOARDS.stockMovimientos}, column_values: $ucv${i}) { id }`
  })
  const upDecl = stockIds.map((_, i) => `$u${i}: ID!, $ucv${i}: JSON!`).join(', ')
  await mondayApi(`mutation (${upDecl}) { ${upCampos.join('\n')} }`, upVars)
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
