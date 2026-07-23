/**
 * Capa de servicio de los remitos de venta ("🧾🚚 Remitos Ventas", 18421035529).
 *
 * Es el origen de los productos cuando la entrega es ANTERIOR: la mercadería ya salió y lo
 * que falta es facturarla. Igual que el resto de la app, con token pega contra la API real y
 * sin token cae al mock para que el prototipo siga corriendo en local.
 */
import { REMITOS } from '@/data/mock'
import { clienteLlevaIva, precioConIva } from '@/lib/precios'
import type { Cliente, ListaPrecio, RemitoProducto } from '@/types'
import {
  BOARDS,
  COL,
  REMITO_ESTADO_FACT_INDEX,
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
