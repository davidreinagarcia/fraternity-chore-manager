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
  SpreadsheetApp.getUi()
    .createMenu('Chore System')
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
      case 'member':
      default:
        tmpl = HtmlService.createTemplateFromFile('MemberView');
        break;
    }
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
    for (let i = 1; i < existing.length; i++) emailMap[existing[i][2]] = i + 1;

    const csvEmails = new Set();
    let added = 0, updated = 0;

    for (let i = startIdx; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      if (cols.length < 2 || !cols[1]) continue;
      const [name, email, pledgeClass] = [cols[0], cols[1], cols[2] || ''];
      csvEmails.add(email);

      if (emailMap[email]) {
        sheet.getRange(emailMap[email], 2).setValue(name);
        sheet.getRange(emailMap[email], 4).setValue('active');
        sheet.getRange(emailMap[email], 5).setValue(pledgeClass);
        updated++;
      } else {
        const mid = 'M' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
        sheet.appendRow([mid, name, email, 'active', pledgeClass, new Date().toISOString()]);
        added++;
      }
    }

    // Deactivate members not in CSV
    const fresh = sheet.getDataRange().getValues();
    let deactivated = 0;
    for (let i = 1; i < fresh.length; i++) {
      if (!csvEmails.has(fresh[i][2]) && fresh[i][3] === 'active') {
        sheet.getRange(i + 1, 4).setValue('inactive');
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
    for (let i = 1; i < existing.length; i++) emailMap[existing[i][2]] = i + 1;

    const csvEmails = new Set();
    let added = 0, updated = 0;
    for (let i = startIdx; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      if (cols.length < 2 || !cols[1]) continue;
      const name = cols[0], email = cols[1], pledgeClass = cols[2] || '';
      csvEmails.add(email);
      if (emailMap[email]) {
        sheet.getRange(emailMap[email], 2).setValue(name);
        sheet.getRange(emailMap[email], 4).setValue('active');
        sheet.getRange(emailMap[email], 5).setValue(pledgeClass);
        updated++;
      } else {
        const mid = 'M' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
        sheet.appendRow([mid, name, email, 'active', pledgeClass, new Date().toISOString()]);
        added++;
      }
    }
    const fresh = sheet.getDataRange().getValues();
    let deactivated = 0;
    for (let i = 1; i < fresh.length; i++) {
      if (!csvEmails.has(fresh[i][2]) && fresh[i][3] === 'active') {
        sheet.getRange(i + 1, 4).setValue('inactive');
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
    const members       = memSheet.getDataRange().getValues();

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
    for (let i = 1; i < members.length; i++) {
      if (members[i][3] === 'active') {
        activeMems.add(members[i][0]);
        memName[members[i][0]] = members[i][1];
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

    // Email officers
    if (fineList.length > 0 && emailsRaw) {
      const emailList = emailsRaw.split(',').map(e => e.trim()).filter(Boolean);
      const rows = fineList.map(f =>
        `<tr><td style="padding:6px 12px">${f.memberName}</td>` +
        `<td style="padding:6px 12px">${f.choreName}</td>` +
        `<td style="padding:6px 12px">${weekStart}</td>` +
        `<td style="padding:6px 12px;text-align:center">$${fineAmount}</td></tr>`
      ).join('');
      const html = `<html><body style="font-family:Arial,sans-serif">
        <h2 style="color:#093D20">Chore Fine List — Week of ${weekStart}</h2>
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
        <p><strong>Total fines:</strong> ${fineList.length} ($${fineList.length * fineAmount})</p>
        <p style="color:#888;font-size:12px">Sent automatically by the Chore Management System.</p>
        </body></html>`;
      GmailApp.sendEmail(
        emailList.join(','),
        'Chore Fine List — Week of ' + weekStart,
        fineList.map(f => `${f.memberName}: ${f.choreName}`).join('\n'),
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

    logInfo('runMondayReset', `Fines:${fineList.length} | Next week:${nextMonday}`);

    try {
      SpreadsheetApp.getUi().alert(
        `Monday Reset Complete!\n\nFines issued: ${fineList.length}\nNext week: ${nextMonday}`
      );
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
    syncToBigQuery();
    const ss = getSpreadsheet();
    ['chore_assignments', 'submissions', 'fines', 'weekly_status'].forEach(function(name) {
      const sheet = ss.getSheetByName(name);
      if (!sheet) return;
      const last = sheet.getLastRow();
      if (last > 1) sheet.deleteRows(2, last - 1);
    });
    logInfo('endOfSemesterArchiveWeb', 'Semester archived via web app.');
    return JSON.stringify({ success: true });
  } catch (err) {
    logError('endOfSemesterArchiveWeb', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Spreadsheet-menu version (shows UI dialogs) — called from the custom menu.
function endOfSemesterArchive() {
  const ui = SpreadsheetApp.getUi();
  const ans = ui.alert(
    'End of Semester Archive',
    'This will:\n1. Push all data to BigQuery\n2. Clear assignments, submissions, fines, weekly_status\n3. Keep members intact\n\nContinue?',
    ui.ButtonSet.YES_NO
  );
  if (ans !== ui.Button.YES) return;

  try {
    syncToBigQuery();

    const ss = getSpreadsheet();
    ['chore_assignments', 'submissions', 'fines', 'weekly_status'].forEach(name => {
      const sheet = ss.getSheetByName(name);
      if (!sheet) return;
      const last = sheet.getLastRow();
      if (last > 1) sheet.deleteRows(2, last - 1);
    });

    logInfo('endOfSemesterArchive', 'Semester archived.');
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
    const memData   = ss.getSheetByName('members').getDataRange().getValues();

    const memMap = {};
    for (let i = 1; i < memData.length; i++) memMap[memData[i][0]] = memData[i][1];

    const grouped = {};
    for (let i = 1; i < asgData.length; i++) {
      const r = asgData[i];
      if (r[4] !== semester) continue;
      if (!grouped[r[2]]) grouped[r[2]] = [];
      grouped[r[2]].push({
        assignmentId: r[0],
        memberId: r[1],
        memberName: memMap[r[1]] || r[1],
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
    const memData    = ss.getSheetByName('members').getDataRange().getValues();
    const asgData    = ss.getSheetByName('chore_assignments').getDataRange().getValues();

    const active = [];
    for (let i = 1; i < memData.length; i++) {
      if (memData[i][3] === 'active') active.push({ id: memData[i][0], name: memData[i][1] });
    }

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
    const memData  = ss.getSheetByName('members').getDataRange().getValues();

    const memMap = {};
    for (let i = 1; i < memData.length; i++) memMap[memData[i][0]] = memData[i][1];

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
    const memData  = ss.getSheetByName('members').getDataRange().getValues();
    const subData  = ss.getSheetByName('submissions').getDataRange().getValues();
    const fineData = ss.getSheetByName('fines').getDataRange().getValues();
    const asgData  = ss.getSheetByName('chore_assignments').getDataRange().getValues();

    const stats = {};
    for (let i = 1; i < memData.length; i++) {
      if (memData[i][3] !== 'active') continue;
      stats[memData[i][0]] = { name: memData[i][1], subs: 0, fines: 0, assignments: 0 };
    }

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
    const data = getSpreadsheet().getSheetByName('members').getDataRange().getValues();
    const active = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][3] === 'active') {
        active.push({ id: data[i][0], name: data[i][1], email: data[i][2], pledgeClass: data[i][4] });
      }
    }
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
    const memData  = ss.getSheetByName('members').getDataRange().getValues();
    const memMap   = {};
    for (let i = 1; i < memData.length; i++) memMap[memData[i][0]] = memData[i][1];

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
