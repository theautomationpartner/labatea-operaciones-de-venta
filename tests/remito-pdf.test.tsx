/**
 * Los dos PDF del remito (VENTA y PREIMPRESO) los genera la app con react-pdf, con los templates que
 * usaba Make.com. Este test los genera de verdad —en Node, con `renderToBuffer`— y comprueba que salen
 * PDFs válidos, el número del remito, las líneas y los nombres de archivo.
 *
 * Se corre con esbuild + node (`npm run test:remito-pdf`); vive fuera de `src/`. Deja los PDFs en
 * `node_modules/.cache/` para mirarlos a ojo.
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import { lineasRemitoPdf, nombresRemitoPdf, type DatosRemitoPdf } from '@/features/emision/pdf/datosRemito'
import { RemitoPreimpresoPdf } from '@/features/emision/pdf/RemitoPreimpresoPdf'
import { RemitoVentaPdf } from '@/features/emision/pdf/RemitoVentaPdf'
import { pendientesDeAbrir } from '@/features/shared/VerImprimirPdf'
import { numeroRemito } from '@/services/monday/talonarios'
import type { RemitoItem } from '@/types'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.deepEqual(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const paginas = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length

const item = (uid: string, codigo: string, nombre: string, um: string, cantidad: number, nroFactura?: string): RemitoItem => ({
  uid,
  codigo,
  nombre,
  um,
  cantidad,
  ...(nroFactura ? { nroFactura } : {}),
})

const imprenta = {
  puntoVenta: '0091',
  numeroHoja: '00000007',
  desde: '00000001',
  hasta: '00000020',
  habilitacionImprenta: '06/2027',
  cai: '1234567890123',
  vencimientoCai: '30/10/2026',
  fechaImpresion: '24/07/2026',
}

async function main() {
  console.log('Caso 1 · Número, nombres de archivo y líneas:')
  const numero = numeroRemito(imprenta)
  igual(numero, '0091-00000007', 'el número es punto de venta + hoja del talonario')
  const nombres = nombresRemitoPdf('7001 - La Batea S.A TEST', numero)
  igual(
    nombres,
    { venta: 'La Batea S.A TEST-REMITO 0091-00000007', preimpreso: 'La Batea S.A TEST-REMITO 0091-00000007 PREIMPRESO' },
    'los dos archivos, sin el código interno del cliente',
  )
  const lineas = lineasRemitoPdf([
    item('a', 'A-100', 'Semilla de maíz híbrido', 'Bolsa', 30, 'A 0001-00001234 - 5'),
    item('b', 'B-200', 'Fertilizante granulado', 'Kg', 2.5),
    item('c', 'C-300', 'Bomba de riego', 'Unidad', 1),
  ])
  igual(lineas[0], { codigo: 'A-100', descripcion: 'Semilla de maíz híbrido', factura: 'A 0001-00001234 - 5', unidad: 'Bolsa', cantidad: '30' }, 'una línea ANTERIOR lleva su factura')
  igual(lineas[1].factura, '', 'una línea sin factura (POSTERIOR) va vacía')
  igual(lineas[1].cantidad, '2,5', 'la cantidad con coma decimal y sin ceros de más')

  const datos: DatosRemitoPdf = {
    numero,
    nombre: nombres.venta,
    fechaEmision: '28/09/2026',
    cliente: {
      name: '7001 - La Batea S.A TEST',
      cuit: '30-70906788-1',
      addr: 'Colectora Macaya 1273, Tandil',
      condicionIva: 'Responsable Inscripto',
    },
    cot: '123456789012',
    lineas,
    imprenta,
    logoSrc: 'public/logo-la-batea-pdf.png',
  }

  console.log('\nCaso 2 · Los dos PDF salen válidos, en una página:')
  const venta = await renderToBuffer(<RemitoVentaPdf {...datos} />)
  writeFileSync('node_modules/.cache/remito-venta.pdf', venta)
  igual(venta.subarray(0, 5).toString('latin1'), '%PDF-', 'Remito VENTA: firma de PDF')
  igual(paginas(venta), 1, 'Remito VENTA: una página')
  const preimpreso = await renderToBuffer(<RemitoPreimpresoPdf {...datos} nombre={nombres.preimpreso} />)
  writeFileSync('node_modules/.cache/remito-preimpreso.pdf', preimpreso)
  igual(preimpreso.subarray(0, 5).toString('latin1'), '%PDF-', 'Remito PREIMPRESO: firma de PDF')
  igual(paginas(preimpreso), 1, 'Remito PREIMPRESO: una página')
  const sinLogo = await renderToBuffer(<RemitoPreimpresoPdf {...datos} logoSrc={undefined} />)
  igual(paginas(sinLogo), 1, 'PREIMPRESO sin logo: sale con el nombre en texto')

  console.log('\nCaso 3 · "Ver / Imprimir (n)": cuántos quedan por abrir, y cuál abre cada clic:')
  const pdfVenta = new File([venta], `${nombres.venta}.pdf`, { type: 'application/pdf' })
  const pdfPreimpreso = new File([preimpreso], `${nombres.preimpreso}.pdf`, { type: 'application/pdf' })
  const remito = [pdfVenta, pdfPreimpreso]
  igual(pendientesDeAbrir(null, 0).length, 0, 'sin emitir: (0), deshabilitado')
  igual(pendientesDeAbrir(remito, 0).map((f) => f.name), [pdfVenta.name, pdfPreimpreso.name], 'remito recién emitido: (2), el primer clic abre el de VENTA')
  igual(pendientesDeAbrir(remito, 1).map((f) => f.name), [pdfPreimpreso.name], 'después de un clic: (1), el segundo abre el PREIMPRESO')
  igual(pendientesDeAbrir(remito, 2).length, 0, 'abiertos los dos: (0)')
  igual(pendientesDeAbrir([pdfVenta], 0).length, 1, 'el presupuesto (un solo PDF): (1)')

  console.log(`\nOK · PDFs del remito (${asserts} verificaciones)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
