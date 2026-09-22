import { useEffect, useState } from 'react'
import { AvisoModal } from '@/components/ui/AvisoModal'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { indiceDePaso, pasoDeEmision, pasoPrevioAActividad, pasosDe } from '@/lib/pasos'
import { actividadesSinAsignarEnCache, getActividadesSinAsignar } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { ActividadListada } from '@/types'
import { TablaActividades } from './TablaActividades'

/** Cómo se nombra la etapa siguiente en el footer, según qué documento se va a emitir. */
const SIGUIENTE: Record<string, string> = {
  PRESUPUESTAR: 'Emitir y Enviar el Presupuesto',
  VENTA: 'Emitir y Enviar la Factura',
  'VENTA PROFORMA': 'Emitir y Enviar la Factura',
}

/**
 * Cómo se nombra el documento DENTRO de la pregunta, según la operación. La pregunta es la misma en
 * las tres, y nombrar mal el documento —"al presupuesto" en una venta— haría dudar de a qué se está
 * contestando.
 */
const DOCUMENTO: Record<string, string> = {
  PRESUPUESTAR: 'al presupuesto',
  VENTA: 'a la venta',
  'VENTA PROFORMA': 'a la venta',
}

/**
 * Etapa "Registrar Actividad" de la VENTA, la VENTA PROFORMA y el PRESUPUESTO: a qué gestión
 * comercial responde el documento que se está por emitir.
 *
 * Acá NO se carga una actividad nueva: se ELIGE entre las que ya están en el tablero y todavía no
 * se asociaron a ningún documento (ver `getActividadesSinAsignar`). Al emitir, las elegidas quedan
 * enlazadas al presupuesto o a la venta, y con eso dejan de ofrecerse en la próxima operación: una
 * gestión rinde UN documento. Para cargar una gestión nueva está la operación REGISTRO DE
 * ACTIVIDADES.
 *
 * La etapa sólo aparece cuando la operación es la que origina la gestión (ver `registraActividad`):
 * el presupuesto siempre, y la venta sólo cuando es DIRECTA —si viene de un presupuesto previo, la
 * actividad ya quedó asociada a ese presupuesto—.
 *
 * La etapa abre con UNA pregunta —"¿Querés asociar actividades…?"— contestada que NO, y de ahí sale
 * todo lo demás:
 *   · NO: no hay nada que hacer. La lista ni se dibuja, a Monday NO se le pregunta nada —la
 *     consulta salía siempre, incluso para quien no iba a asociar ninguna— y "Continuar" pasa
 *     derecho. Asociar una gestión sigue siendo OPCIONAL: el documento puede no tener todavía, en
 *     el tablero, la que lo originó, y eso no puede frenar la emisión.
 *   · SÍ: recién ahí se traen las actividades, y tildar AL MENOS UNA pasa a ser obligatorio. El que
 *     contestó que sí y no tildó ninguna no está eligiendo no asociar: se quedó a mitad de camino,
 *     y el botón lo frena con una ventana en vez de emitir un documento sin la gestión que el
 *     propio usuario dijo tener.
 */
export function VentaActividadView() {
  const {
    operacion,
    tipoVenta,
    tipoEntrega,
    remito,
    proformaTipoVenta,
    cliente,
    asociarActividades,
    actividadesDocumento,
    vendedor,
  } = useApp()
  const dispatch = useDispatch()
  /* Si la etapa ya se visitó en esta operación, la lista arranca puesta y el "cargando" ni se
     dibuja: el resultado estaba, y un spinner de un frame contra algo ya resuelto es un parpadeo
     gratis cada vez que se va y se vuelve con el stepper. */
  const cacheadas = cliente ? actividadesSinAsignarEnCache(cliente.id) : null
  const [actividades, setActividades] = useState<ActividadListada[]>(cacheadas ?? [])
  const [cargando, setCargando] = useState(false)
  /** Se quiso avanzar con la pregunta en SÍ y sin ninguna actividad tildada. */
  const [faltaActividad, setFaltaActividad] = useState(false)

  /* Las actividades se traen al CONTESTAR QUE SÍ, no al entrar a la etapa: quien deja la pregunta
     en NO no necesita la lista, y pedírsela a Monday igual es una consulta al tablero por una tabla
     que no se va a dibujar. Se piden las del CLIENTE de la operación y cargadas a mano (ver
     `getActividadesSinAsignar`), y la consulta está cacheada por cliente, así que ir y volver con
     el stepper —o contestar que no y que sí de nuevo— no le pega otra vez; la caché se vacía al
     cambiar de operación. */
  useEffect(() => {
    if (!asociarActividades || !cliente) return
    const clienteId = cliente.id
    let vivo = true
    setCargando(actividadesSinAsignarEnCache(clienteId) === null)
    getActividadesSinAsignar(clienteId)
      .then((as) => {
        if (!vivo) return
        setActividades(as)
        setCargando(false)
      })
      .catch(() => {
        if (!vivo) return
        setActividades([])
        setCargando(false)
        dispatch({ type: 'errorMonday', accion: 'traer las actividades del tablero' })
      })
    return () => {
      vivo = false
    }
  }, [asociarActividades, cliente, dispatch])

  const numero = indiceDePaso(
    'venta-actividad',
    operacion,
    tipoVenta,
    tipoEntrega,
    remito.tipoEmision,
    proformaTipoVenta,
  )
  const siguiente = SIGUIENTE[operacion ?? 'PRESUPUESTAR']
  const documento = DOCUMENTO[operacion ?? 'PRESUPUESTAR']

  /* Cambiar la respuesta baja el aviso: lo que reclamaba ya no aplica —con NO no falta nada, y con
     SÍ el usuario recién ahora tiene la lista a la vista para tildar—. */
  const responder = (value: boolean) => {
    setFaltaActividad(false)
    dispatch({ type: 'setAsociarActividades', value })
  }

  const continuar = () => {
    // Contestó que sí y no tildó ninguna: se frena acá y se explica, no se emite a medias.
    if (asociarActividades && actividadesDocumento.length === 0) {
      setFaltaActividad(true)
      return
    }
    dispatch({ type: 'goto', paso: pasoDeEmision(operacion) })
  }

  if (!vendedor) return null

  const pregunta = `¿Querés asociar actividades ${documento}?`

  return (
    <section className="view actividad-v2 paso-layout">
      <PasoHeader
        pasos={pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision, proformaTipoVenta)}
        actual={numero}
      />

      <div className="paso-body">
        <PasoTitulo
          numero={numero + 1}
          titulo="Registrar actividad"
          descripcion="Indicá si este documento responde a una actividad comercial ya cargada en el tablero. Sólo se listan las que todavía no están asociadas a una venta o a un presupuesto."
        />

        <TablaActividades
          titulo={pregunta}
          actividades={actividades}
          elegidas={actividadesDocumento.map((a) => a.id)}
          cargando={cargando}
          onToggle={(act) => {
            setFaltaActividad(false)
            dispatch({ type: 'toggleActividadDocumento', actividad: act })
          }}
          /* Desplegada, la caja reclama la actividad en rojo hasta que haya una tildada: lo
             opcional es la PREGUNTA, no la lista. */
          colapsada={!asociarActividades}
          accion={
            <div className="act-asoc-toggle" role="radiogroup" aria-label={pregunta}>
              <button
                type="button"
                className={`act-asoc-btn ${asociarActividades ? 'is-on' : ''}`.trim()}
                role="radio"
                aria-checked={asociarActividades}
                onClick={() => responder(true)}
              >
                SÍ
              </button>
              <button
                type="button"
                className={`act-asoc-btn ${asociarActividades ? '' : 'is-on'}`.trim()}
                role="radio"
                aria-checked={!asociarActividades}
                onClick={() => responder(false)}
              >
                NO
              </button>
            </div>
          }
        />

        <div className="actions-footer">
          <button
            type="button"
            className="btn-volver"
            onClick={() =>
              dispatch({
                type: 'goto',
                paso: pasoPrevioAActividad(operacion, tipoVenta, tipoEntrega),
              })
            }
          >
            <i className="fas fa-arrow-left" /> Volver
          </button>
          {/* Con la pregunta en NO no se valida nada: no asociar es una respuesta válida. Con SÍ, lo
              único que puede faltar es la actividad, y de eso avisa la ventana. */}
          <button type="button" className="btn-continuar" onClick={continuar}>
            Continuar a {siguiente} <i className="fas fa-arrow-right" />
          </button>
        </div>
      </div>

      {faltaActividad && (
        <AvisoModal titulo="Falta elegir la actividad" onClose={() => setFaltaActividad(false)}>
          Contestaste que <strong>SÍ</strong> querés asociar actividades {documento}, pero no
          tildaste ninguna de la lista. Elegí al menos una, o cambiá la respuesta a <strong>NO</strong>{' '}
          para continuar sin asociar ninguna.
        </AvisoModal>
      )}
    </section>
  )
}
