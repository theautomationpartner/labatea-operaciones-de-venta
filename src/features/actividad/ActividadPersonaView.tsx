import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { BuscarCliente, type BusquedaEstado } from '@/features/cliente/BuscarCliente'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { indiceDePaso, pasosDe, rotuloEtapaActividad } from '@/lib/pasos'
import { getContactosCliente } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { Contacto } from '@/types'
import { PersonaElegida } from './PersonaElegida'
import { SelectorTipoOperacion } from './SelectorTipoOperacion'
import { TablaContactos } from './TablaContactos'
import { TablaContactosElegidos } from './TablaContactosElegidos'

/**
 * REGISTRO DE ACTIVIDADES · etapa 1. A qué Persona —o Personas— involucra la gestión y, cuando se
 * viene a cargar una actividad nueva, con cuáles de sus contactos.
 *
 * Los contactos se piden SÓLO para REGISTRAR NUEVA ACTIVIDAD: son los que se asientan en el ítem
 * que se va a crear. COMPLETAR ACTIVIDAD PENDIENTE no crea nada —cierra gestiones que ya existen,
 * con la gente que ya tienen cargada—, así que ahí la etapa pide únicamente el cliente y sus
 * pendientes se listan enteras.
 *
 * Va PRIMERA porque la etapa 2 depende de lo que se elija acá: con esta gente se arma la actividad
 * nueva, y con esta gente se busca qué tiene pendiente en el tablero (ver `ActividadView`). Por eso
 * el "Tipo de Operación" también se contesta acá: a quién y para qué son la misma decisión.
 *
 * Los contactos se ACUMULAN entre Personas: se busca un cliente, se tildan sus contactos, se
 * CONFIRMAN —y con eso pasan a la tabla de seleccionados—, se busca otro y se suman los suyos. Cada
 * contacto viaja con su Persona pegada (`ContactoElegido`), que es lo que después permite asentar
 * la actividad a todas las involucradas.
 *
 * Los tildados son de la Persona en pantalla y viven en estado LOCAL: son un borrador, y lo que
 * cuenta es lo confirmado. Por eso se vacían al cambiar de Persona —los contactos son otros— y por
 * eso, si quedan tildados sin confirmar, "Continuar" lo dice en vez de perderlos en silencio.
 *
 * El buscador es el MISMO del resto de la app (`BuscarCliente`): por código, nombre o CUIT, con
 * las mismas reglas de coincidencia. Se reutiliza tal cual —no se clona— para que un cambio en
 * cómo se busca una Persona valga en todas las operaciones a la vez.
 */
export function ActividadPersonaView() {
  const { operacion, tipoVenta, tipoEntrega, remito, actividad, cliente, vendedor } = useApp()
  const dispatch = useDispatch()
  const [estadoBusqueda, setEstadoBusqueda] = useState<BusquedaEstado>('idle')
  const [avisoNoEncontrado, setAvisoNoEncontrado] = useState(false)
  // Qué falta para poder avanzar. Se arma al intentar continuar, no mientras se elige.
  const [faltantes, setFaltantes] = useState<string[] | null>(null)
  /* Los contactos traídos, ATADOS a la Persona de la que salieron. Guardarlos sueltos dejaba que
     los del cliente anterior se dibujaran un frame después de buscar otro —el estado sobrevive al
     cambio de cliente y el efecto corre recién después de pintar—: acá la lista es de ESTE cliente
     o no es de nadie. */
  const [cargados, setCargados] = useState<{ clienteId: string; lista: Contacto[] }>({
    clienteId: '',
    lista: [],
  })
  /* Los tildados de la Persona en pantalla, todavía sin confirmar. Local a propósito: es un
     borrador de esta pantalla, no un dato de la operación. */
  const [tildados, setTildados] = useState<string[]>([])
  /* Los que se confirmaron SIN salir de esta Persona. Al confirmarlos se van de la lista de arriba
     —ya están en la tabla de abajo, repetirlos arriba es mostrar dos veces lo mismo—, y por eso hay
     que recordarlos: es lo que los distingue de los que YA venían elegidos cuando se buscó a esta
     Persona, que sí se muestran, marcados y bloqueados. */
  const [confirmadosAhora, setConfirmadosAhora] = useState<string[]>([])

  useEffect(() => {
    if (estadoBusqueda === 'no-encontrado') setAvisoNoEncontrado(true)
  }, [estadoBusqueda])
  /* Completar pendientes no pide contactos: la etapa se reduce a elegir la firma. Lo que ya se
     hubiera confirmado NO se borra —se puede volver a "REGISTRAR NUEVA ACTIVIDAD" y ahí sí sirve—,
     simplemente no se muestra ni se reclama. */
  const soloCliente = actividad.tipoOperacion === 'COMPLETAR ACTIVIDAD PENDIENTE'

  /* Contactos de la Persona elegida. La consulta está cacheada por persona (ver
     `getContactosCliente`), así que volver con el stepper no vuelve a pegarle a Monday. El
     documento —"Actividad"— sólo se usa para clasificar quién acepta recibirlo, algo que acá no
     rige: la tabla los muestra a todos. */
  useEffect(() => {
    /* Otra Persona, otros contactos: ni el borrador ni lo confirmado acá aplican a la lista nueva.
       Al volver a buscar a la MISMA Persona también se limpia, y con eso lo que se le confirmó
       vuelve a aparecer en su lista, ya marcado: es una búsqueda nueva, no la misma visita. */
    setTildados([])
    setConfirmadosAhora([])
    // Completar pendientes no muestra los contactos: no hay por qué ir a buscarlos.
    if (!cliente || soloCliente) return
    let vivo = true
    const id = cliente.id
    getContactosCliente(id, 'Actividad')
      .then((cs) => {
        if (vivo) setCargados({ clienteId: id, lista: cs })
      })
      .catch(() => {
        if (!vivo) return
        // Se marca como resuelta igual: si no, la tabla quedaría buscando para siempre.
        setCargados({ clienteId: id, lista: [] })
        dispatch({ type: 'errorMonday', accion: 'traer los contactos de la Persona' })
      })
    return () => {
      vivo = false
    }
  }, [cliente, soloCliente, dispatch])

  /* La lista es SIEMPRE la del cliente en pantalla: mientras la suya no esté resuelta, está
     vacía y en "buscando". Nunca se ven los contactos de otra Persona, ni por un frame. */
  const traidos = cargados.clienteId === cliente?.id ? cargados.lista : []
  const cargandoContactos = !!cliente && cargados.clienteId !== cliente.id
  /* Lo confirmado en esta visita se TRASLADA: sale de arriba y queda en la tabla de abajo. Los que
     ya estaban elegidos de antes se quedan en la lista, marcados (ver `TablaContactos`). */
  const contactosDelCliente = traidos.filter(
    (c) => !confirmadosAhora.includes(c.itemId as string),
  )

  const numero = indiceDePaso(
    'actividad-persona',
    operacion,
    tipoVenta,
    tipoEntrega,
    remito.tipoEmision,
  )


  /* Qué pide la etapa. El tipo de operación, siempre —sin él la etapa 2 no sabría qué desplegar—;
     y después, según la rama: completar pendientes pide la firma, registrar una nueva pide además
     los contactos con los que se hizo la gestión. */
  const continuar = () => {
    const faltan: string[] = []
    if (soloCliente) {
      if (!cliente) faltan.push('Persona a la que se le completan las actividades pendientes')
    } else {
      if (actividad.contactos.length === 0) {
        faltan.push('Contactos con los que se hizo (o se va a hacer) la actividad')
      }
      /* Tildar no es elegir: lo que no se confirmó no está en la selección y se perdería al
         avanzar. Se avisa en vez de confirmarlo solo, que sería decidir por el usuario. */
      if (tildados.length > 0) {
        faltan.push('Confirmá los contactos que tildaste, o destildalos para dejarlos afuera')
      }
    }
    if (!actividad.tipoOperacion) faltan.push('Tipo de Operación')
    if (faltan.length > 0) {
      // Se señala en rojo el selector que falta, además de nombrarlo en la ventana.
      dispatch({ type: 'intentoAvanzar' })
      setFaltantes(faltan)
      return
    }
    dispatch({ type: 'goto', paso: 'actividad' })
  }

  const personaLista = estadoBusqueda === 'idle' && !!cliente

  /** Pasa los tildados a la selección confirmada, con la Persona en pantalla pegada a cada uno. */
  const confirmar = () => {
    if (!cliente || tildados.length === 0) return
    dispatch({
      type: 'agregarContactosActividad',
      contactos: traidos
        .filter((c) => c.itemId && tildados.includes(c.itemId))
        .map((c) => ({
          itemId: c.itemId as string,
          nombre: c.name,
          telefono: c.phone,
          email: c.email,
          personaId: cliente.id,
          personaNombre: cliente.name,
        })),
    })
    setConfirmadosAhora((ids) => [...ids, ...tildados])
    setTildados([])
  }
  /* Por qué todavía no se puede avanzar. Para registrar una nueva alcanza con que haya UN contacto
     confirmado —de la Persona que sea—: cada uno trae la suya, y la actividad se asienta a todas.
     Para completar pendientes, con la firma basta. */
  const motivoBloqueo = soloCliente
    ? personaLista
      ? undefined
      : 'Buscá la Persona cuyas actividades pendientes vas a completar'
    : actividad.contactos.length === 0
      ? personaLista
        ? 'Tildá al menos un contacto y confirmalo para poder continuar'
        : 'Buscá una Persona y confirmá sus contactos para poder continuar'
      : tildados.length > 0
        ? 'Confirmá los contactos que tildaste, o destildalos'
        : !actividad.tipoOperacion
          ? 'Elegí el tipo de operación para poder continuar'
          : undefined

  if (!vendedor) return null

  return (
    <section className="view actividad-v2 paso-layout">
      <PasoHeader
        pasos={pasosDe(
          operacion,
          tipoVenta,
          tipoEntrega,
          remito.tipoEmision,
          null,
          actividad.tipoOperacion,
        )}
        actual={numero}
      />

      <div className="paso-body">
        <PasoTitulo
          numero={numero + 1}
          titulo="Seleccionar Persona"
          descripcion={
            soloCliente
              ? 'Busca la firma cuyas actividades pendientes vas a completar'
              : 'Busca la firma a la que se le asienta la actividad y selecciona los contactos involucrados'
          }
        />

        <SelectorTipoOperacion />

        {/* Buscador y ficha son UN control, no dos tarjetas sueltas: se busca arriba y el
            resultado aparece abajo, dentro de la misma caja y separado por un filete. Con el
            margen del medio parecían dos cosas sin relación entre sí.

            El buscador se monta bajo `.cliente-v2` a propósito: sus estilos —campo, botón, lista
            de coincidencias— viven namespaceados ahí, y clonarlos acá haría que el mismo buscador
            se viera distinto según la operación. El box de página del namespace se neutraliza con
            `.act-buscador`, igual que hace la emisión con `.factura-v2`. */}
        <div className="act-persona-caja">
          <div className="cliente-v2 act-buscador">
            <div className="toolbar-wrapper">
              <div className="card unified-toolbar">
                <BuscarCliente estado={estadoBusqueda} onEstado={setEstadoBusqueda} />
              </div>
            </div>
          </div>

          <PersonaElegida
            persona={estadoBusqueda === 'idle' ? cliente : null}
            cargando={estadoBusqueda === 'buscando'}
          />
        </div>

{/* Arriba, los contactos de la Persona que está en pantalla: se tildan y se confirman.
            Abajo, la selección de verdad, que acumula los de todas las Personas. Las dos son de la
            rama que CREA la actividad; completar pendientes no las necesita. */}
        {!soloCliente && (
          <>
          <TablaContactos
            contactos={contactosDelCliente}
            tildados={tildados}
            yaElegidos={actividad.contactos.map((c) => c.itemId)}
            cargando={cargandoContactos}
            sinPersona={!personaLista}
            /* La Persona SÍ tiene contactos, pero ya están todos en la selección: es distinto de no
               tener ninguno cargado en el tablero, y la tabla lo dice distinto. */
            todosElegidos={traidos.length > 0 && contactosDelCliente.length === 0}
            faltan={actividad.contactos.length === 0}
            onToggle={(c) =>
              setTildados((ids) =>
                ids.includes(c.itemId as string)
                  ? ids.filter((id) => id !== c.itemId)
                  : [...ids, c.itemId as string],
              )
            }
            onTodos={(elegibles) => setTildados(elegibles.map((c) => c.itemId as string))}
            onConfirmar={confirmar}
          />

          <TablaContactosElegidos
            contactos={actividad.contactos}
            onQuitar={(itemId) => dispatch({ type: 'quitarContactoActividad', itemId })}
          />
          </>
        )}

        <div className="actions-footer">
          {motivoBloqueo ? (
            <span className="paso-siguiente paso-siguiente--bloqueo">
              <i className="fas fa-circle-exclamation" /> {motivoBloqueo}
            </span>
          ) : (
            <span className="paso-siguiente">
              <i className="fas fa-arrow-turn-up paso-siguiente-ic" /> Siguiente: qué se hace con
              esta gente, una actividad nueva o cerrar las pendientes
            </span>
          )}
          {/* El botón nunca se apaga: al intentar avanzar, la ventana dice qué falta. */}
          <button type="button" className="btn btn-primary" onClick={continuar}>
            Continuar a {rotuloEtapaActividad(actividad.tipoOperacion)}{' '}
            <i className="fas fa-arrow-right" />
          </button>
        </div>
      </div>

      {avisoNoEncontrado && (
        <AvisoModal titulo="Persona no encontrada" onClose={() => setAvisoNoEncontrado(false)}>
          La Persona que buscaste no existe o está inactiva en el sistema.
        </AvisoModal>
      )}

      {faltantes && (
        <AvisoModal
          titulo="Faltan datos para continuar"
          faltantes={faltantes}
          onClose={() => setFaltantes(null)}
        >
          No se puede pasar a la actividad hasta completar esto:
        </AvisoModal>
      )}
    </section>
  )
}
