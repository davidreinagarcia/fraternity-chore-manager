# Upgrade Guide

How to push code changes, manage Apps Script deployments, and handle schema changes across versions.

---

## Understanding the two-deployment model

Apps Script has two types of deployments and they behave very differently:

| Type | Auto-updates on `clasp push`? | Requires Google login? | Use for |
|---|---|---|---|
| **Test deployment** (`@HEAD`) | Yes | Always, unconditionally | Local testing only |
| **Versioned deployment** (your public URL) | No — requires explicit `clasp deploy` | No (if configured as `ANYONE_ANONYMOUS`) | Members, QR codes, everything live |

**Never share or print QR codes using the test deployment URL.** Always use the versioned deployment ID from your initial setup.

---

## Standard update workflow

```bash
# 1. Make your changes to files in apps-script/

# 2. Push to the test deployment (verify in a browser before going live)
clasp push

# 3. Test at the @HEAD test URL (requires your Google login)
#    Apps Script editor → Deploy → Test deployments → Copy web app URL

# 4. When satisfied, promote to the versioned public deployment
clasp deploy -i YOUR_DEPLOYMENT_ID -d "v1.x.x — brief description of change"
```

To find your deployment ID:
```bash
clasp deployments
# Output example:
# - AKfycbwwC_E3KwYB... @1  (versioned, this is your public one)
# - AKfycbxwgSXSVWBD... @HEAD (test deployment)
```

The versioned deployment ID is the long string after `-` and before `@1`. It matches the ID in your public URL: `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`.

---

## Verifying a deployment

After running `clasp deploy`, open the public URL in a private/incognito browser window (to avoid cached versions) and confirm:

- [ ] Home page loads without error
- [ ] `?app=submit` submission form is accessible without a Google login prompt
- [ ] `?app=officer` prompts for PIN (not a Google login)
- [ ] Officer Dashboard loads after PIN entry

---

## Schema changes

The codebase reads member fields by column name using `_buildColMap()`, so **adding new columns to any sheet is non-breaking** — existing rows will simply have empty values for the new column and the code handles that gracefully.

### Adding a column to `members` or `AMs`

1. Add the header to row 1 of the sheet
2. The column is immediately available to all script functions
3. No code changes required unless you want the new field to appear in the dashboard or exports

### Adding a config key

1. Add a row to the `config` sheet: column A = key name, column B = default value
2. The config is read at runtime; the key is available immediately

### Renaming a column

**Breaking change.** The code references columns by the exact header string. If you rename a column:

1. Update the header in the sheet
2. Search for the old name across all `.gs` files:
   ```bash
   grep -r "old_column_name" apps-script/
   ```
3. Update each reference and push

### Removing a column

The `_buildColMap()` helper returns `undefined` for missing columns and all field accessors use `cm['field'] !== undefined` guards, so missing columns degrade gracefully rather than throwing errors. Still, check with `grep` before removing.

---

## Version-specific migration notes

### Upgrading to 1.3.0 (AMs on separate sheet)

If upgrading from a version where AMs were stored in the `members` sheet:

1. Create a new tab named `AMs` with the same column headers as `members`, plus a `points` column
2. From Member Manager, filter by status `associate` and export to CSV
3. Import those rows into the `AMs` tab via **Admin → Semester Tools → Import Members CSV**
4. Delete or mark inactive the AM rows in the `members` sheet
5. Push the updated code: `clasp push && clasp deploy -i YOUR_DEPLOYMENT_ID`

### Upgrading to 1.4.0 (Signatures system)

Signatures require a dedicated Drive folder. On first use of the Signatures app, the script creates a `Signatures Pics` folder inside the deploying user's shared Drive root automatically. No manual migration needed.

### Upgrading to 1.5.0 (AM Event Points)

A new `AM Events` sheet is created automatically on first load of the AM Events tab. No manual migration needed.

---

## Rollback procedure

Apps Script keeps a full version history of every deployment.

1. Apps Script editor → **Deploy → Manage Deployments**
2. Find the versioned deployment and click the edit (pencil) icon
3. Under **Version**, select the previous version from the dropdown
4. Click **Save**

The public URL instantly serves the previous version. No data is affected — version rollback only affects the code, not the Sheets data.

To find the version number of a known-good state:
```bash
clasp versions
# Lists all versions with their descriptions and timestamps
```

---

## Changing the deploying Google account

This is a destructive operation and requires full re-provisioning.

1. Create a new Apps Script project under the new account (see [DEPLOYMENT.md](DEPLOYMENT.md))
2. Export all Sheets data to CSV before switching (see [BACKUP_RESTORE.md](BACKUP_RESTORE.md))
3. Transfer ownership of the Drive photo folders to the new account (Drive → right-click folder → Share → transfer ownership)
4. Re-configure all Script Properties in the new project
5. Deploy a new versioned deployment — **all existing QR codes must be reprinted**

There is no in-place account migration path. Plan this change during a semester break.
