import { useEffect, useState } from 'react'
import { documentoDeVentaItem } from '@/lib/selectors'
import {
  getActividadesHeredadasDePresupuestos,
  getActividadesHeredadasDeProforma,
} from '@/services/monday'
import { useApp } from '@/state/hooks'
import type { ActividadListada } from '@/types'

export interface ActividadesDeLaVenta {
  /** Las actividades de la cadena, con su registro completo (para mostrarlas en un resumen). */
  actividades: ActividadListada[]
  /**
   * Todavía se están resolviendo. Importa porque la comisión depende de esto: mientras no se sepa,
   * mostrar un número es mostrar el equivocado (ver `tasaComision`).
   */
  cargando: boolean
}

/**
 * Las actividades que le corresponden a la venta en curso, con su registro completo.
 *
 * Es la versión mirable de `actividadesDeLaVenta` —que devuelve sólo ids, para escribir la
 * relación— y responde la misma pregunta: la gestión comercial se elige UNA vez, en el documento
 * que la origina, y el resto la hereda en cascada:
 *   · VENTA DIRECTA (y VENTA PROFORMA desde una proforma DIRECTA): las tildadas en la etapa
 *     "Registrar Actividad" de esta misma operación, que ya están en el estado.
 *   · VENTA CON PRESUPUESTO PREVIO: las de los presupuestos que aportaron algún producto vendido.
 *   · VENTA PROFORMA desde una proforma CON PRESUPUESTO PREVIO: las que la proforma trae en SU
 *     columna "🤖Actividades".
 *
 * Lo miran varias pantallas a la vez —el resumen de la venta, el del remito y el cálculo de la
 * comisión—, y de ahí sale también si la venta paga comisión Activa o Pasiva: la Activa es sólo
 * para ACTIVIDADES-PRESUPUESTO-VENTA (ver `TASA_POR_COMBINACION`). Las consultas están cacheadas
 * por conjunto de documentos, así que montarlo en varios lugares no multiplica los pedidos.
 */
export function useActividadesDeLaVenta(): ActividadesDeLaVenta {
  const { operacion, tipoVenta, proformaTipoVenta, proformaId, ventaItems, actividadesDocumento } =
    useApp()

  /* De dónde salen: propias (ya en el estado) o heredadas (hay que ir a buscarlas). La clave de
     los presupuestos se arma con los documentos que aportaron alguna línea. */
  const deProforma = operacion === 'VENTA PROFORMA' && proformaTipoVenta === 'CON PRESUPUESTO PREVIO'
  const dePresupuestos = operacion !== 'VENTA PROFORMA' && tipoVenta === 'CON PRESUPUESTO PREVIO'
  const presupuestoIds = dePresupuestos
    ? [...new Set(ventaItems.map((it) => documentoDeVentaItem(it.uid)))].sort().join(',')
    : ''

  const [heredadas, setHeredadas] = useState<ActividadListada[]>([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (!deProforma && !dePresupuestos) return
    let vivo = true
    setCargando(true)
    const traer = deProforma
      ? getActividadesHeredadasDeProforma(proformaId ?? '')
      : getActividadesHeredadasDePresupuestos(presupuestoIds ? presupuestoIds.split(',') : [])
    traer
      .then((as) => {
        if (!vivo) return
        setHeredadas(as)
        setCargando(false)
      })
      .catch(() => {
        if (!vivo) return
        /* Se corta el "cargando" igual: dejarlo prendido congelaría la comisión en un guión para
           siempre. Sin actividades resueltas la venta paga la Pasiva, que es el caso conservador. */
        setHeredadas([])
        setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [deProforma, dePresupuestos, proformaId, presupuestoIds])

  if (deProforma || dePresupuestos) return { actividades: heredadas, cargando }
  // Las propias ya están en el estado: no hay nada que esperar.
  return { actividades: actividadesDocumento, cargando: false }
}
