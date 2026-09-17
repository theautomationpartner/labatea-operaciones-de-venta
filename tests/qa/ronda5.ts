/**
 * QA E2E · Ronda 5 — los dos cabos sueltos.
 *
 *   M13 · 7001: PROFORMA CON PRESUPUESTO PREVIO **con actividad heredada** → la venta que sale de
 *         ella es la única combinación que paga la comisión ACTIVA. Se compara lo que muestra el
 *         resumen contra lo que queda registrado.
 *   M14 ·      Revisión de "Pend Venta de Liq CYO": qué dejaron las ventas con mercadería
 *         consignada de las rondas anteriores.
 */
import { abrirCaso, anotar, chequear, paso } from './base'
import { correrVenta, type Config } from './flujos'
import { esperarEmisionElectronica, leerItem, leerItems, links, num, txt } from './verificar'
import { round2 } from '@/lib/format'
import { tasaComision, ventaItemUid } from '@/lib/selectors'
import { clienteLlevaIva } from '@/lib/precios'
import { BOARDS, COL } from '@/services/monday/columns'
import { mondayApi } from '@/services/monday/sdk'
import {
  buscarClientes,
  buscarProductos,
  crearProforma,
  getActividadesDeProforma,
  getComisionesVenta,
  getDescuentosPago,
  getDiasVencimientoFactura,
  getDiasVigencia,
  getProformasCliente,
  getTasaCambioHoy,
  getVendedores,
  limpiarCachesConsultas,
  registrarActividad,
  getContactosCliente,
} from '@/services/monday'
import { hoy } from './flujos'
import type { Cliente, VentaItem } from '@/types'

const [diasVigencia, diasVencFactura, descuentosPago, comisiones, tasaCambio, vendedores] =
  await Promise.all([
    getDiasVigencia(),
    getDiasVencimientoFactura(),
    getDescuentosPago(),
    getComisionesVenta(),
    getTasaCambioHoy(),
    getVendedores(),
  ])
const config: Config = { diasVigencia, diasVencFactura, descuentosPago, comisiones, tasaCambio }
const vendedor = vendedores.find((v) => v.id === '107870718') ?? vendedores[0]
const c7001: Cliente = (await buscarClientes('7001')).personas[0]

/* =========================================================================================
   M13 · La cadena completa: gestión → proforma con presupuesto previo → venta
   ========================================================================================= */
abrirCaso('M13 · 7001 · PROFORMA c/PRESUPUESTO PREVIO con actividad → VENTA PROFORMA (comisión ACTIVA)')

paso(`tasas del tablero: activa ${comisiones.activa}% · pasiva ${comisiones.pasiva}%`)

const contactos = await getContactosCliente(c7001.id)
const act = await registrarActividad(
  {
    tipo: 'Visita al Campo',
    fecha: hoy(),
    hora: '11:00',
    estado: 'Completada',
    resolucion: 'QA E2E · gestión que origina la proforma',
    personas: [
      {
        itemId: c7001.id,
        nombre: c7001.name,
        contactos: contactos.slice(0, 1).map((c) => ({ itemId: c.itemId ?? '', nombre: c.name })),
      },
    ],
    vendedorId: vendedor.id,
  },
  null,
)
chequear(Boolean(act.actividadId), 'Actividad de la cadena registrada', act.actividadId)

const pag = await buscarProductos('3156', c7001.list ?? 'L1', clienteLlevaIva(c7001.status), [])
const prod = pag.productos.find((p) => p.codigo === '3156')!
paso(`producto ${prod.codigo} $${prod.precio} · comisionable ${prod.comisionable}`)

const creada = await crearProforma({
  clienteId: c7001.id,
  vendedorId: vendedor.id,
  nombre: c7001.name,
  tipoVenta: 'CON PRESUPUESTO PREVIO',
  tipoEntrega: 'SIMULTANEA',
  rentabilidad: prod.rentabilidad,
  descFormaPago: 0,
  tasaCambio,
  lineas: [
    {
      productoId: prod.id,
      nombre: prod.nombre,
      cantidad: 2,
      precioUnitario: prod.precio,
      descuento: 0,
      rentabilidad: prod.rentabilidad,
      comisionable: prod.comisionable === true,
      codigo: prod.codigo,
      um: prod.um,
      tipoMercaderia: prod.tipo,
      iva: prod.iva,
      stockId: prod.stockId,
    },
  ],
  actividadesIds: [act.actividadId],
})
chequear(creada.subitemsCreados === 1, 'Proforma creada', `item ${creada.id}`)

const heredadas = await getActividadesDeProforma(creada.id)
chequear(
  heredadas.includes(act.actividadId),
  'La proforma hereda la actividad de la gestión',
  heredadas.join(', ') || 'ninguna',
)

limpiarCachesConsultas()
const pf = (await getProformasCliente(c7001.id)).find((p) => p.id === creada.id)
if (!pf) {
  anotar('BUG', 'La proforma recién emitida no aparece entre las vigentes', creada.id)
} else {
  const items: VentaItem[] = pf.productos.map((p, i) => ({
    ...p,
    uid: ventaItemUid(pf.id, i),
    aVender: p.pend,
    desc: p.descuento ?? 0,
  }))
  /* Lo que muestra el resumen de la venta (FacturaView) vs lo que recibe `crearComisiones`. */
  const tasaMostrada = tasaComision(comisiones, pf.tipoVenta, heredadas.length > 0)
  const tasaRegistrada = tasaComision(comisiones, 'DIRECTA', heredadas.length > 0)
  paso(`cadena con actividades: ${heredadas.length > 0} · tasa mostrada ${tasaMostrada}% · tasa que recibe el servicio ${tasaRegistrada}%`)

  const r13 = await correrVenta({
    operacion: 'VENTA PROFORMA',
    cliente: c7001,
    vendedor,
    config,
    tipoVenta: null,
    tipoEntrega: null,
    formaPago: null,
    ventaItems: items,
    proformaId: pf.id,
    proformaImporte: pf.importe,
    proformaTipoVenta: pf.tipoVenta,
    proformaTipoEntrega: pf.tipoEntrega,
    movimientosPorTotal: (total) => [
      { id: 'M-QA-13', formaPago: 'Efectivo', importe: total, chequeFechaPago: '' },
    ],
    observaciones: 'QA E2E M13',
  })

  const netoLinea = round2(items.reduce((a, it) => a + it.precio * it.aVender, 0))
  const comisionMostrada = round2((netoLinea * tasaMostrada) / 100)
  paso(`neto comisionable ${netoLinea} · comisión que ve el vendedor ${comisionMostrada} (${tasaMostrada}%)`)

  /* Lo que quedó en el tablero. */
  const d = await mondayApi<{ boards: { items_page: { items: { id: string }[] } }[] }>(
    `query { boards(ids: [${BOARDS.comisiones}]) { items_page(limit: 200) { items { id } } } }`,
  )
  const todas = await leerItems(d.boards[0].items_page.items.map((i) => i.id))
  const mia = todas.find((c) => links(c, COL.comision.venta).some((l) => l.id === r13.ventaId))
  if (!mia) {
    anotar('BUG', 'No se registró la comisión de la VENTA PROFORMA', `venta ${r13.ventaId}`)
  } else {
    const totalRegistrado = num(mia, COL.comision.total)
    const tasaSub = mia.subitems[0] ? num(mia.subitems[0], COL.comisionSub.comision) : 0
    paso(`comisión ${mia.id} · total registrado ${totalRegistrado} · % en el subelemento ${tasaSub}`)
    chequear(
      Math.abs(totalRegistrado - comisionMostrada) <= 1,
      'VENTA PROFORMA · la comisión registrada es la que vio el vendedor',
      `registrada ${totalRegistrado} (${tasaSub}%) vs mostrada ${comisionMostrada} (${tasaMostrada}%)`,
    )
  }
  await esperarEmisionElectronica(r13.comprobantes.map((c) => c.id), { intentos: 4, intervalo: 5000 })
}

/* =========================================================================================
   M14 · Qué quedó en "Pend Venta de Liq CYO"
   ========================================================================================= */
abrirCaso('M14 · Pend Venta de Liq CYO (mercadería consignada facturada)')

const cyo = await mondayApi<{
  boards: { items_page: { items: { id: string; name: string; created_at: string }[] } }[]
}>(
  `query { boards(ids: [${BOARDS.consignacionesCYO}]) { items_page(limit: 200) { items { id name created_at } } } }`,
)
const items = cyo.boards[0].items_page.items
const hoyISO = new Date().toISOString().slice(0, 10)
const nuevos = items.filter((i) => i.created_at.startsWith(hoyISO))
paso(`ítems CYO en total: ${items.length} · creados hoy: ${nuevos.length}`)
for (const n of nuevos) {
  const it = await leerItem(n.id)
  if (!it) continue
  paso(
    `CYO ${it.id} "${it.name}" · producto ${links(it, COL.consignacionCYO.producto).map((l) => l.name).join(',') || '—'} · ` +
      `cant ${num(it, COL.consignacionCYO.cantidad)} · precio ${num(it, COL.consignacionCYO.precio)} · ` +
      `fecha ${txt(it, COL.consignacionCYO.fecha)} · pdf ${it.assets.length}`,
  )
  chequear(
    !it.name.startsWith('Sin proveedor'),
    'CYO · el ítem se nombra con el proveedor de la mercadería consignada',
    it.name,
  )
  chequear(
    it.assets.length > 0,
    'CYO · el PDF de la factura quedó adjunto',
    `${it.assets.length} archivo(s)`,
    'WARN',
  )
}

const { informe } = await import('./base')
informe()
