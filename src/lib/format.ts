/**
 * DOS DECIMALES, REDONDEADOS: el criterio numérico de toda la app, y el MISMO que las fórmulas de
 * Monday (ROUND(x, 2)) y los escenarios de Make. Los tres tienen que dar exactamente el mismo número.
 *
 *   123456,784 → 123456,78
 *   123456,785 → 123456,79      (el 5 sube)
 *   −1,005     → −1,01          (el 5 se aleja del cero, como ROUND de Monday; no va hacia +∞)
 *
 * Es la ÚNICA reducción de decimales que existe: se aplica a lo que se LEE de Monday (`num`), a
 * cada resultado de un cálculo (precio, descuento, subtotal, IVA, total, costo, rentabilidad), a lo
 * que se ESCRIBE en Monday y a lo que se muestra. Porcentajes e importes van con el mismo criterio.
 *
 * El `toPrecision(15)` limpia el arrastre binario del punto flotante ANTES de redondear: 1,005 vale
 * en realidad 1,00499999999999989, y redondearlo a secas daría 1,00 en vez de 1,01. Quince dígitos
 * significativos alcanzan de sobra para cualquier importe de la app.
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  const r = (Math.sign(n) * Math.round(Number((Math.abs(n) * 100).toPrecision(15)))) / 100
  // Sin esto, −0,001 daría −0 y se mostraría "−0,00".
  return r === 0 ? 0 : r
}

const ARS = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "$ 10.465,78" — formato usado en toda la app, siempre con sus dos decimales. */
export const money = (n: number): string => `$ ${ARS.format(round2(n))}`

/** Símbolo del dólar en todo el sistema: "U$" (U delante del signo), sin espacio. */
export const SIMBOLO_DOLAR = 'U$'

/**
 * "U$64,50" — importe en DÓLARES del presupuesto bimonetario. Mismo formato de miles y decimales
 * que `money`, con el prefijo `U$` que lo distingue de los pesos.
 */
export const moneyU = (n: number): string => `${SIMBOLO_DOLAR}${ARS.format(round2(n))}`

export const pct = (n: number): string => `${Math.round(n)}%`

const DEC = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

/** "1,5%" — porcentaje con decimales sólo cuando los tiene, hasta dos (`round2`). */
export const pctDec = (n: number): string => `${DEC.format(round2(n))}%`

/** Número → texto AR para un input de importe (miles con punto, coma decimal, sin símbolo). */
export const importeATexto = (n: number): string =>
  Number.isFinite(n) ? DEC.format(round2(n)) : ''

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
  const valor = round2(Number(`${enteroRaw || '0'}.${decRaw || '0'}`))
  return { texto, valor }
}
