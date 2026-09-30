import { useEffect, useState } from 'react'
import { ActividadesDelDocumento } from '@/features/actividad/ActividadesDelDocumento'
import { generarProformaPdf, importe, lineasProformaPdf } from '@/features/emision/pdf/generarProformaPdf'
import { CompBody } from '@/features/shared/CompBody'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { TotalesDoc } from '@/features/shared/TotalesDoc'
import { VerImprimirPdf } from '@/features/shared/VerImprimirPdf'
import { nombreSinCodigo } from '@/lib/busquedaClientes'
import { money } from '@/lib/format'
import { documentoDeVentaItem } from '@/lib/selectors'
import { getActividadesHeredadasDePresupuestos, getProximoNroProforma } from '@/services/monday'
import { useAccionEnCurso } from '@/features/shared/useAccionEnCurso'
import { useReemision } from '@/features/shared/useReemision'
import { useApp, useDispatch } from '@/state/hooks'
import type { ActividadListada } from '@/types'
import { useProformaVenta } from './useProformaVenta'

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

/** Tipo de entrega como lo escribe la proforma. */
export const entregaDe = (t: string | null | undefined): string =>
  t === 'POSTERIOR' ? 'Posterior' : t === 'ANTERIOR' ? 'Anterior' : 'Simultánea'

/**
 * Bloque "Emitir Proforma" de la etapa de Cobro (forma de pago CONTADO): a la izquierda los datos de
 * la proforma, el botón de emisión y "Ver / Imprimir (1)"; a la derecha la card de la factura proforma
 * y el envío a los contactos.
 *
 * Mismo esquema que el presupuesto: "Emitir Factura Proforma" genera el PDF EN LA APP —no toca
 * Monday—, el envío lo manda por el escenario de Make y "Registrar Proforma" (en el pie de la etapa,
 * ver `CobroView`) crea la proforma en el tablero y le sube ese PDF.
 */
export function CobroProforma() {
  const state = useApp()
  const dispatch = useDispatch()
  const { cliente, tipoVenta, tipoEntrega, entregaVenta, proformaPdf } = state

  /* Emitida = el PDF ya se generó. Se deriva del estado GLOBAL —no de uno local— para no perderlo
     al volver a un paso anterior: el componente se desmonta, pero el PDF sobrevive. */
  const emitida = Boolean(proformaPdf)

  // Los números de la proforma: los mismos que lleva el PDF y que se registran en Monday.
  const { productos, filas, bruto, neto, descuento, iva, total } = useProformaVenta()

  const [emitiendo, setEmitiendo] = useState(false)
  // "Registrar Proforma" vive en CobroView: se entera de la emisión por el estado global.
  useAccionEnCurso('emitiendo', emitiendo)
  // react-pdf no pudo generar el PDF: botón en rojo y aviso de soporte.
  const [errorPdf, setErrorPdf] = useState(false)
  const [abierta, setAbierta] = useState(true)

  /* La gestión comercial que hereda esta proforma: sólo CON PRESUPUESTO PREVIO trae algo que
     mostrar (de los presupuestos que aportaron algún producto, ver `getActividadesDePresupuestos`
     más abajo, en `emitir`). La DIRECTA todavía no eligió nada: esa etapa viene DESPUÉS del cobro,
     recién antes de facturar (ver "Registrar Actividad"), así que el campo se ve vacío hasta ahí —
     mismo criterio que la proforma que sale de acá: nace sin actividad propia. */
  const [actividadesHeredadas, setActividadesHeredadas] = useState<ActividadListada[]>([])
  useEffect(() => {
    if (tipoVenta !== 'CON PRESUPUESTO PREVIO') {
      setActividadesHeredadas([])
      return
    }
    let vivo = true
    getActividadesHeredadasDePresupuestos(
      [...new Set(state.ventaItems.map((it) => documentoDeVentaItem(it.uid)))],
    ).then((as) => {
      if (vivo) setActividadesHeredadas(as)
    })
    return () => {
      vivo = false
    }
  }, [tipoVenta, state.ventaItems])

  /**
   * "Emitir Factura Proforma": genera el PDF con lo que muestra la card. No escribe en Monday: la
   * proforma nace al registrarla. El número del tablero se anticipa (el último "PROFORMA-###" + 1),
   * porque el tablero recién lo asigna al crear el ítem.
   */
  const emitir = async () => {
    /* Emitida, se puede volver a emitir (para corregir un error): el PDF nuevo reemplaza al anterior
       y el envío vuelve a cero. Lo que no se permite es emitir dos veces a la vez. */
    if (!cliente || emitiendo || productos.length === 0) return
    setEmitiendo(true)
    setErrorPdf(false)
    try {
      const numero = (await getProximoNroProforma().catch(() => null)) ?? 'PROFORMA'
      const pdf = await generarProformaPdf({
        numero,
        fechaEmision: state.fechaEmision,
        cliente: {
          codigo: cliente.codigo,
          razonSocial: nombreSinCodigo(cliente.name),
          addr: cliente.addr,
          condicionIva: cliente.status,
          cuit: cliente.cuit,
        },
        vendedor: state.vendedor?.name ?? '',
        tipoEntrega: entregaDe(tipoEntrega),
        // La proforma sale de la venta CONTADO.
        condicion: 'Contado',
        lineas: lineasProformaPdf(filas),
        gravado: importe(neto),
        iva: importe(iva),
        // La app no liquida percepciones de IIBB.
        percIb: importe(0),
        total: importe(total),
        tipoCambio: state.tasaCambio ? importe(state.tasaCambio) : '—',
      })
      dispatch({ type: 'setProformaPdf', pdf, numero, firma })
    } catch (e) {
      console.error('No se pudo generar el PDF de la proforma', e)
      setErrorPdf(true)
    } finally {
      setEmitiendo(false)
    }
  }

  /* Reemisión: el botón de emitir sigue habilitado, y un PDF que quedó viejo (se cambiaron datos en
     un paso anterior) se descarta solo. `firma` va guardada con el PDF. */
  const {
    firma,
    pedirEmision,
    modal: modalReemision,
    enviando,
  } = useReemision('proforma', emitida, () => void emitir())

  if (!cliente) return null

  const entregaTexto = () => {
    const t = entregaDe(tipoEntrega)
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
            <div className="rrow">
              <span className="rlabel">Actividades</span>
              <span className="rvalue">
                <ActividadesDelDocumento actividades={actividadesHeredadas} />
              </span>
            </div>
          </div>

          <hr className="rsep" />

          <button
            type="button"
            className="btn btn-primary proforma-emitir btn-mayus"
            onClick={pedirEmision}
            /* Emitida sigue habilitado: se puede volver a emitir para corregir un error. Mientras se
               envía, no: cambiaría el PDF que se está mandando. */
            disabled={emitiendo || enviando || productos.length === 0}
            aria-busy={emitiendo}
            title={
              emitiendo
                ? undefined
                : enviando
                  ? 'Esperá a que termine el envío para volver a emitir.'
                  : emitida
                    ? 'Tocá para volver a emitir con los datos actuales'
                    : errorPdf
                      ? 'Tocá para reintentar la emisión'
                      : undefined
            }
            style={
              emitida
                ? { background: 'var(--green)', color: '#fff' }
                : errorPdf && !emitiendo
                  ? { background: 'var(--red)', color: '#fff' }
                  : undefined
            }
          >
            {emitiendo ? (
              <>
                <i className="fas fa-circle-notch spin" /> Generando PDF…
              </>
            ) : emitida ? (
              // Emitida: botón verde con el texto y el tilde en blanco.
              <>
                <i className="fas fa-check" style={{ color: '#fff' }} /> Proforma emitida
              </>
            ) : errorPdf ? (
              <>
                <i className="fas fa-xmark" /> Error de emisión
              </>
            ) : (
              <>
                <i className="far fa-file-lines" /> Emitir Factura Proforma
              </>
            )}
          </button>

          {/* Siempre debajo de emitir: se habilita con el PDF generado. El aviso de error va debajo. */}
          <VerImprimirPdf archivos={proformaPdf ? [proformaPdf] : null} />
          {errorPdf && (
            <div className="pres-pdf-aviso" role="alert">
              <i className="fas fa-circle-exclamation" /> La app no está pudiendo generar el PDF de la
              proforma. Tocá el botón para reintentar; si vuelve a fallar, contactate con el soporte de
              TAP.
            </div>
          )}

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

              {/* Check de emisión: verde cuando el PDF de la proforma ya se generó. */}
              <span className="comp-estado">
                <span
                  className={`cobro-ok ${emitida ? 'on' : ''}`}
                  title={emitida ? 'Proforma emitida' : 'Pendiente de emisión'}
                >
                  <i className="fas fa-check" />
                </span>
              </span>
            </div>

            <CompBody abierta={abierta}>
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
            </CompBody>
          </div>

          {/* Por PDF emitido: uno nuevo es otro documento, y el envío arranca de cero. */}
          <EnviarDocumento key={`emision-${state.emisionNro}`} documento="proforma" />
          {modalReemision}
        </div>
      </div>
    </div>
  )
}
