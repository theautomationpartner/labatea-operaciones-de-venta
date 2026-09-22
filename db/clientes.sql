-- Padrón de clientes cacheado en el servidor: lo que escribe el Cron Job y lee /api/clientes.
--
-- Misma base que el segundo factor (Neon, `DATABASE_URL` con pooler; ver `db/mfa.sql`).
--
-- Aplicarlo, desde el SQL Editor de Neon (pegar este archivo) o por consola:
--   psql "$DATABASE_URL" -f db/clientes.sql
--
-- Es idempotente (todo va con IF NOT EXISTS): correrlo de nuevo no rompe ni borra nada.
--
-- Por qué existe: la primera etapa de toda operación es elegir el cliente, y buscarlo contra
-- Monday cuesta una vuelta de paginación por cada intento. Acá vive el padrón entero —medido:
-- 2681 clientes operables, 884 KB crudos— para que la app pueda buscar en local mientras se
-- escribe, sin consultar nada.

-- ── El padrón ───────────────────────────────────────────────────────────────────────────────────
create table if not exists clientes_cache (
  item_id        text        primary key,
  -- Desnormalizados fuera del JSON porque son por los que se busca y por los que se ordena; tenerlos
  -- como columnas permite indexarlos el día que la búsqueda pase al servidor.
  codigo         text        not null default '',
  nombre         text        not null default '',
  cuit           text        not null default '',
  -- El objeto `Cliente` entero, tal como lo consume la app. Se guarda armado y no crudo: el mapeo
  -- (que incluye el cálculo del crédito) lo hace el cron una vez, no cada lector.
  datos          jsonb       not null,
  -- Sólo se mueve si los datos CAMBIARON de verdad. Es el cursor con el que la app pide el delta:
  -- si el barrido diario lo pisara en las 2681 filas, cada navegador se volvería a bajar el padrón
  -- entero todas las noches.
  actualizado_en timestamptz not null default now(),
  -- Lo pisa TODA corrida completa, cambien los datos o no. Es lo que permite barrer al final:
  -- la fila que no se vio en esta vuelta ya no está en el tablero.
  visto_en       timestamptz not null default now()
);

-- El delta de la app es `where actualizado_en > $1`: es la consulta caliente.
create index if not exists clientes_cache_actualizado on clientes_cache (actualizado_en);

-- ── Bajas ───────────────────────────────────────────────────────────────────────────────────────
-- Una baja tiene que poder VIAJAR en el delta. Sin esta tabla, el cliente que se elimina del
-- tablero —o que deja de ser categoría "Clientes", o pasa a INACTIVO— desaparece del caché pero
-- sigue vivo para siempre en el navegador de quien ya se lo había bajado, y se lo puede seguir
-- eligiendo para vender.
create table if not exists clientes_bajas (
  item_id text        primary key,
  baja_en timestamptz not null default now()
);

create index if not exists clientes_bajas_fecha on clientes_bajas (baja_en);

-- ── Estado de la sincronización ─────────────────────────────────────────────────────────────────
-- Una sola fila. Guarda hasta dónde llegó la última corrida y hace de lock entre corridas.
create table if not exists clientes_sync (
  id              int         primary key default 1 check (id = 1),
  -- `updated_at` más nuevo ya procesado. De acá arranca la corrida incremental: le pide a Monday
  -- sólo lo modificado después de esta marca.
  marca           timestamptz,
  ultimo_ok       timestamptz,
  ultimo_completo timestamptz,
  clientes        int         not null default 0,
  duracion_ms     int,
  -- El último fallo, en texto. Que quede acá y no sólo en los logs permite que el endpoint de
  -- lectura pueda decir "el padrón está viejo y por qué".
  error           text,
  -- Lock de corrida. Vercel avisa que puede disparar una invocación mientras la anterior sigue
  -- viva, y que ocasionalmente repite una. Sin esto, dos barridos completos simultáneos se pisan
  -- el `visto_en` y el reaping del final borra filas que el otro todavía no alcanzó a tocar.
  corriendo_desde timestamptz
);

insert into clientes_sync (id) values (1) on conflict do nothing;
