/**
 * Marca ROJA de un selector de configuración que quedó sin elegir.
 *
 * Es el estándar de la app para una situación concreta: el usuario aprieta "Continuar", no se
 * avanza porque falta configurar algo, y hay que decirle CUÁL de los selectores es. Aplica a los
 * cinco que gobiernan el recorrido —tipo de venta, tipo de entrega, forma de pago, tipo de
 * operación y "la venta es…"—, que son los que pueden frenar una etapa.
 *
 * Vive en un solo lugar a propósito. Son cinco componentes en cuatro carpetas distintas, y la
 * alternativa —que cada uno resuelva su clase— es exactamente cómo la app terminó con cuatro
 * diseños distintos del botón "Volver".
 *
 * La marca se calcula, no se guarda: es "se intentó avanzar Y este campo sigue vacío". Por eso se
 * apaga sola en cuanto el usuario elige, sin que nadie tenga que acordarse de bajarla.
 */

/** Clase del `select` (el color del texto). Vacío = placeholder gris. */
export const claseSelector = (valor: unknown): string => (valor ? '' : 'cfg-sel--ph')

/**
 * Clase de la CAJA del selector. El borde va acá y no en el `select`: `.cfg-sel` no tiene borde
 * propio —la caja visible es `.cfgbox`—, así que pintarlo en el control no se vería.
 */
export const claseCajaSelector = (valor: unknown, intentoAvanzar: boolean): string =>
  !valor && intentoAvanzar ? 'cfgbox cfgbox--falta' : 'cfgbox'
