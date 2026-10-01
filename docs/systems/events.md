# Events & Google Calendar

Chapter-wide events con attendance, recurrencia y sync bidireccional con Google Calendar.
Independiente del sistema legacy `AMEvents.gs` (AM-only events), que se dejó sin tocar.

## Estado

Hecho — `Events.gs` + `EventsTwoWay.gs` + sección `sec-events` en `OfficerDashboard.html`.

## Cómo funciona

### Almacenamiento

- Tab `events`: una fila por ocurrencia. Columnas clave: `event_id`, `series_id`, `type`, `audience`, `date` (texto `yyyy-MM-dd`), `time` (texto `HH:mm`), `gcal_event_id`, `gcal_dirty`, `updated_at`.
- Tab `event_series`: una fila por serie recurrente. Columna `rule` (JSON con `freq`, `interval`, `until`, `count`, etc.).
- Tab `event_attendance`: `event_id`, `type` (`brothers`|`novatos`), `member_id` (compuesto `type:id`), `name` (snapshot en el momento del roll call), `attended` (bool), `timestamp`.
- Tab `event_gcal_deletes`: cola de IDs de Google Calendar a borrar.

### Fechas — regla crítica

Todas las fechas y horas se guardan como **texto plano** (formato `@` en Sheets: `yyyy-MM-dd` / `HH:mm`). Nunca escribir objetos Date; Sheets los desplaza un día al hacer round-trips entre el timezone del script y el de la spreadsheet. `saveEvent` verifica la fecha guardada leyéndola de vuelta y lanza error si no coincide.

### Recurrencia

Un solo evento recurrente = una fila en `event_series` (la regla) + N filas en `events` (una por ocurrencia), ligadas por `series_id`. Las ocurrencias se materializan a un horizonte rodante: `_extendSeries` en cada `getEventsData` añade las que falten. Al editar un recurrente, el scope puede ser `this` / `following` / `all`. Los shifts de fecha/hora se aplican a las ocurrencias afectadas sin cambiar sus `event_id` ni `gcal_event_id`.

### Attendance

Cada evento tiene un `audience`: `none`, `brothers`, `novatos`, `everyone`. El roll-call modal en el dashboard carga los nombres del roster según el audience. La lista se guarda en `event_attendance` con snapshot de nombres (no IDs puros) y claves compuestas `type:id`. Los eventos con `counts_for_novatos = true` y audience `novatos`/`everyone` alimentan el AM Att.% via `_getNovatoCountedEvents` → `getAMPointsData.countedEvents`. Reducir el audience de un evento borra la attendance del grupo excluido (con confirmación).

### Google Calendar sync (push, one-way → Google)

Cola basada en flags: filas con `gcal_event_id` en blanco o `gcal_dirty = 'Y'` están pendientes; borrados van al tab `event_gcal_deletes`. `syncPendingEvents` es time-budgeted y se llama en loop desde el cliente (`runEvSync`). El calendario lo elige el usuario en la UI (config key `events_calendar_id`). Scope de autorización `calendar` en `appsscript.json`: instalaciones nuevas lo consiguen en el primer consent; instalaciones antiguas autorizan via menú de la Sheet "Setup: Authorize Google Calendar" (hay que marcar TODOS los boxes). Sin autorización, las filas se quedan en `gcal_dirty = 'Y'` y el botón Sync muestra "Retry".

### Google Calendar sync (pull, two-way ← Google)

`EventsTwoWay.gs` → `pullCalendarChanges`. Reconciliación stateless usando Calendar advanced service v3 (habilitado en `appsscript.json`). Lista eventos de Google con `singleEvents` en ventana today-90d..+1100d. Match por `gcal_event_id` almacenado (== iCalUID sin `@google.com`) o por extended property `frat_event_id` (set por `_syncEventToCalendar` al crear). Conflictos: gana el más reciente (`item.updated` vs `updated_at` de la fila, solo si `gcal_dirty = 'Y'`). Si Google borra un evento con attendance, se restaura en Google (no se borra la fila). Guard anti borrado masivo. Eventos creados en Google: se importan como tipo Other, sin attendance. Eventos recurrentes-en-Google y multi-día: ignorados con nota. Triggers: time trigger 5 min + `forUserCalendar(id).onEventUpdated()`, ambos llaman `calendarTwoWayTick` (debounced 20 s). Config keys: `events_twoway` (`'off'` = usuario lo desactivó), `events_calendar_last`. El dashboard lo activa automáticamente para calendarios enlazados y sondea cada 60 s mientras el tab Events está abierto.

## Casos borde conocidos

- **Two-way sync**: solo testado contra mocks y harness local (node server + google.script.run shim). Si falla en producción, los primeros sospechosos son la autorización del advanced service Calendar y el calendar trigger (el time trigger es el fallback).
- **Cambio de calendario**: al cambiar `events_calendar_id` en Config Editor, los gcal IDs almacenados dejan de ser válidos en el nuevo calendario. Comportamiento en ese caso: no documentado, pendiente.
- **Eventos recurrentes de Google importados**: se ignoran. Si un usuario crea una serie en Google y espera verla en el dashboard, no aparecerá.

## Decisiones abiertas

- Reemplazar `AMEvents.gs` (AM-only legacy) con el sistema unificado.
- Auto-fines para hermanos que salten eventos mandatory de brothers (la base `event_attendance` + audience ya existe).
- Absence form: brothers rellenan un formulario para no ser multados.
- Eventos multi-día.
