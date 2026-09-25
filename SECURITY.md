# Security

## Security model

This application runs entirely within Google's infrastructure. There are no external servers, databases, or third-party services (unless you opt into BigQuery). Understanding the security model helps you configure it appropriately for your chapter.

### Authentication

| Surface | Mechanism | Notes |
|---|---|---|
| Officer Dashboard | 4-digit PIN stored in the `config` sheet | Shared among all officers. Change it in Admin → Config Editor. |
| Draft Night manager mode | Same officer PIN | |
| Member submission | No authentication | By design — members scan a QR code and submit without logging in |
| MemberView | No authentication | Members see their own record by entering their name |
| Script itself | Google OAuth (Apps Script) | Only the Google account that deployed the script can run `clasp push` or trigger functions manually |

**The officer PIN is a lightweight access control, not cryptographic authentication.** It is appropriate for shared internal tooling where all users are chapter members. If your chapter requires stronger access control, consider using Google Workspace organizational units to restrict who can access the deployment URL.

### Data residency

All data lives within the deploying Google account:

- **Member roster, submissions, fines, assignments** → Google Sheets (your account's Drive)
- **Submission photos** → Google Drive folder (your account)
- **Emails** → sent from your Gmail as the deploying user
- **Logs** → `logs` tab in the same spreadsheet
- **BigQuery archive** → your Google Cloud project (optional)

No data ever leaves your Google account unless you explicitly configure BigQuery.

### Script Properties

`SPREADSHEET_ID` and `BQ_SERVICE_ACCOUNT_KEY` are stored as Script Properties (encrypted at rest by Google). They are not visible in the source code and are not exposed to the web app frontend. Do not commit them to version control.

### Photo storage

Photos are stored in Google Drive under the deploying account. The `photo_url` stored in the `submissions` sheet is a Drive file link. By default, these links are not publicly shared — only the deploying account can access them directly. Officers viewing photos through the dashboard do so via the Apps Script backend (which runs as the deploying user), not via direct Drive links exposed to the browser.

### BigQuery service account key

If you enable BigQuery sync, the service account JSON key is stored in Script Properties. Restrict that service account's permissions to `BigQuery Data Editor` + `BigQuery Job User` only — do not grant broader GCP permissions. Rotate the key if it is ever exposed.

### Known limitations

- The officer PIN is visible in plaintext in the `config` sheet to anyone with edit access to the spreadsheet. Restrict spreadsheet access to officers only.
- There is no per-user session management; clearing browser storage logs out of the dashboard immediately.
- Photo EXIF checking relies on metadata embedded by the camera, which can be stripped or spoofed by determined users. The hash check catches reuse but is not a substitute for officer review of flagged submissions.

---

## Responsible disclosure

If you discover a security vulnerability in this project, please report it by opening a GitHub Issue marked **[SECURITY]** or by contacting the maintainer directly. Do not include sensitive details (keys, spreadsheet IDs, real member data) in public issue reports.
