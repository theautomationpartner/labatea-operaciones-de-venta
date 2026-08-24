/**
 * El rechazo de seguridad vigente, para que React lo pueda mostrar.
 *
 * Se suscribe al canal de `lib/errorSeguridad`, que es donde el sdk publica cuando el borde
 * rechaza un pedido.
 */
import { useSyncExternalStore } from 'react'
import {
  errorSeguridadActual,
  suscribirErrorSeguridad,
  type ErrorSeguridad,
} from '@/lib/errorSeguridad'

export function useErrorSeguridad(): ErrorSeguridad | null {
  return useSyncExternalStore(suscribirErrorSeguridad, errorSeguridadActual, () => null)
}
