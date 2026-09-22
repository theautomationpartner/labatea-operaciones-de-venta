-- Padrón de PERSONAS cacheado en el servidor: lo que escribe el Cron Job y lee /api/personas.
--
-- Misma base que el segundo factor (Neon, `DATABASE_URL` con pooler; ver `db/mfa.sql`).
--
-- Aplicarlo, desde el SQL Editor de Neon (pegar este archivo) o por consola:
--   psql "$DATABASE_URL" -f db/personas.sql
--
-- Es idempotente (todo va con IF NOT EXISTS): correrlo de nuevo no rompe ni borra nada.
--
-- ── Por qué existe ──
-- La primera etapa de toda operación es elegir el cliente, y buscarlo contra Monday cuesta una
-- vuelta de paginación por cada intento. Acá vive el padrón entero para que la app pueda buscar en
-- local mientras se escribe, sin consultar nada.
--
-- ── Por qué "personas" y no "clientes" ──
-- Este caché se llamó `clientes_cache` mientras guardó sólo clientes. Ahora guarda CLIENTES Y
-- PROVEEDORES —medido: 2680 sólo cliente, 1225 sólo proveedor, 1 que es las dos cosas—, porque el
-- padrón dejó de ser de esta app: la app de ventas consume los clientes y otra app consume los
-- proveedores desde esta misma base. Una tabla llamada `clientes_cache` con 1225 proveedores adentro
-- es la clase de nombre que le cuesta horas al que llegue después.
--
-- Las tablas viejas (`clientes_cache`, `clientes_bajas`, `clientes_sync`) quedan sin uso. Son caché
-- puro, así que se reconstruye solo en la primera corrida y se pueden descartar A MANO —no acá,
-- porque borrar datos no tiene que pasar en silencio— una vez que este padrón esté cargado:
--   drop table if exists clientes_cache, clientes_bajas, clientes_sync;

-- ── El padrón ───────────────────────────────────────────────────────────────────────────────────
create table if not exists personas_cache (
  item_id        text        primary key,
  -- Desnormalizados fuera del JSON porque son por los que se busca y por los que se ordena; tenerlos
  -- como columnas permite indexarlos el día que la búsqueda pase al servidor.
  codigo         text        not null default '',
  nombre         text        not null default '',
  cuit           text        not null default '',
  -- Qué es esta persona. Dos decisiones acá, y ninguna es de estilo:
  --
  -- · Es una COLUMNA y no un campo adentro de `datos` porque es por lo que se filtra: la app de
  --   ventas pide los clientes y la otra app pide los proveedores. Filtrando por dentro del jsonb
  --   habría que traer las 3906 filas para descartar la mitad en memoria.
  -- · Es un ARREGLO porque "✋Categoria" en Monday es multi-valor y el solapamiento es real: hay una
  --   persona que es cliente Y proveedor. Guardar "la" categoría la dejaría afuera de una de las
  --   dos listas, y nadie se enteraría hasta no encontrarla.
  categorias     text[]      not null default '{}',   -- 'cliente' | 'proveedor'
  -- El objeto que consume la app, ya armado. El mapeo (que incluye el cálculo del crédito) lo hace
  -- el cron una vez, no cada lector.
  datos          jsonb       not null,
  -- Sólo se mueve si los datos CAMBIARON de verdad. Es el cursor con el que la app pide el delta:
  -- si el barrido diario lo pisara en las 3906 filas, cada navegador se volvería a bajar el padrón
  -- entero todas las noches.
  actualizado_en timestamptz not null default now(),
  -- Lo pisa TODA corrida completa, cambien los datos o no. Es lo que permite barrer al final:
  -- la fila que no se vio en esta vuelta ya no está en el tablero.
  visto_en       timestamptz not null default now()
);

-- El delta de la app es `where actualizado_en > $1`: es la consulta caliente.
create index if not exists personas_cache_actualizado on personas_cache (actualizado_en);
-- Y siempre acotada a una categoría. GIN porque la condición es "el arreglo CONTIENE 'cliente'".
create index if not exists personas_cache_categorias on personas_cache using gin (categorias);

-- ── Bajas ───────────────────────────────────────────────────────────────────────────────────────
-- Una baja tiene que poder VIAJAR en el delta. Sin esta tabla, la persona que se elimina del
-- tablero —o que deja de ser cliente y proveedor, o pasa a INACTIVA— desaparece del caché pero
-- sigue viva para siempre en el navegador de quien ya se la había bajado, y se la puede seguir
-- eligiendo para vender.
create table if not exists personas_bajas (
  item_id text        primary key,
  baja_en timestamptz not null default now()
);

create index if not exists personas_bajas_fecha on personas_bajas (baja_en);

-- ── Estado de la sincronización ─────────────────────────────────────────────────────────────────
-- Una sola fila. Guarda hasta dónde llegó la última corrida y hace de lock entre corridas.
create table if not exists personas_sync (
  id              int         primary key default 1 check (id = 1),
  -- `updated_at` más nuevo ya procesado. De acá arranca la corrida incremental: le pide a Monday
  -- sólo lo modificado después de esta marca.
  marca           timestamptz,
  ultimo_ok       timestamptz,
  ultimo_completo timestamptz,
  personas        int         not null default 0,
  duracion_ms     int,
  -- El último fallo, en texto. Que quede acá y no sólo en los logs permite que el endpoint de
  -- lectura pueda decir "el padrón está viejo y por qué".
  error           text,
  -- Lock de corrida. Vercel avisa que puede disparar una invocación mientras la anterior sigue
  -- viva, y que ocasionalmente repite una. Sin esto, dos barridos completos simultáneos se pisan
  -- el `visto_en` y el reaping del final borra filas que el otro todavía no alcanzó a tocar.
  corriendo_desde timestamptz
);

insert into personas_sync (id) values (1) on conflict do nothing;
