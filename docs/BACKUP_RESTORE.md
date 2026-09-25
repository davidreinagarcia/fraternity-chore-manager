# Backup and Restore

Procedures for backing up chapter data, performing semester archives, and recovering from data loss.

---

## What needs to be backed up

| Data | Where it lives | Risk level |
|---|---|---|
| Member roster | `members` and `AMs` sheets | High — roster is hard to reconstruct |
| Chore assignments | `chore_assignments` sheet | Medium |
| Submission history | `submissions` sheet | Medium |
| Fine records | `fines` sheet | High — disputed fines require a paper trail |
| Config | `config` sheet | Low — easy to re-enter |
| Submission photos | Google Drive (deploying account) | Medium — photos are proof of completion |
| BigQuery archive | GCP project | Low — already a backup of past semesters |

The Apps Script source code lives in version control (GitHub) and does not need separate backup.

---

## Manual backup (anytime)

### Export Sheets to CSV

From Google Sheets, for each tab you want to backup:

**File → Download → Comma Separated Values (.csv)**

Or download all tabs at once by exporting as XLSX and converting:

**File → Download → Microsoft Excel (.xlsx)**

For a command-line approach using the Sheets API (requires `gcloud` auth):
```bash
# Export a specific sheet tab by tab GID (visible in the URL when you click the tab)
curl -L \
  "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/export?format=csv&gid=TAB_GID" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -o members_backup_$(date +%Y%m%d).csv
```

### Export submission photos

Google Drive photos are stored in a folder named `Chore Submissions` (or similar, depending on your setup) in the deploying account's Drive. To download:

1. Google Drive → locate the `Chore Submissions` folder
2. Right-click → **Download** (creates a ZIP)

For large archives, use [Google Takeout](https://takeout.google.com/) to export all Drive files.

---

## Semester archive (built-in, recommended)

The built-in End-of-Semester Archive is the primary backup mechanism for operational data. Run it at the end of every semester **before** starting the new one.

**Admin → Semester Tools → End of Semester Archive**

Type `ARCHIVE` in the confirmation box to proceed.

What it does:
1. Pushes all current data (submissions, fines, assignments) to BigQuery (if configured)
2. Clears `chore_assignments`, `submissions`, `fines`, and `weekly_status` tabs
3. Leaves `members`, `AMs`, `alumni`, and `config` untouched

> **Warning**: This operation is irreversible. Always export a full CSV backup of all sheets before running it, in case BigQuery sync fails or you need to reference a specific record later.

### Pre-archive checklist

- [ ] Export `submissions` sheet to CSV (`submissions_SEMESTER_backup.csv`)
- [ ] Export `fines` sheet to CSV (`fines_SEMESTER_backup.csv`)
- [ ] Export `members` sheet to CSV (`members_SEMESTER_backup.csv`)
- [ ] Confirm `bigquery_project_id` is set in config and BigQuery sync has run successfully at least once this semester
- [ ] Run End of Semester Archive

---

## BigQuery sync

BigQuery serves as the long-term historical record. Sync runs automatically as part of the semester archive, but can also be triggered manually.

**Admin → Semester Tools → Sync to BigQuery** (if this menu item exists) or run the function `syncToBigQuery()` directly from the Apps Script editor:

1. Apps Script editor → select `BigQuerySync.gs`
2. Select the `syncToBigQuery` function from the function dropdown
3. Click **Run**

Check the `logs` sheet or Apps Script execution transcript for success or failure.

### BigQuery table structure

Three tables in the configured dataset:

| Table | Contents |
|---|---|
| `submissions` | All submission records with photo metadata and verification status |
| `fines` | All fine records with week, reason, and amount |
| `assignments` | All chore assignment records by semester |

---

## Restore procedures

### Restore from CSV backup

If a sheet tab is accidentally cleared or corrupted:

1. Create a new tab with the correct name (e.g. `members`)
2. Add the correct headers in row 1 (see [DEPLOYMENT.md](DEPLOYMENT.md#step-1--google-sheets-setup))
3. **File → Import → Upload** your CSV backup file
4. Select **Append to current sheet** to preserve headers, or paste data manually starting at row 2

The code is schema-agnostic (reads by column name), so as long as the headers match, restored data will work immediately.

### Restore submission photos

Photos are stored in Google Drive, not in the spreadsheet. If photos are deleted from Drive:

- Individual photos: check Google Drive **Trash** (files are recoverable for 30 days)
- Bulk restore: restore from Google Takeout archive or Drive backup

The `photo_url` column in `submissions` stores the Drive file ID. If a photo is re-uploaded to Drive, update the `photo_url` to the new file ID.

### Restore from BigQuery

If current-semester Sheets data is lost after a successful BigQuery sync:

```sql
-- Example: reconstruct fines sheet from BigQuery
SELECT
  fine_id,
  member_id,
  chore_name,
  week_start,
  reason,
  issued_at,
  issued_by
FROM `YOUR_PROJECT.frat_chores.fines`
WHERE semester = 'Fall 2025'
ORDER BY issued_at;
```

Export the query result as CSV from BigQuery Studio and import into the sheet.

---

## Disaster recovery

### Scenario: spreadsheet deleted

1. Check Google Drive **Trash** — spreadsheets are recoverable for 30 days
2. If unrecoverable:
   a. Create a new spreadsheet with the correct tab structure ([DEPLOYMENT.md](DEPLOYMENT.md#step-1--google-sheets-setup))
   b. Import CSV backups for each tab
   c. Update `SPREADSHEET_ID` in Script Properties
   d. Re-link Google Forms if using Semester Sync (**Admin → Semester Tools → Relink Google Forms**)
3. Verify the Monday trigger is still active (it is bound to the script project, not the spreadsheet, so it may still exist)

### Scenario: Apps Script project deleted

1. Create a new bound script project from the spreadsheet (**Extensions → Apps Script**)
2. `clasp push` from the repository to populate it
3. Re-add Script Properties (`SPREADSHEET_ID`, `BQ_SERVICE_ACCOUNT_KEY`)
4. Deploy as a new Web App — **all existing QR codes must be reprinted with the new URL**
5. Re-create the Monday trigger (**Chore System → Setup: Create Monday Trigger**)

### Scenario: deploying Google account lost

See [UPGRADE.md — Changing the deploying Google account](UPGRADE.md#changing-the-deploying-google-account).

---

## Recommended backup schedule

| Frequency | Action |
|---|---|
| Weekly | No action needed — BigQuery sync happens at semester end |
| Before any bulk operation (import CSV, semester sync, archive) | Export affected sheets to CSV |
| End of semester | Run End of Semester Archive; keep CSV exports for 2 semesters |
| Annually | Google Takeout of the deploying account's Drive for photo archive |
