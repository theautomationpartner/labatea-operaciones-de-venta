/**
 * QA E2E · Ronda 1.
 *
 * Tres "momentos de venta" mezclados, como los tendría un vendedor en una mañana:
 *   M1 · 7000 (cliente recién contactado): registra la gestión y le manda un PRESUPUESTO.
 *   M2 · 7001 (cliente de siempre): cierra una VENTA sobre un presupuesto suyo, mercadería mixta,
 *        entrega POSTERIOR y a CUENTA CORRIENTE.
 *   M3 · 7000: le factura la PROFORMA que ya tenía abierta, cobrándola en el acto.
 */
import { abrirCaso, anotar, chequear, esperar, informe, paso } from './base'
import { correrPresupuesto, correrVenta, hoy, linea, type Config } from './flujos'
import {
  esperarEmisionElectronica,
  leerItem,
  links,
  num,
  txt,
  verificarComision,
  verificarComprobantes,
  verificarDeuda,
  verificarRecibo,
  verificarVenta,
} from './verificar'
import { round2 } from '@/lib/format'
import { ventaItemUid } from '@/lib/selectors'
import { COL, BOARDS } from '@/services/monday/columns'
import { mondayApi } from '@/services/monday/sdk'
import {
  buscarClientes,
  buscarProductos,
  getComisionesVenta,
  getContactosCliente,
  getDescuentosPago,
  getDiasVencimientoFactura,
  getDiasVigencia,
  getPresupuestosVigentes,
  getProformasCliente,
  getTasaCambioHoy,
  getVendedores,
  registrarActividad,
} from '@/services/monday'
import type { Cliente, Producto, VentaItem } from '@/types'

/* ===== Arranque de la app ===== */
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
/* El vendedor de la sesión: el usuario logueado (admin de la cuenta, puede figurar en los tableros). */
const vendedor = vendedores.find((v) => v.id === '107870718') ?? vendedores[0]
paso(`vendedor de la sesión: ${vendedor.name} (${vendedor.id})`)

const cliente = async (cod: string): Promise<Cliente> => {
  const { personas } = await buscarClientes(cod)
  if (!personas[0]) throw new Error(`no se encontró el cliente ${cod}`)
  return personas[0]
}
const c7001 = await cliente('7001')
const c7000 = await cliente('7000')

const buscarProducto = async (codigo: string, c: Cliente, conIva: boolean): Promise<Producto> => {
  const pag = await buscarProductos(codigo, c.list ?? 'L1', conIva, [])
  const p = pag.productos.find((x) => x.codigo === codigo)
  if (!p) throw new Error(`no se encontró el producto ${codigo}`)
  return p
}

/* =========================================================================================
   M1 · Cliente 7000 — gestión comercial + presupuesto
   ========================================================================================= */
abrirCaso('M1 · 7000 · REGISTRO DE ACTIVIDAD + PRESUPUESTAR (COM comisionable + CO consignada)')

const contactos7000 = await getContactosCliente(c7000.id)
const contactoOk7000 = contactos7000.filter((c) => c.ok && c.email)
paso(`contactos con email y "ACEPTA PRESUPUESTO": ${contactoOk7000.map((c) => c.name).join(', ')}`)

const act = await registrarActividad(
  {
    tipo: 'Llamada telefónica',
    fecha: hoy(),
    hora: '09:30',
    estado: 'Completada',
    resolucion: 'QA E2E · pidió presupuesto por lactoreemplazante y ácido',
    personas: [
      {
        itemId: c7000.id,
        nombre: c7000.name,
        contactos: contactoOk7000
          .slice(0, 1)
          .map((c) => ({ itemId: c.itemId ?? '', nombre: c.name })),
      },
    ],
    vendedorId: vendedor.id,
  },
  null,
)
chequear(Boolean(act.actividadId), 'Actividad registrada', `item ${act.actividadId}`)
chequear(act.sinCompletar === 0, 'Actividad · todos los ítems quedaron completos', `${act.sinCompletar} sin completar`)

/* El PRESUPUESTO nunca lleva IVA en el precio (ver ProductosView: `conIva = esVenta && ...`). */
const p3156 = await buscarProducto('3156', c7000, false) // COM · comisionable
const pCO = await buscarProducto('3', c7000, false) // CO · consignada
paso(`producto COM ${p3156.codigo} "${p3156.nombre}" $${p3156.precio} com=${p3156.comisionable}`)
paso(`producto CO  ${pCO.codigo} "${pCO.nombre}" $${pCO.precio} tipo=${pCO.tipo} prov="${pCO.provNombre}"`)

const pres7000 = await correrPresupuesto({
  cliente: c7000,
  vendedor,
  lineas: [linea(p3156, 2, 3), linea(pCO, 4, 0)],
  config,
  actividadesIds: [act.actividadId],
  enviar: { contactos: contactoOk7000.slice(0, 1), medio: 'Email' },
})

/* El presupuesto tiene que quedar colgado de la gestión que lo originó. */
const presItem = await leerItem(pres7000.presupuestoId)
if (presItem) {
  chequear(
    links(presItem, COL.presupuesto.actividades).some((l) => l.id === act.actividadId),
    'Presupuesto · actividad de origen enlazada',
    links(presItem, COL.presupuesto.actividades).map((l) => l.id).join(', ') || 'vacío',
  )
  chequear(
    presItem.subitems.length === 2,
    'Presupuesto · un subelemento por producto',
    `${presItem.subitems.length}`,
  )
  paso(`presupuesto ${presItem.id} "${presItem.name}" · nro ${txt(presItem, COL.presupuesto.pulseId)}`)
}
chequear(
  pres7000.estadoEnvio === 'Enviado',
  'Make · envío del presupuesto terminó en "Enviado"',
  `estado final: "${pres7000.estadoEnvio}"`,
  'WARN',
)

/* =========================================================================================
   M2 · Cliente 7001 — venta sobre presupuesto previo, mercadería mixta, POSTERIOR + CTA CTE
   ========================================================================================= */
abrirCaso('M2 · 7001 · VENTA c/PRESUPUESTO PREVIO · POSTERIOR · CUENTA CORRIENTE · COM+CO (2 facturas)')

const presupuestos7001 = await getPresupuestosVigentes(c7001.id)
const elegido = presupuestos7001.find((p) => p.productos.some((x) => x.tipo === 'CO')) ?? presupuestos7001[0]
paso(`presupuesto elegido: ${elegido.nro} (${elegido.id}) · ${elegido.productos.length} productos · importe ${elegido.importe}`)

const ventaItems: VentaItem[] = elegido.productos.map((prod, i) => ({
  ...prod,
  uid: ventaItemUid(elegido.id, i),
  aVender: prod.pend,
  desc: prod.descuento ?? 0,
}))
paso(
  `a vender: ${ventaItems.map((it) => `${it.nombre.slice(0, 28)} x${it.aVender} (${it.tipo}, desc ${it.desc}%)`).join(' | ')}`,
)

const r2 = await correrVenta({
  operacion: 'VENTA',
  cliente: c7001,
  vendedor,
  config,
  tipoVenta: 'CON PRESUPUESTO PREVIO',
  tipoEntrega: 'POSTERIOR',
  formaPago: 'CUENTA CORRIENTE',
  ventaItems,
  entregaVenta: { responsable: 'LA_BATEA', rutaId: '12517273236', rutaConfirmada: true },
  observaciones: 'QA E2E M2',
})

await verificarVenta({
  cliente: c7001,
  vendedorId: vendedor.id,
  tipoVenta: 'CON PRESUPUESTO PREVIO',
  tipoEntrega: 'POSTERIOR',
  tipoCobro: 'Posterior',
  r: r2,
  presupuestoIds: [elegido.id],
})
await verificarComprobantes({
  cliente: c7001,
  r: r2,
  letra: 'A', // 7001 es Responsable Inscripto
  sitIva: 'Responsable Inscripto',
  condicionVenta: 'Cuenta Corriente',
})
await verificarDeuda(r2, c7001)
await verificarComision(r2)

/* La entrega POSTERIOR tiene que dejar un pendiente por producto, con la ruta elegida. */
const venta2 = await leerItem(r2.ventaId)
if (venta2) {
  const pendIds = venta2.subitems.flatMap((s) => links(s, COL.ventaSub.pendienteEntrega).map((l) => l.id))
  chequear(
    pendIds.length === r2.productos.length,
    'Entrega POSTERIOR · un pendiente de entrega por producto',
    `${pendIds.length} de ${r2.productos.length}`,
  )
  if (pendIds.length > 0) {
    const pendientes = await Promise.all(pendIds.map((id) => leerItem(id)))
    for (const p of pendientes) {
      if (!p) continue
      paso(`pendiente ${p.id} "${p.name}" · cant ${num(p, COL.pendienteEntregaItem.cantidad)} · ruta ${links(p, COL.pendienteEntregaItem.ruta).map((l) => l.name).join(',') || '—'}`)
      chequear(
        links(p, COL.pendienteEntregaItem.ruta).length > 0,
        'Pendiente de entrega · ruta asignada',
        links(p, COL.pendienteEntregaItem.ruta).map((l) => l.name).join(', ') || 'vacía',
        'WARN',
      )
      chequear(
        links(p, COL.pendienteEntregaItem.cliente).some((l) => l.id === c7001.id),
        'Pendiente de entrega · cliente enlazado',
        links(p, COL.pendienteEntregaItem.cliente).map((l) => l.name).join(', ') || 'vacío',
      )
    }
  }
  /* Con entrega POSTERIOR la mercadería NO salió: no puede haber movimiento de stock. */
  chequear(
    venta2.subitems.every((s) => links(s, COL.ventaSub.stock).length >= 0),
    'Venta POSTERIOR · subelementos leídos',
    '',
  )
}

/* El presupuesto de origen tiene que quedar con su cantidad vendida acumulada. */
const presOrigen = await leerItem(elegido.id)
if (presOrigen) {
  for (const it of ventaItems) {
    const sub = presOrigen.subitems.find((s) => s.id === it.subitemId)
    if (!sub) continue
    const vendida = num(sub, COL.presupuestoSub.cantVendida)
    chequear(
      vendida === it.aVender,
      'Presupuesto de origen · "Cant Vendida" actualizada',
      `${sub.name.slice(0, 30)}: ${vendida} (vendido ${it.aVender})`,
    )
  }
}

paso('esperando la emisión electrónica (Make) de los comprobantes de M2…')
await esperarEmisionElectronica(r2.comprobantes.map((c) => c.id))

/* =========================================================================================
   M3 · Cliente 7000 — factura la proforma abierta, cobrada en el acto
   ========================================================================================= */
abrirCaso('M3 · 7000 · VENTA PROFORMA · cobro SIMULTÁNEO')

const proformas = await getProformasCliente(c7000.id)
if (proformas.length === 0) {
  anotar('WARN', 'No hay proformas vigentes para 7000', 'se saltea M3')
} else {
  const pf = proformas[0]
  paso(`proforma ${pf.nro} (${pf.id}) · ${pf.tipoVenta}/${pf.tipoEntrega} · importe ${pf.importe}`)
  const itemsPf: VentaItem[] = pf.productos.map((prod, i) => ({
    ...prod,
    uid: ventaItemUid(pf.id, i),
    aVender: prod.pend,
    desc: prod.descuento ?? 0,
  }))

  const r3 = await correrVenta({
    operacion: 'VENTA PROFORMA',
    cliente: c7000,
    vendedor,
    config,
    tipoVenta: null,
    tipoEntrega: null,
    formaPago: null,
    ventaItems: itemsPf,
    proformaId: pf.id,
    proformaImporte: pf.importe,
    proformaTipoVenta: pf.tipoVenta,
    proformaTipoEntrega: pf.tipoEntrega,
    movimientos: [
      {
        id: 'M-QA-1',
        formaPago: 'Efectivo',
        importe: round2(pf.importe / (1 - descuentosPago.Efectivo / 100)),
        chequeFechaPago: '',
      },
    ],
    observaciones: 'QA E2E M3',
  })

  await verificarVenta({
    cliente: c7000,
    vendedorId: vendedor.id,
    tipoVenta: pf.tipoVenta,
    tipoEntrega: pf.tipoEntrega,
    tipoCobro: 'Simultaneo',
    r: r3,
    proformaId: pf.id,
  })
  await verificarComprobantes({
    cliente: c7000,
    r: r3,
    letra: 'B', // 7000 es Consumidor Final
    sitIva: 'Consumidor Final',
    condicionVenta: 'Cuenta Corriente',
    leyendaEntrega: pf.tipoEntrega === 'SIMULTANEA' ? 'Mercaderia 100% Entregada' : undefined,
  })
  await verificarRecibo(r3)
  await verificarComision(r3)

  /* La proforma facturada tiene que quedar "Usada". */
  const pfItem = await leerItem(pf.id)
  if (pfItem) {
    paso(`proforma tras facturar: estado "${txt(pfItem, COL.proforma.estadoVenta)}"`)
    chequear(
      /usad/i.test(txt(pfItem, COL.proforma.estadoVenta)),
      'Proforma · queda marcada como Usada',
      txt(pfItem, COL.proforma.estadoVenta) || 'vacío',
    )
  }

  /* Entrega SIMULTÁNEA: tiene que haber movimiento de stock por producto. */
  if (pf.tipoEntrega === 'SIMULTANEA') {
    for (const prod of r3.productos) {
      if (!prod.stockId) continue
      const stock = await leerItem(prod.stockId)
      if (!stock) continue
      const idVta = txt((await leerItem(r3.ventaId))!, COL.venta.idVta)
      const movs = stock.subitems.filter((s) => s.name.includes(idVta))
      chequear(
        movs.length > 0,
        'Entrega SIMULTÁNEA · movimiento de stock creado',
        `${prod.nombre.slice(0, 30)}: ${movs.length} movimiento(s) con "${idVta}"`,
      )
      for (const m of movs) {
        paso(`  mov ${m.id} "${m.name}" egreso ${num(m, COL.stockMovSub.egreso)} comp "${txt(m, COL.stockMovSub.comprobante)}"`)
        chequear(
          Boolean(txt(m, COL.stockMovSub.comprobante)),
          'Movimiento de stock · N° de comprobante estampado',
          txt(m, COL.stockMovSub.comprobante) || 'vacío',
          'WARN',
        )
      }
    }
  }

  paso('esperando la emisión electrónica (Make) de los comprobantes de M3…')
  await esperarEmisionElectronica(r3.comprobantes.map((c) => c.id))
}

informe()
