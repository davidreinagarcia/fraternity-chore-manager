# frat-chores — CLAUDE.md

## Qué es este proyecto

Google Apps Script web app que chapters instalan en su propia cuenta de Google.
Una Sheet, un Script project, sin infra cloud ni SaaS. El código es genérico y configurable por chapter.

## Stack

- Google Apps Script (HTML Service + `.gs` files)
- Google Sheets como base de datos
- `clasp` para push/deploy; `git` para version control
- GitHub: `davidreinagarcia/fraternity-chore-manager`

## Cómo trabajar aquí

Lee en este orden antes de proponer o escribir nada:

1. `docs/systems/Index.md` — qué sistemas existen, en qué archivo vive cada uno y su estado actual. **Antes de tocar cualquier sistema, pasa por aquí.** Si el sistema ya tiene fichero en `docs/systems/`, entra directo en vez de reconstruir contexto.
2. El fichero del sistema concreto en `docs/systems/` — tiene el detalle vivo: lógica, datos, casos borde, decisiones abiertas.

**Al terminar de tocar un sistema: actualiza su fichero en el mismo commit. Si creaste un sistema nuevo: créale fichero (modelo: `docs/systems/events.md`; `_template.md` no existe) y añade su fila en el Index.**

Hay un pre-commit hook (`.claude/pre-commit`) que bloquea commits que toquen `apps-script/` sin actualizar `docs/systems/`. Si el checkout se recrea: `cp .claude/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`. Para saltar el check en un typo/whitespace: `git commit --no-verify`.

## Dev workflow

Checkout permanente en `/home/david/projects/fraternity-chore-manager/`.

Al inicio de sesión:
```
git pull
```

Para desplegar:
```
clasp push --force
clasp deploy -i <deployment-id> -d "<descripción>"   # versioned deploy
git commit -am "..." && git push origin main
```

`.clasp.json` es gitignored y vive permanentemente en el checkout local (no recrear cada sesión).
Dev sheet es el único target. No hay staging: push directo.

## Sheets activos

| Sheet | IDs |
|---|---|
| "Fraternity Digitalization Project" (dev + live) | Spreadsheet: `12WifDjeX-FntZOqQrIB2C-HplPKPwYUCoNSVL-7XImE` · scriptId: `1AV-RMgKsr97YPk5qnRXL9O5PhkSplgb6cSvjLBex_kbEvaTS7lX_uO9a` |

Deployment activo (redeploy aquí tras cada push): `AKfycbzdDhGPmAQi5NFvMBto-iI1C4-0Xfsp1wHaAqZtBTZTeqLX74rGWSL0VwrCj-y01prS`

Link de acceso: `?app=officer` (el dashboard que David usa).

`.clasp.json.prod` en el repo apunta a la old prod sheet — abandonada, no usar.

## Routing

`doGet()` en `Code.gs` enruta por `?app=`:

| param | app | notas |
|---|---|---|
| `officer` | OfficerDashboard | lo que David usa, PIN-gated |
| `home` | HomeApp | 4 links estáticos, stale |
| `member` | MemberView | vista individual |
| `submit` | SubmitApp | photo submission de chores |
| `signature` | SignatureApp | AM signature self-service |
| `form` | FormApp | respuesta pública a un form del form builder (`&f=<form_id>`) |
| `setup` | SetupApp | setup wizard nuevas instalaciones |
| `draft` | DraftApp | Draft Night board |

## Reglas de código

**Vocabulario**: nada de texto de chapter hardcodeado (new members, brothers, school, BK#...). Siempre desde `CHAPTER_CONFIG.labels` / `getChapterConfig()`, incluyendo confirms, toasts y estados vacíos. Claves internas y nombres de columna: libres.

**UI feedback**: `ButtonFeedback.html` se incluye en todo app interactivo via `<?!= include('ButtonFeedback') ?>`. Pressed state + spinner automático por botón. Todo nuevo HTML app debe incluirlo; si el server call arranca tras un dialog, wrappear con `window.bfBusy(btn, true/false)`.

**Estilo**: toda app HTML clara incluye `<?!= include('Theme') ?>` al final del `<head>` (look Google: plano, bordes 1px, radios 4/8px, Roboto). UI nueva usa sus tokens; detalle en `docs/systems/theme.md`.

**Fechas en Sheets**: siempre texto plano (formato `@`, `yyyy-MM-dd` / `HH:mm`), nunca objetos Date. Sheets desplaza fechas en round-trips entre timezones del script y de la spreadsheet.

**Secrets**: tokens y API keys nunca en código comprometido. Officer PIN solo en el tab `config` de la Sheet (clave `officer_pin`), nunca en código.
