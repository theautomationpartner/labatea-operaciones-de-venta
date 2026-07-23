interface ModalCargandoProps {
  titulo: string
  detalle: string
}

/**
 * Tapa la pantalla mientras se escribe en Monday. Se usa en las secuencias que no conviene
 * interrumpir ni disparar dos veces —crear el presupuesto, cerrar la venta—, y el texto dice
 * en qué paso va.
 *
 * Vive en `components/ui` y no dentro de una vista: sus estilos son globales, así funciona
 * igual en cualquier paso. Antes el markup estaba duplicado y el CSS namespaceado bajo
 * `.cobro-v2`, así que fuera del cobro el overlay se montaba sin estilos y no se veía.
 */
export function ModalCargando({ titulo, detalle }: ModalCargandoProps) {
  return (
    <div className="modal-cargando" role="status" aria-live="polite">
      <div className="modal-cargando-box">
        <i className="fas fa-circle-notch spin" />
        <strong>{titulo}</strong>
        <span>{detalle}</span>
      </div>
    </div>
  )
}
