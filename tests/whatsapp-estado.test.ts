/**
 * Confirmación del WhatsApp del presupuesto contra 360Messenger (`GET /v2/message/status`): cómo se
 * lee cada estado, la espera mientras el mensaje sigue en cola, y qué pasa con el envío cuando
 * 360Messenger dice que falló o no lo confirma. `fetch` se reemplaza por uno que contesta lo que pide
 * cada caso, con la forma REAL de la API (el estado en `data`).
 *
 * Se corre con esbuild + node (`npm run test:whatsapp-estado`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { verificarWhatsapps } from '@/features/shared/comprobantesEnviables'
import { armarEnvioPresupuesto, evaluarEnvio, mensajeParcial } from '@/lib/envioPresupuesto'
import { clasificarEstado, confirmarWhatsapp } from '@/services/whatsapp/estadoMensaje'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.deepEqual(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}

/**
 * 360Messenger contesta, en orden, los estados de la lista (el último se repite); un número es un
 * código HTTP. `envoltorio`: la clave donde viaja el estado —la API real usa `data`—. Cuenta las
 * consultas.
 */
function contesta(...respuestas: (object | number)[]) {
  return contestaEn('data', ...respuestas)
}
function contestaEn(envoltorio: 'data' | 'result', ...respuestas: (object | number)[]) {
  let i = 0
  const pedidos: string[] = []
  globalThis.fetch = (async (url: string) => {
    pedidos.push(url)
    const r = respuestas[Math.min(i++, respuestas.length - 1)]
    if (typeof r === 'number') return new Response(JSON.stringify({ success: false, statusCode: r }), { status: r })
    return new Response(JSON.stringify({ success: true, [envoltorio]: r, statusCode: 200 }), { status: 200 })
  }) as unknown as typeof fetch
  return pedidos
}

/** Lo que devolvió la API real por el número forzado 549249411111102. */
const NUMERO_INEXISTENTE = {
  status: 'ERROR',
  statusInfo: 'message sending failed',
  delivery: 'error',
  id: 'e4a2efa2-05d4-4a43-9eec-e05e7079aee2',
  phonenumber: '549249411111102',
  createdAt: '2026-09-28 11:33:48',
  executedAt: '2026-09-28 11:34:25',
}

const rapido = { intervalo: 1 }

async function main() {
  console.log('Caso 1 · Cómo se lee cada estado de 360Messenger:')
  igual(clasificarEstado({ status: 'OK', delivery: 'device' }), { estado: 'enviado' }, '"OK" / "device" → enviado')
  igual(
    clasificarEstado(NUMERO_INEXISTENTE),
    { estado: 'fallido', motivo: 'WhatsApp no pudo entregar el mensaje; revisá que el número sea correcto' },
    'la respuesta real del número forzado ("ERROR" / "message sending failed") → fallido',
  )
  igual(clasificarEstado({ status: 'failed', statusInfo: 'timeout' }), { estado: 'fallido', motivo: 'timeout' }, '"failed" → fallido, con su motivo')
  igual(
    clasificarEstado({ status: 'NOT FOUND', statusInfo: 'user not found', delivery: 'not found' }),
    { estado: 'fallido', motivo: 'el número no tiene WhatsApp' },
    '"NOT FOUND" / "user not found" → fallido: el número no tiene WhatsApp',
  )
  igual(clasificarEstado({ status: 'OK', delivery: 'failed' }), { estado: 'fallido', motivo: 'el envío falló' }, 'si un campo dice que falló, manda el fallo')
  igual(clasificarEstado({ status: 'PENDING' }), { estado: 'pendiente' }, 'en cola → pendiente')

  console.log('\nCaso 2 · La consulta lee la respuesta real y espera mientras siga en cola:')
  contesta(NUMERO_INEXISTENTE)
  igual(
    (await confirmarWhatsapp('e4a2efa2-05d4-4a43-9eec-e05e7079aee2', rapido)).estado,
    'fallido',
    'el estado viene en "data" (así contesta la API) y se lee',
  )
  contestaEn('result', NUMERO_INEXISTENTE)
  igual((await confirmarWhatsapp('abc12345', rapido)).estado, 'fallido', 'y también en "result" (el ejemplo de la documentación)')
  let pedidos = contesta({ status: 'PENDING' }, { status: 'PENDING' }, { status: 'OK', delivery: 'device' })
  igual(await confirmarWhatsapp('f4376401-c710-4e7d-ab04-d09d1fe7aadb', rapido), { estado: 'enviado' }, 'dos veces en cola y después OK → enviado')
  igual(pedidos.length, 3, 'consultó tres veces')
  igual(pedidos[0], '/api/whatsapp-estado?id=f4376401-c710-4e7d-ab04-d09d1fe7aadb', 'contra el proxy propio, nunca directo a 360Messenger')
  pedidos = contesta(404, 404, NUMERO_INEXISTENTE)
  igual((await confirmarWhatsapp('abc12345', rapido)).estado, 'fallido', 'un 404 (id todavía no registrado) sigue esperando, no corta')
  igual(pedidos.length, 3, '(y sigue preguntando hasta tener el estado)')
  pedidos = contesta({ status: 'PENDING' })
  igual(await confirmarWhatsapp('abc12345', { ...rapido, intentos: 3 }), { estado: 'pendiente' }, 'si sigue en cola al final, queda pendiente')
  igual(pedidos.length, 3, 'y no pregunta más que los intentos pedidos')
  contesta(500)
  igual(
    await confirmarWhatsapp('abc12345', rapido),
    { estado: 'sin-verificar', motivo: '360Messenger respondió 500' },
    'si la consulta falla, no se sabe',
  )

  console.log('\nCaso 2b · Si la consulta no llega a 360Messenger, se dice (y no se espera en vano):')
  let crudas = 0
  const contestaCrudo = (status: number, cuerpo: string) => {
    crudas = 0
    globalThis.fetch = (async () => {
      crudas++
      return new Response(cuerpo, { status })
    }) as unknown as typeof fetch
  }
  contestaCrudo(404, 'The page could not be found\n\nNOT_FOUND')
  igual(
    await confirmarWhatsapp('c25c81c0-aea0-4c29-872b-808541017595', rapido),
    { estado: 'sin-verificar', motivo: 'la consulta a 360Messenger no está configurada en la app' },
    'un 404 que no es de 360Messenger (la ruta no existe en el deploy) → no configurada',
  )
  igual(crudas, 1, '(y lo dice al primer intento, sin esperar 90 s)')
  contestaCrudo(200, '<!doctype html><html><head><title>Operaciones de venta</title></head></html>')
  igual(
    await confirmarWhatsapp('c25c81c0-aea0-4c29-872b-808541017595', rapido),
    { estado: 'sin-verificar', motivo: 'la consulta a 360Messenger no está configurada en la app' },
    'la página de la app en vez del estado (Vite levantado sin la key) → no configurada',
  )
  contestaCrudo(500, JSON.stringify({ error: 'La consulta de WhatsApp no está configurada.' }))
  igual(
    await confirmarWhatsapp('c25c81c0-aea0-4c29-872b-808541017595', rapido),
    { estado: 'sin-verificar', motivo: 'La consulta de WhatsApp no está configurada' },
    'el proxy sin la key en Vercel → su propio motivo',
  )
  contestaCrudo(404, JSON.stringify({ success: false, statusCode: 404, message: 'Not Found' }))
  igual(
    await confirmarWhatsapp('c25c81c0-aea0-4c29-872b-808541017595', { ...rapido, intentos: 2 }),
    { estado: 'pendiente' },
    'el 404 de 360Messenger (id todavía no registrado) sí sigue esperando',
  )
  igual(crudas, 2, '(consultó los intentos pedidos)')
  contestaCrudo(
    200,
    JSON.stringify({
      success: true,
      data: {
        status: 'OK',
        statusInfo: 'The message has been read by the user',
        delivery: 'read',
        id: 'c25c81c0-aea0-4c29-872b-808541017595',
      },
      statusCode: 200,
    }),
  )
  igual(
    await confirmarWhatsapp('c25c81c0-aea0-4c29-872b-808541017595', rapido),
    { estado: 'enviado' },
    'el mensaje del reintento reportado ("OK" / "read") → enviado',
  )

  console.log('\nCaso 3 · Un WhatsApp cuenta como enviado sólo si 360Messenger lo confirma:')
  contesta(NUMERO_INEXISTENTE)
  igual(
    await verificarWhatsapps([{ ok: true, messageId: 'e4a2efa2' }], rapido),
    [
      {
        ok: false,
        messageId: 'e4a2efa2',
        motivo: 'WhatsApp no pudo entregar el mensaje; revisá que el número sea correcto',
      },
    ],
    'el caso reportado: Make dijo que sí, 360Messenger dice ERROR → no enviado',
  )
  contesta({ status: 'OK', delivery: 'device' })
  igual(
    await verificarWhatsapps([{ ok: true, messageId: 'abc12345' }], rapido),
    [{ ok: true, messageId: 'abc12345' }],
    '360Messenger confirma → enviado',
  )
  contesta({ status: 'PENDING' })
  igual(
    await verificarWhatsapps([{ ok: true, messageId: 'abc12345' }], { ...rapido, intentos: 2 }),
    [
      {
        ok: false,
        messageId: 'abc12345',
        motivo: 'WhatsApp todavía no confirmó la entrega; revisá en unos minutos si llegó antes de reintentar',
      },
    ],
    'sigue en cola al terminar la espera → no enviado, avisando que puede llegar igual',
  )
  contesta(500)
  igual(
    await verificarWhatsapps([{ ok: true, messageId: 'abc12345' }], rapido),
    [{ ok: false, messageId: 'abc12345', motivo: 'no se pudo confirmar el envío en 360Messenger' }],
    'no se puede consultar → no enviado',
  )

  let consultas = contesta({ status: 'OK' }, NUMERO_INEXISTENTE)
  igual(
    (await verificarWhatsapps(
      [
        { ok: true, messageId: 'aaaa1111' },
        { ok: true, messageId: 'bbbb2222' },
      ],
      rapido,
    )).map((i) => i.ok),
    [true, false],
    'con varios contactos se confirma cada uno por su messageId',
  )
  igual(consultas.length, 2, '(una consulta por WhatsApp)')

  consultas = contesta({ status: 'FAILED' })
  igual(
    await verificarWhatsapps([{ ok: false, messageId: 'abc12345' }], rapido),
    [{ ok: false, messageId: 'abc12345' }],
    'con envio_whatsapp en false no se consulta nada',
  )
  igual(consultas.length, 0, '(ni una consulta)')
  consultas = contesta({ status: 'OK' })
  igual(
    await verificarWhatsapps([{ ok: true }], rapido),
    [{ ok: false, motivo: 'no se pudo confirmar el envío en 360Messenger' }],
    'sin messageId no se puede confirmar → no enviado',
  )
  igual(consultas.length, 0, '(y no consulta)')

  console.log('\nCaso 4 · El caso reportado de punta a punta: "Ambos", email OK y número forzado:')
  const envio = armarEnvioPresupuesto({
    jobId: 'job_1',
    numero: 'PRESUP-009',
    fechaEmision: '28/09/2026',
    fechaVencimiento: '12/10/2026',
    archivo: 'The Automation Partner S.A TEST-PRESUP-009.pdf',
    totalPesos: 1000,
    totalDolares: 0,
    cliente: { id: '111', name: 'The Automation Partner S.A TEST', cuit: '30-1' },
    vendedor: null,
    medio: 'Ambos',
    contactos: [
      {
        id: '1',
        itemId: '91',
        name: 'Luciano',
        email: 'dev2@theautomationpartner.com',
        phone: '549249411111102',
        ok: true,
        ini: 'LU',
        color: '#000',
        status: 'Presupuesto',
      },
    ],
  })
  contesta(NUMERO_INEXISTENTE)
  const resultados = {
    email: [{ ok: true }],
    whatsapp: await verificarWhatsapps([{ ok: true, messageId: 'e4a2efa2-05d4-4a43-9eec-e05e7079aee2' }], rapido),
  }
  const evaluacion = evaluarEnvio(envio, resultados)
  igual(evaluacion.estado, 'parcial', 'Make dijo envio_whatsapp: true, pero el resultado es PARCIALMENTE ENVIADO')
  igual(
    evaluacion.estado === 'parcial' && mensajeParcial(evaluacion.fallas, evaluacion.enviados),
    'El presupuesto se envió por email, pero no por WhatsApp. WhatsApp no pudo entregar el mensaje; revisá que el número sea correcto. Volvé a tocar el botón para completar el envío por WhatsApp: por email no se manda de nuevo.',
    'con el aviso de que el WhatsApp no salió y por qué',
  )
  igual(
    evaluacion.estado === 'parcial' && evaluacion.fallas[0]?.motivo,
    'WhatsApp no pudo entregar el mensaje; revisá que el número sea correcto',
    'y el motivo queda en la falla',
  )

  console.log(`\nOK · confirmación del WhatsApp en 360Messenger (${asserts} verificaciones)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
