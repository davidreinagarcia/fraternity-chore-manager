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

### Fine enforcement

`issueFines()` en `Code.gs` aplica multas a miembros que no completaron su chore. Config keys relevantes: `fine_amount`.
El officer puede overridear una multa desde OfficerDashboard → Admin (fine override accordion).

## Relacionado con

- [config.md](./config.md) — `fine_amount`, `label_chore`, `label_fine`.
- [members.md](./members.md) — las multas se asocian a IDs de miembros.
