# Config System

Capa de configuración que hace el código genérico y reutilizable por cualquier chapter.
Todo lo personalizable vive en el tab `config` de la Sheet, accesible via `getChapterConfig()`.

## Estado

Hecho.

## Cómo funciona

### getChapterConfig()

Devuelve un objeto con tres secciones:
- `chapter` — ajustes generales: `semester`, `week_start`, `officer_emails`, `fine_amount`, colores, etc.
- `labels` — vocabulario del chapter: `label_chore`, `label_fine`, `label_am_group`, `label_am_short`, `label_active_member`, `label_brotherhood`, `label_new_member`, etc.
- `modules` — flags booleanos de activación: `module_housing`, `module_associates`, `module_signatures`, etc.

### Config Editor (officer UI)

`OfficerDashboard.html` → Admin → Config Editor. Muestra:
- **Key Settings** (4 claves con label amigable): `semester`, `week_start`, `officer_emails`, `fine_amount`.
- `chore_completion_mode` NO se edita aquí: vive en Admin → Chore Manager (ver [chores-fines.md](./chores-fines.md)).
- **Advanced settings** (colapsado): resto de claves, incluidas las de BigQuery (inactivas).

`officer_pin` está excluido del Config Editor (`getConfig()` no lo devuelve, `saveConfig()` lo rechaza). Solo se cambia via Officer Handoff → Change PIN (exige PIN actual).

### Template vars en HTML

`doGet()` inyecta vars en tiempo de render:
- `<?= cfg.chapter.primary_color ?>` — CSS brand color
- `<?!= cfgJson ?>` → `var CHAPTER_CONFIG = ...;` — config completa para JS del cliente
- `<?= baseUrl ?>`, `<?= todayDate ?>`

### Módulos / feature flags

Activar/desactivar features grandes via `module_*` keys. El dashboard oculta secciones si el módulo está desactivado.

### Regla de vocabulario

**Ningún texto de chapter puede estar hardcodeado en el código fuente.** Cualquier término que un chapter pueda nombrar diferente (new members, active members, AM group, school, BK#, chapter name...) debe venir de `CHAPTER_CONFIG.labels`. Esto incluye confirms, toasts, empty states y cualquier texto visible al usuario.

## Relacionado con

- [am-system.md](./am-system.md) — `signature_points`, vocab labels de AMs.
- [events.md](./events.md) — `events_calendar_id`, `events_twoway`, `events_calendar_last`.
