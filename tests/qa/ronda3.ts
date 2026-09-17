/**
 * QA E2E · Ronda 3.
 *
 *   M7 · 7001: operación REMITO con emisión POSTERIOR → deja mercadería pendiente de facturar.
 *   M8 · 7001: VENTA con entrega ANTERIOR sobre ese pendiente, cobrada a CUENTA CORRIENTE.
 *   M9 · 7000: intento de ENVIAR LA FACTURA de la venta de la ronda 1 (¿hay documento?).
 *   M10 ·      Validaciones de negocio, sin escribir nada (las que frenan al vendedor).
 */
import { abrirCaso, anotar, chequear, paso } from './base'
import { correrVenta, type Config } from './flujos'
import { casi, esperarEmisionElectronica, leerItem, links, num, txt, verificarComision, verificarComprobantes, verificarDeuda, verificarVenta } from './verificar'
import { round2 } from '@/lib/format'
import { facturaItemUid } from '@/lib/selectors'
import { COL } from '@/services/monday/columns'
import { clienteLlevaIva } from '@/lib/precios'
import {
  chequeDelClienteVedado,
  cobroCompleto,
  descuentoDeFormaPago,
  formasPagoDeCliente,
  resumenCobro,
  balancePagos,
  tipoPagoOperacion,
} from '@/lib/cobros'
import { clienteBloqueado, excedeCredito, frenaPorCredito, creditoResultante } from '@/lib/credito'
import { excedeMaximo, faltantesCliente } from '@/lib/validaciones'
import { puedeSuperarTopeDescuento, topesDescuentoDe, rolUsuario } from '@/lib/permisos'
import {
  afectarEntregaAnterior,
  buscarClientes,
  buscarProductos,
  crearRemito,
  crearVtaPendienteFacturar,
  emitirRemito,
  esperarRemitoPdf,
  getComisionesVenta,
  getContactosCliente,
  getDescuentosPago,
  getDestinosCliente,
  getDiasVencimientoFactura,
  getDiasVigencia,
  getHojaTalonario,
  getTasaCambioHoy,
  getTopesDescuento,
  getUsuarioActual,
  getVendedores,
  getVentasPendientesFacturar,
  leerNroRemito,
  marcarHojaUsada,
} from '@/services/monday'
import { comprobanteFacturaGenerado } from '@/services/monday/facturacion'
import type { Cliente, FacturaItem, Producto } from '@/types'

const [diasVigencia, diasVencFactura, descuentosPago, comisiones, tasaCambio, vendedores, topes, usuario] =
  await Promise.all([
    getDiasVigencia(),
    getDiasVencimientoFactura(),
    getDescuentosPago(),
    getComisionesVenta(),
    getTasaCambioHoy(),
    getVendedores(),
    getTopesDescuento(),
    getUsuarioActual(),
  ])
const config: Config = { diasVigencia, diasVencFactura, descuentosPago, comisiones, tasaCambio }
const vendedor = vendedores.find((v) => v.id === '107870718') ?? vendedores[0]

const cliente = async (cod: string): Promise<Cliente> => (await buscarClientes(cod)).personas[0]
const c7001 = await cliente('7001')
const c7000 = await cliente('7000')

const productoVenta = async (codigo: string, c: Cliente): Promise<Producto> => {
  const pag = await buscarProductos(codigo, c.list ?? 'L1', clienteLlevaIva(c.status), [])
  const p = pag.productos.find((x) => x.codigo === codigo)
  if (!p) throw new Error(`no se encontró el producto ${codigo}`)
  return p
}

/* =========================================================================================
   M7 · 7001 · REMITO con emisión POSTERIOR
   ========================================================================================= */
abrirCaso('M7 · 7001 · REMITO · emisión POSTERIOR (deja mercadería pendiente de facturar)')

const talonario = await getHojaTalonario()
paso(`talonario: ${talonario.estado}${talonario.estado === 'ok' ? ` · ${talonario.hoja.talonarioNombre} / ${talonario.hoja.hojaNombre}` : ''}`)

if (talonario.estado !== 'ok') {
  anotar('BUG', 'No hay talonario/hoja disponible: el REMITO no se puede emitir', talonario.estado)
} else {
  const destinos = await getDestinosCliente(c7001.id)
  paso(`destinos del cliente: ${destinos.map((d) => d.nombre).join(', ') || 'ninguno'}`)

  const pRem = await productoVenta('2294', c7001) // AGUA OXIGENADA · COM · 21%
  const items = [
    {
      productoId: pRem.id,
      nombre: pRem.nombre,
      cantidad: 2,
      pesoUnitario: pRem.peso ?? 0,
      um: pRem.um,
      precioUnitario: pRem.precio,
    },
  ]
  const importePend = round2(items.reduce((a, i) => a + round2(i.cantidad * (i.precioUnitario ?? 0)), 0))
  paso(`remito de ${items[0].cantidad} x "${pRem.nombre}" a $${pRem.precio} → pendiente de facturar ${importePend}`)

  const remito = await crearRemito({
    clienteId: c7001.id,
    vendedorId: vendedor.id,
    nombre: c7001.name,
    tipoEmision: 'POSTERIOR',
    responsable: 'CLIENTE',
    clienteResponsable: 'QA E2E retira',
    ventaIds: [],
    lineas: items,
  })
  chequear(remito.subitemsCreados === items.length, 'Remito creado con todas sus líneas', `${remito.subitemsCreados}/${items.length} · item ${remito.id}`)

  const pend = await crearVtaPendienteFacturar({
    nombre: c7001.name,
    clienteId: c7001.id,
    remitoId: remito.id,
    importeTotal: importePend,
    lineas: items.map((i) => ({
      productoId: i.productoId,
      precioUnitario: i.precioUnitario ?? 0,
      cantidad: i.cantidad,
      tipoMercaderia: pRem.tipo,
      rentabilidad: pRem.rentabilidad,
      um: i.um,
    })),
  })
  chequear(Boolean(pend.id), 'Vta Pendiente de Facturar creada', `item ${pend.id} · ${pend.subitemsCreados} línea(s)`)

  await emitirRemito(remito.id, 'QA E2E M7', talonario.hoja.hojaId)
  await marcarHojaUsada(talonario.hoja.hojaId).catch(() => undefined)
  paso('remito en "Emitir" (dispara Make.com para el PDF)')
  const pdfRem = await esperarRemitoPdf(remito.id, { intentos: 30, intervalo: 3000 })
  chequear(Boolean(pdfRem), 'Make generó el PDF del remito', pdfRem ? pdfRem.nombre : 'no llegó en 90 s', 'WARN')
  const nroRemito = pdfRem ? await leerNroRemito(remito.id).catch(() => '') : ''
  chequear(Boolean(nroRemito), 'Remito · "Nro Remito" asignado por el tablero', nroRemito || 'vacío', 'WARN')

  const remItem = await leerItem(remito.id)
  if (remItem) paso(`remito ${remItem.id} "${remItem.name}" · nro "${txt(remItem, COL.remito.nroRemito)}"`)

  /* ===== M8 · la venta que factura ese remito ===== */
  abrirCaso('M8 · 7001 · VENTA · entrega ANTERIOR (factura el remito de M7) · CUENTA CORRIENTE')

  const pendientes = await getVentasPendientesFacturar(c7001)
  paso(`pendientes de facturar del cliente: ${pendientes.length}`)
  const mio = pendientes.find((p) => p.productos.length > 0)
  if (!mio) {
    anotar('BUG', 'El remito POSTERIOR no aparece en "Vtas Pends de Facturar"', `remito ${remito.id}, pendiente ${pend.id}`)
  } else {
    paso(`pendiente elegido: ${mio.nro ?? mio.id} · ${mio.productos.length} producto(s)`)
    const facturaItems: FacturaItem[] = mio.productos
      .filter((p) => p.pendiente > 0 && p.seleccionable !== false)
      .map((p, i) => ({ ...p, uid: facturaItemUid(mio.id, i), aFacturar: p.pendiente }))
    paso(`a facturar: ${facturaItems.map((f) => `${f.nombre.slice(0, 26)} x${f.aFacturar} @${f.precio}`).join(' | ')}`)

    const r8 = await correrVenta({
      operacion: 'VENTA',
      cliente: c7001,
      vendedor,
      config,
      tipoVenta: 'DIRECTA',
      tipoEntrega: 'ANTERIOR',
      formaPago: 'CUENTA CORRIENTE',
      facturaItems,
      observaciones: 'QA E2E M8',
    })
    await verificarVenta({
      cliente: c7001,
      vendedorId: vendedor.id,
      tipoVenta: 'DIRECTA',
      tipoEntrega: 'ANTERIOR',
      tipoCobro: 'Posterior',
      r: r8,
    })
    await verificarComprobantes({
      cliente: c7001,
      r: r8,
      letra: 'A',
      sitIva: 'Responsable Inscripto',
      condicionVenta: 'Cuenta Corriente',
    })
    await verificarDeuda(r8, c7001)
    await verificarComision(r8)
    chequear(
      casi(r8.totalVenta, r8.totalFacturado, 1),
      'Entrega ANTERIOR · total de la venta = total facturado',
      `venta ${r8.totalVenta} vs facturas ${r8.totalFacturado}`,
    )
    /* La entrega ANTERIOR no crea pendientes de entrega ni mueve stock: la mercadería ya salió. */
    const v8 = await leerItem(r8.ventaId)
    if (v8) {
      const pendIds = v8.subitems.flatMap((s) => links(s, COL.ventaSub.pendienteEntrega))
      chequear(pendIds.length === 0, 'Entrega ANTERIOR · no deja pendientes de entrega', `${pendIds.length}`)
      paso(`estado de entrega de la venta: "${txt(v8, COL.venta.estadoEntrega)}"`)
      chequear(
        /100/.test(txt(v8, COL.venta.estadoEntrega)),
        'Entrega ANTERIOR · la venta nace 100% entregada',
        txt(v8, COL.venta.estadoEntrega) || 'vacío',
      )
    }
    /* El pendiente de facturar tiene que quedar conciliado. */
    const pendItem = await leerItem(mio.id)
    if (pendItem) {
      paso(
        `pendiente tras facturar: "${pendItem.name}" · estado "${txt(pendItem, COL.vtaPendFacturar.estadoFacturacion)}" · ` +
          `a facturar ${num(pendItem, COL.vtaPendFacturar.importeAFacturar)} · facturado ${num(pendItem, COL.vtaPendFacturar.importeFacturado)}`,
      )
    }
    await esperarEmisionElectronica(r8.comprobantes.map((c) => c.id))
  }
}

/* =========================================================================================
   M9 · ¿se puede enviar la factura al cliente?
   ========================================================================================= */
abrirCaso('M9 · Envío de la FACTURA al cliente (requiere el PDF de la emisión electrónica)')

const ventaM3 = '13068344889' // VTA-128, la VENTA PROFORMA de la ronda 1
const hayDocumento = await comprobanteFacturaGenerado(ventaM3)
chequear(
  hayDocumento,
  'La venta tiene el PDF de su factura y se puede enviar al cliente',
  hayDocumento ? 'hay documento' : `la venta ${ventaM3} no tiene PDF en sus comprobantes: "Enviar factura" devuelve "sin-documento"`,
)
const contactos7000 = await getContactosCliente(c7000.id)
paso(`contactos habilitados de 7000: ${contactos7000.filter((c) => c.ok).map((c) => c.name).join(', ')}`)

/* =========================================================================================
   M10 · Validaciones de negocio (sin escribir en Monday)
   ========================================================================================= */
abrirCaso('M10 · Validaciones que frenan al vendedor')

paso(`7001: ${c7001.status} · ${c7001.condicionPago} · cheques ${c7001.aceptaCheques} · límite ${c7001.limit} · disponible ${c7001.disponible} · ${c7001.situation}`)
paso(`7000: ${c7000.status} · ${c7000.condicionPago} · cheques ${c7000.aceptaCheques} · límite ${c7000.limit} · disponible ${c7000.disponible} · agente ret. ${c7000.agenteRetencion}`)

chequear(
  faltantesCliente(c7001).length === 0,
  'Ficha de 7001 completa para operar',
  faltantesCliente(c7001).join(', ') || 'sin faltantes',
)
chequear(
  faltantesCliente(c7000).length === 0,
  'Ficha de 7000 completa para operar',
  faltantesCliente(c7000).join(', ') || 'sin faltantes',
)

/* Formas de pago ofrecidas según la condición pactada. */
for (const c of [c7001, c7000]) {
  const formas = formasPagoDeCliente(c.condicionPago)
  paso(`${c.codigo} → formas de pago ofrecidas: ${formas.join(', ')}`)
}

/* El cliente que NO recibe cheques: el medio tiene que quedar vedado. */
chequear(
  chequeDelClienteVedado(c7000, c7000.cuit) === true,
  '7000 no acepta cheques propios: el medio queda vedado',
  `aceptaCheques=${c7000.aceptaCheques} · vedado=${chequeDelClienteVedado(c7000, c7000.cuit)}`,
)
chequear(
  chequeDelClienteVedado(c7001, c7001.cuit) === false,
  '7001 sí acepta cheques propios',
  `vedado=${chequeDelClienteVedado(c7001, c7001.cuit)}`,
)

/* Topes de descuento: el vendedor común no puede pasarse; el administrador sí. */
paso(`topes del tablero: min ${topes.min}% · max ${topes.max}%`)
paso(`usuario de la sesión: ${usuario?.name} · rol ${rolUsuario(usuario)} · admin ${usuario?.isAdmin}`)
chequear(
  excedeMaximo(String(topes.max + 1), topes),
  `Un descuento de ${topes.max + 1}% excede el tope`,
  `max ${topes.max}%`,
)
chequear(
  !excedeMaximo(String(topes.max), topes),
  `Un descuento de exactamente ${topes.max}% NO excede el tope`,
  '',
)
/* El permiso es del USUARIO logueado y sólo rige en la etapa de productos. */
paso(
  `puede superar el tope en "productos": ${puedeSuperarTopeDescuento(usuario, 'productos', 'VENTA')} · ` +
    `en "cobro": ${puedeSuperarTopeDescuento(usuario, 'cobro', 'VENTA')}`,
)
paso(`topes efectivos en productos: ${JSON.stringify(topesDescuentoDe(topes, usuario, 'productos', 'VENTA'))}`)
chequear(
  puedeSuperarTopeDescuento(null, 'productos', 'VENTA') === false,
  'Sin usuario identificado no se puede superar el tope de descuento',
  '',
)

/* Crédito: una venta por encima del disponible tiene que frenar. */
const excede = round2(c7000.disponible + 1000)
/* El crédito sólo rige cuando la operación usa la cuenta corriente. */
const opCtaCte = { operacion: 'VENTA', formaPago: 'CUENTA CORRIENTE', tipoEntrega: 'SIMULTANEA' } as const
const opContado = { operacion: 'VENTA', formaPago: 'CONTADO', tipoEntrega: 'SIMULTANEA' } as const
chequear(
  excedeCredito(c7000, excede, opCtaCte) === true,
  'A CUENTA CORRIENTE, una venta mayor al disponible excede el límite',
  `importe ${excede} · disponible ${c7000.disponible} · resultante ${creditoResultante(c7000, excede)}`,
)
chequear(
  excedeCredito(c7000, excede, opContado) === false,
  'Al CONTADO, el mismo importe NO frena por crédito',
  `importe ${excede}`,
)
chequear(
  frenaPorCredito(c7000, excede, opCtaCte, true) === true,
  'La VENTA a cuenta corriente con el crédito excedido FRENA',
  '',
)
chequear(
  clienteBloqueado(c7000) === false && clienteBloqueado(c7001) === false,
  'Ninguno de los dos clientes está bloqueado',
  `${c7000.situation} · ${c7001.situation}`,
)

/* El tipo de cobro sale SÓLO de la forma de pago, no de la condición del cliente. */
for (const forma of ['CONTADO', 'CUENTA CORRIENTE', 'TARJETA DE DEBITO', 'TARJETA DE CREDITO'] as const) {
  paso(`forma de pago ${forma} → tipo de cobro ${tipoPagoOperacion(forma, 'VENTA')} · descuento ${descuentoDeFormaPago(forma, descuentosPago)}%`)
}
paso(`VENTA PROFORMA (sin forma de pago) → tipo de cobro ${tipoPagoOperacion(null, 'VENTA PROFORMA')}`)

/* El cobro exige el 100%: ni de menos ni de más. */
const resumenExacto = resumenCobro(balancePagos([{ id: 'x', formaPago: 'Efectivo', importe: 1000, chequeFechaPago: '' }]), 1000)
chequear(cobroCompleto(resumenExacto), 'Cobro exacto: el 100% queda cubierto', `cancelado ${resumenExacto.cancelado} vs ${resumenExacto.totalACobrar}`)
const resumenCorto = resumenCobro(balancePagos([{ id: 'x', formaPago: 'Efectivo', importe: 900, chequeFechaPago: '' }]), 1000)
chequear(!cobroCompleto(resumenCorto), 'Cobro incompleto: no deja avanzar', `cancelado ${resumenCorto.cancelado} vs ${resumenCorto.totalACobrar}`)
paso(
  `El movimiento entra tal como se carga: recibido=${resumenExacto.recibido}, cancelado=${resumenExacto.cancelado} ` +
    `(el ${descuentosPago.Efectivo}% del pronto pago ya bajó el precio de la venta, no el movimiento)`,
)

const { informe } = await import('./base')
informe()
