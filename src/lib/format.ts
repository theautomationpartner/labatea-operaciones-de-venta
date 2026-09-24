/**
 * DOS DECIMALES, TRUNCADOS: el criterio numérico de toda la app, acordado con el comercio.
 *
 *   123456,789 → 123456,78      (no 123456,79: se CORTA, no se redondea)
 *   −1,239     → −1,23          (hacia el cero, como ROUNDDOWN de Monday)
 *
 * Es la ÚNICA reducción de decimales que existe: se aplica a lo que se LEE de Monday (`num`), a
 * cada resultado de un cálculo (precio, descuento, subtotal, IVA, total, costo, rentabilidad) y a
 * lo que se ESCRIBE en Monday, y también a lo que se muestra. Así los cuatro dicen el mismo número
 * y coinciden con las fórmulas del board, que usan ROUNDDOWN(x, 2).
 *
 * El `toPrecision(15)` limpia el arrastre binario del punto flotante ANTES de cortar: 1,15 × 100
 * vale en realidad 114,99999999999999, y cortarlo a secas daría 1,14 en vez de 1,15. Quince
 * dígitos significativos alcanzan de sobra para cualquier importe de la app.
 */
export const trunc2 = (n: number): number =>
  Number.isFinite(n) ? Math.trunc(Number((n * 100).toPrecision(15))) / 100 : 0

/**
 * PORCENTAJE que sale de una cuenta (rentabilidad de una línea, rentabilidad general), a dos
 * decimales REDONDEADOS. Es la única excepción a `trunc2`, y es a propósito.
 *
 * Los importes se truncan, y un % calculado sobre importes truncados queda apenas por debajo de su
 * valor: el producto de la planilla (Costo 102.162,35 · Flete 175 · Margen 23%) tiene precio
 * 125.834,69 y rinde 22,9999995%. Truncado mostraría 22,99%, y cualquier producto cargado al 10%
 * diría 9,99%. Redondeado da 23,00% y 10,00%: el margen que el comercio cargó en el maestro.
 *
 * El `Number.EPSILON` corrige el arrastre binario: sin él, 1,005 redondea a 1 en vez de a 1,01.
 */
export const redondearPct = (n: number): number =>
  Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0

const ARS = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "$ 10.465,78" — formato usado en toda la app, siempre con sus dos decimales (truncados). */
export const money = (n: number): string => `$ ${ARS.format(trunc2(n))}`

/** Símbolo del dólar en todo el sistema: "U$" (U delante del signo), sin espacio. */
export const SIMBOLO_DOLAR = 'U$'

/**
 * "U$64,50" — importe en DÓLARES del presupuesto bimonetario. Mismo formato de miles y decimales
 * que `money`, con el prefijo `U$` que lo distingue de los pesos.
 */
export const moneyU = (n: number): string => `${SIMBOLO_DOLAR}${ARS.format(trunc2(n))}`

export const pct = (n: number): string => `${Math.round(n)}%`

const DEC = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

/** "1,5%" — porcentaje con decimales sólo cuando los tiene, hasta dos, REDONDEADOS como todo %
 *  (ver `redondearPct`). */
export const pctDec = (n: number): string => `${DEC.format(redondearPct(n))}%`

/** Número → texto AR para un input de importe (miles con punto, coma decimal, sin símbolo). */
export const importeATexto = (n: number): string =>
  Number.isFinite(n) ? DEC.format(trunc2(n)) : ''

/**
 * Da formato ARGENTINO a lo tecleado en un input de importe: miles con punto y decimales con coma
 * (hasta 2). Devuelve el `texto` ya formateado para el input y el `valor` numérico para el estado.
 * Se descartan los puntos de miles y todo lo que no sea dígito o la coma decimal, así el usuario
 * puede escribir de corrido. Ej.: "30409" → { texto: "30.409", valor: 30409 };
 * "30409,5" → { texto: "30.409,5", valor: 30409.5 }.
 */
export function formatearImporteAR(entrada: string): { texto: string; valor: number } {
  const limpio = entrada.replace(/\./g, '').replace(/[^\d,]/g, '')
  const iComa = limpio.indexOf(',')
  const enteroRaw = (iComa >= 0 ? limpio.slice(0, iComa) : limpio).replace(/^0+(?=\d)/, '')
  const decRaw = iComa >= 0 ? limpio.slice(iComa + 1).replace(/,/g, '').slice(0, 2) : ''
  // Miles con punto en la parte entera; si sólo se tecleó la coma, se muestra "0,".
  const enteroFmt = (enteroRaw || (iComa >= 0 ? '0' : '')).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const texto = iComa >= 0 ? `${enteroFmt},${decRaw}` : enteroFmt
  const valor = trunc2(Number(`${enteroRaw || '0'}.${decRaw || '0'}`))
  return { texto, valor }
}
