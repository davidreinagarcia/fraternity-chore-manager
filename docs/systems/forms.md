# Forms (form builder nativo)

Motor genérico de formularios: los officers definen un form en el dashboard y los miembros lo rellenan en una página pública, sin cuenta de Google. Sustituye a Google Forms para los procesos nuevos (absence request primero). Independiente de `CustomForms.gs` (los forms semestrales NM/RM siguen siendo Google Forms y no se tocaron).

## Estado

Hecho — `Forms.gs` + `FormApp.html` + sección `sec-forms` en `OfficerDashboard.html`. Primer form encima: Absence request.

## Cómo funciona

### Almacenamiento

- Tab `forms`: una fila por form. Columnas: `form_id`, `title`, `description`, `status` (`open`|`closed`), `audience` (`brothers`|`novatos`|`everyone`), `fields` (JSON), `due_date` (texto `yyyy-MM-dd`, inclusivo), `requires_review` (`Y`/`N`), `allow_multiple` (`Y`/`N`), `action` (JSON, p. ej. `{type:'absence',eventField,reasonField}`), `created_by`, `created_at`, `updated_at`.
- Tab `form_responses`: `response_id`, `form_id`, `member_id`, `member_type`, `member_name` (snapshot), `answers` (JSON por id de campo), `submitted_at`, `review_status` (`pending`|`approved`|`denied`), `reviewed_by`, `reviewed_at`, `review_note`.
- Todas las columnas son texto (`@`) por la regla de fechas del proyecto. Los booleanos son `Y`/`N`.

### Campos

Tipos: `text`, `textarea`, `choice`, `multi`, `number`, `date`, `yesno`, `event`, `info` (solo texto). Máximo 40 campos. Los ids son `fN` y se conservan al editar, así que editar un form no rompe las respuestas existentes. `choice`/`multi` requieren 2 o más opciones (se deduplican). El campo `event` lista los próximos eventos con attendance distinta de `none` que encajen con el audience del form; se guarda como `{eventId,label}`.

### Página pública `?app=form&f=<form_id>`

Sin login de Google (mismo patrón que `?app=signature`). El miembro busca su nombre en el roster del audience (`_eventRoster`, clave `type:memberId`). `fmGetPublicForm` no expone `action`. Antes de aceptar una respuesta, `fmSubmitResponse` comprueba: form abierto, deadline (`_todayStr()`, inclusivo), miembro dentro del audience y validación de campos. Usa `LockService`. Si `allow_multiple = N`, un nuevo envío reemplaza al anterior en el sitio.

### API de officers

Todas las funciones reciben el PIN como primer argumento y lo validan en servidor con `_checkOfficerPin`, porque las respuestas contienen datos personales. El dashboard pasa su `correctPin`.

`fmListForms`, `fmGetForm`, `fmSaveForm`, `fmSetStatus`, `fmDeleteForm` (borra en cascada sus respuestas), `fmGetResponses`, `fmReviewResponse` (approve/deny/undo + nota), `fmDeleteResponse`, `fmSendReminders` (email por GmailApp a quien no ha respondido; se omiten miembros sin email).

### Review

Con `requires_review`, cada respuesta nace `pending` y un officer la aprueba o deniega desde la tabla de respuestas. Una respuesta denegada libera el evento para reenviar.

### Acción `absence`

`fmSaveForm` busca el primer campo `event` (lo fuerza a `required`) y el primer campo `choice` (motivo) y guarda `{type:'absence',eventField,reasonField}`. Rechaza duplicados para el mismo evento salvo que el anterior esté denegado.

Las excusas se **derivan** de las respuestas en `_fmExcusesForEvent(ss, eventId)`: aprobadas, o cualquier no denegada si el form no pide review. No hay un segundo estado que sincronizar. `getEventAttendanceData` (Events.gs) las devuelve y el roll call muestra "Excused: <motivo>" o "Absence request pending" junto al nombre.

### Dashboard

Sección Forms: lista (con contadores respondidos/audience y pendientes), detalle con tabla de respuestas, lista de no respondidos con botón de recordatorio, copiar link, cerrar/reabrir, exportar CSV (con guarda contra formula injection) y borrar. El builder es un modal con plantillas (Blank, Absence request), editor de preguntas con reordenar y opciones de audience, deadline, review y multiples envíos. El vocabulario de audience sale de `evAudienceLabels()` / `CHAPTER_CONFIG.labels`.

## Casos borde conocidos

- **Identidad por nombre**: el miembro elige su nombre de una lista, sin autenticación. Alguien con el link puede enviar como otro miembro. Aceptado para una fraternidad (igual que las firmas AM); el officer ve quién envió y puede denegar.
- **Roster visible**: cualquiera con el link ve los nombres del audience (igual que `SignatureApp`).
- **Sin subida de fotos**: no hay campo de archivo todavía.
- **Testado solo contra mocks y harness local** (node + shim de `google.script.run`): lógica de servidor con tests vm, UI con navegador. Nunca contra la Sheet real, GmailApp ni el deploy. Si algo falla en producción, sospechar primero de la creación de los tabs (`_fmSheet`) y de los permisos de GmailApp.
- Los forms semestrales NM/RM (`CustomForms.gs`) no usan este motor todavía.

## Decisiones abiertas

- Auto-fines para hermanos que falten a eventos mandatory: debe leer `_fmExcusesForEvent` para no multar a los excusados.
- Migrar NM/RM al motor.
- Más acciones por form (philanthropy hours, guest list, swap de chores) y campo de foto.
- Votaciones anónimas necesitan otro diseño (este motor guarda la identidad).
