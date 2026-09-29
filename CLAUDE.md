# frat-chores — CLAUDE.md

## What this is

A Google Apps Script web app that chapters install on their own Google account.
One Sheet, one Script project, no cloud infra, no SaaS. Lambda Chi Alpha at Georgia Tech
is the live beta; the codebase is generic.

## Stack

- Google Apps Script (HTML Service + `.gs` files)
- Google Sheets as the database
- `clasp` for push/deploy; `git` for version control
- Local source: `/home/david/projects/frat-chores/` → GitHub `davidreinagarcia/fraternity-chore-manager`

## Dev workflow

1. Edit files locally in `apps-script/`
2. `clasp push --force` (pushes to the sheet in `.clasp.json`)
3. `clasp deploy -i <deployment-id> -d "<description>"` for versioned deploys
4. `git commit` + `git push origin main`

**No staging step** — push straight to prod for beta.

`.clasp.json` is gitignored. Its `scriptId` and `parentId` change per deployment target
(Dev sheet vs Lambda Chi prod sheet). Verify before pushing.

## Active sheets (as of 2026-09-28)

| Sheet | Purpose |
|---|---|
| "Fraternity Digitalization Project" `12WifDjeX-FntZOqQrIB2C-HplPKPwYUCoNSVL-7XImE` | **Dev / unified source sheet** — all future development here |
| "Chore System Test" `1__vs3wLiVF4FNW2BvuEgyySapb73qCPeaQVn49b5_38` | Lambda Chi production (real data, 98 active + 33 alumni) |

## Architecture

- `Code.gs` — core logic: chores, fines, member CRUD, config, semester tools
- `AMEvents.gs` — associate member events and attendance
- `Signatures.gs` — AM signature submissions and dashboard
- `CustomForms.gs` — custom NM/RM forms, reminders, response tracking
- `BigQuerySync.gs` — BigQuery archival (inactive, hidden in Config Editor)
- `PhotoCheck.gs` — Google Vision photo validation for chore submissions

HTML apps (routed via `?app=` query param):
- `OfficerDashboard.html` — main officer UI, PIN-gated (`?app=officer`)
- `HomeApp.html` — 4-link nav hub (`?app=home`)
- `MemberView.html` — individual member view (`?app=member`)
- `SubmitApp.html` — chore photo submission (`?app=submit`)
- `SignatureApp.html` — AM signature self-service (`?app=signature`)
- `SetupApp.html` — setup wizard for new installs (`?app=setup`)
- `DraftApp.html` — draft night board (`?app=draft`)
- `MemberDirectory.html` — redirects to officer dashboard

## Config system

Everything customizable lives in the `config` Sheet tab via `getChapterConfig()`:
- **Vocabulary**: `label_chore`, `label_fine`, `label_am_group`, etc.
- **Module flags**: `module_housing`, `module_associates`, `module_signatures`, etc.
- **Free-text options**: `meal_plan_options`, `officer_role_options`, etc.

Template vars injected at render time by `doGet`:
- `<?= cfg.chapter.primary_color ?>` — CSS brand color
- `<?!= cfgJson ?>` → `var CHAPTER_CONFIG = ...;` — full config for client JS
- `<?= baseUrl ?>`, `<?= todayDate ?>`

## Security rules (from global CLAUDE.md — repeated here for context)

- No hardcoded Lambda Chi / Georgia Tech references in source code
- No secrets in any file that could be committed (tokens, API keys, officer PIN)
- Officer PIN lives only in the `config` Sheet tab, never in code
- `clasp push` to Lambda Chi prod sheet requires explicit confirmation from David
