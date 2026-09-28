/**
 * El PDF de la factura proforma (venta CONTADO) lo genera la app con react-pdf, con el template que
 * usaba Make.com. Este test lo genera de verdad —en Node, con `renderToBuffer`— y comprueba que sale
 * un PDF válido de una página, las líneas, el nombre del archivo y los mensajes del envío.
 *
 * Se corre con esbuild + node (`npm run test:proforma-pdf`); vive fuera de `src/`. Deja el PDF en
 * `node_modules/.cache/` para mirarlo a ojo.
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import { importe, lineasProformaPdf, nombreProformaPdf } from '@/features/emision/pdf/generarProformaPdf'
import { ProformaPdf } from '@/features/emision/pdf/ProformaPdf'
import { mensajesDe } from '@/lib/mensajesEnvio'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.deepEqual(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const paginas = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length

async function main() {
  console.log('Caso 1 · Nombre del archivo, líneas e importes:')
  igual(
    nombreProformaPdf('7000 - The Automation Partner S.A TEST', 'PROFORMA-037'),
    'The Automation Partner S.A TEST-PROFORMA-037',
    'razón social sin el código + número anticipado',
  )
  const lineas = lineasProformaPdf([
    { codigo: 'A-100', nombre: 'Semilla de maíz híbrido', cantidad: 3, um: 'Bolsa', precioUnitario: 125000.5, bonifUnit: 7500.03, totalLinea: 352501.41 },
    { nombre: 'Flete', cantidad: 1, precioUnitario: 15000, bonifUnit: 0, totalLinea: 15000 },
  ])
  igual(lineas[0], { codigo: 'A-100', producto: 'Semilla de maíz híbrido', cantidad: '3', um: 'Bolsa', unitario: '125.000,50', impBonif: '7.500,03', subtotal: '352.501,41' }, 'los importes con el formato de la app')
  igual([lineas[1].codigo, lineas[1].um], ['', ''], 'una línea sin código ni unidad las deja vacías')

  console.log('\nCaso 2 · El PDF sale válido, en una página:')
  const pdf = await renderToBuffer(
    <ProformaPdf
      numero="PROFORMA-037"
      nombre="The Automation Partner S.A TEST-PROFORMA-037"
      fechaEmision="28/09/2026"
      cliente={{ codigo: '7000', razonSocial: 'The Automation Partner S.A TEST', addr: 'Tandil, Buenos Aires', condicionIva: 'Consumidor Final', cuit: '30-70906788-2' }}
      vendedor="Luciano Torres"
      tipoEntrega="Posterior"
      condicion="Contado"
      lineas={lineas}
      gravado={importe(367501.41)}
      iva={importe(77175.3)}
      percIb={importe(0)}
      total={importe(444676.71)}
      tipoCambio={importe(1435.5)}
    />,
  )
  writeFileSync('node_modules/.cache/proforma.pdf', pdf)
  igual(pdf.subarray(0, 5).toString('latin1'), '%PDF-', 'firma de PDF')
  igual(paginas(pdf), 1, 'una página')

  console.log('\nCaso 3 · Los mensajes de la proforma:')
  const m = mensajesDe('PROFORMA', {
    razonSocial: 'The Automation Partner S.A TEST',
    contacto: 'Luciano Torres',
    contactoNombre: 'Luciano',
    fechaEmision: '28/09/2026',
    fechaVencimiento: null,
  })
  igual(
    m.whatsapp,
    '👋*¡Hola Luciano!*\n' +
      'Te adjuntamos la *Factura Proforma* emitida el dia 28-09-2026. Cualquier duda estamos a tu disposicion.\n' +
      '\n' +
      '*LA BATEA*',
    'WhatsApp: sólo el nombre de pila, fecha DD-MM-YYYY',
  )
  igual(
    m.email,
    '👋 <b>¡Hola Luciano Torres!</b><br>' +
      'Te adjuntamos la <b>factura Proforma</b> emitida el 📅 <b>Fecha de Emisión:</b> 28/09/2026. Cualquier duda estamos a tu disposición.<br><br>' +
      '<b>LA BATEA</b>',
    'email: nombre y apellido, fecha DD/MM/YYYY',
  )

  console.log(`\nOK · PDF y mensajes de la proforma (${asserts} verificaciones)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
