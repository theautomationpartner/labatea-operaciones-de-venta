/**
 * La reconciliación de la corrida INCREMENTAL del cron del padrón.
 *
 * El cron de 5 minutos no barre el tablero: le pide a Monday lo modificado desde la última corrida,
 * ordenado por fecha de modificación descendente, y corta en cuanto llega a lo ya procesado. Eso
 * baja la corrida de 59 s a ~2 s. Lo que este test protege son las dos decisiones que hacen que
 * ese atajo sea correcto y no una fuente de datos podridos:
 *
 * 1. La consulta incremental va SIN el filtro de "operable", a propósito. Si el filtro viajara en
 *    la consulta, el cliente que pasa a INACTIVO —o que sale de la categoría "Clientes"— dejaría
 *    de aparecer y quedaría vivo en el padrón para siempre, elegible para venderle. Acá se
 *    comprueba que un ítem no operable se DA DE BAJA en vez de ignorarse.
 * 2. La marca de agua avanza con la fecha más nueva vista, incluso cuando no hay nada que
 *    procesar. Si no avanzara, cada corrida volvería a pedir el mismo tramo para siempre.
 *
 * Es la lógica pura (`clasificarPagina`), sin base ni red: eso vive en `api/cron/clientes.ts`.
 *
 * Se corre con `npm run test:padron-sync`; vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { COL_CLIENTE, clasificarPagina, type ItemMonday } from '../api/_padron'

const iso = (ms: number): string => new Date(ms).toISOString()

/** Una persona del tablero, con lo que mira la clasificación. */
function persona(opciones: {
  id: string
  codigo: string
  cuando: string
  activo?: boolean
  categoria?: string
}): ItemMonday {
  const { id, codigo, cuando, activo = true, categoria = '1' } = opciones
  return {
    id,
    name: `${codigo} - CLIENTE ${codigo}`,
    updated_at: cuando,
    column_values: [
      { id: COL_CLIENTE.categoria, text: 'Clientes', values: [{ id: categoria }] },
      { id: COL_CLIENTE.codigo, text: codigo },
      { id: COL_CLIENTE.cuit, text: '' },
      { id: COL_CLIENTE.estado, text: activo ? 'Activo' : 'Inactivo', index: activo ? 1 : 2 },
      { id: COL_CLIENTE.situacion, text: 'Liberado Con Credito', index: 0 },
      { id: COL_CLIENTE.limite, text: '0' },
    ],
  }
}

const AHORA = Date.parse('2026-09-22T14:00:00Z')
const MINUTO = 60_000

/* ---------- 1) Lo operable entra; lo que dejó de serlo, SALE ---------- */

{
  const corte = AHORA - 10 * MINUTO
  const pagina = [
    persona({ id: '1', codigo: '100', cuando: iso(AHORA) }),
    persona({ id: '2', codigo: '200', cuando: iso(AHORA - MINUTO), activo: false }),
    persona({ id: '3', codigo: '300', cuando: iso(AHORA - 2 * MINUTO), categoria: '2' }),
    persona({ id: '4', codigo: '400', cuando: iso(AHORA - 3 * MINUTO) }),
  ]

  const r = clasificarPagina(pagina, corte)

  assert.deepEqual(
    r.entran.map((c) => c.codigo),
    ['100', '400'],
    'los clientes operables modificados entran al padrón',
  )
  assert.deepEqual(
    r.salen,
    ['2', '3'],
    'el que pasó a INACTIVO y el que salió de la categoría se DAN DE BAJA; ignorarlos los dejaría ' +
      'vivos en el padrón para siempre',
  )
  assert.ok(!r.alcanzado, 'todavía no se llegó a lo ya procesado')
  assert.equal(r.masNueva, iso(AHORA), 'la marca avanza a la modificación más nueva de la página')
}

/* ---------- 2) El corte: desde la marca para atrás no se procesa nada ---------- */

{
  const corte = AHORA - 5 * MINUTO
  const pagina = [
    persona({ id: '1', codigo: '100', cuando: iso(AHORA) }),
    persona({ id: '2', codigo: '200', cuando: iso(AHORA - MINUTO) }),
    // Desde acá para abajo ya se procesó en corridas anteriores.
    persona({ id: '3', codigo: '300', cuando: iso(AHORA - 30 * MINUTO) }),
    persona({ id: '4', codigo: '400', cuando: iso(AHORA - 60 * MINUTO) }),
  ]

  const r = clasificarPagina(pagina, corte)

  assert.ok(r.alcanzado, 'al cruzar el corte se frena: es lo que convierte 27 páginas en una')
  assert.deepEqual(
    r.entran.map((c) => c.codigo),
    ['100', '200'],
    'sólo se procesa lo modificado después del corte',
  )
  assert.equal(r.salen.length, 0)
}

/* ---------- 3) Una corrida sin novedades no hace nada, pero la marca igual avanza ---------- */

{
  const corte = AHORA - 5 * MINUTO
  const pagina = [persona({ id: '9', codigo: '900', cuando: iso(AHORA - 20 * MINUTO) })]

  const r = clasificarPagina(pagina, corte)

  assert.equal(r.entran.length, 0, 'sin cambios no hay nada que guardar')
  assert.equal(r.salen.length, 0)
  assert.ok(r.alcanzado)
  assert.equal(
    r.masNueva,
    iso(AHORA - 20 * MINUTO),
    'la marca avanza igual: si no, cada corrida volvería a pedir el mismo tramo para siempre',
  )
}

/* ---------- 4) La marca acumula entre páginas y nunca retrocede ---------- */

{
  const corte = AHORA - 60 * MINUTO
  const primera = clasificarPagina([persona({ id: '1', codigo: '100', cuando: iso(AHORA) })], corte)
  const segunda = clasificarPagina(
    [persona({ id: '2', codigo: '200', cuando: iso(AHORA - 10 * MINUTO) })],
    corte,
    primera.masNueva,
  )

  assert.equal(
    segunda.masNueva,
    iso(AHORA),
    'la marca de la página siguiente no puede pisar una fecha más nueva ya vista',
  )
}

/* ---------- 5) El solapamiento hace que repetir sea inofensivo ---------- */

{
  /* El cron corta dos minutos ANTES de la marca, para que un ítem modificado en el segundo exacto
     del corte no se pierda entre relojes desfasados. El precio es reprocesar: tiene que dar lo
     mismo, porque el guardado es un upsert. */
  const item = persona({ id: '1', codigo: '100', cuando: iso(AHORA) })
  const unaVez = clasificarPagina([item], AHORA - 5 * MINUTO)
  const otraVez = clasificarPagina([item], AHORA - 5 * MINUTO)

  assert.deepEqual(unaVez.entran, otraVez.entran, 'reprocesar el mismo ítem da exactamente lo mismo')
  assert.equal(unaVez.entran.length, 1)
}

/* ---------- 6) Un ítem sin fecha no frena la corrida ---------- */

{
  /* `updated_at` podría faltar si Monday cambia la consulta o la versión de API. Sin fecha no se
     puede decidir el corte, así que se procesa: es preferible reprocesar de más a cortar la
     sincronización de golpe y en silencio. */
  const sinFecha: ItemMonday = { ...persona({ id: '7', codigo: '700', cuando: '' }) }
  delete sinFecha.updated_at

  const r = clasificarPagina([sinFecha], AHORA)

  assert.ok(!r.alcanzado, 'un ítem sin fecha no puede hacer creer que se llegó al final')
  assert.equal(r.entran.length, 1, 'y se procesa igual')
  assert.equal(r.masNueva, null, 'pero no aporta marca')
}

console.log('padrón/sync: OK · lo que deja de ser cliente se da de baja y la marca avanza')
