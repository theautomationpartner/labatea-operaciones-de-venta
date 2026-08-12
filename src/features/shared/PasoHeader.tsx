import { type ReactNode } from 'react'
import { Stepper } from '@/components/ui/Stepper'
import { SelectoresOperacion } from '@/features/shared/TopSelectors'
import { pasosDe, pasosKeysDe } from '@/lib/pasos'
import { useApp, useDispatch } from '@/state/hooks'

interface PasoHeaderProps {
  /** Etapas de la operación. Sin ellas la barra sale SIN stepper (paso inicial). */
  pasos?: readonly string[]
  /** Índice del paso en curso (0-based). */
  actual?: number
  /** Se monta dentro de la barra de selectores (el "Confirmar" del paso inicial). */
  children?: ReactNode
}

/**
 * Barra de contexto del flujo: a la izquierda la operación y el vendedor (que valen para toda
 * la transacción) y a la derecha el avance por pasos.
 *
 * La usa TODA la app, incluido el paso inicial —que la monta sin `pasos`, con el botón "Confirmar"
 * como `children`—. Antes ese paso dibujaba los selectores sueltos, fuera de la barra: sin el
 * `max-width` ni el centrado del contenedor, el logo y los selectores arrancaban pegados al borde
 * izquierdo y saltaban de lugar al confirmar la operación.
 *
 * Los círculos del stepper navegan entre etapas YA alcanzadas (índice ≤ `pasoMaxIdx`): permiten
 * volver atrás a revisar y saltar de nuevo hacia adelante sin perder los datos. Los pasos futuros
 * quedan bloqueados. El destino de cada índice sale de `pasosKeysDe` (mismo orden que las etiquetas).
 */
export function PasoHeader({ pasos, actual = 0, children }: PasoHeaderProps) {
  const { operacion, tipoVenta, tipoEntrega, remito, pasoMaxIdx } = useApp()
  const dispatch = useDispatch()
  const claves = pasosKeysDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)
  const irAPaso = (i: number) => {
    const paso = claves[i]
    if (paso) dispatch({ type: 'goto', paso })
  }
  /* Sin `pasos` (paso inicial) se reservan las etapas de la operación que el usuario está por
     confirmar: así la barra que aparece al confirmar mide exactamente lo mismo que la reservada. */
  const etapas = pasos ?? pasosDe(operacion, tipoVenta, tipoEntrega, remito.tipoEmision)

  return (
    <header className="paso-header">
      <div className="paso-header-in">
        <div className="paso-header-sel">
          <SelectoresOperacion>{children}</SelectoresOperacion>
        </div>

        {/* La barra de etapas ocupa su lugar SIEMPRE, aunque todavía no haya operación confirmada.
            `.paso-header-in` alinea al centro, así que su alto lo marca el hijo más alto: sin la
            barra, la banda medía ~39px menos y los selectores quedaban ~20px más arriba, de modo
            que al confirmar TODO el encabezado saltaba de lugar. Reservándola con el mismo DOM, el
            alto es idéntico por construcción —no por un `min-height` adivinado— y nada se mueve.
            Sin `pasos` va en fantasma: invisible, no navegable y fuera del árbol de accesibilidad. */}
        <div className="paso-header-steps" aria-hidden={!pasos || undefined}>
          <Stepper
            steps={etapas}
            current={pasos ? actual : 0}
            className={`stepper--tight ${pasos ? '' : 'stepper--fantasma'}`}
            maxReached={pasos ? pasoMaxIdx : 0}
            onStep={pasos ? irAPaso : undefined}
          />
        </div>
      </div>
    </header>
  )
}

interface PasoTituloProps {
  /** Número del paso, el mismo que marca el stepper. */
  numero: number
  titulo: string
  descripcion: ReactNode
}

/**
 * Encabezado del paso: número, título y bajada. La salida de la operación ya no vive acá: el
 * cambio de operación se gestiona desde el selector superior, con su propia advertencia.
 */
export function PasoTitulo({ numero, titulo, descripcion }: PasoTituloProps) {
  return (
    <header className="header-section">
      <div className="step-indicator-main">
        <div className="step-badge-main">{numero}</div>
        <div className="step-details-main">
          <h1 className="step-title-main">{titulo}</h1>
          <p className="step-desc-main">{descripcion}</p>
        </div>
      </div>
    </header>
  )
}
