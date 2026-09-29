/**
 * Envío del presupuesto por el escenario de Make: el contrato de datos que recibe el escenario, las
 * validaciones que frenan antes de llamarlo y cómo se lee su respuesta (200 = enviado, 400 = falló
 * con motivo). El webhook no se llama: `fetch` se reemplaza por uno que contesta lo que el caso pide.
 *
 * Se corre con esbuild + node (`npm run test:envio-presupuesto`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import {
  armarEnvioPresupuesto,
  canalesDe,
  canalesPedidos,
  evaluarEnvio,
  fallidosDe,
  mensajeParcial,
  recibioTodo,
  problemasDeContactos,
} from '@/lib/envioPresupuesto'
import { nombrePresupuestoPdf } from '@/features/emision/pdf/generarPresupuestoPdf'
import { cuerpoEnvioPresupuesto, enviarPresupuestoMake } from '@/services/make/envioPresupuesto'
import type { CanalEnvio, Contacto } from '@/types'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.deepEqual(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const contacto = (id: string, name: string, email: string, phone: string, ok = true): Contacto => ({
  id,
  itemId: `9${id}`,
  name,
  email,
  phone,
  ok,
  ini: name.slice(0, 2).toUpperCase(),
  color: '#000',
  status: ok ? 'Presupuesto' : 'Factura',
})

const ana = contacto('1', 'Ana', 'ana@campo.com', '+5492494000001')
const beto = contacto('2', 'Beto', 'beto@campo.com', '')
const caro = contacto('3', 'Caro', '', '+5492494000003')
const dani = contacto('4', 'Dani', '', '')
const eva = contacto('5', 'Eva', 'eva@campo.com', '+5492494000005', false)

const base = {
  jobId: 'job_1',
  numero: 'PRESUP-009',
  fechaEmision: '28/09/2026',
  fechaVencimiento: '13/10/2026',
  archivo: 'Agropecuaria Ñandú S.A.-PRESUP-009.pdf',
  cliente: { id: '111', name: 'Agropecuaria Ñandú S.A.', cuit: '30-71234567-8' },
  vendedor: { id: '222', name: 'Martín Gómez' },
} as const

const datos = armarEnvioPresupuesto({ ...base, medio: 'Ambos', contactos: [ana, beto, caro] })

async function main() {
  console.log('Caso 1 · El contrato que recibe Make:')
  igual(datos.documento, {
    tipo: 'PRESUPUESTO',
    numero: 'PRESUP-009',
    fechaEmision: '2026-09-28',
    fechaVencimiento: '2026-10-13',
    archivo: 'Agropecuaria Ñandú S.A.-PRESUP-009.pdf',
  }, 'documento con fechas ISO y sin importes')
  igual(datos.appJobId, 'job_1', 'el id del envío viaja como appJobId')
  igual(datos.vendedor, { pulseId: '222', nombre: 'Martín Gómez' }, 'vendedor')
  igual(datos.cliente, { pulseId: '111', razonSocial: 'Agropecuaria Ñandú S.A.', cuit: '30-71234567-8' }, 'cliente')
  const { mensaje: mensajeAna, ...ana0 } = datos.destinatarios[0]
  igual(ana0, {
    pulseId: '91',
    nombre: 'Ana',
    email: 'ana@campo.com',
    whatsapp: '+5492494000001',
    canales: ['email', 'whatsapp'],
  }, 'con "Ambos" y los dos datos, va por los dos canales')

  console.log('\nCaso 1b · El mensaje que acompaña al PDF, ya completo en cada destinatario:')
  igual(
    mensajeAna.whatsapp,
    '👋*¡Hola Agropecuaria Ñandú S.A. !*\n' +
      'Te adjuntamos el *PRESUPUESTO* emitido el dia 28-09-2026. Cualquier duda estamos a tu disposicion.\n' +
      '\n' +
      '*Fecha de Vencimiento:* 13-10-2026\n' +
      '\n' +
      '*LA BATEA*',
    'presupuesto por WhatsApp: saluda al cliente, con las dos fechas en DD-MM-YYYY',
  )
  igual(mensajeAna.email.subject, 'LA BATEA - Presupuesto Emitido: 28-09-2026', 'asunto del email del presupuesto')
  igual(
    mensajeAna.email.content,
    '👋<b>¡Hola Agropecuaria Ñandú S.A.!</b><br>' +
      'Te adjuntamos el <b>presupuesto</b> emitido el <b>Fecha de Emisión:</b> 28-09-2026. Cualquier duda estamos a tu disposición.<br><br>' +
      '<b>Fecha de Vencimiento:</b> 13-10-2026<br><br>' +
      '<b>LA BATEA</b>',
    'presupuesto por email, en HTML',
  )
  igual(
    datos.destinatarios[1].mensaje.whatsapp.split('\n')[0],
    '👋*¡Hola Agropecuaria Ñandú S.A. !*',
    'en el presupuesto, todos los contactos reciben el saludo al cliente',
  )
  const remitoMsj = armarEnvioPresupuesto({
    ...base,
    tipo: 'REMITO',
    numero: '0091-00000007',
    fechaVencimiento: null,
    medio: 'Ambos',
    contactos: [ana, beto],
  })
  igual(
    remitoMsj.destinatarios[0].mensaje.whatsapp,
    '👋*¡Hola Ana!*\n' +
      'Te adjuntamos el *REMITO* con 📅*Fecha de emision: 28-09-2026*. \n' +
      'Cualquier consulta estamos a tu disposicion.\n' +
      '\n' +
      '*LA BATEA*',
    'remito por WhatsApp: saluda a cada contacto por su nombre',
  )
  igual(
    remitoMsj.destinatarios[1].mensaje.email.content,
    '👋 <b>¡Hola Beto!</b><br>' +
      'Te adjuntamos el <b>remito</b> emitido el 📅 <b>Fecha de Emisión:</b> 28-09-2026. Cualquier duda estamos a tu disposición.<br><br>' +
      '<b>LA BATEA</b>',
    'remito por email: el de Beto lo saluda a él',
  )
  igual(remitoMsj.destinatarios[1].mensaje.email.subject, 'LA BATEA - Remito Emitido: 28-09-2026', 'asunto del email del remito')
  igual(
    [datos.tipo_de_envio_email, remitoMsj.tipo_de_envio_email],
    ['gmail', 'gmail'],
    'tipo_de_envio_email: gmail para presupuesto y remito',
  )
  igual(datos.destinatarios[1].canales, ['email'], 'con "Ambos" y sólo email, va sólo por email')
  igual(datos.destinatarios[1].whatsapp, null, 'el dato que falta viaja como null, no como ""')
  igual(datos.destinatarios[2].canales, ['whatsapp'], 'con "Ambos" y sólo WhatsApp, va sólo por WhatsApp')

  console.log('\nCaso 2 · Los canales según el medio elegido:')
  igual(canalesDe(ana, 'Email'), ['email'], 'Email → sólo email, aunque tenga WhatsApp')
  igual(canalesDe(ana, 'WhatsApp'), ['whatsapp'], 'WhatsApp → sólo WhatsApp')
  igual(canalesDe(dani, 'Ambos'), [], 'sin ningún dato no hay canal')

  console.log('\nCaso 3 · Qué frena el envío antes de llamar a Make:')
  igual(problemasDeContactos([ana, beto], 'Email', 'presupuesto'), [], 'todos aceptan y tienen email: se envía')
  igual(problemasDeContactos([ana, caro], 'Email', 'presupuesto'), [
    'Caro: no tiene un email cargado. Cargáselo en Monday, cambiá el medio de envío o quitalo de la lista.',
  ], 'medio Email y un contacto sin email')
  igual(problemasDeContactos([beto], 'WhatsApp', 'presupuesto'), [
    'Beto: no tiene un número de WhatsApp cargado. Cargáselo en Monday, cambiá el medio de envío o quitalo de la lista.',
  ], 'medio WhatsApp y un contacto sin número')
  igual(problemasDeContactos([beto, caro], 'Ambos', 'presupuesto'), [], 'con "Ambos" alcanza con uno de los dos datos')
  igual(problemasDeContactos([dani], 'Ambos', 'presupuesto'), [
    'Dani: no tiene ni email ni número de WhatsApp cargado. Cargale uno en Monday o quitalo de la lista.',
  ], 'con "Ambos" y ningún dato, frena')
  igual(problemasDeContactos([eva], 'Email', 'presupuesto'), [
    'Eva: no acepta recibir presupuestos. Quitalo de la lista.',
  ], 'un contacto que no acepta presupuestos frena aunque tenga los datos')

  console.log('\nCaso 4 · El cuerpo es la estructura en la raíz, con el PDF en base64:')
  const pdf = new File([new Uint8Array([37, 80, 68, 70])], datos.documento.archivo, { type: 'application/pdf' })
  const cuerpo = await cuerpoEnvioPresupuesto(datos, pdf)
  igual(
    Object.keys(cuerpo),
    ['appJobId', 'documento', 'cliente', 'vendedor', 'medio', 'tipo_de_envio_email', 'reenvio_email', 'reenvio_whatsapp', 'destinatarios', 'adjuntos', 'pdf'],
    'las claves de la raíz son las de la estructura, más "pdf"',
  )
  igual(
    cuerpo.pdf,
    { name: 'Agropecuaria Ñandú S.A.-PRESUP-009.pdf', mime: 'application/pdf', data: 'JVBERg==' },
    'el PDF con su nombre, su tipo y el contenido en base64 ("%PDF" → JVBERg==)',
  )
  igual(cuerpo.adjuntos, [cuerpo.pdf], 'adjuntos: un array aunque haya un solo documento, y `pdf` es el primero')
  const segundo = new File([new Uint8Array([37, 80, 68, 70, 45])], 'Factura A 0003-00000124.pdf', { type: 'application/pdf' })
  const conDos = await cuerpoEnvioPresupuesto(datos, [pdf, segundo])
  igual(
    conDos.adjuntos.map((a) => a.name),
    ['Agropecuaria Ñandú S.A.-PRESUP-009.pdf', 'Factura A 0003-00000124.pdf'],
    'con varios documentos (p. ej. las facturas de una venta con consignada), van todos, en orden',
  )
  igual(conDos.adjuntos[1].data, 'JVBERi0=', 'cada uno con su propio contenido')

  let pedido: { tipo: string | null; cuerpo: unknown } | null = null
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    pedido = {
      tipo: new Headers(init.headers).get('content-type'),
      cuerpo: JSON.parse(String(init.body)),
    }
    return new Response('Accepted', { status: 200 })
  }) as unknown as typeof fetch
  await enviarPresupuestoMake(datos, pdf)
  const enviado = pedido as { tipo: string | null; cuerpo: unknown } | null
  igual(enviado?.tipo, 'application/json', 'viaja como application/json, no como multipart')
  igual(enviado?.cuerpo, cuerpo, 'y lo que viaja es exactamente ese cuerpo')

  console.log('\nCaso 5 · reenvio_email / reenvio_whatsapp dicen qué mandar en este pedido:')
  igual([datos.reenvio_email, datos.reenvio_whatsapp], [true, true], 'primer envío con "Ambos": los dos canales')
  const soloEmail = armarEnvioPresupuesto({ ...base, medio: 'Email', contactos: [ana] })
  igual([soloEmail.reenvio_email, soloEmail.reenvio_whatsapp], [true, false], 'con "Email": sólo email')
  const reintento = armarEnvioPresupuesto({
    ...base,
    medio: 'Ambos',
    contactos: [ana, beto, caro],
    yaEnviados: { '91': ['email'], '92': ['email'] },
  })
  igual(
    [reintento.reenvio_email, reintento.reenvio_whatsapp],
    [false, true],
    'tras un parcial que ya les llegó por email: sólo se pide WhatsApp',
  )
  igual(
    reintento.destinatarios.map((d) => [d.nombre, d.canales]),
    [['Ana', ['whatsapp']], ['Caro', ['whatsapp']]],
    'a nadie se le vuelve a pedir el email, y a Beto (que ya recibió todo) ni se lo manda',
  )
  const reintentoUno = armarEnvioPresupuesto({
    ...base,
    medio: 'Ambos',
    contactos: [ana, caro],
    yaEnviados: { '91': ['email', 'whatsapp'] },
  })
  igual(
    reintentoUno.destinatarios.map((d) => d.nombre),
    ['Caro'],
    'si a Ana ya le llegó todo, el reintento va sólo a Caro (la de la cruz roja)',
  )

  console.log('\nCaso 5d · El remito va por el mismo escenario, con su tipo:')
  const remito = armarEnvioPresupuesto({
    ...base,
    tipo: 'REMITO',
    numero: '0091-00000007',
    archivo: 'Agropecuaria Ñandú S.A.-REMITO 0091-00000007.pdf',
    fechaVencimiento: null,
    medio: 'Email',
    contactos: [ana],
  })
  igual(
    remito.documento,
    {
      tipo: 'REMITO',
      numero: '0091-00000007',
      fechaEmision: '2026-09-28',
      fechaVencimiento: null,
      archivo: 'Agropecuaria Ñandú S.A.-REMITO 0091-00000007.pdf',
    },
    'documento.tipo = "REMITO", sin vencimiento',
  )
  igual(datos.documento.tipo, 'PRESUPUESTO', 'el presupuesto sigue saliendo como "PRESUPUESTO"')

  console.log('\nCaso 5c · El estado de cada fila:')
  const enviadosAna = { '91': ['email', 'whatsapp'] as CanalEnvio[], '92': ['email'] as CanalEnvio[] }
  igual(recibioTodo(ana, 'Ambos', enviadosAna), true, 'Ana recibió email y WhatsApp → tilde verde')
  igual(recibioTodo(beto, 'Ambos', enviadosAna), true, 'Beto sólo tiene email y lo recibió → tilde verde')
  igual(recibioTodo(caro, 'Ambos', enviadosAna), false, 'a Caro no le llegó nada → sin tilde')
  igual(recibioTodo(ana, 'Email', { '91': ['whatsapp'] }), false, 'con "Email", haber recibido el WhatsApp no alcanza')
  igual(
    fallidosDe([
      { pulseId: '93', nombre: 'Caro', canal: 'whatsapp', motivo: 'el número no tiene WhatsApp' },
      { pulseId: '91', nombre: 'Ana', canal: 'email' },
      { pulseId: '93', nombre: 'Caro', canal: 'email' },
    ]),
    { '93': 'el número no tiene WhatsApp', '91': 'no se pudo enviar por email' },
    'la cruz roja de cada contacto que falló, con el motivo de su primera falla',
  )
  const sinWhatsapp = armarEnvioPresupuesto({ ...base, medio: 'Ambos', contactos: [beto] })
  igual(
    [sinWhatsapp.reenvio_email, sinWhatsapp.reenvio_whatsapp],
    [true, true],
    'primer envío: las banderas salen sólo del medio ("Ambos" → las dos), aunque nadie tenga WhatsApp',
  )
  igual(
    evaluarEnvio(sinWhatsapp, { email: [{ ok: true }], whatsapp: [] }).estado,
    'ok',
    'y si nadie tenía WhatsApp, que no vuelva ninguno no es un envío parcial',
  )
  const soloWhatsapp = armarEnvioPresupuesto({ ...base, medio: 'WhatsApp', contactos: [ana] })
  igual([soloWhatsapp.reenvio_email, soloWhatsapp.reenvio_whatsapp], [false, true], 'con "WhatsApp": sólo WhatsApp')

  console.log('\nCaso 5b · La razón social va sin el código interno del cliente:')
  const conCodigo = armarEnvioPresupuesto({
    ...base,
    cliente: { id: '111', name: '4077 - RAYCLE S.A. (LA GLICINA)', cuit: '30-1' },
    medio: 'Email',
    contactos: [ana],
  })
  igual(conCodigo.cliente.razonSocial, 'RAYCLE S.A. (LA GLICINA)', '"4077 - RAYCLE S.A. (LA GLICINA)" → "RAYCLE S.A. (LA GLICINA)"')
  igual(datos.cliente.razonSocial, 'Agropecuaria Ñandú S.A.', 'un nombre sin código queda igual')
  igual(
    nombrePresupuestoPdf('2 - ZUBIAURRE S.A.', 'PRESUP-009'),
    'ZUBIAURRE S.A.-PRESUP-009',
    'el nombre del PDF tampoco lleva el código',
  )

  console.log('\nCaso 6 · Un 200 no alcanza: cuenta cada contacto por cada canal:')
  // `datos`: Ana (email + WhatsApp), Beto (email), Caro (WhatsApp).
  const r = (...oks: boolean[]) => oks.map((ok) => ({ ok }))
  igual(
    evaluarEnvio(datos, { email: r(true, true), whatsapp: r(true, true) }),
    { estado: 'ok', enviados: { '91': ['email', 'whatsapp'], '92': ['email'], '93': ['whatsapp'] } },
    'todo confirmado → enviado',
  )
  const parcialCanal = evaluarEnvio(datos, { email: r(true, true), whatsapp: r(false, false) })
  igual(parcialCanal.estado, 'parcial', 'emails sí y ningún WhatsApp → parcial')
  igual(
    parcialCanal.estado === 'parcial' && mensajeParcial(parcialCanal.fallas, parcialCanal.enviados),
    'El presupuesto se envió por email, pero no por WhatsApp. Volvé a tocar el botón para completar el envío por WhatsApp: por email no se manda de nuevo.',
    'falló un canal entero: se dice por canal',
  )
  const parcialUno = evaluarEnvio(datos, {
    email: r(true, true),
    whatsapp: [{ ok: true }, { ok: false, motivo: 'el número no tiene WhatsApp' }],
  })
  igual(
    parcialUno.estado === 'parcial' && mensajeParcial(parcialUno.fallas, parcialUno.enviados),
    'El presupuesto no les llegó a todos. Faltó: Caro por WhatsApp (el número no tiene WhatsApp). Volvé a tocar el botón para reintentar sólo lo que faltó: lo que ya salió no se manda de nuevo.',
    'el WhatsApp le llegó a Ana y a Caro no: se dice a quién le faltó',
  )
  igual(
    evaluarEnvio(datos, { email: r(true), whatsapp: r(true, true) }).estado,
    'parcial',
    'si el escenario devuelve menos ítems que contactos, al que falta no se lo da por enviado',
  )
  igual(
    evaluarEnvio(datos, { email: r(false, false), whatsapp: r(false, false) }),
    {
      estado: 'error',
      fallas: [
        { pulseId: '91', nombre: 'Ana', canal: 'email' },
        { pulseId: '92', nombre: 'Beto', canal: 'email' },
        { pulseId: '91', nombre: 'Ana', canal: 'whatsapp' },
        { pulseId: '93', nombre: 'Caro', canal: 'whatsapp' },
      ],
    },
    'nada confirmado → error',
  )
  igual(
    evaluarEnvio(datos, {
      email: [
        { ok: false, pulseId: '92' },
        { ok: true, pulseId: '91' },
      ],
      whatsapp: r(true, true),
    }),
    {
      estado: 'parcial',
      enviados: { '91': ['email', 'whatsapp'], '93': ['whatsapp'] },
      fallas: [{ pulseId: '92', nombre: 'Beto', canal: 'email' }],
    },
    'con pulseId en los ítems se empareja por él, no por orden',
  )
  igual(
    evaluarEnvio(reintento, { email: [], whatsapp: r(true, true) }, { '91': ['email'], '92': ['email'] }),
    { estado: 'ok', enviados: { '91': ['email', 'whatsapp'], '92': ['email'], '93': ['whatsapp'] } },
    'el reintento que completa los WhatsApp → enviado a todos',
  )
  igual(canalesPedidos(reintento), ['whatsapp'], 'los canales pedidos salen de las banderas de reenvío')

  console.log('\nCaso 7 · La respuesta del escenario:')
  const responde = (status: number, cuerpo: string) => {
    globalThis.fetch = (async () => new Response(cuerpo, { status })) as typeof fetch
  }
  const bundle = {
    operacion: 'ENVIO PRESUPUESTO',
    medio: 'Ambos',
    mensajeError: null,
    enviosWhatsapp: [{ messageId: null, envio_whatsapp: true }],
    enviosEmail: [{ envio_email: true }],
  }
  responde(200, JSON.stringify(bundle))
  igual(
    await enviarPresupuestoMake(datos, pdf),
    { tipo: 'respuesta', resultados: { email: [{ ok: true }], whatsapp: [{ ok: true }] } },
    'el bundle del módulo 55: un ítem por contacto en cada array',
  )
  responde(
    200,
    JSON.stringify({
      ...bundle,
      enviosWhatsapp: JSON.stringify([{ messageId: 'f4376401-c710', envio_whatsapp: 'false' }]),
      enviosEmail: JSON.stringify([{ envio_email: 'true' }]),
    }),
  )
  igual(
    await enviarPresupuestoMake(datos, pdf),
    {
      tipo: 'respuesta',
      resultados: {
        email: [{ ok: true }],
        whatsapp: [{ ok: false, mensajes: [{ id: 'f4376401-c710', parte: 'documento' }] }],
      },
    },
    'formato anterior: los arrays serializados como texto y las banderas "true"/"false" valen igual',
  )

  // El bundle real del módulo 65: un mensaje de texto y los documentos, cada uno con su id.
  const modulo65 = [
    {
      nombre: 'Luciano 1',
      pulseId: '12587733631',
      envio_mensaje_texto: { phonenumber: '5492494014611', id: '17c38bea-edd2-40ac-bba9-d3382595dbf4' },
      envio_mensaje_documentos: [{ data: { phonenumber: '5492494014611', id: '388de5da-4aeb-4314-b05e-97c638fc93ef' } }],
    },
  ]
  for (const clave of ['enviosWhatsapp', 'enviados_whatsapp']) {
    responde(200, JSON.stringify({ operacion: 'ENVIO', medio: 'Ambos', mensajeError: null, enviosEmail: [], [clave]: modulo65 }))
    igual(
      await enviarPresupuestoMake(datos, pdf),
      {
        tipo: 'respuesta',
        resultados: {
          email: [],
          whatsapp: [
            {
              ok: true,
              pulseId: '12587733631',
              mensajes: [
                { id: '17c38bea-edd2-40ac-bba9-d3382595dbf4', parte: 'texto' },
                { id: '388de5da-4aeb-4314-b05e-97c638fc93ef', parte: 'documento' },
              ],
            },
          ],
        },
      },
      `formato nuevo (en "${clave}"): el id del texto y el de cada documento, para confirmarlos todos`,
    )
  }
  responde(
    200,
    JSON.stringify({
      enviosWhatsapp: [{ pulseId: '1', envio_mensaje_texto: { id: 't1' }, envio_mensaje_documentos: [] }],
    }),
  )
  igual(
    await enviarPresupuestoMake(datos, pdf),
    {
      tipo: 'respuesta',
      resultados: {
        email: [],
        whatsapp: [{ ok: false, pulseId: '1', mensajes: [{ id: 't1', parte: 'texto' }], motivo: 'no se envió el PDF por WhatsApp' }],
      },
    },
    'si falta el documento, el WhatsApp no cuenta como enviado',
  )
  responde(200, 'Accepted')
  igual(
    await enviarPresupuestoMake(datos, pdf),
    { tipo: 'respuesta', resultados: { email: [], whatsapp: [] } },
    '200 sin JSON → nada confirmado',
  )
  responde(
    400,
    JSON.stringify({
      ...bundle,
      mensajeError: 'El número +5492494000001 no tiene WhatsApp.',
      enviosWhatsapp: [{ envio_whatsapp: false }],
    }),
  )
  igual(
    await enviarPresupuestoMake(datos, pdf),
    {
      tipo: 'respuesta',
      resultados: { email: [{ ok: true }], whatsapp: [{ ok: false }] },
      mensaje: 'El número +5492494000001 no tiene WhatsApp.',
    },
    '400 del contrato → resultados y mensajeError',
  )
  responde(400, JSON.stringify({ error: 'El contacto Ana tiene un email inválido.' }))
  igual(
    await enviarPresupuestoMake(datos, pdf),
    { tipo: 'respuesta', resultados: { email: [], whatsapp: [] }, mensaje: 'El contacto Ana tiene un email inválido.' },
    '400 sin el contrato → el motivo se busca en las claves genéricas',
  )
  responde(404, '')
  igual(
    await enviarPresupuestoMake(datos, pdf),
    { tipo: 'fallo', mensaje: 'El servicio de envío de presupuestos no está configurado.' },
    '404 → el webhook no está configurado',
  )
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed')
  }) as typeof fetch
  igual(
    await enviarPresupuestoMake(datos, pdf),
    { tipo: 'fallo', mensaje: 'No se pudo conectar con el servidor. Revisá la conexión y reintentá.' },
    'sin conexión → se avisa, sin reintentar solo',
  )

  console.log(`\nOK · envío del presupuesto por Make (${asserts} verificaciones)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
