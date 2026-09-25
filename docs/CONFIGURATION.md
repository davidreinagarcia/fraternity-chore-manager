# Configuration Reference

All configuration lives in two places: **Script Properties** (for secrets) and the **`config` sheet** (for operational and branding settings). Both are manageable from the Apps Script UI and the Officer Dashboard respectively.

---

## Script Properties

Set via: Apps Script editor → **Project Settings** → **Script Properties**

These values are encrypted at rest by Google and are never exposed in source code or to the browser.

| Property | Type | Required | Description |
|---|---|---|---|
| `SPREADSHEET_ID` | string | Yes | The Google Sheets document ID. Found in the spreadsheet URL: `.../spreadsheets/d/SPREADSHEET_ID/edit` |
| `BQ_SERVICE_ACCOUNT_KEY` | string (JSON) | No | Full content of the BigQuery service account JSON key file. Only required if `bigquery_project_id` is set in the config sheet. |

---

## Config sheet keys

Set via: the `config` sheet tab (column A = key, column B = value), or **Admin → Config Editor** in the Officer Dashboard.

### Chapter identity

| Key | Type | Default | Required | Description |
|---|---|---|---|---|
| `chapter_name` | string | — | Recommended | Displayed in the dashboard header, PIN screen, and member-facing pages. Example: `Alpha Beta Chapter` |
| `primary_color` | string (hex) | `#093D20` | No | Main brand color used for nav bars, buttons, and the PIN screen background. Must be a valid CSS hex color. |
| `accent_color` | string (hex) | `#FFB71D` | No | Highlight/accent color used for borders and emphasis elements. Must be a valid CSS hex color. |
| `logo_url` | string (URL) | — | No | Publicly accessible URL to the chapter logo image (PNG or SVG recommended). Leave blank to display chapter name as text only. The image must be publicly accessible — a Google Drive share link with "Anyone with the link can view" works. |
| `member_id_label` | string | `BK#` | No | Label for the chapter-specific member identifier column. Examples: `Roll #`, `Member #`, `Chapter #`. Displayed in Member Manager, DraftApp, and exports. |

### Semester and schedule

| Key | Type | Default | Required | Description |
|---|---|---|---|---|
| `semester` | string | — | Yes | Current semester label. Used in fine records, BigQuery archives, and emails. Examples: `Fall 2025`, `Spring 2026` |
| `week_start` | string (YYYY-MM-DD) | — | Yes | The Monday of the first chore week of the current semester. The Monday Reset timer references this to determine which week it is. Update at the start of each semester. |

### Enforcement

| Key | Type | Default | Required | Description |
|---|---|---|---|---|
| `fine_amount` | number | `5` | Yes | Fine amount in USD applied per missed chore per week during Monday Reset. |
| `officer_emails` | string | — | Yes | Comma-separated list of email addresses to receive Monday Reset reports and fine summaries. No spaces. Example: `hm@chapter.org,president@chapter.org` |
| `officer_pin` | string | `1234` | Yes | Shared PIN for the Officer Dashboard and Draft Night manager mode. Must be numeric. Strongly recommended to change from the default. |

### Photo verification

| Key | Type | Default | Required | Description |
|---|---|---|---|---|
| `photo_hash_threshold` | integer (0–64) | `10` | No | Hamming distance threshold for perceptual hash comparison. Two photos are considered duplicates if their hash distance is at or below this value. Lower values are stricter (fewer false positives, may miss near-duplicates). Recommended range: 8–15. |
| `exif_age_limit_days` | integer | `8` | No | Photos with an EXIF date older than this many days relative to the current week's Monday are flagged as "old photo" for officer review. Set to `0` to disable EXIF checking. |
| `show_photos_in_member_view` | boolean string | `true` | No | Whether members can see their own submission photo thumbnails in MemberView. Set to `false` to hide photos from member-facing views. Accepts `true` or `false` (string). |

### BigQuery (optional)

| Key | Type | Default | Required | Description |
|---|---|---|---|---|
| `bigquery_project_id` | string | — | No | Your Google Cloud project ID. If blank, BigQuery sync is disabled entirely. Example: `my-chapter-analytics` |
| `bigquery_dataset` | string | `frat_chores` | No | BigQuery dataset name where tables will be created. The dataset is created automatically on first sync if it does not exist. |

---

## `chore_ratios.json`

Stored in the **root of the deploying user's Google Drive** (filename must be exact: `chore_ratios.json`).

This file defines which chores exist and how many members each requires. It is read by the auto-split algorithm.

```json
{
  "chores": [
    { "name": "Kitchen Cleanup",  "people": 2, "frequency": "weekly" },
    { "name": "Bathroom 1F",      "people": 1, "frequency": "weekly" },
    { "name": "Bathroom 2F",      "people": 1, "frequency": "weekly" },
    { "name": "Common Areas",     "people": 3, "frequency": "weekly" },
    { "name": "Trash",            "people": 2, "frequency": "weekly" }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `name` | string | Chore display name. Must match the chore names used in `chore_assignments`. This is the value that appears in QR codes and submissions. |
| `people` | integer | Number of members to assign to this chore each week during auto-split. |
| `frequency` | string | Currently informational only. Use `"weekly"` for all chores. |

> If this file is missing or cannot be read, auto-split returns no assignments and logs an error. The file must be owned by or shared with the deploying Google account.

---

## `appsscript.json`

Stored in `apps-script/appsscript.json`. Controls runtime settings for the Apps Script project.

```json
{
  "timeZone": "America/New_York",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_DEPLOYING",
    "access": "ANYONE_ANONYMOUS"
  }
}
```

| Field | Notes |
|---|---|
| `timeZone` | Controls when Monday Reset fires. Change to your chapter's timezone (e.g. `America/Chicago`, `America/Los_Angeles`). Must be a valid [IANA timezone identifier](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). |
| `executeAs` | Must remain `USER_DEPLOYING`. All Drive, Sheets, and Gmail access runs as the deploying account. |
| `access` | Must remain `ANYONE_ANONYMOUS` for member QR submissions to work without a Google login. |

---

## Config change notes

- Changes to the `config` sheet take effect immediately on the next page load — no redeployment required.
- Changes to Script Properties (e.g. rotating `BQ_SERVICE_ACCOUNT_KEY`) take effect immediately — no redeployment required.
- Changes to `appsscript.json` require a `clasp push` followed by a new versioned deployment to take effect on the public URL. See [UPGRADE.md](UPGRADE.md).
- Changes to `chore_ratios.json` take effect on the next auto-split run (the file is read at runtime, not cached).
