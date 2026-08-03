/** Detección de la moneda de un producto/línea, tolerante a acentos y mayúsculas. */

/** El producto/línea está en dólares (columna "✋Moneda" = "Dolares" / "Dólares"). */
export const esDolar = (moneda?: string): boolean => {
  const m = (moneda ?? '').trim().toLowerCase()
  return m === 'dolares' || m === 'dólares'
}
