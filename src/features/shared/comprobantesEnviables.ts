/**
 * Catálogo de comprobantes ENVIABLES. Es el punto de extensión del envío: cada comprobante
 * describe, en un objeto, todo lo que lo distingue de los demás.
 *
 * Antes esa diferencia vivía como una cadena de `if (documento === '…')` dentro de
 * `EnviarDocumento`, así que sumar un comprobante nuevo obligaba a tocar el componente en cuatro
 * lugares distintos —el artículo del texto, la bandera de emitido, la rama de envío y el bloqueo
 * por crédito— y era fácil olvidarse de alguno. Acá se agrega una entrada y no se toca nada más.
 *
 * El componente no sabe qué comprobante está enviando: le pide al adaptador el id del ítem, si ya
 * se emitió y que ejecute el envío.
 */
import {
  asignarDestinatarios,
  asignarDestinatariosFactura,
  asignarDestinatariosRemito,
  comprobanteFacturaGenerado,
  dispararEnvio,
  dispararEnvioFactura,
  dispararEnvioRemito,
  enviarProforma,
  ENVIO_ESTADO,
  ENVIO_FACTURA_ESTADO,
  getPresupuestoPdf,
  getRemitoPdf,
  seguirEnvio,
  seguirEnvioFactura,
  seguirEnvioRemito,
} from '@/services/monday'
import type { AppState } from '@/state/appState'
import type { MedioEnvio } from '@/types'

/** Cómo terminó el intento de envío. Cada motivo lo comunica el componente a su manera. */
export type ResultadoEnvio =
  /** Salió: la automatización del tablero cerró el envío sin error. */
  | { estado: 'ok' }
  /** El PDF todavía no existe en su columna. No es un fallo: hay que esperar y reintentar. */
  | { estado: 'sin-documento' }
  /** El tablero reportó un error de envío (destinatarios, medio, la automatización). */
  | { estado: 'error-envio' }

/** Lo que el envío necesita saber para despachar UN comprobante. */
export interface ComprobanteEnviable {
  /** Clave del catálogo. Es lo que la vista pasa por prop. */
  id: string
  /** Cómo se lo nombra en los textos ("la factura", "el remito"). */
  articulo: 'el' | 'la'
  /** Nombre en minúscula, tal como aparece en los mensajes. */
  nombre: string
  /**
   * Texto con el que el contacto declara que acepta este comprobante, en su columna "Para Enviar"
   * del tablero de Contactos. Se compara normalizado (sin tildes ni mayúsculas) y por inclusión.
   * Sin valor se usa `nombre`, que es lo que coincide para los cuatro comprobantes de hoy.
   */
  etiquetaContacto?: string
  /**
   * Ítem de Monday desde el que se despacha. `null` = todavía no existe, así que no hay nada que
   * enviar (el comprobante no se emitió).
   */
  itemId: (state: AppState) => string | null
  /**
   * El comprobante ya se emitió y por lo tanto se puede enviar. Es una pregunta aparte del
   * `itemId` porque no siempre coinciden: la factura se emite en varios comprobantes y el ítem
   * que se despacha es el de la venta.
   */
  emitido: (state: AppState) => boolean
  /**
   * El envío se frena si el cliente está bloqueado o excedido. El PRESUPUESTO no: es la etapa
   * previa a que exista deuda, así que se envía siempre.
   */
  frenaPorCredito: boolean
  /**
   * Despacha el comprobante: valida que el PDF exista, asigna destinatarios y medio, dispara el
   * envío y sigue la columna de estado hasta que la automatización la cierra.
   *
   * `onProgreso` recibe el estado que va reportando el tablero. Un `throw` acá se toma como fallo
   * de la API y lo comunica la ventana global de error.
   */
  enviar: (args: {
    state: AppState
    itemId: string
    contactoIds: string[]
    medio: MedioEnvio
    onProgreso: (estado: string) => void
  }) => Promise<ResultadoEnvio>
}

/* ===== Los comprobantes que hoy se envían ===== */

const PRESUPUESTO: ComprobanteEnviable = {
  id: 'presupuesto',
  articulo: 'el',
  nombre: 'presupuesto',
  itemId: (s) => s.presupuestoId,
  emitido: (s) => s.documentoEmitido,
  // El presupuesto no compromete crédito: se envía aunque el cliente esté excedido.
  frenaPorCredito: false,
  async enviar({ itemId, contactoIds, medio, onProgreso }) {
    // El PDF vive en la columna file del propio ítem.
    if (!(await getPresupuestoPdf(itemId))) return { estado: 'sin-documento' }
    await asignarDestinatarios(itemId, contactoIds, medio)
    await dispararEnvio(itemId)
    const final = await seguirEnvio(itemId, onProgreso)
    return final === ENVIO_ESTADO.error ? { estado: 'error-envio' } : { estado: 'ok' }
  },
}

const FACTURA: ComprobanteEnviable = {
  id: 'factura',
  articulo: 'la',
  nombre: 'factura',
  /* Se despacha desde el ítem de la VENTA, no desde cada comprobante: el PDF llega ahí por mirror
     y es donde vive el estado de envío. */
  itemId: (s) => s.ventaId,
  emitido: (s) => s.factura.comprobantes.length > 0,
  frenaPorCredito: true,
  async enviar({ itemId, contactoIds, medio, onProgreso }) {
    if (!(await comprobanteFacturaGenerado(itemId))) return { estado: 'sin-documento' }
    await asignarDestinatariosFactura(itemId, contactoIds, medio)
    await dispararEnvioFactura(itemId)
    const final = await seguirEnvioFactura(itemId, onProgreso)
    return final === ENVIO_FACTURA_ESTADO.error ? { estado: 'error-envio' } : { estado: 'ok' }
  },
}

const REMITO: ComprobanteEnviable = {
  id: 'remito',
  articulo: 'el',
  nombre: 'remito',
  itemId: (s) => s.remito.remitoId,
  emitido: (s) => s.documentoEmitido,
  frenaPorCredito: true,
  async enviar({ state, itemId, contactoIds, medio, onProgreso }) {
    if (!(await getRemitoPdf(itemId))) return { estado: 'sin-documento' }
    // Ventas de origen de la mercadería remitada: se aseguran en el link del remito al enviarlo.
    const ventaIds = Array.from(
      new Set(state.remito.items.map((it) => it.ventaId).filter((v): v is string => !!v)),
    )
    await asignarDestinatariosRemito(itemId, contactoIds, medio, ventaIds)
    await dispararEnvioRemito(itemId)
    const final = await seguirEnvioRemito(itemId, onProgreso)
    return /error/i.test(final) ? { estado: 'error-envio' } : { estado: 'ok' }
  },
}

const PROFORMA: ComprobanteEnviable = {
  id: 'proforma',
  articulo: 'la',
  nombre: 'proforma',
  itemId: (s) => s.proformaId,
  emitido: (s) => Boolean(s.proformaId),
  frenaPorCredito: true,
  /* La proforma no expone columna de estado que seguir: la mutación deja el ítem en "Enviar" y la
     automatización se encarga. Sin estado que consultar, se da por despachada. */
  async enviar({ itemId, contactoIds, medio }) {
    await enviarProforma(itemId, contactoIds, medio)
    return { estado: 'ok' }
  },
}

/** Todos los comprobantes enviables, por su clave. */
export const COMPROBANTES_ENVIABLES: Record<string, ComprobanteEnviable> = {
  [PRESUPUESTO.id]: PRESUPUESTO,
  [FACTURA.id]: FACTURA,
  [REMITO.id]: REMITO,
  [PROFORMA.id]: PROFORMA,
}

/**
 * El comprobante que corresponde a una clave. Sin entrada en el catálogo se cae al presupuesto:
 * es preferible enviar de más que romper la pantalla por una clave mal escrita.
 */
export const comprobanteEnviable = (id: string): ComprobanteEnviable =>
  COMPROBANTES_ENVIABLES[id] ?? PRESUPUESTO
