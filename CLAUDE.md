# frat-chores — CLAUDE.md

## What this is

A Google Apps Script web app that chapters install on their own Google account.
One Sheet, one Script project, no cloud infra, no SaaS. The codebase is generic.

## Stack

- Google Apps Script (HTML Service + `.gs` files)
- Google Sheets as the database
- `clasp` for push/deploy; `git` for version control
- Local source: `/home/david/projects/frat-chores/` → GitHub `davidreinagarcia/fraternity-chore-manager`

## Dev workflow

GitHub is the source of truth. There is no permanent local checkout: each session works in a
throwaway shallow clone and deletes it at the end.

1. `gh repo clone davidreinagarcia/fraternity-chore-manager /tmp/frat-chores -- --depth 1`
2. Create `.clasp.json` (gitignored) for the target: `scriptId`, `parentId`, `rootDir: "apps-script"`
   (IDs below)
3. Edit files in `apps-script/`
4. `clasp push --force`, then `clasp deploy -i <deployment-id> -d "<description>"` for versioned deploys
5. `git commit` + `git push origin main`
6. `rm -rf /tmp/frat-chores`

The dev sheet is the only live target. **No staging step**: push straight through.

## Active sheets (as of 2026-09-30)

| Sheet | Purpose |
|---|---|
| "Fraternity Digitalization Project" `12WifDjeX-FntZOqQrIB2C-HplPKPwYUCoNSVL-7XImE`, scriptId `1AV-RMgKsr97YPk5qnRXL9O5PhkSplgb6cSvjLBex_kbEvaTS7lX_uO9a` | Only live sheet, all development here |

## Architecture

- `Code.gs` — core logic: chores, fines, member CRUD, config, semester tools
- `AMEvents.gs` — associate member events and attendance
- `Events.gs` — chapter-wide events (`events` tab) with auto-sync to Google Calendar (config key `events_calendar_id`; needs the `calendar` OAuth scope: fresh installs get it in the first-run consent prompt, older installs authorize via sheet menu "Setup: Authorize Google Calendar"). Also per-event attendance: audience (none/brothers/novatos/everyone), roll call stored in `event_attendance` tab, and a `counts_for_novatos` flag that feeds events into the AM Att.% (`_getNovatoCountedEvents` → `getAMPointsData.countedEvents`)
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

- No hardcoded chapter or school references in source code
- No secrets in any file that could be committed (tokens, API keys, officer PIN)
- Officer PIN lives only in the `config` Sheet tab, never in code
