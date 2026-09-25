# Deployment Guide

Complete provisioning guide for a new chapter installation. Estimated time: **15–25 minutes**.

---

## Prerequisites

- [ ] A Google account that will own the deployment (personal or Workspace)
- [ ] [Node.js](https://nodejs.org/) installed (for clasp)
- [ ] clasp installed globally: `npm install -g @google/clasp`
- [ ] clasp authenticated: `clasp login` (opens browser OAuth)

---

## Step 1 — Google Sheets setup

Create a new Google Sheets workbook. Add the following tabs (exact names, case-sensitive):

| Tab name | Column headers |
|---|---|
| `members` | `member_id \| BK# \| legal_first \| preferred_name \| legal_last \| personal_email \| GT_email \| status \| pledge_class \| officer_role \| phone \| added_date \| meal_plan \| living_in_house \| room_number \| inactive_reason \| suspension \| suspension_reason \| suspension_end \| academic_suspension \| probation \| probation_type \| form_completed_this_semester \| anticipated_graduation \| GTID \| buzzcard \| GT_username \| hometown \| birthday \| shirt_size \| dietary_restrictions \| car_on_campus \| allergies \| emergency_contact_name \| emergency_contact_phone \| campus_orgs \| leadership_positions \| which_positions \| service_orgs \| anything_else \| major \| year \| last_updated` |
| `AMs` | Same headers as `members` plus `points` |
| `alumni` | `member_id \| BK# \| legal_first \| preferred_name \| legal_last \| personal_email \| GT_email \| pledge_class \| officer_role \| phone \| anticipated_graduation \| graduated_semester \| moved_to_alumni_date \| notes \| ...` (same extra fields as members) |
| `chore_assignments` | `assignment_id \| member_id \| chore_name \| group_id \| semester \| assigned_date` |
| `submissions` | `submission_id \| member_id \| chore_name \| week_start \| submitted_at \| photo_url \| photo_hash \| exif_date \| auto_status \| human_status \| verified_by \| notes` |
| `fines` | `fine_id \| member_id \| chore_name \| week_start \| reason \| issued_at \| issued_by` |
| `weekly_status` | `chore_name \| member_names \| submitted \| photo_status \| human_verified` |
| `config` | `key \| value` (two columns only) |
| `logs` | `timestamp \| level \| function \| message` |

Note the **Spreadsheet ID** from the URL:
```
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

---

## Step 2 — Apps Script project

### Option A — clasp (recommended for ongoing development)

```bash
# In the project root
clasp create --title "Chore Manager — [Chapter Name]" --type sheets --parentId SPREADSHEET_ID
clasp push
```

This creates a bound Apps Script project and pushes all files from `apps-script/`.

### Option B — manual (no clasp required)

1. Open your Spreadsheet → **Extensions > Apps Script**
2. For each `.gs` file in `apps-script/`, create a matching script file and paste its contents
3. For each `.html` file in `apps-script/`, create a matching HTML file and paste its contents

---

## Step 3 — Script Properties

In the Apps Script editor: **Project Settings** (gear icon) → **Script Properties** → **Add property**

| Property key | Value | Required |
|---|---|---|
| `SPREADSHEET_ID` | Your Spreadsheet ID from Step 1 | Yes |
| `BQ_SERVICE_ACCOUNT_KEY` | Full JSON content of your BigQuery service account key | Only if using BigQuery |

> These values are stored encrypted by Google and are never exposed in source code or to the web frontend.

---

## Step 4 — Config tab

Populate the `config` sheet with your chapter's settings. Paste these rows (column A = key, column B = value):

| Key | Example value | Notes |
|---|---|---|
| `chapter_name` | `Alpha Beta Chapter` | Displayed in dashboard header and member-facing pages |
| `primary_color` | `#003087` | Main brand color (hex). Used for nav bars, buttons, PIN screen. |
| `accent_color` | `#FFD700` | Accent/highlight color (hex). Used for borders, highlights. |
| `logo_url` | `https://drive.google.com/...` | Public URL to chapter logo image. Leave blank to show text only. |
| `member_id_label` | `Roll #` | Label for your chapter's member ID column (e.g. BK#, Roll #, Member #) |
| `semester` | `Fall 2025` | Current semester label, used in fine records and archives |
| `week_start` | `2025-08-25` | Date (YYYY-MM-DD) of the Monday of the first chore week |
| `officer_emails` | `officer1@email.com,officer2@email.com` | Comma-separated, no spaces. Recipients for Monday Reset email. |
| `fine_amount` | `5` | Fine amount in USD per missed chore |
| `officer_pin` | `4821` | Shared PIN for Officer Dashboard and Draft Night manager mode |
| `photo_hash_threshold` | `10` | Hamming distance threshold for perceptual hash duplicate detection (0–64; lower = stricter) |
| `exif_age_limit_days` | `8` | Photos with EXIF dates older than this many days are flagged |
| `show_photos_in_member_view` | `true` | Whether members can see their own submission photos in MemberView |
| `bigquery_project_id` | `my-gcp-project` | Your GCP project ID. Leave blank if not using BigQuery. |
| `bigquery_dataset` | `frat_chores` | BigQuery dataset name. Leave blank if not using BigQuery. |

---

## Step 5 — Chore list

Upload `config/chore_ratios.json` to the **root of your Google Drive** (filename must be exact). This file defines the chore names and how many members each requires for auto-split.

Edit the file first to match your chapter's actual chores:

```json
{
  "chores": [
    { "name": "Kitchen Cleanup", "people": 2, "frequency": "weekly" },
    { "name": "Bathroom 1F",     "people": 1, "frequency": "weekly" },
    { "name": "Common Areas",    "people": 3, "frequency": "weekly" }
  ]
}
```

---

## Step 6 — BigQuery setup (optional)

Skip this step if you do not need historical analytics.

```bash
# Create a GCP project and enable BigQuery
gcloud projects create YOUR_PROJECT_ID
gcloud services enable bigquery.googleapis.com --project YOUR_PROJECT_ID

# Create a service account with minimal permissions
gcloud iam service-accounts create chore-bq-sync \
  --display-name "Chore Manager BigQuery Sync" \
  --project YOUR_PROJECT_ID

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member "serviceAccount:chore-bq-sync@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role "roles/bigquery.dataEditor"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member "serviceAccount:chore-bq-sync@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role "roles/bigquery.jobUser"

# Download the key
gcloud iam service-accounts keys create bq-key.json \
  --iam-account chore-bq-sync@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

Paste the entire contents of `bq-key.json` as the value of the `BQ_SERVICE_ACCOUNT_KEY` Script Property. Delete the local `bq-key.json` file afterward.

Then initialize the BigQuery tables: in your Spreadsheet, click **Chore System → Setup: Init BigQuery Tables**.

---

## Step 7 — Monday Reset trigger

In your Spreadsheet: **Chore System → Setup: Create Monday Trigger**

This installs a time-based trigger that fires every Monday at 6am in the `timeZone` set in `appsscript.json` (default: `America/New_York`). You will be prompted to authorize the script on first run — this is normal and required.

To verify the trigger was created:
1. Apps Script editor → **Triggers** (clock icon in left sidebar)
2. You should see one trigger: `mondayReset`, Time-driven, Week timer, Every Monday, 6am–7am

---

## Step 8 — Web App deployment

> **Critical**: Apps Script has two kinds of deployments. You must use a **versioned** deployment for the public-facing URL — test deployments enforce Google account login unconditionally.

1. In Apps Script: **Deploy → New Deployment**
2. Type: **Web app**
3. Execute as: **Me** (the deploying Google account)
4. Who has access: **Anyone** (allows anonymous member submissions)
5. Click **Deploy** and copy the deployment URL

**Save this URL permanently.** All QR codes, bookmarks, and member-shared links will use this URL. If you create a new deployment, all existing QR codes break.

The deployment URL format:
```
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

---

## Step 9 — Generate and print QR codes

1. Open the deployment URL with `?app=officer` appended
2. Enter your officer PIN
3. Go to **Admin → Chore Manager**
4. Click **QR** next to any chore to preview its QR code
5. Click **Download All QR Codes (ZIP)** to get a labeled PNG for every chore at once

Print on cardstock, laminate, and post in each chore area.

---

## Semester start checklist

- [ ] Config tab: update `semester` and `week_start`
- [ ] Run **Admin → Semester Tools → Relink Google Forms** (once per semester, if using Semester Sync)
- [ ] Run **Admin → Semester Tools → Run Semester Sync** to add new members and update returning ones
- [ ] Graduate outgoing brothers via **Admin → Member Manager**
- [ ] Run auto-split or hold draft night to assign chores
- [ ] Verify the Monday trigger is still active (Apps Script → Triggers)

---

## Deployment URL management

```bash
# Push code changes (does NOT update the public versioned deployment)
clasp push

# Push AND update the versioned public deployment in one step
clasp push && clasp deploy -i DEPLOYMENT_ID -d "v1.x.x — description"
```

Where `DEPLOYMENT_ID` is the ID from your Step 8 deployment URL (`s/DEPLOYMENT_ID/exec`).

To list all deployments and their IDs:
```bash
clasp deployments
```

See [UPGRADE.md](UPGRADE.md) for the full update workflow.
