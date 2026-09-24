/**
 * QA E2E · Ronda 6 — verificación de los tres arreglos contra Monday.
 *
 *   V1 · 7001: repite M4 (VENTA DIRECTA · SIMULTÁNEA · CONTADO con IVA 21% + 10,5% + consignada).
 *        El total de la venta, el del recibo y el de las facturas tienen que ser el MISMO número.
 *   V3 · 7000: repite M11 (PROFORMA con descuento manual + forma de pago). Lo que muestra la card
 *        tiene que ser lo que queda en el tablero.
 *   V2 · 7001: repite M13 (proforma CON PRESUPUESTO PREVIO con actividad → VENTA PROFORMA). La
 *        comisión registrada tiene que ser la tasa Activa que ve el vendedor.
 */
import { abrirCaso, anotar, chequear, esperar, paso } from './base'
import { aPesos, correrVenta, hoy, linea, type Config } from './flujos'
import {
  casi,
  leerItem,
  leerItems,
  links,
  num,
  txt,
  verificarComprobantes,
  verificarRecibo,
  verificarVenta,
} from './verificar'
import { alicuotaDeclarada, descuentoUnitario, ivaLinea } from '@/lib/descuentos'
import { descuentoDeFormaPago } from '@/lib/cobros'
import { trunc2 } from '@/lib/format'
import { esDolar } from '@/lib/moneda'
import { clienteLlevaIva } from '@/lib/precios'
import { tasaComision, ventaItemUid } from '@/lib/selectors'
import { BOARDS, COL } from '@/services/monday/columns'
import { mondayApi } from '@/services/monday/sdk'
import {
  buscarClientes,
  buscarProductos,
  crearProforma,
  getComisionesVenta,
  getContactosCliente,
  getDescuentosPago,
  getDiasVencimientoFactura,
  getDiasVigencia,
  getProformasCliente,
  getTasaCambioHoy,
  getVendedores,
  limpiarCachesConsultas,
  registrarActividad,
} from '@/services/monday'
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
const c7001: Cliente = (await buscarClientes('7001')).personas[0]
const c7000: Cliente = (await buscarClientes('7000')).personas[0]

const productoVenta = async (codigo: string, c: Cliente): Promise<Producto> => {
  const pag = await buscarProductos(codigo, c.list ?? 'L1', clienteLlevaIva(c.status), [])
  const p = pag.productos.find((x) => x.codigo === codigo)
  if (!p) throw new Error(`no se encontró el producto ${codigo}`)
  return esDolar(p.moneda) && tasaCambio ? aPesos(p, tasaCambio) : p
}

/* =========================================================================================
   V1 · Bug #1 · el total de la venta DIRECTA == el total facturado
   ========================================================================================= */
abrirCaso('V1 · 7001 · VENTA DIRECTA · SIMULTÁNEA · CONTADO · IVA 21% + 10,5% + consignada')

const p21 = await productoVenta('3156', c7001)
const p105 = await productoVenta('3269', c7001)
const pco = await productoVenta('3', c7001)
paso(`${p21.codigo} iva ${p21.iva}% · ${p105.codigo} iva ${p105.iva}% · ${pco.codigo} iva ${pco.iva}% (${pco.tipo})`)

const r1 = await correrVenta({
  operacion: 'VENTA',
  cliente: c7001,
  vendedor,
  config,
  tipoVenta: 'DIRECTA',
  tipoEntrega: 'SIMULTANEA',
  formaPago: 'CONTADO',
  lineas: [linea(p21, 2, 0), linea(p105, 1, 0), linea(pco, 3, 4)],
  movimientosPorTotal: (total) => [
    { id: 'M-QA-V1', formaPago: 'Efectivo', importe: total, chequeFechaPago: '' },
  ],
  observaciones: 'QA E2E V1 (fix IVA)',
})

paso(`total venta ${r1.totalVenta} · total facturado ${r1.totalFacturado}`)
chequear(
  casi(r1.totalVenta, r1.totalFacturado, 0.02),
  'Bug #1 · el total de la VENTA es el total FACTURADO',
  `venta ${r1.totalVenta} vs facturas ${r1.totalFacturado} · diferencia ${trunc2(r1.totalVenta - r1.totalFacturado)}`,
)
await verificarVenta({
  cliente: c7001,
  vendedorId: vendedor.id,
  tipoVenta: 'DIRECTA',
  tipoEntrega: 'SIMULTANEA',
  tipoCobro: 'Simultaneo',
  r: r1,
})
/* El cliente tiene CUENTA CORRIENTE pactada, pero la venta se cobró al CONTADO: el comprobante
   tiene que declarar "Contado". */
await verificarComprobantes({
  cliente: c7001,
  r: r1,
  letra: 'A',
  sitIva: 'Responsable Inscripto',
  condicionVenta: 'Contado',
  leyendaEntrega: 'Mercaderia 100% Entregada',
})
await verificarRecibo(r1)

/* El recibo tiene que cerrar CONTRA SUS PROPIOS SUBELEMENTOS: lo que declara cancelar de facturas
   y lo que declara recibir por los medios de cobro. Eso es lo que antes no cerraba. */
if (r1.reciboId) {
  const recibo = await leerItem(r1.reciboId)
  if (recibo) {
    const cancelado = trunc2(
      recibo.subitems
        .filter((s) => txt(s, COL.cobroSub.formaPago) === 'Fact Cancelada')
        .reduce((a, s) => a + num(s, COL.cobroSub.importeCancelado), 0),
    )
    const recibido = trunc2(
      recibo.subitems.reduce((a, s) => a + num(s, COL.cobroSub.importeRecibido), 0),
    )
    paso(`recibo ${recibo.id}: facturas canceladas ${cancelado} · recibido ${recibido} · cabecera ${num(recibo, COL.cobro.totalVenta)}`)
    chequear(
      casi(cancelado, recibido, 0.02),
      'Bug #1 · el recibo cancela exactamente lo que recibe',
      `canceladas ${cancelado} vs recibido ${recibido} · diferencia ${trunc2(recibido - cancelado)}`,
    )
    chequear(
      casi(num(recibo, COL.cobro.totalVenta), cancelado, 1),
      'Bug #1 · la cabecera del recibo dice lo mismo que sus subelementos',
      `cabecera ${num(recibo, COL.cobro.totalVenta)} vs facturas ${cancelado}`,
    )
  }
}

/* La cabecera del ítem de venta también: "🤖Importe Total $" y el TOTAL calculado por el board. */
const venta1 = await leerItem(r1.ventaId)
if (venta1) {
  /* "🤖TOTAL $" del board es `importeTotalPesos` (numeric_mm5qbwer). `COL.venta.total`
     (numeric_mm5s9zx5) ya NO existe en el tablero: la escritura se pierde en silencio. */
  paso(
    `venta ${venta1.id}: TOTAL $ ${num(venta1, COL.venta.importeTotalPesos)} · ` +
      `IVA Total ${num(venta1, COL.venta.ivaTotal)} · Desc Total ${num(venta1, COL.venta.descuentoTotal)}`,
  )
  chequear(
    casi(num(venta1, COL.venta.importeTotalPesos), r1.totalFacturado, 1),
    'Bug #1 · el "🤖TOTAL $" del ítem de venta es el de sus facturas',
    `${num(venta1, COL.venta.importeTotalPesos)} vs ${r1.totalFacturado}`,
  )
}

/* =========================================================================================
   V3 · Bug #3 · la proforma que se ve es la que se emite
   ========================================================================================= */
abrirCaso('V3 · 7000 · PROFORMA con descuento manual + forma de pago')

const prod = await productoVenta('3156', c7000)
const DESC_MANUAL = 4
const CANT = 3
const descFP = descuentoDeFormaPago('CONTADO', descuentosPago)
paso(`producto ${prod.codigo} $${prod.precio} iva ${prod.iva}% · desc manual ${DESC_MANUAL}% + forma de pago ${descFP}%`)

/* Los números de la card, con las MISMAS funciones que ahora usa `CobroProforma`. */
const bonifUnit = descuentoUnitario(prod.precio, DESC_MANUAL, descFP).total
const netoCard = trunc2((prod.precio - bonifUnit) * CANT)
const ivaCard = ivaLinea(netoCard, alicuotaDeclarada(prod.iva))
const totalCard = trunc2(netoCard + ivaCard)
paso(`card → bonif/u ${bonifUnit} · neto ${netoCard} · IVA ${ivaCard} · TOTAL ${totalCard}`)

const creada = await crearProforma({
  clienteId: c7000.id,
  vendedorId: vendedor.id,
  nombre: c7000.name,
  tipoVenta: 'DIRECTA',
  tipoEntrega: 'SIMULTANEA',
  rentabilidad: prod.rentabilidad,
  descFormaPago: descFP,
  tasaCambio,
  lineas: [
    {
      productoId: prod.id,
      nombre: prod.nombre,
      cantidad: CANT,
      precioUnitario: prod.precio,
      descuento: DESC_MANUAL,
      rentabilidad: prod.rentabilidad,
      comisionable: prod.comisionable === true,
      codigo: prod.codigo,
      um: prod.um,
      tipoMercaderia: prod.tipo,
      iva: prod.iva,
      stockId: prod.stockId,
    },
  ],
  actividadesIds: [],
})
const pfItem = await leerItem(creada.id)
if (!pfItem) {
  anotar('BUG', 'No se pudo leer la proforma recién creada', creada.id)
} else {
  paso(`tablero → IVA ${num(pfItem, COL.proforma.ivaTotal)} · TOTAL ${num(pfItem, COL.proforma.total)}`)
  chequear(
    casi(num(pfItem, COL.proforma.total), totalCard, 0.02),
    'Bug #3 · el TOTAL emitido es el que muestra la card',
    `tablero ${num(pfItem, COL.proforma.total)} vs card ${totalCard}`,
  )
  chequear(
    casi(num(pfItem, COL.proforma.ivaTotal), ivaCard, 0.02),
    'Bug #3 · el IVA emitido es el de la card',
    `tablero ${num(pfItem, COL.proforma.ivaTotal)} vs card ${ivaCard}`,
  )
}

/* =========================================================================================
   V2 · Bug #2 · la comisión registrada es la que ve el vendedor
   ========================================================================================= */
abrirCaso('V2 · 7001 · gestión → PROFORMA c/PRESUPUESTO PREVIO → VENTA PROFORMA (comisión ACTIVA)')

paso(`tasas: activa ${comisiones.activa}% · pasiva ${comisiones.pasiva}%`)
const contactos = await getContactosCliente(c7001.id)
const act = await registrarActividad(
  {
    tipo: 'Visita al Campo',
    fecha: hoy(),
    hora: '15:00',
    estado: 'Completada',
    resolucion: 'QA E2E V2 · gestión que origina la proforma',
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

const pComision = await productoVenta('3156', c7001)
const pfCom = await crearProforma({
  clienteId: c7001.id,
  vendedorId: vendedor.id,
  nombre: c7001.name,
  tipoVenta: 'CON PRESUPUESTO PREVIO',
  tipoEntrega: 'SIMULTANEA',
  rentabilidad: pComision.rentabilidad,
  descFormaPago: 0,
  tasaCambio,
  lineas: [
    {
      productoId: pComision.id,
      nombre: pComision.nombre,
      cantidad: 2,
      precioUnitario: pComision.precio,
      descuento: 0,
      rentabilidad: pComision.rentabilidad,
      comisionable: pComision.comisionable === true,
      codigo: pComision.codigo,
      um: pComision.um,
      tipoMercaderia: pComision.tipo,
      iva: pComision.iva,
      stockId: pComision.stockId,
    },
  ],
  actividadesIds: [act.actividadId],
})

limpiarCachesConsultas()
const pf = (await getProformasCliente(c7001.id)).find((p) => p.id === pfCom.id)
if (!pf) {
  anotar('BUG', 'La proforma recién emitida no aparece entre las vigentes', pfCom.id)
} else {
  const items: VentaItem[] = pf.productos.map((p, i) => ({
    ...p,
    uid: ventaItemUid(pf.id, i),
    aVender: p.pend,
    desc: p.descuento ?? 0,
  }))
  const tasaEsperada = tasaComision(comisiones, pf.tipoVenta, true)
  const netoComisionable = trunc2(items.reduce((a, it) => a + it.precio * it.aVender, 0))
  const comisionEsperada = trunc2((netoComisionable * tasaEsperada) / 100)
  paso(`proforma ${pf.nro} · ${pf.tipoVenta} · neto ${netoComisionable} · comisión que ve el vendedor ${comisionEsperada} (${tasaEsperada}%)`)

  const r2 = await correrVenta({
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
      { id: 'M-QA-V2', formaPago: 'Efectivo', importe: total, chequeFechaPago: '' },
    ],
    observaciones: 'QA E2E V2 (fix comisión)',
  })
  /* La VENTA PROFORMA no elige forma de pago y se cobra siempre en el acto: su comprobante tiene
     que declarar "Contado", aunque 7001 tenga CUENTA CORRIENTE pactada. */
  await verificarComprobantes({
    cliente: c7001,
    r: r2,
    letra: 'A',
    sitIva: 'Responsable Inscripto',
    condicionVenta: 'Contado',
  })
  chequear(
    r2.tasaComisionUsada === tasaEsperada,
    'Bug #2 · la app calcula la comisión con la tasa de la PROFORMA',
    `usada ${r2.tasaComisionUsada}% vs esperada ${tasaEsperada}%`,
  )

  /* El ítem de comisión se crea y recién después Monday indexa su relación con la venta: leerlo de
     una vez —o a los pocos segundos— daba falsos negativos sobre un registro que SÍ existía y era
     correcto. Se reintenta hasta un minuto. */
  const buscarComision = async () => {
    for (let i = 0; i < 12; i++) {
      const d = await mondayApi<{ boards: { items_page: { items: { id: string }[] } }[] }>(
        `query { boards(ids: [${BOARDS.comisiones}]) { items_page(limit: 200) { items { id } } } }`,
      )
      const todas = await leerItems(d.boards[0].items_page.items.map((x) => x.id))
      const hallada = todas.find((c) => links(c, COL.comision.venta).some((l) => l.id === r2.ventaId))
      if (hallada) return hallada
      await esperar(5000)
    }
    return undefined
  }
  const mia = await buscarComision()
  if (!mia) {
    anotar('BUG', 'No se registró la comisión de la VENTA PROFORMA', `venta ${r2.ventaId}`)
  } else {
    const totalRegistrado = num(mia, COL.comision.total)
    const tasaSub = mia.subitems[0] ? num(mia.subitems[0], COL.comisionSub.comision) : 0
    paso(`comisión ${mia.id} · total registrado ${totalRegistrado} · % en el subelemento ${tasaSub}`)
    chequear(
      casi(totalRegistrado, comisionEsperada, 1),
      'Bug #2 · la comisión REGISTRADA es la que vio el vendedor',
      `registrada ${totalRegistrado} (${tasaSub}%) vs mostrada ${comisionEsperada} (${tasaEsperada}%)`,
    )
    chequear(
      tasaSub === tasaEsperada,
      'Bug #2 · el subelemento guarda la tasa Activa',
      `${tasaSub}% vs ${tasaEsperada}%`,
    )
  }
}

const { informe } = await import('./base')
informe()
