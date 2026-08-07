import { useMemo, useState } from 'react'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { TotalesDoc } from '@/features/shared/TotalesDoc'
import { descuentoDeFormaPago } from '@/lib/cobros'
import { money, round2 } from '@/lib/format'
import { lineasDeVenta } from '@/lib/lineasVenta'
import { IVA_RATE } from '@/lib/selectors'
import { crearProforma } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'

/** Muestra el valor, o «Sin especificar» si viene vacío. */
const oSinEsp = (v: string | null | undefined) => (v && v.trim() ? v : 'Sin especificar')

/** Domicilio hasta la ciudad: calle + ciudad (los dos primeros tramos separados por coma). */
const direccionHastaCiudad = (addr: string | null | undefined): string => {
  const partes = (addr ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  return partes.length === 0 ? 'Sin especificar' : partes.slice(0, 2).join(', ')
}

/**
 * Bloque "Emitir Proforma" de la etapa de Cobro (forma de pago CONTADO). Trae lo que antes vivía en
 * la etapa "Proforma y Retenciones": a la izquierda los datos de la proforma + el botón de emisión;
 * a la derecha la card de la factura proforma y el despacho a contactos.
 */
export function CobroProforma() {
  const state = useApp()
  const dispatch = useDispatch()
  const { cliente, operacion, tipoVenta, tipoEntrega, entregaVenta, formaPago, descuentosPago, proformaId } =
    state

  /* La proforma ya está emitida si hay un id de proforma en el estado GLOBAL (lo setea la emisión).
     Se deriva de ahí —no de un estado local— para no perder el estado al volver a un paso anterior
     y volver: el componente se desmonta, pero el `proformaId` global sobrevive. */
  const emitida = Boolean(proformaId)

  const productos = useMemo(
    () =>
      lineasDeVenta({
        operacion,
        tipoVenta,
        tipoEntrega,
        lineas: state.lineas,
        ventaItems: state.ventaItems,
        facturaItems: state.facturaItems,
      }),
    [operacion, tipoVenta, tipoEntrega, state.lineas, state.ventaItems, state.facturaItems],
  )

  /* Descuento por forma de pago (pronto pago): se compone con el descuento manual de cada línea,
     igual que en la tabla de "Seleccionar productos" del paso anterior. */
  const descFormaPago = descuentoDeFormaPago(formaPago, descuentosPago)

  /* Filas de la factura proforma con los mismos valores que la tabla de productos seleccionados:
     Importe Bonif. por unidad = precio × (%desc manual + %desc forma de pago); Total de la línea =
     (precio − Importe Bonif.) × cantidad. */
  const filas = useMemo(
    () =>
      productos.map((l) => {
        const descTotal = Math.min(l.descuento + descFormaPago, 100)
        const bonifUnit = round2((l.precioUnitario * descTotal) / 100)
        const totalLinea = round2((l.precioUnitario - bonifUnit) * l.cantidad)
        return { ...l, bonifUnit, totalLinea }
      }),
    [productos, descFormaPago],
  )

  /* Totales de la factura, tomados del mismo cálculo del paso de selección: el bruto es Σ (precio ×
     cantidad); el neto (gravado), la suma de los "Total" de cada línea; el descuento, su diferencia;
     y el IVA en $ se liquida sobre el neto (21%). */
  const { bruto, neto, descuento, iva, total } = useMemo(() => {
    const n = round2(filas.reduce((acc, f) => acc + f.totalLinea, 0))
    const b = round2(filas.reduce((acc, f) => acc + f.precioUnitario * f.cantidad, 0))
    const impuesto = round2(n * IVA_RATE)
    return { bruto: b, neto: n, descuento: round2(b - n), iva: impuesto, total: round2(n + impuesto) }
  }, [filas])

  // Rentabilidad general: promedio ponderado por el total de cada línea (ya bonificado).
  const rentabilidadGeneral = useMemo(() => {
    if (neto <= 0) return 0
    // Con decimales: redondear a entero asignaba una rentabilidad general incorrecta en la proforma.
    return round2(filas.reduce((acc, f) => acc + f.rentabilidad * f.totalLinea, 0) / neto)
  }, [filas, neto])

  const [emitiendo, setEmitiendo] = useState(false)
  const [abierta, setAbierta] = useState(true)

  /**
   * Emite la proforma: crea el ítem cabecera en el board de Proformas, un subelemento por producto
   * y dispara la generación del PDF. Al terminar bien, guarda el id de la proforma (para el envío)
   * y deja la operación lista para finalizarse.
   */
  const emitir = async () => {
    if (emitiendo || emitida || productos.length === 0) return
    setEmitiendo(true)
    try {
      const creada = await crearProforma({
        clienteId: cliente!.id,
        vendedorId: state.vendedor?.id ?? null,
        nombre: cliente!.name,
        tipoVenta: tipoVenta ?? 'DIRECTA',
        tipoEntrega: tipoEntrega ?? 'SIMULTANEA',
        rentabilidad: rentabilidadGeneral,
        descFormaPago,
        tasaCambio: state.tasaCambio,
        lineas: productos,
      })
      // El estado de "emitida" se deriva de este id global: sobrevive a la navegación entre pasos.
      dispatch({ type: 'setProformaId', value: creada.id })
    } catch {
      /* Si falla, el botón vuelve a habilitarse para reintentar; el porqué lo explica la ventana
         global de error de Monday, no un texto suelto debajo del botón. */
      dispatch({ type: 'errorMonday', accion: 'emitir la factura proforma' })
    } finally {
      setEmitiendo(false)
    }
  }

  if (!cliente) return null

  const entregaTexto = () => {
    const t =
      tipoEntrega === 'POSTERIOR'
        ? 'Posterior'
        : tipoEntrega === 'ANTERIOR'
          ? 'Anterior'
          : 'Simultánea'
    if (entregaVenta.responsable === 'LA_BATEA' && entregaVenta.rutaNombre)
      return `${t} · La Batea (${entregaVenta.rutaNombre})`
    if (entregaVenta.responsable === 'COMISIONISTA' && entregaVenta.comisionistaNombre)
      return `${t} · Comisionista ${entregaVenta.comisionistaNombre}`
    if (entregaVenta.responsable === 'CLIENTE' && entregaVenta.responsableNombre)
      return `${t} · Cliente ${entregaVenta.responsableNombre}`
    return t
  }

  return (
    <div className="factura-v2 cobro-proforma">
      <div className="proforma-grid">
        {/* ===== IZQUIERDA · Datos de la Proforma + Emitir ===== */}
        <aside className="card card--flush proforma-datos">
          <h3 className="resumen-title">Datos de la Proforma</h3>
          <div className="rgroup">
            <div className="rrow">
              <span className="rlabel">Señor</span>
              <span className="rvalue">{cliente.name}</span>
            </div>
            <div className="rrow">
              <span className="rlabel">CUIT</span>
              <span className="rvalue">{oSinEsp(cliente.cuit)}</span>
            </div>
            <div className="rrow">
              <span className="rlabel">Domicilio</span>
              <span className="rvalue">{direccionHastaCiudad(cliente.addr)}</span>
            </div>
            <div className="rrow">
              <span className="rlabel">Condición frente al IVA</span>
              <span className="rvalue">{oSinEsp(cliente.status)}</span>
            </div>
            <div className="rrow">
              <span className="rlabel">Entrega</span>
              <span className="rvalue">{entregaTexto()}</span>
            </div>
          </div>

          <hr className="rsep" />

          <button
            type="button"
            className="btn btn-primary proforma-emitir"
            onClick={emitir}
            disabled={emitiendo || emitida || productos.length === 0}
            aria-busy={emitiendo}
            style={emitida ? { background: 'var(--green)', color: '#fff' } : undefined}
          >
            {emitiendo ? (
              <>
                <i className="fas fa-circle-notch spin" /> Emitiendo…
              </>
            ) : emitida ? (
              // Emitida: botón verde con el texto y el tilde en blanco.
              <>
                <i className="fas fa-check" style={{ color: '#fff' }} /> Proforma emitida
              </>
            ) : (
              <>
                <i className="far fa-file-lines" /> Emitir Factura Proforma
              </>
            )}
          </button>

        </aside>

        {/* ===== DERECHA · Card desplegable + envío ===== */}
        <div className="proforma-main">
          <div className="comp-card proforma-card">
            <div className="comp-head">
              <button
                type="button"
                className="comp-toggle"
                aria-expanded={abierta}
                onClick={() => setAbierta((v) => !v)}
              >
                <i className={`fas fa-chevron-down comp-chev ${abierta ? 'open' : ''}`} />
                <span className="comp-tit">Factura Proforma</span>
              </button>
              <div className="comp-head-datos">
                <div className="comp-head-dato">
                  <span className="comp-head-lbl">Productos</span>
                  <span className="comp-head-val">{productos.length}</span>
                </div>
                <div className="comp-head-dato">
                  <span className="comp-head-lbl">Importe Total</span>
                  <span className="comp-head-val comp-head-val--imp">{money(total)}</span>
                </div>
              </div>

              {/* Check de emisión: verde cuando la proforma ya se emitió en el tablero (proformaId). */}
              <span className="comp-estado">
                <span
                  className={`cobro-ok ${emitida ? 'on' : ''}`}
                  title={emitida ? 'Proforma emitida' : 'Pendiente de emisión'}
                >
                  <i className="fas fa-check" />
                </span>
              </span>
            </div>

            {abierta && (
              <div className="comp-body">
                <table className="comp-table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Nombre</th>
                      <th className="ta-c">Cant. vendida</th>
                      <th className="ta-c">U.M.</th>
                      <th className="ta-r">Precio Unitario</th>
                      <th className="ta-r">Importe Bonif.</th>
                      <th className="ta-r">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.length === 0 && (
                      <tr>
                        <td colSpan={7} className="comp-vacio">
                          La venta no tiene productos.
                        </td>
                      </tr>
                    )}
                    {filas.map((f, i) => (
                      <tr key={`${f.codigo || f.nombre}-${i}`}>
                        <td>
                          <span className="comp-cod">{f.codigo || '—'}</span>
                        </td>
                        <td>
                          <span className="comp-nom">{f.nombre}</span>
                        </td>
                        <td className="ta-c">{f.cantidad}</td>
                        <td className="ta-c">{f.um || '—'}</td>
                        <td className="ta-r">{money(f.precioUnitario)}</td>
                        <td className="ta-r">{money(f.bonifUnit)}</td>
                        <td className="ta-r comp-total-prod">{money(f.totalLinea)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Totales estándar, en el MISMO renglón y posición que en la card de factura: el
                    `comp-pie` los separa de la tabla y los alinea a la derecha. */}
                <div className="comp-pie">
                  <TotalesDoc
                    subtotal={bruto}
                    descuento={descuento}
                    gravado={neto}
                    iva={iva}
                    total={total}
                  />
                </div>

                {/* Recordatorio del descuento por pago anticipado / contado, vigente en factura. */}
                <p className="comp-leyenda">
                  <i className="fas fa-circle-info" /> Recordamos que se encuentra vigente el
                  descuento en factura del 6% por pago anticipado o cdo.
                </p>
              </div>
            )}
          </div>

          <EnviarDocumento documento="proforma" numero="Factura Proforma" />
        </div>
      </div>
    </div>
  )
}
