/**
 * QA E2E · Ronda 2.
 *
 *   M4 · 7001: VENTA DIRECTA · SIMULTÁNEA · CONTADO, con mercadería común al 21%, común al 10,5%
 *        (además en dólares) y consignada → dos comprobantes, recibo, stock y CYO.
 *   M5 · 7000: VENTA DIRECTA · POSTERIOR · TARJETA DE CRÉDITO.
 *   M6 · 7001: VENTA c/PRESUPUESTO PREVIO · SIMULTÁNEA · TARJETA DE DÉBITO.
 */
import { abrirCaso, anotar, chequear, paso } from './base'
import { aPesos, correrVenta, linea, type Config } from './flujos'
import {
  casi,
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
import { esDolar } from '@/lib/moneda'
import { ventaItemUid } from '@/lib/selectors'
import { COL } from '@/services/monday/columns'
import {
  buscarClientes,
  buscarProductos,
  getComisionesVenta,
  getCuentasBancariasPropias,
  getDescuentosPago,
  getDiasVencimientoFactura,
  getDiasVigencia,
  getPresupuestosVigentes,
  getTasaCambioHoy,
  getVendedores,
} from '@/services/monday'
import { clienteLlevaIva } from '@/lib/precios'
import type { Cliente, Producto, VentaItem } from '@/types'

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

const cliente = async (cod: string): Promise<Cliente> => {
  const { personas } = await buscarClientes(cod)
  return personas[0]
}
const c7001 = await cliente('7001')
const c7000 = await cliente('7000')

/** Igual que la etapa de productos de la VENTA: precio con IVA si el cliente lo paga, y $ si viene en USD. */
const productoVenta = async (codigo: string, c: Cliente): Promise<Producto> => {
  const conIva = clienteLlevaIva(c.status)
  const pag = await buscarProductos(codigo, c.list ?? 'L1', conIva, [])
  const p = pag.productos.find((x) => x.codigo === codigo)
  if (!p) throw new Error(`no se encontró el producto ${codigo}`)
  return esDolar(p.moneda) && tasaCambio ? aPesos(p, tasaCambio) : p
}

/* =========================================================================================
   M4 · 7001 · VENTA DIRECTA · SIMULTÁNEA · CONTADO · 21% + 10,5% + consignada
   ========================================================================================= */
abrirCaso('M4 · 7001 · VENTA DIRECTA · SIMULTÁNEA · CONTADO · IVA mixto (21% y 10,5%) + consignada')

const p21 = await productoVenta('3156', c7001) // COM · 21% · comisionable · pesos
const p105 = await productoVenta('3269', c7001) // COM · 10,5% · comisionable · dólares
const pco = await productoVenta('3', c7001) // CO · 21% · no comisionable
for (const p of [p21, p105, pco]) {
  paso(`${p.codigo} "${p.nombre.slice(0, 38)}" $${p.precio} iva ${p.iva}% tipo ${p.tipo} com ${p.comisionable} usd ${p.precioUsd ?? '—'}`)
}

const lineasM4 = [linea(p21, 2, 0), linea(p105, 1, 0), linea(pco, 3, 4)]
const r4 = await correrVenta({
  operacion: 'VENTA',
  cliente: c7001,
  vendedor,
  config,
  tipoVenta: 'DIRECTA',
  tipoEntrega: 'SIMULTANEA',
  formaPago: 'CONTADO',
  lineas: lineasM4,
  // El vendedor cobra en efectivo exactamente lo que marca la métrica "TOTAL VENTA".
  movimientosPorTotal: (total) => [
    { id: 'M-QA-M4', formaPago: 'Efectivo', importe: total, chequeFechaPago: '' },
  ],
  observaciones: 'QA E2E M4',
})

/* El movimiento del cobro tiene que ser EXACTAMENTE el total de la venta. Se calcula después de
   conocerlo, igual que hace el vendedor al ver la métrica "TOTAL VENTA". */
paso(`total venta ${r4.totalVenta} · total facturado ${r4.totalFacturado}`)
chequear(
  casi(r4.totalVenta, r4.totalFacturado, 1),
  'El total de la VENTA coincide con el total FACTURADO',
  `venta ${r4.totalVenta} vs facturas ${r4.totalFacturado} · diferencia ${round2(r4.totalVenta - r4.totalFacturado)}`,
)

await verificarVenta({
  cliente: c7001,
  vendedorId: vendedor.id,
  tipoVenta: 'DIRECTA',
  tipoEntrega: 'SIMULTANEA',
  tipoCobro: 'Simultaneo',
  r: r4,
})
await verificarComprobantes({
  cliente: c7001,
  r: r4,
  letra: 'A',
  sitIva: 'Responsable Inscripto',
  condicionVenta: 'Cuenta Corriente',
  leyendaEntrega: 'Mercaderia 100% Entregada',
})
await verificarRecibo(r4)
await verificarComision(r4)

/* Alícuota declarada en cada línea del comprobante: tiene que ser la del producto. */
for (const c of r4.comprobantes) {
  const f = await leerItem(c.id)
  if (!f) continue
  for (const s of f.subitems) {
    const prod = r4.productos.find((p) => p.nombre === s.name)
    if (!prod) continue
    const alic = txt(s, COL.facturacionSub.alicuotaIva)
    chequear(
      Number(alic) === (prod.iva ?? 21),
      'Línea del comprobante · alícuota declarada = la del producto',
      `${s.name.slice(0, 30)}: ${alic}% (producto ${prod.iva}%)`,
    )
  }
}

/* Entrega SIMULTÁNEA: movimiento de stock por producto, con el número del comprobante. */
const venta4 = await leerItem(r4.ventaId)
const idVta4 = venta4 ? txt(venta4, COL.venta.idVta) : ''
paso(`ID VTA ${idVta4}`)
for (const prod of r4.productos) {
  if (!prod.stockId) continue
  const stock = await leerItem(prod.stockId)
  if (!stock) continue
  const movs = stock.subitems.filter((s) => idVta4 && s.name.includes(idVta4))
  chequear(
    movs.length > 0,
    'Entrega SIMULTÁNEA · movimiento de stock creado',
    `${prod.nombre.slice(0, 30)}: ${movs.length}`,
  )
  for (const m of movs) {
    chequear(
      casi(num(m, COL.stockMovSub.egreso), prod.cantidad),
      'Movimiento de stock · egreso = cantidad vendida',
      `${m.name.slice(0, 40)}: ${num(m, COL.stockMovSub.egreso)} vs ${prod.cantidad}`,
    )
    chequear(
      Boolean(txt(m, COL.stockMovSub.comprobante)),
      'Movimiento de stock · N° de comprobante estampado',
      `${m.name.slice(0, 40)}: "${txt(m, COL.stockMovSub.comprobante)}"`,
      'WARN',
    )
  }
}

paso('esperando la emisión electrónica (Make) de M4…')
await esperarEmisionElectronica(r4.comprobantes.map((c) => c.id))

/* =========================================================================================
   M5 · 7000 · VENTA DIRECTA · POSTERIOR · TARJETA DE CRÉDITO
   ========================================================================================= */
abrirCaso('M5 · 7000 · VENTA DIRECTA · POSTERIOR · TARJETA DE CRÉDITO')

const cuentas = await getCuentasBancariasPropias()
paso(`cuentas propias: ${cuentas.map((c) => c.name).join(', ') || 'ninguna'}`)

const p21b = await productoVenta('3156', c7000)
const p105b = await productoVenta('3269', c7000)
paso(`7000 paga IVA en el precio: ${clienteLlevaIva(c7000.status)} · ${p21b.codigo} $${p21b.precio}`)

const r5 = await correrVenta({
  operacion: 'VENTA',
  cliente: c7000,
  vendedor,
  config,
  tipoVenta: 'DIRECTA',
  tipoEntrega: 'POSTERIOR',
  formaPago: 'TARJETA DE CREDITO',
  lineas: [linea(p21b, 1, 0), linea(p105b, 2, 0)],
  /* Con TARJETA los cupones van SIN descuento por medio de pago: el de la forma de pago ya está
     aplicado en el precio de la venta. */
  movimientosPorTotal: (total) => [
    {
      id: 'M-QA-TC',
      formaPago: 'Tarjeta de crédito',
      importe: total,
      chequeFechaPago: '',
      numeroCupon: '000123',
      bancoTarjeta: 'Banco Galicia',
      tipoTarjeta: 'VISA',
      cuentaPropiaId: cuentas[0]?.id ?? null,
      cuentaPropia: cuentas[0]?.name ?? null,
    },
  ],
  entregaVenta: { responsable: 'CLIENTE' },
  observaciones: 'QA E2E M5',
})

paso(`descFP de la tarjeta de crédito aplicado en el precio: ${r5.descFormaPago}%`)

await verificarVenta({
  cliente: c7000,
  vendedorId: vendedor.id,
  tipoVenta: 'DIRECTA',
  tipoEntrega: 'POSTERIOR',
  tipoCobro: 'Simultaneo', // la tarjeta se cobra en el acto
  r: r5,
})
await verificarComprobantes({
  cliente: c7000,
  r: r5,
  letra: 'B',
  sitIva: 'Consumidor Final',
  condicionVenta: 'Cuenta Corriente',
})
await verificarComision(r5)
chequear(
  r5.deudaId === null,
  'TARJETA · la venta NO deja deuda en Fact Vtas Pends de Cobro',
  r5.deudaId ?? 'sin deuda',
)

/* POSTERIOR: pendientes de entrega por producto. */
const venta5 = await leerItem(r5.ventaId)
if (venta5) {
  const pendIds = venta5.subitems.flatMap((s) => links(s, COL.ventaSub.pendienteEntrega).map((l) => l.id))
  chequear(
    pendIds.length === r5.productos.length,
    'Entrega POSTERIOR · un pendiente por producto',
    `${pendIds.length} de ${r5.productos.length}`,
  )
  for (const id of pendIds) {
    const p = await leerItem(id)
    if (!p) continue
    paso(`pendiente ${p.id} "${p.name}" cant ${num(p, COL.pendienteEntregaItem.cantidad)} nroFact "${txt(p, COL.pendienteEntregaItem.nroFactura)}"`)
    chequear(
      Boolean(txt(p, COL.pendienteEntregaItem.nroFactura)),
      'Pendiente de entrega · "Nro Factura" completo',
      txt(p, COL.pendienteEntregaItem.nroFactura) || 'vacío',
      'WARN',
    )
  }
  chequear(
    links(venta5, COL.venta.ruta).length === 0,
    'Responsable CLIENTE · no se asigna ruta de La Batea',
    links(venta5, COL.venta.ruta).map((l) => l.name).join(', ') || 'sin ruta',
  )
  paso(`responsable de entrega en la venta: "${txt(venta5, COL.venta.responsableEntrega)}"`)
}

paso('esperando la emisión electrónica (Make) de M5…')
await esperarEmisionElectronica(r5.comprobantes.map((c) => c.id))

/* =========================================================================================
   M6 · 7001 · VENTA c/PRESUPUESTO PREVIO · SIMULTÁNEA · TARJETA DE DÉBITO
   ========================================================================================= */
abrirCaso('M6 · 7001 · VENTA c/PRESUPUESTO PREVIO · SIMULTÁNEA · TARJETA DE DÉBITO')

const presupuestos = await getPresupuestosVigentes(c7001.id)
const conPendiente = presupuestos.filter((p) => p.productos.some((x) => x.pend > 0))
if (conPendiente.length === 0) {
  anotar('WARN', 'No quedan presupuestos con unidades pendientes para 7001', 'se saltea M6')
} else {
  const pres = conPendiente[0]
  paso(`presupuesto ${pres.nro} (${pres.id})`)
  const items: VentaItem[] = pres.productos
    .filter((p) => p.pend > 0)
    .map((prod, i) => ({ ...prod, uid: ventaItemUid(pres.id, i), aVender: prod.pend, desc: prod.descuento ?? 0 }))

  const r6 = await correrVenta({
    operacion: 'VENTA',
    cliente: c7001,
    vendedor,
    config,
    tipoVenta: 'CON PRESUPUESTO PREVIO',
    tipoEntrega: 'SIMULTANEA',
    formaPago: 'TARJETA DE DEBITO',
    ventaItems: items,
    movimientosPorTotal: (total) => [
      {
        id: 'M-QA-TD',
        formaPago: 'Tarjeta de débito',
        importe: total,
        chequeFechaPago: '',
        numeroCupon: '000456',
        bancoTarjeta: 'Banco Nación',
        tipoTarjeta: 'MAESTRO',
        cuentaPropiaId: cuentas[0]?.id ?? null,
        cuentaPropia: cuentas[0]?.name ?? null,
      },
    ],
    observaciones: 'QA E2E M6',
  })
  paso(`descFP aplicado: ${r6.descFormaPago}% · total venta ${r6.totalVenta} · facturado ${r6.totalFacturado}`)
  chequear(
    casi(r6.totalVenta, r6.totalFacturado, 1),
    'El total de la VENTA coincide con el total FACTURADO (tarjeta de débito)',
    `venta ${r6.totalVenta} vs facturas ${r6.totalFacturado}`,
  )
  await verificarVenta({
    cliente: c7001,
    vendedorId: vendedor.id,
    tipoVenta: 'CON PRESUPUESTO PREVIO',
    tipoEntrega: 'SIMULTANEA',
    tipoCobro: 'Simultaneo',
    r: r6,
    presupuestoIds: [pres.id],
  })
  await verificarComision(r6)
  paso(`tasa de comisión usada: ${r6.tasaComisionUsada}% (actividades: ${r6.actividadesIds.length})`)
  await esperarEmisionElectronica(r6.comprobantes.map((c) => c.id))
}

const { informe } = await import('./base')
informe()
