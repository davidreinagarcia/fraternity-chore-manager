# Frat Chores — Automated Chore Management System

A production-grade chore management platform for ~80-member fraternity chapters using **Google Workspace** as the backbone. Replaces manual Google Forms + Sheets workflows with automated enforcement, photo verification, and ML-ready data collection.

---

## Motivation

Managing chores in a house of 80+ brothers is a logistics problem that most chapters solve badly — paper sign-off sheets, honor-system Google Forms, or a house manager spending hours every Monday chasing people down. None of these scale, and all of them create conflict when the enforcement is inconsistent or perceived as unfair.

This project started from a simple frustration: officers had no reliable way to know who actually completed their chores versus who just claimed they did, and there was no paper trail when fines were disputed. The result was a system built entirely on tools the chapter already pays for (Google Workspace) so there is no hosting cost and no new account to manage.

**The core goals:**

- **Accountability without friction** — Members scan a QR code in the chore area and upload a photo. That's the whole submission flow. No logins, no app to install.
- **Tamper resistance** — Perceptual hashing detects duplicate or near-duplicate photos (e.g. the same photo submitted twice, or old photos from a previous week). EXIF date checking flags photos that predate the current week. Officers still have final say, but the system surfaces the suspicious ones automatically.
- **Automated enforcement** — Every Monday at 6am, the system cross-references who was assigned a chore against who submitted a passing photo and writes fines automatically. Officers get an email summary. No manual work required.
- **Data for better decisions** — Every submission, fine, and assignment is archived to BigQuery at the end of each semester. After two or more semesters, the included ML notebook can predict which members are likely to skip, and which chores historically get skipped most. Officers can use this during draft night to place reliable members on high-risk chores.
- **Free infrastructure** — Everything runs on Google Apps Script, Sheets, Drive, and Gmail. The only optional paid component is BigQuery, which stays well within the free tier for a chapter this size.

The system is deliberately simple under the hood — no frameworks, no servers, no databases to manage. If the chapter's Google account is active, it works.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GOOGLE APPS SCRIPT                           │
│                                                                     │
│  Code.gs ─── Main controller, routing, weekly reset, imports       │
│  PhotoCheck.gs ─── Photo upload, perceptual hash, dupe detection   │
│  BigQuerySync.gs ─── REST API sync to BigQuery                     │
│                                                                     │
│  Web Apps (HTML served by Apps Script):                            │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  ┌───────┐ │
│  │  DraftApp   │  │  SubmitApp   │  │OfficerDashboard│  │Member │ │
│  │  (TV board) │  │  (QR scan)   │  │ (review/admin) │  │ View  │ │
│  └─────────────┘  └──────────────┘  └────────────────┘  └───────┘ │
└────────────────────────────┬────────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       Google Sheets    Google Drive    Gmail
       (live database)  (photo store)  (fine emails)
              │
              ▼ (end of semester / ongoing sync)
       ┌─────────────┐
       │  BigQuery   │  ← historical warehouse (free tier)
       └─────────────┘
              │
              ▼
       Google Colab
       (ML skip prediction notebook)
```

---

## One-Time Setup Guide

### Step 1 — Google Sheets

1. Create a new Google Sheets workbook.
2. Create these tabs (exact names): `members`, `chore_assignments`, `submissions`, `fines`, `weekly_status`, `config`, `logs`
3. Add column headers to each tab:
   - **members**: `member_id | name | email | status | pledge_class | added_date`
   - **chore_assignments**: `assignment_id | member_id | chore_name | group_id | semester | assigned_date`
   - **submissions**: `submission_id | member_id | chore_name | week_start | submitted_at | photo_url | photo_hash | exif_date | auto_status | human_status | verified_by | notes`
   - **fines**: `fine_id | member_id | chore_name | week_start | reason | issued_at | issued_by`
   - **weekly_status**: `chore_name | member_names | submitted | photo_status | human_verified`
   - **config**: key-value pairs (see Step 4)
   - **logs**: `timestamp | level | function | message`
4. Note the Spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

### Step 2 — Apps Script Project

1. In your Spreadsheet: **Extensions > Apps Script**
2. Create files matching the filenames in `apps-script/`:
   - Paste `Code.gs` content into `Code.gs` (rename the default `Code.gs`)
   - Click **+** > **Script** for `PhotoCheck.gs` and `BigQuerySync.gs`
   - Click **+** > **HTML** for each of the four HTML files
3. Go to **Project Settings** (gear icon) > **Script Properties** > **Add property**:
   - Key: `SPREADSHEET_ID` — Value: your Spreadsheet ID from Step 1
4. Save all files.

### Step 3 — Config Tab Setup

Add these rows to your `config` tab (column A = key, column B = value):

| Key | Example Value |
|-----|---------------|
| `semester` | `Spring 2026` |
| `week_start` | `2026-01-13` (Monday of first week) |
| `officer_emails` | `officer1@chapter.org,officer2@chapter.org` |
| `fine_amount` | `5` |
| `bigquery_project_id` | `your-gcp-project-id` |
| `bigquery_dataset` | `frat_chores` |
| `officer_pin` | `1234` |
| `photo_hash_threshold` | `10` |
| `exif_age_limit_days` | `8` |
| `show_photos_in_member_view` | `true` |

### Step 4 — Google Cloud / BigQuery

1. Create a [Google Cloud project](https://console.cloud.google.com/) (free tier works).
2. Enable the **BigQuery API**.
3. Create a **Service Account**: IAM & Admin > Service Accounts > Create
   - Role: **BigQuery Data Editor** + **BigQuery Job User**
4. Create and download a JSON key for the service account.
5. Back in Apps Script > **Project Settings > Script Properties**, add:
   - Key: `BQ_SERVICE_ACCOUNT_KEY` — Value: paste the **entire JSON key file content**
6. Upload `config/chore_ratios.json` to your Google Drive root (the script reads it by filename).

### Step 5 — Initialize BigQuery Tables

1. In the Spreadsheet: **Chore System > Setup: Init BigQuery Tables**
2. This creates the `frat_chores` dataset and three tables in BigQuery.

### Step 6 — Set Weekly Reset Trigger

1. In the Spreadsheet: **Chore System > Setup: Create Monday Trigger**
2. This creates a time-based trigger: every Monday at 6am Eastern.
3. You will be prompted to authorize the script on first run.

### Step 7 — Deploy as Web App

1. In Apps Script: click **Deploy > New Deployment**
2. Type: **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone within [your org]** (or Anyone if chapter emails are not on Google Workspace)
5. Click **Deploy** and copy the deployment URL.
6. Add the URL to `config/settings.json` as `deployment_id` (or just note it).

### Step 8 — Generate QR Codes

```bash
cd frat-chores/qr
pip install qrcode[pil] Pillow reportlab
python generate_qr_codes.py
```

Paste your deployment URL when prompted. QR PNGs and a print-ready PDF are saved to `qr/output/`. Print them on cardstock, laminate, and post in each chore area.

---

## Semester Start Workflow

1. **Import members**: Prepare a CSV (`name,email,pledge_class`). Save it to Google Drive. Go to **Chore System > Import Members CSV** and paste the Drive file ID.
2. **Auto-split or manual draft**:
   - *Auto-split*: **Chore System > Open Draft App** > Manager Mode > Auto-Split Remaining. Review and save.
   - *Draft night*: Put Draft App (Display Mode) on the TV via HDMI. House manager uses Manager Mode on a laptop to assign members live.
3. **Verify config**: Check that `semester` and `week_start` in the `config` tab are correct.

---

## Weekly Workflow

| When | What happens | Automated? |
|------|-------------|-----------|
| All week | Members scan QR codes, upload photos | Member action |
| Anytime | Officer reviews flagged photos in Officer Dashboard | Manual |
| Monday 6am ET | Monday Reset runs automatically | Automated |
| Monday Reset | Cross-references assignments vs. submissions, writes fines, emails officers, clears submissions, advances week | Automated |
| As needed | Officers verify/fail photos in Officer Dashboard | Manual |

---

## End of Semester Workflow

1. Go to **Chore System > End of Semester Archive** (or Officer Dashboard > Admin > End of Semester)
2. Confirm twice (it's irreversible)
3. The system:
   - Pushes all data to BigQuery
   - Clears chore_assignments, submissions, fines, weekly_status
   - Keeps members tab intact
4. Update `config` tab: change `semester` and `week_start` to the new semester values
5. Re-import members CSV (deactivates graduated members, adds new pledges)
6. Run draft night for the new semester

---

## ML Notebook (Google Colab)

After accumulating 2+ semesters of data:

1. Open `python/ml_skip_prediction.ipynb` in [Google Colab](https://colab.research.google.com/)
2. Upload it: File > Upload notebook
3. Set your `PROJECT_ID` in the notebook (cell 3)
4. Run all cells
5. Download the output CSVs: `member_risk_scores.csv`, `chore_risk_scores.csv`, `smart_assignments.csv`
6. Use `smart_assignments.csv` during draft night to place reliable members on high-skip-rate chores

The notebook needs at least 1 semester to produce risk scores, and 2+ semesters to train the predictive model properly.

---

## Troubleshooting

**QR codes scan but show an error page**
- Check that the web app is deployed with "Anyone" access
- Re-deploy after any script changes (each deploy creates a new version)

**Monday Reset runs but doesn't email**
- Verify `officer_emails` in config tab is a comma-separated list with no spaces
- Ensure the script has Gmail authorization (run it manually once from the menu)

**BigQuery sync fails with auth error**
- Confirm `BQ_SERVICE_ACCOUNT_KEY` is set in Script Properties as the full JSON (not base64)
- Verify the service account has `BigQuery Data Editor` role
- Confirm BigQuery API is enabled in GCP Console

**Photos not saving to Drive**
- The script runs as the deploying user — ensure that user has write access to Drive
- Check the `logs` tab for specific error messages

**Auto-split gives uneven distribution**
- Upload `chore_ratios.json` to Google Drive root and confirm the filename is exact
- If the file can't be found, the function returns no chores — check the logs tab

**"SPREADSHEET_ID not set" error**
- Go to Apps Script > Project Settings > Script Properties > ensure `SPREADSHEET_ID` key exists

---

## Future Improvements

- **Better photo hashing**: The current hash uses byte sampling. A true perceptual hash (pHash) would require an external image processing service or Cloud Function. Consider Cloud Run + Python `imagehash` library for more accurate duplicate detection.
- **Member self-service**: Add a member profile page where brothers can view their own compliance history and fine total.
- **Trade/swap system**: Let members request chore swaps that officers can approve in the dashboard.
- **Push notifications**: Use Twilio or Gmail to send reminder texts/emails on Sunday night before the Monday deadline.
- **Pledge accountability**: Filter member stats by pledge class to surface compliance trends by class year.
- **Automated ML inference**: Run the skip prediction model weekly via Cloud Scheduler and post the risk report to a Slack channel before draft nights.
