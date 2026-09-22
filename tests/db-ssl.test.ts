/**
 * La conexión a Postgres verifica el certificado, y eso no depende de la versión de `pg`.
 *
 * Por qué hace falta un test para algo que parece un detalle de configuración: `pg` trata hoy
 * `sslmode=require` como `verify-full` —valida cadena de confianza y nombre del host—, pero
 * anunció que en la v9 va a adoptar la semántica de libpq, donde `require` cifra y **no valida
 * nada**. Sin fijarlo, un `npm update` debilitaría la conexión a la base sola, sin que nadie lo
 * decida y sin que se note: la app seguiría andando igual.
 *
 * Este test es lo que hace que ese cambio se vea. Si alguien vuelve a delegarle el modo SSL a la
 * cadena de conexión, acá se rompe.
 *
 * Se corre con `npm run test:db-ssl`; vive fuera de `src/`.
 */
import assert from 'node:assert/strict'
import { conSslExplicito } from '../api/_db'

/* ---------- 1) `require` verifica igual, y el `sslmode` no llega a `pg` ---------- */

const neon = conSslExplicito(
  'postgresql://usuario:clave@ep-algo-123-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require',
)

assert.deepEqual(
  neon.ssl,
  { rejectUnauthorized: true },
  'con sslmode=require la conexión tiene que seguir VERIFICANDO el certificado, que es lo que hace ' +
    'hoy: si esto queda en false, un update de pg debilita la conexión sin que nadie lo note',
)
assert.ok(
  !neon.cadena.includes('sslmode'),
  'el sslmode no puede llegar a pg: es lo que dispara la advertencia en cada arranque de función, ' +
    'y con el cron cada 5 minutos son ~288 marcas rojas por día en los logs de Vercel',
)
assert.ok(
  neon.cadena.startsWith('postgresql://usuario:clave@ep-algo-123-pooler.sa-east-1.aws.neon.tech/neondb'),
  'el resto de la cadena queda intacto: host, credenciales y base',
)

/* ---------- 2) Los otros modos laxos, igual ---------- */

for (const modo of ['prefer', 'verify-ca', 'verify-full', 'no-verify']) {
  const r = conSslExplicito(`postgresql://u:c@host/db?sslmode=${modo}`)
  assert.deepEqual(r.ssl, { rejectUnauthorized: true }, `sslmode=${modo} tiene que verificar igual`)
  assert.ok(!r.cadena.includes('sslmode'), `sslmode=${modo} no puede llegar a pg`)
}

/* ---------- 3) Sin sslmode: verifica (la opción segura por defecto) ---------- */

assert.deepEqual(
  conSslExplicito('postgresql://u:c@host/db').ssl,
  { rejectUnauthorized: true },
  'sin sslmode en la cadena se verifica igual: ante la duda, la opción segura',
)

/* ---------- 4) `disable` es la única salida sin TLS ---------- */

const local = conSslExplicito('postgresql://u:c@localhost:5432/db?sslmode=disable')
assert.equal(local.ssl, false, 'sslmode=disable es el escape para un Postgres local, y se respeta')

/* ---------- 5) `uselibpqcompat` tampoco puede quedar suelto ---------- */

const compat = conSslExplicito('postgresql://u:c@host/db?uselibpqcompat=true&sslmode=require')
assert.ok(
  !compat.cadena.includes('uselibpqcompat'),
  'suelto no hace nada y deja viva la advertencia que este cambio viene a sacar',
)
assert.deepEqual(compat.ssl, { rejectUnauthorized: true })

/* ---------- 6) Otros parámetros de la cadena se conservan ---------- */

const conExtras = conSslExplicito(
  'postgresql://u:c@host/db?sslmode=require&connect_timeout=10&application_name=labatea',
)
assert.ok(conExtras.cadena.includes('connect_timeout=10'), 'no se pierden otros parámetros')
assert.ok(conExtras.cadena.includes('application_name=labatea'), 'ni los de diagnóstico')

/* ---------- 7) Una cadena que no es URL no rompe el arranque ---------- */

const rara = conSslExplicito('esto no es una url')
assert.equal(rara.cadena, 'esto no es una url', 'se deja tal cual, para que la decida pg')
assert.deepEqual(rara.ssl, { rejectUnauthorized: true }, 'y se verifica igual')

console.log('db/ssl: OK · la conexión verifica el certificado sin depender de la versión de pg')
