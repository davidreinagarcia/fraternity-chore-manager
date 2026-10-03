# Rush (PNMs, check-in, bids)

Herramientas para el Rush chair: lista viva de PNMs con comentarios de los hermanos, formulario de puerta, seguimiento de quién vuelve cada día, flush, bids y aceptados con mensaje de bienvenida.
El vocabulario sale de `CHAPTER_CONFIG.labels` (`label_rush`, `label_rush_chair`, `label_pnm`, `label_pnm_full`, `label_bid`, `label_flush`, `label_flushed`, `label_chapter_meeting`). Módulo `module_rush` (por defecto `true`).

## Estado

Hecho, sin probar contra la Sheet ni Gmail reales. Backend probado con mocks (48 tests) y UI con un harness local (node server + shim de `google.script.run`).

## Piezas

- `Rush.gs` — todo el backend.
- `RushDoorApp.html` (`?app=rushdoor`) — formulario de puerta (kiosk): nombre, año, teléfono, Instagram/social, email opcional. Tras enviar enseña "Welcome" y se resetea a los 4 s. Cerrado por defecto ("Check-in is closed") hasta que el officer lo abre.
- `RushApp.html` (`?app=rush`) — tablero de hermanos, sin login de Google. Elige su nombre con NamePicker (se guarda en localStorage `rush_who`), filtro Hoy/Todos, buscador, tarjetas expandibles con visitas y comentarios. Sondea `rushPoll` cada 15 s (pausa con la pestaña oculta). No muestra teléfono ni email.
- `OfficerDashboard.html` → sección Rush (`sec-rush`): interruptor del check-in, links con Copy/Open/QR, stats y pestañas PNMs, Visits by day (matriz PNM × día, clic para marcar), Bids, Accepted, Flushed/Declined. Modales: añadir/editar/detalle, bid, welcome, settings, QR, y "Chapter view" a pantalla completa para leer los comentarios en voz alta (flechas/espacio/Escape).

## Datos

Tabs creados en lazy (`_fmSheet`), todo texto, fechas `yyyy-MM-dd`, timestamps ISO UTC. Datos por semestre (`semester`).

- `rush_pnms`: `pnm_id`, name, year, instagram, phone, email, status, semester, `bid_owner`, `bid_at`, `response_at`, `welcome_sent_at`, source, `created_at`, `updated_at`.
- `rush_visits`: una fila por PNM y día (`visit_id`, `pnm_id`, `date`, `arrived_at`, `source` form|manual, `logged_by`).
- `rush_comments`: `comment_id`, `pnm_id`, `author_key` (`type:memberId`), `author_name`, text, `created_at`.

Estados: `active` → `bid` → `accepted` | `declined`; `flushed` desde `active`. `reopen` devuelve un accepted/declined a bid; `take_back` quita el bid; `restore` devuelve un flushed a active.

## Reglas de comportamiento

- Escrituras bajo `LockService`; versión en `CacheService` (`rush_ver`) para que el polling sea barato (`changed:false` sin tocar la Sheet).
- **Quién vuelve**: al hacer check-in se busca coincidencia por teléfono (solo dígitos), luego handle de Instagram (acepta URL o @), y por nombre exacto solo si uno de los dos lados no tiene identificadores. Un mismo día no duplica visita.
- Un PNM flusheado que vuelve a registrarse por el form se restaura automáticamente a `active`.
- Honeypot `hp` en el form de puerta (se ignora en silencio). El año se valida contra `rush_year_options`.
- Tablero de hermanos: solo `active` y `bid`. Código de acceso opcional (`rush_code`, comparado tolerando ceros a la izquierda). Comentar exige un autor válido del roster.
- Welcome: el destinatario sale siempre del registro guardado (nunca del cliente). Si el PNM no tiene email, el modal ofrece Copy message + Mark as sent. Si el link del form de nuevos miembros no está, el texto lleva `[new member form link goes here]` y el envío pide confirmación.
- La API de officer lleva el PIN como primer argumento (`_checkOfficerPin`). No hay permisos por officer: el "Rush chair" es una sección del dashboard con el PIN compartido.

## Config keys

`rush_open`, `rush_code`, `rush_year_options` (separadas por coma), `rush_welcome_subject`, `rush_welcome_template` (placeholders `{name} {first_name} {chapter} {new_member} {link}`), `module_rush`, y `new_member_form_url` (lo fija el Custom Forms Manager; ver [forms.md](./forms.md)).

## Casos borde conocidos

- La primera llamada concurrente a `rushPoll` puede competir por crear los tabs; se arregla sola en el siguiente poll.
- `rushUpdatePnm` rechaza un año que ya no esté en `rush_year_options`.
- Bajo carga alta de brothers sondeando, cada poll con cambios lee las tres tabs; con 50-100 usuarios a 15 s debería aguantar, pero no está medido.

## Decisiones abiertas

- Permisos por officer (solo el Rush chair ve el dashboard de Rush).
- Envío de SMS/WhatsApp además del email de bienvenida.
- Importar el PNM aceptado directamente como AM sin pasar por el formulario.
