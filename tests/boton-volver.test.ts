/**
 * El botón que retrocede de etapa dice "Volver" en TODAS las operaciones y en todas sus etapas.
 *
 * No es cosmético: el pie de cada etapa lo escribe su propia vista —hay catorce copias del mismo
 * botón, una por pantalla— y nada las obliga a coincidir. Así fue como ocho de ellas terminaron
 * diciendo "Volver a paso anterior" y seis "Volver": el que agrega una etapa copia el pie de la
 * vista que tenga a mano, y hereda el texto que esa tuviera.
 *
 * Ninguna otra cosa lo mira. No hay typecheck que compare textos ni pantalla que muestre las
 * catorce juntas, así que la diferencia sólo se ve navegando la app etapa por etapa.
 *
 * Se afirma sobre el CÓDIGO FUENTE porque es donde vive el problema: son literales repartidos en
 * catorce archivos. El día que el pie se extraiga a un componente compartido, este test se cae
 * solo (no va a encontrar los botones) y ahí se reemplaza por la aserción sobre ese componente.
 *
 * Se corre con esbuild + node (`npm run test:boton-volver`); vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Todos los .tsx bajo src/features, recursivo. */
function vistas(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) return vistas(ruta)
    return ruta.endsWith('.tsx') ? [ruta] : []
  })
}

const ICONO = '<i className="fas fa-arrow-left" />'
const ETIQUETA = 'Volver'

const CLASE = 'btn-volver'

const encontrados: { archivo: string; texto: string; clase: string }[] = []
for (const archivo of vistas('src/features')) {
  const fuente = readFileSync(archivo, 'utf8')
  let desde = 0
  for (;;) {
    const i = fuente.indexOf(ICONO, desde)
    if (i < 0) break
    desde = i + ICONO.length
    /* Lo que el botón dice DESPUÉS de la flecha, hasta que se cierra el elemento. Es el texto que
       ve el usuario; el ícono no habla. */
    const texto = fuente.slice(desde, fuente.indexOf('<', desde)).trim()
    /* Y con qué clase se dibuja: el `className` MÁS CERCANO hacia atrás es el de este botón. */
    const abre = fuente.lastIndexOf('className="', i)
    const clase = fuente.slice(abre + 'className="'.length, fuente.indexOf('"', abre + 11))
    encontrados.push({ archivo, texto, clase })
  }
}

/* Que los haya encontrado es parte de la aserción: si un refactor mueve el botón a un componente
   compartido, acá no queda ninguno y el test tiene que fallar para que alguien lo actualice, en
   vez de pasar en verde sin haber mirado nada. */
assert.ok(
  encontrados.length >= 10,
  `se esperaban los botones de volver de cada etapa y se encontraron ${encontrados.length}: ` +
    'si el pie se extrajo a un componente compartido, hay que reescribir este test contra él',
)

const otroTexto = encontrados.filter((b) => b.texto !== ETIQUETA)
assert.deepEqual(
  otroTexto.map((d) => `${d.archivo}: "${d.texto}"`),
  [],
  `todo botón de retroceso dice exactamente "${ETIQUETA}"`,
)

/* ---------- Y todos se dibujan con LA MISMA clase ----------
   El texto no alcanzaba. Con las catorce copias diciendo "Volver" seguían conviviendo cuatro
   diseños —`.btn .btn-out`, `.btn-outline` de dos hojas distintas y `.cobro-btn--out`—, con
   bordes, radios y rellenos que no coincidían. Una sola clase es lo que hace que el botón sea UN
   control y no catorce parecidos. */
const otraClase = encontrados.filter((b) => b.clase !== CLASE)
assert.deepEqual(
  otraClase.map((d) => `${d.archivo}: "${d.clase}"`),
  [],
  `todo botón de retroceso se dibuja con la clase "${CLASE}"`,
)

/* Que la clase EXISTA en la hoja global. Sin esto, renombrarla en el CSS dejaría a los catorce
   botones sin estilo y el test seguiría en verde. */
const global = readFileSync('src/styles/components.css', 'utf8')
assert.ok(global.includes(`.${CLASE} {`), `.${CLASE} tiene que estar definida en components.css`)
/* Sin scope de vista: las etapas viven en scopes distintos y una no tiene el suyo, así que
   cualquier prefijo dejaría pantallas afuera —que es como empezó la divergencia—. */
assert.ok(
  !new RegExp(`\.[\w-]+ \.${CLASE} \{`).test(global),
  `.${CLASE} no puede quedar scopeada a una vista: no llega a todas las etapas`,
)

console.log(
  `OK · los ${encontrados.length} botones de retroceso dicen "${ETIQUETA}" y usan .${CLASE}`,
)
