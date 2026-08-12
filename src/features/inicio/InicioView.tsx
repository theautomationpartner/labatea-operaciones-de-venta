import { PasoHeader } from '@/features/shared/PasoHeader'
import { getProximoNroPresupuesto } from '@/services/monday'
import { useApp, useDispatch } from '@/state/hooks'

/** Paso 0: elegir tipo de operación y vendedor antes de entrar al flujo. */
export function InicioView() {
  const { operacion, vendedor } = useApp()
  const dispatch = useDispatch()

  const confirmar = () => {
    // El ID del próximo presupuesto se lee del board acá, así el resumen ya lo tiene listo.
    // Es informativo: no bloquea el avance si la consulta falla.
    if (operacion === 'PRESUPUESTAR') {
      getProximoNroPresupuesto()
        .then((nro) => dispatch({ type: 'setNroPresupuesto', value: nro }))
        .catch(() => {})
    }
    dispatch({ type: 'goto', paso: 'cliente' })
  }

  return (
    /* Misma barra que el resto de los pasos, sin stepper (todavía no hay operación confirmada):
       así el logo y los selectores quedan exactamente donde van a estar después de confirmar, en
       vez de arrancar pegados al borde izquierdo y saltar de lugar. */
    <section className="view paso-layout">
      <PasoHeader>
        <button
          type="button"
          className="btn btn-primary btn--h38"
          disabled={!operacion || !vendedor}
          onClick={confirmar}
        >
          Confirmar <i className="fas fa-check" />
        </button>
      </PasoHeader>
    </section>
  )
}
