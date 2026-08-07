import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { clienteBloqueado, MENSAJE_CLIENTE_BLOQUEADO } from '@/lib/credito'
import { pasoDeProductos, pasosDe } from '@/lib/pasos'
import { faltantesCliente } from '@/lib/validaciones'
import { useApp, useDispatch } from '@/state/hooks'
import { BuscarCliente, type BusquedaEstado } from './BuscarCliente'
import { ClienteFicha } from './ClienteFicha'
import { DatosPresupuesto } from './DatosPresupuesto'
import { RemitoConfig } from './RemitoConfig'
import { VentaConfig } from './VentaConfig'

/** Qué viene después de confirmar el cliente, para anticiparlo en el footer. */
const SIGUIENTE_PASO: Record<string, string> = {
  PRESUPUESTAR: 'Selección de productos',
  'VENTA': 'Carga de productos',
  'VENTA PROFORMA': 'Carga de productos',
  REMITO: 'Carga de productos',
}

/** Bajada del paso, según lo que se está por armar. */
const SUBTITULO_PASO: Record<string, string> = {
  PRESUPUESTAR: 'Buscá y validá la información del cliente para iniciar el presupuesto.',
  'VENTA': 'Buscá y validá la información del cliente para iniciar la venta.',
  'VENTA PROFORMA': 'Buscá y validá la información del cliente para iniciar la venta con proforma.',
  REMITO: 'Buscá y validá la información del cliente para iniciar el remito.',
}

/** Paso 1: vendedor asignado + búsqueda y validación del cliente. */
export function ClienteView() {
  const { operacion, tipoVenta, tipoEntrega, vendedor, cliente, remito } = useApp()
  const dispatch = useDispatch()
  // Estado de la búsqueda: gobierna qué se muestra en el lugar de la ficha del cliente.
  const [estadoBusqueda, setEstadoBusqueda] = useState<BusquedaEstado>('idle')
  // Aviso emergente cuando falta la lista de precio del cliente.
  const [avisoLista, setAvisoLista] = useState(false)
  // Aviso emergente al intentar operar con un cliente bloqueado.
  const [avisoBloqueado, setAvisoBloqueado] = useState(false)
  // Aviso emergente al intentar avanzar sin configurar la operación.
  const [avisoConfig, setAvisoConfig] = useState(false)
  // Aviso emergente al intentar avanzar sin un cliente cargado.
  const [avisoSinCliente, setAvisoSinCliente] = useState(false)
  // Ventana emergente cuando la búsqueda no encuentra al cliente: es el ÚNICO aviso de ese caso.
  const [avisoNoEncontrado, setAvisoNoEncontrado] = useState(false)
  // Cada vez que la búsqueda termina en "no encontrado", se abre la ventana emergente.
  useEffect(() => {
    if (estadoBusqueda === 'no-encontrado') setAvisoNoEncontrado(true)
  }, [estadoBusqueda])
  const esPresupuesto = operacion === 'PRESUPUESTAR'
  const esVenta = operacion === 'VENTA'
  const esRemito = operacion === 'REMITO'
  const bloqueado = clienteBloqueado(cliente)
  // Sin lista de precio no hay precios que traer; sin condición fiscal no se sabe si llevan IVA.
  const faltantes = cliente ? faltantesCliente(cliente) : []
  const soloFaltaLista = faltantes.length === 1 && faltantes[0] === 'Lista de precio'
  // Cada operación necesita su configuración antes de armar los productos.
  const faltaConfigurar =
    (esVenta && (!tipoVenta || !tipoEntrega)) || (esRemito && !remito.tipoEmision)

  const continuar = () => {
    /* Sin un cliente confirmado el botón sigue a la vista: se avisa que hace falta cargarlo. */
    if (estadoBusqueda !== 'idle' || !cliente) {
      setAvisoSinCliente(true)
      return
    }
    /* Con el cliente bloqueado el botón sigue activo a propósito: la ventana explica por qué
       no se puede seguir, en vez de dejar un botón muerto sin motivo. */
    if (bloqueado) {
      setAvisoBloqueado(true)
      return
    }
    /* La configuración de la operación tampoco apaga el botón: se explica qué falta elegir
       en vez de dejar al usuario adivinando por qué no avanza. */
    if (faltaConfigurar) {
      setAvisoConfig(true)
      return
    }
    if (faltantes.length > 0) {
      setAvisoLista(true)
      return
    }
    dispatch({ type: 'goto', paso: pasoDeProductos(operacion, tipoVenta, tipoEntrega) })
  }

  /* Avance habilitado sólo con el cliente ya confirmado y la configuración de la operación
     completa. El motivo se muestra en el footer. */
  const clienteListo = estadoBusqueda === 'idle' && !!cliente
  const motivoBloqueo = !clienteListo
    ? 'Buscá y confirmá un cliente para continuar'
    : bloqueado
      ? 'Cliente bloqueado: no se puede operar'
      : faltaConfigurar
        ? 'Completá la configuración de la operación'
        : undefined
  // Ni la falta de cliente, ni el bloqueo, ni la configuración pendiente apagan el botón: queda
  // siempre activo y, al intentarlo, una ventana dice exactamente qué falta.
  const puedeContinuar = !motivoBloqueo || bloqueado || faltaConfigurar || !clienteListo

  /** Qué eligió a medias el usuario, para nombrarlo en el aviso. */
  const configFaltante = [
    esVenta && !tipoVenta ? 'Tipo de venta' : null,
    esVenta && !tipoEntrega ? 'Tipo de entrega' : null,
    esRemito && !remito.tipoEmision ? 'Tipo de emisión del remito' : null,
  ].filter((x): x is string => x !== null)

  if (!vendedor) return null

  return (
    <section className="view cliente-v2 paso-layout">
      {/* ZONA 1 · contexto de la operación y navegación, siempre a la vista. */}
      <PasoHeader
        pasos={pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)}
        actual={0}
      />

      {/* ZONA 2 · el trabajo del paso: buscar y validar al cliente. */}
      <div className="paso-body">
        <PasoTitulo
          numero={1}
          titulo="Seleccionar cliente"
          descripcion={SUBTITULO_PASO[operacion ?? 'PRESUPUESTAR']}
        />

      {esVenta && <VentaConfig />}
      {esRemito && <RemitoConfig />}

      {/* Vendedor y buscador de cliente en un mismo box, separados por un filete. */}
      <div className="toolbar-wrapper">
        {/* Sólo el buscador: el vendedor de la operación ya se ve —y se cambia— en el selector
            del encabezado, así que repetirlo acá no aportaba nada. */}
        <div className="card unified-toolbar">
          <BuscarCliente estado={estadoBusqueda} onEstado={setEstadoBusqueda} />
        </div>
      </div>

      {/* Ni el cliente no encontrado ni el fallo de la API tienen cartel en línea: los dos se
          avisan por ventana emergente (el segundo, desde `ModalErrorMonday`). */}

      {/* La ficha del cliente se muestra SIEMPRE: skeleton mientras no hay cliente o se consulta,
          y se rellena con los datos reales al resolver la búsqueda. */}
      <ClienteFicha
        cliente={estadoBusqueda === 'idle' ? cliente : null}
        cargando={estadoBusqueda === 'buscando'}
      />

      {/* Datos del presupuesto: son de la OPERACIÓN, no del cliente, así que se muestran SIEMPRE de
          forma fija, debajo de la card del cliente, sin importar el estado de la búsqueda. */}
      {esPresupuesto && <DatosPresupuesto />}

      {/* El avance queda SIEMPRE a la vista, haya o no cliente: si falta, la ventana lo explica al
          hacer click, en vez de esconder o apagar el botón. */}
      <div className="actions-footer">
        <span className={`paso-siguiente ${motivoBloqueo ? 'paso-siguiente--bloqueo' : ''}`}>
          {motivoBloqueo ? (
            <>
              <i className="fas fa-circle-exclamation" /> {motivoBloqueo}
            </>
          ) : (
            <>
              <i className="fas fa-arrow-turn-up paso-siguiente-ic" /> Siguiente:{' '}
              {SIGUIENTE_PASO[operacion ?? 'PRESUPUESTAR']}
            </>
          )}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!puedeContinuar}
          onClick={continuar}
        >
          {/* Template uniforme: "Continuar a [ETAPA]" con el nombre del paso siguiente. */}
          Continuar a {SIGUIENTE_PASO[operacion ?? 'PRESUPUESTAR']}{' '}
          <i className="fas fa-arrow-right" />
        </button>
      </div>
      </div>

      {/* Sin cliente cargado no se puede avanzar: se explica al intentarlo. */}
      {avisoSinCliente && (
        <AvisoModal titulo="Falta cargar un cliente" onClose={() => setAvisoSinCliente(false)}>
          Para continuar tenés que buscar y cargar un cliente. Usá el buscador de arriba para
          seleccionarlo y volvé a intentar.
        </AvisoModal>
      )}

      {/* Cliente no encontrado: la ventana es el único aviso, no hay cartel en línea. */}
      {avisoNoEncontrado && (
        <AvisoModal titulo="Cliente no encontrado" onClose={() => setAvisoNoEncontrado(false)}>
          El cliente que buscó no existe o está inactivo en el sistema.
        </AvisoModal>
      )}

      {/* La operación no está configurada: sin eso no se sabe qué productos ofrecer. */}
      {avisoConfig && (
        <AvisoModal
          titulo="Falta configurar la operación"
          faltantes={configFaltante}
          onClose={() => setAvisoConfig(false)}
        >
          {esRemito ? (
            <>
              Para continuar tenés que indicar el tipo de emisión del remito. De esa elección
              depende de qué ventas se toman los productos a entregar.
            </>
          ) : (
            <>Para continuar tenés que seleccionar el tipo de venta y el tipo de entrega.</>
          )}
        </AvisoModal>
      )}

      {/* Cliente bloqueado en el board: no puede usarse en el sistema. */}
      {avisoBloqueado && (
        <AvisoModal titulo="Cliente bloqueado" onClose={() => setAvisoBloqueado(false)}>
          {MENSAJE_CLIENTE_BLOQUEADO}
        </AvisoModal>
      )}

      {/* Datos del cliente sin los que no se puede armar la operación. */}
      {avisoLista && cliente && (
        <AvisoModal
          titulo={
            soloFaltaLista ? 'Falta la lista de precio' : 'Faltan datos del cliente'
          }
          faltantes={soloFaltaLista ? undefined : faltantes}
          onClose={() => setAvisoLista(false)}
        >
          {soloFaltaLista ? (
            <>
              No se puede continuar con la selección de productos porque el cliente no tiene su
              lista de precio asignada. Por favor, asigná una lista de precio al cliente y volvé a
              reintentar.
            </>
          ) : (
            <>
              No se puede continuar con la selección de productos porque a{' '}
              <strong>{cliente.name}</strong> le faltan datos en el sistema. Completalos y volvé a
              reintentar.
            </>
          )}
        </AvisoModal>
      )}
    </section>
  )
}
