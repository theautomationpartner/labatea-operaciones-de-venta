/**
 * El PDF del presupuesto lo genera la app con react-pdf, con la plantilla que usaba Make.com y los
 * importes de la card "Presupuesto a generar". Este test lo genera de verdad —en Node, con `renderToBuffer`— y comprueba que sale un
 * PDF válido, que la tabla larga pasa a otra página y que los totales son los de la card.
 *
 * Se corre con esbuild + node (`npm run test:presupuesto-pdf`); vive fuera de `src/`. Deja los PDFs
 * en `node_modules/.cache/` para mirarlos a ojo.
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import { nombrePresupuestoPdf } from '@/features/emision/pdf/generarPresupuestoPdf'
import { PresupuestoPdf, type DatosPresupuestoPdf } from '@/features/emision/pdf/PresupuestoPdf'
import { LEYENDA_PAGOS_TEMPLATE, leyendaPagosDe } from '@/features/emision/pdf/leyendaPagos'
import { DESCUENTO_PAGO_DEFAULT } from '@/lib/cobros'
import { totalesPresupuesto } from '@/lib/presupuestoDoc'
import type { LineaPresupuesto, Producto } from '@/types'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.equal(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}

const producto = (codigo: string, nombre: string, precio: number, moneda = 'Pesos'): Producto => ({
  codigo,
  nombre,
  precio,
  rentabilidad: 0,
  provCod: 'P1',
  provNombre: 'Proveedor',
  tipo: 'COM',
  moneda,
})

const linea = (id: string, p: Producto, cantidad: number, descuento = 0): LineaPresupuesto => ({
  id,
  producto: p,
  cantidad,
  descuento,
})

const base: Omit<DatosPresupuestoPdf, 'lineas'> = {
  numero: 'PRESUP-009',
  nombre: 'Agropecuaria Ñandú S.A.-PRESUP-009',
  cliente: { name: 'Agropecuaria Ñandú S.A.', cuit: '30-71234567-8', addr: 'Av. España 1450, Tandil' },
  logoSrc: 'public/logo-la-batea-pdf.png',
  fechaEmision: '28/09/2026',
  fechaVencimiento: '13/10/2026',
}

/** Cuántas páginas tiene el PDF: se cuentan los objetos `/Type /Page` (sin el `/Pages` raíz). */
const paginas = (pdf: Buffer): number => (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length

async function main() {
  console.log('Caso 1 · Un presupuesto bimonetario sale como un PDF de una página:')
  const lineas = [
    linea('l1', producto('A-100', 'Semilla de maíz híbrido', 125_000.5), 3, 10),
    linea('l2', producto('B-200', 'Fertilizante granulado', 48_300), 2),
    linea('l3', producto('C-300', 'Bomba de riego', 1_250.75, 'Dolares'), 1, 5),
  ]
  const pdf = await renderToBuffer(<PresupuestoPdf {...base} lineas={lineas} />)
  writeFileSync('node_modules/.cache/presupuesto-corto.pdf', pdf)
  igual(pdf.subarray(0, 5).toString('latin1'), '%PDF-', 'empieza con la firma de un PDF')
  igual(paginas(pdf), 1, 'tres productos entran en una página')

  console.log('\nCaso 2 · Los totales del PDF son los de la card (mismas funciones):')
  const t = totalesPresupuesto(lineas)
  igual(t.brutoPesos, 471_601.5, 'bruto en pesos: 125.000,50 × 3 + 48.300 × 2')
  igual(t.totalPesos, 434_101.35, 'total en pesos: el 10% sale de la primera línea')
  igual(t.descuentoPesos, 37_500.15, 'descuento = bruto − total')
  igual(t.totalUsd, 1_188.21, 'los dólares van aparte: 1.250,75 − 5%')
  igual(t.hayDolares, true, 'hay productos en dólares')

  console.log('\nCaso 3 · Una tabla larga pasa a otra página:')
  const muchas = Array.from({ length: 60 }, (_, i) =>
    linea(`m${i}`, producto(`X-${i}`, `Producto número ${i + 1}`, 1000 + i), 1),
  )
  const largo = await renderToBuffer(<PresupuestoPdf {...base} lineas={muchas} />)
  writeFileSync('node_modules/.cache/presupuesto-largo.pdf', largo)
  assert.ok(paginas(largo) >= 2, `60 productos deberían ocupar más de una página (dio ${paginas(largo)})`)
  asserts++
  console.log(`  ✓ 60 productos ocupan ${paginas(largo)} páginas`)

  console.log('\nCaso 4 · El archivo se llama "Razón social-Nro. de presupuesto":')
  igual(
    nombrePresupuestoPdf('Agropecuaria Ñandú S.A.', 'PRESUP-009'),
    'Agropecuaria Ñandú S.A.-PRESUP-009',
    'razón social y número, separados por un guion',
  )
  igual(
    nombrePresupuestoPdf('  Pérez / Hijos: "Campo"  ', 'PRESUP-010'),
    'Pérez Hijos Campo-PRESUP-010',
    'lo que no puede ir en un nombre de archivo se cambia por un espacio',
  )

  console.log('\nCaso 5 · La leyenda de formas de pago:')
  const conLeyenda = await renderToBuffer(
    <PresupuestoPdf {...base} lineas={lineas} leyendaPagos={{ contado: 6, debito: 5, credito: 3 }} />,
  )
  writeFileSync('node_modules/.cache/presupuesto-leyenda.pdf', conLeyenda)
  igual(paginas(conLeyenda), 1, 'con la leyenda, tres productos siguen entrando en una página')
  assert.ok(conLeyenda.length > pdf.length, 'el PDF con la leyenda tiene más contenido que el sin ella')
  asserts++
  console.log('  ✓ el PDF con la leyenda tiene más contenido que el sin ella')
  assert.deepEqual(
    leyendaPagosDe({ ...DESCUENTO_PAGO_DEFAULT, Efectivo: 8, 'Tarjeta de débito': 4, 'Tarjeta de crédito': 2 }),
    { contado: 8, debito: 4, credito: 2 },
  )
  asserts++
  console.log('  ✓ los % salen de la configuración del sistema')
  assert.deepEqual(leyendaPagosDe(DESCUENTO_PAGO_DEFAULT), LEYENDA_PAGOS_TEMPLATE)
  asserts++
  console.log('  ✓ sin configuración cargada, los del template (6/5/3)')

  console.log(`\n${asserts} verificaciones OK`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
