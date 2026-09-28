import type { TipoDocumentoMake } from './envioPresupuesto'

/**
 * Los mensajes que acompañan al PDF en el envío, uno por canal. Los arma la app —ya no el escenario
 * de Make— y viajan en cada destinatario (`destinatarios[].mensaje`), porque el del remito saluda a
 * cada contacto por su nombre. Son los textos de los módulos de Make, tal cual, con los datos ya
 * puestos: WhatsApp con el formato de WhatsApp (*negrita*) y el email en HTML.
 */
export interface MensajesEnvio {
  whatsapp: string
  email: string
}

/** Lo que completa los mensajes. */
export interface DatosMensaje {
  /** Razón social del cliente, sin su código interno (el saludo del presupuesto). */
  razonSocial: string
  /** Nombre y apellido del contacto (el saludo del remito y del email de la proforma). */
  contacto: string
  /** Sólo el nombre de pila del contacto (el saludo del WhatsApp de la proforma). */
  contactoNombre: string
  /** dd/MM/yyyy, como las guarda la app. */
  fechaEmision: string
  fechaVencimiento: string | null
}

/** dd/MM/yyyy tal cual: el email de la proforma usa `formatDate(…; "DD/MM/YYYY")`. */
const conBarras = (ddmmyyyy: string | null): string => ddmmyyyy ?? ''

/** dd/MM/yyyy → DD-MM-YYYY, el formato de los mensajes (`formatDate(…; "DD-MM-YYYY")` en Make). */
export const fechaMensaje = (ddmmyyyy: string | null): string => (ddmmyyyy ?? '').split('/').join('-')

const PLANTILLAS: Record<TipoDocumentoMake, (d: DatosMensaje) => MensajesEnvio> = {
  PRESUPUESTO: (d) => ({
    whatsapp: [
      `👋*¡Hola ${d.razonSocial} !*`,
      `Te adjuntamos el *PRESUPUESTO* emitido el dia ${fechaMensaje(d.fechaEmision)}. Cualquier duda estamos a tu disposicion.`,
      '',
      `*Fecha de Vencimiento:* ${fechaMensaje(d.fechaVencimiento)}`,
      '',
      '*LA BATEA*',
    ].join('\n'),
    email:
      `👋<b>¡Hola ${d.razonSocial}!</b><br>` +
      `Te adjuntamos el <b>presupuesto</b> emitido el <b>Fecha de Emisión:</b> ${fechaMensaje(d.fechaEmision)}. Cualquier duda estamos a tu disposición.<br><br>` +
      `<b>Fecha de Vencimiento:</b> ${fechaMensaje(d.fechaVencimiento)}<br><br>` +
      '<b>LA BATEA</b>',
  }),
  REMITO: (d) => ({
    whatsapp: [
      `👋*¡Hola ${d.contacto}!*`,
      `Te adjuntamos el *REMITO* con 📅*Fecha de emision: ${fechaMensaje(d.fechaEmision)}*. `,
      'Cualquier consulta estamos a tu disposicion.',
      '',
      '*LA BATEA*',
    ].join('\n'),
    email:
      `👋 <b>¡Hola ${d.contacto}!</b><br>` +
      `Te adjuntamos el <b>remito</b> emitido el 📅 <b>Fecha de Emisión:</b> ${fechaMensaje(d.fechaEmision)}. Cualquier duda estamos a tu disposición.<br><br>` +
      '<b>LA BATEA</b>',
  }),
  PROFORMA: (d) => ({
    whatsapp: [
      `👋*¡Hola ${d.contactoNombre}!*`,
      `Te adjuntamos la *Factura Proforma* emitida el dia ${fechaMensaje(d.fechaEmision)}. Cualquier duda estamos a tu disposicion.`,
      '',
      '*LA BATEA*',
    ].join('\n'),
    email:
      `👋 <b>¡Hola ${d.contacto}!</b><br>` +
      `Te adjuntamos la <b>factura Proforma</b> emitida el 📅 <b>Fecha de Emisión:</b> ${conBarras(d.fechaEmision)}. Cualquier duda estamos a tu disposición.<br><br>` +
      '<b>LA BATEA</b>',
  }),
}

/** Los dos mensajes de un documento para un contacto. */
export const mensajesDe = (tipo: TipoDocumentoMake, datos: DatosMensaje): MensajesEnvio =>
  PLANTILLAS[tipo](datos)
