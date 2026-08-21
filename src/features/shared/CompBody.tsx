import type { ReactNode } from 'react'

/**
 * Cuerpo desplegable de una card de comprobante (`comp-card`), con la animación de apertura y
 * cierre. Lo comparten las CUATRO cards del resumen previo a emitir en Monday —remito, factura
 * común y consignada, presupuesto y proforma—, así el despliegue se siente igual en todas y hay
 * un solo lugar donde ajustar la animación.
 *
 * El contenido NO se desmonta al cerrar: si se lo sacara del DOM no quedaría nada que animar de
 * vuelta y la card se cerraría de golpe. La altura la anima el GRID (`0fr` → `1fr`), que no
 * necesita medir nada en JS ni fijar un `max-height` inventado: una tabla de 3 productos y una de
 * 30 se despliegan igual de bien, y si el contenido cambia mientras está abierta, la card se
 * adapta sola.
 *
 * Cerrado, el contenido queda con `visibility: hidden` (recién cuando termina la animación): no se
 * puede tabular hacia adentro ni lo anuncian los lectores de pantalla, aunque siga montado.
 */
export function CompBody({ abierta, children }: { abierta: boolean; children: ReactNode }) {
  return (
    <div className={`comp-body-wrap ${abierta ? 'open' : ''}`}>
      <div className="comp-body-inner">{children}</div>
    </div>
  )
}
