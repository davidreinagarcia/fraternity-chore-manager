// ============================================================
// BigQuerySync.gs — Push Sheets data to BigQuery via REST API
// ============================================================
// Before use:
//   1. Create a GCP service account with BigQuery Data Editor role.
//   2. Download the JSON key file.
//   3. In Apps Script > Project Settings > Script Properties, add:
//        BQ_SERVICE_ACCOUNT_KEY = <paste entire JSON key content>
//   4. Add your GCP project ID to the 'config' tab in Sheets
//        Row: bigquery_project_id | YOUR_PROJECT_ID
// ============================================================

function _bqConfig() {
  return {
    projectId : getConfigValue('bigquery_project_id'),
    dataset   : getConfigValue('bigquery_dataset') || 'frat_chores',
    keyJson   : PropertiesService.getScriptProperties().getProperty('BQ_SERVICE_ACCOUNT_KEY')
  };
}

// Obtain a short-lived OAuth2 access token via JWT assertion
function _bqAccessToken() {
  const cfg = _bqConfig();
  if (!cfg.keyJson) throw new Error('BQ_SERVICE_ACCOUNT_KEY missing from Script Properties.');

  const key = JSON.parse(cfg.keyJson);
  const now = Math.floor(Date.now() / 1000);

  const header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim  = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss  : key.client_email,
    scope: 'https://www.googleapis.com/auth/bigquery',
    aud  : 'https://oauth2.googleapis.com/token',
    iat  : now,
    exp  : now + 3600
  }));

  const toSign    = header + '.' + claim;
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(toSign, key.private_key)
  );

  const jwt = toSign + '.' + signature;

  const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method : 'POST',
    contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
  });
  return JSON.parse(resp.getContentText()).access_token;
}

// ---- Public entry points -----------------------------------

// Officer Dashboard entry point — PIN-protected. Internal callers (endOfSemesterArchive*)
// call syncToBigQuery() directly since they are already PIN-gated at entry.
function syncToBigQueryWeb(pin) {
  if (!_checkOfficerPin(pin)) {
    logError('syncToBigQueryWeb', 'Unauthorized attempt — wrong PIN');
    throw new Error('Unauthorized: incorrect officer PIN.');
  }
  syncToBigQuery();
}

function syncToBigQuery() {
  try {
    const cfg = _bqConfig();
    if (!cfg.projectId) throw new Error('bigquery_project_id not set in config tab.');

    const token    = _bqAccessToken();
    const semester = getConfigValue('semester');
    const ss       = getSpreadsheet();

    _syncSheet(ss, 'submissions',       'chore_submissions',  cfg, token, semester);
    _syncSheet(ss, 'fines',             'chore_fines',        cfg, token, semester);
    _syncSheet(ss, 'chore_assignments', 'chore_assignments',  cfg, token, semester);

    logInfo('syncToBigQuery', 'Sync complete — semester: ' + semester);
  } catch (err) {
    logError('syncToBigQuery', err);
    throw err;
  }
}

function initBigQueryTables() {
  try {
    const cfg   = _bqConfig();
    if (!cfg.projectId) throw new Error('bigquery_project_id not configured.');
    const token = _bqAccessToken();

    _createDataset(cfg.projectId, cfg.dataset, token);

    const tables = [
      {
        name: 'chore_submissions',
        fields: [
          'submission_id','member_id','chore_name','week_start','submitted_at',
          'photo_url','photo_hash','exif_date','auto_status','human_status',
          'verified_by','notes','semester','synced_at'
        ]
      },
      {
        name: 'chore_fines',
        fields: [
          'fine_id','member_id','chore_name','week_start','reason',
          'issued_at','issued_by','semester','synced_at'
        ]
      },
      {
        name: 'chore_assignments',
        fields: [
          'assignment_id','member_id','chore_name','group_id',
          'semester','assigned_date','synced_at'
        ]
      }
    ];

    for (const t of tables) {
      _createTable(cfg.projectId, cfg.dataset, t.name,
        t.fields.map(f => ({ name: f, type: 'STRING' })), token);
    }

    logInfo('initBigQueryTables', 'Tables initialized.');
    try { SpreadsheetApp.getUi().alert('BigQuery tables created!'); } catch (_) {}
  } catch (err) {
    logError('initBigQueryTables', err);
    throw err;
  }
}

// ---- Internal helpers --------------------------------------

function _syncSheet(ss, sheetName, tableName, cfg, token, semester) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) { logInfo('_syncSheet', 'Sheet not found: ' + sheetName); return; }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const headers   = data[0].map(String);
  const BATCH     = 500;
  const syncedAt  = new Date().toISOString();
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${cfg.projectId}` +
              `/datasets/${cfg.dataset}/tables/${tableName}/insertAll`;

  for (let start = 1; start < data.length; start += BATCH) {
    const batch = data.slice(start, start + BATCH);
    const rows  = batch.map((row, idx) => {
      const json = {};
      headers.forEach((h, ci) => {
        const v = row[ci];
        json[h] = v instanceof Date ? v.toISOString() : (v !== null && v !== undefined ? String(v) : '');
      });
      json['semester']  = semester;
      json['synced_at'] = syncedAt;
      return { insertId: (json[headers[0]] || (start + idx)) + '_' + semester, json };
    });

    const response = UrlFetchApp.fetch(url, {
      method     : 'POST',
      contentType: 'application/json',
      headers    : { Authorization: 'Bearer ' + token },
      payload    : JSON.stringify({ rows }),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());
    if (result.insertErrors && result.insertErrors.length) {
      logError('_syncSheet', new Error(
        `Insert errors in ${tableName} batch starting ${start}: ` + JSON.stringify(result.insertErrors.slice(0,3))
      ));
    }
  }
}

function _createDataset(projectId, datasetId, token) {
  const url  = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets`;
  const resp = UrlFetchApp.fetch(url, {
    method     : 'POST',
    contentType: 'application/json',
    headers    : { Authorization: 'Bearer ' + token },
    payload    : JSON.stringify({ datasetReference: { projectId, datasetId }, location: 'US' }),
    muteHttpExceptions: true
  });
  const r = JSON.parse(resp.getContentText());
  if (r.error && r.error.code !== 409) throw new Error('Dataset creation failed: ' + JSON.stringify(r.error));
}

function _createTable(projectId, datasetId, tableId, fields, token) {
  const url  = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${datasetId}/tables`;
  const resp = UrlFetchApp.fetch(url, {
    method     : 'POST',
    contentType: 'application/json',
    headers    : { Authorization: 'Bearer ' + token },
    payload    : JSON.stringify({ tableReference: { projectId, datasetId, tableId }, schema: { fields } }),
    muteHttpExceptions: true
  });
  const r = JSON.parse(resp.getContentText());
  if (r.error && r.error.code !== 409) {
    logError('_createTable', new Error(`Table ${tableId} creation failed: ` + JSON.stringify(r.error)));
  }
}
