/**
 * QA E2E · Verificación contra los tableros.
 *
 * Lee lo que quedó escrito —por la app y por los escenarios de Make.com— y lo contrasta con lo que
 * la operación decía que iba a hacer. Todo por la MISMA API que usa la app.
 */
import { anotar, chequear, esperar, paso } from './base'
import { round2 } from '@/lib/format'
import { BOARDS, COL } from '@/services/monday/columns'
import { mondayApi } from '@/services/monday/sdk'
import type { ResultadoVenta } from './flujos'
import type { Cliente, TipoEntrega, TipoVenta } from '@/types'

export interface ItemLeido {
  id: string
  name: string
  col: Record<string, { text: string | null; value: string | null; display?: string | null; links?: { id: string; name: string }[] }>
  subitems: ItemLeido[]
  assets: { id: string; name: string }[]
}

const FRAG = `
  id
  name
  assets { id name }
  column_values {
    id text value
    ... on FormulaValue { display_value }
    ... on MirrorValue { display_value }
    ... on BoardRelationValue { linked_items { id name } }
  }
`

interface Crudo {
  id: string
  name: string
  assets?: { id: string; name: string }[]
  column_values: {
    id: string
    text: string | null
    value: string | null
    display_value?: string | null
    linked_items?: { id: string; name: string }[]
  }[]
  subitems?: Crudo[]
}

const mapear = (c: Crudo): ItemLeido => ({
  id: c.id,
  name: c.name,
  col: Object.fromEntries(
    c.column_values.map((v) => [
      v.id,
      { text: v.text, value: v.value, display: v.display_value ?? null, links: v.linked_items },
    ]),
  ),
  subitems: (c.subitems ?? []).map(mapear),
  assets: c.assets ?? [],
})

/** Un ítem con sus subelementos, todas sus columnas y sus archivos. */
export async function leerItem(id: string): Promise<ItemLeido | null> {
  const d = await mondayApi<{ items: Crudo[] }>(
    `query ($ids: [ID!]) { items(ids: $ids) { ${FRAG} subitems { ${FRAG} } } }`,
    { ids: [id] },
  )
  const it = d.items?.[0]
  return it ? mapear(it) : null
}

export async function leerItems(ids: string[]): Promise<ItemLeido[]> {
  if (ids.length === 0) return []
  const d = await mondayApi<{ items: Crudo[] }>(
    `query ($ids: [ID!]) { items(ids: $ids) { ${FRAG} subitems { ${FRAG} } } }`,
    { ids },
  )
  return (d.items ?? []).map(mapear)
}

export const txt = (it: ItemLeido, col: string): string => (it.col[col]?.text ?? '').trim()
export const num = (it: ItemLeido, col: string): number => {
  const v = it.col[col]
  const s = (v?.text ?? v?.display ?? '').replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}
export const links = (it: ItemLeido, col: string): { id: string; name: string }[] => it.col[col]?.links ?? []

/** Igualdad de importes con la tolerancia de un centavo. */
export const casi = (a: number, b: number, tol = 0.02): boolean => Math.abs(a - b) <= tol

/* ===================== VENTA ===================== */

export interface EsperadoVenta {
  cliente: Cliente
  vendedorId: string
  tipoVenta: TipoVenta
  tipoEntrega: TipoEntrega
  tipoCobro: 'Simultaneo' | 'Posterior'
  r: ResultadoVenta
  /** Presupuestos que originaron la venta (CON PRESUPUESTO PREVIO). */
  presupuestoIds?: string[]
  proformaId?: string | null
}

const ENTREGA_LABEL: Record<TipoEntrega, string> = {
  ANTERIOR: 'Anterior',
  POSTERIOR: 'Posterior',
  SIMULTANEA: 'Simultánea',
}
const TIPO_VENTA_LABEL: Record<TipoVenta, string> = {
  DIRECTA: 'Directa',
  'CON PRESUPUESTO PREVIO': 'C/ Presup Previo',
}

export async function verificarVenta(e: EsperadoVenta): Promise<ItemLeido | null> {
  const v = await leerItem(e.r.ventaId)
  if (!v) {
    anotar('BUG', 'La venta no se pudo leer del tablero', `item ${e.r.ventaId}`)
    return null
  }
  paso(`venta ${v.id} · "${v.name}" · ID VTA ${txt(v, COL.venta.idVta)}`)

  chequear(
    txt(v, COL.venta.tipoVenta) === TIPO_VENTA_LABEL[e.tipoVenta],
    'Venta · "Tipo De Vta" correcto',
    `${txt(v, COL.venta.tipoVenta)} (esperado ${TIPO_VENTA_LABEL[e.tipoVenta]})`,
  )
  chequear(
    txt(v, COL.venta.tipoEntrega) === ENTREGA_LABEL[e.tipoEntrega],
    'Venta · "Tipo de Entrega" correcto',
    `${txt(v, COL.venta.tipoEntrega)} (esperado ${ENTREGA_LABEL[e.tipoEntrega]})`,
  )
  chequear(
    txt(v, COL.venta.tipoCobro).toLowerCase().startsWith(e.tipoCobro.toLowerCase().slice(0, 6)),
    'Venta · "Tipo de Cobro" correcto',
    `${txt(v, COL.venta.tipoCobro)} (esperado ${e.tipoCobro})`,
  )
  chequear(
    links(v, COL.venta.cliente).some((l) => l.id === e.cliente.id),
    'Venta · cliente enlazado',
    links(v, COL.venta.cliente).map((l) => l.name).join(', ') || 'vacío',
  )
  const persona = (v.col[COL.venta.vendedor]?.value ?? '')
  chequear(
    persona.includes(e.vendedorId),
    'Venta · vendedor asignado',
    txt(v, COL.venta.vendedor) || persona || 'vacío',
  )
  chequear(
    casi(num(v, COL.venta.importeTotalPesos), e.r.totalVenta, 1),
    'Venta · "Importe Total $" = total real de la venta',
    `board ${num(v, COL.venta.importeTotalPesos)} vs app ${e.r.totalVenta}`,
  )
  const facturasEnVenta = links(v, COL.venta.facturacion).map((l) => l.id)
  chequear(
    e.r.comprobantes.every((c) => facturasEnVenta.includes(c.id)),
    'Venta · comprobantes enlazados',
    `${facturasEnVenta.length} de ${e.r.comprobantes.length}`,
  )
  if (e.proformaId) {
    chequear(
      links(v, COL.venta.proforma).some((l) => l.id === e.proformaId),
      'Venta · proforma de origen enlazada',
      links(v, COL.venta.proforma).map((l) => l.id).join(', ') || 'vacío',
    )
  }
  if (e.presupuestoIds && e.presupuestoIds.length > 0) {
    const enlazados = links(v, COL.venta.presupuestos).map((l) => l.id)
    chequear(
      e.presupuestoIds.every((p) => enlazados.includes(p)),
      'Venta · presupuestos de origen enlazados',
      `${enlazados.join(', ') || 'vacío'} (esperado ${e.presupuestoIds.join(', ')})`,
    )
  }
  if (e.r.actividadesIds.length > 0) {
    const act = links(v, COL.venta.actividades).map((l) => l.id)
    chequear(
      e.r.actividadesIds.every((a) => act.includes(a)),
      'Venta · actividades enlazadas',
      `${act.join(', ') || 'vacío'} (esperado ${e.r.actividadesIds.join(', ')})`,
    )
  }

  /* --- Subelementos: uno por producto --- */
  chequear(
    v.subitems.length === e.r.productos.length,
    'Venta · un subelemento por producto',
    `${v.subitems.length} de ${e.r.productos.length}`,
  )
  const totalSubs = round2(v.subitems.reduce((a, s) => a + num(s, COL.ventaSub.subtotal), 0))
  paso(`subtotal de subelementos: ${totalSubs}`)

  /* El board renombra los subelementos con su customKey, así que el match va por el PRODUCTO
     enlazado (y, sin relación, por posición). Buscarlos por nombre daba falsos faltantes. */
  for (const [i, p] of e.r.productos.entries()) {
    const s =
      v.subitems.find((x) => links(x, COL.ventaSub.producto).some((l) => l.id === p.productoId)) ??
      v.subitems[i]
    if (!s) {
      anotar('BUG', 'Venta · falta el subelemento de un producto', p.nombre)
      continue
    }
    if (!casi(num(s, COL.ventaSub.cantidad), p.cantidad)) {
      anotar('BUG', 'Venta · cantidad del subelemento no coincide', `${p.nombre}: board ${num(s, COL.ventaSub.cantidad)} vs ${p.cantidad}`)
    }
    if (!casi(num(s, COL.ventaSub.precioUnit), round2(p.precioUnitario), 0.05)) {
      anotar('BUG', 'Venta · precio unitario del subelemento no coincide', `${p.nombre}: board ${num(s, COL.ventaSub.precioUnit)} vs ${round2(p.precioUnitario)}`)
    }
    /* Entrega: la simultánea sale con la factura, la anterior ya salió, la posterior no salió. */
    const simult = num(s, COL.ventaSub.cantEntregadaSimult)
    const post = num(s, COL.ventaSub.cantEntregadaPosterior)
    const ant = num(s, COL.ventaSub.cantEntregadaAnterior)
    if (e.tipoEntrega === 'SIMULTANEA' && !casi(simult, p.cantidad)) {
      anotar('BUG', 'Venta SIMULTÁNEA · "Cant Entregada Simult" ≠ vendido', `${p.nombre}: ${simult} vs ${p.cantidad}`)
    }
    if (e.tipoEntrega === 'POSTERIOR' && post !== 0) {
      anotar('BUG', 'Venta POSTERIOR · "Cant Entregada Posterior" debería nacer en 0', `${p.nombre}: ${post}`)
    }
    if (e.tipoEntrega === 'ANTERIOR' && !casi(ant, p.cantidad)) {
      anotar('BUG', 'Venta ANTERIOR · "Cant Entregada Anterior" ≠ facturado', `${p.nombre}: ${ant} vs ${p.cantidad}`)
    }
  }
  return v
}

/* ===================== COMPROBANTES ===================== */

export interface EsperadoComprobantes {
  cliente: Cliente
  r: ResultadoVenta
  letra: string
  sitIva: string
  condicionVenta: string
  /** Leyenda que debe aparecer en Observaciones (entrega SIMULTÁNEA). */
  leyendaEntrega?: string
}

export async function verificarComprobantes(e: EsperadoComprobantes): Promise<ItemLeido[]> {
  const ids = e.r.comprobantes.map((c) => c.id).filter(Boolean)
  const items = await leerItems(ids)
  chequear(items.length === ids.length, 'Comprobantes · todos existen en el tablero', `${items.length}/${ids.length}`)

  for (const f of items) {
    paso(`comprobante ${f.id} · "${f.name}" · ${f.subitems.length} línea(s)`)
    chequear(
      txt(f, COL.facturacion.razonSocial) === e.cliente.name,
      'Comprobante · razón social',
      `${txt(f, COL.facturacion.razonSocial)}`,
    )
    const cuitBoard = txt(f, COL.facturacion.cuit).replace(/\D/g, '')
    chequear(
      cuitBoard === e.cliente.cuit.replace(/\D/g, ''),
      'Comprobante · CUIT',
      `${cuitBoard} vs ${e.cliente.cuit}`,
    )
    chequear(txt(f, COL.facturacion.letra) === e.letra, 'Comprobante · letra', `${txt(f, COL.facturacion.letra)} (esperado ${e.letra})`)
    chequear(
      txt(f, COL.facturacion.sitIva) === e.sitIva,
      'Comprobante · situación IVA del receptor',
      `${txt(f, COL.facturacion.sitIva)} (esperado ${e.sitIva})`,
    )
    chequear(
      txt(f, COL.facturacion.condicionVenta) === e.condicionVenta,
      'Comprobante · condición de venta',
      `${txt(f, COL.facturacion.condicionVenta)} (esperado ${e.condicionVenta})`,
    )
    chequear(
      links(f, COL.facturacion.venta).some((l) => l.id === e.r.ventaId),
      'Comprobante · enlazado a la venta',
      links(f, COL.facturacion.venta).map((l) => l.id).join(', ') || 'vacío',
    )
    if (e.leyendaEntrega) {
      chequear(
        txt(f, COL.facturacion.observaciones).includes(e.leyendaEntrega),
        'Comprobante · leyenda de entrega en Observaciones',
        txt(f, COL.facturacion.observaciones) || 'vacío',
      )
    }
    const vto = txt(f, COL.facturacion.fechaVtoPago)
    paso(`  emisión ${txt(f, COL.facturacion.fechaEmision)} · vto pago ${vto}`)
  }
  return items
}

/** Espera a que la emisión electrónica (Make) complete número y PDF de cada comprobante. */
export async function esperarEmisionElectronica(
  ids: string[],
  { intentos = 20, intervalo = 6000 }: { intentos?: number; intervalo?: number } = {},
): Promise<ItemLeido[]> {
  let ultimos: ItemLeido[] = []
  for (let i = 0; i < intentos; i++) {
    ultimos = await leerItems(ids)
    const listos = ultimos.filter(
      (f) => txt(f, COL.facturacion.nroFactura) && f.assets.length > 0,
    )
    if (listos.length === ids.length) break
    await esperar(intervalo)
  }
  for (const f of ultimos) {
    const nro = txt(f, COL.facturacion.nroFactura)
    const comp = txt(f, COL.facturacion.nroComprobante)
    const pdf = f.assets.map((a) => a.name).join(', ')
    chequear(Boolean(nro), 'Make · N° Factura asignado', `${f.id}: "${nro}"`, 'WARN')
    chequear(Boolean(comp), 'Make · N° Comprobante asignado', `${f.id}: "${comp}"`, 'WARN')
    chequear(f.assets.length > 0, 'Make · PDF del comprobante generado', `${f.id}: ${pdf || 'sin archivo'}`, 'WARN')
    chequear(
      txt(f, 'status') !== 'Crear Comprobante',
      'Make · el estado del comprobante avanzó desde "Crear Comprobante"',
      `${f.id}: "${txt(f, 'status')}"`,
      'WARN',
    )
  }
  return ultimos
}

/* ===================== DEUDA / RECIBO / COMISIÓN ===================== */

/** Busca en un board los ítems creados en los últimos `minutos` que enlacen a `ventaId`. */
async function porRelacion(boardId: number, columna: string, ventaId: string): Promise<ItemLeido[]> {
  /* El filtro `query_params` sobre una columna de relación NO matchea por id, así que se recorre
     el tablero y se filtra en memoria por el ítem enlazado. */
  const items: ItemLeido[] = []
  let cursor: string | null = null
  do {
    const q: string = cursor
      ? `query { next_items_page(limit: 200, cursor: "${cursor}") { cursor items { ${FRAG} subitems { ${FRAG} } } } }`
      : `query { boards(ids: [${boardId}]) { items_page(limit: 200) { cursor items { ${FRAG} subitems { ${FRAG} } } } } }`
    const d = await mondayApi<{
      boards?: { items_page: { cursor: string | null; items: Crudo[] } }[]
      next_items_page?: { cursor: string | null; items: Crudo[] }
    }>(q)
    const pagina: { cursor: string | null; items: Crudo[] } | undefined = cursor
      ? d.next_items_page
      : d.boards?.[0]?.items_page
    items.push(...(pagina?.items ?? []).map(mapear))
    cursor = pagina?.cursor ?? null
  } while (cursor)
  return items.filter((i) => links(i, columna).some((l) => l.id === ventaId))
}

export async function verificarDeuda(r: ResultadoVenta, cliente: Cliente) {
  if (!r.deudaId) return null
  const deuda = await leerItem(r.deudaId)
  if (!deuda) {
    anotar('BUG', 'La deuda (Fact Vtas Pends de Cobro) no se pudo leer', r.deudaId)
    return null
  }
  paso(`deuda ${deuda.id} · "${deuda.name}"`)
  chequear(
    casi(num(deuda, COL.factPendiente.total), r.totalVenta, 1),
    'Deuda · importe = total de la venta',
    `${num(deuda, COL.factPendiente.total)} vs ${r.totalVenta}`,
  )
  chequear(
    links(deuda, COL.factPendiente.venta).some((l) => l.id === r.ventaId),
    'Deuda · enlazada a la venta',
    links(deuda, COL.factPendiente.venta).map((l) => l.id).join(', ') || 'vacío',
  )
  chequear(
    links(deuda, COL.factPendiente.cliente).some((l) => l.id === cliente.id),
    'Deuda · enlazada al cliente',
    links(deuda, COL.factPendiente.cliente).map((l) => l.name).join(', ') || 'vacío',
  )
  chequear(
    Boolean(txt(deuda, COL.factPendiente.vencimiento)),
    'Deuda · fecha de vencimiento cargada',
    txt(deuda, COL.factPendiente.vencimiento) || 'vacía',
  )
  return deuda
}

export async function verificarRecibo(r: ResultadoVenta) {
  if (!r.reciboId) return null
  const recibo = await leerItem(r.reciboId)
  if (!recibo) {
    anotar('BUG', 'El recibo no se pudo leer', r.reciboId)
    return null
  }
  paso(`recibo ${recibo.id} · "${recibo.name}" · ${recibo.subitems.length} subelemento(s)`)
  chequear(
    casi(num(recibo, COL.cobro.totalVenta), r.totalVenta, 1),
    'Recibo · "Total Venta" = total de la venta',
    `${num(recibo, COL.cobro.totalVenta)} vs ${r.totalVenta}`,
  )
  chequear(
    casi(num(recibo, COL.cobro.diferencia), 0, 1),
    'Recibo · diferencia en cero',
    `${num(recibo, COL.cobro.diferencia)}`,
  )
  return recibo
}

export async function verificarComision(r: ResultadoVenta) {
  const items = await porRelacion(BOARDS.comisiones, COL.comision.venta, r.ventaId)
  if (r.comisionEsperada <= 0) {
    chequear(items.length === 0, 'Comisión · no se registra si ningún producto comisiona', `${items.length} ítem(s)`)
    return null
  }
  if (items.length === 0) {
    anotar('BUG', 'Comisión · no se creó el registro', `venta ${r.ventaId}, esperado ${r.comisionEsperada}`)
    return null
  }
  const c = items[0]
  paso(`comisión ${c.id} · "${c.name}" · total ${num(c, COL.comision.total)}`)
  chequear(
    casi(num(c, COL.comision.total), r.comisionEsperada, 1),
    'Comisión · total = el que mostró el resumen',
    `${num(c, COL.comision.total)} vs ${r.comisionEsperada} (tasa ${r.tasaComisionUsada}%)`,
  )
  chequear(
    casi(num(c, COL.comision.pendienteCobro), r.totalVenta, 1) || num(c, COL.comision.pendienteCobro) === 0,
    'Comisión · pendiente de cobro coherente',
    `${num(c, COL.comision.pendienteCobro)} vs total venta ${r.totalVenta}`,
    'WARN',
  )
  return c
}

/* ===================== PENDIENTES DE ENTREGA / STOCK ===================== */

export async function verificarPendientesEntrega(r: ResultadoVenta, cliente: Cliente) {
  const d = await mondayApi<{ boards: { items_page: { items: Crudo[] } }[] }>(
    `query { boards(ids: [${BOARDS.pendientesEntrega}]) { items_page(limit: 100, query_params: {rules: [{column_id: "${COL.pendienteEntregaItem.cliente}", compare_value: ["${cliente.id}"], operator: any_of}]}) { items { ${FRAG} subitems { ${FRAG} } } } } }`,
  )
  const todos = (d.boards[0]?.items_page?.items ?? []).map(mapear)
  const idVta = r.ventaId
  const mios = todos.filter((p) =>
    links(p, COL.pendienteEntregaItem.ventaSubelemento).length > 0 &&
    p.name.includes(txt(p, COL.pendienteEntregaItem.nroFactura) ?? ''),
  )
  return { todos, mios, idVta }
}

export async function verificarCYO(r: ResultadoVenta, desde: Date) {
  const d = await mondayApi<{ boards: { items_page: { items: Crudo[] } }[] }>(
    `query { boards(ids: [${BOARDS.consignacionesCYO}]) { items_page(limit: 60) { items { ${FRAG} } } } }`,
  )
  const items = (d.boards[0]?.items_page?.items ?? []).map(mapear)
  const nuevos = items.filter((i) => Number(i.id) > 0)
  return { items, nuevos, desde, r }
}
