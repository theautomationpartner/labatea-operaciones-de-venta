/**
 * QA E2E · Recorridos del vendedor.
 *
 * Cada función replica lo que hace UNA vista al tocar su botón final, en el mismo orden y con las
 * mismas llamadas. Lo único que cambia es que acá los efectos "fire-and-forget" se esperan: sin eso
 * no se puede verificar qué quedó escrito.
 */
import { chequear, esperar, paso } from './base'
import { addDays, aIso } from '@/lib/dates'
import { netoLinea as netoConDesc } from '@/lib/descuentos'
import { round2 } from '@/lib/format'
import { ivaPorDefecto, letraComprobante } from '@/lib/factura'
import { comprobantesDeVenta, precioNetoUnitario, totalesComprobantes } from '@/lib/facturacion'
import { lineasDeVenta } from '@/lib/lineasVenta'
import { clienteLlevaIva } from '@/lib/precios'
import {
  comisionLinea,
  resumenPresupuesto,
  resumenPresupuestoBimoneda,
  tasaComision,
  totalVentaOperacion,
} from '@/lib/selectors'
import {
  balancePagos,
  cobroSimultaneoOperacion,
  datosCobroVenta,
  descuentoDeFormaPago,
  requiereRegistroDeuda,
  resumenCobro,
  type DescuentosPago,
} from '@/lib/cobros'
import {
  actualizarCantVendida,
  asignarDestinatarios,
  asignarDestinatariosFactura,
  asociarActividades,
  crearComisiones,
  crearComprobantes,
  crearConsignacionesCYO,
  crearPresupuesto,
  crearVenta,
  dispararEnvio,
  dispararEnvioFactura,
  emitirPresupuesto,
  esperarPresupuestoPdf,
  getActividadesDePresupuestos,
  getActividadesDeProforma,
  marcarProformaUsada,
  registrarCobro,
  registrarDeudaPosterior,
  registrarFacturacionVtasPend,
  seguirEnvio,
  seguirEnvioFactura,
  vincularVentaAComprobantes,
} from '@/services/monday'
import type {
  Cliente,
  ComisionesVenta,
  ComprobanteEmitido,
  Contacto,
  FacturaItem,
  FormaPagoVenta,
  LineaPresupuesto,
  MedioEnvio,
  MovimientoPago,
  Operacion,
  Producto,
  ResponsableEntrega,
  TipoEntrega,
  TipoVenta,
  Vendedor,
  VentaItem,
} from '@/types'

/** Configuración del sistema que la app lee al arrancar. */
export interface Config {
  diasVigencia: number
  diasVencFactura: number
  descuentosPago: DescuentosPago
  comisiones: ComisionesVenta
  tasaCambio: number | null
}

export const hoy = (): string => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** Una línea del catálogo tal como la deja "Agregar producto". */
export const linea = (producto: Producto, cantidad: number, descuento = 0): LineaPresupuesto => ({
  id: `L-${producto.id}-${Math.random().toString(36).slice(2, 7)}`,
  producto,
  cantidad,
  descuento,
})

/** Convierte a pesos un producto en dólares, como hace `useCotizacionProducto` en la VENTA. */
export const aPesos = (p: Producto, tasa: number): Producto => {
  const usd = p.precioBase ?? p.precio
  const conv = (v: number | undefined) => (v && v > 0 ? round2(v * tasa) : v)
  return {
    ...p,
    precioUsd: p.precio,
    precio: round2(usd * tasa),
    precioSinIva: conv(p.precioSinIva),
    precioCosto: conv(p.precioCosto),
    precioBase: undefined,
    moneda: 'Pesos',
  }
}

/* ===================== PRESUPUESTAR ===================== */

export interface DatosPresupuestoQA {
  cliente: Cliente
  vendedor: Vendedor
  lineas: LineaPresupuesto[]
  config: Config
  actividadesIds?: string[]
  enviar?: { contactos: Contacto[]; medio: MedioEnvio }
  descuentoPagoActivo?: boolean
}

/** Replica `EmisionView.generar()` + el envío de `EnviarDocumento`. */
export async function correrPresupuesto(d: DatosPresupuestoQA) {
  const fechaEmision = hoy()
  const vencimiento = addDays(fechaEmision, d.config.diasVigencia)
  const resumen = resumenPresupuesto(d.lineas, false)
  const bimoneda = resumenPresupuestoBimoneda(d.lineas, d.config.tasaCambio ?? 0)

  paso(`PRESUPUESTO · ${d.lineas.length} productos · neto ${round2(resumen.neto)}`)
  const creado = await crearPresupuesto({
    cliente: d.cliente,
    vendedor: d.vendedor,
    lineas: d.lineas,
    fechaEmision,
    fechaVencimiento: vencimiento,
    diasVigencia: d.config.diasVigencia,
    rentabilidad: resumen.rentabilidad,
    moneda: 'Pesos',
    totalPesos: bimoneda.ars.neto,
    totalUsd: bimoneda.usd.neto,
    descuentoPagoAplicado: d.descuentoPagoActivo ?? false,
    actividadesIds: d.actividadesIds ?? [],
  })
  chequear(
    creado.subitemsCreados === d.lineas.length,
    'Presupuesto: entraron todos los productos',
    `${creado.subitemsCreados}/${d.lineas.length} · item ${creado.id}`,
  )
  await emitirPresupuesto(creado.id)
  paso('estado PDF -> "Emitir" (dispara Make.com)')
  const pdf = await esperarPresupuestoPdf(creado.id, { intentos: 40, intervalo: 3000 })
  chequear(Boolean(pdf), 'Make generó el PDF del presupuesto', pdf ? pdf.nombre : 'no llegó en 120 s')

  let estadoEnvio = ''
  if (d.enviar && d.enviar.contactos.length > 0) {
    await asignarDestinatarios(
      creado.id,
      d.enviar.contactos.map((c) => c.itemId ?? '').filter(Boolean),
      d.enviar.medio,
    )
    await dispararEnvio(creado.id)
    paso(`envío por ${d.enviar.medio} -> seguimiento`)
    estadoEnvio = await seguirEnvio(creado.id, (e) => paso(`  estado envío: ${e}`), {
      intentos: 30,
      intervalo: 3000,
    })
  }
  return { presupuestoId: creado.id, pdf, estadoEnvio, resumen, fechaEmision, vencimiento }
}

/* ===================== VENTA / VENTA PROFORMA ===================== */

export interface DatosVentaQA {
  operacion: Operacion
  cliente: Cliente
  vendedor: Vendedor
  config: Config
  tipoVenta: TipoVenta | null
  tipoEntrega: TipoEntrega | null
  formaPago: FormaPagoVenta | null
  lineas?: LineaPresupuesto[]
  ventaItems?: VentaItem[]
  facturaItems?: FacturaItem[]
  movimientos?: MovimientoPago[]
  /** Movimientos que dependen del total: el vendedor los carga viendo la métrica "TOTAL VENTA". */
  movimientosPorTotal?: (total: number) => MovimientoPago[]
  actividadesIds?: string[]
  proformaId?: string | null
  proformaImporte?: number | null
  proformaTipoVenta?: TipoVenta | null
  proformaTipoEntrega?: TipoEntrega | null
  entregaVenta?: { responsable?: ResponsableEntrega; rutaId?: string; rutaConfirmada?: boolean }
  observaciones?: string
  enviarFactura?: { contactos: Contacto[]; medio: MedioEnvio }
}

export interface ResultadoVenta {
  ventaId: string
  comprobantes: ComprobanteEmitido[]
  totalVenta: number
  totalFacturado: number
  descFormaPago: number
  comisionEsperada: number
  tasaComisionUsada: number
  deudaId: string | null
  reciboId: string | null
  productos: ReturnType<typeof lineasDeVenta>
  fechaEmision: string
  vencimiento: string
  estadoEnvioFactura: string
  actividadesIds: string[]
}

/** Replica `FacturaView.emitir()` + `finalizar()` + `dispararEfectosSecundarios()`. */
export async function correrVenta(d: DatosVentaQA): Promise<ResultadoVenta> {
  const fechaEmision = hoy()
  const productos = lineasDeVenta({
    operacion: d.operacion,
    tipoVenta: d.tipoVenta,
    tipoEntrega: d.tipoEntrega,
    lineas: d.lineas ?? [],
    ventaItems: d.ventaItems ?? [],
    facturaItems: d.facturaItems ?? [],
  })
  const descFormaPago = descuentoDeFormaPago(d.formaPago, d.config.descuentosPago)
  const comprobantes = comprobantesDeVenta(productos, descFormaPago)
  const totalFacturado = totalesComprobantes(comprobantes).total
  const totalVenta = totalVentaOperacion({
    cliente: d.cliente,
    operacion: d.operacion,
    tipoVenta: d.tipoVenta,
    tipoEntrega: d.tipoEntrega,
    lineas: d.lineas ?? [],
    ventaItems: d.ventaItems ?? [],
    facturaItems: d.facturaItems ?? [],
    proformaImporte: d.proformaImporte ?? null,
    descFormaPago,
  }).total

  const venceAPlazo = d.formaPago === 'CUENTA CORRIENTE'
  const vencimiento = venceAPlazo ? addDays(fechaEmision, d.config.diasVencFactura) : fechaEmision
  const ivaReceptor = ivaPorDefecto(d.cliente)
  const letra = letraComprobante(d.cliente.status)
  const tipoEntregaEfectivo = d.tipoEntrega ?? d.proformaTipoEntrega ?? null

  paso(
    `VENTA · ${comprobantes.length} comprobante(s) [${comprobantes.map((c) => c.titulo).join(' | ')}] · ` +
      `facturado ${round2(totalFacturado)} · total venta ${round2(totalVenta)} · descFP ${descFormaPago}%`,
  )

  /* --- Botón "Emitir comprobantes" --- */
  const creados = await crearComprobantes(
    comprobantes.map((c) => ({ ...c, vencimiento })),
    {
      cliente: d.cliente,
      moneda: 'Pesos (ARS)',
      tipoCambio: 0,
      letra,
      ivaReceptor,
      fechaEmision,
      diasVencimiento: d.config.diasVencFactura,
      observaciones: d.observaciones ?? '',
      tipoEntrega: tipoEntregaEfectivo,
      ventaId: null,
      formaPago: d.formaPago,
      operacion: d.operacion,
      descFormaPago,
    },
  )
  const incompletos = creados.filter((c) => !c.id || c.lineasCreadas < c.lineasEsperadas)
  chequear(
    incompletos.length === 0,
    'Comprobantes emitidos completos',
    creados.map((c) => `${c.titulo}=${c.id} ${c.lineasCreadas}/${c.lineasEsperadas}`).join(' · '),
  )

  /* --- Botón "Finalizar": creación de la venta --- */
  const actividadesIds =
    d.operacion === 'VENTA PROFORMA'
      ? d.proformaTipoVenta === 'CON PRESUPUESTO PREVIO'
        ? d.proformaId
          ? await getActividadesDeProforma(d.proformaId)
          : []
        : d.actividadesIds ?? []
      : d.tipoVenta === 'CON PRESUPUESTO PREVIO'
        ? await getActividadesDePresupuestos([
            ...new Set(
              (d.ventaItems ?? []).map((it) => it.presupuestoId).filter(Boolean) as string[],
            ),
          ])
        : d.actividadesIds ?? []

  const base = productos.reduce(
    (acc, p) => acc + p.precioUnitario * p.cantidad * (1 - p.descuento / 100),
    0,
  )
  const rentabilidadVenta =
    base <= 0
      ? 0
      : round2(
          productos.reduce(
            (acc, p) =>
              acc +
              p.rentabilidad * ((p.precioUnitario * p.cantidad * (1 - p.descuento / 100)) / base),
            0,
          ),
        )

  const esEntregaPosterior = d.tipoEntrega === 'POSTERIOR'
  const creada = await crearVenta({
    clienteId: d.cliente.id,
    vendedorId: d.vendedor.id,
    nombre: d.cliente.name,
    tipoVenta: d.tipoVenta ?? d.proformaTipoVenta ?? 'DIRECTA',
    tipoEntrega: d.tipoEntrega ?? d.proformaTipoEntrega ?? 'SIMULTANEA',
    ...datosCobroVenta(d.formaPago, d.operacion),
    rentabilidad: rentabilidadVenta,
    descFormaPago,
    tasaCambio: d.config.tasaCambio,
    importeTotalPesos: totalVenta,
    responsableEntrega: esEntregaPosterior ? d.entregaVenta?.responsable : undefined,
    rutaId:
      esEntregaPosterior && d.entregaVenta?.rutaConfirmada ? d.entregaVenta?.rutaId : undefined,
    lineas: productos,
    facturaIds: creados.map((c) => c.id).filter(Boolean),
    proformaId: d.proformaId ?? null,
    actividadesIds,
  })
  chequear(
    creada.subitemsCreados === productos.length,
    'Venta creada con todos sus productos',
    `${creada.subitemsCreados}/${productos.length} · item ${creada.id}`,
  )
  const ventaId = creada.id

  if ((d.actividadesIds ?? []).length > 0) {
    const sinAsociar = await asociarActividades(d.actividadesIds ?? [], { ventaId })
    chequear(
      sinAsociar.length === 0,
      'Actividades asociadas a la venta',
      sinAsociar.join(', ') || 'todas',
    )
  }

  /* --- Efectos secundarios (acá SÍ se esperan, para poder verificarlos) --- */
  if (creados.length > 0) {
    await vincularVentaAComprobantes(
      ventaId,
      creados.map((c) => c.id).filter(Boolean),
    )
  }

  const movimientos = d.movimientos ?? d.movimientosPorTotal?.(totalVenta) ?? []
  const balances = balancePagos(movimientos)
  let reciboId: string | null = null
  let deudaId: string | null = null

  if (cobroSimultaneoOperacion(d.formaPago, d.operacion)) {
    const resumen = resumenCobro(balances, totalVenta)
    chequear(
      round2(resumen.cancelado) === round2(resumen.totalACobrar),
      'Cobro simultáneo cubre el 100% de la venta',
      `cancelado ${round2(resumen.cancelado)} vs total ${round2(resumen.totalACobrar)}`,
    )
    const facturasCanceladas = comprobantes.flatMap((c, i) => {
      const e = creados[i]
      return e?.id ? [{ facturaId: e.id, importe: c.total }] : []
    })
    const recibo = await registrarCobro({
      clienteId: d.cliente.id,
      nombreCliente: d.cliente.name,
      vendedorId: d.vendedor.id,
      totalVenta,
      facturas: facturasCanceladas,
      balances,
    })
    reciboId = recibo.id
    paso(`recibo ${reciboId}`)
  } else if (requiereRegistroDeuda(d.formaPago, d.operacion)) {
    const deuda = await registrarDeudaPosterior({
      ventaId,
      clienteId: d.cliente.id,
      nombreCliente: d.cliente.name,
      total: totalVenta,
      fechaEmision,
      vencimiento,
    })
    deudaId = deuda.deudaId
    paso(`deuda ${deudaId}`)
  }

  const conActividades = actividadesIds.length > 0
  /* MISMA constante que `FacturaView.tipoVentaComision`: de ella salen la tasa que se le muestra al
     vendedor y la que se registra, y por eso viaja tal cual a `crearComisiones`. */
  const tipoVentaComision = d.proformaTipoVenta ?? d.tipoVenta ?? 'DIRECTA'
  const tasa = tasaComision(d.config.comisiones, tipoVentaComision, conActividades)
  const lineasComision = productos.map((p) => ({
    ...p,
    neto: netoConDesc(p.precioUnitario, p.cantidad, p.descuento ?? 0, p.descFormaPago ?? descFormaPago),
  }))
  const comisionEsperada = round2(
    lineasComision.reduce((acc, l) => acc + comisionLinea(l.neto, l.comisionable === true, tasa), 0),
  )
  await crearComisiones({
    ventaId,
    clienteId: d.cliente.id,
    vendedorId: d.vendedor.id,
    tipoVenta: tipoVentaComision,
    tipoPago: datosCobroVenta(d.formaPago, d.operacion).tipoPago,
    importeTotalVenta: totalVenta,
    fecha: aIso(fechaEmision),
    pendienteCobroId: deudaId ?? undefined,
    comisiones: d.config.comisiones,
    conActividades,
    lineas: lineasComision.map((l) => ({
      productoId: l.productoId,
      nombre: l.nombre,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      neto: l.neto,
      comisionable: l.comisionable === true,
    })),
  })

  if (d.tipoVenta === 'CON PRESUPUESTO PREVIO') {
    await actualizarCantVendida(
      (d.ventaItems ?? [])
        .filter((it) => it.subitemId)
        .map((it) => ({
          subitemId: it.subitemId as string,
          cantVendida: (it.vend ?? 0) + it.aVender,
        })),
    )
  }
  if ((d.facturaItems ?? []).length > 0) {
    await registrarFacturacionVtasPend(
      (d.facturaItems ?? []).map((it) => ({
        subitemId: it.subitemId,
        ventaPendId: it.ventaPendId,
        aFacturar: it.aFacturar,
        precio: it.precio,
      })),
      ventaId,
    )
  }

  const lineasCYO = comprobantes.flatMap((c, i) => {
    const emitido = creados[i]
    if (c.tipo !== 'CONSIGNADA') return []
    if (!emitido?.id || emitido.lineasCreadas < emitido.lineasEsperadas) return []
    return c.lineas
      .filter((l) => l.productoId)
      .map((l) => ({
        productoId: l.productoId,
        nombre: l.nombre,
        proveedorNombre: c.proveedorNombre ?? undefined,
        cantidad: l.cantidad,
        precioUnitario: precioNetoUnitario(l, descFormaPago),
        comprobanteId: emitido.id,
      }))
  })
  if (lineasCYO.length > 0) {
    await crearConsignacionesCYO(lineasCYO, aIso(fechaEmision))
    paso(`CYO: ${lineasCYO.length} línea(s) consignada(s)`)
  }

  if (d.operacion === 'VENTA PROFORMA' && d.proformaId) await marcarProformaUsada(d.proformaId)

  let estadoEnvioFactura = ''
  if (d.enviarFactura && d.enviarFactura.contactos.length > 0) {
    await esperar(5000)
    await asignarDestinatariosFactura(
      ventaId,
      d.enviarFactura.contactos.map((c) => c.itemId ?? '').filter(Boolean),
      d.enviarFactura.medio,
    )
    await dispararEnvioFactura(ventaId)
    estadoEnvioFactura = await seguirEnvioFactura(
      ventaId,
      (e) => paso(`  estado envío factura: ${e}`),
      { intentos: 30, intervalo: 3000 },
    )
  }

  return {
    ventaId,
    comprobantes: creados,
    totalVenta,
    totalFacturado,
    descFormaPago,
    comisionEsperada,
    tasaComisionUsada: tasa,
    deudaId,
    reciboId,
    productos,
    fechaEmision,
    vencimiento,
    estadoEnvioFactura,
    actividadesIds,
  }
}

/** Movimiento de cobro en efectivo, tal como lo deja el formulario. */
export const movEfectivo = (importe: number): MovimientoPago => ({
  id: `M-${Math.random().toString(36).slice(2, 8)}`,
  formaPago: 'Efectivo',
  importe,
  chequeFechaPago: '',
})

export { clienteLlevaIva }
