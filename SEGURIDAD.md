# Seguridad · Capa 1 — "El Portero"

La app corre **sólo** dentro de un iframe de monday.com. Esta capa hace cumplir eso desde el borde
(Vercel), antes de que la petición llegue al código. No autentica usuarios: eso es la Capa 2
(verificación del `sessionToken` de Monday + código de 6 dígitos).

## Qué quedó implementado

| Archivo | Qué hace |
| --- | --- |
| [vercel.json](vercel.json) | Cabeceras de seguridad en todas las rutas + fallback SPA de Vite |
| [middleware.ts](middleware.ts) | Valida la procedencia (`Referer`) de `/api/monday` y `/api/monday-upload`; 403 si no cierra |
| [tests/portero-referer.test.ts](tests/portero-referer.test.ts) | Fija la comparación por sufijo (`npm run test:portero`) |

### Cabeceras (`vercel.json`)

- `Content-Security-Policy: frame-ancestors https://*.monday.com https://*.monday.app;` — sólo
  Monday puede embeber la app. Es lo que corta el **clickjacking**: cualquier otra página que la
  ponga en un iframe recibe un frame en blanco. Se prefiere a `X-Frame-Options` porque `ALLOW-FROM`
  está deprecado y `SAMEORIGIN` rompería el iframe.
- `X-Content-Type-Options: nosniff` — el navegador no adivina tipos; nada servido como texto se
  ejecuta como script.
- `Referrer-Policy: strict-origin-when-cross-origin` — hacia afuera sólo viaja el origen, nunca la
  URL completa con `boardId`/`itemId`. Hacia adentro (mismo origen) sigue viajando entera, que es
  justo lo que el middleware necesita para trabajar.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — dos años de https
  obligatorio, sin primera visita en claro.

### Portero de la API (`middleware.ts`)

Protege únicamente las rutas que gastan `MONDAY_TOKEN` (el token del servidor): `/api/monday` y
`/api/monday-upload`. Deja pasar si el `Referer`:

1. es el **host propio del deploy** (la app pegándose a sí misma desde adentro del iframe — el
   tráfico normal, porque el bundle se sirve desde Vercel, no desde Monday); o
2. es **https** y su `new URL(referer).hostname` termina en `.monday.com` / `.monday.app`, o es el
   dominio pelado.

Cualquier otra cosa —o la falta de `Referer`— es **403**. La comparación es por sufijo con el punto
incluido, nunca `.includes()`: `monday.com.sitio-malicioso.net` y `falsomonday.com` quedan afuera.

**Alcance real:** un `Referer` lo puede inventar cualquier cliente que no sea un navegador (`curl`).
Esta regla frena el acceso casual, el embebido ajeno y los scripts que peguen desde otro sitio; el
control que no se puede falsificar llega con la Capa 2 y con el WAF de acá abajo.

## Pasos manuales en el panel de Vercel (WAF / Firewall)

Panel → proyecto `operaciones-de-venta` → pestaña **Firewall** → **Configure**.

### 1. Rate limiting global (anti-saturación)

1. **Firewall → Custom Rules → New Rule**. Nombre: `rate-limit-global`.
2. Condición: `Request Path` → `starts with` → `/`.
3. Acción: **Rate Limit**.
4. Límite: **200 peticiones / 60 s**, agrupadas por **IP Address**.
5. Al superarlo: **Deny** (403), ventana de bloqueo **60 s**.
6. **Save** y luego **Publish** (los cambios del firewall no aplican hasta publicarlos).

> Referencia para ajustar: una carga de venta completa dispara varias decenas de llamadas a
> `/api/monday` en pocos segundos. Arrancá en 200/min, mirá **Firewall → Observability** una semana
> y bajalo si sobra margen.

### 2. Límite estricto del endpoint del código de 6 dígitos

Para cuando exista la ruta de validación (Capa 2), p. ej. `/api/auth/verificar-codigo`:

1. **New Rule**. Nombre: `rate-limit-codigo`.
2. Condición: `Request Path` → `equals` → `/api/auth/verificar-codigo`
   **AND** `Request Method` → `equals` → `POST`.
3. Acción: **Rate Limit**.
4. Límite: **5 peticiones / 900 s** (15 minutos), agrupadas por **IP Address**.
   Si el endpoint recibe un identificador de usuario, agrupá también por ese header —
   es lo que impide que una sola IP pruebe códigos contra muchas cuentas.
5. Al superarlo: **Deny**, ventana de bloqueo **900 s**.
6. Ordená esta regla **por encima** de `rate-limit-global` (las reglas evalúan de arriba hacia
   abajo y gana la primera que matchea).
7. **Save** → **Publish**.

### 3. Complementos recomendados (una sola vez)

- **Attack Challenge Mode**: dejarlo *off* en operación normal; encenderlo si aparece un pico de
  tráfico raro. Mete un challenge del navegador que el iframe de Monday resuelve solo.
- **Bot Filter / managed rules**: activar el bloqueo de bots maliciosos conocidos.
- **Firewall → Observability**: revisar semanalmente los 403 con la cabecera `x-portero`; ahí se ve
  si alguien está golpeando `/api/monday` desde afuera.

---

# Seguridad · Capa 2 — autenticación criptográfica y lista blanca

La Capa 1 mira DE DÓNDE viene el pedido. Esta mira QUIÉN lo hace, y no se puede falsificar: el
navegador manda un token que firmó Monday, y el servidor verifica esa firma con un secreto que nunca
sale del deploy.

## El recorrido de un pedido

1. El iframe le pide a Monday el **session token** del usuario ([src/lib/mondayAuth.ts](src/lib/mondayAuth.ts)),
   lo cachea en memoria y lo manda en `Authorization: Bearer <jwt>`.
2. La Edge Middleware (Capa 1) revisa la procedencia.
3. [api/_guard.ts](api/_guard.ts) verifica la **firma** con `MONDAY_SIGNING_SECRET` —y si no cierra,
   reintenta con `MONDAY_CLIENT_SECRET`—, fijando
   `algorithms: ['HS256']`, y saca `user_id`, `account_id` e `is_guest`.
4. [api/_whitelist.ts](api/_whitelist.ts) consulta el **tablero privado** y exige el estado activo.
5. Recién ahí el endpoint usa `MONDAY_TOKEN` y habla con la API de Monday.

Rechazos: **401** si no se puede probar quién es (falta el token, está vencido, la firma no cierra);
**403** si se sabe quién es pero no corresponde (invitado externo, cuenta ajena, fuera de la lista).
Hacia afuera van sólo `Unauthorized` / `Forbidden`: el motivo queda en el log del servidor, porque
contarle al que prueba si el usuario existe en el tablero es entregarle la mitad del trabajo.

## Decisiones que conviene conocer

- **`jwt.verify`, nunca `jwt.decode`.** Decodificar es leer un papel sin mirar el sello. Y el
  algoritmo va fijado a HS256: sin esa lista, un token con `alg: none` y la firma vacía entra como
  si fuera legítimo. Los dos casos están cubiertos por [tests/guard-sesion.test.ts](tests/guard-sesion.test.ts).
- **Dos claves posibles, un solo intento de rescate.** Monday firma el session token con el
  **Client Secret** —su ejemplo es literalmente `jwt.verify(token, MY_CLIENT_SECRET)`—, y algunas
  configuraciones usan el *Signing Secret*. Son dos secretos privados de la misma app: aceptar cualquiera de los dos prueba
  el origen igual de bien. Un token **vencido** corta el reintento —la firma cerró, el problema es
  otro— para que el log diga "vencido" y no "firma inválida".
- **La lista blanca se consulta en el backend, siempre.** Si la consulta viviera en el frontend, el
  usuario se estaría respondiendo que sí a sí mismo.
- **El tablero es privado** para que el propio usuario no pueda editar la lista que lo habilita.
- **Falla cerrada.** Si Monday no contesta, no entra nadie. El fallo no se cachea, así que la app
  vuelve sola en cuanto la API responde.
- **Caché de 5 min para los "sí"** (es el techo de lo que tarda una revocación en hacerse efectiva) y
  **30 s para los "no"** (un alta recién hecha entra enseguida). Es por instancia de la función: es
  un ahorro de cuota, no una fuente de verdad.
- **Los endpoints corren en Node, no en edge.** `jsonwebtoken` necesita `crypto` y `Buffer`. Y en
  Node, Vercel invoca al `export default` con los objetos de `node:http`, así que la firma es
  `(req, res)` — con la firma web da `FUNCTION_INVOCATION_FAILED`. Si algún día hay que volver al
  edge, el reemplazo es `jose` con Web Crypto.

## Puesta en marcha (pasos manuales)

### 1. Tablero "Lista Blanca" (id `18427866249`) — ya está listo

Tablero **privado**, con tres columnas que importan:

| Columna | Id | Para qué |
| --- | --- | --- |
| Name | `name` | el nombre de la persona, para leerlo de un vistazo |
| User ID | `text_mm6hqsmt` | **la que decide**: el id numérico del usuario en Monday |
| Estado | `status` | `Activo` habilita; cualquier otra etiqueta (`Inactivo`) deja afuera |
| ID APP | `dropdown_mm6jamkm` | **los IDs de las apps que esa persona puede usar**; sin el de esta app, no entra |

Ya tiene cargada la primera fila: **The Automation Partner · `107870718` · Activo**.

- **Dar de alta:** fila nueva con el nombre, el User ID en la columna de texto, el estado en
  `Activo` **y el ID de esta app en "ID APP"**. Las dos condiciones se exigen juntas: estar activo
  sin el ID declarado no habilita nada. Una celda vacía no significa "todas las apps" —si lo
  significara, dar de alta a alguien en una le abriría la puerta de todas las demás—. Entra en menos de 30 s (es lo que dura un "no" en caché).
- **Dar de baja:** cambiar el estado a `Inactivo`. Queda afuera en hasta 5 minutos, sin tocar código
  ni redeployar.
- El User ID de cualquier persona sale de monday.com → su perfil → el número en la URL, o
  preguntándoselo a la API con `me { id }` desde su sesión.

La etiqueta que habilita se puede cambiar sin tocar código con `WHITELIST_STATUS_ACTIVO`; por
defecto es `Activo`, que es la que el tablero tiene hoy.

### 2. App de Monday

monday.com → Developers → **la app que embebe esta vista** → **Basic Information** → copiá el
**Client Secret** (y de paso el Signing Secret, que va como rescate).

**Cuál app importa.** Si en la cuenta hay más de una, el secreto tiene que ser el de la que emite
el token. El session token lleva su `app_id` adentro: con el secreto de otra app la firma no cierra
nunca, y el síntoma es un 401 idéntico al de un usuario sin permisos. Ante la duda, el log del
servidor dice `token inválido (app NNN)` y ese número tiene que ser el App ID del Developer Center.

### 3. Variables de entorno en Vercel

Project → Settings → Environment Variables (Production y Preview):

| Variable | Valor |
| --- | --- |
| `MONDAY_CLIENT_SECRET` | **el Client Secret de la app** — es con éste que Monday firma el session token |
| `MONDAY_SIGNING_SECRET` | el Signing Secret de la misma pantalla (clave de rescate; cargar las dos) |
| `MONDAY_API_TOKEN` | token de API con lectura sobre el tablero privado |
| `WHITELIST_BOARD_ID` | `18427866249` |
| `MONDAY_ACCOUNT_ID` | `35883216` (opcional, ata la app a la cuenta) |

Hace falta al menos uno de los dos secretos, más el token y el board: sin ningún secreto el backend
rechaza todo, que es el comportamiento correcto para una app mal configurada.

### 4. Probar en local

**En `npm run dev` no te rechaza nada, y es a propósito.** En desarrollo la app no toca `/api/*`:
pega contra el proxy de Vite (`/monday-api`) con tu token personal de `.env.local`. Las funciones
serverless no corren, el middleware es de Vercel, y el guardián vive adentro de esas funciones. Las
dos capas simplemente no existen en localhost.

La contracara: **el desarrollo diario nunca ejercita la Capa 2**, así que un error de configuración
recién aparece en el deploy. Por eso los tests de abajo no son opcionales, y conviene abrir un
Preview antes de tocar producción.

Si querés ejercitarla igual, hay dos caminos:

1. **Firmándote un token vos mismo** (lo mismo que hace `test:guard`): `vercel dev` para que las
   funciones corran de verdad, las variables cargadas, y un JWT armado con el mismo secreto:

   ```bash
   node -e "console.log(require('jsonwebtoken').sign({dat:{user_id:107870718,account_id:35883216,is_guest:false}}, process.env.MONDAY_SIGNING_SECRET, {expiresIn:'5m'}))"

   curl -X POST http://localhost:3000/api/monday -H "Authorization: Bearer <el-token>" -H "Content-Type: application/json" -d "{\"query\":\"{ me { id } }\"}"
   ```

   Cambiá el estado de la fila a `Inactivo` y la misma llamada tiene que pasar de 200 a 403.

2. **Desde el iframe de verdad**: apuntar la URL del app feature a un Preview de Vercel y abrirlo
   dentro de Monday. Es el único camino que ejercita el session token real, porque ese token lo
   emite el contenedor de Monday y no existe fuera del iframe.

### 5. Verificación

```bash
npm run test:guard      # firma, alg:none, vencido, invitado, cuenta ajena
npm run test:whitelist  # activo / no activo / ausente, caché y falla cerrada
npm run test:portero    # Capa 1: procedencia por sufijo de dominio
```

Y en el deploy: entrar desde Monday tiene que andar; pegarle a `/api/monday` con `curl` (sin token
o con uno inventado) tiene que devolver 401.

---

# Seguridad · Capa 3 — segundo factor (TOTP) y dispositivos confiables

Las capas 1 y 2 prueban de dónde viene el pedido y quién lo firma. Esta prueba que la persona tiene
su teléfono, y es la única que sobrevive a que a alguien le roben la sesión de Monday.

**Estado: completa (backend + muro visual) y APAGADA hasta cargar sus variables.** Con
`MFA_REQUERIDO` sin encender, el guardián no la exige y la app funciona como hasta ahora.
Ver "Encender la capa".

## Piezas

| Archivo | Qué hace |
| --- | --- |
| [db/mfa.sql](db/mfa.sql) | Las cuatro tablas. Corre igual en Neon y en Supabase |
| [api/_db.ts](api/_db.ts) | Pool de Postgres, una conexión por instancia |
| [api/_mfaStore.ts](api/_mfaStore.ts) | Persistencia detrás de una interfaz (los tests usan una en memoria) |
| [api/_mfa.ts](api/_mfa.ts) | Cifrado, TOTP, códigos de recuperación, límite de intentos, dispositivos |
| [api/mfa/setup.ts](api/mfa/setup.ts) | `POST` · devuelve el QR y deja el secreto pendiente |
| [api/mfa/confirm.ts](api/mfa/confirm.ts) | `POST` · primer código; activa y entrega 10 códigos de recuperación |
| [api/mfa/verify.ts](api/mfa/verify.ts) | `POST` · verificación diaria; emite el dispositivo confiable |
| [api/mfa/status.ts](api/mfa/status.ts) | `POST` · qué pantalla mostrar |
| [src/lib/deviceToken.ts](src/lib/deviceToken.ts) | El token en `localStorage`, con respaldo en memoria |
| [src/services/mfa.ts](src/services/mfa.ts) | Cliente de los cuatro endpoints |
| [src/components/ui/MfaGuard.tsx](src/components/ui/MfaGuard.tsx) | El muro: QR, códigos de rescate y verificación diaria |
| [tests/mfa.test.ts](tests/mfa.test.ts) | `npm run test:mfa` |

## Decisiones que conviene conocer

- **El secreto TOTP se guarda cifrado** (AES-256-GCM, clave en el entorno del deploy). Una base
  filtrada, sin esa clave, no alcanza para generar códigos. GCM y no CBC porque además de ocultar
  autentica: un secreto editado en la base falla al descifrarse en vez de devolver basura.
- **Los códigos de recuperación y los tokens de dispositivo se guardan hasheados** (HMAC-SHA256 con
  la clave de pimienta). No hace falta un KDF lento: son secretos de alta entropía generados por
  nosotros, no contraseñas elegidas por una persona. bcrypt existe para frenar la fuerza bruta sobre
  algo adivinable, y acá no hay nada que adivinar.
- **Un código no se puede usar dos veces.** Se guarda el time step de cada verificación y se rechaza
  cualquier código de ese paso o anterior. Sin esto, un código sigue sirviendo los segundos que le
  quedan de vida: suficiente para que alguien que lo vio por encima del hombro lo repita.
- **La tolerancia es de ±30 s**, un período para cada lado. En otplib 13 eso se escribe
  `epochTolerance: 30`; el `window: 1` de la v12 ya no existe y son la misma cosa.
- **El límite de intentos vive en la base, no en memoria.** Cinco fallos cada quince minutos por
  usuario. En serverless un contador en memoria no limita nada: cada instancia arranca con el suyo
  en cero, y alcanza con reintentar para que te toque otra. Corta ANTES de mirar el código, así que
  ni uno correcto pasa — si pasara, el propio límite le diría al atacante cuándo acertó.
- **Nada de cookies.** La app corre en un iframe servido desde otro dominio: para el navegador es
  contexto de terceros, y Safari bloquea esas cookies desde hace años. El dispositivo confiable
  viaja en `X-Device-Token`, una cabecera que el frontend pone a mano. Lo peor de la alternativa no
  es que falle, es cómo falla: anda en el navegador del que programa y no en el del que trabaja.
- **`localStorage` en un iframe está particionado**, y para esto está bien: lo guardado queda atado
  al par (monday.com, esta app). Pero el acceso puede TIRAR —navegación privada, almacenamiento
  bloqueado—, así que cada operación va en try/catch con respaldo en memoria: la sesión de hoy no se
  rompe, el usuario tipea el código de nuevo mañana.
- **Re-enrolarse invalida los dispositivos viejos.** Si alguien vuelve a enrolarse porque perdió el
  teléfono, lo último que se quiere es que el equipo del que lo encontró siga entrando.
- **El segundo factor se exige en el guardián**, junto con la firma y la lista blanca. No hay
  endpoint de datos que no pase por ahí, así que no existe la puerta de atrás de pegarle directo a
  `/api/monday`. Los `/api/mfa/*` son la excepción necesaria: piden firma y lista blanca, pero no
  segundo factor.

## La secuencia, en tres pasos

`App.tsx` es una máquina de estados y no dibuja nada de la operación hasta superar los tres:

1. **Lista blanca.** Se pide el `sessionToken` a Monday y se consulta `/api/vendedores`, que verifica
   la firma y busca al usuario en el tablero privado. Este endpoint **no** exige segundo factor, y es
   a propósito: es el paso 1, y exigir el paso 3 acá haría imposible llegar al muro.
2. **Caché del usuario.** El usuario habilitado queda en el estado global con sus equipos de Monday,
   de los que sale el rol —Administrador o Vendedor, ver [src/lib/permisos.ts](src/lib/permisos.ts)—.
   Tiene que pasar antes de dibujar: media app pregunta si puede editar tal cosa.
3. **Muro del segundo factor.** Se renderiza únicamente [MfaGuard](src/components/ui/MfaGuard.tsx).
   La app se libera sólo cuando el backend confirma el código y emite el `deviceToken`.

Con un dispositivo confiable vigente el paso 3 no pregunta nada. Si `MFA_REQUERIDO` está apagado, se
pasa de largo y la capa queda inerte.

## El muro (MfaGuard)

- **Primera vez:** llama a `/api/mfa/setup`, muestra el QR (y el secreto en texto por si la cámara no
  coopera), pide el primer código contra `/api/mfa/confirm` y entrega los **diez códigos de rescate**.
  Se ven una sola vez —en la base sólo queda su hash— y hay que tildar "ya los guardé" para seguir.
- **Uso regular:** input de seis dígitos y la casilla *"Confiar en este dispositivo por 30 días"*,
  contra `/api/mfa/verify`. El mismo campo acepta un código de rescate: quien perdió el teléfono no
  tiene que buscar otra pantalla.
- Ante el límite de intentos el formulario queda cerrado: reintentar antes de los 15 minutos da el
  mismo rechazo, y un botón habilitado invita a gastar intentos al pedo.

**Confirmar el alta ya deja entrar.** El servidor emite ahí mismo un dispositivo de la jornada (12 h);
sin eso, quien termina de enrolarse chocaría contra el muro un segundo después. La casilla de los 30
días aparece la próxima vez, cuando ya sabe de qué se trata.

## Base de datos (Neon desde Vercel)

1. Vercel → tu proyecto → **Storage** → **Create Database** → **Neon**. Nombre:
   **`La Batea Authenticated Users`**. Conectala al proyecto: la integración inyecta sola la cadena
   de conexión (`DATABASE_URL` / `POSTGRES_URL`), y el código acepta cualquiera de las dos.
2. Abrí el **SQL Editor** de Neon, pegá [db/mfa.sql](db/mfa.sql) y ejecutalo. También sirve
   `psql "$DATABASE_URL" -f db/mfa.sql`. Es idempotente: correrlo de nuevo no borra nada.
3. Crea cuatro tablas: `mfa_usuarios` (secreto TOTP cifrado), `mfa_recuperacion` (códigos hasheados),
   `mfa_dispositivos` (tokens hasheados con vencimiento) y `mfa_intentos` (el límite de velocidad).

## Encender la capa

| Variable | Valor |
| --- | --- |
| `DATABASE_URL` | la inyecta la integración de Neon |
| `MFA_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `MFA_EMISOR` | opcional; el nombre que muestra la app de verificación (por defecto `La Batea`) |
| `MFA_REQUERIDO` | `1` para exigirlo |

**El orden importa:** base creada → SQL aplicado → `DATABASE_URL` y `MFA_ENCRYPTION_KEY` cargadas →
**redeploy** → recién ahí `MFA_REQUERIDO=1` y otro redeploy. Al revés, el primero que queda afuera
sos vos. Y si perdés `MFA_ENCRYPTION_KEY` se pierden todos los enrolamientos: hay que volver a
enrolar a todo el mundo.
