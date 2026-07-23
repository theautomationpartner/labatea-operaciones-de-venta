/**
 * Redondeo de importes: hasta dos decimales. Es el ÚNICO redondeo que se le aplica a un
 * monto en toda la app —precio unitario, subtotal, IVA y total, por línea y por documento—
 * para que lo que se muestra, lo que se calcula y lo que se escribe en Monday coincidan.
 *
 * El `Number.EPSILON` corrige el arrastre binario del punto flotante: sin él, 1.005 redondea
 * a 1 en vez de a 1.01 porque en realidad vale 1.00499999999999989.
 */
export const round2 = (n: number): number =>
  Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0

const ARS = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** "$ 10.465,78" — formato usado en toda la app, siempre con sus dos decimales. */
export const money = (n: number): string => `$ ${ARS.format(round2(n))}`

export const pct = (n: number): string => `${Math.round(n)}%`

const DEC = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

/** "1,5%" — porcentaje con decimales sólo cuando los tiene (descuentos). */
export const pctDec = (n: number): string => `${DEC.format(n)}%`
