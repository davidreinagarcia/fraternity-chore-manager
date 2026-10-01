# Members

Gestión del roster de miembros activos, alumni y CSV import/migration.

## Estado

Hecho.

## Cómo funciona

### Estructura de datos

Tab `members`: miembros activos e inactivos. Tab `alumni`: exmiembros con datos de contacto.
Member ID = BK# (dígitos de cualquier longitud).

Migración completada (config key `roster_migration_done = TRUE`): 98 activos + 33 alumni importados via `migrateFromRosterSheet`.

### CRUD

- `saveMember()` — crear/editar miembro.
- `updateMemberStatus()` — cambiar estado (active/alumni/suspended/etc.).
- `importMembersFromCSVText()` — import masivo desde CSV.

UI: OfficerDashboard → Members. Officer dashboard abre por defecto en Members.

### Alumni

Vista de contacto en OfficerDashboard → Members → Alumni. Solo lectura desde el dashboard.

### CSV export

Disponible desde OfficerDashboard → Admin. Exporta el roster activo.

## Decisiones abiertas

- **Verificación de migración**: David sospecha que la migración `migrateFromRosterSheet` pudo perder datos. Hay que comparar contra fuente original cuando se retome.
- **Semester rollover**: sistema para actualizar el roster a inicio de semestre (más allá del botón ad hoc en Officer Handoff → Semester Sync, que dejó un `#ERROR!` en `config` el 2026-08-17T10:18:54Z — investigar primero si se retoma este trabajo).
- **Nuevo flujo de onboarding AM**: mejor sistema para dar de alta AMs nuevos y cambiar estado de miembros.

## Relacionado con

- [am-system.md](./am-system.md) — el AM Manager vive dentro del tab Members del dashboard.
- [chores-fines.md](./chores-fines.md) — multas vinculadas a IDs de miembros.
