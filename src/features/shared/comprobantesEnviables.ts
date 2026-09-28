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
  asignarDestinatariosFactura,
  comprobanteFacturaGenerado,
  dispararEnvioFactura,
  ENVIO_FACTURA_ESTADO,
  numeroRemito,
  seguirEnvioFactura,
} from '@/services/monday'
import {
  armarEnvioPresupuesto,
  canalesPedidos,
  detalleFallas,
  evaluarEnvio,
  fallidosDe,
  mensajeParcial,
  tituloError,
  type EnviadosPorContacto,
  type TipoDocumentoMake,
  type ResultadoEntrega,
} from '@/lib/envioPresupuesto'
import { NRO_PRESUPUESTO } from '@/data/mock'
import { addDays } from '@/lib/dates'
import { enviarPresupuestoMake, nuevoJobId } from '@/services/make'
import { confirmarWhatsapp } from '@/services/whatsapp/estadoMensaje'
import type { AppState } from '@/state/appState'
import type { MedioEnvio } from '@/types'

/** Cómo terminó el intento de envío. Cada motivo lo comunica el componente a su manera. */
export type ResultadoEnvio =
  /**
   * Salió: la automatización cerró el envío sin error. `enviados`: qué le llegó a cada contacto,
   * cuando el comprobante lo informa (el presupuesto); el componente lo guarda en el estado.
   */
  | { estado: 'ok'; enviados?: EnviadosPorContacto }
  /**
   * Algo salió y algo no (presupuesto): un canal entero, o un canal para algunos contactos. El botón
   * queda en amarillo y habilitado: reintentar pide sólo lo que faltó.
   */
  | {
      estado: 'parcial'
      enviados: EnviadosPorContacto
      mensaje: string
      /** Contactos a los que no les llegó (pulseId → motivo): la cruz roja de su fila. */
      fallidos: Record<string, string>
    }
  /** El PDF todavía no existe en su columna. No es un fallo: hay que esperar y reintentar. */
  | { estado: 'sin-documento' }
  /**
   * El envío falló (destinatarios, medio, la automatización). Con `mensaje`, el motivo ya viene
   * redactado para el usuario —lo manda el escenario de Make— y se muestra tal cual al lado del
   * botón. Sin él, es un fallo del tablero y lo comunica la ventana global de error de Monday.
   */
  | {
      estado: 'error-envio'
      mensaje?: string
      titulo?: string
      /** Contactos a los que no les llegó, cuando el comprobante lo informa (el presupuesto). */
      fallidos?: Record<string, string>
    }

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
   * `false` cuando el envío NO sale de un ítem de Monday: el presupuesto se manda por Make con el PDF
   * que generó la app, antes de registrarse en el tablero. Ahí `itemId` puede ser `null` y no frena.
   */
  despachaDesdeItem?: false
  /**
   * Antes de enviar, exige que TODOS los contactos elegidos acepten el comprobante y tengan el dato
   * que pide el medio; si no, se frena con una ventana que dice qué cambiar. Sin esto, sólo se frena
   * por el dato faltante y se avisa al lado del botón.
   */
  validaContactos?: boolean
  /**
   * El resultado se informa contacto por contacto (el presupuesto): cada fila muestra su estado
   * —cargando, tilde verde o cruz roja—, el reintento va sólo a los que faltan y, desde el primer
   * envío, no se puede quitar a nadie de la lista.
   */
  estadoPorContacto?: boolean
  /** Ventana que se muestra al querer enviar sin haber emitido. Sin esto, se usa la genérica. */
  avisoNoEmitido?: { titulo: string; texto: string }
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

/**
 * El presupuesto se envía por un escenario de Make, NO desde Monday: el PDF lo genera la app al
 * emitir y el ítem recién nace al registrar, así que al momento de enviar no hay ítem del cual
 * despachar. Se le manda al escenario el PDF y los datos del envío (ver `EnvioPresupuestoMake`), y
 * el escenario contesta 200 o 400.
 */
const PRESUPUESTO: ComprobanteEnviable = {
  id: 'presupuesto',
  articulo: 'el',
  nombre: 'presupuesto',
  itemId: (s) => s.presupuestoId,
  despachaDesdeItem: false,
  estadoPorContacto: true,
  // Emitido = el PDF ya se generó en la app.
  emitido: (s) => s.presupuestoPdf != null,
  validaContactos: true,
  avisoNoEmitido: {
    titulo: 'Primero generá el presupuesto PDF',
    texto:
      'Todavía no se generó el PDF del presupuesto, así que no hay nada que enviar. Tocá "Emitir Presupuesto" y, cuando esté listo, volvé a enviar.',
  },
  // El presupuesto no compromete crédito: se envía aunque el cliente esté excedido.
  frenaPorCredito: false,
  async enviar({ state, medio }) {
    const pdf = state.presupuestoPdf
    if (!pdf || !state.cliente) return { estado: 'sin-documento' }
    return enviarPorMake(state, medio, pdf, {
      tipo: 'PRESUPUESTO',
      numero: state.nroPresupuesto ?? NRO_PRESUPUESTO,
      fechaVencimiento: addDays(state.fechaEmision, state.diasVigencia),
    })
  },
}

/** Cómo se nombra cada documento en los avisos del envío. */
const SUJETO: Record<TipoDocumentoMake, string> = {
  PRESUPUESTO: 'El presupuesto',
  REMITO: 'El remito',
  PROFORMA: 'La proforma',
}

/**
 * Envío de un documento que generó la app por el escenario de Make: el mismo para el presupuesto y
 * el remito. Arma el pedido (sólo lo que le falta a cada contacto), lo manda, confirma cada WhatsApp
 * contra 360Messenger y evalúa contacto por contacto.
 */
async function enviarPorMake(
  state: AppState,
  medio: MedioEnvio,
  pdf: File,
  doc: {
    tipo: TipoDocumentoMake
    numero: string
    fechaVencimiento: string | null
  },
): Promise<ResultadoEnvio> {
  if (!state.cliente) return { estado: 'sin-documento' }
  const datos = armarEnvioPresupuesto({
    jobId: nuevoJobId(),
    tipo: doc.tipo,
    numero: doc.numero,
    fechaEmision: state.fechaEmision,
    fechaVencimiento: doc.fechaVencimiento,
    archivo: pdf.name,
    cliente: state.cliente,
    vendedor: state.vendedor,
    medio,
    contactos: state.contactos,
    // Tras un envío parcial, lo que ya le llegó a cada contacto no se vuelve a pedir.
    yaEnviados: state.enviadosPorContacto,
  })
  // Ya le llegó a cada uno todo lo que pide el medio actual: no hay nada que mandar.
  if (canalesPedidos(datos).length === 0) return { estado: 'ok', enviados: state.enviadosPorContacto }
  const respuesta = await enviarPresupuestoMake(datos, pdf)
  /* No se sabe qué pasó del otro lado: a nadie de este pedido se lo da por enviado, y todos llevan
     la cruz con el motivo. */
  if (respuesta.tipo === 'fallo') {
    return {
      estado: 'error-envio',
      mensaje: respuesta.mensaje,
      fallidos: Object.fromEntries(datos.destinatarios.map((d) => [d.pulseId, respuesta.mensaje])),
    }
  }

  /* Un 200 no alcanza: cuenta cada ítem de `enviosEmail` / `enviosWhatsapp`. Y que Make diga que
     mandó un WhatsApp tampoco: cada uno se confirma contra 360Messenger. */
  const resultados = {
    email: respuesta.resultados.email,
    whatsapp: await verificarWhatsapps(respuesta.resultados.whatsapp),
  }
  const evaluacion = evaluarEnvio(datos, resultados, state.enviadosPorContacto)
  if (evaluacion.estado === 'ok') return { estado: 'ok', enviados: evaluacion.enviados }
  if (evaluacion.estado === 'parcial') {
    return {
      estado: 'parcial',
      enviados: evaluacion.enviados,
      mensaje: mensajeParcial(
        evaluacion.fallas,
        evaluacion.enviados,
        respuesta.mensaje,
        SUJETO[doc.tipo],
      ),
      fallidos: fallidosDe(evaluacion.fallas),
    }
  }
  return {
    estado: 'error-envio',
    titulo: tituloError(evaluacion.fallas),
    fallidos: fallidosDe(evaluacion.fallas),
    mensaje:
      respuesta.mensaje ||
      (evaluacion.fallas.some((f) => f.motivo)
        ? `No llegó: ${detalleFallas(evaluacion.fallas)}.`
        : 'El servicio no confirmó el envío. Probá de nuevo en unos minutos.'),
  }
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

/**
 * El remito, igual que el presupuesto: los PDF los genera la app al emitir y el de VENTA se manda por
 * el mismo escenario de Make (`documento.tipo = "REMITO"`), antes de que el remito exista en el
 * tablero. El PREIMPRESO no se envía: se guarda en el remito al registrarlo.
 */
const REMITO: ComprobanteEnviable = {
  id: 'remito',
  articulo: 'el',
  nombre: 'remito',
  itemId: (s) => s.remito.remitoId,
  despachaDesdeItem: false,
  estadoPorContacto: true,
  // Emitido = los PDF ya se generaron en la app.
  emitido: (s) => s.remitoPdfs != null,
  validaContactos: true,
  avisoNoEmitido: {
    titulo: 'Primero generá el remito PDF',
    texto:
      'Todavía no se generó el PDF del remito, así que no hay nada que enviar. Tocá "Emitir Remito" y, cuando esté listo, volvé a enviar.',
  },
  frenaPorCredito: true,
  async enviar({ state, medio }) {
    const pdf = state.remitoPdfs?.venta
    const hoja = state.remitoHoja
    if (!pdf || !hoja) return { estado: 'sin-documento' }
    return enviarPorMake(state, medio, pdf, {
      tipo: 'REMITO',
      numero: numeroRemito(hoja.imprenta),
      // El remito no vence.
      fechaVencimiento: null,
    })
  },
}

/**
 * La factura proforma de la venta CONTADO, igual que el presupuesto: el PDF lo genera la app al
 * emitir y se manda por el mismo escenario de Make (`documento.tipo = "PROFORMA"`), antes de que la
 * proforma exista en el tablero. Se registra después, con "Registrar Proforma".
 */
const PROFORMA: ComprobanteEnviable = {
  id: 'proforma',
  articulo: 'la',
  nombre: 'proforma',
  itemId: (s) => s.proformaId,
  despachaDesdeItem: false,
  estadoPorContacto: true,
  // Emitida = el PDF ya se generó en la app.
  emitido: (s) => s.proformaPdf != null,
  validaContactos: true,
  avisoNoEmitido: {
    titulo: 'Primero generá la proforma PDF',
    texto:
      'Todavía no se generó el PDF de la factura proforma, así que no hay nada que enviar. Tocá "Emitir Factura Proforma" y, cuando esté listo, volvé a enviar.',
  },
  frenaPorCredito: true,
  async enviar({ state, medio }) {
    const pdf = state.proformaPdf
    if (!pdf) return { estado: 'sin-documento' }
    return enviarPorMake(state, medio, pdf, {
      tipo: 'PROFORMA',
      numero: state.nroProforma ?? 'PROFORMA',
      // La proforma no vence.
      fechaVencimiento: null,
    })
  },
}

/**
 * Confirma contra 360Messenger cada WhatsApp que Make dio por enviado. Se consultan todos a la vez.
 *
 * Un WhatsApp cuenta como enviado SÓLO si 360Messenger lo confirma. Si dice que falló, o si no se
 * puede confirmar (sin `messageId`, sin la key, 360Messenger caído, o sigue en cola al terminar la
 * espera), ese envío queda como no enviado —y el total, según el caso, en error o parcial— con un
 * motivo que lo distingue. Antes, lo que no se podía confirmar se daba por bueno, y un número
 * inexistente salió como "enviado exitosamente".
 */
export async function verificarWhatsapps(
  items: readonly ResultadoEntrega[],
  /** Cada cuánto y cuántas veces se pregunta mientras siga en cola (ver `confirmarWhatsapp`). */
  espera?: { intentos?: number; intervalo?: number },
): Promise<ResultadoEntrega[]> {
  return Promise.all(
    items.map(async (item): Promise<ResultadoEntrega> => {
      if (!item.ok) return item
      if (!item.messageId) {
        console.warn('Make confirmó un WhatsApp sin messageId: no se puede verificar en 360Messenger.')
        return { ...item, ok: false, motivo: 'no se pudo confirmar el envío en 360Messenger' }
      }
      const confirmacion = await confirmarWhatsapp(item.messageId, espera)
      if (confirmacion.estado === 'enviado') return item
      if (confirmacion.estado === 'fallido') return { ...item, ok: false, motivo: confirmacion.motivo }
      /* Sin confirmar no es lo mismo que fallido: el mensaje puede salir igual un rato después. El
         motivo lo dice, para que el vendedor revise antes de reintentar y no lo mande dos veces. */
      console.warn(
        `WhatsApp ${item.messageId} sin confirmar en 360Messenger (${
          confirmacion.estado === 'pendiente' ? 'sigue en cola' : confirmacion.motivo
        }).`,
      )
      return {
        ...item,
        ok: false,
        motivo:
          confirmacion.estado === 'pendiente'
            ? 'WhatsApp todavía no confirmó la entrega; revisá en unos minutos si llegó antes de reintentar'
            : 'no se pudo confirmar el envío en 360Messenger',
      }
    }),
  )
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
