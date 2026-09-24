/**
 * Criterio numérico de la app: TODO valor se toma con dos decimales REDONDEADOS —se lee, se
 * calcula, se escribe y se muestra así—, el MISMO que ROUND(x, 2) de las fórmulas de Monday y que
 * los escenarios de Make. Los tres tienen que dar exactamente el mismo número.
 *
 * Se corre con esbuild + node (`npm run test:decimales`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { money, pctDec, round2 } from '@/lib/format'
import { num } from '@/services/monday/parse'

let asserts = 0
const igual = (real: unknown, esperado: unknown, nombre: string) => {
  assert.equal(real, esperado, nombre)
  asserts++
  console.log('  ✓', nombre)
}

console.log('Caso 1 · round2 redondea a dos decimales, como ROUND(x, 2) de Monday:')
igual(round2(123456.784), 123456.78, '123456,784 → 123456,78')
igual(round2(123456.785), 123456.79, '123456,785 → 123456,79 (el 5 sube)')
igual(round2(123456.789), 123456.79, '123456,789 → 123456,79')
igual(round2(-1.005), -1.01, 'un negativo: el 5 se aleja del cero (−1,005 → −1,01), no va hacia +∞')
igual(round2(-1.004), -1, '−1,004 → −1,00')
igual(round2(-0.001), 0, 'un casi-cero negativo es 0, no −0 (que se mostraría "−0,00")')
igual(round2(1000), 1000, 'un entero no cambia')
igual(round2(NaN), 0, 'un valor inválido es 0')

console.log('\nCaso 2 · El punto flotante no cambia un redondeo:')
igual(round2(1.005), 1.01, '1,005 (que vale 1,00499999…) redondea a 1,01')
igual(round2(0.1 + 0.2), 0.3, '0,1 + 0,2 (= 0,30000000000000004) es 0,30')
igual(round2(1.15), 1.15, '1,15 (que vale 1,1499999…) sigue siendo 1,15')
igual(round2(109_825 / 1.23), 89_288.62, 'el Nuevo Costo del ejemplo: 89.288,617… → 89.288,62')

console.log('\nCaso 3 · Lo que se LEE de Monday viene con dos decimales:')
igual(num('125834.691'), 125834.69, 'un valor con tres decimales se lee con dos')
igual(num('727.935'), 727.94, 'y redondeado, igual que ROUND(x, 2) del maestro')
igual(num('10165053.5099999998'), 10165053.51, 'el resto de punto flotante que muestra Monday se limpia')
igual(num('102162.35'), 102162.35, 'un valor con 2 decimales queda igual')
igual(num('12'), 12, 'una cantidad entera queda igual')
igual(num(''), 0, 'vacío es 0')

console.log('\nCaso 4 · Lo que se MUESTRA:')
igual(money(123456.785), '$ 123.456,79', 'money redondea igual que el cálculo')
igual(money(-0.001), '$ 0,00', 'sin "−0,00"')

console.log('\nCaso 5 · Los porcentajes, con el mismo criterio:')
igual(round2(22.9999995), 23, 'la rentabilidad de la planilla es 23,00%')
igual(pctDec(22.9999995), '23%', 'y así se muestra')

console.log(`\nOK · dos decimales redondeados, como ROUND(x, 2) de Monday (${asserts} verificaciones)`)
