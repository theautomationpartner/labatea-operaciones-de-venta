/**
 * QA E2E · Ronda 4 — la rama de la PROFORMA (cliente agente de retención).
 *
 *   M11 · 7000: emite una PROFORMA con descuento manual + descuento por forma de pago y se compara
 *         lo que MUESTRA la pantalla (CobroProforma) contra lo que QUEDA en el tablero.
 *   M12 · 7000: factura esa proforma como VENTA PROFORMA y se compara la comisión que el vendedor
 *         ve en el resumen contra la que queda registrada.
 */
import { abrirCaso, anotar, chequear, paso } from './base'
import { correrVenta, type Config } from './flujos'
import { casi, esperarEmisionElectronica, leerItem, num, txt, verificarComision, verificarVenta } from './verificar'
import { descuentoUnitario, ivaLinea } from '@/lib/descuentos'
import { trunc2 } from '@/lib/format'
import { IVA_RATE, tasaComision, ventaItemUid } from '@/lib/selectors'
import { clienteLlevaIva } from '@/lib/precios'
import { descuentoDeFormaPago } from '@/lib/cobros'
import { COL } from '@/services/monday/columns'
import {
  buscarClientes,
  buscarProductos,
  crearProforma,
  getComisionesVenta,
  getDescuentosPago,
  getDiasVencimientoFactura,
  getDiasVigencia,
  getProformasCliente,
  getTasaCambioHoy,
  getVendedores,
  limpiarCachesConsultas,
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
const c7000: Cliente = (await buscarClientes('7000')).personas[0]

const productoVenta = async (codigo: string): Promise<Producto> => {
  const pag = await buscarProductos(codigo, c7000.list ?? 'L1', clienteLlevaIva(c7000.status), [])
  const p = pag.productos.find((x) => x.codigo === codigo)
  if (!p) throw new Error(`no se encontró el producto ${codigo}`)
  return p
}

/* =========================================================================================
   M11 · La proforma: lo que se ve vs lo que se guarda
   ========================================================================================= */
abrirCaso('M11 · 7000 (agente de retención) · emite PROFORMA con descuento manual + forma de pago')

const prod = await productoVenta('3156') // COM · 21% · comisionable
const DESC_MANUAL = 4
const CANT = 3
const descFormaPago = descuentoDeFormaPago('CONTADO', descuentosPago)
paso(`producto ${prod.codigo} $${prod.precio} · desc manual ${DESC_MANUAL}% · desc forma de pago ${descFormaPago}%`)

const lineas = [
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
]

/* (a) Lo que MUESTRA la pantalla "Emitir Proforma" (CobroProforma.tsx): descuentos SUMADOS y un
   IVA plano del 21%. */
const descPantalla = Math.min(DESC_MANUAL + descFormaPago, 100)
const bonifPantalla = trunc2((prod.precio * descPantalla) / 100)
const netoPantalla = trunc2((prod.precio - bonifPantalla) * CANT)
const ivaPantalla = trunc2(netoPantalla * IVA_RATE)
const totalPantalla = trunc2(netoPantalla + ivaPantalla)

/* (b) Lo que ESCRIBE `crearProforma` en el tablero: descuentos EN CASCADA y el IVA del producto. */
const bonifBoard = descuentoUnitario(prod.precio, DESC_MANUAL, descFormaPago).total
const netoBoard = trunc2((prod.precio - bonifBoard) * CANT)
const ivaBoard = ivaLinea(netoBoard, prod.iva ?? 21)
const totalBoard = trunc2(netoBoard + ivaBoard)

paso(`pantalla → bonif/u ${bonifPantalla} · neto ${netoPantalla} · IVA ${ivaPantalla} · TOTAL ${totalPantalla}`)
paso(`tablero  → bonif/u ${bonifBoard} · neto ${netoBoard} · IVA ${ivaBoard} · TOTAL ${totalBoard}`)
chequear(
  casi(totalPantalla, totalBoard, 0.02),
  'Proforma · el total que ve el vendedor es el que queda en el tablero',
  `pantalla ${totalPantalla} vs tablero ${totalBoard} · diferencia ${trunc2(totalBoard - totalPantalla)}`,
)

const creada = await crearProforma({
  clienteId: c7000.id,
  vendedorId: vendedor.id,
  nombre: c7000.name,
  /* La proforma se emite CON PRESUPUESTO PREVIO para poder medir después la tasa de comisión de
     la venta que salga de ella. */
  tipoVenta: 'CON PRESUPUESTO PREVIO',
  tipoEntrega: 'SIMULTANEA',
  rentabilidad: prod.rentabilidad,
  descFormaPago,
  tasaCambio,
  lineas,
  actividadesIds: [],
})
chequear(creada.subitemsCreados === lineas.length, 'Proforma creada con sus líneas', `${creada.subitemsCreados}/${lineas.length} · item ${creada.id}`)

const pfItem = await leerItem(creada.id)
if (pfItem) {
  const totalGuardado = num(pfItem, COL.proforma.total)
  paso(`proforma ${pfItem.id} "${pfItem.name}" · TOTAL guardado ${totalGuardado} · estado venta "${txt(pfItem, COL.proforma.estadoVenta)}"`)
  chequear(
    casi(totalGuardado, totalBoard, 1),
    'Proforma · el TOTAL guardado es el de la cascada',
    `${totalGuardado} vs ${totalBoard}`,
  )
  chequear(
    casi(totalGuardado, totalPantalla, 1),
    'Proforma · el TOTAL guardado es el que mostró la pantalla',
    `guardado ${totalGuardado} vs pantalla ${totalPantalla}`,
  )
}

/* =========================================================================================
   M12 · La venta que factura esa proforma: ¿la comisión registrada es la que se mostró?
   ========================================================================================= */
abrirCaso('M12 · 7000 · VENTA PROFORMA sobre una proforma CON PRESUPUESTO PREVIO')

limpiarCachesConsultas()
const proformas = await getProformasCliente(c7000.id)
const pf = proformas.find((p) => p.id === creada.id)
if (!pf) {
  anotar('BUG', 'La proforma recién emitida no aparece entre las vigentes del cliente', creada.id)
} else {
  paso(`proforma ${pf.nro} · ${pf.tipoVenta}/${pf.tipoEntrega} · importe ${pf.importe}`)
  const items: VentaItem[] = pf.productos.map((p, i) => ({
    ...p,
    uid: ventaItemUid(pf.id, i),
    aVender: p.pend,
    desc: p.descuento ?? 0,
  }))

  /* La tasa que MUESTRA el resumen de la venta usa el tipo de venta de la PROFORMA. */
  const tasaMostrada = tasaComision(comisiones, pf.tipoVenta, false)
  /* La que se REGISTRA usa `state.tipoVenta`, que en la VENTA PROFORMA es null → 'DIRECTA'. */
  const tasaRegistrada = tasaComision(comisiones, 'DIRECTA', false)
  paso(`tasa mostrada (proforma ${pf.tipoVenta}): ${tasaMostrada}% · tasa registrada: ${tasaRegistrada}%`)
  chequear(
    tasaMostrada === tasaRegistrada,
    'VENTA PROFORMA · la tasa de comisión mostrada es la que se registra',
    `mostrada ${tasaMostrada}% vs registrada ${tasaRegistrada}% (proforma ${pf.tipoVenta})`,
  )

  const r12 = await correrVenta({
    operacion: 'VENTA PROFORMA',
    cliente: c7000,
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
      { id: 'M-QA-PF', formaPago: 'Efectivo', importe: total, chequeFechaPago: '' },
    ],
    observaciones: 'QA E2E M12',
  })

  await verificarVenta({
    cliente: c7000,
    vendedorId: vendedor.id,
    tipoVenta: pf.tipoVenta,
    tipoEntrega: pf.tipoEntrega,
    tipoCobro: 'Simultaneo',
    r: r12,
    proformaId: pf.id,
  })
  await verificarComision(r12)

  const pfDespues = await leerItem(pf.id)
  if (pfDespues) {
    chequear(
      /usad/i.test(txt(pfDespues, COL.proforma.estadoVenta)),
      'Proforma · queda marcada como Usada tras facturarla',
      txt(pfDespues, COL.proforma.estadoVenta) || 'vacío',
    )
  }
  await esperarEmisionElectronica(r12.comprobantes.map((c) => c.id), { intentos: 6, intervalo: 5000 })
}

const { informe } = await import('./base')
informe()
