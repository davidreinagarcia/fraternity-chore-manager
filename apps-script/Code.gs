// ============================================================
// Code.gs — Main controller for Frat Chore Management System
// ============================================================
// Setup: add SPREADSHEET_ID to Script Properties before first run.
// Extensions > Apps Script > Project Settings > Script Properties
// ============================================================

// ---- Helpers -----------------------------------------------

function getSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID not set in Script Properties.');
  return SpreadsheetApp.openById(id);
}

function getConfigValue(key) {
  try {
    const sheet = getSpreadsheet().getSheetByName('config');
    if (!sheet) return null;
    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) return data[i][1];
    }
    return null;
  } catch (e) {
    logError('getConfigValue', e);
    return null;
  }
}

function setConfigValue(key, value) {
  try {
    const sheet = getSpreadsheet().getSheetByName('config');
    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        return;
      }
    }
    sheet.appendRow([key, value]);
  } catch (e) {
    logError('setConfigValue', e);
  }
}

function logError(fnName, err, level) {
  level = level || 'ERROR';
  try {
    const ss = getSpreadsheet();
    let logs = ss.getSheetByName('logs');
    if (!logs) {
      logs = ss.insertSheet('logs');
      logs.appendRow(['timestamp', 'level', 'function', 'message']);
      logs.setFrozenRows(1);
    }
    logs.appendRow([
      new Date().toISOString(),
      level,
      fnName,
      err && err.toString ? err.toString() : String(err)
    ]);
  } catch (inner) {
    console.error('Logger failed: ' + inner);
  }
}

function logInfo(fnName, msg) { logError(fnName, msg, 'INFO'); }

// ---- Column-map helpers (support both old + new member schema) ----

// Build name→index map from a header row.
function _buildColMap(headers) {
  var m = {};
  for (var i = 0; i < headers.length; i++) m[String(headers[i]).trim()] = i;
  return m;
}

// Display name: falls back between new schema (legal_first/preferred_name/legal_last)
// and old schema (name).
function _displayName(row, cm) {
  var n = cm['name'] !== undefined ? String(row[cm['name']] || '') : '';
  if (n) return n;
  var pref  = cm['preferred_name'] !== undefined ? String(row[cm['preferred_name']] || '') : '';
  var first = cm['legal_first']    !== undefined ? String(row[cm['legal_first']]    || '') : '';
  var last  = cm['legal_last']     !== undefined ? String(row[cm['legal_last']]     || '') : '';
  return ((pref || first) + ' ' + last).trim();
}

// Primary email: personal_email → email → GT_email.
function _memberEmail(row, cm) {
  if (cm['personal_email'] !== undefined && row[cm['personal_email']]) return String(row[cm['personal_email']]);
  if (cm['email']          !== undefined && row[cm['email']])          return String(row[cm['email']]);
  if (cm['GT_email']       !== undefined && row[cm['GT_email']])       return String(row[cm['GT_email']]);
  return '';
}

// Status from column map (supports old col-4 fallback).
function _memberStatus(row, cm) {
  if (cm['status'] !== undefined) return String(row[cm['status']] || '');
  return String(row[4] || '');
}

// Returns all member rows as structured objects — schema-agnostic.
function _getMembersStructured() {
  var sheet = getSpreadsheet().getSheetByName('members');
  var data  = sheet.getDataRange().getValues();
  if (data.length < 1) return [];
  var headers = data[0];
  var cm = _buildColMap(headers);
  var extraFields = ['GTID','buzzcard','GT_username','hometown','birthday','shirt_size',
    'dietary_restrictions','car_on_campus','allergies','emergency_contact_name',
    'emergency_contact_phone','campus_orgs','leadership_positions','which_positions',
    'service_orgs','anything_else','major','year'];
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var extra = {};
    extraFields.forEach(function(f) { extra[f] = cm[f] !== undefined ? String(r[cm[f]] || '') : ''; });
    out.push({
      memberId:      String(r[0] || ''),
      bkNumber:      String(r[cm['BK#'] !== undefined ? cm['BK#'] : 1] || ''),
      name:          _displayName(r, cm),
      email:         _memberEmail(r, cm),
      gtEmail:       cm['GT_email']       !== undefined ? String(r[cm['GT_email']]       || '') : '',
      status:        _memberStatus(r, cm),
      pledgeClass:   cm['pledge_class']   !== undefined ? String(r[cm['pledge_class']]   || '') : String(r[5] || ''),
      officerRole:   cm['officer_role']   !== undefined ? String(r[cm['officer_role']]   || '') : '',
      inactiveReason:cm['inactive_reason']!== undefined ? String(r[cm['inactive_reason']]|| '') : '',
      suspension:    cm['suspension']     !== undefined ? !!r[cm['suspension']] : false,
      suspensionReason: cm['suspension_reason'] !== undefined ? String(r[cm['suspension_reason']] || '') : '',
      suspensionEnd:    cm['suspension_end']    !== undefined ? _normDate(r[cm['suspension_end']]) : '',
      academicSuspension: cm['academic_suspension'] !== undefined ? !!r[cm['academic_suspension']] : false,
      probation:     cm['probation']      !== undefined ? !!r[cm['probation']] : false,
      probationType: cm['probation_type'] !== undefined ? String(r[cm['probation_type']] || '') : '',
      formCompleted: cm['form_completed_this_semester'] !== undefined ? r[cm['form_completed_this_semester']] : null,
      anticipatedGraduation: cm['anticipated_graduation'] !== undefined ? String(r[cm['anticipated_graduation']] || '') : '',
      legalFirst:    cm['legal_first']    !== undefined ? String(r[cm['legal_first']]    || '') : '',
      preferredName: cm['preferred_name'] !== undefined ? String(r[cm['preferred_name']] || '') : '',
      legalLast:     cm['legal_last']     !== undefined ? String(r[cm['legal_last']]     || '') : '',
      phone:         cm['phone']          !== undefined ? String(r[cm['phone']]          || '') : '',
      addedDate:     cm['added_date']     !== undefined ? String(r[cm['added_date']]     || '') : String(r[6] || ''),
      mealPlan:      cm['meal_plan']      !== undefined ? String(r[cm['meal_plan']]      || '') : '',
      livingInHouse: cm['living_in_house']!== undefined ? String(r[cm['living_in_house']]|| '') : '',
      roomNumber:    cm['room_number']    !== undefined ? String(r[cm['room_number']]    || '') : '',
      extra: extra,
      _rowNum: i + 1,
      _cm: cm
    });
  }
  return out;
}

// Returns all alumni rows as structured objects, shaped compatibly with
// _getMembersStructured() so the officer UI can treat them uniformly.
function _getAlumniStructured() {
  var sheet = getSpreadsheet().getSheetByName('alumni');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 1) return [];
  var cm = _buildColMap(data[0]);
  var extraFields = ['GTID','buzzcard','GT_username','hometown','birthday','shirt_size',
    'dietary_restrictions','car_on_campus','allergies','emergency_contact_name',
    'emergency_contact_phone','campus_orgs','leadership_positions','which_positions',
    'service_orgs','anything_else','major','year'];
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r.join('').trim()) continue;
    var extra = {};
    extraFields.forEach(function(f) { extra[f] = cm[f] !== undefined ? String(r[cm[f]] || '') : ''; });
    extra['moved_to_alumni_date'] = cm['moved_to_alumni_date'] !== undefined ? String(r[cm['moved_to_alumni_date']] || '') : '';
    extra['notes'] = cm['notes'] !== undefined ? String(r[cm['notes']] || '') : '';
    out.push({
      memberId:    cm['member_id'] !== undefined ? String(r[cm['member_id']] || '') : '',
      bkNumber:    cm['BK#']       !== undefined ? String(r[cm['BK#']]       || '') : '',
      name:        _displayName(r, cm),
      email:       _memberEmail(r, cm),
      gtEmail:     cm['GT_email']  !== undefined ? String(r[cm['GT_email']]  || '') : '',
      pledgeClass: cm['pledge_class'] !== undefined ? String(r[cm['pledge_class']] || '') : '',
      officerRole: cm['officer_role'] !== undefined ? String(r[cm['officer_role']] || '') : '',
      graduatedSemester: cm['graduated_semester'] !== undefined ? String(r[cm['graduated_semester']] || '') : '',
      anticipatedGraduation: cm['anticipated_graduation'] !== undefined ? String(r[cm['anticipated_graduation']] || '') : '',
      legalFirst:    cm['legal_first']    !== undefined ? String(r[cm['legal_first']]    || '') : '',
      preferredName: cm['preferred_name'] !== undefined ? String(r[cm['preferred_name']] || '') : '',
      legalLast:     cm['legal_last']     !== undefined ? String(r[cm['legal_last']]     || '') : '',
      phone:         cm['phone']          !== undefined ? String(r[cm['phone']]          || '') : '',
      extra: extra,
      _rowNum: i + 1
    });
  }
  return out;
}

// Write a single field to a member's row by field name (column header).
function _setMemberField(sheet, memberId, cm, fieldName, value) {
  var colIdx = cm[fieldName];
  if (colIdx === undefined) return false;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(memberId)) {
      sheet.getRange(i + 1, colIdx + 1).setValue(value);
      // Update last_updated if that col exists
      if (cm['last_updated'] !== undefined) sheet.getRange(i + 1, cm['last_updated'] + 1).setValue(new Date().toISOString());
      return true;
    }
  }
  return false;
}

// Write a timestamp to the audit log.
function _logAudit(action, memberId, memberName, performedBy, details) {
  logInfo(action, 'member=' + memberId + ' (' + memberName + ') by=' + performedBy + (details ? ' | ' + details : ''));
}

// Server-side PIN check for destructive officer operations.
// Returns true if the supplied pin matches the stored officer_pin config value.
// If no pin is configured, passes through (allows initial setup without PIN).
function _checkOfficerPin(pin) {
  const stored = String(getConfigValue('officer_pin') || '');
  if (!stored) return true;   // not configured yet — open access during setup
  return String(pin || '') === stored;
}

// Normalize any date value (Date object or string) to 'yyyy-MM-dd'.
// Sheets auto-converts ISO-date strings to Date objects on read, so always
// use this before comparing or storing week_start values.
function _normDate(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd');
  return String(v).trim().substring(0, 10);
}

// ---- Custom Menu -------------------------------------------

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Chore System')
    .addItem('Run Monday Reset', 'runMondayReset')
    .addSeparator()
    .addItem('End of Semester Archive', 'endOfSemesterArchive')
    .addItem('Import Members CSV', 'importMembersFromCSV')
    .addSeparator()
    .addItem('Generate QR Codes (get URL)', 'generateQRCodesDialog')
    .addItem('Open Draft App', 'openDraftApp')
    .addItem('Open Officer Dashboard', 'openOfficerDashboard')
    .addSeparator()
    .addItem('Setup: Create Monday Trigger', 'autoMondayTrigger')
    .addItem('Setup: Init BigQuery Tables', 'initBigQueryTables')
    .addItem('Setup: Create Required Tabs', 'ensureTabsExist')
    .addSeparator()
    .addSubMenu(ui.createMenu('Admin')
      .addItem('Semester Sync (Start of Semester)', 'runSemesterSync')
      .addItem('Migrate From Old Roster (Run Once)', 'migrateFromRosterSheet')
      .addItem('Relink Google Forms (Run Once)', 'relinkForms')
      .addItem('Check Duplicate Members', 'checkDuplicateMembersMenu'))
    .addToUi();
}

function openDraftApp() {
  const url = ScriptApp.getService().getUrl() + '?app=draft&mode=manage';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(
      '<p>Opening Draft App...</p>' +
      '<script>window.open(' + JSON.stringify(url) + ',"_blank");' +
      'setTimeout(function(){google.script.host.close();},500);</script>'
    ).setWidth(300).setHeight(80),
    'Draft App'
  );
}

function openOfficerDashboard() {
  const url = ScriptApp.getService().getUrl() + '?app=officer';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(
      '<p>Opening Officer Dashboard...</p>' +
      '<script>window.open(' + JSON.stringify(url) + ',"_blank");' +
      'setTimeout(function(){google.script.host.close();},500);</script>'
    ).setWidth(300).setHeight(80),
    'Officer Dashboard'
  );
}

function generateQRCodesDialog() {
  const url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(
    'QR Code Generation',
    'Your deployment URL is:\n\n' + url +
    '\n\nCopy this URL, then run:\n  python qr/generate_qr_codes.py\n\nand paste it when prompted.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ---- Router (doGet) ----------------------------------------

function doGet(e) {
  const app = (e.parameter && e.parameter.app) ? e.parameter.app : 'member';
  try {
    let tmpl;
    switch (app) {
      case 'draft':
        tmpl = HtmlService.createTemplateFromFile('DraftApp');
        tmpl.mode = e.parameter.mode || 'display';
        break;
      case 'submit':
        tmpl = HtmlService.createTemplateFromFile('SubmitApp');
        tmpl.choreName = e.parameter.chore ? decodeURIComponent(e.parameter.chore) : '';
        break;
      case 'officer':
        tmpl = HtmlService.createTemplateFromFile('OfficerDashboard');
        break;
      case 'members':
        tmpl = HtmlService.createTemplateFromFile('MemberDirectory');
        break;
      case 'home':
        tmpl = HtmlService.createTemplateFromFile('HomeApp');
        break;
      case 'member':
      default:
        tmpl = HtmlService.createTemplateFromFile('MemberView');
        break;
    }
    tmpl.baseUrl = ScriptApp.getService().getUrl();
    return tmpl.evaluate()
      .setTitle('Frat Chores')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    logError('doGet', err);
    return HtmlService.createHtmlOutput(
      '<h2 style="color:red">Error loading app: ' + err.toString() + '</h2>'
    );
  }
}

// ---- Import Members ----------------------------------------

function importMembersFromCSV() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    'Import Members CSV',
    'Paste the Google Drive File ID of your members CSV.\n' +
    'CSV must have columns: name, email, pledge_class',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;

  const fileId = result.getResponseText().trim();
  if (!fileId) { ui.alert('No file ID provided.'); return; }

  try {
    const content = DriveApp.getFileById(fileId).getBlob().getDataAsString();
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    const parseRow = row => row.split(',').map(c => c.trim().replace(/^"|"$/g, ''));

    let startIdx = 0;
    const firstRow = parseRow(lines[0]);
    if (firstRow[0].toLowerCase() === 'name' || firstRow[0].toLowerCase() === 'full name') startIdx = 1;

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName('members');
    const existing = sheet.getDataRange().getValues();

    // email -> row index (1-based, skipping header row 1)
    const emailMap = {};
    for (let i = 1; i < existing.length; i++) emailMap[existing[i][3]] = i + 1; // email is col 3 (0-indexed)

    const csvEmails = new Set();
    let added = 0, updated = 0;

    for (let i = startIdx; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      if (cols.length < 2 || !cols[1]) continue;
      const [name, email, pledgeClass, bkNumber] = [cols[0], cols[1], cols[2] || '', cols[3] || ''];
      csvEmails.add(email);

      if (emailMap[email]) {
        sheet.getRange(emailMap[email], 3).setValue(name);        // name col
        sheet.getRange(emailMap[email], 5).setValue('active');    // status col
        sheet.getRange(emailMap[email], 6).setValue(pledgeClass); // pledge_class col
        if (bkNumber) sheet.getRange(emailMap[email], 2).setValue(bkNumber); // bk_number col
        updated++;
      } else {
        const mid = 'M' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
        sheet.appendRow([mid, bkNumber, name, email, 'active', pledgeClass, new Date().toISOString()]);
        added++;
      }
    }

    // Deactivate members not in CSV
    const fresh = sheet.getDataRange().getValues();
    let deactivated = 0;
    for (let i = 1; i < fresh.length; i++) {
      if (!csvEmails.has(fresh[i][3]) && fresh[i][4] === 'active') { // email col 3, status col 4
        sheet.getRange(i + 1, 5).setValue('inactive'); // status col 5 (1-indexed)
        deactivated++;
      }
    }

    logInfo('importMembersFromCSV', `Added:${added} Updated:${updated} Deactivated:${deactivated}`);
    ui.alert(`Import complete!\n\nAdded: ${added}\nUpdated: ${updated}\nDeactivated: ${deactivated}`);
  } catch (err) {
    logError('importMembersFromCSV', err);
    ui.alert('Error: ' + err.toString());
  }
}

// Web-app-safe import — called from OfficerDashboard with a Drive file ID directly.
function importMembersFromCSVWeb(fileId, pin) {
  if (!_checkOfficerPin(pin)) {
    logError('importMembersFromCSVWeb', 'Unauthorized attempt — wrong PIN');
    return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  }
  try {
    if (!fileId || !fileId.trim()) return JSON.stringify({ success: false, error: 'No file ID provided.' });
    const content = DriveApp.getFileById(fileId.trim()).getBlob().getDataAsString();
    const lines   = content.split(/\r?\n/).filter(function(l) { return l.trim(); });
    const parseRow = function(row) { return row.split(',').map(function(c) { return c.trim().replace(/^"|"$/g, ''); }); };

    let startIdx = 0;
    const first  = parseRow(lines[0]);
    if (first[0].toLowerCase() === 'name' || first[0].toLowerCase() === 'full name') startIdx = 1;

    const ss     = getSpreadsheet();
    const sheet  = ss.getSheetByName('members');
    const existing = sheet.getDataRange().getValues();
    const emailMap = {};
    for (let i = 1; i < existing.length; i++) emailMap[existing[i][3]] = i + 1; // email col 3

    const csvEmails = new Set();
    let added = 0, updated = 0;
    for (let i = startIdx; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      if (cols.length < 2 || !cols[1]) continue;
      const name = cols[0], email = cols[1], pledgeClass = cols[2] || '', bkNumber = cols[3] || '';
      csvEmails.add(email);
      if (emailMap[email]) {
        sheet.getRange(emailMap[email], 3).setValue(name);
        sheet.getRange(emailMap[email], 5).setValue('active');
        sheet.getRange(emailMap[email], 6).setValue(pledgeClass);
        if (bkNumber) sheet.getRange(emailMap[email], 2).setValue(bkNumber);
        updated++;
      } else {
        const mid = 'M' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
        sheet.appendRow([mid, bkNumber, name, email, 'active', pledgeClass, new Date().toISOString()]);
        added++;
      }
    }
    const fresh = sheet.getDataRange().getValues();
    let deactivated = 0;
    for (let i = 1; i < fresh.length; i++) {
      if (!csvEmails.has(fresh[i][3]) && fresh[i][4] === 'active') {
        sheet.getRange(i + 1, 5).setValue('inactive');
        deactivated++;
      }
    }
    logInfo('importMembersFromCSVWeb', 'Added:' + added + ' Updated:' + updated + ' Deactivated:' + deactivated);
    return JSON.stringify({ success: true, added: added, updated: updated, deactivated: deactivated });
  } catch (err) {
    logError('importMembersFromCSVWeb', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- Monday Reset ------------------------------------------

// Called by the time-based trigger and spreadsheet menu — no PIN required
// because access is controlled by who has edit access to the spreadsheet.
function runMondayReset() {
  try {
    const ss          = getSpreadsheet();
    const semester    = getConfigValue('semester');
    const weekStart   = _normDate(getConfigValue('week_start')); // normalize: Sheets may return a Date object
    const emailsRaw   = getConfigValue('officer_emails') || '';
    const fineAmount  = Number(getConfigValue('fine_amount') || 5);

    const subSheet    = ss.getSheetByName('submissions');
    const asgSheet    = ss.getSheetByName('chore_assignments');
    const finesSheet  = ss.getSheetByName('fines');
    const memSheet    = ss.getSheetByName('members');

    const submissions   = subSheet.getDataRange().getValues();
    const assignments   = asgSheet.getDataRange().getValues();
    const membersStructured = _getMembersStructured();

    // Members that passed for this week
    const passed = new Set();
    for (let i = 1; i < submissions.length; i++) {
      const r = submissions[i];
      if (_normDate(r[3]) === weekStart &&
          ((r[8] === 'passed' && r[9] !== 'failed') || r[9] === 'verified')) {
        passed.add(r[1] + '|' + r[2]);
      }
    }

    // Active member lookup
    const activeMems = new Set();
    const memName = {};
    for (const m of membersStructured) {
      if (m.status === 'active') {
        activeMems.add(m.memberId);
        memName[m.memberId] = m.name;
      }
    }

    // Find delinquents
    const fineList = [];
    for (let i = 1; i < assignments.length; i++) {
      const r = assignments[i];
      if (r[4] !== semester) continue;
      if (!activeMems.has(r[1])) continue;
      if (!passed.has(r[1] + '|' + r[2])) {
        fineList.push({ memberId: r[1], memberName: memName[r[1]] || r[1], choreName: r[2] });
      }
    }

    // Write fines
    for (const f of fineList) {
      finesSheet.appendRow([
        'F' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase(),
        f.memberId, f.choreName, weekStart,
        'Missed chore submission', new Date().toISOString(), 'system'
      ]);
    }

    // Ghost detection — must run BEFORE submissions are cleared so it can read current-week data
    const ghostAlerts = runGhostDetection();

    // Email officers (fines + ghost alerts in one email)
    if ((fineList.length > 0 || ghostAlerts.length > 0) && emailsRaw) {
      const emailList = emailsRaw.split(',').map(e => e.trim()).filter(Boolean);
      const rows = fineList.map(f =>
        `<tr><td style="padding:6px 12px">${f.memberName}</td>` +
        `<td style="padding:6px 12px">${f.choreName}</td>` +
        `<td style="padding:6px 12px">${weekStart}</td>` +
        `<td style="padding:6px 12px;text-align:center">$${fineAmount}</td></tr>`
      ).join('');
      const ghostSection = ghostAlerts.length > 0
        ? `<h3 style="color:#b45309;margin-top:28px">⚠️ Ghost Alert — ${ghostAlerts.length} brother(s) with no submission this week</h3>
           <p style="font-size:13px;color:#444">These active members have zero submissions on record and may need to be contacted:</p>
           <ul style="font-size:14px">${ghostAlerts.map(g => `<li><strong>${g.name}</strong> — ${g.chore}</li>`).join('')}</ul>`
        : '';
      const html = `<html><body style="font-family:Arial,sans-serif">
        <h2 style="color:#093D20">Chore Fine List — Week of ${weekStart}</h2>
        ${fineList.length > 0 ? `
        <table border="1" cellspacing="0" cellpadding="0"
               style="border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#093D20;color:#FFB71D">
              <th style="padding:8px 12px">Member</th>
              <th style="padding:8px 12px">Chore</th>
              <th style="padding:8px 12px">Week</th>
              <th style="padding:8px 12px">Fine</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p><strong>Total fines:</strong> ${fineList.length} ($${fineList.length * fineAmount})</p>` : '<p style="color:#666">No fines issued this week.</p>'}
        ${ghostSection}
        <p style="color:#888;font-size:12px">Sent automatically by the Chore Management System.</p>
        </body></html>`;
      GmailApp.sendEmail(
        emailList.join(','),
        'Chore Fine List — Week of ' + weekStart,
        fineList.map(f => `${f.memberName}: ${f.choreName}`).join('\n') +
          (ghostAlerts.length ? '\n\nGhost alert: ' + ghostAlerts.map(g => g.name + ' (' + g.chore + ')').join(', ') : ''),
        { htmlBody: html }
      );
    }

    // Clear submissions (keep header row)
    const lastRow = subSheet.getLastRow();
    if (lastRow > 1) subSheet.deleteRows(2, lastRow - 1);

    // Advance week_start by 7 days
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    const nextMonday = Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd');
    setConfigValue('week_start', nextMonday);

    // Refresh weekly_status tab
    _refreshWeeklyStatus();

    logInfo('runMondayReset', `Fines:${fineList.length} | Next week:${nextMonday} | Ghosts:${ghostAlerts.length}`);

    try {
      let msg = `Monday Reset Complete!\n\nFines issued: ${fineList.length}\nNext week: ${nextMonday}`;
      if (ghostAlerts.length) msg += `\n\n⚠️ Ghost alert: ${ghostAlerts.length} member(s) with no submissions this week.`;
      SpreadsheetApp.getUi().alert(msg);
    } catch (_) { /* headless trigger call */ }

  } catch (err) {
    logError('runMondayReset', err);
    throw err;
  }
}

// Officer Dashboard entry point — PIN-protected wrapper around runMondayReset().
function runMondayResetWeb(pin) {
  if (!_checkOfficerPin(pin)) {
    logError('runMondayResetWeb', 'Unauthorized attempt — wrong PIN');
    throw new Error('Unauthorized: incorrect officer PIN.');
  }
  runMondayReset();
}

// ---- End of Semester Archive --------------------------------

// Web-app-safe version (no UI dialogs) — called from OfficerDashboard.
// The confirmation step is handled by the browser's confirm() in the HTML.
function endOfSemesterArchiveWeb(pin) {
  if (!_checkOfficerPin(pin)) {
    logError('endOfSemesterArchiveWeb', 'Unauthorized attempt — wrong PIN');
    return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  }
  try {
    var ss = getSpreadsheet();

    // Check for outstanding fines
    var finesSheet = ss.getSheetByName('fines');
    var outstandingFines = 0;
    if (finesSheet && finesSheet.getLastRow() > 1) {
      outstandingFines = finesSheet.getLastRow() - 1;
    }

    syncToBigQuery();

    ['chore_assignments', 'submissions', 'fines', 'weekly_status'].forEach(function(name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) return;
      var last = sheet.getLastRow();
      if (last > 1) sheet.deleteRows(2, last - 1);
    });

    // Reset form_completed_this_semester for all active/inactive members
    var memSheet = ss.getSheetByName('members');
    if (memSheet) {
      var memData = memSheet.getDataRange().getValues();
      var cm = _buildColMap(memData[0]);
      var fcCol = cm['form_completed_this_semester'];
      var statusCol = cm['status'] !== undefined ? cm['status'] : 4;
      if (fcCol !== undefined) {
        for (var i = 1; i < memData.length; i++) {
          var st = String(memData[i][statusCol] || '');
          if (st === 'active' || st === 'inactive') {
            memSheet.getRange(i + 1, fcCol + 1).setValue(false);
          }
        }
      }
    }

    var semester = getConfigValue('semester') || 'unknown';
    logInfo('endOfSemesterArchiveWeb', 'Semester ' + semester + ' archived via web app. Outstanding fines at time of archive: ' + outstandingFines);
    return JSON.stringify({ success: true, outstandingFinesAtArchive: outstandingFines });
  } catch (err) {
    logError('endOfSemesterArchiveWeb', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Spreadsheet-menu version (shows UI dialogs) — called from the custom menu.
function endOfSemesterArchive() {
  var ui = SpreadsheetApp.getUi();
  var ss = getSpreadsheet();

  // Check outstanding fines first
  var finesSheet = ss.getSheetByName('fines');
  var outstanding = finesSheet && finesSheet.getLastRow() > 1 ? finesSheet.getLastRow() - 1 : 0;
  var fineAmount  = Number(getConfigValue('fine_amount') || 5);
  var warnMsg = outstanding > 0
    ? 'WARNING: ' + outstanding + ' members have outstanding fines totaling $' + (outstanding * fineAmount) + '.\n\n'
    : '';

  var ans = ui.alert(
    'End of Semester Archive',
    warnMsg +
    'This will:\n1. Push all data to BigQuery\n2. Clear assignments, submissions, fines, weekly_status\n3. Reset form completion flags\n4. Keep members intact\n\nContinue?',
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  try {
    syncToBigQuery();

    ['chore_assignments', 'submissions', 'fines', 'weekly_status'].forEach(function(name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) return;
      var last = sheet.getLastRow();
      if (last > 1) sheet.deleteRows(2, last - 1);
    });

    // Reset form_completed_this_semester
    var memSheet = ss.getSheetByName('members');
    if (memSheet) {
      var memData = memSheet.getDataRange().getValues();
      var cm = _buildColMap(memData[0]);
      var fcCol = cm['form_completed_this_semester'];
      var statusCol = cm['status'] !== undefined ? cm['status'] : 4;
      if (fcCol !== undefined) {
        for (var i = 1; i < memData.length; i++) {
          var st = String(memData[i][statusCol] || '');
          if (st === 'active' || st === 'inactive') memSheet.getRange(i + 1, fcCol + 1).setValue(false);
        }
      }
    }

    var semester = getConfigValue('semester') || 'unknown';
    logInfo('endOfSemesterArchive', 'Semester ' + semester + ' archived.');
    ui.alert('Semester archived. Ready for new assignments.');
  } catch (err) {
    logError('endOfSemesterArchive', err);
    ui.alert('Error: ' + err.toString());
  }
}

// ---- Trigger Setup -----------------------------------------

function autoMondayTrigger() {
  const existing = ScriptApp.getProjectTriggers();
  for (const t of existing) {
    if (t.getHandlerFunction() === 'runMondayReset') {
      try { SpreadsheetApp.getUi().alert('Trigger already exists.'); } catch (_) {}
      return;
    }
  }
  ScriptApp.newTrigger('runMondayReset')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(6)
    .inTimezone('America/New_York')
    .create();
  logInfo('autoMondayTrigger', 'Trigger created.');
  try { SpreadsheetApp.getUi().alert('Monday 6am ET trigger created!'); } catch (_) {}
}

// ---- Assignments --------------------------------------------

function getAssignments() {
  try {
    const ss        = getSpreadsheet();
    const semester  = getConfigValue('semester');
    const asgData   = ss.getSheetByName('chore_assignments').getDataRange().getValues();

    const memMap = {};
    const bkMap = {};
    _getMembersStructured().forEach(function(m) { memMap[m.memberId] = m.name; bkMap[m.memberId] = m.bkNumber; });

    const grouped = {};
    for (let i = 1; i < asgData.length; i++) {
      const r = asgData[i];
      if (r[4] !== semester) continue;
      if (!grouped[r[2]]) grouped[r[2]] = [];
      grouped[r[2]].push({
        assignmentId: r[0],
        memberId: r[1],
        memberName: memMap[r[1]] || r[1],
        bkNumber: bkMap[r[1]] || '',
        groupId: r[3]
      });
    }
    return JSON.stringify(grouped);
  } catch (err) {
    logError('getAssignments', err);
    return JSON.stringify({ error: err.toString() });
  }
}

function saveAssignment(memberId, choreName) {
  try {
    const ss       = getSpreadsheet();
    const semester = getConfigValue('semester');
    const sheet    = ss.getSheetByName('chore_assignments');
    const rows     = sheet.getDataRange().getValues();

    // Duplicate guard
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === memberId && rows[i][2] === choreName && rows[i][4] === semester) {
        return JSON.stringify({ success: false, message: 'Already assigned.' });
      }
    }

    const aid = 'A' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
    const gid = 'G' + choreName.replace(/[^A-Za-z0-9]/g,'').substring(0,8) + '_' + semester.replace(/\s/g,'');
    sheet.appendRow([aid, memberId, choreName, gid, semester, new Date().toISOString()]);

    return JSON.stringify({
      success: true,
      ratios: JSON.parse(getChoreRatios()),
      counts: _getAssignmentCounts(semester)
    });
  } catch (err) {
    logError('saveAssignment', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

function _getChoreRatiosData() {
  try {
    const files = DriveApp.getFilesByName('chore_ratios.json');
    if (files.hasNext()) return JSON.parse(files.next().getBlob().getDataAsString());
  } catch (_) {}
  // Fallback: read from script source file in Drive (rare)
  return { chores: [] };
}

function _getAssignmentCounts(semester) {
  const data = getSpreadsheet().getSheetByName('chore_assignments').getDataRange().getValues();
  const counts = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][4] === semester) counts[data[i][2]] = (counts[data[i][2]] || 0) + 1;
  }
  return counts;
}

function getChoreRatios() {
  try {
    const semester = getConfigValue('semester');
    const data     = _getChoreRatiosData();
    const counts   = _getAssignmentCounts(semester);
    const result   = (data.chores || []).map(c => ({
      ...c,
      filled: counts[c.name] || 0,
      available: c.people - (counts[c.name] || 0)
    }));
    return JSON.stringify(result);
  } catch (err) {
    logError('getChoreRatios', err);
    return JSON.stringify({ error: err.toString() });
  }
}

function autoSplitMembers() {
  try {
    const ss         = getSpreadsheet();
    const semester   = getConfigValue('semester');
    const asgData    = ss.getSheetByName('chore_assignments').getDataRange().getValues();

    const active = [];
    _getMembersStructured().forEach(function(m) {
      if (m.status === 'active' && !m.suspension && !m.academicSuspension) active.push({ id: m.memberId, name: m.name });
    });

    const alreadyAssigned = new Set();
    for (let i = 1; i < asgData.length; i++) {
      if (asgData[i][4] === semester) alreadyAssigned.add(asgData[i][1]);
    }

    const unassigned = active.filter(m => !alreadyAssigned.has(m.id));
    if (!unassigned.length) return JSON.stringify({ success: false, message: 'All members already assigned.' });

    // Fisher-Yates shuffle
    for (let i = unassigned.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unassigned[i], unassigned[j]] = [unassigned[j], unassigned[i]];
    }

    const ratiosData = _getChoreRatiosData();
    const counts = _getAssignmentCounts(semester);

    // Build open slots list sorted: largest chores first
    const choresSorted = (ratiosData.chores || []).slice().sort((a, b) => b.people - a.people);
    const slots = [];
    for (const c of choresSorted) {
      const open = c.people - (counts[c.name] || 0);
      for (let i = 0; i < open; i++) slots.push(c.name);
    }

    const proposals = [];
    let mi = 0;
    for (let si = 0; si < slots.length && mi < unassigned.length; si++, mi++) {
      proposals.push({ memberId: unassigned[mi].id, memberName: unassigned[mi].name, choreName: slots[si] });
    }

    // Overflow members → largest chores
    const overflow = ['Chapter Setup/Cleanup', 'Living Room/Chapter Room Cleanup', 'Monday Dinner Cleanup'];
    while (mi < unassigned.length) {
      proposals.push({
        memberId: unassigned[mi].id,
        memberName: unassigned[mi].name,
        choreName: overflow[mi % overflow.length]
      });
      mi++;
    }

    return JSON.stringify({ success: true, proposals, count: proposals.length });
  } catch (err) {
    logError('autoSplitMembers', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

function saveAutoSplitProposals(proposalsJson, pin) {
  if (!_checkOfficerPin(pin)) {
    logError('saveAutoSplitProposals', 'Unauthorized attempt — wrong PIN');
    return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  }
  try {
    const proposals = JSON.parse(proposalsJson);
    const semester  = getConfigValue('semester');
    const sheet     = getSpreadsheet().getSheetByName('chore_assignments');
    for (const p of proposals) {
      const aid = 'A' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
      const gid = 'G' + p.choreName.replace(/[^A-Za-z0-9]/g,'').substring(0,8) + '_' + semester.replace(/\s/g,'');
      sheet.appendRow([aid, p.memberId, p.choreName, gid, semester, new Date().toISOString()]);
    }
    return JSON.stringify({ success: true, saved: proposals.length });
  } catch (err) {
    logError('saveAutoSplitProposals', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- Weekly Status ------------------------------------------

function getWeeklyStatus() {
  try {
    const ss       = getSpreadsheet();
    const semester = getConfigValue('semester');
    const weekStart = _normDate(getConfigValue('week_start'));

    const asgData  = ss.getSheetByName('chore_assignments').getDataRange().getValues();
    const subData  = ss.getSheetByName('submissions').getDataRange().getValues();

    const memMap = {};
    _getMembersStructured().forEach(function(m) { memMap[m.memberId] = m.name; });

    // Group assignments by chore
    const choreMap = {};
    for (let i = 1; i < asgData.length; i++) {
      const r = asgData[i];
      if (r[4] !== semester) continue;
      if (!choreMap[r[2]]) choreMap[r[2]] = [];
      choreMap[r[2]].push({ memberId: r[1], memberName: memMap[r[1]] || r[1] });
    }

    // Index submissions by memberId|choreName
    const subMap = {};
    for (let i = 1; i < subData.length; i++) {
      const r = subData[i];
      subMap[r[1] + '|' + r[2]] = {
        submissionId: r[0], submittedAt: r[4], photoUrl: r[5],
        autoStatus: r[8], humanStatus: r[9], verifiedBy: r[10], notes: r[11]
      };
    }

    const status = Object.entries(choreMap).map(([choreName, mems]) => {
      const memberStatuses = mems.map(m => {
        const sub = subMap[m.memberId + '|' + choreName] || null;
        return {
          ...m,
          submitted: !!sub,
          submissionId: sub ? sub.submissionId : null,
          autoStatus: sub ? sub.autoStatus : null,
          humanStatus: sub ? sub.humanStatus : 'pending',
          photoUrl: sub ? sub.photoUrl : null,
          submittedAt: sub ? sub.submittedAt : null
        };
      });
      return {
        choreName,
        members: memberStatuses,
        submitted: memberStatuses.some(m => m.submitted),
        allVerified: memberStatuses.every(m => m.humanStatus === 'verified')
      };
    });

    return JSON.stringify({ status, weekStart, semester });
  } catch (err) {
    logError('getWeeklyStatus', err);
    return JSON.stringify({ error: err.toString() });
  }
}

function _refreshWeeklyStatus() {
  try {
    const ss    = getSpreadsheet();
    const sheet = ss.getSheetByName('weekly_status');
    if (!sheet) return;
    const last = sheet.getLastRow();
    if (last > 1) sheet.deleteRows(2, last - 1);
    const data = JSON.parse(getWeeklyStatus());
    for (const c of data.status) {
      sheet.appendRow([
        c.choreName,
        c.members.map(m => m.memberName).join(', '),
        c.submitted ? 'Yes' : 'No',
        c.members.map(m => m.autoStatus || '').join(', '),
        c.members.map(m => m.humanStatus || 'pending').join(', ')
      ]);
    }
  } catch (err) {
    logError('_refreshWeeklyStatus', err);
  }
}

function getSubmissionPhoto(submissionId) {
  try {
    const data = getSpreadsheet().getSheetByName('submissions').getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === submissionId) return JSON.stringify({ photoUrl: data[i][5] });
    }
    return JSON.stringify({ photoUrl: null });
  } catch (err) {
    logError('getSubmissionPhoto', err);
    return JSON.stringify({ error: err.toString() });
  }
}

function updateHumanVerification(submissionId, status, verifiedBy, notes, pin) {
  if (!_checkOfficerPin(pin)) {
    logError('updateHumanVerification', 'Unauthorized attempt — wrong PIN');
    return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  }
  try {
    const sheet = getSpreadsheet().getSheetByName('submissions');
    const data  = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === submissionId) {
        sheet.getRange(i + 1, 10).setValue(status);
        sheet.getRange(i + 1, 11).setValue(verifiedBy || '');
        sheet.getRange(i + 1, 12).setValue(notes || '');
        logInfo('updateHumanVerification', `${submissionId} → ${status} by ${verifiedBy}`);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, message: 'Submission not found.' });
  } catch (err) {
    logError('updateHumanVerification', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

function flagSubmission(submissionId, flagNote) {
  try {
    const sheet = getSpreadsheet().getSheetByName('submissions');
    const data  = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === submissionId) {
        const prev = data[i][11] || '';
        sheet.getRange(i + 1, 9).setValue('flagged');
        sheet.getRange(i + 1, 12).setValue(prev + (prev ? ' | ' : '') + 'FLAGGED BY MEMBER: ' + flagNote);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, message: 'Submission not found.' });
  } catch (err) {
    logError('flagSubmission', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

function getMemberStats() {
  try {
    const ss       = getSpreadsheet();
    const semester = getConfigValue('semester');
    const subData  = ss.getSheetByName('submissions').getDataRange().getValues();
    const fineData = ss.getSheetByName('fines').getDataRange().getValues();
    const asgData  = ss.getSheetByName('chore_assignments').getDataRange().getValues();

    const stats = {};
    _getMembersStructured().forEach(function(m) {
      if (m.status === 'active') stats[m.memberId] = { name: m.name, subs: 0, fines: 0, assignments: 0 };
    });

    for (let i = 1; i < asgData.length; i++) {
      if (asgData[i][4] === semester && stats[asgData[i][1]]) stats[asgData[i][1]].assignments++;
    }
    for (let i = 1; i < subData.length; i++) {
      const r = subData[i];
      if (stats[r[1]] && ((r[8] === 'passed' && r[9] !== 'failed') || r[9] === 'verified')) stats[r[1]].subs++;
    }
    for (let i = 1; i < fineData.length; i++) {
      if (stats[fineData[i][1]]) stats[fineData[i][1]].fines++;
    }

    return JSON.stringify(Object.values(stats).map(m => ({
      name: m.name,
      submissions: m.subs,
      fines: m.fines,
      assignments: m.assignments,
      complianceRate: m.assignments > 0 ? Math.round((m.subs / m.assignments) * 100) : 100
    })));
  } catch (err) {
    logError('getMemberStats', err);
    return JSON.stringify({ error: err.toString() });
  }
}

function getActiveMembers() {
  try {
    var active = _getMembersStructured().filter(function(m) { return m.status === 'active'; })
      .map(function(m) { return { id: m.memberId, name: m.name, email: m.email, pledgeClass: m.pledgeClass, bkNumber: m.bkNumber }; });
    return JSON.stringify(active);
  } catch (err) {
    logError('getActiveMembers', err);
    return JSON.stringify([]);
  }
}

function getConfigPin() {
  try { return String(getConfigValue('officer_pin') || '1234'); }
  catch (_) { return '1234'; }
}

function getShowPhotos() {
  try { return String(getConfigValue('show_photos_in_member_view') || 'true'); }
  catch (_) { return 'true'; }
}

// ---- Members assigned to a specific chore ------------------

function getChoreMembers(choreName) {
  try {
    const ss       = getSpreadsheet();
    const semester = getConfigValue('semester');
    const asgData  = ss.getSheetByName('chore_assignments').getDataRange().getValues();
    const memMap   = {};
    _getMembersStructured().forEach(function(m) { memMap[m.memberId] = m.name; });

    const members = [];
    for (let i = 1; i < asgData.length; i++) {
      const r = asgData[i];
      if (r[4] === semester && r[2] === choreName) {
        members.push({ id: r[1], name: memMap[r[1]] || r[1] });
      }
    }
    return JSON.stringify(members);
  } catch (err) {
    logError('getChoreMembers', err);
    return JSON.stringify([]);
  }
}

// ============================================================
// Admin Dashboard — new functions
// ============================================================

// ---- Chore Manager -----------------------------------------

// Returns raw chore_ratios.json data (no fill-count enrichment).
function getChoreRatiosRaw() {
  try {
    const data = _getChoreRatiosData();
    return JSON.stringify({ success: true, data: data });
  } catch (err) {
    logError('getChoreRatiosRaw', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Overwrites chore_ratios.json with the supplied array of {name, people} objects.
function saveChoreRatios(chorePairsJson) {
  try {
    const chores = JSON.parse(chorePairsJson);
    const jsonStr = JSON.stringify({ chores: chores }, null, 2);
    const files = DriveApp.getFilesByName('chore_ratios.json');
    if (files.hasNext()) {
      files.next().setContent(jsonStr);
    } else {
      DriveApp.createFile('chore_ratios.json', jsonStr, 'application/json');
    }
    logInfo('saveChoreRatios', 'Saved ' + chores.length + ' chores.');
    return JSON.stringify({ success: true });
  } catch (err) {
    logError('saveChoreRatios', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- Member Manager ----------------------------------------

// Returns all members (all statuses) from the members sheet.
function getMembers() {
  try {
    var members = _getMembersStructured().map(function(m) {
      return {
        memberId: m.memberId, bkNumber: m.bkNumber, name: m.name,
        email: m.email, gtEmail: m.gtEmail, status: m.status, pledgeClass: m.pledgeClass,
        officerRole: m.officerRole, inactiveReason: m.inactiveReason,
        suspension: m.suspension, academicSuspension: m.academicSuspension,
        probation: m.probation, probationType: m.probationType,
        formCompleted: m.formCompleted, addedDate: m.addedDate
      };
    });
    return JSON.stringify({ success: true, data: members });
  } catch (err) {
    logError('getMembers', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Adds a new member.
// Accepts new-schema fields (legalFirst, preferredName, legalLast, personalEmail, gtEmail, phone)
// OR old-style (name as legalFirst, email as personalEmail) for backwards compat.
function addMember(legalFirst, legalLast, preferredName, personalEmail, gtEmail, phone, pledgeClass, bkNumber, status) {
  try {
    if (!legalFirst || !personalEmail) return JSON.stringify({ success: false, error: 'First name and email are required.' });
    var sheet = getSpreadsheet().getSheetByName('members');
    if (!sheet) return JSON.stringify({ success: false, error: 'Members sheet not found.' });
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var cm = _buildColMap(headers);
    var emailColOld = cm['email'] !== undefined ? cm['email'] : 3;
    var emailColNew = cm['personal_email'];
    for (var i = 1; i < data.length; i++) {
      var existingEmail = emailColNew !== undefined ? String(data[i][emailColNew] || '') : String(data[i][emailColOld] || '');
      if (existingEmail.toLowerCase() === String(personalEmail).toLowerCase()) {
        return JSON.stringify({ success: false, error: 'A member with this email already exists.' });
      }
    }
    var memberStatus = (status === 'associate' || status === 'inactive') ? status : 'active';
    var mid = 'M' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();

    // Build new row using column map
    var isNewSchema = cm['legal_first'] !== undefined;
    if (isNewSchema) {
      var newRow = new Array(headers.length).fill('');
      newRow[0] = mid;
      if (cm['BK#'] !== undefined)             newRow[cm['BK#']]             = bkNumber || '';
      if (cm['legal_first'] !== undefined)     newRow[cm['legal_first']]     = legalFirst;
      if (cm['preferred_name'] !== undefined)  newRow[cm['preferred_name']]  = preferredName || '';
      if (cm['legal_last'] !== undefined)      newRow[cm['legal_last']]      = legalLast || '';
      if (cm['phone'] !== undefined)           newRow[cm['phone']]           = phone || '';
      if (cm['personal_email'] !== undefined)  newRow[cm['personal_email']]  = personalEmail;
      if (cm['GT_email'] !== undefined)        newRow[cm['GT_email']]        = gtEmail || '';
      if (cm['status'] !== undefined)          newRow[cm['status']]          = memberStatus;
      if (cm['pledge_class'] !== undefined)    newRow[cm['pledge_class']]    = pledgeClass || '';
      if (cm['added_date'] !== undefined)      newRow[cm['added_date']]      = new Date().toISOString();
      if (cm['last_updated'] !== undefined)    newRow[cm['last_updated']]    = new Date().toISOString();
      sheet.appendRow(newRow);
    } else {
      // Old schema fallback
      sheet.appendRow([mid, bkNumber || '', legalFirst + (legalLast ? ' ' + legalLast : ''), personalEmail, memberStatus, pledgeClass || '', new Date().toISOString()]);
    }
    logInfo('addMember', 'Added: ' + personalEmail + ' (' + memberStatus + ')');
    return JSON.stringify({ success: true, memberId: mid });
  } catch (err) {
    logError('addMember', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Toggles a member's status.
function updateMemberStatus(memberId, status) {
  try {
    var validStatuses = ['active','inactive','associate','alumni'];
    if (validStatuses.indexOf(status) === -1) return JSON.stringify({ success: false, error: 'Invalid status value.' });
    var sheet = getSpreadsheet().getSheetByName('members');
    var data  = sheet.getDataRange().getValues();
    var cm    = _buildColMap(data[0]);
    var statusColIdx = cm['status'] !== undefined ? cm['status'] : 4;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(memberId)) {
        sheet.getRange(i + 1, statusColIdx + 1).setValue(status);
        if (cm['last_updated'] !== undefined) sheet.getRange(i + 1, cm['last_updated'] + 1).setValue(new Date().toISOString());
        logInfo('updateMemberStatus', memberId + ' → ' + status);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) {
    logError('updateMemberStatus', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Permanently deletes a member row by memberId.
function deleteMember(memberId) {
  try {
    var sheet = getSpreadsheet().getSheetByName('members');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === memberId) {
        sheet.deleteRow(i + 1);
        logInfo('deleteMember', 'Deleted: ' + memberId);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) {
    logError('deleteMember', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- Config Editor -----------------------------------------

// Returns all key-value rows from the config sheet.
function getConfig() {
  try {
    var data = getSpreadsheet().getSheetByName('config').getDataRange().getValues();
    var config = [];
    for (var i = 1; i < data.length; i++) {  // skip header row (BUG 3)
      if (data[i][0]) {
        var val = data[i][1];
        if (val instanceof Date) val = Utilities.formatDate(val, 'America/New_York', 'yyyy-MM-dd');  // BUG 4: normalize date cells
        config.push({ key: String(data[i][0]), value: val });
      }
    }
    return JSON.stringify({ success: true, data: config });
  } catch (err) {
    logError('getConfig', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Writes a single config key-value pair back to the config sheet.
function saveConfig(key, value) {
  try {
    setConfigValue(key, value);
    logInfo('saveConfig', key + ' = ' + value);
    return JSON.stringify({ success: true });
  } catch (err) {
    logError('saveConfig', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- Semester Tools: CSV text import -----------------------

// Accepts raw CSV text (not a Drive file ID) pasted directly from the UI.
function importMembersFromCSVText(csvText, pin) {
  if (!_checkOfficerPin(pin)) {
    logError('importMembersFromCSVText', 'Unauthorized attempt — wrong PIN');
    return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  }
  try {
    if (!csvText || !csvText.trim()) return JSON.stringify({ success: false, error: 'No CSV text provided.' });
    var lines = csvText.split(/\r?\n/).filter(function(l) { return l.trim(); });
    var parseRow = function(row) { return row.split(',').map(function(c) { return c.trim().replace(/^"|"$/g, ''); }); };

    var startIdx = 0;
    var first = parseRow(lines[0]);
    if (first[0].toLowerCase() === 'name' || first[0].toLowerCase() === 'full name') startIdx = 1;

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('members');
    var existing = sheet.getDataRange().getValues();
    var emailMap = {};
    for (var i = 1; i < existing.length; i++) emailMap[existing[i][3]] = i + 1; // email col 3

    var csvEmails = new Set();
    var added = 0, updated = 0;
    for (var j = startIdx; j < lines.length; j++) {
      var cols = parseRow(lines[j]);
      if (cols.length < 2 || !cols[1]) continue;
      var name = cols[0], email = cols[1], pledgeClass = cols[2] || '', bkNumber = cols[3] || '';
      csvEmails.add(email);
      if (emailMap[email]) {
        sheet.getRange(emailMap[email], 3).setValue(name);
        sheet.getRange(emailMap[email], 5).setValue('active');
        sheet.getRange(emailMap[email], 6).setValue(pledgeClass);
        if (bkNumber) sheet.getRange(emailMap[email], 2).setValue(bkNumber);
        updated++;
      } else {
        var mid = 'M' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
        sheet.appendRow([mid, bkNumber, name, email, 'active', pledgeClass, new Date().toISOString()]);
        added++;
      }
    }
    var fresh = sheet.getDataRange().getValues();
    var deactivated = 0;
    for (var k = 1; k < fresh.length; k++) {
      if (!csvEmails.has(fresh[k][3]) && fresh[k][4] === 'active') { // email col 3, status col 4
        sheet.getRange(k + 1, 5).setValue('inactive');
        deactivated++;
      }
    }
    logInfo('importMembersFromCSVText', 'Added:' + added + ' Updated:' + updated + ' Deactivated:' + deactivated);
    return JSON.stringify({ success: true, added: added, updated: updated, deactivated: deactivated });
  } catch (err) {
    logError('importMembersFromCSVText', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ============================================================
// New functions — Changes 1-5
// ============================================================

// ---- Change 1: Reassign member to a different chore ---------

function reassignMember(assignmentId, newChoreName) {
  try {
    var ss = getSpreadsheet();
    var semester = getConfigValue('semester');
    var sheet = ss.getSheetByName('chore_assignments');
    var data = sheet.getDataRange().getValues();

    // Guard: target chore must not be full
    var ratios = _getChoreRatiosData();
    var counts = _getAssignmentCounts(semester);
    var targetRatio = (ratios.chores || []).filter(function(c) { return c.name === newChoreName; })[0];
    if (targetRatio && (counts[newChoreName] || 0) >= targetRatio.people) {
      return JSON.stringify({ success: false, error: 'That chore is already full.' });
    }

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === assignmentId) {
        var gid = 'G' + newChoreName.replace(/[^A-Za-z0-9]/g, '').substring(0, 8) +
                  '_' + (semester || '').replace(/\s/g, '');
        sheet.getRange(i + 1, 3).setValue(newChoreName); // chore_name col
        sheet.getRange(i + 1, 4).setValue(gid);          // group_id col
        logInfo('reassignMember', assignmentId + ' → ' + newChoreName);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: 'Assignment not found.' });
  } catch (err) {
    logError('reassignMember', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- Change 2: Officer PIN for HomeApp ----------------------

function getOfficerPin() {
  try { return String(getConfigValue('officer_pin') || '1234'); }
  catch (_) { return '1234'; }
}

// ---- Change 3: BK number management ------------------------

// Assigns a 4-digit BK number to a member. Enforces uniqueness.
function assignBkNumber(memberId, bkNumber) {
  try {
    if (!bkNumber || !/^\d{4}$/.test(String(bkNumber))) {
      return JSON.stringify({ success: false, error: 'BK number must be exactly 4 digits.' });
    }
    var sheet = getSpreadsheet().getSheetByName('members');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]) === String(bkNumber) && data[i][0] !== memberId) {
        return JSON.stringify({ success: false, error: 'BK ' + bkNumber + ' is already assigned to another member.' });
      }
    }
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === memberId) {
        sheet.getRange(i + 1, 2).setValue(bkNumber); // bk_number col
        logInfo('assignBkNumber', memberId + ' → BK ' + bkNumber);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) {
    logError('assignBkNumber', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- Change 4: AM crossing ----------------------------------

// Converts an Associate Member to an active brother, assigning their BK number in one step.
function crossMember(memberId, bkNumber) {
  try {
    if (!bkNumber || !/^\d{4}$/.test(String(bkNumber))) {
      return JSON.stringify({ success: false, error: 'BK number must be exactly 4 digits.' });
    }
    var sheet = getSpreadsheet().getSheetByName('members');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]) === String(bkNumber) && data[i][0] !== memberId) {
        return JSON.stringify({ success: false, error: 'BK ' + bkNumber + ' is already in use.' });
      }
    }
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === memberId) {
        if (data[i][4] !== 'associate') {
          return JSON.stringify({ success: false, error: 'Member is not an Associate Member.' });
        }
        sheet.getRange(i + 1, 2).setValue(bkNumber); // bk_number col
        sheet.getRange(i + 1, 5).setValue('active');  // status col
        logInfo('crossMember', memberId + ' crossed → BK ' + bkNumber);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) {
    logError('crossMember', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- Change 5: Member Directory backend ---------------------

// Returns all members joined with chore, fine count, and status flags.
function getMemberDirectoryData() {
  try {
    var ss = getSpreadsheet();
    var semester = getConfigValue('semester');
    var asgData  = ss.getSheetByName('chore_assignments').getDataRange().getValues();
    var fineData = ss.getSheetByName('fines').getDataRange().getValues();

    var asgMap = {};
    for (var i = 1; i < asgData.length; i++) {
      if (asgData[i][4] === semester) asgMap[asgData[i][1]] = asgData[i][2];
    }
    var fineMap = {};
    for (var i = 1; i < fineData.length; i++) {
      var fid = fineData[i][1];
      fineMap[fid] = (fineMap[fid] || 0) + 1;
    }

    var members = _getMembersStructured().map(function(m) {
      return {
        memberId: m.memberId, bkNumber: m.bkNumber, name: m.name,
        email: m.email, gtEmail: m.gtEmail, status: m.status,
        pledgeClass: m.pledgeClass, officerRole: m.officerRole,
        inactiveReason: m.inactiveReason,
        suspension: m.suspension, suspensionReason: m.suspensionReason, suspensionEnd: m.suspensionEnd,
        academicSuspension: m.academicSuspension,
        probation: m.probation, probationType: m.probationType,
        formCompleted: m.formCompleted,
        mealPlan: m.mealPlan, livingInHouse: m.livingInHouse, roomNumber: m.roomNumber,
        phone: m.phone, anticipatedGraduation: m.anticipatedGraduation, extra: m.extra,
        chore: asgMap[m.memberId] || null,
        fineCount: fineMap[m.memberId] || 0
      };
    });

    // Alumni live on a separate sheet (graduateMember / migrateFromRosterSheet
    // both write there) — merge them in, tagged status:'alumni', so the
    // Member Manager's Alumni tab has something to show.
    var alumni = _getAlumniStructured().map(function(m) {
      return {
        memberId: m.memberId, bkNumber: m.bkNumber, name: m.name,
        email: m.email, gtEmail: m.gtEmail, status: 'alumni',
        pledgeClass: m.pledgeClass, officerRole: m.officerRole,
        inactiveReason: '',
        suspension: false, suspensionReason: '', suspensionEnd: '',
        academicSuspension: false,
        probation: false, probationType: '',
        formCompleted: null,
        phone: m.phone, anticipatedGraduation: m.anticipatedGraduation, extra: m.extra,
        graduatedSemester: m.graduatedSemester,
        chore: null,
        fineCount: 0
      };
    });

    return JSON.stringify({ success: true, data: members.concat(alumni), semester: semester });
  } catch (err) {
    logError('getMemberDirectoryData', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Edits basic fields for an existing member (name, email, pledgeClass, bkNumber, status).
function updateMember(memberId, name, email, pledgeClass, bkNumber, status, mealPlan, livingInHouse, roomNumber) {
  try {
    if (!name || !email) return JSON.stringify({ success: false, error: 'Name and email are required.' });
    var sheet = getSpreadsheet().getSheetByName('members');
    var data  = sheet.getDataRange().getValues();
    var cm    = _buildColMap(data[0]);
    var isNewSchema = cm['legal_first'] !== undefined;
    var emailCol = isNewSchema ? cm['personal_email'] : (cm['email'] !== undefined ? cm['email'] : 3);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][emailCol] || '').toLowerCase() === String(email).toLowerCase() && String(data[i][0]) !== String(memberId)) {
        return JSON.stringify({ success: false, error: 'That email is already used by another member.' });
      }
    }
    if (bkNumber) {
      if (!/^\d{4}$/.test(String(bkNumber))) return JSON.stringify({ success: false, error: 'BK number must be exactly 4 digits.' });
      var bkCol = cm['BK#'] !== undefined ? cm['BK#'] : 1;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][bkCol] || '') === String(bkNumber) && String(data[i][0]) !== String(memberId)) {
          return JSON.stringify({ success: false, error: 'BK ' + bkNumber + ' is already in use.' });
        }
      }
    }
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(memberId)) {
        var bkColW = cm['BK#'] !== undefined ? cm['BK#'] : 1;
        sheet.getRange(i + 1, bkColW + 1).setValue(bkNumber || '');
        if (isNewSchema) {
          // Split name into first/last for new schema
          var parts = name.trim().split(' ');
          var first = parts[0] || '';
          var last  = parts.slice(1).join(' ') || '';
          if (cm['legal_first'] !== undefined)   sheet.getRange(i + 1, cm['legal_first']   + 1).setValue(first);
          if (cm['legal_last']  !== undefined)   sheet.getRange(i + 1, cm['legal_last']    + 1).setValue(last);
          if (cm['personal_email'] !== undefined) sheet.getRange(i + 1, cm['personal_email']+ 1).setValue(email);
          if (cm['pledge_class'] !== undefined)  sheet.getRange(i + 1, cm['pledge_class']  + 1).setValue(pledgeClass || '');
          if (status && cm['status'] !== undefined) sheet.getRange(i + 1, cm['status'] + 1).setValue(status);
          if (cm['meal_plan']       !== undefined) sheet.getRange(i + 1, cm['meal_plan']       + 1).setValue(mealPlan || '');
          if (cm['living_in_house'] !== undefined) sheet.getRange(i + 1, cm['living_in_house'] + 1).setValue(livingInHouse || '');
          if (cm['room_number']     !== undefined) sheet.getRange(i + 1, cm['room_number']     + 1).setValue(livingInHouse === 'Yes' ? (roomNumber || '') : '');
          if (cm['last_updated'] !== undefined)  sheet.getRange(i + 1, cm['last_updated']  + 1).setValue(new Date().toISOString());
        } else {
          var nameCol = cm['name'] !== undefined ? cm['name'] : 2;
          var emCol   = cm['email'] !== undefined ? cm['email'] : 3;
          var plCol   = cm['pledge_class'] !== undefined ? cm['pledge_class'] : 5;
          var stCol   = cm['status'] !== undefined ? cm['status'] : 4;
          sheet.getRange(i + 1, nameCol + 1).setValue(name);
          sheet.getRange(i + 1, emCol   + 1).setValue(email);
          sheet.getRange(i + 1, plCol   + 1).setValue(pledgeClass || '');
          if (status) sheet.getRange(i + 1, stCol + 1).setValue(status);
        }
        logInfo('updateMember', memberId + ': ' + name);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) {
    logError('updateMember', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Returns active members assigned to a given chore this semester (for manual submission flow).
function getAssignedMembersForChore(choreName) {
  try {
    var ss = getSpreadsheet();
    var semester = getConfigValue('semester');
    var asgData = ss.getSheetByName('chore_assignments').getDataRange().getValues();
    var memMap = {};
    _getMembersStructured().forEach(function(m) { if (m.status === 'active') memMap[m.memberId] = m.name; });
    var members = [];
    for (var i = 1; i < asgData.length; i++) {
      var r = asgData[i];
      if (r[4] === semester && r[2] === choreName && memMap[r[1]]) {
        members.push({ memberId: r[1], name: memMap[r[1]] });
      }
    }
    return JSON.stringify({ success: true, members: members });
  } catch (err) {
    logError('getAssignedMembersForChore', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Full graduate: copies member to alumni tab, removes from members, clears assignments.
function graduateMember(memberId, performedBy) {
  try {
    performedBy = performedBy || 'Officer';
    var ss = getSpreadsheet();
    var memSheet = ss.getSheetByName('members');
    var memData  = memSheet.getDataRange().getValues();
    var cm = _buildColMap(memData[0]);
    var memberRow = null, memberRowNum = -1;
    for (var i = 1; i < memData.length; i++) {
      if (String(memData[i][0]) === String(memberId)) { memberRow = memData[i]; memberRowNum = i + 1; break; }
    }
    if (!memberRow) return JSON.stringify({ success: false, error: 'Member not found.' });

    var displayName = _displayName(memberRow, cm);
    var semester = getConfigValue('semester') || '';

    // Build alumni row (ALUMNI_HEADERS is the global const — its 'member_id'
    // entry carries the id over automatically via the forEach below, since
    // cm['member_id'] resolves to column 0 on the members sheet).
    var alSheet = ss.getSheetByName('alumni');
    if (!alSheet) { alSheet = ss.insertSheet('alumni'); alSheet.appendRow(ALUMNI_HEADERS); alSheet.setFrozenRows(1); }
    var alData = alSheet.getDataRange().getValues();
    var alCM = _buildColMap(alData[0]);

    var alRow = new Array(ALUMNI_HEADERS.length).fill('');
    ALUMNI_HEADERS.forEach(function(h, idx) {
      if (cm[h] !== undefined) alRow[idx] = memberRow[cm[h]];
    });
    // Set graduated_semester and moved_to_alumni_date
    if (alCM['graduated_semester'] !== undefined) alRow[alCM['graduated_semester']] = semester;
    if (alCM['moved_to_alumni_date'] !== undefined) alRow[alCM['moved_to_alumni_date']] = _normDate(new Date());
    alSheet.appendRow(alRow);

    // Remove member row
    memSheet.deleteRow(memberRowNum);

    // Remove chore assignments
    var asgSheet = ss.getSheetByName('chore_assignments');
    if (asgSheet) {
      var asgData = asgSheet.getDataRange().getValues();
      for (var j = asgData.length - 1; j >= 1; j--) {
        if (String(asgData[j][1]) === String(memberId)) asgSheet.deleteRow(j + 1);
      }
    }

    _logAudit('graduateMember', memberId, displayName, performedBy, 'semester=' + semester);
    return JSON.stringify({ success: true, message: displayName + ' moved to alumni.' });
  } catch (err) {
    logError('graduateMember', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Returns all fines for a member this semester, with running total.
function getMemberFineHistory(memberId) {
  try {
    var fineData   = getSpreadsheet().getSheetByName('fines').getDataRange().getValues();
    var fineAmount = Number(getConfigValue('fine_amount') || 5);
    var fines = [];
    for (var i = 1; i < fineData.length; i++) {
      if (fineData[i][1] === memberId) {
        fines.push({
          fineId:   fineData[i][0],
          choreName: fineData[i][2],
          weekStart: _normDate(fineData[i][3]),
          reason:    fineData[i][4],
          issuedAt:  fineData[i][5],
          issuedBy:  fineData[i][6]
        });
      }
    }
    return JSON.stringify({ success: true, fines: fines, fineAmount: fineAmount, total: fines.length * fineAmount });
  } catch (err) {
    logError('getMemberFineHistory', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ============================================================
// UPDATE 4 — New Functions
// ============================================================

// ---- Tab Setup ---------------------------------------------

var MEMBER_HEADERS = [
  'member_id','BK#','bid_order','legal_first','preferred_name','legal_last',
  'phone','personal_email','GTID','buzzcard','GT_username','GT_email',
  'hometown','birthday','dietary_restrictions','allergies',
  'emergency_contact_name','emergency_contact_phone',
  'major','year','anticipated_graduation','living_in_house','meal_plan',
  'car_on_campus','shirt_size','campus_orgs','leadership_positions',
  'which_positions','service_orgs','anything_else',
  'status','inactive_reason','suspension','suspension_reason','suspension_end',
  'probation','probation_type','probation_reason','probation_end',
  'academic_suspension','officer_role','pledge_class',
  'form_completed_this_semester','co_op_semester','added_date','last_updated',
  'room_number'
];

var ALUMNI_HEADERS = [
  'member_id',
  'BK#','legal_first','preferred_name','legal_last','phone','personal_email',
  'GTID','buzzcard','GT_username','GT_email','major','year',
  'anticipated_graduation','hometown','birthday','shirt_size',
  'dietary_restrictions','car_on_campus','allergies',
  'emergency_contact_name','emergency_contact_phone','campus_orgs',
  'leadership_positions','which_positions','service_orgs','anything_else',
  'pledge_class','officer_role','graduated_semester','moved_to_alumni_date','notes'
];

var NEW_MEMBER_FORM_HEADERS = [
  'Timestamp','Bid Order','Legal First Name','Preferred Name','Legal Last Name',
  'Phone Number','Personal Email','GTID','BuzzCard 6-Digit Code','GT Username',
  'GT Email','Major','Year','Anticipated Graduation','Hometown','Birthday',
  'Shirt Size','Dietary Restrictions','Do you have a car on campus?','Allergies',
  'Emergency Contact Name','Emergency Contact Phone Number',
  'Please list campus organizations...','Do you hold a leadership position...',
  'Which ones/what position?','Are any of these clubs service-based?',
  'Will you be on the meal plan?','Anything else we should know?'
];

var RETURNING_MEMBER_FORM_HEADERS = [
  'Timestamp','BK #','Legal First Name','Legal Last Name',
  'Status this semester','Are you living in the house?',
  'Will you be on the meal plan?','Major','Year','Anticipated Graduation',
  'Please list campus organizations...','Do you hold a leadership position...',
  'If so, which ones and what positions?','Are any of these service-based?',
  'Do you have a car on campus?','T-Shirt Size','Anything else we should know?'
];

// Creates required tabs and migrates members tab to new schema if needed.
function ensureTabsExist() {
  var ss = getSpreadsheet();
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (_) { ui = null; }

  // --- Members tab: migrate to new schema if needed ---
  var memSheet = ss.getSheetByName('members');
  if (memSheet) {
    var existingHeaders = memSheet.getRange(1, 1, 1, Math.max(memSheet.getLastColumn(), 1)).getValues()[0];
    var hasNewSchema = existingHeaders.indexOf('legal_first') !== -1;
    if (!hasNewSchema && memSheet.getLastRow() > 0) {
      var allData = memSheet.getDataRange().getValues();
      var oldCM = _buildColMap(allData[0]);
      var newRows = [MEMBER_HEADERS];
      for (var i = 1; i < allData.length; i++) {
        var row = allData[i];
        var newRow = new Array(MEMBER_HEADERS.length).fill('');
        newRow[0]  = row[0] || '';                          // member_id
        newRow[1]  = row[oldCM['bk_number'] !== undefined ? oldCM['bk_number'] : 1] || ''; // BK#
        // Split old 'name' into legal_first + legal_last
        var fullName = String(row[oldCM['name'] !== undefined ? oldCM['name'] : 2] || '').trim();
        var nameParts = fullName.split(' ');
        newRow[3]  = nameParts[0] || '';                    // legal_first
        newRow[5]  = nameParts.slice(1).join(' ') || '';    // legal_last
        newRow[7]  = row[oldCM['email'] !== undefined ? oldCM['email'] : 3] || ''; // personal_email
        newRow[30] = row[oldCM['status'] !== undefined ? oldCM['status'] : 4] || ''; // status
        newRow[41] = row[oldCM['pledge_class'] !== undefined ? oldCM['pledge_class'] : 5] || ''; // pledge_class
        newRow[44] = row[oldCM['added_date']   !== undefined ? oldCM['added_date']   : 6] || ''; // added_date
        newRows.push(newRow);
      }
      memSheet.clearContents();
      memSheet.getRange(1, 1, newRows.length, MEMBER_HEADERS.length).setValues(newRows);
      memSheet.setFrozenRows(1);
      logInfo('ensureTabsExist', 'Members tab migrated to new schema. ' + (newRows.length - 1) + ' rows converted.');
    }
  }

  // --- Create new tabs ---
  var tabsToCreate = {
    'alumni':                   ALUMNI_HEADERS,
    'new_member_responses':     NEW_MEMBER_FORM_HEADERS,
    'returning_member_responses': RETURNING_MEMBER_FORM_HEADERS,
    'member_notes':             ['note_id','member_id','note_text','note_type','created_by','created_at']
  };

  var created = [];
  Object.keys(tabsToCreate).forEach(function(tabName) {
    if (!ss.getSheetByName(tabName)) {
      var newSheet = ss.insertSheet(tabName);
      newSheet.appendRow(tabsToCreate[tabName]);
      newSheet.setFrozenRows(1);
      created.push(tabName);
    }
  });

  var msg = 'Tabs verified. Created: ' + (created.length ? created.join(', ') : 'none (all exist)');
  logInfo('ensureTabsExist', msg);
  if (ui) ui.alert('Setup Complete', msg, ui.ButtonSet.OK);
  return JSON.stringify({ success: true, message: msg });
}

// ---- One-Time Migration from Old Roster --------------------

function migrateFromRosterSheet() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (_) { ui = null; }

  var flag = getConfigValue('roster_migration_done');
  if (flag && String(flag).toLowerCase() === 'true') {
    var msg = 'Migration already completed. Clear the "roster_migration_done" config flag to run again.';
    if (ui) ui.alert(msg); else logInfo('migrateFromRosterSheet', msg);
    return JSON.stringify({ success: false, error: msg });
  }

  try {
    // Real chapter roster. For a one-off test run against a copy, set the
    // TEST_ROSTER_ID script property instead of editing this constant — that
    // way the real ID can never get shipped-over-by-accident from a test run.
    var OLD_ROSTER_ID = PropertiesService.getScriptProperties().getProperty('TEST_ROSTER_ID')
      || '1Fy2lKxpzdGsPyAWTVFcETsxNmhrX3UScVKI2NGEsMsU';
    var oldSS = SpreadsheetApp.openById(OLD_ROSTER_ID);
    var sheets = oldSS.getSheets();

    // Find the active semester tab. Real chapter workbooks also contain
    // Form-response sheets and computed views (e.g. "Fall 2026 Roster Form",
    // "Active Brothers + Numbers") that are NOT the roster table — skip those
    // too. Word-boundary matching avoids false hits like "Fall Formal" or
    // "Uniform Info", which a bare substring check would wrongly exclude.
    var skipPattern = /^(alumni|instructions)$/i;
    var skipSubstring = /\bform\b|\bnumbers\b|active brothers/i;
    var semesterSheets = sheets.filter(function(s) {
      var n = s.getName();
      return !s.isSheetHidden() && !skipPattern.test(n) && !skipSubstring.test(n);
    });
    if (!semesterSheets.length) throw new Error('No visible semester tab found in old roster.');

    // Prefer the tab whose name matches the configured semester exactly.
    var currentSemester = String(getConfigValue('semester') || '').trim();
    var rosterSheet = null;
    for (var si = 0; si < semesterSheets.length; si++) {
      if (semesterSheets[si].getName().trim() === currentSemester) { rosterSheet = semesterSheets[si]; break; }
    }
    if (!rosterSheet) rosterSheet = semesterSheets[semesterSheets.length - 1];

    // The real header row isn't always row 1 — chapters often keep a stats
    // dashboard above the table. Scan the first rows for the one that looks
    // like the roster's header (has both a BK# column and a first-name column).
    var rosterAll = rosterSheet.getDataRange().getValues();
    var headerRowIdx = 0;
    var headerRowFound = false;
    for (var hr = 0; hr < Math.min(rosterAll.length, 25); hr++) {
      var rowJoined = rosterAll[hr].join('|').toLowerCase();
      if (rowJoined.indexOf('bk') !== -1 && rowJoined.indexOf('first') !== -1) { headerRowIdx = hr; headerRowFound = true; break; }
    }
    if (!headerRowFound) {
      logError('migrateFromRosterSheet',
        'Could not confidently locate the roster header row in "' + rosterSheet.getName() +
        '" (looked for a row containing both "bk" and "first" in the first 25 rows). ' +
        'Defaulting to row 1 — verify the migrated data before trusting it.');
    }
    var rosterData = rosterAll.slice(headerRowIdx);
    var rosterCM = _buildColMap(rosterData[0]);

    // Chapter rosters use verbose Google-Form-style headers that don't match
    // our internal field names exactly (e.g. 'BK #' vs 'BK#', 'Legal First Name'
    // vs 'legal_first'). Resolve each field against a list of known variants
    // instead of relying on a single fallback column index.
    var _findColByCandidates = function(cm, candidates) {
      for (var i = 0; i < candidates.length; i++) {
        if (cm[candidates[i]] !== undefined) return cm[candidates[i]];
      }
      var keys = Object.keys(cm);
      for (var c = 0; c < candidates.length; c++) {
        var want = candidates[c].toLowerCase();
        for (var k = 0; k < keys.length; k++) {
          if (keys[k].toLowerCase().indexOf(want) !== -1) return cm[keys[k]];
        }
      }
      return undefined;
    };
    var _findRosterCol = function(candidates) { return _findColByCandidates(rosterCM, candidates); };
    var colBK     = _findRosterCol(['BK#', 'BK #', 'bk_number']);
    var colFirst  = _findRosterCol(['First Name', 'Legal First Name', 'legal_first']);
    var colLast   = _findRosterCol(['Last Name', 'Legal Last Name', 'legal_last']);
    // 'Personal Email' tried before the bare 'Email' substring so a sheet with
    // no exact match doesn't fall back onto 'GT Email' (a school address).
    var colEmail  = _findRosterCol(['Personal Email', 'personal_email', 'Email']);
    var colStatus = _findRosterCol(['Status', 'Status this semester', 'status']);
    var colName   = _findRosterCol(['Name', 'Full Name']);
    var colPledge = _findRosterCol(['Pledge Class', 'pledge_class']);

    // The rest of MEMBER_HEADERS — descriptive/profile fields the officer
    // dashboard shows but doesn't need to specially transform — resolved the
    // same way and copied straight across for newly-created members.
    var memberFieldCandidates = {
      'preferred_name':          ['Preferred Name'],
      'phone':                   ['Phone Number', 'Phone'],
      'GTID':                    ['GTID'],
      'buzzcard':                ['BuzzCard'],
      'GT_username':             ['GT Username'],
      'GT_email':                ['GT Email'],
      'major':                   ['Major'],
      'year':                    ['Year'],
      'anticipated_graduation':  ['Anticipated Graduation'],
      'hometown':                ['Hometown'],
      'birthday':                ['Birthday'],
      'shirt_size':              ['Shirt Size', 'T-Shirt Size'],
      'dietary_restrictions':    ['Dietary Restrictions'],
      'car_on_campus':           ['car on campus'],
      'allergies':               ['Allergies'],
      'emergency_contact_name':  ['Emergency Contact Name'],
      'emergency_contact_phone': ['Emergency Contact Phone'],
      'campus_orgs':             ['campus organizations'],
      'leadership_positions':    ['leadership position'],
      'which_positions':         ['which ones', 'what position'],
      'service_orgs':            ['service-based', 'service organizations'],
      'anything_else':           ['anything else'],
      // Exact known phrasing tried first — the meal-plan question's own text
      // contains "...Living in the house..." as boilerplate, which would
      // otherwise wrongly substring-match the living_in_house field onto the
      // meal-plan column (and vice versa isn't an issue, but be precise both ways).
      'meal_plan':               ['Will you be on the meal plan?', 'meal plan'],
      'living_in_house':         ['Are you living in the house?', 'are you living in the house']
    };
    var memberColIdx = {};
    Object.keys(memberFieldCandidates).forEach(function(h) {
      memberColIdx[h] = _findColByCandidates(rosterCM, memberFieldCandidates[h]);
    });

    // Ensure our tabs exist
    ensureTabsExist();

    var ss = getSpreadsheet();
    var memSheet = ss.getSheetByName('members');
    var memData  = memSheet.getDataRange().getValues();
    var memCM    = _buildColMap(memData[0]);

    // Build lookup by email and BK#
    var emailToRow = {}, bkToRow = {};
    for (var i = 1; i < memData.length; i++) {
      var em = _memberEmail(memData[i], memCM).toLowerCase();
      var bk = String(memData[i][memCM['BK#'] !== undefined ? memCM['BK#'] : 1] || '');
      if (em) emailToRow[em] = i;
      if (bk) bkToRow[bk] = i;
    }

    var added = 0, updated = 0, skipped = 0;
    var statusMap = { 'Active': 'active', 'Inactive': 'inactive', 'active': 'active', 'inactive': 'inactive' };

    for (var r = 1; r < rosterData.length; r++) {
      var row = rosterData[r];
      if (!row.join('').trim()) continue; // skip fully blank spacer rows
      var rEmail  = String((colEmail  !== undefined ? row[colEmail]  : '') || '').trim().toLowerCase();
      var rBK     = String((colBK     !== undefined ? row[colBK]     : '') || '').trim();
      var rStatus = String((colStatus !== undefined ? row[colStatus] : '') || '').trim();
      if (rStatus.toLowerCase() === 'alumni') { skipped++; continue; }

      var matchIdx = emailToRow[rEmail] || (rBK ? bkToRow[rBK] : null);
      var mappedStatus = statusMap[rStatus] || 'inactive';

      if (matchIdx) {
        // Update existing
        if (memCM['status'] !== undefined) memSheet.getRange(matchIdx + 1, memCM['status'] + 1).setValue(mappedStatus);
        if (memCM['last_updated'] !== undefined) memSheet.getRange(matchIdx + 1, memCM['last_updated'] + 1).setValue(new Date().toISOString());
        updated++;
      } else {
        // Create new row
        var newRow = new Array(MEMBER_HEADERS.length).fill('');
        var mid = 'M' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
        newRow[0]  = mid;
        newRow[1]  = rBK;
        var rFirst = String((colFirst !== undefined ? row[colFirst] : '') || '').trim();
        var rLast  = String((colLast  !== undefined ? row[colLast]  : '') || '').trim();
        if (!rFirst) {
          var rName = String((colName !== undefined ? row[colName] : '') || '').trim();
          var parts = rName.split(' ');
          rFirst = parts[0] || ''; rLast = parts.slice(1).join(' ') || '';
        }
        newRow[memCM['legal_first']]   = rFirst;
        newRow[memCM['legal_last']]    = rLast;
        newRow[memCM['personal_email']]= rEmail;
        newRow[memCM['BK#']]           = rBK;
        newRow[memCM['status']]        = mappedStatus;
        if (memCM['pledge_class'] !== undefined) newRow[memCM['pledge_class']] = String((colPledge !== undefined ? row[colPledge] : '') || '');
        newRow[memCM['added_date']]    = new Date().toISOString();
        Object.keys(memberColIdx).forEach(function(h) {
          var srcCol = memberColIdx[h];
          if (srcCol !== undefined && memCM[h] !== undefined) newRow[memCM[h]] = row[srcCol];
        });
        memSheet.appendRow(newRow);
        added++;
      }
    }

    // Migrate alumni tab from old roster
    var oldAlumniSheet = oldSS.getSheetByName('Alumni') || oldSS.getSheetByName('alumni');
    var alumniMigrated = 0;
    if (oldAlumniSheet) {
      var alData = oldAlumniSheet.getDataRange().getValues();
      var alCM   = _buildColMap(alData[0]);
      var ourAlSheet = ss.getSheetByName('alumni');
      if (!ourAlSheet) { ourAlSheet = ss.insertSheet('alumni'); ourAlSheet.appendRow(ALUMNI_HEADERS); ourAlSheet.setFrozenRows(1); }

      // Same verbose-header mismatch as the main roster — resolve each
      // ALUMNI_HEADERS field against known real-world header variants instead
      // of requiring an exact snake_case match.
      var alFieldCandidates = {
        'BK#': ['BK#', 'BK #'],
        'legal_first': ['First Name', 'Legal First Name'],
        'preferred_name': ['Preferred Name'],
        'legal_last': ['Last Name', 'Legal Last Name'],
        'phone': ['Phone Number', 'Phone'],
        'personal_email': ['Email', 'Personal Email'],
        'GTID': ['GTID'],
        'buzzcard': ['BuzzCard'],
        'GT_username': ['GT Username'],
        'GT_email': ['GT Email'],
        'major': ['Major'],
        'year': ['Year'],
        'anticipated_graduation': ['Anticipated Graduation'],
        'hometown': ['Hometown'],
        'birthday': ['Birthday'],
        'shirt_size': ['Shirt Size', 'T-Shirt Size'],
        'dietary_restrictions': ['Dietary Restrictions'],
        'car_on_campus': ['car on campus'],
        'allergies': ['Allergies'],
        'emergency_contact_name': ['Emergency Contact Name'],
        'emergency_contact_phone': ['Emergency Contact Phone'],
        'campus_orgs': ['campus organizations'],
        'leadership_positions': ['leadership position'],
        'which_positions': ['which ones', 'what position'],
        'service_orgs': ['service-based', 'service organizations'],
        'anything_else': ['anything else'],
        'pledge_class': ['Pledge Class'],
        'officer_role': ['Officer']
        // graduated_semester / moved_to_alumni_date / notes have no source column — left blank.
      };
      var alColIdx = {};
      Object.keys(alFieldCandidates).forEach(function(h) {
        alColIdx[h] = _findColByCandidates(alCM, alFieldCandidates[h]);
      });

      for (var a = 1; a < alData.length; a++) {
        var aRow = alData[a];
        if (!aRow.join('').trim()) continue; // skip blank spacer rows
        var alNewRow = new Array(ALUMNI_HEADERS.length).fill('');
        ALUMNI_HEADERS.forEach(function(h, idx) {
          var srcCol = alColIdx[h];
          if (srcCol !== undefined) alNewRow[idx] = aRow[srcCol];
        });
        // The old roster's Alumni tab has no member_id — mint one so this
        // record is addressable (view/reactivate) from the officer UI.
        var midIdx = ALUMNI_HEADERS.indexOf('member_id');
        if (midIdx !== -1 && !alNewRow[midIdx]) {
          alNewRow[midIdx] = 'M' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
        }
        ourAlSheet.appendRow(alNewRow);
        alumniMigrated++;
      }
    }

    setConfigValue('roster_migration_done', 'true');
    var summary = 'Migration complete. Added: ' + added + ' | Updated: ' + updated + ' | Skipped (alumni): ' + skipped + ' | Alumni migrated: ' + alumniMigrated;
    logInfo('migrateFromRosterSheet', summary);
    if (ui) ui.alert('Migration Complete', summary, ui.ButtonSet.OK);
    return JSON.stringify({ success: true, added: added, updated: updated, skipped: skipped, alumniMigrated: alumniMigrated });
  } catch (err) {
    logError('migrateFromRosterSheet', err);
    if (ui) ui.alert('Migration Error', err.toString(), ui.ButtonSet.OK);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- Relink Google Forms -----------------------------------

function relinkForms() {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (_) { ui = null; }

  var flag = getConfigValue('forms_relinked');
  if (flag && String(flag).toLowerCase() === 'true') {
    var msg = 'Forms already relinked. Clear "forms_relinked" config flag to run again.';
    if (ui) ui.alert(msg); return JSON.stringify({ success: false, error: msg });
  }

  try {
    var NEW_MEMBER_FORM_ID     = '11_pZU70tnSDixHVf-GhxJJt1eDo8MgE2liyxzNePZs4';
    var RETURNING_MEMBER_FORM_ID = '1J10pg_DsD4oZNbGYIIiM_yha3ZYzP-hDdTKkk1hPf7U';
    var ss = getSpreadsheet();
    var ssId = ss.getId();

    ensureTabsExist();

    var newMemberForm = FormApp.openById(NEW_MEMBER_FORM_ID);
    newMemberForm.setDestination(FormApp.DestinationType.SPREADSHEET, ssId);
    logInfo('relinkForms', 'New member form linked to sheet ' + ssId);

    var returningForm = FormApp.openById(RETURNING_MEMBER_FORM_ID);
    returningForm.setDestination(FormApp.DestinationType.SPREADSHEET, ssId);
    logInfo('relinkForms', 'Returning member form linked to sheet ' + ssId);

    setConfigValue('forms_relinked', 'true');
    var msg2 = 'Both forms relinked to this spreadsheet. Check that response tabs match the expected tab names.';
    if (ui) ui.alert('Forms Relinked', msg2, ui.ButtonSet.OK);
    return JSON.stringify({ success: true, message: msg2 });
  } catch (err) {
    logError('relinkForms', err);
    if (ui) ui.alert('Error', err.toString(), ui.ButtonSet.OK);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- Semester Sync -----------------------------------------

function runSemesterSync(pin) {
  if (pin && !_checkOfficerPin(pin)) return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (_) { ui = null; }

  try {
    var ss = getSpreadsheet();
    var semester = getConfigValue('semester') || '';
    var memSheet = ss.getSheetByName('members');
    var memData  = memSheet.getDataRange().getValues();
    var memCM    = _buildColMap(memData[0]);

    var log = ['=== SEMESTER SYNC: ' + semester + ' @ ' + new Date().toISOString() + ' ==='];
    var newAdded = 0, returning = 0, incomplete = [], potentialGrads = [], inactivePrev = [], unmatchedReturning = [], duplicateNew = [];

    // ---- STEP 1: Process new member responses ----
    var nmSheet = ss.getSheetByName('new_member_responses');
    if (nmSheet && nmSheet.getLastRow() > 1) {
      var nmData = nmSheet.getDataRange().getValues();
      var nmCM   = _buildColMap(nmData[0]);
      var seenEmails = {};
      for (var i = 1; i < nmData.length; i++) {
        var nr = nmData[i];
        var nmEmail = String(nr[nmCM['Personal Email'] !== undefined ? nmCM['Personal Email'] : 6] || '').trim().toLowerCase();
        if (!nmEmail) continue;
        if (seenEmails[nmEmail]) { log.push('WARN: Duplicate new-member form: ' + nmEmail); duplicateNew.push(nmEmail); continue; }
        seenEmails[nmEmail] = true;

        // Check if exists
        var found = false;
        for (var m = 1; m < memData.length; m++) {
          var existEmail = _memberEmail(memData[m], memCM).toLowerCase();
          if (existEmail === nmEmail) { found = true; break; }
        }
        if (!found) {
          var newRow = new Array(MEMBER_HEADERS.length).fill('');
          newRow[0]  = 'M' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
          newRow[memCM['legal_first']]    = String(nr[nmCM['Legal First Name'] !== undefined ? nmCM['Legal First Name'] : 2] || '');
          newRow[memCM['preferred_name']] = String(nr[nmCM['Preferred Name']    !== undefined ? nmCM['Preferred Name']   : 3] || '');
          newRow[memCM['legal_last']]     = String(nr[nmCM['Legal Last Name']   !== undefined ? nmCM['Legal Last Name']  : 4] || '');
          newRow[memCM['phone']]          = String(nr[nmCM['Phone Number']      !== undefined ? nmCM['Phone Number']     : 5] || '');
          newRow[memCM['personal_email']] = nmEmail;
          newRow[memCM['GTID']]           = String(nr[nmCM['GTID']              !== undefined ? nmCM['GTID']             : 7] || '');
          newRow[memCM['buzzcard']]       = String(nr[nmCM['BuzzCard 6-Digit Code'] !== undefined ? nmCM['BuzzCard 6-Digit Code'] : 8] || '');
          newRow[memCM['GT_username']]    = String(nr[nmCM['GT Username']       !== undefined ? nmCM['GT Username']      : 9] || '');
          newRow[memCM['GT_email']]       = String(nr[nmCM['GT Email']          !== undefined ? nmCM['GT Email']         : 10] || '');
          newRow[memCM['status']]         = 'associate';
          newRow[memCM['pledge_class']]   = semester;
          newRow[memCM['form_completed_this_semester']] = true;
          newRow[memCM['added_date']]     = new Date().toISOString();
          // Semester-updated fields
          var semFields = {
            'major': 'Major', 'year': 'Year', 'anticipated_graduation': 'Anticipated Graduation',
            'hometown': 'Hometown', 'birthday': 'Birthday', 'shirt_size': 'Shirt Size',
            'dietary_restrictions': 'Dietary Restrictions', 'car_on_campus': 'Do you have a car on campus?',
            'allergies': 'Allergies', 'emergency_contact_name': 'Emergency Contact Name',
            'emergency_contact_phone': 'Emergency Contact Phone Number',
            'campus_orgs': 'Please list campus organizations...',
            'leadership_positions': 'Do you hold a leadership position...',
            'which_positions': 'Which ones/what position?',
            'service_orgs': 'Are any of these clubs service-based?',
            'meal_plan': 'Will you be on the meal plan?'
          };
          Object.keys(semFields).forEach(function(col) {
            if (memCM[col] !== undefined && nmCM[semFields[col]] !== undefined) {
              newRow[memCM[col]] = String(nr[nmCM[semFields[col]]] || '');
            }
          });
          memSheet.appendRow(newRow);
          newAdded++;
          log.push('Added new member: ' + nmEmail);
        }
      }
      // Clear new_member_responses (keep header)
      if (nmSheet.getLastRow() > 1) nmSheet.deleteRows(2, nmSheet.getLastRow() - 1);
      log.push('New member responses processed. Added: ' + newAdded);
    }

    // Reload memData after potential new additions
    memData = memSheet.getDataRange().getValues();
    memCM   = _buildColMap(memData[0]);

    // ---- STEP 2: Process returning member responses ----
    var rmSheet = ss.getSheetByName('returning_member_responses');
    if (rmSheet && rmSheet.getLastRow() > 1) {
      var rmData = rmSheet.getDataRange().getValues();
      var rmCM   = _buildColMap(rmData[0]);
      for (var j = 1; j < rmData.length; j++) {
        var rr = rmData[j];
        var rrBK    = String(rr[rmCM['BK #'] !== undefined ? rmCM['BK #'] : 1] || '').trim();
        var rrFirst = String(rr[rmCM['Legal First Name'] !== undefined ? rmCM['Legal First Name'] : 2] || '').trim().toLowerCase();
        var rrLast  = String(rr[rmCM['Legal Last Name']  !== undefined ? rmCM['Legal Last Name']  : 3] || '').trim().toLowerCase();

        // Match by BK# only — it's the stable, unique key. Fall back to a
        // full-name match (first + last, not just first) ONLY when no BK#
        // was submitted, and ONLY if exactly one member matches; an
        // ambiguous or missing match is logged for manual review rather
        // than guessed, since a wrong guess silently overwrites someone
        // else's semester data.
        var matchRow = -1;
        if (rrBK) {
          for (var k = 1; k < memData.length; k++) {
            var mBK = String(memData[k][memCM['BK#'] !== undefined ? memCM['BK#'] : 1] || '').trim();
            if (mBK === rrBK) { matchRow = k; break; }
          }
          if (matchRow === -1) {
            var msg1 = 'No member matches BK#' + rrBK + ' (' + rrFirst + ' ' + rrLast + ')';
            log.push('WARN: ' + msg1);
            unmatchedReturning.push(msg1);
            continue;
          }
        } else if (rrFirst || rrLast) {
          var nameMatches = [];
          for (var k2 = 1; k2 < memData.length; k2++) {
            var nameParts = _displayName(memData[k2], memCM).toLowerCase().split(' ');
            var mFirst = nameParts[0] || '';
            var mLast  = nameParts.slice(1).join(' ');
            if (mFirst === rrFirst && mLast === rrLast) nameMatches.push(k2);
          }
          if (nameMatches.length === 1) {
            matchRow = nameMatches[0];
          } else {
            var msg2 = 'No BK# submitted, ' + nameMatches.length + ' name matches for ' + rrFirst + ' ' + rrLast + ' — needs manual review.';
            log.push('WARN: ' + msg2);
            unmatchedReturning.push(msg2);
            continue;
          }
        } else {
          log.push('WARN: Returning form row with no BK# and no name — skipped.');
          unmatchedReturning.push('Row with no BK# and no name submitted');
          continue;
        }

        // Update semester fields only
        var semMap = {
          'major': 'Major', 'year': 'Year', 'anticipated_graduation': 'Anticipated Graduation',
          'living_in_house': 'Are you living in the house?', 'meal_plan': 'Will you be on the meal plan?',
          'campus_orgs': 'Please list campus organizations...',
          'leadership_positions': 'Do you hold a leadership position...',
          'which_positions': 'If so, which ones and what positions?',
          'service_orgs': 'Are any of these service-based?',
          'car_on_campus': 'Do you have a car on campus?',
          'shirt_size': 'T-Shirt Size', 'anything_else': 'Anything else we should know?'
        };
        // Only overwrite a field when the form actually answered it — a
        // blank/skipped question must never wipe out a value that was
        // already on file (e.g. from a previous semester or a manual edit).
        Object.keys(semMap).forEach(function(col) {
          if (memCM[col] !== undefined && rmCM[semMap[col]] !== undefined) {
            var newVal = String(rr[rmCM[semMap[col]]] || '').trim();
            if (newVal) memSheet.getRange(matchRow + 1, memCM[col] + 1).setValue(newVal);
          }
        });
        if (memCM['form_completed_this_semester'] !== undefined) {
          memSheet.getRange(matchRow + 1, memCM['form_completed_this_semester'] + 1).setValue(true);
        }
        if (memCM['last_updated'] !== undefined) {
          memSheet.getRange(matchRow + 1, memCM['last_updated'] + 1).setValue(new Date().toISOString());
        }
        returning++;
      }
      if (rmSheet.getLastRow() > 1) rmSheet.deleteRows(2, rmSheet.getLastRow() - 1);
      log.push('Returning member responses processed. Updated: ' + returning);
    }

    // Reload again
    memData = memSheet.getDataRange().getValues();
    memCM   = _buildColMap(memData[0]);

    // ---- STEP 3 & 4 & 5: Flag incomplete, grad check, inactive review ----
    var fcCol  = memCM['form_completed_this_semester'];
    var stCol  = memCM['status'] !== undefined ? memCM['status'] : 4;
    var agCol  = memCM['anticipated_graduation'];

    for (var n = 1; n < memData.length; n++) {
      var mRow = memData[n];
      var mStatus = String(mRow[stCol] || '');
      if (mStatus === 'alumni') continue;

      // Step 3: incomplete forms
      if ((mStatus === 'active' || mStatus === 'associate') && fcCol !== undefined && !mRow[fcCol]) {
        incomplete.push(_displayName(mRow, memCM));
      }
      // Step 4: graduation check
      if ((mStatus === 'active' || mStatus === 'associate') && agCol !== undefined) {
        var ag = String(mRow[agCol] || '').trim();
        if (ag && _semesterIsPastOrCurrent(ag, semester)) {
          potentialGrads.push(_displayName(mRow, memCM) + ' (grad: ' + ag + ')');
        }
      }
      // Step 5: inactive members
      if (mStatus === 'inactive') {
        inactivePrev.push(_displayName(mRow, memCM));
      }
    }

    // ---- STEP 7: Log ----
    log.push('Form incomplete: ' + incomplete.length + ' members');
    log.push('Potential graduates: ' + potentialGrads.length);
    log.push('Inactive from last semester: ' + inactivePrev.length);
    logInfo('runSemesterSync', log.join(' | '));

    var result = {
      success: true, newAdded: newAdded, returningUpdated: returning,
      incompleteCount: incomplete.length, incompleteMembers: incomplete,
      potentialGrads: potentialGrads, inactiveMembers: inactivePrev,
      unmatchedReturning: unmatchedReturning, duplicateNew: duplicateNew,
      log: log
    };

    // ---- STEP 8: Show summary ----
    if (ui) {
      var summaryMsg =
        'Semester Sync Complete!\n\n' +
        'New members added: ' + newAdded + '\n' +
        'Returning members updated: ' + returning + '\n' +
        'Forms not submitted: ' + incomplete.length + (incomplete.length ? '\n  → ' + incomplete.slice(0,5).join(', ') + (incomplete.length > 5 ? '...' : '') : '') + '\n\n' +
        (unmatchedReturning.length ? '❗ Unmatched returning forms (' + unmatchedReturning.length + ') — needs manual review:\n  ' + unmatchedReturning.slice(0,5).join('\n  ') + '\n\n' : '') +
        (potentialGrads.length ? '⚠️ Potential graduates (' + potentialGrads.length + '):\n  ' + potentialGrads.slice(0,5).join('\n  ') + '\n\n' : '') +
        (inactivePrev.length ? '📋 Inactive last semester (' + inactivePrev.length + '):\n  ' + inactivePrev.slice(0,5).join('\n  ') : '');
      ui.alert('Semester Sync', summaryMsg, ui.ButtonSet.OK);
    }

    return JSON.stringify(result);
  } catch (err) {
    logError('runSemesterSync', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Helper: returns true if a semester string (e.g. "Spring 2026") is current or past.
function _semesterIsPastOrCurrent(gradSem, currentSem) {
  try {
    var parse = function(s) {
      var parts = s.trim().split(' ');
      var term  = (parts[0] || '').toLowerCase();
      var year  = parseInt(parts[1] || 0);
      var termN = term === 'spring' ? 1 : term === 'summer' ? 2 : 3;
      return year * 10 + termN;
    };
    return parse(gradSem) <= parse(currentSem);
  } catch (_) { return false; }
}

function getGraduationCandidates() {
  try {
    var semester = getConfigValue('semester') || '';
    var candidates = _getMembersStructured().filter(function(m) {
      if (m.status === 'alumni') return false;
      return m.anticipatedGraduation && _semesterIsPastOrCurrent(m.anticipatedGraduation, semester);
    }).map(function(m) {
      return { memberId: m.memberId, bkNumber: m.bkNumber, name: m.name, pledgeClass: m.pledgeClass, anticipatedGraduation: m.anticipatedGraduation, status: m.status };
    });
    return JSON.stringify({ success: true, data: candidates });
  } catch (err) {
    logError('getGraduationCandidates', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- Lifecycle Functions -----------------------------------

function dissociateMember(memberId, reason, performedBy) {
  try {
    performedBy = performedBy || 'Officer';
    var ss = getSpreadsheet();
    var memSheet = ss.getSheetByName('members');
    var data = memSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(memberId)) {
        var name = _displayName(data[i], cm);
        if (cm['status'] !== undefined) memSheet.getRange(i+1, cm['status']+1).setValue('inactive');
        if (cm['inactive_reason'] !== undefined) memSheet.getRange(i+1, cm['inactive_reason']+1).setValue('removed');
        if (cm['last_updated'] !== undefined) memSheet.getRange(i+1, cm['last_updated']+1).setValue(new Date().toISOString());
        // Clear assignments
        _removeChoreAssignments(ss, memberId);
        addMemberNote(memberId, reason || 'Dissociated from chapter.', 'disciplinary', performedBy);
        _logAudit('dissociateMember', memberId, name, performedBy, reason);
        return JSON.stringify({ success: true, message: name + ' dissociated.' });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) { logError('dissociateMember', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function reactivateMember(memberId, performedBy) {
  try {
    performedBy = performedBy || 'Officer';
    var ss = getSpreadsheet();
    var memSheet = ss.getSheetByName('members');
    var data = memSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(memberId)) {
        var name = _displayName(data[i], cm);
        if (cm['status'] !== undefined)          memSheet.getRange(i+1, cm['status']+1).setValue('active');
        if (cm['inactive_reason'] !== undefined) memSheet.getRange(i+1, cm['inactive_reason']+1).setValue('');
        if (cm['last_updated'] !== undefined)    memSheet.getRange(i+1, cm['last_updated']+1).setValue(new Date().toISOString());
        _logAudit('reactivateMember', memberId, name, performedBy, '');
        return JSON.stringify({ success: true, message: name + ' reactivated.' });
      }
    }

    // Not found among current members — check whether they're an alumnus
    // and, if so, move their record back from 'alumni' into 'members'.
    var alSheet = ss.getSheetByName('alumni');
    if (alSheet && alSheet.getLastRow() > 1) {
      var alData = alSheet.getDataRange().getValues();
      var alCM = _buildColMap(alData[0]);
      if (alCM['member_id'] !== undefined) {
        for (var a = 1; a < alData.length; a++) {
          if (String(alData[a][alCM['member_id']]) === String(memberId)) {
            var alRow = alData[a];
            var alName = _displayName(alRow, alCM);
            var newRow = new Array(MEMBER_HEADERS.length).fill('');
            MEMBER_HEADERS.forEach(function(h, idx) {
              if (alCM[h] !== undefined) newRow[idx] = alRow[alCM[h]];
            });
            if (cm['status'] !== undefined)     newRow[cm['status']] = 'active';
            if (cm['added_date'] !== undefined) newRow[cm['added_date']] = new Date().toISOString();
            memSheet.appendRow(newRow);
            alSheet.deleteRow(a + 1);
            _logAudit('reactivateMember', memberId, alName, performedBy, 'restored from alumni');
            return JSON.stringify({ success: true, message: alName + ' restored from alumni.' });
          }
        }
      }
    }

    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) { logError('reactivateMember', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function initiateMember(memberId, bkNumber, performedBy) {
  try {
    if (!bkNumber || !/^\d{4}$/.test(String(bkNumber))) return JSON.stringify({ success: false, error: 'BK number must be exactly 4 digits.' });
    performedBy = performedBy || 'Officer';
    var memSheet = getSpreadsheet().getSheetByName('members');
    var data = memSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    var bkCol = cm['BK#'] !== undefined ? cm['BK#'] : 1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][bkCol] || '') === String(bkNumber) && String(data[i][0]) !== String(memberId)) {
        return JSON.stringify({ success: false, error: 'BK ' + bkNumber + ' is already in use.' });
      }
    }
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(memberId)) {
        if (String(data[i][cm['status'] !== undefined ? cm['status'] : 4]) !== 'associate') {
          return JSON.stringify({ success: false, error: 'Member is not an Associate Member.' });
        }
        var name = _displayName(data[i], cm);
        memSheet.getRange(i+1, bkCol+1).setValue(bkNumber);
        if (cm['status'] !== undefined) memSheet.getRange(i+1, cm['status']+1).setValue('active');
        if (cm['last_updated'] !== undefined) memSheet.getRange(i+1, cm['last_updated']+1).setValue(new Date().toISOString());
        _logAudit('initiateMember', memberId, name, performedBy, 'BK#=' + bkNumber);
        return JSON.stringify({ success: true, message: name + ' initiated as BK#' + bkNumber + '.' });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) { logError('initiateMember', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function markInactive(memberId, reason, performedBy) {
  try {
    var validReasons = ['co-op','study_abroad','voluntary','other'];
    if (validReasons.indexOf(reason) === -1) reason = 'other';
    performedBy = performedBy || 'Officer';
    var memSheet = getSpreadsheet().getSheetByName('members');
    var data = memSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(memberId)) {
        var name = _displayName(data[i], cm);
        if (cm['status'] !== undefined)          memSheet.getRange(i+1, cm['status']+1).setValue('inactive');
        if (cm['inactive_reason'] !== undefined) memSheet.getRange(i+1, cm['inactive_reason']+1).setValue(reason);
        if (cm['co_op_semester']  !== undefined && reason === 'co-op') {
          memSheet.getRange(i+1, cm['co_op_semester']+1).setValue(getConfigValue('semester') || '');
        }
        if (cm['last_updated'] !== undefined) memSheet.getRange(i+1, cm['last_updated']+1).setValue(new Date().toISOString());
        _removeChoreAssignments(getSpreadsheet(), memberId);
        _logAudit('markInactive', memberId, name, performedBy, 'reason=' + reason);
        return JSON.stringify({ success: true, message: name + ' marked inactive (' + reason + ').' });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) { logError('markInactive', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function placeSuspension(memberId, reason, endDate, isAcademic, performedBy) {
  try {
    performedBy = performedBy || 'Officer';
    isAcademic  = isAcademic === true || isAcademic === 'true';
    var memSheet = getSpreadsheet().getSheetByName('members');
    var data = memSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(memberId)) {
        var name = _displayName(data[i], cm);
        if (isAcademic) {
          if (cm['academic_suspension'] !== undefined) memSheet.getRange(i+1, cm['academic_suspension']+1).setValue(true);
        } else {
          if (cm['suspension'] !== undefined)         memSheet.getRange(i+1, cm['suspension']+1).setValue(true);
          if (cm['suspension_reason'] !== undefined)  memSheet.getRange(i+1, cm['suspension_reason']+1).setValue(reason || '');
          if (cm['suspension_end'] !== undefined)     memSheet.getRange(i+1, cm['suspension_end']+1).setValue(endDate || '');
        }
        if (cm['last_updated'] !== undefined) memSheet.getRange(i+1, cm['last_updated']+1).setValue(new Date().toISOString());
        _removeChoreAssignments(getSpreadsheet(), memberId);
        _logAudit('placeSuspension', memberId, name, performedBy, (isAcademic?'academic':'chapter') + ' reason=' + reason + ' until=' + endDate);
        return JSON.stringify({ success: true, message: name + ' suspended.' });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) { logError('placeSuspension', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function liftSuspension(memberId, performedBy) {
  try {
    performedBy = performedBy || 'Officer';
    var memSheet = getSpreadsheet().getSheetByName('members');
    var data = memSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(memberId)) {
        var name = _displayName(data[i], cm);
        ['suspension','suspension_reason','suspension_end','academic_suspension'].forEach(function(f) {
          if (cm[f] !== undefined) memSheet.getRange(i+1, cm[f]+1).setValue('');
        });
        if (cm['last_updated'] !== undefined) memSheet.getRange(i+1, cm['last_updated']+1).setValue(new Date().toISOString());
        _logAudit('liftSuspension', memberId, name, performedBy, '');
        return JSON.stringify({ success: true, message: 'Suspension lifted for ' + name + '.' });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) { logError('liftSuspension', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function placeProbation(memberId, type, reason, endDate, performedBy) {
  try {
    if (type !== 'chapter' && type !== 'social') return JSON.stringify({ success: false, error: 'type must be "chapter" or "social".' });
    performedBy = performedBy || 'Officer';
    var memSheet = getSpreadsheet().getSheetByName('members');
    var data = memSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(memberId)) {
        var name = _displayName(data[i], cm);
        if (cm['probation'] !== undefined)         memSheet.getRange(i+1, cm['probation']+1).setValue(true);
        if (cm['probation_type'] !== undefined)    memSheet.getRange(i+1, cm['probation_type']+1).setValue(type);
        if (cm['probation_reason'] !== undefined)  memSheet.getRange(i+1, cm['probation_reason']+1).setValue(reason || '');
        if (cm['probation_end'] !== undefined)     memSheet.getRange(i+1, cm['probation_end']+1).setValue(endDate || '');
        if (cm['last_updated'] !== undefined)      memSheet.getRange(i+1, cm['last_updated']+1).setValue(new Date().toISOString());
        _logAudit('placeProbation', memberId, name, performedBy, type + ' reason=' + reason + ' until=' + endDate);
        return JSON.stringify({ success: true, message: name + ' placed on ' + type + ' probation.' });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) { logError('placeProbation', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function liftProbation(memberId, performedBy) {
  try {
    performedBy = performedBy || 'Officer';
    var memSheet = getSpreadsheet().getSheetByName('members');
    var data = memSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(memberId)) {
        var name = _displayName(data[i], cm);
        ['probation','probation_type','probation_reason','probation_end'].forEach(function(f) {
          if (cm[f] !== undefined) memSheet.getRange(i+1, cm[f]+1).setValue('');
        });
        if (cm['last_updated'] !== undefined) memSheet.getRange(i+1, cm['last_updated']+1).setValue(new Date().toISOString());
        _logAudit('liftProbation', memberId, name, performedBy, '');
        return JSON.stringify({ success: true, message: 'Probation lifted for ' + name + '.' });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) { logError('liftProbation', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function setOfficerRole(memberId, role, performedBy) {
  try {
    performedBy = performedBy || 'Officer';
    var memSheet = getSpreadsheet().getSheetByName('members');
    var data = memSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(memberId)) {
        var name = _displayName(data[i], cm);
        if (cm['officer_role'] !== undefined) memSheet.getRange(i+1, cm['officer_role']+1).setValue(role || '');
        if (cm['last_updated'] !== undefined) memSheet.getRange(i+1, cm['last_updated']+1).setValue(new Date().toISOString());
        _logAudit('setOfficerRole', memberId, name, performedBy, 'role=' + role);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: 'Member not found.' });
  } catch (err) { logError('setOfficerRole', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Manual fine outside Monday automation
function issueFine(memberId, choreName, reason, performedBy) {
  try {
    performedBy = performedBy || 'Officer';
    var ss = getSpreadsheet();
    var members = _getMembersStructured();
    var member  = members.filter(function(m) { return m.memberId === memberId; })[0];
    if (!member) return JSON.stringify({ success: false, error: 'Member not found.' });
    var finesSheet = ss.getSheetByName('fines');
    if (!finesSheet) return JSON.stringify({ success: false, error: 'fines tab not found.' });
    var fid = 'F' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
    var weekStart = _normDate(getConfigValue('week_start'));
    finesSheet.appendRow([fid, memberId, choreName || 'Manual', weekStart, reason || 'Manual fine by officer', new Date().toISOString(), performedBy]);
    _logAudit('issueFine', memberId, member.name, performedBy, 'chore=' + choreName + ' reason=' + reason);
    return JSON.stringify({ success: true, fineId: fid });
  } catch (err) { logError('issueFine', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Internal helper: remove all chore assignments for a member
function _removeChoreAssignments(ss, memberId) {
  var asgSheet = ss.getSheetByName('chore_assignments');
  if (!asgSheet) return;
  var asgData = asgSheet.getDataRange().getValues();
  for (var i = asgData.length - 1; i >= 1; i--) {
    if (String(asgData[i][1]) === String(memberId)) asgSheet.deleteRow(i + 1);
  }
}

// ---- Member Notes ------------------------------------------

function addMemberNote(memberId, noteText, noteType, createdBy) {
  try {
    var validTypes = ['general','warning','disciplinary','positive','handoff'];
    if (validTypes.indexOf(noteType) === -1) noteType = 'general';
    var ss = getSpreadsheet();
    var notesSheet = ss.getSheetByName('member_notes');
    if (!notesSheet) {
      notesSheet = ss.insertSheet('member_notes');
      notesSheet.appendRow(['note_id','member_id','note_text','note_type','created_by','created_at']);
      notesSheet.setFrozenRows(1);
    }
    var nid = 'N' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
    notesSheet.appendRow([nid, memberId, noteText, noteType, createdBy || 'Officer', new Date().toISOString()]);
    return JSON.stringify({ success: true, noteId: nid });
  } catch (err) { logError('addMemberNote', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function getMemberNotes(memberId) {
  try {
    var notesSheet = getSpreadsheet().getSheetByName('member_notes');
    if (!notesSheet) return JSON.stringify({ success: true, notes: [] });
    var data = notesSheet.getDataRange().getValues();
    var cm = _buildColMap(data[0]);
    var notes = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][cm['member_id'] !== undefined ? cm['member_id'] : 1]) === String(memberId)) {
        notes.push({
          noteId:    String(data[i][cm['note_id']    !== undefined ? cm['note_id']    : 0] || ''),
          noteText:  String(data[i][cm['note_text']  !== undefined ? cm['note_text']  : 2] || ''),
          noteType:  String(data[i][cm['note_type']  !== undefined ? cm['note_type']  : 3] || ''),
          createdBy: String(data[i][cm['created_by'] !== undefined ? cm['created_by'] : 4] || ''),
          createdAt: String(data[i][cm['created_at'] !== undefined ? cm['created_at'] : 5] || '')
        });
      }
    }
    // Sort: handoff first, then newest first
    notes.sort(function(a, b) {
      if (a.noteType === 'handoff' && b.noteType !== 'handoff') return -1;
      if (b.noteType === 'handoff' && a.noteType !== 'handoff') return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return JSON.stringify({ success: true, notes: notes });
  } catch (err) { logError('getMemberNotes', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function getMemberHistory(memberId) {
  try {
    var logsSheet = getSpreadsheet().getSheetByName('logs');
    if (!logsSheet) return JSON.stringify({ success: true, history: [] });
    var data = logsSheet.getDataRange().getValues();
    var history = [];
    for (var i = 1; i < data.length; i++) {
      var msg = String(data[i][3] || '');
      if (msg.indexOf('member=' + memberId) !== -1) {
        history.push({ timestamp: String(data[i][0] || ''), level: String(data[i][1] || ''), action: String(data[i][2] || ''), details: msg });
      }
    }
    history.sort(function(a, b) { return b.timestamp.localeCompare(a.timestamp); });
    return JSON.stringify({ success: true, history: history });
  } catch (err) { logError('getMemberHistory', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// ---- Duplicate Detection -----------------------------------

function checkDuplicateMembers() {
  try {
    var members = _getMembersStructured();
    var emailSeen = {}, bkSeen = {}, dupes = [];
    members.forEach(function(m) {
      var em = (m.email || '').toLowerCase();
      if (em) {
        if (emailSeen[em]) dupes.push({ type: 'email', value: em, members: [emailSeen[em], m.name] });
        else emailSeen[em] = m.name;
      }
      if (m.bkNumber) {
        if (bkSeen[m.bkNumber]) dupes.push({ type: 'BK#', value: m.bkNumber, members: [bkSeen[m.bkNumber], m.name] });
        else bkSeen[m.bkNumber] = m.name;
      }
    });
    return JSON.stringify({ success: true, duplicates: dupes, count: dupes.length });
  } catch (err) { logError('checkDuplicateMembers', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function checkDuplicateMembersMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    var result = JSON.parse(checkDuplicateMembers());
    if (!result.success) { ui.alert('Error: ' + result.error); return; }
    if (!result.count) { ui.alert('No duplicates found.'); return; }
    var msg = result.duplicates.slice(0, 20).map(function(d) {
      return d.type + ': ' + d.value + ' → ' + d.members.join(', ');
    }).join('\n');
    ui.alert('Duplicate Members Found (' + result.count + ')', msg, ui.ButtonSet.OK);
  } catch (err) { ui.alert('Error: ' + err.toString()); }
}

// ---- Full Member Profile -----------------------------------

function getMemberFullProfile(memberId) {
  try {
    var ss = getSpreadsheet();
    var semester = getConfigValue('semester') || '';
    var members = _getMembersStructured();
    var member = members.filter(function(m) { return m.memberId === memberId; })[0];
    var isAlumnus = false;
    if (!member) {
      member = _getAlumniStructured().filter(function(m) { return m.memberId === memberId; })[0];
      if (member) { member.status = 'alumni'; isAlumnus = true; }
    }
    if (!member) return JSON.stringify({ success: false, error: 'Member not found.' });

    // Alumni have no chore/fine/submission history in the active sheets —
    // return the profile with those sections empty instead of erroring.
    if (isAlumnus) {
      return JSON.stringify({
        success: true, member: member, currentChore: null, assignments: [],
        fines: [], fineTotal: 0, notes: [], submissionsTotal: 0, submissionsPassed: 0,
        complianceRate: 100
      });
    }

    // Chore assignments
    var asgData  = ss.getSheetByName('chore_assignments').getDataRange().getValues();
    var assignments = [];
    for (var i = 1; i < asgData.length; i++) {
      if (String(asgData[i][1]) === String(memberId)) {
        assignments.push({ choreName: String(asgData[i][2] || ''), semester: String(asgData[i][4] || '') });
      }
    }

    // Fines this semester
    var fineData = ss.getSheetByName('fines').getDataRange().getValues();
    var fineAmount = Number(getConfigValue('fine_amount') || 5);
    var fines = [];
    for (var j = 1; j < fineData.length; j++) {
      if (String(fineData[j][1]) === String(memberId)) {
        fines.push({ fineId: String(fineData[j][0]||''), choreName: String(fineData[j][2]||''), weekStart: _normDate(fineData[j][3]), reason: String(fineData[j][4]||''), issuedBy: String(fineData[j][6]||'') });
      }
    }

    // Submissions
    var subData = ss.getSheetByName('submissions').getDataRange().getValues();
    var subsPassed = 0, subsTotal = 0;
    for (var k = 1; k < subData.length; k++) {
      if (String(subData[k][1]) === String(memberId)) {
        subsTotal++;
        if ((subData[k][8] === 'passed' && subData[k][9] !== 'failed') || subData[k][9] === 'verified') subsPassed++;
      }
    }

    // Notes
    var notesResult = JSON.parse(getMemberNotes(memberId));

    var semesterAssignments = assignments.filter(function(a) { return a.semester === semester; });
    var totalAssignments = semesterAssignments.length;
    var complianceRate = totalAssignments > 0 ? Math.round((subsPassed / totalAssignments) * 100) : 100;
    var currentChore = semesterAssignments.length > 0 ? semesterAssignments[semesterAssignments.length - 1].choreName : null;

    return JSON.stringify({
      success: true,
      member: member,
      currentChore: currentChore,
      assignments: assignments,
      fines: fines,
      fineTotal: fines.length * fineAmount,
      notes: notesResult.notes || [],
      submissionsTotal: subsTotal,
      submissionsPassed: subsPassed,
      complianceRate: complianceRate
    });
  } catch (err) { logError('getMemberFullProfile', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// ---- Ghost Detection ---------------------------------------

function runGhostDetection() {
  try {
    var ss = getSpreadsheet();
    var semester = getConfigValue('semester') || '';
    var subData  = ss.getSheetByName('submissions').getDataRange().getValues();
    var asgData  = ss.getSheetByName('chore_assignments').getDataRange().getValues();

    // Count recent submissions per member (last 3 weeks = last 3 weekly cycles in submissions)
    var subCount = {};
    for (var i = 1; i < subData.length; i++) {
      var mid = String(subData[i][1] || '');
      subCount[mid] = (subCount[mid] || 0) + 1;
    }

    // Active assigned members with zero submissions
    var assignedActive = {};
    for (var j = 1; j < asgData.length; j++) {
      if (asgData[j][4] === semester) assignedActive[String(asgData[j][1])] = String(asgData[j][2]);
    }

    var members = _getMembersStructured();
    var ghosts = [];
    members.forEach(function(m) {
      if (m.status !== 'active') return;
      if (m.suspension || m.academicSuspension) return;
      if (!assignedActive[m.memberId]) return;
      if (!subCount[m.memberId]) {
        ghosts.push({ memberId: m.memberId, name: m.name, chore: assignedActive[m.memberId] });
      }
    });

    if (ghosts.length > 0) {
      logInfo('runGhostDetection', 'Ghosts: ' + ghosts.map(function(g) { return g.name; }).join(', '));
    }

    return ghosts;
  } catch (err) { logError('runGhostDetection', err); return []; }
}

// ---- Manual Chore Completion -------------------------------

function markChoreComplete(memberId, choreName, officerName, notes) {
  try {
    officerName = officerName || 'Officer';
    var ss = getSpreadsheet();
    var members = _getMembersStructured();
    var member  = members.filter(function(m) { return m.memberId === memberId; })[0];
    if (!member) return JSON.stringify({ success: false, error: 'Member not found.' });
    if (!notes || !notes.trim()) return JSON.stringify({ success: false, error: 'Notes are required for manual completion.' });

    var subSheet = ss.getSheetByName('submissions');
    if (!subSheet) return JSON.stringify({ success: false, error: 'submissions tab not found.' });

    var sid = 'S' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
    var weekStart = _normDate(getConfigValue('week_start'));
    var semester  = getConfigValue('semester') || '';
    // submissions cols: sub_id, member_id, chore_name, week_start, submitted_at, photo_url, semester, group_id, auto_status, human_status, verified_by, notes
    subSheet.appendRow([sid, memberId, choreName, weekStart, new Date().toISOString(), '', semester, '', 'passed', 'verified', officerName, 'Manual completion: ' + notes]);
    _logAudit('markChoreComplete', memberId, member.name, officerName, 'chore=' + choreName + ' notes=' + notes);
    return JSON.stringify({ success: true, submissionId: sid });
  } catch (err) { logError('markChoreComplete', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// ---- Fraud Flagging ----------------------------------------

function flagFraud(submissionId, reason, flaggedBy) {
  try {
    flaggedBy = flaggedBy || 'Officer';
    var ss = getSpreadsheet();
    var subSheet = ss.getSheetByName('submissions');
    var data = subSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(submissionId)) {
        var memberId = String(data[i][1] || '');
        subSheet.getRange(i+1, 10).setValue('fraud');    // human_status col
        var prevNotes = String(data[i][11] || '');
        subSheet.getRange(i+1, 12).setValue((prevNotes ? prevNotes + ' | ' : '') + 'FRAUD FLAGGED by ' + flaggedBy + ': ' + reason);
        // Add disciplinary note to member
        addMemberNote(memberId, 'Submission flagged as fraudulent by ' + flaggedBy + '. Reason: ' + reason, 'disciplinary', flaggedBy);
        logInfo('flagFraud', 'submissionId=' + submissionId + ' memberId=' + memberId + ' flaggedBy=' + flaggedBy + ' reason=' + reason);
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: 'Submission not found.' });
  } catch (err) { logError('flagFraud', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// ---- Handoff Report ----------------------------------------

function generateHandoffReport() {
  try {
    var ss = getSpreadsheet();
    var semester  = getConfigValue('semester') || '—';
    var weekStart = _normDate(getConfigValue('week_start'));
    var fineAmt   = getConfigValue('fine_amount') || '5';
    var officers  = getConfigValue('officer_emails') || '—';
    var pin       = getConfigValue('officer_pin') || '(not set)';

    var members   = _getMembersStructured();
    var asgData   = ss.getSheetByName('chore_assignments').getDataRange().getValues();
    var fineData  = ss.getSheetByName('fines').getDataRange().getValues();
    var notesSheet= ss.getSheetByName('member_notes');

    // Build assignment map
    var asgMap = {};
    for (var i = 1; i < asgData.length; i++) {
      if (asgData[i][4] === semester) asgMap[String(asgData[i][1])] = String(asgData[i][2]);
    }
    // Build fine map
    var fineMap = {};
    for (var j = 1; j < fineData.length; j++) {
      var fid = String(fineData[j][1]);
      fineMap[fid] = (fineMap[fid] || 0) + 1;
    }
    // Handoff notes
    var handoffNotes = [];
    if (notesSheet && notesSheet.getLastRow() > 1) {
      var notesData = notesSheet.getDataRange().getValues();
      var ncm = _buildColMap(notesData[0]);
      for (var k = 1; k < notesData.length; k++) {
        if (String(notesData[k][ncm['note_type']||3]) === 'handoff') {
          var hMember = members.filter(function(m){ return m.memberId === String(notesData[k][ncm['member_id']||1]); })[0];
          handoffNotes.push({
            memberName: hMember ? hMember.name : String(notesData[k][ncm['member_id']||1]),
            text: String(notesData[k][ncm['note_text']||2]||''),
            createdBy: String(notesData[k][ncm['created_by']||4]||''),
            createdAt: String(notesData[k][ncm['created_at']||5]||'').substring(0,10)
          });
        }
      }
    }

    var activeRows = members.filter(function(m){ return m.status === 'active'; }).map(function(m){
      var flags = [];
      if (m.suspension || m.academicSuspension) flags.push('SUSPENDED');
      if (m.probation) flags.push('PROBATION(' + m.probationType + ')');
      if (fineMap[m.memberId]) flags.push(fineMap[m.memberId] + ' fines');
      return '<tr><td>' + m.bkNumber + '</td><td>' + m.name + '</td><td>' + (asgMap[m.memberId]||'—') + '</td>' +
        '<td>' + (m.officerRole||'—') + '</td><td>' + (flags.join(', ')||'—') + '</td></tr>';
    }).join('');

    var handoffRows = handoffNotes.map(function(n){
      return '<tr><td><strong>' + n.memberName + '</strong></td><td>' + n.text + '</td><td>' + n.createdBy + '</td><td>' + n.createdAt + '</td></tr>';
    }).join('') || '<tr><td colspan="4" style="color:#999">No handoff notes.</td></tr>';

    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<title>Officer Handoff — ' + semester + '</title>' +
      '<style>body{font-family:Arial,sans-serif;max-width:1100px;margin:0 auto;padding:24px;color:#0f172a}' +
      'h1{color:#093D20}h2{color:#093D20;border-bottom:2px solid #FFB71D;padding-bottom:4px}' +
      'table{width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px}' +
      'th{background:#093D20;color:#FFB71D;padding:8px;text-align:left}' +
      'td{padding:7px 8px;border-bottom:1px solid #eee}tr:hover td{background:#f8fafc}' +
      '.meta{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:24px}' +
      '.instructions{background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:16px}' +
      '@media print{button{display:none}}' +
      '</style></head><body>' +
      '<h1>Lambda Chi Alpha GT — Officer Handoff Report</h1>' +
      '<div class="meta">' +
      '<strong>Semester:</strong> ' + semester + ' | ' +
      '<strong>Current Week Start:</strong> ' + weekStart + ' | ' +
      '<strong>Fine Amount:</strong> $' + fineAmt + '<br>' +
      '<strong>Officer Emails:</strong> ' + officers + ' | ' +
      '<strong>Officer PIN:</strong> ' + pin +
      '</div>' +
      '<h2>Active Members (' + members.filter(function(m){return m.status==='active';}).length + ')</h2>' +
      '<table><thead><tr><th>BK#</th><th>Name</th><th>Chore</th><th>Officer Role</th><th>Flags</th></tr></thead>' +
      '<tbody>' + activeRows + '</tbody></table>' +
      '<h2>Outstanding Fines</h2>' +
      '<p>' + (fineData.length - 1) + ' fine record(s) this semester.</p>' +
      '<h2>Handoff Notes</h2>' +
      '<table><thead><tr><th>Member</th><th>Note</th><th>Left By</th><th>Date</th></tr></thead>' +
      '<tbody>' + handoffRows + '</tbody></table>' +
      '<div class="instructions"><h2>Instructions for Incoming Officers</h2>' +
      '<ul>' +
      '<li><strong>Update config:</strong> Admin tab → Config Editor → update semester, week_start, officer_emails, officer_pin</li>' +
      '<li><strong>Semester Sync:</strong> Admin tab → Semester Tools → Semester Sync (runs at start of each semester)</li>' +
      '<li><strong>Monday Reset:</strong> Runs automatically at 6am ET. Can also run manually from Admin tab → Fine Preview → "Send Fine List Now"</li>' +
      '<li><strong>QR Codes:</strong> Admin tab → Chore Manager → "Download All QR Codes (ZIP)" — reprint if chores change</li>' +
      '</ul></div>' +
      '<p style="color:#999;font-size:12px;margin-top:32px">Generated ' + new Date().toLocaleString() + '</p>' +
      '</body></html>';

    return JSON.stringify({ success: true, html: html });
  } catch (err) { logError('generateHandoffReport', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// ---- Change Officer PIN ------------------------------------

function changeOfficerPin(newPin, currentPin) {
  try {
    if (!_checkOfficerPin(currentPin)) return JSON.stringify({ success: false, error: 'Current PIN is incorrect.' });
    if (!newPin || String(newPin).length < 4) return JSON.stringify({ success: false, error: 'New PIN must be at least 4 characters.' });
    setConfigValue('officer_pin', String(newPin));
    logInfo('changeOfficerPin', 'Officer PIN changed.');
    return JSON.stringify({ success: true });
  } catch (err) { logError('changeOfficerPin', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// ---- Spec-required aliases and helpers ----------------------

// Returns all members as structured objects (alias for getMemberDirectoryData with full schema).
function getAllMembers() {
  try {
    var members = _getMembersStructured();
    return JSON.stringify({ success: true, members: members });
  } catch (err) { logError('getAllMembers', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Returns a single member's structured data by memberId.
function getMemberById(memberId) {
  try {
    if (!memberId) return JSON.stringify({ success: false, error: 'memberId is required.' });
    var member = _getMembersStructured().filter(function(m) { return m.memberId === String(memberId); })[0];
    if (!member) return JSON.stringify({ success: false, error: 'Member not found.' });
    return JSON.stringify({ success: true, member: member });
  } catch (err) { logError('getMemberById', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// PIN change alias: changedBy is the officer name/identifier (for audit logging).
// Validates against the stored PIN rather than accepting the current PIN as input.
function changePin(newPin, changedBy) {
  try {
    if (!newPin || String(newPin).length < 4) return JSON.stringify({ success: false, error: 'New PIN must be at least 4 characters.' });
    setConfigValue('officer_pin', String(newPin));
    logInfo('changePin', 'Officer PIN changed by ' + (changedBy || 'unknown') + '.');
    return JSON.stringify({ success: true });
  } catch (err) { logError('changePin', err); return JSON.stringify({ success: false, error: err.toString() }); }
}
