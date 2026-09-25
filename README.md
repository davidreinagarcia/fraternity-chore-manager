# Fraternity Chore Manager

A production-grade chore management platform for fraternity chapters built entirely on **Google Workspace** — no servers, no monthly fees, no new accounts. Members scan a QR code, upload a photo proof, and the system handles the rest.

---

## What it does

| Feature | Details |
|---|---|
| Photo-verified submissions | Members scan a QR code in the chore area and upload a photo. No logins, no app to install. |
| Tamper detection | Perceptual hashing flags duplicate or reused photos. EXIF date checking flags photos predating the current week. |
| Automated enforcement | Every Monday at 6am the system cross-references assignments vs. verified submissions, writes fines, and emails officers. Zero manual work. |
| Officer dashboard | Full web UI: this week's status, fine preview, member manager, chore draft, semester tools, config editor. |
| Associate member (AM) track | Separate roster, event calendar, signature system, point tracking. |
| Draft night board | TV-display mode for live chore assignments. Officers use manager mode (PIN-gated) on a laptop while the board updates in real time. |
| Historical analytics | Optional BigQuery sync at end of semester feeds an included ML notebook that predicts which members are likely to skip. |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GOOGLE APPS SCRIPT                           │
│                                                                     │
│  Code.gs ── Main controller, routing, weekly reset, imports        │
│  PhotoCheck.gs ── Photo upload, perceptual hash, dupe detection    │
│  Signatures.gs ── AM signature system, Drive album                 │
│  AMEvents.gs ── AM event calendar and attendance                   │
│  BigQuerySync.gs ── REST API sync to BigQuery                      │
│                                                                     │
│  Web App (single URL, routed via ?app= param):                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ HomeApp  │  │SubmitApp │  │  DraftApp    │  │  MemberView  │   │
│  │  (hub)   │  │(QR/photo)│  │ (TV + mgmt)  │  │ (compliance) │   │
│  └──────────┘  └──────────┘  └──────────────┘  └──────────────┘   │
│                                                                     │
│  ┌───────────────────────────────────────┐                         │
│  │         OfficerDashboard              │                         │
│  │  This Week · Fine Preview · Member    │                         │
│  │  Stats · Admin (Chore, Members,       │                         │
│  │  Config, Semester, AM Manager)        │                         │
│  └───────────────────────────────────────┘                         │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
           ┌──────────────┼──────────────┐
           ▼              ▼              ▼
    Google Sheets    Google Drive    Gmail
    (live database)  (photo store)  (fine emails + officer reports)
           │
           ▼ (end-of-semester archive, optional)
    ┌─────────────┐
    │  BigQuery   │ ← historical warehouse (free tier)
    └─────────────┘
           │
           ▼
    Google Colab (ML skip-prediction notebook)
```

---

## Requirements

- A Google account that will own the deployment (Workspace or personal)
- Google Sheets, Drive, and Gmail access (included in any Google account)
- [clasp](https://github.com/google/clasp) installed locally for updates (`npm i -g @google/clasp`)
- *(Optional)* A Google Cloud project with BigQuery enabled, for historical analytics

No servers. No Docker. No databases to manage.

---

## Quickstart

```
10–20 minutes for a complete installation.
```

1. **Copy the Sheets template** — create a new Google Sheets workbook with the required tabs and headers (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#step-1--google-sheets-setup))
2. **Connect Apps Script** — paste the source files from `apps-script/` into a bound script project and set `SPREADSHEET_ID` in Script Properties
3. **Configure your chapter** — fill in the `config` tab with your semester dates, officer emails, fine amount, PIN, and chapter branding (see [docs/CONFIGURATION.md](docs/CONFIGURATION.md))
4. **Deploy as Web App** — deploy once and copy the permanent URL; print QR codes from the Officer Dashboard
5. **Create the Monday trigger** — one click from the Chore System menu; automation starts immediately

Full step-by-step guide: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**

---

## Documentation

| Document | Contents |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Full provisioning guide: Sheets setup, Apps Script, Script Properties, Web App deployment, QR codes, triggers |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Complete dictionary of every Script Property and config-sheet key with types, defaults, and impact |
| [docs/UPGRADE.md](docs/UPGRADE.md) | Pushing updates with clasp, managing versioned deployments, schema migrations |
| [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) | Semester archive, Sheets export, BigQuery backup, disaster recovery |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Log inspection, common errors and fixes, Apps Script execution diagnostics |
| [SECURITY.md](SECURITY.md) | Security model, responsible disclosure |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

---

## Weekly lifecycle

| When | What | Automated? |
|---|---|---|
| All week | Members scan QR codes and upload photos | Member action |
| Anytime | Officer reviews flagged/pending photos | Manual |
| Monday 6am | Monday Reset: cross-reference, write fines, email officers, advance week | Automated |
| End of semester | Archive to BigQuery, clear live data, start new semester | One-click |

---

## Navigation reference

All pages share a single deployment URL, distinguished by `?app=` parameter.

| Parameter | Page | Auth |
|---|---|---|
| `?app=home` | HomeApp — navigation hub | None |
| `?app=submit` | SubmitApp — chore photo upload | None |
| `?app=submit&chore=Kitchen` | SubmitApp — pre-filled from QR | None |
| `?app=member` | MemberView — personal compliance history | None |
| `?app=officer` | Officer Dashboard | Officer PIN |
| `?app=draft&mode=display` | Draft Night Board (TV read-only) | None |
| `?app=draft&mode=manage` | Draft Night Board (manage assignments) | Officer PIN |
