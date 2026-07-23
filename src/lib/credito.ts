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
  CONDICIONES_A_CREDITO.includes(c.condicionPago)

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
  if (!esVentaACredito(c)) {
    return 'No se considerará el crédito asignado al cliente porque su condición de pago es CONTADO.'
  }
  return 'El límite de crédito no será considerado durante la operación porque el cliente tiene estado "Liberado sin Crédito".'
}

/** Mensaje único del cliente bloqueado: se usa igual en la ficha y en los bloqueos. */
export const MENSAJE_CLIENTE_BLOQUEADO =
  'El cliente se encuentra bloqueado por lo que no es posible utilizarlo en el sistema.'

/**
 * Crédito que le queda al cliente si la operación consume `importe` de su línea. Puede dar
 * negativo: ahí es donde el cliente estaría usando más crédito del que tiene asignado.
 *
 * Se redondea a dos decimales, como todo importe de la app: sin eso, una diferencia de
 * centésimas por punto flotante (−0,000001) daría "excedido" con la línea justa.
 */
export const creditoResultante = (c: Cliente, importe: number): number =>
  round2(c.disponible - importe)

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

/** Mensaje del bloqueo por límite alcanzado, con los números que lo explican. */
export const mensajeCreditoExcedido = (c: Cliente, importe: number): string =>
  `La operación supera el crédito disponible de ${c.name}: consume ${money(importe)} y tiene ` +
  `${money(c.disponible)} sobre un límite de ${money(c.limit)}, así que su crédito quedaría en ` +
  `${money(creditoResultante(c, importe))}. ` +
  'Reducí el importe, registrá un cobro o pedí una ampliación del límite antes de continuar.'
