import { useEffect, useRef, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { ModalCargando } from '@/components/ui/ModalCargando'
import { NRO_REMITO } from '@/data/mock'
import { LOGO_DOCUMENTOS } from '@/features/emision/pdf/comun'
import { lineasRemitoPdf, nombresRemitoPdf } from '@/features/emision/pdf/datosRemito'
import { generarRemitoPdfs } from '@/features/emision/pdf/generarRemitoPdfs'
import { VerImprimirPdf } from '@/features/shared/VerImprimirPdf'
import { EnviarDocumento } from '@/features/shared/EnviarDocumento'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { useBloqueoCredito } from '@/features/shared/useBloqueoCredito'
import { round2 } from '@/lib/format'
import { indiceDePaso, pasosDe } from '@/lib/pasos'
import {
  adjuntarPdfsRemito,
  afectarEntregaAnterior,
  crearRemito,
  crearVtaPendienteFacturar,
  getHojaTalonario,
  hojaDisponible,
  marcarHojaUsada,
  numeroRemito,
  registrarRemito,
  type HojaTalonario,
  type LineaRemito,
} from '@/services/monday'
import { useReemision } from '@/features/shared/useReemision'
import { useApp, useDispatch } from '@/state/hooks'
import { ResumenRemitoEmision } from './ResumenRemitoEmision'
import { RemitoAGenerar } from './RemitoAGenerar'

/**
 * Estado de la emisión: idle → generando (la app arma los PDF) → listo.
 *   · 'error': algo que el usuario puede corregir (sin productos, registro incompleto): modal.
 *   · 'error-pdf': react-pdf no pudo generar los documentos: botón en rojo y contactar al soporte.
 */
type EstadoPdf = 'idle' | 'generando' | 'listo' | 'error' | 'error-pdf'

/**
 * Paso 4 de REMITO: resumen, emisión, envío a los contactos y registro. Mismo esquema que el
 * presupuesto:
 *   1. "Emitir Remito" ASIGNA la próxima hoja libre del talonario —sin tocarla en Monday— y genera EN
 *      LA APP los dos PDF con ese número: el de VENTA y el PREIMPRESO. "Ver / Imprimir (2)" los
 *      abre, y el envío manda el de VENTA por el escenario de Make.
 *   2. "Registrar Remito" escribe en Monday: confirma que la hoja siga libre y la TOMA ("Usado"),
 *      crea el remito con sus subitems, lo vincula a la hoja, le sube los dos PDF, abre el pendiente
 *      de facturar (POSTERIOR) y concilia la entrega (ANTERIOR). Si la hoja ya la usó otro remito,
 *      se descarta la emisión y se pide volver a emitir. Nunca pasa el estado a "Emitir": eso
 *      disparaba el escenario que generaba el PDF.
 */
export function RemitoEmisionView() {
  const {
    cliente,
    vendedor,
    operacion,
    tipoVenta,
    tipoEntrega,
    remito,
    documentoEmitido,
    remitoPdfs,
    remitoHoja,
    fechaEmision,
    emisionNro,
  } = useApp()
  const dispatch = useDispatch()
  /* Éxito PERSISTENTE de la emisión: la bandera global sobrevive a la navegación con el stepper, así
     el botón "Emitir Remito" no se reactiva al volver a esta etapa. */
  const emitido = documentoEmitido

  /* Generación de los PDF, en el navegador. */
  const [estado, setEstado] = useState<EstadoPdf>('idle')
  const [error, setError] = useState<string | null>(null)
  // "Registrar Remito" en curso: tapa la pantalla con la ventana de espera.
  const [registrando, setRegistrando] = useState(false)
  /* La hoja asignada la tomó otro remito entre la emisión y el registro: se avisa con la hoja que
     era, para que se entienda por qué hay que volver a emitir. */
  const [hojaOcupada, setHojaOcupada] = useState<HojaTalonario | null>(null)
  /* La hoja ya quedó tomada por ESTE registro. Si un paso posterior falla y se reintenta, no se la
     vuelve a validar: ya figura "Usado", y es por nosotros. */
  const hojaTomada = useRef(false)

  /* Talonario "En USO" y su primera hoja "Pend de Usar": son la numeración del remito. Sin ellos
     no se puede emitir (botón deshabilitado + aviso). Se chequea al entrar al paso. */
  const [talonario, setTalonario] = useState<HojaTalonario | null>(null)
  const [talonarioError, setTalonarioError] = useState<'sin-talonario' | 'sin-hoja' | null>(null)
  const [avisoTalonario, setAvisoTalonario] = useState(false)
  const [validandoTalonario, setValidandoTalonario] = useState(true)

  // Si se sale del paso mientras se espera el PDF, no actualizamos estado desmontado.
  const activo = useRef(true)
  useEffect(() => {
    activo.current = true
    return () => {
      activo.current = false
    }
  }, [])

  // Pre-validación del talonario al entrar al paso: define si la emisión está habilitada.
  useEffect(() => {
    /* Con la hoja ya reservada (se emitió y se volvió con el stepper) no se consulta: el talonario
       daría la SIGUIENTE hoja, y el remito se registra con la que numera sus PDF. */
    if (remitoHoja) {
      setTalonario(remitoHoja)
      setValidandoTalonario(false)
      return
    }
    let vivo = true
    setValidandoTalonario(true)
    getHojaTalonario()
      .then((res) => {
        if (!vivo) return
        if (res.estado === 'ok') {
          setTalonario(res.hoja)
          setTalonarioError(null)
        } else {
          setTalonario(null)
          setTalonarioError(res.estado)
          setAvisoTalonario(true)
        }
      })
      .catch(() => {
        if (!vivo) return
        // Ante un fallo de la consulta se bloquea igual: no se puede confirmar el talonario.
        setTalonario(null)
        setTalonarioError('sin-talonario')
        setAvisoTalonario(true)
      })
      .finally(() => {
        if (vivo) setValidandoTalonario(false)
      })
    return () => {
      vivo = false
    }
  }, [remitoHoja])

  // Emitir el remito es una salida del sistema: no sale con el cliente bloqueado.
  const bloqueo = useBloqueoCredito(0)

  /**
   * "Emitir Remito": asigna la próxima hoja libre del talonario y genera los dos PDF con ella. No
   * escribe nada en Monday: la hoja se toma al registrar (ver `registrar`), así una operación que se
   * abandona no deja hojas gastadas sin remito.
   *
   * Se vuelve a leer el talonario porque la hoja libre pudo cambiar desde que se entró al paso.
   */
  const emitir = async () => {
    if (!cliente) return
    /* Emitido, se puede volver a emitir (para corregir un error): los PDF nuevos reemplazan a los
       anteriores y el envío vuelve a cero. Lo que no se permite es emitir dos veces a la vez. */
    if (estado === 'generando') return
    // Sin talonario "En USO" con hoja "Pend de Usar" no se numera el remito: se frena y se avisa.
    if (talonarioError || !talonario) {
      setAvisoTalonario(true)
      return
    }
    if (bloqueo.frenar()) return
    if (remito.items.length === 0) {
      setError('Agregá al menos un producto antes de emitir el remito.')
      setEstado('error')
      return
    }
    setEstado('generando')
    setError(null)

    let hoja: HojaTalonario
    try {
      const res = await getHojaTalonario()
      if (res.estado !== 'ok') {
        if (!activo.current) return
        setTalonario(null)
        setTalonarioError(res.estado)
        setAvisoTalonario(true)
        setEstado('idle')
        return
      }
      hoja = res.hoja
    } catch {
      if (!activo.current) return
      setEstado('idle')
      dispatch({ type: 'errorMonday', accion: 'leer el talonario del remito' })
      return
    }

    const numero = numeroRemito(hoja.imprenta)
    let pdfs
    try {
      pdfs = await generarRemitoPdfs(
        {
          numero,
          fechaEmision,
          cliente: {
            name: cliente.name,
            cuit: cliente.cuit,
            addr: cliente.addr,
            condicionIva: cliente.status,
          },
          cot: remito.envio.cot ?? '',
          lineas: lineasRemitoPdf(remito.items),
          imprenta: hoja.imprenta,
          logoSrc: LOGO_DOCUMENTOS,
        },
        nombresRemitoPdf(cliente.name, numero),
      )
    } catch (e) {
      if (!activo.current) return
      console.error('No se pudieron generar los PDF del remito', e)
      setEstado('error-pdf')
      return
    }

    if (!activo.current) return
    setTalonario(hoja)
    dispatch({ type: 'setRemitoPdfs', pdfs, hoja, firma })
    // Bandera GLOBAL de emisión exitosa: persiste al navegar con el stepper y deja los pasos
    // anteriores en solo lectura (los PDF son la foto de lo que se remite).
    dispatch({ type: 'setDocumentoEmitido', value: true })
    setEstado('listo')
  }

  /**
   * "Registrar Remito": el ÚNICO lugar donde el remito nace en Monday. Todo se `await`ea en orden,
   * con la ventana de espera arriba:
   *   1. la hoja del talonario: se confirma que siga libre y se la toma ("Usado"). Va primero para
   *      achicar la ventana en que otro remito podría usarla; si ya está ocupada, no se crea nada y
   *      se pide volver a emitir con otra hoja;
   *   2. el remito con su cabecera y un subelemento por producto (`crearRemito`), y se corta si
   *      alguno no entró; en POSTERIOR, además, el pendiente de facturar (best-effort);
   *   3. observaciones, hoja del talonario, número y estado "Emitido" (`registrarRemito`);
   *   4. los dos PDF, cada uno a su columna (`adjuntarPdfsRemito`).
   * Recién con eso se concilia la entrega (ANTERIOR, sin esperar) y se cierra la operación.
   *
   * Idempotente: si el remito ya se creó y falló un paso posterior, reintentar no lo vuelve a crear.
   */
  const registrar = async () => {
    if (!cliente || !remitoPdfs || !remitoHoja || registrando) return
    setRegistrando(true)
    try {
      if (!hojaTomada.current) {
        if (!(await hojaDisponible(remitoHoja.hojaId))) {
          if (!activo.current) return
          /* Otro remito usó la hoja: los PDF llevan un número ajeno. Se descarta la emisión (el
             paso vuelve a buscar la próxima hoja libre) y la ventana de espera pasa a ser el aviso. */
          setRegistrando(false)
          setHojaOcupada(remitoHoja)
          setTalonario(null)
          dispatch({ type: 'descartarEmisionRemito' })
          return
        }
        await marcarHojaUsada(remitoHoja.hojaId)
        hojaTomada.current = true
      }

      /* Creación diferida: el remito nace al registrar. Idempotente: si ya existe, no se recrea. */
      let id = remito.remitoId
      if (!id) {
        const { envio } = remito
        const lineas: LineaRemito[] = remito.items.map((it) => ({
          productoId: it.productoId,
          /* ANTERIOR: la línea se linkea a su pendiente de entrega, no al producto. Es lo que
             después permite volver desde el remito a la venta que le puso el precio. */
          pendienteEntregaId: it.pendienteEntregaId,
          nombre: it.nombre,
          cantidad: it.cantidad,
          pesoUnitario: it.peso ?? 0,
          um: it.um,
          // Sólo POSTERIOR lo usa: alimenta el "🤖Total $" del subelemento y el pendiente de facturar.
          precioUnitario: it.precioUnitario,
        }))
        // Ventas de origen (emisión ANTERIOR), sin repetir: una línea por venta puede repetirse.
        const ventaIds = Array.from(
          new Set(remito.items.map((it) => it.ventaId).filter((v): v is string => !!v)),
        )
        const creado = await crearRemito({
          clienteId: cliente.id,
          vendedorId: vendedor?.id ?? null,
          nombre: cliente.name,
          tipoEmision: remito.tipoEmision ?? 'POSTERIOR',
          responsable: envio.responsable,
          destinoId: envio.destinoId,
          transportistaId: envio.choferId,
          vehiculoId: envio.vehiculoId,
          comisionistaId: envio.comisionistaId,
          clienteResponsable: envio.responsableNombre,
          ventaIds,
          lineas,
        })
        if (creado.subitemsCreados < lineas.length) {
          if (!activo.current) return
          setRegistrando(false)
          setError(
            'El remito se creó pero quedaron productos sin asentar. Revisalo en Monday antes de registrarlo.',
          )
          setEstado('error')
          return
        }
        id = creado.id
        dispatch({ type: 'setRemitoCreado', value: id })

        /* POSTERIOR: la mercadería entregada queda pendiente de facturar. Con el remito ya creado
           (Σ cantidad × precio unitario = importe pendiente), se abre el registro en "Vtas Pends de
           Facturar" (ítem + subítems) enlazado al remito y a la cuenta. Best-effort. */
        if ((remito.tipoEmision ?? 'POSTERIOR') === 'POSTERIOR') {
          const importePendFacturar = round2(
            remito.items.reduce((acc, it) => acc + round2(it.cantidad * (it.precioUnitario ?? 0)), 0),
          )
          try {
            await crearVtaPendienteFacturar({
              nombre: cliente.name,
              clienteId: cliente.id,
              remitoId: id,
              importeTotal: importePendFacturar,
              lineas: remito.items.map((it) => ({
                productoId: it.productoId,
                precioUnitario: it.precioUnitario ?? 0,
                cantidad: it.cantidad,
                // Tipo de producto (CO / COM) del Maestro: se etiqueta en el subelemento pendiente.
                tipoMercaderia: it.tipo,
                // Rentabilidad según la lista del cliente: se guarda para reusarla al facturar.
                rentabilidad: it.rentabilidad,
                /* MISMA unidad de venta que se asienta en el subelemento del remito: es la que
                   después toma la línea de la factura (venta DIRECTA con entrega ANTERIOR). */
                um: it.um,
              })),
            })
          } catch {
            /* El registro de "Vtas Pends de Facturar" se crea best-effort. */
          }
        }
      }

      const { numeroHoja } = remitoHoja.imprenta
      await registrarRemito(id, {
        observaciones: remito.observaciones,
        hojaTalonarioId: remitoHoja.hojaId,
        numeroHoja,
      })
      await adjuntarPdfsRemito(id, remitoPdfs)
      dispatch({ type: 'emitirRemito' })

      /* Conciliación del remito: dos bulk PARALELAS y DESACOPLADAS —Bulk A crea el subítem de
         historial en "Pends de Entrega", con el número del remito; Bulk B acumula lo entregado en
         el subelemento de la Venta—. Sin await (fire-and-forget): no bloquea el cierre. El número
         ya se conoce —es el de la hoja—, así que no hay que esperar a que lo asigne el tablero. */
      void afectarEntregaAnterior(
        remito.items.map((it) => ({
          cantidad: it.cantidad,
          nombre: it.nombre,
          pendienteEntregaId: it.pendienteEntregaId,
          ventaSubitemId: it.subitemId,
        })),
        // El remito se linkea a nivel ítem de cada pendiente de entrega.
        id,
        `Nº${numeroHoja}`,
      ).catch(() => {
        /* La conciliación de entrega es best-effort: el remito ya quedó registrado. */
      })

      // Registrado con sus PDF: se cierra la operación y se reinicia la app.
      dispatch({ type: 'reset' })
    } catch {
      if (!activo.current) return
      /* Fallo de la API: lo comunica la ventana global de error de Monday. Acá sólo se libera el
         botón para poder reintentar. */
      setRegistrando(false)
      dispatch({ type: 'errorMonday', accion: 'registrar el remito' })
    }
  }

  /* Reemisión: el botón de emitir sigue habilitado, y unos PDF que quedaron viejos (se cambiaron
     datos en un paso anterior) se descartan solos. `firma` va guardada con los PDF. */
  const { firma, pedirEmision, modal: modalReemision } = useReemision('remito', emitido, () => void emitir())

  if (!cliente) return null

  return (
    <section className="view emision-v2 paso-layout">
      <PasoHeader
        pasos={pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)}
        actual={indiceDePaso('remito-emision', operacion, tipoVenta, tipoEntrega, remito.tipoEmision)}
      />
      <PasoTitulo
        numero={indiceDePaso('remito-emision', operacion, tipoVenta, tipoEntrega, remito.tipoEmision) + 1}
        titulo="Emitir y enviar remito"
        descripcion="Revisá el resumen del remito, emitilo y mandáselo a los contactos del cliente."
      />

      {/* Izquierda: el resumen con el botón de emisión. Derecha: el remito a generar en un
          desplegable y, debajo, el envío —mismo armado que el paso de factura—. */}
      <div className="emision-grid">
        <div className="emision-col">
          <ResumenRemitoEmision
            generando={estado === 'generando'}
            emitido={emitido}
            errorPdf={estado === 'error-pdf'}
            onEmitir={pedirEmision}
            talonarioNombre={talonario?.talonarioNombre}
            hojaNombre={talonario?.hojaNombre}
            bloqueado={validandoTalonario || talonarioError != null || !talonario}
          >
            {/* Siempre debajo de emitir: se habilita cuando los PDF ya están generados. El aviso de
                error va DEBAJO del botón, nunca entre él y el de emitir. */}
            {/* Un solo botón para los dos PDF: (2), y cada clic abre el siguiente —VENTA, después
                PREIMPRESO—. */}
            <VerImprimirPdf archivos={remitoPdfs ? [remitoPdfs.venta, remitoPdfs.preimpreso] : null} />
            {estado === 'error-pdf' && (
              <div className="pres-pdf-aviso" role="alert">
                <i className="fas fa-circle-exclamation" /> La app no está pudiendo generar los PDF del
                remito. Tocá el botón para reintentar; si vuelve a fallar, contactate con el soporte de
                TAP.
              </div>
            )}
          </ResumenRemitoEmision>
        </div>

        {/* Bajo `.factura-v2` para reutilizar el desplegable de comprobantes (clases `comp-*` y sus
            variables); se neutraliza el box de página del namespace para que encaje en la columna. */}
        <div className="factura-v2" style={{ padding: 0, maxWidth: 'none', margin: 0 }}>
          {/* El número es el de la hoja del talonario: la reservada, o la que se va a usar. */}
          <RemitoAGenerar
            numero={
              remitoHoja
                ? numeroRemito(remitoHoja.imprenta)
                : talonario
                  ? numeroRemito(talonario.imprenta)
                  : NRO_REMITO
            }
            items={remito.items}
          />
          {/* Por PDF emitido: uno nuevo es otro documento, y el envío arranca de cero. */}
          <EnviarDocumento key={`emision-${emisionNro}`} documento="remito" />
        </div>
      </div>

      <div className="footer-acts">
        <button
          type="button"
          className="btn-volver"
          onClick={() => dispatch({ type: 'goto', paso: 'remito-envio' })}
        >
          <i className="fas fa-arrow-left" /> Volver
        </button>
        {/* Registra el remito en Monday (ítem, subitems, hoja y los dos PDF) y cierra la operación.
            Pide los PDF EMITIDOS: son los archivos que se suben al remito. */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!remitoPdfs || registrando}
          title={remitoPdfs ? undefined : 'Emití el remito para poder registrarlo.'}
          onClick={() => void registrar()}
        >
          <i className="fas fa-flag-checkered" /> Registrar Remito
        </button>
      </div>

      {/* Tapa la pantalla mientras se `await`ea el registro en Monday. */}
      {registrando && (
        <ModalCargando
          titulo="Registrando remito..."
          detalle="Estamos registrando el remito en el sistema junto a sus productos y sus PDF. Espera unos segundos"
        />
      )}

      {/* La hoja asignada la tomó otro remito: hay que volver a emitir con la próxima. */}
      {hojaOcupada && (
        <AvisoModal titulo="El talonario asignado está ocupado" onClose={() => setHojaOcupada(null)}>
          La hoja {hojaOcupada.hojaNombre} del talonario {hojaOcupada.talonarioNombre}, con la que se
          emitió este remito, ya la usó otro remito. No se registró nada. Volvé a tocar "Emitir Remito":
          se va a generar con la próxima hoja disponible. Si ya enviaste el remito a los contactos,
          vas a tener que enviarlo de nuevo, porque cambia su número.
        </AvisoModal>
      )}

      {/* Bloqueo por talonario: sin talonario en uso o sin hojas disponibles no se puede emitir. */}
      {avisoTalonario && talonarioError && (
        <AvisoModal
          titulo={
            talonarioError === 'sin-talonario'
              ? 'No hay talonarios disponibles'
              : 'Sin hoja de talonario asignada'
          }
          onClose={() => setAvisoTalonario(false)}
        >
          {talonarioError === 'sin-talonario'
            ? 'No hay ningún talonario en uso para numerar el remito. Activá un talonario en Monday para poder emitir.'
            : 'El talonario actual no posee hojas disponibles.'}
        </AvisoModal>
      )}

      {/* Sin productos o un registro incompleto: se avisa en el mismo modal. */}
      {estado === 'error' && error && (
        <AvisoModal
          titulo="No se pudo completar el remito"
          onClose={() => {
            setError(null)
            setEstado('idle')
          }}
        >
          {error}
        </AvisoModal>
      )}

      {bloqueo.modal}
      {modalReemision}
    </section>
  )
}
