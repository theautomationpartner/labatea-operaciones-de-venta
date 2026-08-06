import { useCallback, useEffect, useMemo, useState } from 'react'

/** Bancos emisores fijos que ofrece el select de cobro (cheques y tarjetas), en el orden pedido. */
export const BANCOS_EMISORES_BASE = [
  'Galicia',
  'Provincia',
  'Nacion',
  'HSBC',
  'Credicop',
  'Santander',
  'BBVA',
  'Hipotecario',
  'Patagonia',
  'Supervielle',
] as const

/** Clave de localStorage donde viven los bancos que el usuario agregó a mano. */
const STORAGE_KEY = 'labatea:bancosEmisores'
/** Evento propio para sincronizar dos formularios abiertos en la misma pestaña (storage no dispara ahí). */
const EVENTO_SYNC = 'labatea:bancos'

function leerCustom(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    /* Sin storage disponible (o dato corrupto), se arranca sólo con los bancos fijos. */
    return []
  }
}

/**
 * Lista de bancos emisores para el cobro: los fijos MÁS los que el usuario haya agregado, que quedan
 * recordados en localStorage entre sesiones. `agregar` suma uno nuevo sin duplicar (ni contra los
 * fijos ni contra los custom, sin distinguir mayúsculas) y notifica a las demás instancias del hook.
 */
export function useBancosEmisores() {
  const [custom, setCustom] = useState<string[]>(() => leerCustom())

  useEffect(() => {
    const releer = () => setCustom(leerCustom())
    // `storage` cubre otras pestañas; el evento propio, otros formularios de esta misma pestaña.
    window.addEventListener('storage', releer)
    window.addEventListener(EVENTO_SYNC, releer)
    return () => {
      window.removeEventListener('storage', releer)
      window.removeEventListener(EVENTO_SYNC, releer)
    }
  }, [])

  const agregar = useCallback((nombre: string) => {
    const limpio = nombre.trim()
    if (!limpio) return
    const actuales = leerCustom()
    const yaExiste = [...BANCOS_EMISORES_BASE, ...actuales].some(
      (b) => b.toLowerCase() === limpio.toLowerCase(),
    )
    if (yaExiste) return
    const siguiente = [...actuales, limpio]
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(siguiente))
    } catch {
      /* Si el storage no está disponible, el banco vive sólo en memoria de esta sesión. */
    }
    setCustom(siguiente)
    window.dispatchEvent(new Event(EVENTO_SYNC))
  }, [])

  const bancos = useMemo(() => [...BANCOS_EMISORES_BASE, ...custom], [custom])
  return { bancos, agregar }
}
