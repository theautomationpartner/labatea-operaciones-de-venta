import { useEffect, useMemo, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { NRO_PRESUPUESTO } from '@/data/mock'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { addDays } from '@/lib/dates'
import { PASOS_PRESUPUESTO, indiceDePaso, pasoPrevioAEmision } from '@/lib/pasos'
import { resumenPresupuesto, resumenPresupuestoBimoneda } from '@/lib/selectors'
import { faltantesPresupuesto } from '@/lib/validaciones'
import { adjuntarPdfPresupuesto, crearPresupuesto, mondayHabilitado } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { LOGO_DOCUMENTOS } from './pdf/comun'
import { generarPresupuestoPdf } from './pdf/generarPresupuestoPdf'
import { leyendaPagosDe } from './pdf/leyendaPagos'
import { PresupuestoAGenerar } from './PresupuestoAGenerar'
import { ResumenEmision } from './ResumenEmision'
import { VerPresupuestoPdf } from './VerPresupuestoPdf'

/**
 * Estado de la emisión: idle → generando (la app arma el PDF) → listo.
 *   · 'error': algo que el usuario puede corregir (sin productos, registro incompleto): modal.
 *   · 'error-pdf': react-pdf no pudo generar el documento. No es del usuario: el botón queda en rojo
 *     y se le pide contactar al soporte.
 */
type EstadoPdf = 'idle' | 'generando' | 'listo' | 'error' | 'error-pdf'


/**
 * Paso 3 de PRESUPUESTAR: revisión, PDF, envío a los contactos y registro.
 *
 * Son dos momentos separados:
 *   1. "Emitir Presupuesto" genera el PDF EN LA APP, con la plantilla que usaba Make.com y los
 *      importes de la card "Presupuesto a generar" (ver `PresupuestoPdf`). No toca Monday ni
 *      Make.com. "Ver Presupuesto PDF" lo abre.
 *   2. "Registrar Presupuesto" recién ahí escribe en Monday: crea el ítem con sus subitems, le
 *      sube ese mismo PDF y cierra la operación.
 */
export function EmisionView() {
  const {
    lineas,
    fechaEmision,
    diasVigencia,
    cliente,
    presupuestoId,
    nroPresupuesto,
    vendedor,
    moneda,
    tasaCambio,
    documentoEmitido,
    operacion,
    tipoVenta,
    tipoEntrega,
    descuentoPagoActivo,
    actividadesDocumento,
    presupuestoPdf,
    descuentosPago,
  } = useApp()
  const dispatch = useDispatch()
  /* Éxito PERSISTENTE de la emisión: la bandera global sobrevive a la navegación con el stepper, así
     el botón "Emitir Presupuesto" no se reactiva al volver a esta etapa. */
  const emitido = documentoEmitido

  // El presupuesto no liquida IVA: el importe total es el subtotal de sus productos.
  const resumen = useMemo(
    () => resumenPresupuesto(lineas, false),
    [lineas],
  )
  /* Totales bimonetarios (pesos y dólares por separado): los mismos que muestra el paso de armado.
     Se escriben en el ítem del presupuesto al crearlo (TOTAL EN PESOS / TOTAL EN DOLARES). */
  const bimoneda = useMemo(
    () => resumenPresupuestoBimoneda(lineas, tasaCambio ?? 0),
    [lineas, tasaCambio],
  )
  const vencimiento = useMemo(
    () => addDays(fechaEmision, diasVigencia),
    [fechaEmision, diasVigencia],
  )

  /* Generación del PDF, en el navegador. */
  const [estado, setEstado] = useState<EstadoPdf>('idle')
  // "Registrar Presupuesto" en curso: tapa la pantalla con la ventana de espera.
  const [registrando, setRegistrando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Datos que faltan para escribir el presupuesto en Monday; frenan la generación.
  const [faltantes, setFaltantes] = useState<string[] | null>(null)
  // Si se sale del paso mientras se espera el PDF, no actualizamos estado desmontado.
  const activo = useRef(true)
  useEffect(() => {
    activo.current = true
    return () => {
      activo.current = false
    }
  }, [])

  // Emisión del PRESUPUESTO: el crédito NO frena (sólo la venta bloquea). Un presupuesto con el
  // crédito agotado igual se emite, genera el PDF y se envía. El cliente bloqueado sí frena.
  const bloqueo = useBloqueoCredito(resumen.neto, { bloqueante: false })

  /**
   * "Emitir Presupuesto": valida y genera el PDF con lo que muestra la card. NO escribe en Monday
   * —eso lo hace `registrar`—, así que se puede emitir sin dejar nada a medias en el tablero.
   *
   * Al emitir, los pasos anteriores quedan en solo lectura (`hayDocumentoEmitido`): el PDF es la
   * foto de la card, y lo que se registre después tiene que ser lo mismo que dice el documento.
   */
  const generar = async () => {
    if (!cliente) return
    // Anti-duplicado: si el presupuesto ya se emitió (incluso tras volver con el stepper), no se
    // vuelve a generar.
    if (documentoEmitido) return
    if (estado === 'generando') return
    if (bloqueo.frenar()) return
    if (lineas.length === 0) {
      setError('Agregá al menos un producto antes de emitir el presupuesto.')
      setEstado('error')
      return
    }
    /* Se valida ACÁ y no al registrar: el PDF lleva los mismos datos que después van al ítem y a
       sus subitems, y no tiene sentido emitir un documento que no se va a poder registrar. */
    const faltan = faltantesPresupuesto(
      { cliente, lineas, fechaEmision, fechaVencimiento: vencimiento, diasVigencia },
      mondayHabilitado(),
    )
    if (faltan.length > 0) {
      setFaltantes(faltan)
      return
    }
    setEstado('generando')
    setError(null)
    try {
      const archivo = await generarPresupuestoPdf({
        numero: nroPresupuesto ?? NRO_PRESUPUESTO,
        cliente,
        fechaEmision,
        fechaVencimiento: vencimiento,
        lineas,
        /* La leyenda de formas de pago sólo si el vendedor la tildó en la etapa de productos
           ("¿Desea aplicar la leyenda de descuentos por forma de pago?"). */
        leyendaPagos: descuentoPagoActivo ? leyendaPagosDe(descuentosPago) : null,
        logoSrc: LOGO_DOCUMENTOS,
      })
      if (!activo.current) return
      dispatch({ type: 'setPresupuestoPdf', value: archivo })
      // Bandera GLOBAL de emisión exitosa: persiste al navegar con el stepper.
      dispatch({ type: 'setDocumentoEmitido', value: true })
      setEstado('listo')
    } catch (e) {
      if (!activo.current) return
      console.error('No se pudo generar el PDF del presupuesto', e)
      setEstado('error-pdf')
    }
  }

  /**
   * "Registrar Presupuesto": el ÚNICO lugar donde el presupuesto nace en Monday. Todo se `await`ea
   * en orden, con la ventana de espera arriba:
   *   1. el ítem con su cabecera y TODOS sus productos como subitems (`crearPresupuesto`), y se
   *      corta si alguno no entró;
   *   2. el PDF emitido, a la columna file del ítem (`adjuntarPdfPresupuesto`).
   * Recién con los dos confirmados se cierra la operación.
   *
   * Idempotente: si el ítem ya se creó y falló la subida del PDF, reintentar sólo sube el PDF.
   */
  const registrar = async () => {
    if (!cliente || !presupuestoPdf || registrando) return
    setRegistrando(true)
    try {
      let id = presupuestoId
      if (!id) {
        const creado = await crearPresupuesto({
          cliente,
          vendedor,
          lineas,
          fechaEmision,
          fechaVencimiento: vencimiento,
          diasVigencia,
          rentabilidad: resumen.rentabilidad,
          moneda,
          totalPesos: bimoneda.ars.neto,
          totalUsd: bimoneda.usd.neto,
          /* Lo ÚNICO que hace el check: tilda la casilla del ítem que le pide al PDF incluir la
             leyenda de las formas de pago bonificadas. No baja ningún precio. */
          descuentoPagoAplicado: descuentoPagoActivo,
          // La gestión comercial que originó el presupuesto: las tildadas en "Registrar Actividad".
          actividadesIds: actividadesDocumento.map((a) => a.id),
        })
        if (creado.subitemsCreados !== lineas.length) {
          if (!activo.current) return
          setRegistrando(false)
          setError(
            `El presupuesto se creó pero quedó incompleto: entraron ${creado.subitemsCreados} de ${lineas.length} productos. Revisalo en Monday antes de registrarlo.`,
          )
          setEstado('error')
          return
        }
        id = creado.id
        dispatch({ type: 'setPresupuestoId', value: id })
      }
      await adjuntarPdfPresupuesto(id, presupuestoPdf)
      // Registrado con su PDF: se cierra la operación y se reinicia la app.
      dispatch({ type: 'reset' })
    } catch {
      if (!activo.current) return
      /* Fallo de la API: lo comunica la ventana global de error de Monday. Acá sólo se libera el
         botón para poder reintentar. */
      setRegistrando(false)
      dispatch({ type: 'errorMonday', accion: 'registrar el presupuesto' })
    }
  }

  return (
    <section className="view emision-v2 paso-layout">
      <PasoHeader pasos={PASOS_PRESUPUESTO} actual={indiceDePaso('emision', operacion, tipoVenta, tipoEntrega)} />

      <PasoTitulo
        numero={indiceDePaso('emision', operacion, tipoVenta, tipoEntrega) + 1}
        titulo="Emitir y enviar presupuesto"
        descripcion="Revisá el resumen, generá el PDF y mandáselo a los contactos del cliente."
      />

      {/* Izquierda: el resumen con el botón de emisión. Derecha: el presupuesto a registrar en un
          desplegable y, debajo, el envío —mismo armado que el paso de factura—. */}
      <div className="emision-grid">
        <div className="emision-col">
          <ResumenEmision
            resumen={resumen}
            vencimiento={vencimiento}
            generando={estado === 'generando'}
            emitido={emitido}
            errorPdf={estado === 'error-pdf'}
            onGenerar={generar}
          >
            {/* Siempre debajo de emitir: se habilita cuando el PDF ya está generado. El aviso de
                error va DEBAJO de los dos botones, nunca entre ellos. */}
            <VerPresupuestoPdf archivo={presupuestoPdf} />
            {estado === 'error-pdf' && (
              <div className="pres-pdf-aviso" role="alert">
                <i className="fas fa-circle-exclamation" /> La app no está pudiendo generar el PDF
                del presupuesto. Tocá el botón para reintentar; si vuelve a fallar, contactate con el
                soporte de TAP.
              </div>
            )}
          </ResumenEmision>
        </div>

        {/* Bajo `.factura-v2` para reutilizar el desplegable de comprobantes (clases `comp-*` y sus
            variables); se neutraliza el box de página del namespace para que encaje en la columna. */}
        <div className="factura-v2" style={{ padding: 0, maxWidth: 'none', margin: 0 }}>
          <PresupuestoAGenerar
            numero={nroPresupuesto ?? NRO_PRESUPUESTO}
            lineas={lineas}
            emitido={emitido}
          />
          <EnviarDocumento documento="presupuesto" />
        </div>
      </div>

      <div className="footer-acts">
        <button
          type="button"
          className="btn-volver"
          /* No siempre se vuelve a los productos: el presupuesto registra actividad, y esa etapa
             está entre medio (ver `pasoPrevioAEmision`). */
          onClick={() =>
            dispatch({
              type: 'goto',
              paso: pasoPrevioAEmision(operacion, tipoVenta, tipoEntrega),
            })
          }
        >
          <i className="fas fa-arrow-left" /> Volver
        </button>
        {/* Registra el presupuesto en Monday (ítem, subitems y PDF) y cierra la operación. Pide el
            PDF EMITIDO: es el archivo que se sube al ítem. */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!presupuestoPdf || registrando}
          title={presupuestoPdf ? undefined : 'Emití el presupuesto para poder registrarlo.'}
          onClick={() => void registrar()}
        >
          <i className="fas fa-flag-checkered" /> Registrar Presupuesto
        </button>
      </div>

      {/* Tapa la pantalla mientras se `await`ea el registro en Monday. */}
      {registrando && (
        <ModalCargando
          titulo="Registrando presupuesto..."
          detalle="Estamos registrando el presupuesto en el sistema junto a sus productos y su PDF. Espera unos segundos"
        />
      )}

      {faltantes && (
        <AvisoModal
          titulo="Faltan datos para emitir el presupuesto"
          faltantes={faltantes}
          onClose={() => setFaltantes(null)}
        >
          No se puede generar el PDF hasta completar estos datos en Monday:
        </AvisoModal>
      )}

      {/* Un fallo al generar el PDF o un registro incompleto se avisan en el mismo modal. */}
      {estado === 'error' && error && (
        <AvisoModal
          titulo="No se pudo completar el presupuesto"
          onClose={() => {
            setError(null)
            setEstado('idle')
          }}
        >
          {error}
        </AvisoModal>
      )}

      {bloqueo.modal}
    </section>
  )
}
