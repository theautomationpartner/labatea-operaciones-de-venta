import { SelectoresOperacion } from '@/features/shared/TopSelectors'
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
    <section className="view">
      <SelectoresOperacion>
        <button
          type="button"
          className="btn btn-primary btn--h38"
          disabled={!operacion || !vendedor}
          onClick={confirmar}
        >
          Confirmar <i className="fas fa-check" />
        </button>
      </SelectoresOperacion>
    </section>
  )
}
