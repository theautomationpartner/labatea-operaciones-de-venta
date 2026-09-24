/**
 * Criterio numérico de la app, acordado con el comercio: TODO valor se toma con dos decimales
 * TRUNCADOS —se lee, se calcula, se escribe y se muestra así—. 123456,789 es 123456,78.
 *
 * La única excepción son los PORCENTAJES que salen de una cuenta (rentabilidad), que se redondean:
 * sobre importes truncados quedan una centésima abajo (22,9999995% se mostraría 22,99%).
 *
 * Se corre con esbuild + node (`npm run test:decimales`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { money, pctDec, redondearPct, trunc2 } from '@/lib/format'
import { num } from '@/services/monday/parse'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.equal(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}

console.log('Caso 1 · trunc2 corta, no redondea:')
igual(trunc2(123456.789), 123456.78, '123456,789 → 123456,78 (el ejemplo acordado)')
igual(trunc2(0.999), 0.99, '0,999 → 0,99')
igual(trunc2(-1.239), -1.23, 'un negativo se corta hacia el cero: −1,239 → −1,23')
igual(trunc2(1000), 1000, 'un entero no cambia')
igual(trunc2(NaN), 0, 'un valor inválido es 0')

console.log('\nCaso 2 · El punto flotante no le roba un centavo:')
igual(trunc2(1.15), 1.15, '1,15 (que vale 1,1499999…) sigue siendo 1,15')
igual(trunc2(0.1 + 0.2), 0.3, '0,1 + 0,2 (= 0,30000000000000004) es 0,30')
igual(trunc2(4.35 * 100) , 435, '4,35 × 100 (= 434,99999999999994) es 435')
igual(trunc2(125_834.69 * 0.9), 113_251.22, 'un descuento del 10% sobre el precio de la planilla')

console.log('\nCaso 3 · Lo que se LEE de Monday ya viene con dos decimales:')
igual(num('125834.691'), 125834.69, 'la fórmula del maestro muestra 3 decimales: se lee con 2')
igual(num('102162.35'), 102162.35, 'un valor con 2 decimales queda igual')
igual(num('12'), 12, 'una cantidad entera queda igual')
igual(num(''), 0, 'vacío es 0')

console.log('\nCaso 4 · Lo que se MUESTRA, también truncado:')
igual(money(123456.789), '$ 123.456,78', 'money no redondea el tercer decimal')
igual(money(0.999), '$ 0,99', 'ni en montos chicos')

console.log('\nCaso 5 · Los porcentajes de una cuenta se REDONDEAN:')
igual(redondearPct(22.9999995), 23, 'la rentabilidad de la planilla sobre importes truncados es 23,00%')
igual(redondearPct(9.99994), 10, 'un producto cargado al 10% rinde 10,00%, no 9,99%')
igual(redondearPct(1.005), 1.01, 'el arrastre binario no baja un redondeo')
igual(pctDec(22.9999995), '23%', 'y así se muestra')

console.log(`\nOK · dos decimales truncados; los % de una cuenta, redondeados (${asserts} verificaciones)`)
