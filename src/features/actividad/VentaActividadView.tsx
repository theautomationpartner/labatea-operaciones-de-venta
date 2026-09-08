import { useEffect, useState } from 'react'
import { PasoHeader, PasoTitulo } from '@/features/shared/PasoHeader'
import { indiceDePaso, pasoDeEmision, pasoPrevioAActividad, pasosDe } from '@/lib/pasos'
import { actividadesSinAsignarEnCache, getActividadesSinAsignar } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'
import type { ActividadListada } from '@/types'
import { TablaActividades } from './TablaActividades'

/** Cómo se nombra la etapa siguiente en el footer, según qué documento se va a emitir. */
const SIGUIENTE: Record<string, string> = {
  PRESUPUESTAR: 'Emitir y Enviar el presupuesto',
  VENTA: 'Emitir y Enviar la factura',
  'VENTA PROFORMA': 'Emitir y Enviar la factura',
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
 * Elegir una es OPCIONAL en las tres: el documento puede no tener todavía, en el tablero, la
 * gestión que lo originó, y eso no puede frenar la emisión. El botón "Continuar" no valida nada
 * acá —no hay ventana de "te falta esto"— porque no hay ningún dato obligatorio que pedir.
 */
export function VentaActividadView() {
  const { operacion, tipoVenta, tipoEntrega, remito, proformaTipoVenta, actividadesDocumento, vendedor } =
    useApp()
  const dispatch = useDispatch()
  /* Si la etapa ya se visitó en esta operación, la lista arranca puesta y el "cargando" ni se
     dibuja: el resultado estaba, y un spinner de un frame contra algo ya resuelto es un parpadeo
     gratis cada vez que se va y se vuelve con el stepper. */
  const cacheadas = actividadesSinAsignarEnCache()
  const [actividades, setActividades] = useState<ActividadListada[]>(cacheadas ?? [])
  const [cargando, setCargando] = useState(cacheadas === null)

  /* Las actividades sin asociar se traen al entrar a la etapa, no antes: recién acá hacen falta.
     La consulta está cacheada (ver `getActividadesSinAsignar`), así que volver a esta etapa no le
     pega de nuevo a Monday; la caché se vacía al cambiar de operación. */
  useEffect(() => {
    let vivo = true
    setCargando(actividadesSinAsignarEnCache() === null)
    getActividadesSinAsignar()
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
  }, [dispatch])

  const numero = indiceDePaso(
    'venta-actividad',
    operacion,
    tipoVenta,
    tipoEntrega,
    remito.tipoEmision,
    proformaTipoVenta,
  )
  const siguiente = SIGUIENTE[operacion ?? 'PRESUPUESTAR']

  if (!vendedor) return null

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
          descripcion="Selecciona la actividad comercial que dio origen a este documento (opcional). Sólo se listan las que todavía no están asociadas a una venta o a un presupuesto."
        />

        <TablaActividades
          actividades={actividades}
          elegidas={actividadesDocumento.map((a) => a.id)}
          cargando={cargando}
          onToggle={(act) => dispatch({ type: 'toggleActividadDocumento', actividad: act })}
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
          {/* Sin validación: elegir actividad es opcional, así que no hay nada que pueda faltar. */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => dispatch({ type: 'goto', paso: pasoDeEmision(operacion) })}
          >
            Continuar a {siguiente} <i className="fas fa-arrow-right" />
          </button>
        </div>
      </div>
    </section>
  )
}
