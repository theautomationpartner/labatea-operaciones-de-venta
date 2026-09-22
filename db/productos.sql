-- Catálogo de productos cacheado en el servidor: lo que escribe el Cron Job y lee /api/productos.
--
-- Misma base que el padrón de clientes y el segundo factor (Neon, `DATABASE_URL` con pooler; ver
-- `db/clientes.sql` y `db/mfa.sql`).
--
-- Aplicarlo, desde el SQL Editor de Neon (pegar este archivo) o por consola:
--   psql "$DATABASE_URL" -f db/productos.sql
--
-- Es idempotente (todo va con IF NOT EXISTS): correrlo de nuevo no rompe ni borra nada.
--
-- Por qué existe: elegir la mercadería es la etapa más tipeada de PRESUPUESTO, VENTA y REMITO, y
-- hasta acá cada intento costaba una consulta a Monday —escribir, apretar Buscar, esperar, corregir
-- una letra, volver a esperar—. Con el catálogo en la base la app busca en local mientras se
-- escribe. Medido sobre el tablero real: 1285 productos, 612 KB crudos, 102 KB comprimidos.
--
-- ── Lo que NO está acá ──
-- El STOCK. Las tres cantidades (físico, comercial, disponible) viven en el ítem conectado de
-- "🧮Stock y Movimientos" y se mueven con cada venta: cachearlas sería mostrar un disponible que
-- ya se vendió. El caché guarda el `stock_id` y la app lee el stock fresco contra Monday recién
-- cuando se elige el producto —una consulta por selección, no una por tecla—.

-- ── El catálogo ─────────────────────────────────────────────────────────────────────────────────
create table if not exists productos_cache (
  item_id        text        primary key,
  -- Desnormalizados fuera del JSON porque son por los que se busca y por los que se ordena.
  codigo         text        not null default '',
  nombre         text        not null default '',
  -- Taxonomía del maestro. Son las tres columnas por las que filtra el buscador (Rubro, Subrubro,
  -- Categoría); como columnas se pueden indexar el día que el filtrado pase al servidor.
  rubro          text        not null default '',
  subrubro       text        not null default '',
  categoria      text        not null default '',
  -- El `ProductoCache` entero, tal como lo consume la app: los ocho precios de lista, los márgenes,
  -- el costo, el IVA y la taxonomía. Se guarda ya mapeado y no crudo: el mapeo lo hace el cron una
  -- vez, no cada lector.
  datos          jsonb       not null,
  -- Sólo se mueve si los datos CAMBIARON de verdad. Es el cursor con el que la app pide el delta:
  -- si el barrido diario lo pisara en las 1285 filas, cada navegador se volvería a bajar el
  -- catálogo entero todas las noches.
  actualizado_en timestamptz not null default now(),
  -- Lo pisa TODA corrida completa, cambien los datos o no. Es lo que permite barrer al final:
  -- la fila que no se vio en esta vuelta ya no está en el tablero.
  visto_en       timestamptz not null default now()
);

-- El delta de la app es `where actualizado_en > $1`: es la consulta caliente.
create index if not exists productos_cache_actualizado on productos_cache (actualizado_en);

-- ── Bajas ───────────────────────────────────────────────────────────────────────────────────────
-- Una baja tiene que poder VIAJAR en el delta. Sin esta tabla, el producto que se elimina del
-- maestro desaparece del caché pero sigue vivo para siempre en el navegador de quien ya se lo había
-- bajado, y se lo puede seguir cargando en un presupuesto.
create table if not exists productos_bajas (
  item_id text        primary key,
  baja_en timestamptz not null default now()
);

create index if not exists productos_bajas_fecha on productos_bajas (baja_en);

-- ── Estado de la sincronización ─────────────────────────────────────────────────────────────────
-- Una sola fila. Guarda hasta dónde llegó la última corrida y hace de lock entre corridas.
create table if not exists productos_sync (
  id              int         primary key default 1 check (id = 1),
  -- `updated_at` más nuevo ya procesado. De acá arranca la corrida incremental: le pide a Monday
  -- sólo lo modificado después de esta marca.
  marca           timestamptz,
  ultimo_ok       timestamptz,
  ultimo_completo timestamptz,
  productos       int         not null default 0,
  duracion_ms     int,
  -- El último fallo, en texto. Que quede acá y no sólo en los logs permite que el endpoint de
  -- lectura pueda decir "el catálogo está viejo y por qué".
  error           text,
  -- Lock de corrida. Vercel avisa que puede disparar una invocación mientras la anterior sigue
  -- viva, y que ocasionalmente repite una. Sin esto, dos barridos completos simultáneos se pisan
  -- el `visto_en` y el reaping del final borra filas que el otro todavía no alcanzó a tocar.
  corriendo_desde timestamptz
);

insert into productos_sync (id) values (1) on conflict do nothing;
