# Chores & Fines

Asignación semanal de tareas, submission por foto con validación y enforcement de multas.

## Estado

Hecho.

## Cómo funciona

### Asignación semanal

`assignChores()` en `Code.gs` distribuye tareas de la semana entre los miembros activos.
Ratios de distribución en `config/chore_ratios.json` (fuera del Apps Script, solo para referencia local).

### Photo submission (miembro)

`?app=submit` (`SubmitApp.html`) → `processSubmission()`. Sin Google login; mismo patrón no-auth que signatures. Foto máx 10MB. La foto se sube a Drive (`<label_chore>s/<semestre>/Week_<fecha>/` dentro de la carpeta raíz, ver [drive-storage.md](./drive-storage.md)) y se registra en el tab `submissions`.

### Validación por Vision API

`PhotoCheck.gs` — llama a Google Cloud Vision para validar que la foto muestra la tarea completada. Si falla la validación, la submission queda en estado pendiente para revisión manual.

### Modo de completado (`chore_completion_mode`)

Config key con dos valores, editable en Admin → Chore Manager (selector encima de la tabla de chores, `renderChoreMode()`/`saveChoreMode()`):
- `all` (default): todos los asignados al grupo (la chore) tienen que hacerla. Falta uno → la chore sale roja "Not done".
- `one`: basta con que una persona del grupo la haga. Quien la hace sale en verde, la chore pasa a "Done" y el resto queda como "Not needed". Si nadie la hace, se multa a todo el grupo.

"Cuenta como hecha" = `(auto_status==='passed' && human_status!=='failed') || human_status==='verified'` (`_isCountedSubmission`). `_getChoreMode()` lee la key.

`getWeeklyStatus()` devuelve `mode` y, por chore, `state` (`done`/`review`/`missing`), `doneCount`, `total`; por miembro, `counted` y `state` (`done`/`review`/`failed`/`missing`).

### Pestaña Chores del dashboard

"This Week" muestra una fila por chore (tipo "chore: lista de gente"): nombre y estado a la izquierda, miembros a la derecha con su estado y acciones (Photo/Verify/Fail/Fraud/Mark Complete). Borde y fondo rojo/amarillo/verde según `state` de la chore. Botón "Manage chores" abre Admin → Chore Manager (`openAdminPage('admin-chores')`). Fine Preview y los stats usan la misma regla que `runMondayReset`. My Compliance (`MemberView.html`) usa `state` de la chore para tarjetas, ribbon, filtros y resumen.

### Fine enforcement

`issueFines()` en `Code.gs` aplica multas a miembros que no completaron su chore. Config keys relevantes: `fine_amount`.
`runMondayReset()` respeta el modo: en `one`, una chore con alguna submission contada no genera multas; si no, se multa a todos los activos del grupo.
El officer puede overridear una multa desde OfficerDashboard → Admin (fine override accordion).

## Relacionado con

- [config.md](./config.md) — `fine_amount`, `label_chore`, `label_fine`.
- [members.md](./members.md) — las multas se asocian a IDs de miembros.
