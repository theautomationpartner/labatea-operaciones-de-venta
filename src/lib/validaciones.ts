/**
 * Validaciones previas a avanzar de paso o a escribir en Monday. Son puras (sin React ni
 * red): devuelven la lista de datos faltantes, y cada vista decide cómo mostrarla.
 */
import { pctDec } from '@/lib/format'
import { DESCUENTO_MAX_DEFAULT, DESCUENTO_MIN_DEFAULT } from '@/lib/selectors'
import type { Cliente, LineaPresupuesto, MedioEnvio } from '@/types'

/** Texto vacío o sólo espacios cuenta como dato ausente. */
const vacio = (v: string | null | undefined) => !v || !v.trim()

/**
 * Datos del cliente sin los que no se puede armar la operación: sin lista de precio no hay
 * precios que traer, sin condición fiscal no se sabe si el precio lleva IVA, y sin condición de
 * pago no se sabe cómo se cobra (contado / cuenta corriente), de lo que depende el resto del flujo.
 */
export function faltantesCliente(cliente: Cliente): string[] {
  const faltan: string[] = []
  if (vacio(cliente.list)) faltan.push('Lista de precio')
  if (vacio(cliente.status)) faltan.push('Condición fiscal')
  if (vacio(cliente.condicionPago)) faltan.push('Condición de pago')
  return faltan
}

/* ===== Descuento por línea ===== */

/**
 * Topes vigentes del descuento, leídos del tablero de configuración ("Descuento de Producto").
 * Hoy sólo rige `max`: el descuento va de 0 a ese tope. `min` se sigue trayendo del board,
 * pero no rechaza nada —ver `validarDescuento`—.
 */
export interface TopesDescuento {
  max: number
  /** Piso configurado en el tablero. Por ahora informativo: la app no lo valida. */
  min: number
}

/** Los topes de respaldo, por si el tablero todavía no respondió. */
export const TOPES_DESCUENTO_DEFAULT: TopesDescuento = {
  max: DESCUENTO_MAX_DEFAULT,
  min: DESCUENTO_MIN_DEFAULT,
}

/** Porcentaje escrito a mano → número. Acepta coma o punto; NaN si no es un número. */
const aNumero = (valor: string): number => Number(valor.trim().replace(',', '.'))

/** Texto normalizado del porcentaje: coma o punto sirven igual como separador decimal. */
const normalizar = (valor: string): string => valor.trim().replace(',', '.')

/**
 * Bonificación total. Es la excepción al máximo: regalar el producto entero está permitido,
 * cualquier otro valor por encima del tope, no.
 */
export const BONIFICACION_TOTAL = 100

/** Cómo se escribe la bonificación total; se usa para no frenar el tipeo camino a ella. */
const BONIFICACION_TOTAL_TEXTO = String(BONIFICACION_TOTAL)

/**
 * El valor tipeado ya se pasó del tope: se rechaza la tecla en vez de corregir el número,
 * para no cambiarle al usuario lo que está escribiendo.
 *
 * "10" pasa el máximo pero es el camino a "100", así que no se frena: si el usuario se queda
 * ahí, `validarDescuento` lo marca en rojo. Sin esta excepción sería imposible escribir 100.
 */
export function excedeMaximo(valor: string, topes: TopesDescuento): boolean {
  const texto = normalizar(valor)
  if (texto === '') return false
  if (BONIFICACION_TOTAL_TEXTO.startsWith(texto)) return false
  const n = aNumero(texto)
  return Number.isFinite(n) && n > topes.max
}

/** Aviso del tope superior. Lo comparten el rechazo de tecla y la validación del valor. */
export const mensajeMaximo = (topes: TopesDescuento): string =>
  `Máximo ${pctDec(topes.max)} (o ${pctDec(BONIFICACION_TOTAL)})`

/**
 * Saca los ceros que no aportan nada: "05" es 5 y "00" es 0. Sin esto el campo deja escribir
 * un cero atrás de otro. El "0" solo y el "0.5" no se tocan: ahí el cero sí significa algo.
 */
const sinCerosSobrantes = (texto: string): string => {
  if (!/^0\d/.test(texto)) return texto
  const sin = texto.replace(/^0+/, '')
  return sin === '' ? '0' : sin
}

/** Resultado de una tecla en el campo de descuento. */
export interface TecleoDescuento {
  /** Lo que tiene que quedar en el campo (el valor anterior si la tecla se rechazó). */
  texto: string
  /** Motivo del rechazo. Vacío = no hay nada que explicar (o no se rechazó nada). */
  mensaje: string
}

/**
 * Resuelve una tecla del campo de descuento: qué queda escrito y qué se le dice al usuario.
 *
 * El rechazo es SILENCIOSO cuando se le agrega un dígito a un valor que ya era válido: si hay
 * un "2" y se aprieta "3", el 23 no entra y listo —marcar el "2" en rojo sería mentir, porque
 * el 2 está bien—. El aviso aparece sólo cuando el primer dígito ya se pasa del tope: campo
 * vacío (o en cero) y se escribe un "6".
 */
export function aplicarTecleoDescuento(
  anterior: string,
  entrada: string,
  topes: TopesDescuento,
): TecleoDescuento {
  const limpio = entrada.replace(',', '.')
  // Caracteres que no son un porcentaje: no entran, y no hay nada que explicar.
  if (limpio !== '' && !/^\d*\.?\d*$/.test(limpio)) return { texto: anterior, mensaje: '' }

  const texto = sinCerosSobrantes(limpio)
  if (excedeMaximo(texto, topes)) {
    // Un valor que ya venía escrito no se marca en rojo por lo que se le quiso agregar.
    const primerDigito = anterior === '' || anterior === '0'
    return { texto: anterior, mensaje: primerDigito ? mensajeMaximo(topes) : '' }
  }
  return { texto, mensaje: '' }
}

export interface DescuentoValidado {
  ok: boolean
  /** Qué corregir. Vacío si el valor sirve. */
  mensaje: string
}

/**
 * Descuentos admitidos: vacío o cualquier valor entre 0 y el máximo del tablero, más el 100%
 * de bonificación como única excepción por encima del tope.
 *
 * El mínimo del tablero (`topes.min`) NO se valida: se decidió que el rango va de 0 al máximo
 * sin piso. Se sigue leyendo de la configuración por si vuelve a regir, pero hoy no rechaza
 * nada; si hay que reactivarlo, va una condición acá y alcanza.
 */
export function validarDescuento(valor: string, topes: TopesDescuento): DescuentoValidado {
  const texto = normalizar(valor)
  if (texto === '') return { ok: true, mensaje: '' }

  const n = aNumero(texto)
  if (!Number.isFinite(n)) return { ok: false, mensaje: 'Ingresá un porcentaje válido' }
  if (n === BONIFICACION_TOTAL) return { ok: true, mensaje: '' }
  if (n < 0) return { ok: false, mensaje: 'El descuento no puede ser negativo' }
  if (n > topes.max) return { ok: false, mensaje: mensajeMaximo(topes) }
  return { ok: true, mensaje: '' }
}

/* ===== Datos de contacto exigidos por el medio de envío ===== */

/**
 * Datos que el medio elegido usaría y el contacto no tiene. Es INFORMATIVO: sirve para mostrar
 * "SIN TELEFONO" / "SIN EMAIL" en la ficha del contacto, no para frenar el envío.
 */
export function faltaParaMedio(
  contacto: { phone: string; email: string },
  medio: MedioEnvio,
): { telefono: boolean; email: boolean } {
  return {
    telefono: (medio === 'WhatsApp' || medio === 'Ambos') && !contacto.phone.trim(),
    email: (medio === 'Email' || medio === 'Ambos') && !contacto.email.trim(),
  }
}

/**
 * El contacto NO tiene por dónde recibir el documento con el medio elegido.
 *
 * Con "Ambos" alcanza con UNO de los dos datos: se envía por el canal que tenga y se omite el
 * otro. Antes se lo trataba como incompleto si le faltaba cualquiera de los dos, y eso marcaba
 * como problemáticos a contactos perfectamente alcanzables.
 */
export function sinViaDeEnvio(
  contacto: { phone: string; email: string },
  medio: MedioEnvio,
): boolean {
  const falta = faltaParaMedio(contacto, medio)
  return medio === 'Ambos' ? falta.telefono && falta.email : falta.telefono || falta.email
}

export interface DatosAValidar {
  cliente: Cliente
  lineas: LineaPresupuesto[]
  /** dd/MM/yyyy, tal como los muestra la app. */
  fechaEmision: string
  fechaVencimiento: string
  diasVigencia: number
}

/** Una fecha sirve si viene en dd/MM/yyyy: es lo que se convierte al formato de Monday. */
const fechaValida = (v: string) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v.trim())

/**
 * Todo lo que necesita `crearPresupuestoBorrador` para escribir el ítem y sus subitems.
 * `exigirIdsMonday` se activa con el token cargado: sin él no hay ids reales que linkear.
 */
export function faltantesPresupuesto(
  datos: DatosAValidar,
  exigirIdsMonday: boolean,
): string[] {
  const { cliente, lineas, fechaEmision, fechaVencimiento, diasVigencia } = datos
  const faltan = faltantesCliente(cliente)

  // Cabecera: el cliente se linkea por su id de Monday, que es numérico.
  if (vacio(cliente.id)) faltan.push('Código del cliente')
  else if (exigirIdsMonday && !Number.isFinite(Number(cliente.id)))
    faltan.push('Código del cliente válido para vincularlo en Monday')

  if (!fechaValida(fechaEmision)) faltan.push('Fecha de emisión')
  if (!fechaValida(fechaVencimiento)) faltan.push('Fecha de vencimiento')
  if (!Number.isFinite(diasVigencia) || diasVigencia <= 0) faltan.push('Días de vigencia')

  // Subitems: sin líneas no hay presupuesto que crear.
  if (lineas.length === 0) {
    faltan.push('Al menos un producto en el presupuesto')
    return faltan
  }

  // Se nombra el producto una sola vez aunque le falte más de un dato.
  const conCantidad = lineas.filter((l) => l.cantidad <= 0)
  const conPrecio = lineas.filter((l) => l.producto.precio <= 0)
  const sinId = exigirIdsMonday ? lineas.filter((l) => !l.producto.id) : []

  for (const l of conCantidad) faltan.push(`Cantidad de «${l.producto.nombre}»`)
  for (const l of conPrecio) faltan.push(`Precio de «${l.producto.nombre}» en la lista del cliente`)
  for (const l of sinId) faltan.push(`Producto «${l.producto.nombre}» sin vínculo al maestro`)

  return faltan
}

/**
 * Contactos que NO pueden recibir el documento por el medio elegido: les falta justamente el dato
 * que ese medio usa.
 *
 * Con "Ambos" devuelve SIEMPRE vacío, y no es un olvido: ahí el envío se reparte por contacto —a
 * quien tiene email le llega por email, a quien tiene teléfono por WhatsApp—, así que un dato
 * ausente no impide que el documento salga. Frenar la operación entera por eso obligaría a depurar
 * la lista para conseguir algo que ya iba a pasar solo.
 */
export function contactosSinVia<T extends { phone: string; email: string }>(
  contactos: readonly T[],
  medio: MedioEnvio,
): T[] {
  if (medio === 'Ambos') return []
  return contactos.filter((c) => sinViaDeEnvio(c, medio))
}

/** Cómo se nombra en el mensaje el dato que cada medio necesita. */
const DATO_DEL_MEDIO: Record<Exclude<MedioEnvio, 'Ambos'>, string> = {
  Email: 'una dirección de email cargada',
  WhatsApp: 'un número de teléfono cargado',
}

/**
 * Por qué ese contacto no puede recibir el documento. Nombra las TRES cosas que hacen falta para
 * entenderlo sin ir a buscar nada: el medio elegido, el contacto, y qué le falta.
 */
export const msgContactoSinVia = (nombre: string, medio: MedioEnvio): string =>
  medio === 'Ambos'
    ? ''
    : `Seleccionó ${medio.toLowerCase()} como medio de envío, pero el contacto ${nombre} NO tiene ${DATO_DEL_MEDIO[medio]}.`

/* ===== Cantidad de una línea ===== */

/**
 * Sólo los dígitos de lo que se tipeó en el campo de cantidad. Devuelve `''` cuando no queda nada, y
 * ESE vacío es el punto: es lo que permite borrar el "1" para escribir un número que empieza con
 * otro dígito. Corregirlo mientras se escribe —lo que hacía antes— obligaba a pararse a la derecha
 * del 1 y borrar hacia atrás para cargar 30.
 *
 * Filtra aunque el input sea `type="number"`: ese tipo igual deja pasar el signo, el punto decimal y
 * la notación científica, y cualquiera de los tres rompe el valor.
 */
export const soloCantidad = (entrada: string): string => entrada.replace(/\D/g, '')

/**
 * Cantidad EFECTIVA de un campo que puede estar a medio escribir. El vacío vale 1: los cálculos de
 * al lado no pueden quedar en cero mientras se tipea, y 1 es además lo que queda si el usuario se va
 * del campo sin escribir nada.
 *
 * Es lo mismo que se muestra al salir del campo, así que lo que se ve y lo que se calcula no pueden
 * discrepar.
 */
export const cantidadEfectiva = (texto: string): number =>
  Math.max(1, Math.floor(Number(texto)) || 1)
