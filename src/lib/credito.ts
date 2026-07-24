/**
 * Reglas de uso del límite de crédito. Un único lugar decide si el crédito del cliente entra
 * en juego, para que la ficha, los cálculos de la operación y los bloqueos de escritura
 * respondan todos al mismo criterio.
 *
 * El crédito sólo se considera cuando la venta va a cuenta corriente Y el cliente está
 * liberado con crédito. Al contado no hay línea que consumir, y un cliente liberado sin
 * crédito opera sin tope: en los dos casos los importes se muestran, pero no se calculan.
 */
import { money, round2 } from '@/lib/format'
import type { Cliente, CondicionPago } from '@/types'

/** Condiciones de pago que consumen la línea de crédito del cliente. */
const CONDICIONES_A_CREDITO: readonly CondicionPago[] = [
  'CUENTA CORRIENTE',
  'PROVEED 45 DIAS',
  'PROVEED 90 DIAS',
]

/** La operación se cobra después, contra la cuenta corriente del cliente. */
export const esVentaACredito = (c: Cliente): boolean =>
  !!c.condicionPago && CONDICIONES_A_CREDITO.includes(c.condicionPago)

/** Bloqueado: no puede operar en el sistema, sea cual sea su condición de pago. */
export const clienteBloqueado = (c: Cliente | null | undefined): boolean =>
  c?.situation === 'Bloqueado'

/**
 * El límite de crédito rige esta operación. Es la pregunta que hacen los cálculos: con `false`
 * no se proyecta uso, no se pinta la barra y no se bloquea nada por crédito.
 */
export const aplicaCredito = (c: Cliente | null | undefined): boolean =>
  !!c && !clienteBloqueado(c) && esVentaACredito(c) && c.situation === 'Liberado con crédito'

/** El cliente tiene valores de crédito cargados en el board y vale la pena mostrarlos. */
export const tieneValoresCredito = (c: Cliente): boolean =>
  c.limit > 0 || c.lineaUtilizada > 0 || c.remitosPendFacturar > 0 || c.saldoCtaCte > 0

/**
 * Por qué el límite no se va a considerar, para avisarlo en la ficha. `null` cuando sí rige,
 * cuando el cliente está bloqueado (eso se avisa aparte, con más peso) o cuando no hay
 * ningún valor cargado que justifique la aclaración.
 */
export function motivoCreditoIgnorado(c: Cliente): string | null {
  if (clienteBloqueado(c) || aplicaCredito(c) || !tieneValoresCredito(c)) return null
  // Sin condición de pago no hay forma de saber cómo se cobra: se avisa por su cuenta, no como CONTADO.
  if (!c.condicionPago) {
    return 'No se considerará el crédito porque el cliente no tiene asignado una condición de pago en el sistema.'
  }
  if (!esVentaACredito(c)) {
    return 'No se considerará el crédito asignado al cliente porque su condición de pago es CONTADO.'
  }
  return 'El límite de crédito no será considerado durante la operación porque el cliente tiene estado "Liberado sin Crédito".'
}

/** Mensaje único del cliente bloqueado: se usa igual en la ficha y en los bloqueos. */
export const MENSAJE_CLIENTE_BLOQUEADO =
  'El cliente se encuentra bloqueado por lo que no es posible utilizarlo en el sistema.'

/**
 * Base de la línea de crédito ya consumida: la deuda de la cuenta corriente más los remitos
 * pendientes de facturar. Es lo que ya se le descontó del límite.
 */
export const creditoUsado = (c: Cliente): number =>
  round2(c.saldoCtaCte + c.remitosPendFacturar)

/**
 * Crédito disponible PROYECTADO si la operación en curso consume `importe`. Fórmula única y
 * centralizada (DRY): se parte del límite, se resta lo ya usado (saldo + remitos) y el importe
 * temporal de la operación. Se clampa en 0 porque el crédito disponible de la cuenta corriente
 * NUNCA puede quedar en valor negativo. Es pura: recibe el importe por parámetro y no toca ningún
 * estado. Con `importe = 0` da el disponible actual (antes de la operación).
 *
 *   creditoDisponible = max(0, límite − (saldo cta cte + remitos pendientes) − importe operación)
 */
export function creditoDisponibleProyectado(
  c: Cliente | null | undefined,
  importe = 0,
): number {
  if (!c) return 0
  return round2(Math.max(0, c.limit - creditoUsado(c) - importe))
}

/**
 * Crédito que le queda al cliente si la operación consume `importe` de su línea. A diferencia
 * del disponible proyectado, este SÍ puede dar negativo: es la señal de que la operación consume
 * más línea de la que le queda (por eso lo usa el chequeo de exceso; el disponible que se muestra
 * se clampa en 0).
 *
 * Se redondea a dos decimales, como todo importe de la app: sin eso, una diferencia de
 * centésimas por punto flotante (−0,000001) daría "excedido" con la línea justa.
 */
export const creditoResultante = (c: Cliente, importe: number): number =>
  round2(c.limit - creditoUsado(c) - importe)

/**
 * El límite está alcanzado. La regla es una sola: el crédito resultante da NEGATIVO, o sea
 * que la operación consume más línea de la que le queda al cliente.
 *
 * Consumir exactamente lo que queda (resultante 0) NO excede: el cliente llega justo a su
 * límite, que es lo que el límite habilita. Sólo tiene sentido preguntarlo cuando el crédito
 * rige; si no, no hay tope que superar.
 */
export const excedeCredito = (c: Cliente | null | undefined, importe: number): boolean =>
  aplicaCredito(c) && creditoResultante(c as Cliente, importe) < 0

/**
 * Si la operación debe FRENARSE por crédito. Acá se desacopla la estrategia según el
 * comprobante: la VENTA es bloqueante (no se puede confirmar si el crédito se excedió), mientras
 * que el PRESUPUESTO no lo es (el exceso se avisa, pero se puede guardar igual). El aviso lo
 * muestra la vista/hook; esto sólo decide si además hay que frenar.
 */
export const frenaPorCredito = (
  c: Cliente | null | undefined,
  importe: number,
  bloqueante: boolean,
): boolean => bloqueante && excedeCredito(c, importe)

/**
 * Mensaje del bloqueo por límite alcanzado. El "disponible" es el REAL de la cuenta corriente
 * en este momento (`c.disponible` = límite − línea utilizada): la operación todavía no registró
 * su deuda, así que el crédito disponible no se modificó todavía. No se muestra el resultante
 * proyectado: lo que interesa es el disponible real contra lo que la operación consume.
 */
export const mensajeCreditoExcedido = (c: Cliente, importe: number): string =>
  `La operación supera el crédito disponible del cliente ${c.name}: consume ${money(importe)} ` +
  `y tiene disponible ${money(c.disponible)} del ${money(c.limit)} asignado.`
