/**
 * Reglas de uso del límite de crédito. Un único lugar decide si el crédito del cliente entra
 * en juego, para que la ficha, los cálculos de la operación y los bloqueos de escritura
 * respondan todos al mismo criterio.
 *
 * QUIÉN DECIDE QUÉ:
 *   · La CONDICIÓN DE PAGO del cliente decide qué formas de pago se le ofrecen en la venta
 *     (`formasPagoDeCliente`) y qué le anticipa la ficha, que se muestra antes de que haya
 *     operación armada. NO decide cómo se actúa con el cliente ya elegido.
 *   · La FORMA DE PAGO de la VENTA decide si el límite rige: sólo CUENTA CORRIENTE deja deuda
 *     en la cuenta, así que sólo ella consume línea. Una venta de CONTADO o con tarjeta se
 *     cobra en el acto y no toca el crédito, aunque el cliente opere habitualmente a cuenta.
 *
 *   · La ENTREGA ANTERIOR es la excepción: no se mide nada, porque lo que se está facturando ya
 *     tomó línea al salir el remito (ver `operacionUsaCtaCte`).
 *
 * SOBRE QUÉ IMPORTE SE MIDE (lo elige cada vista, del resumen que ya calculó):
 *   · VENTA → el TOTAL CON IVA. Es exactamente lo que se asienta en la cuenta corriente
 *     ("💰Fact Vtas Pends de Cobro" → columna Ventas de la cta cte), así que medir sobre el
 *     neto dejaba pasar del límite el importe del IVA.
 *   · PRESUPUESTO → el NETO. El presupuesto no liquida IVA: sus precios son los de lista.
 *   En los dos casos los REMITOS PENDIENTES DE FACTURAR cuentan como línea ya tomada (ver
 *   `creditoUsado`): es mercadería entregada que todavía no se facturó.
 */
import { money, round2 } from '@/lib/format'
import type { Cliente, CondicionPago, FormaPagoVenta, Operacion, TipoEntrega } from '@/types'

/** Condiciones de pago que HABILITAN operar por cuenta corriente. */
const CONDICIONES_A_CREDITO: readonly CondicionPago[] = [
  'CUENTA CORRIENTE',
  'PROVEED 45 DIAS',
  'PROVEED 90 DIAS',
]

/**
 * La condición pactada con el cliente le permite diferir el pago. Es un rasgo DEL CLIENTE, no
 * de la operación: dice qué formas de pago se le van a ofrecer y qué anticipa la ficha, no si
 * esta operación en particular consume línea (eso lo decide `aplicaCredito`).
 */
export const esVentaACredito = (c: Cliente): boolean =>
  !!c.condicionPago && CONDICIONES_A_CREDITO.includes(c.condicionPago)

/** Bloqueado: no puede operar en el sistema, sea cual sea su condición de pago. */
export const clienteBloqueado = (c: Cliente | null | undefined): boolean =>
  c?.situation === 'Bloqueado'

/**
 * El cliente PUEDE llegar a consumir línea de crédito: no está bloqueado, su condición de pago
 * habilita la cuenta corriente y el board lo tiene liberado CON crédito.
 *
 * Es la mirada de la FICHA, que se muestra en el paso de cliente —antes de que exista forma de
 * pago—: anticipa si el límite va a jugar algún papel. Que rija de verdad en la operación en
 * curso lo decide `aplicaCredito`.
 */
export const clienteOperaACredito = (c: Cliente | null | undefined): boolean =>
  !!c && !clienteBloqueado(c) && esVentaACredito(c) && c.situation === 'Liberado con crédito'

/** La operación en curso, en lo único que le importa al crédito. */
export interface OperacionCredito {
  operacion: Operacion | null
  /** Forma de pago elegida en la VENTA. Las demás operaciones no tienen (queda `null`). */
  formaPago: FormaPagoVenta | null
  /** Cuándo sale la mercadería. La entrega ANTERIOR ya consumió línea al emitir el remito. */
  tipoEntrega?: TipoEntrega | null
}

/** Nada que medir: la operación no puede dejar deuda en la cuenta. */
export const SIN_CREDITO: OperacionCredito = { operacion: null, formaPago: null, tipoEntrega: null }

/**
 * El contexto de crédito de la operación en curso. Es un recorte del estado de la app, y existe
 * para que las vistas no lo armen cada una por su cuenta: son tres campos, y olvidarse de uno no
 * rompe nada visible —simplemente el crédito deja de medirse donde correspondía—.
 */
export const creditoDeOperacion = (estado: {
  operacion: Operacion | null
  formaPago: FormaPagoVenta | null
  tipoEntrega?: TipoEntrega | null
}): OperacionCredito => ({
  operacion: estado.operacion,
  formaPago: estado.formaPago,
  tipoEntrega: estado.tipoEntrega ?? null,
})

/**
 * La operación va a dejar deuda NUEVA en la cuenta corriente, así que compromete línea.
 *
 *   · VENTA          → sólo si la forma de pago es CUENTA CORRIENTE. Es la única que difiere el
 *                      cobro; CONTADO y las dos tarjetas entran a caja en el acto.
 *                      EXCEPCIÓN: la entrega ANTERIOR no mide nada (ver abajo).
 *   · VENTA PROFORMA → nunca: todo su recorrido es cobrar la proforma (ver `tipoPagoOperacion`).
 *   · PRESUPUESTAR   → sí, como PROYECCIÓN. Todavía no hay forma de pago elegida, así que se
 *                      mide contra la línea el escenario de que el cliente lo lleve a cuenta.
 *   · REMITO         → sí: la mercadería entregada queda pendiente de facturar y toma línea.
 *
 * LA ENTREGA ANTERIOR NO SE MIDE. Ese flujo factura "Vtas Pends de Facturar", que YA impactaron
 * la cuenta corriente una vez —cuando salió el remito— en la columna "🤖Remito Pends de Facturar",
 * y esa columna es parte de `creditoUsado`. Facturarlas no agrega exposición: mueve el importe de
 * los remitos pendientes al saldo. Medir el total de la factura encima de un `creditoUsado` que ya
 * lo contiene lo cuenta dos veces y frena ventas que entran en la línea.
 *
 * En PRESUPUESTAR y REMITO quien acota es la condición de pago del cliente vía
 * `clienteOperaACredito`: a un cliente de CONTADO no se le mide crédito porque nunca va a poder
 * diferir el pago.
 */
export function operacionUsaCtaCte({
  operacion,
  formaPago,
  tipoEntrega,
}: OperacionCredito): boolean {
  switch (operacion) {
    case 'VENTA':
      return tipoEntrega !== 'ANTERIOR' && formaPago === 'CUENTA CORRIENTE'
    case 'VENTA PROFORMA':
      return false
    case 'PRESUPUESTAR':
    case 'REMITO':
      return true
    default:
      // Sin operación armada no hay importe que proyectar contra el límite.
      return false
  }
}

/**
 * El límite de crédito rige ESTA operación. Es la pregunta que hacen los cálculos: con `false`
 * no se proyecta uso, no se pinta la barra y no se bloquea nada por crédito.
 */
export const aplicaCredito = (
  c: Cliente | null | undefined,
  op: OperacionCredito,
): boolean => clienteOperaACredito(c) && operacionUsaCtaCte(op)

/** El cliente tiene valores de crédito cargados en el board y vale la pena mostrarlos. */
export const tieneValoresCredito = (c: Cliente): boolean =>
  c.limit > 0 || c.lineaUtilizada > 0 || c.remitosPendFacturar > 0 || c.saldoCtaCte > 0

/**
 * Por qué el límite no se va a considerar, para avisarlo en la ficha. `null` cuando sí puede
 * regir, cuando el cliente está bloqueado (eso se avisa aparte, con más peso) o cuando no hay
 * ningún valor cargado que justifique la aclaración.
 *
 * Habla del CLIENTE, no de la operación: la ficha se muestra antes de elegir la forma de pago.
 */
export function motivoCreditoIgnorado(c: Cliente): string | null {
  if (clienteBloqueado(c) || clienteOperaACredito(c) || !tieneValoresCredito(c)) return null
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
 * pendientes de facturar. Es lo que ya se le descontó del límite, y es la MISMA base para la
 * venta y para el presupuesto: la mercadería entregada sin facturar toma línea en los dos.
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
 * LÍNEA que quedaría comprometida tras la operación: lo ya usado (saldo + remitos pendientes de
 * facturar) más lo que ésta consume. Es el número que se contrasta contra el límite, y el que el
 * "Impacto en cuenta corriente" tiene que mirar para no contradecir al bloqueo: el saldo por sí
 * solo ignora los remitos y da verde donde el bloqueo frena.
 */
export const lineaResultante = (c: Cliente, importe: number): number =>
  round2(creditoUsado(c) + importe)

/**
 * El límite está alcanzado. La regla es una sola: el crédito resultante da NEGATIVO, o sea
 * que la operación consume más línea de la que le queda al cliente.
 *
 * Consumir exactamente lo que queda (resultante 0) NO excede: el cliente llega justo a su
 * límite, que es lo que el límite habilita. Sólo tiene sentido preguntarlo cuando el crédito
 * rige para esta operación; si no, no hay tope que superar.
 */
export const excedeCredito = (
  c: Cliente | null | undefined,
  importe: number,
  op: OperacionCredito,
): boolean => aplicaCredito(c, op) && creditoResultante(c as Cliente, importe) < 0

/**
 * Si la operación debe FRENARSE por crédito. Acá se desacopla la estrategia según el
 * comprobante: la VENTA es bloqueante (no se puede confirmar si el crédito se excedió), mientras
 * que el PRESUPUESTO no lo es (el exceso se avisa, pero se puede guardar igual). El aviso lo
 * muestra la vista/hook; esto sólo decide si además hay que frenar.
 */
export const frenaPorCredito = (
  c: Cliente | null | undefined,
  importe: number,
  op: OperacionCredito,
  bloqueante: boolean,
): boolean => bloqueante && excedeCredito(c, importe, op)

/**
 * Mensaje del bloqueo por límite alcanzado. El "disponible" es el REAL de la cuenta corriente en
 * este momento (límite − línea utilizada): la operación todavía no registró su deuda, así que el
 * crédito disponible no se modificó todavía. Se clampa en 0 —igual que la fórmula del board—
 * porque un cliente con la línea pasada tiene disponible cero, no un número en negativo.
 */
export const mensajeCreditoExcedido = (c: Cliente, importe: number): string =>
  `La operación supera el crédito disponible del cliente ${c.name}: consume ${money(importe)} ` +
  `y tiene disponible ${money(creditoDisponibleProyectado(c))} del ${money(c.limit)} asignado.`
