# Philanthropy

Objetivo de horas de servicio por semestre, consecuencias al cerrar el semestre, eventos de servicio con form de interés y asignación de horas. Código en `Philanthropy.gs`; UI en `OfficerDashboard.html` (sección Philanthropy y Admin → Philanthropy).

## Estado

Hecho (2026-10-02). Probado con harness local y `node --check`; la parte de servidor nunca se ha ejecutado contra la Sheet real.

## Datos

- Tab `service_hours` (libro de horas): `entry_id, member_key, member_name, hours, source_form_id, source_title, note, awarded_by, awarded_at`. Horas concedidas a mano desde un evento. Las horas del form de horas siguen derivándose de las respuestas (ver [forms.md](./forms.md)).
- Claves de miembro: `type:memberId` (por ejemplo `brother:BK12`).
- Config: `philanthropy_min_hours`, `philanthropy_shortfall_action`, `philanthropy_carry_over`, `philanthropy_semester_start`, `philanthropy_carry` (ver [config.md](./config.md)).

## Objetivo y semestre

- `_phSummaryBuild(ss)` junta horas aprobadas (form + libro), pendientes, carry y requeridas por miembro. `required = min + carry`, `remaining = max(0, required - approved)`, `meets = approved >= required`.
- Solo cuentan las horas posteriores a `philanthropy_semester_start` (0 si nunca se ha cerrado un semestre).
- La sección Philanthropy muestra la tabla con filtro all / meets / doesn't meet, búsqueda y ordenación.

## Cierre de semestre

Botón explícito en Admin → Philanthropy (no va atado al archivo de Semester Tools). `phPreviewClose` lista quién no llega. `phCloseSemester`:

- Exige `min_hours > 0`.
- Acción `probation` (`placeProbation` tipo `chapter`) o `suspension` (`placeSuspension`) solo para hermanos actuales que no llegan y no están ya marcados. `none` no hace nada. Los nombres de probation/suspension salen de `CHAPTER_CONFIG.labels`.
- Con carry-over activo guarda en `philanthropy_carry` lo que cada uno debía de más (si debía 8 y hizo 4, el semestre siguiente debe 12). Sin carry-over lo borra.
- Fija `philanthropy_semester_start = Date.now()`.

## Eventos de servicio

Botón "Create new event" en la sección Philanthropy. `phCreateEvent` crea un form (`fmSaveForm`) con acción `service_event`:

- Campo `yesno` con role `going` (siempre) y, opcional, un `multi` con role `slots` (franjas horarias, mínimo 2, como lista de casillas), preguntas extra y un campo `photo` (solo JPEG).
- Metadatos: fecha del evento, fecha límite, audiencia y horas sugeridas.
- Módulo de eventos arriba de la página; el detalle (`phGetEvent`) lista quién respondió, las respuestas, y quién no ha respondido.
- `phAwardHours`: asigna horas a una persona, a las seleccionadas o a todos los que van. Hace upsert por miembro y evento, 0 quita la entrada, valida 0 a 100 y que la persona haya respondido. `phRemoveAward` borra una entrada.
- `phDeleteEvent` manda el form a la papelera. Las horas ya concedidas se conservan en el libro.

## Selector y tablas

- `NamePicker.html` da búsqueda al escribir en todas las páginas públicas (ver [forms.md](./forms.md)).
- Las tablas del dashboard se enriquecen con búsqueda y orden por columna con `_tblEnhance()` (un MutationObserver las detecta). `data-search="own"` indica que la tabla tiene su propio buscador; `data-plain` la excluye (`chores-table`).

## Casos borde

- No hay documentos ni PDFs en el campo de subida, solo fotos JPEG.
- Borrar un evento no resta horas.
- Cerrar dos veces seguidas mueve el inicio de semestre otra vez; no es reversible desde la UI.
