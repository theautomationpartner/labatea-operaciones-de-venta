/**
 * Clonación estructural de tableros entre dos cuentas de monday.com.
 *
 *   ORIGEN  → lectura   (cuenta "Polifroni")
 *   DESTINO → escritura (cuenta "LaBatea", carpeta configurable)
 *
 * Sólo replica la ESTRUCTURA: nombre del tablero + columnas (título y tipo). No copia items,
 * ni valores, ni automatizaciones. Las columnas de tipo `board_relation` se crean SIN enlazar y
 * quedan listadas en un "Reporte de Relacionamiento" para reconectarlas a mano.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * SEGURIDAD
 *  - Los tokens NO se hardcodean. Salen de variables de entorno:
 *        MONDAY_POLIFRONI_TOKEN   (origen / lectura)
 *        MONDAY_LABATEA_TOKEN     (destino / escritura)
 *  - El token de Polifroni que llegó en texto plano por chat quedó expuesto: conviene
 *    revocarlo/rotarlo en monday (Admin → API) apenas termine la migración.
 *  - Por defecto corre en DRY-RUN: muestra qué haría sin escribir nada. Para ejecutar de verdad,
 *    pasar la bandera  --execute.
 *
 * USO
 *   node scripts/clonar-tableros-monday.mjs               # dry-run (no escribe)
 *   node scripts/clonar-tableros-monday.mjs --execute     # crea tableros y columnas en el destino
 *
 * Requiere Node 18+ (usa fetch global).
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

// ── MÓDULO 4: ALCANCE (SCOPE) ────────────────────────────────────────────────────────────────
// Sólo estos IDs se leen del origen. Nada más de la cuenta Polifroni se toca.
const SOURCE_BOARD_IDS = [
  '9958048474',
  '9958101497',
  '9977987607',
  '9958108661',
  '9975761782',
  '9958240143',
]

// Tableros/carpeta que quedan EXPRESAMENTE fuera de alcance. Guarda defensiva por si alguien
// agrega un ID por error: se aborta antes de tocar la API.
const OUT_OF_SCOPE = new Set(['18424597890']) // + contenido de la carpeta 20459295

// Carpeta del destino donde se crean los tableros nuevos.
const DEST_FOLDER_ID = '20931123'
// Algunas cuentas exigen workspace_id además de folder_id. Opcional por env.
const DEST_WORKSPACE_ID = process.env.MONDAY_LABATEA_WORKSPACE_ID?.trim() || undefined

const API_URL = 'https://api.monday.com/v2'
const API_VERSION = '2024-10'

const EXECUTE = process.argv.includes('--execute')
// Solo lee el origen e imprime la estructura como JSON (para copiar/pegar). No escribe nada.
const DUMP_JSON = process.argv.includes('--dump-json')

// Tipos de columna que NO se crean por API (son de sistema, autogeneradas, o dependen de otra
// columna). Se omiten y se anotan en el reporte para revisión manual.
const NON_CREATABLE = new Set([
  'name', // la columna Nombre ya existe por defecto en todo tablero
  'subtasks',
  'auto_number',
  'creation_log',
  'last_updated',
  'formula', // requiere definición de fórmula
  'mirror', // depende de un board_relation ya enlazado
  'progress',
  'item_id',
  'button',
  'doc',
  'time_tracking',
])

// ── Helpers de API ───────────────────────────────────────────────────────────────────────────

function requireToken(name) {
  const t = process.env[name]?.trim()
  if (!t) {
    console.error(`\n✖ Falta la variable de entorno ${name}. Abortando.\n`)
    process.exit(1)
  }
  return t
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Ejecuta GraphQL contra monday con el token dado; reintenta ante límite de complejidad (429). */
async function mondayApi(token, query, variables = {}, intento = 0) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (res.status === 429 && intento < 5) {
    const espera = 2000 * (intento + 1)
    console.warn(`  ⏳ Rate limit (429). Reintentando en ${espera / 1000}s…`)
    await sleep(espera)
    return mondayApi(token, query, variables, intento + 1)
  }
  if (!res.ok) throw new Error(`Monday API HTTP ${res.status}`)

  const json = await res.json()
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join(' · ')
    // Límite de complejidad: esperar y reintentar.
    if (/complexity/i.test(msg) && intento < 5) {
      const espera = 5000 * (intento + 1)
      console.warn(`  ⏳ Límite de complejidad. Reintentando en ${espera / 1000}s…`)
      await sleep(espera)
      return mondayApi(token, query, variables, intento + 1)
    }
    throw new Error(msg)
  }
  if (!json.data) throw new Error('Monday no devolvió datos.')
  return json.data
}

// ── MÓDULO 1: LECTURA DEL ORIGEN ─────────────────────────────────────────────────────────────

async function leerTablerosOrigen(token) {
  // Guarda de alcance: ningún ID fuera de scope puede colarse.
  for (const id of SOURCE_BOARD_IDS) {
    if (OUT_OF_SCOPE.has(id)) {
      console.error(`✖ El ID ${id} está fuera de alcance (MÓDULO 4). Abortando.`)
      process.exit(1)
    }
  }

  const query = `
    query ($ids: [ID!]) {
      boards(ids: $ids) {
        id
        name
        columns { id title type }
      }
    }
  `
  const data = await mondayApi(token, query, { ids: SOURCE_BOARD_IDS })
  const boards = data.boards ?? []

  // Validación: que estén todos los pedidos.
  const encontrados = new Set(boards.map((b) => b.id))
  for (const id of SOURCE_BOARD_IDS) {
    if (!encontrados.has(id)) console.warn(`  ⚠ No se encontró el tablero ${id} en el origen.`)
  }
  return boards
}

// ── MÓDULO 2 + 3: CREACIÓN EN DESTINO ────────────────────────────────────────────────────────

async function crearTableroDestino(token, nombre) {
  const query = `
    mutation ($name: String!, $kind: BoardKind!, $folderId: ID, $workspaceId: ID) {
      create_board(board_name: $name, board_kind: $kind, folder_id: $folderId, workspace_id: $workspaceId) {
        id
        name
      }
    }
  `
  const data = await mondayApi(token, query, {
    name: nombre,
    kind: 'public',
    folderId: DEST_FOLDER_ID,
    workspaceId: DEST_WORKSPACE_ID ?? null,
  })
  return data.create_board
}

async function crearColumnaDestino(token, boardId, title, columnType) {
  const query = `
    mutation ($boardId: ID!, $title: String!, $type: ColumnType!) {
      create_column(board_id: $boardId, title: $title, column_type: $type) {
        id
        title
        type
      }
    }
  `
  const data = await mondayApi(token, query, { boardId, title, type: columnType })
  return data.create_column
}

// ── Orquestación ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const tokenOrigen = requireToken('MONDAY_POLIFRONI_TOKEN')
  const tokenDestino = EXECUTE ? requireToken('MONDAY_LABATEA_TOKEN') : process.env.MONDAY_LABATEA_TOKEN

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log(`  Clonación de tableros Polifroni → LaBatea`)
  console.log(`  Modo: ${EXECUTE ? 'EJECUCIÓN (escribe en destino)' : 'DRY-RUN (no escribe nada)'}`)
  console.log(`  Carpeta destino: ${DEST_FOLDER_ID}${DEST_WORKSPACE_ID ? ` · workspace ${DEST_WORKSPACE_ID}` : ''}`)
  console.log('═══════════════════════════════════════════════════════════════\n')

  // MÓDULO 1 — leer
  console.log('▶ Leyendo estructura del origen…')
  const boards = await leerTablerosOrigen(tokenOrigen)

  // Modo volcado: imprime la estructura como JSON y termina, sin escribir nada.
  if (DUMP_JSON) {
    const estructura = boards.map((b) => ({
      id: b.id,
      name: b.name,
      columns: b.columns.map((c) => ({ title: c.title, type: c.type })),
    }))
    console.log('\n===JSON-ESTRUCTURA-INICIO===')
    console.log(JSON.stringify(estructura, null, 2))
    console.log('===JSON-ESTRUCTURA-FIN===')
    return
  }

  console.log('\n  Tableros leídos (validación de columnas):')
  for (const b of boards) {
    console.log(`   • [${b.id}] ${b.name} — ${b.columns.length} columnas`)
  }

  const reporteRelaciones = []
  const reporteOmitidas = []

  // MÓDULO 2 + 3 — recrear
  for (const b of boards) {
    console.log(`\n▶ ${b.name}`)

    let destBoardId = null
    if (EXECUTE) {
      const nuevo = await crearTableroDestino(tokenDestino, b.name)
      destBoardId = nuevo.id
      console.log(`  ✓ Tablero creado en destino → id ${destBoardId}`)
      await sleep(400)
    } else {
      console.log(`  · [dry-run] crearía el tablero "${b.name}" en carpeta ${DEST_FOLDER_ID}`)
    }

    for (const col of b.columns) {
      const esRelacion = col.type === 'board_relation'
      const noCreable = NON_CREATABLE.has(col.type)

      if (noCreable) {
        console.log(`    ↷ omitida (tipo de sistema '${col.type}'): "${col.title}"`)
        reporteOmitidas.push(`${b.name} -> columna "${col.title}" (tipo ${col.type}) no se crea por API`)
        continue
      }

      if (EXECUTE) {
        try {
          await crearColumnaDestino(tokenDestino, destBoardId, col.title, col.type)
          console.log(`    ✓ columna "${col.title}" (${col.type})`)
          await sleep(300)
        } catch (e) {
          console.log(`    ✖ error creando "${col.title}" (${col.type}): ${e.message}`)
          reporteOmitidas.push(`${b.name} -> columna "${col.title}" (tipo ${col.type}) FALLÓ: ${e.message}`)
          continue
        }
      } else {
        console.log(`    · [dry-run] crearía columna "${col.title}" (${col.type})`)
      }

      // MÓDULO 3 — relaciones: se crea la columna pero NO se enlaza. Se reporta.
      if (esRelacion) {
        reporteRelaciones.push(
          `[${b.name}] -> Requiere conectar manualmente la columna "${col.title}" al tablero correspondiente`,
        )
      }
    }
  }

  // ── Reportes ─────────────────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  REPORTE DE RELACIONAMIENTO (conectar a mano)')
  console.log('═══════════════════════════════════════════════════════════════')
  if (reporteRelaciones.length === 0) console.log('  (sin columnas de relación)')
  else reporteRelaciones.forEach((l) => console.log('  ' + l))

  if (reporteOmitidas.length) {
    console.log('\n  COLUMNAS OMITIDAS / FALLIDAS')
    reporteOmitidas.forEach((l) => console.log('  ' + l))
  }

  // Volcado a archivo .txt junto al script.
  const { writeFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const here = dirname(fileURLToPath(import.meta.url))
  const contenido = [
    'REPORTE DE RELACIONAMIENTO — conectar manualmente en monday.com',
    `Generado: modo ${EXECUTE ? 'EJECUCIÓN' : 'DRY-RUN'}`,
    '',
    ...reporteRelaciones,
    '',
    'COLUMNAS OMITIDAS / FALLIDAS',
    ...(reporteOmitidas.length ? reporteOmitidas : ['(ninguna)']),
    '',
  ].join('\n')
  const out = join(here, 'reporte-relacionamiento.txt')
  writeFileSync(out, contenido, 'utf8')
  console.log(`\n✓ Reporte escrito en ${out}`)

  if (!EXECUTE) {
    console.log('\nⓘ Fue un DRY-RUN. Para ejecutar de verdad: node scripts/clonar-tableros-monday.mjs --execute\n')
  }
}

main().catch((e) => {
  console.error('\n✖ Error fatal:', e.message)
  process.exit(1)
})
