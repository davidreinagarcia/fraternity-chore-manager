# AM System (Associate Members / Pledge system)

Gestión de puntos, eventos y firmas para los Associate Members.
Convive con el sistema unificado de Events (`Events.gs`) sin reemplazarlo todavía.

## Estado

Hecho.

## Cómo funciona

### AM Points

Los AMs ganan puntos de dos formas:
1. **Ajuste manual** por el High Kappa: `adjustAMPoints()` desde el AM Manager (botón ⭐ en el dashboard). La columna `points` se auto-migra al tab `AMs` si no existe.
2. **Signatures**: cada firma aprobada suma `signature_points` (config key, default 1, en Config Editor > Key Settings > "Points per Signature"). Sin revisión officer: los puntos se otorgan al instante.

AM Attendance%: calculado por `_getNovatoCountedEvents` (en `Events.gs`) → `getAMPointsData.countedEvents`. Solo cuentan eventos con `counts_for_novatos = true` y audience `novatos` o `everyone`.

### AM Events (legacy)

`AMEvents.gs` gestiona eventos específicos de AMs (anterior al sistema unificado de `Events.gs`). Se dejó sin tocar al construir el nuevo sistema. Tab `am_events` en la Sheet. Pendiente: unificación con `Events.gs`.

### Signature self-service

AMs completan una actividad con un brother y la registran con foto via `?app=signature` (`SignatureApp.html`). Sin Google login; mismo patrón no-auth que la photo submission de chores.

Flujo: AM selecciona su nombre del dropdown (desde `getActiveAMsForSignature`) → escribe el nombre del brother (campo libre, sin dropdown ni datalist — ~80 brothers es demasiado, y el roster "aún no está en sync") → adjunta foto (máx 10MB, solo imagen) → `processSignatureSubmission`.

Fotos: Drive en `Signatures Pics/<semester>/<AM name>/`, auto-created. Para un álbum manual de fin de semestre.

Tab `signatures`: `sig_id`, `am_member_id`, `am_name`, `brother_name`, `activity`, `photo_url`, `semester`, `timestamp`.

### Signatures Dashboard (officer)

En OfficerDashboard → Members → AM Manager. Botón "📸 Signatures Dashboard" → acordeón por AM (nombre + conteo de firmas, ordenado desc) → al expandir: brother name, activity, link a foto en Drive. Data via `getSignaturesDashboardData`.

## Casos borde conocidos

- El path de upload de foto real (`processSignatureSubmission` + `_saveSignaturePhotoToDrive`) no fue testado end-to-end contra la Sheet real (el input file en el iframe cross-origin no es accesible desde herramientas de automatización). Si surge un bug en el Drive write, ése es el primer lugar a mirar.

## Relacionado con

- [events.md](./events.md) — los eventos con `counts_for_novatos = true` alimentan el AM Att.% directamente.
- [config.md](./config.md) — `signature_points`, `label_am_short`, `label_active_member`, `label_brotherhood`, `label_new_member` son config keys relevantes para este sistema.
