import { resumenActividades } from '@/lib/actividad'
import type { ActividadListada } from '@/types'

/**
 * Las actividades asociadas al documento, para el renglón "Actividades" de los resúmenes.
 *
 * Se lee el nombre de la PRIMERA y el resto queda detrás de un "+": los nombres son frases enteras
 * ("Llamada telefónica para conocer su propuesta") y dos de ellas no entran en el renglón sin
 * partirlo en tres. El `title` trae la lista completa, así que pasar el mouse alcanza para saber
 * cuáles son, sin abrir nada ni salir de la pantalla.
 */
export function ActividadesDelDocumento({ actividades }: { actividades: ActividadListada[] }) {
  const { visible, ocultas, titulo } = resumenActividades(actividades)
  if (!visible) return <>--</>

  return (
    <span className="act-resumen" title={titulo}>
      <span className="act-resumen-nom">{visible}</span>
      {/* Sin número cuando esconde una sola; con la cantidad cuando son varias. */}
      {ocultas > 0 && <span className="act-resumen-mas">, +{ocultas > 1 ? ocultas : ''}</span>}
    </span>
  )
}
