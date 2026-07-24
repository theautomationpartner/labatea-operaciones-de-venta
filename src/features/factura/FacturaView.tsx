import { useMemo, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { addDays } from '@/lib/dates'
import {
  facturaVenceAPlazo,
  ivaPorDefecto,
  letraComprobante,
  PUNTO_VENTA_DEFAULT,
} from '@/lib/factura'
import { comprobantesDeVenta } from '@/lib/facturacion'
import { lineasDeVenta } from '@/lib/lineasVenta'
import { pasosDe } from '@/lib/pasos'
import { crearComprobantes, FACT_VENCIMIENTO_DIAS } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import { ComprobantesAGenerar } from './ComprobantesAGenerar'
import { ResumenVenta } from './ResumenVenta'

/** Número de comprobante que asignaría AFIP al emitirla. */
const NRO_FACTURA = 'FC-0001-00001234'

/**
 * Paso 4 de CARGAR VENTA: resumen de la venta y los comprobantes en los que se parte.
 *
 * La venta puede generar más de una factura —la mercadería común va en una y la consignada se
 * factura por separado, una por proveedor—, así que la pantalla se ordena en dos columnas: a
 * la izquierda el resumen con el botón de emisión, a la derecha un comprobante por card.
 */
export function FacturaView() {
  const state = useApp()
  const { cliente, operacion, tipoVenta, tipoEntrega, factura, fechaEmision, ventaId } = state
  const dispatch = useDispatch()

  const [emitiendo, setEmitiendo] = useState(false)
  const [errorEmision, setErrorEmision] = useState<string | null>(null)
  // El envío se completó: junto con la factura ya emitida habilita "Finalizar Operación".
  const [enviado, setEnviado] = useState(false)
  /* Días de vencimiento por comprobante. Viven acá y no en cada card porque el botón que emite
     está del otro lado de la pantalla. Sin tocar nada, cada uno arranca en 30 días. */
  const [dias, setDias] = useState<Record<string, number>>({})

  /* Evaluación de la mercadería de la venta: en cuántos comprobantes se parte. Se hace sobre
     las líneas normalizadas, que son las que arrastran tipo de mercadería, proveedor e IVA. */
  const productos = useMemo(
    () =>
      lineasDeVenta({
        tipoVenta,
        tipoEntrega,
        lineas: state.lineas,
        ventaItems: state.ventaItems,
        facturaItems: state.facturaItems,
      }),
    [tipoVenta, tipoEntrega, state.lineas, state.ventaItems, state.facturaItems],
  )
  const comprobantes = useMemo(() => comprobantesDeVenta(productos), [productos])

  // Comprobantes ya escritos en el board, indexados por la clave del grupo que los originó.
  const emitidos = useMemo(
    () => new Map(factura.comprobantes.map((c) => [c.clave, c])),
    [factura.comprobantes],
  )

  if (!cliente) return null

  const ivaReceptor = factura.ivaReceptor ?? ivaPorDefecto(cliente)
  // A para responsable inscripto y monotributista; B para consumidor final y exento.
  const letra = factura.letra ?? letraComprobante(cliente.status)
  /* Sólo la cuenta corriente vence a plazo; en cualquier otra condición la factura se cobra al
     emitirse, así que su vencimiento es la propia fecha de emisión. */
  const venceAPlazo = facturaVenceAPlazo(cliente)
  const diasDe = (clave: string) => dias[clave] ?? FACT_VENCIMIENTO_DIAS
  const vencimientoDe = (clave: string) =>
    venceAPlazo ? addDays(fechaEmision, diasDe(clave)) : fechaEmision

  /**
   * Escribe en el board un ítem por comprobante con sus líneas. Sólo se da por emitida la
   * venta si volvieron todos completos: una factura a medias no cierra la operación.
   */
  const emitir = async () => {
    if (emitiendo || comprobantes.length === 0) return
    setEmitiendo(true)
    setErrorEmision(null)
    try {
      const creados = await crearComprobantes(
        comprobantes.map((c) => ({ ...c, vencimiento: vencimientoDe(c.clave) })),
        {
          cliente,
          moneda: factura.moneda,
          tipoCambio: factura.tipoCambio,
          letra,
          ivaReceptor,
          fechaEmision,
          observaciones: factura.observaciones,
          ventaId,
        },
      )
      const incompletos = creados.filter((c) => !c.id || c.lineasCreadas < c.lineasEsperadas)
      if (incompletos.length > 0) {
        setErrorEmision(
          `Quedaron ${incompletos.length} de ${creados.length} comprobantes incompletos. Revisalos en el tablero antes de reintentar.`,
        )
      }
      dispatch({ type: 'emitirFactura', comprobantes: creados })
    } catch {
      setErrorEmision('No se pudieron crear los comprobantes. Reintentá en unos segundos.')
    } finally {
      setEmitiendo(false)
    }
  }

  return (
    <section className="view factura-v2 paso-layout">
      <PasoHeader pasos={pasosDe(operacion, tipoVenta, tipoEntrega)} actual={3} />

      <PasoTitulo
        numero={4}
        titulo="Emitir y enviar factura"
        descripcion="Revisá el resumen de la venta, controlá cada comprobante y emitilos."
      />

      <div className="factura-grid-v2">
        <ResumenVenta
          cliente={cliente}
          cantidadProductos={productos.length}
          cantidadFacturas={comprobantes.length}
          emitidos={factura.comprobantes.length}
          emitiendo={emitiendo}
          onEmitir={emitir}
        />

        {/* Columna derecha: los comprobantes y, debajo, el envío de la factura. */}
        <div className="factura-col-der">
          <ComprobantesAGenerar
            comprobantes={comprobantes}
            letra={letra}
            puntoVenta={PUNTO_VENTA_DEFAULT}
            fechaEmision={fechaEmision}
            venceAPlazo={venceAPlazo}
            dias={Object.fromEntries(comprobantes.map((c) => [c.clave, diasDe(c.clave)]))}
            onDias={(clave, d) => setDias((v) => ({ ...v, [clave]: d }))}
            emitidos={emitidos}
            emitiendo={emitiendo}
          />

          {/* El estado del envío se muestra dentro de la propia card. */}
          <EnviarDocumento
            documento="factura"
            numero={NRO_FACTURA}
            onEnviado={() => setEnviado(true)}
          />
        </div>
      </div>

      <footer className="page-footer">
        <button
          type="button"
          className="btn-outline"
          onClick={() => dispatch({ type: 'goto', paso: 'cobro' })}
        >
          <i className="fas fa-arrow-left" /> Volver
        </button>
        {/* Cierra la venta y reinicia la app. Sólo con la factura emitida y ya enviada. */}
        <button
          type="button"
          className="btn-primary"
          disabled={!(factura.emitida && enviado)}
          onClick={() => dispatch({ type: 'reset' })}
        >
          <i className="fas fa-flag-checkered" /> Finalizar Operación
        </button>
      </footer>

      {errorEmision && (
        <AvisoModal titulo="No se pudieron emitir todos los comprobantes" onClose={() => setErrorEmision(null)}>
          {errorEmision}
        </AvisoModal>
      )}
    </section>
  )
}
