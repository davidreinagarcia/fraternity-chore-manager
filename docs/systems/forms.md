# Forms (form builder nativo)

Motor genérico de formularios: los officers definen un form en el dashboard y los miembros lo rellenan en una página pública, sin cuenta de Google. Sustituye a Google Forms para los procesos nuevos (absence request primero). Independiente de `CustomForms.gs` (los forms semestrales NM/RM siguen siendo Google Forms y no se tocaron).

## Estado

Hecho — `Forms.gs` + `FormApp.html` + sección `sec-forms` en `OfficerDashboard.html`. Forms encima: Absence request, Philanthropy hours (con su página `sec-philanthropy`) y Party guest list (solo el form).

## Cómo funciona

### Almacenamiento

- Tab `forms`: una fila por form. Columnas: `form_id`, `title`, `description`, `status` (`open`|`closed`), `audience` (`brothers`|`novatos`|`everyone`), `fields` (JSON), `due_date` (texto `yyyy-MM-dd`, inclusivo), `requires_review` (`Y`/`N`), `allow_multiple` (`Y`/`N`), `action` (JSON, p. ej. `{type:'absence',eventField,reasonField}`), `created_by`, `created_at`, `updated_at`, `category` (`general`|`finance`|`philanthropy`|`rush`|`events`; agrupa el form en la Home). Los sheets antiguos reciben la columna automáticamente (`_fmEnsureColumns`); si falta o es `general`, los forms con acción `philanthropy`/`service_event` se tratan como `philanthropy`. El form builder la elige en "Home page group".
- Tab `form_responses`: `response_id`, `form_id`, `member_id`, `member_type`, `member_name` (snapshot), `answers` (JSON por id de campo), `submitted_at`, `review_status` (`pending`|`approved`|`denied`), `reviewed_by`, `reviewed_at`, `review_note`.
- Todas las columnas son texto (`@`) por la regla de fechas del proyecto. Los booleanos son `Y`/`N`.

### Campos

Tipos: `text`, `textarea`, `choice`, `multi`, `number`, `date`, `yesno`, `event`, `photo`, `list`, `info` (solo texto). Máximo 40 campos. Los ids son `fN` y se conservan al editar, así que editar un form no rompe las respuestas existentes. `choice`/`multi` requieren 2 o más opciones (se deduplican). El campo `event` lista los próximos eventos con attendance distinta de `none` que encajen con el audience del form; se guarda como `{eventId,label}`. Con `allEvents: true` (checkbox del builder) el picker lista todos los próximos eventos, también los sin attendance (fiestas); `fmGetPublicForm` devuelve `events` (estándar) y `eventsAll`.

**`list`**: lista de nombres de texto libre (máx. 30 filas, 100 caracteres cada una, se descartan las vacías). Se guarda como array y se muestra unido con `; `.

**`photo`**: fotos de la galería del móvil (máx. 6). El cliente las comprime a JPEG (lado máx. 1600 px, calidad 0.82) con canvas y las manda en un argumento aparte `photosJson` (`{fieldId:[{data}]}`) de `fmSubmitResponse`. El servidor valida (≥5 KB, ≤8 MB, magic bytes JPEG), las sube a Drive en `Forms/<semestre>/<título del form>/` (dentro de la carpeta raíz, ver [drive-storage.md](./drive-storage.md), con permiso de lectura por link) **antes** de coger el lock, y guarda `[{id,url}]` en la respuesta. Si algo falla después de subir, las fotos se mandan a la papelera. También se trashean al borrar la respuesta, al borrar el form o al reemplazar en el sitio (`allow_multiple = N`).

### Página pública `?app=form&f=<form_id>`

Sin login de Google (mismo patrón que `?app=signature`). El miembro busca su nombre en el roster del audience (`_eventRoster`, clave `type:memberId`). `fmGetPublicForm` no expone `action`. Antes de aceptar una respuesta, `fmSubmitResponse` comprueba: form abierto, deadline (`_todayStr()`, inclusivo), miembro dentro del audience y validación de campos. Usa `LockService`. Si `allow_multiple = N`, un nuevo envío reemplaza al anterior en el sitio.

### API de officers

Todas las funciones reciben el PIN como primer argumento y lo validan en servidor con `_checkOfficerPin`, porque las respuestas contienen datos personales. El dashboard pasa su `correctPin`.

`fmListForms`, `fmGetForm`, `fmSaveForm`, `fmSetStatus`, `fmDeleteForm` (borra en cascada sus respuestas), `fmGetResponses`, `fmReviewResponse` (approve/deny/undo + nota), `fmDeleteResponse`, `fmSendReminders` (email por GmailApp a quien no ha respondido; se omiten miembros sin email).

### Listado público para la Home

`fmListOpenForms()` (sin PIN): forms que aceptan respuestas ahora (`_fmIsAccepting`) con `formId, title, description (160), audience, dueDate, category`. `HomeApp` los agrupa por categoría; un form nuevo aparece solo.

### Review

Con `requires_review`, cada respuesta nace `pending` y un officer la aprueba o deniega desde la tabla de respuestas. Una respuesta denegada libera el evento para reenviar.

### Acción `absence`

`fmSaveForm` busca el primer campo `event` (lo fuerza a `required`) y el primer campo `choice` (motivo) y guarda `{type:'absence',eventField,reasonField}`. Rechaza duplicados para el mismo evento salvo que el anterior esté denegado.

Las excusas se **derivan** de las respuestas en `_fmExcusesForEvent(ss, eventId)`: aprobadas, o cualquier no denegada si el form no pide review. No hay un segundo estado que sincronizar. `getEventAttendanceData` (Events.gs) las devuelve y el roll call muestra "Excused: <motivo>" o "Absence request pending" junto al nombre.

### Acción `philanthropy`

`fmSaveForm` exige un campo `number` (horas, se fuerza `required`) y un campo `photo` (prueba, `required`) y guarda `{type:'philanthropy',hoursField,photoField,titleField,dateField}` (título y fecha = primer `text` y primer `date`). `fmSubmitResponse` exige horas > 0 y ≤ 100.

`fmPhilanthropySummary(pin)` **deriva** todo de las respuestas (sin estado extra): horas aprobadas (o cualquiera no denegada si el form no pide review), pendientes, contribuyentes y entradas por miembro (con fotos), incluyendo miembros del roster con 0 horas. La sección Philanthropy del dashboard (`loadPhilanthropy()`) muestra totales, tabla por miembro con entradas desplegables, miniaturas (`drive.google.com/thumbnail`, con fallback a enlace "Open photo") y botones Approve/Deny/Undo. Si no existe ningún form con esta acción, la página lo **crea sola** desde la plantilla del cliente; borrarlo lo recrea al abrir la página (para retirarlo, ciérralo).

### Acción `service_event`

La crea `phCreateEvent` (Philanthropy.gs), no la plantilla del builder. Ver [philanthropy.md](./philanthropy.md). `_fmCleanFields` conserva `field.role` (`going` / `slots`) y `fmSaveForm` exige un campo `yesno` con role `going` y valida `eventDate` y `defaultHours`.

### Selector de nombre (`NamePicker.html`)

Componente compartido (CSS + JS, `NamePicker.create(host, {placeholder, onChange})`) que sustituye al `<select>` y al buscador limitado de 8 resultados. Se abre al enfocar con la lista completa, filtra mientras escribes (sin acentos, por prefijo de cualquier palabra, luego por subcadena), navega con flechas, Enter y Escape, y al salir autoselecciona si el texto coincide exacto con un único nombre. API: `setItems`, `getValue`, `getName`, `clear`, `setDisabled`. Editar el texto tras elegir borra la selección. En `FormApp` rellena `whoKey`; en `SubmitApp` y `SignatureApp` sustituye a `member-select` / `am-select`. Para otra página: `<?!= include('NamePicker') ?>`.

### Party guest list

Plantilla "Party guest list" del builder: picker de evento con `allEvents` + campo `list`. El anfitrión es el nombre elegido arriba en la página pública. Sin acción: de momento solo se recogen respuestas; la consolidación de la lista de invitados por evento queda para más adelante.

### Dashboard

Sección Forms: lista (con contadores respondidos/audience y pendientes), detalle con tabla de respuestas, lista de no respondidos con botón de recordatorio, copiar link, cerrar/reabrir, exportar CSV (con guarda contra formula injection) y borrar. El builder es un modal con plantillas (Blank, Absence request, Philanthropy hours, Party guest list), editor de preguntas con reordenar y opciones de audience, deadline, review y multiples envíos. El vocabulario de audience sale de `evAudienceLabels()` / `CHAPTER_CONFIG.labels`.

## Casos borde conocidos

- **Identidad por nombre**: el miembro elige su nombre de una lista, sin autenticación. Alguien con el link puede enviar como otro miembro. Aceptado para una fraternidad (igual que las firmas AM); el officer ve quién envió y puede denegar.
- **Roster visible**: cualquiera con el link ve los nombres del audience (igual que `SignatureApp`).
- **Fotos**: solo JPEG (el cliente re-codifica todo), máx. 6 por campo. Los archivos son visibles para cualquiera con el link de Drive. Si falla una subida, nada se guarda.
- **Philanthropy**: objetivo de horas, consecuencias de fin de semestre y eventos de servicio viven en [philanthropy.md](./philanthropy.md).
- **Selector de nombre**: todas las páginas públicas (`FormApp`, `SubmitApp`, `SignatureApp`) usan `NamePicker.html` (ver abajo).
- **Testado solo contra mocks y harness local** (node + shim de `google.script.run`): lógica de servidor con tests vm, UI con navegador. Nunca contra la Sheet real, GmailApp ni el deploy. Si algo falla en producción, sospechar primero de la creación de los tabs (`_fmSheet`) y de los permisos de GmailApp.
- Los forms semestrales NM/RM (`CustomForms.gs`) no usan este motor todavía.

## Decisiones abiertas

- Auto-fines para hermanos que falten a eventos mandatory: debe leer `_fmExcusesForEvent` para no multar a los excusados.
- Migrar NM/RM al motor.
- Gestión de la guest list (consolidar invitados por evento, check-in en la puerta).
- Más acciones por form (swap de chores).
- Votaciones anónimas necesitan otro diseño (este motor guarda la identidad).
