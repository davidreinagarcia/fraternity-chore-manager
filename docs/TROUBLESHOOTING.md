# Troubleshooting

Diagnostic commands, common failure patterns, and how to interpret Apps Script logs.

---

## Where to look first

### 1. The `logs` sheet

Every script function writes errors and key events to the `logs` tab in your spreadsheet.

| Column | Description |
|---|---|
| `timestamp` | ISO 8601 timestamp of the event |
| `level` | `ERROR` or `INFO` |
| `function` | Name of the function that logged it |
| `message` | Error message or informational note |

Filter column B to `ERROR` to see only failures. Sort by column A descending to see the most recent events first.

### 2. Apps Script execution transcript

For real-time debugging or inspecting a function you just ran manually:

1. Apps Script editor → **Executions** (play-button icon in left sidebar)
2. Find the execution you want to inspect and click it
3. The transcript shows every `console.log`, `console.error`, and uncaught exception

This is especially useful for Monday Reset — if it ran but produced unexpected results, the transcript shows exactly what it did.

### 3. Stackdriver logs

Apps Script writes to Google Cloud Logging when `"exceptionLogging": "STACKDRIVER"` is set (it is, by default).

- Go to [Google Cloud Console](https://console.cloud.google.com/) → **Logging → Logs Explorer**
- Filter by your Apps Script project

---

## Common errors and fixes

### "SPREADSHEET_ID not set in Script Properties"

**Cause**: The `SPREADSHEET_ID` Script Property is missing or the script is running against the wrong project.

```
Fix:
1. Apps Script editor → Project Settings (gear icon) → Script Properties
2. Confirm SPREADSHEET_ID is present and matches your spreadsheet URL
3. If the script is a standalone project (not bound to the sheet), open the sheet
   and go to Extensions → Apps Script to get the bound project
```

---

### Member submission works but Monday Reset does not run automatically

**Cause**: The time-based trigger is missing or was deleted.

```
Check:
1. Apps Script editor → Triggers (clock icon)
2. Look for a trigger: Function = mondayReset, Event = Time-driven, Every week, Monday, 6am–7am

Fix if missing:
  In your spreadsheet: Chore System → Setup: Create Monday Trigger
  Then authorize the script when prompted.
```

---

### Monday Reset runs but sends no email

**Cause**: `officer_emails` is incorrectly formatted, or Gmail authorization is missing.

```
Check config sheet:
- officer_emails value should be: email1@domain.com,email2@domain.com
- No spaces, no quotes, comma-separated only

Fix Gmail auth:
1. Apps Script editor → select mondayReset from function dropdown → Run
2. Follow the authorization prompts
3. Confirm execution completes without error in the Executions tab
```

---

### QR codes scan but show "Script function not found" or a blank page

**Cause 1**: The public versioned deployment is out of date.
```
Fix:
  clasp push && clasp deploy -i YOUR_DEPLOYMENT_ID -d "fix"
```

**Cause 2**: The web app access setting is wrong.
```
Check:
1. Apps Script → Deploy → Manage Deployments → edit the versioned deployment
2. Execute as: Me
3. Who has access: Anyone
4. Save and redeploy
```

**Cause 3**: The QR code points to the test deployment URL (contains `@HEAD`).
```
Fix: regenerate QR codes from the Officer Dashboard using the correct versioned URL
```

---

### "Cannot read property of undefined" errors in logs

**Cause**: A sheet tab is missing, or a column header has a typo.

```
Check:
1. Confirm all required tabs exist (members, AMs, alumni, chore_assignments, submissions,
   fines, weekly_status, config, logs)
2. Confirm column headers in row 1 match exactly — no extra spaces, correct capitalization
3. The error message in the logs will name the function that failed; look for the sheet/column
   it was trying to read
```

---

### BigQuery sync fails with authentication error

**Cause**: The service account key is expired, malformed, or has insufficient permissions.

```
Check:
1. Script Properties → BQ_SERVICE_ACCOUNT_KEY: must be the entire JSON object, not base64
2. The service account must have both roles:
   - roles/bigquery.dataEditor
   - roles/bigquery.jobUser
3. BigQuery API must be enabled in the GCP project

Test the key manually:
  Copy the JSON key to a local file and run:
  gcloud auth activate-service-account --key-file=bq-key.json
  bq ls YOUR_PROJECT_ID:frat_chores
```

---

### Duplicate photo detection is too strict / too loose

**Cause**: `photo_hash_threshold` needs tuning for your photo environment.

```
Threshold guide:
  0–5   → very strict, may flag legitimate photos taken moments apart
  8–12  → recommended default, catches obvious reuse
  15–20 → loose, only catches identical or near-identical photos
  >20   → effectively disabled

Change: Admin → Config Editor → photo_hash_threshold
Effect: takes effect immediately on the next submission
```

---

### "Auto-split gives no chores" or uneven distribution

**Cause**: `chore_ratios.json` cannot be found in Google Drive root.

```
Check:
1. In your Drive root, confirm a file named exactly chore_ratios.json exists
2. The file must be owned by or explicitly shared with the deploying Google account
3. Confirm the JSON is valid (no trailing commas, correct brackets)

Test:
  Apps Script editor → run getChoreRatios() manually and check the execution transcript
  If it returns null or throws, the file is not accessible
```

---

### Photos not saving to Drive

**Cause**: The deploying account's Drive is full, or the script lost Drive authorization.

```
Check Drive storage:
  drive.google.com → Storage (bottom left) — confirm available space

Re-authorize:
1. Apps Script editor → select submitPhoto (or similar) from function dropdown → Run
2. Follow any authorization prompts that appear
3. Re-check the Executions tab for success
```

---

### Officer Dashboard shows a blank white page after PIN entry

**Cause**: A JavaScript error in OfficerDashboard.html is stopping the page from rendering.

```
Debug:
1. Open the Officer Dashboard URL in Chrome
2. Open DevTools (F12) → Console tab
3. Enter the PIN — the console will show the JavaScript error
4. The error message and line number will point to the cause

Common causes:
  - A config value is missing (check the config sheet for required keys)
  - An API call to the backend failed (look for 'google.script.run' errors)
```

---

### iOS camera picker does not appear on the Signature form

**Cause**: The page is being served from the test deployment, not the versioned one.

The `accept` attribute on file inputs behaves differently on iOS Safari depending on whether the page is served from a `script.google.com` versioned URL vs a test deployment URL. Always use the versioned public URL for member-facing pages.

---

## Inspecting a specific execution

To replay a specific Monday Reset and see what it did:

1. **Executions** → find the Monday Reset execution by date/time
2. Click to expand
3. Look for log lines matching: `mondayReset`, `writeFines`, `sendOfficerEmail`
4. If it failed midway, the last successful log line shows where it stopped
5. Cross-reference with the `logs` sheet (same timestamp) for the full message

---

## Emergency: Monday Reset ran but produced wrong fines

```
Steps:
1. Do NOT run Monday Reset again — it is designed to be idempotent for the
   current week but manual inspection is safer

2. Open the fines sheet and filter by week_start = this Monday's date

3. Identify incorrect fine records and delete them manually

4. Re-check submissions for the affected members and verify their photo status
   (human_status column: 'pass' = should not be fined)

5. If you need to reissue fines for members who were incorrectly skipped,
   use Admin → Fine Preview → manually add fine records

6. Document what happened in the logs sheet with a manual INFO entry for audit purposes
```
