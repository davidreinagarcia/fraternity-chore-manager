// ============================================================
// CustomForms.gs — Member intake and semester-update forms
// ============================================================
// Handles: programmatic form creation, response tracking,
// deduplication, reminder emails, collection window management,
// and edge-case resolution (unmatched responses, status changes
// affecting chore assignments, late submissions).
//
// CONFIG KEYS used by this module (stored in 'config' sheet):
//   new_member_form_id          — Google Form ID after creation
//   new_member_form_url         — Public fill-in URL
//   returning_member_form_id    — Google Form ID after creation
//   returning_member_form_url   — Public fill-in URL
//   new_member_form_open        — 'true'/'false'
//   returning_member_form_open  — 'true'/'false'
//
// Sheet used by this module (created if missing):
//   form_responses_pending_review — stores unmatched returning-
//     member responses that need officer review before import.
// ============================================================

var PENDING_REVIEW_HEADERS = [
  'review_id','form_type','submitted_at','bk_number',
  'legal_first','legal_last','personal_email',
  'status_requested','raw_response_json','resolved','resolved_by','resolved_at'
];

// ---- Form creation -----------------------------------------

// Creates (or recreates) both member forms and links them to
// this spreadsheet. Old forms, if any, are simply abandoned
// (config is overwritten with the new IDs/URLs).
function createCustomForms(pin) {
  if (!_checkOfficerPin(pin)) {
    logError('createCustomForms', 'Unauthorized attempt — wrong PIN');
    return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  }
  try {
    var ss  = getSpreadsheet();
    var cfg = getChapterConfig();

    ensureTabsExist(); // make sure new_member_responses + returning_member_responses exist

    var nmResult = _cfCreateNewMemberForm(ss, cfg);
    var rmResult = _cfCreateReturningMemberForm(ss, cfg);

    setConfigValue('new_member_form_id',       nmResult.formId);
    setConfigValue('new_member_form_url',       nmResult.publicUrl);
    setConfigValue('returning_member_form_id',  rmResult.formId);
    setConfigValue('returning_member_form_url', rmResult.publicUrl);

    logInfo('createCustomForms',
      'NM form: ' + nmResult.formId + ' | RM form: ' + rmResult.formId);

    return JSON.stringify({
      success: true,
      newMemberForm:      { id: nmResult.formId, url: nmResult.publicUrl },
      returningMemberForm:{ id: rmResult.formId, url: rmResult.publicUrl }
    });
  } catch (err) {
    logError('createCustomForms', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Returns the stored form URLs from config (no auth required — officers
// and members both need the fill-in URLs).
function getCustomFormUrls() {
  try {
    return JSON.stringify({
      success: true,
      newMemberFormUrl:       String(getConfigValue('new_member_form_url')       || ''),
      returningMemberFormUrl: String(getConfigValue('returning_member_form_url') || ''),
      newMemberFormOpen:      String(getConfigValue('new_member_form_open')       || 'false') === 'true',
      returningMemberFormOpen:String(getConfigValue('returning_member_form_open') || 'false') === 'true'
    });
  } catch (err) {
    logError('getCustomFormUrls', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ---- New Member Form (pledges / AMs) -----------------------

function _cfCreateNewMemberForm(ss, cfg) {
  var chName   = cfg.chapter.chapter_name || 'Chapter';
  var semester = getConfigValue('semester') || '';

  var form = FormApp.create(chName + ' — New Member Form' + (semester ? ' (' + semester + ')' : ''));
  form.setDescription(
    'Welcome to ' + chName + '! Complete this form so we can add you to our system. ' +
    'All fields marked * are required.'
  );
  form.setCollectEmail(false);
  form.setAllowResponseEdits(true);
  form.setLimitOneResponsePerUser(false);
  form.setShowLinkToRespondAgain(true);

  _cfBuildNMFormItems(form, cfg);

  return _cfLinkFormToSheet(form, ss, 'new_member_responses');
}

function _cfBuildNMFormItems(form, cfg) {
  var emailValidation = FormApp.createTextValidation()
    .setHelpText('Please enter a valid email address.')
    .requireTextIsEmail()
    .build();

  // Internal field — hidden from members, filled by officers
  form.addTextItem()
    .setTitle('Bid Order')
    .setRequired(false)
    .setHelpText('Leave blank — officers will fill this in.');

  // Name
  form.addTextItem().setTitle('Legal First Name').setRequired(true);
  form.addTextItem()
    .setTitle('Preferred Name')
    .setRequired(false)
    .setHelpText('Nickname if different from legal name.');
  form.addTextItem().setTitle('Legal Last Name').setRequired(true);

  // Contact
  form.addTextItem().setTitle('Phone Number').setRequired(true);
  form.addTextItem()
    .setTitle('Personal Email')
    .setRequired(true)
    .setValidation(emailValidation);

  // University fields — always included; chapter can hide via Form settings
  // if module_university_fields is false. The column map in runSemesterSync
  // uses optional lookup so missing columns are silently skipped.
  form.addTextItem().setTitle('GTID').setRequired(false);
  form.addTextItem().setTitle('BuzzCard 6-Digit Code').setRequired(false);
  form.addTextItem().setTitle('GT Username').setRequired(false);
  form.addTextItem()
    .setTitle('GT Email')
    .setRequired(false)
    .setValidation(emailValidation);

  // Academic info
  form.addTextItem().setTitle('Major').setRequired(false);
  form.addTextItem()
    .setTitle('Year')
    .setRequired(false)
    .setHelpText('Freshman, Sophomore, Junior, Senior, or Graduate');
  form.addTextItem()
    .setTitle('Anticipated Graduation')
    .setRequired(false)
    .setHelpText('e.g. Spring 2027');
  form.addTextItem().setTitle('Hometown').setRequired(false);
  form.addTextItem()
    .setTitle('Birthday')
    .setRequired(false)
    .setHelpText('MM/DD/YYYY');

  // Apparel
  form.addMultipleChoiceItem()
    .setTitle('Shirt Size')
    .setRequired(false)
    .setChoiceValues(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']);

  // Dietary/medical
  form.addTextItem()
    .setTitle('Dietary Restrictions')
    .setRequired(false)
    .setHelpText('Leave blank if none.');

  form.addMultipleChoiceItem()
    .setTitle('Do you have a car on campus?')
    .setRequired(false)
    .setChoiceValues(['Yes', 'No']);

  form.addTextItem()
    .setTitle('Allergies')
    .setRequired(false)
    .setHelpText('Leave blank if none.');

  // Emergency contact
  form.addTextItem().setTitle('Emergency Contact Name').setRequired(true);
  form.addTextItem().setTitle('Emergency Contact Phone Number').setRequired(true);

  // Campus involvement
  form.addParagraphTextItem()
    .setTitle('Please list campus organizations...')
    .setRequired(false)
    .setHelpText('One per line or comma-separated. Leave blank if none.');

  form.addMultipleChoiceItem()
    .setTitle('Do you hold a leadership position...')
    .setRequired(false)
    .setChoiceValues(['Yes', 'No']);

  form.addTextItem()
    .setTitle('Which ones/what position?')
    .setRequired(false)
    .setHelpText('Fill in only if you answered Yes above.');

  form.addMultipleChoiceItem()
    .setTitle('Are any of these clubs service-based?')
    .setRequired(false)
    .setChoiceValues(['Yes', 'No', 'N/A']);

  // Meal plan
  if (cfg.modules.module_meal_plan) {
    var mealOpts = (cfg.options.meal_plan_options || 'Full,Half')
      .split(',').map(function(o) { return o.trim(); }).filter(Boolean);
    if (mealOpts.indexOf('No') === -1) mealOpts.push('No');
    form.addMultipleChoiceItem()
      .setTitle('Will you be on the meal plan?')
      .setRequired(false)
      .setChoiceValues(mealOpts);
  } else {
    form.addTextItem()
      .setTitle('Will you be on the meal plan?')
      .setRequired(false);
  }

  form.addParagraphTextItem()
    .setTitle('Anything else we should know?')
    .setRequired(false);
}

// ---- Returning Member Form (semester update) ----------------

function _cfCreateReturningMemberForm(ss, cfg) {
  var chName   = cfg.chapter.chapter_name || 'Chapter';
  var semester = getConfigValue('semester') || '';

  var form = FormApp.create(chName + ' — Returning Member Update' + (semester ? ' (' + semester + ')' : ''));
  form.setDescription(
    'Update your information for ' + (semester || 'this semester') + '. ' +
    'Only fields you actually change need to be filled in — blank answers will NOT overwrite existing data.'
  );
  form.setCollectEmail(false);
  form.setAllowResponseEdits(true);
  form.setLimitOneResponsePerUser(false);
  form.setShowLinkToRespondAgain(true);

  _cfBuildRMFormItems(form, cfg);

  return _cfLinkFormToSheet(form, ss, 'returning_member_responses');
}

function _cfBuildRMFormItems(form, cfg) {
  // BK# is the primary lookup key in runSemesterSync
  form.addTextItem()
    .setTitle('BK #')
    .setRequired(false)
    .setHelpText('Your 4-digit BK number. Strongly recommended — without it we match by name only.');

  form.addTextItem().setTitle('Legal First Name').setRequired(true);
  form.addTextItem().setTitle('Legal Last Name').setRequired(true);

  // Status
  var statusOpts = ['Active', 'Inactive', 'Inactive (Co-op)', 'Inactive (Study Abroad)', 'Graduated'];
  form.addMultipleChoiceItem()
    .setTitle('Status this semester')
    .setRequired(true)
    .setChoiceValues(statusOpts);

  // Housing
  if (cfg.modules.module_housing) {
    form.addMultipleChoiceItem()
      .setTitle('Are you living in the house?')
      .setRequired(false)
      .setChoiceValues(['Yes', 'No']);
  } else {
    form.addTextItem()
      .setTitle('Are you living in the house?')
      .setRequired(false);
  }

  // Meal plan
  if (cfg.modules.module_meal_plan) {
    var mealOpts = (cfg.options.meal_plan_options || 'Full,Half')
      .split(',').map(function(o) { return o.trim(); }).filter(Boolean);
    if (mealOpts.indexOf('No') === -1) mealOpts.push('No');
    form.addMultipleChoiceItem()
      .setTitle('Will you be on the meal plan?')
      .setRequired(false)
      .setChoiceValues(mealOpts);
  } else {
    form.addTextItem()
      .setTitle('Will you be on the meal plan?')
      .setRequired(false);
  }

  // Academic info
  form.addTextItem().setTitle('Major').setRequired(false);
  form.addTextItem()
    .setTitle('Year')
    .setRequired(false)
    .setHelpText('Freshman, Sophomore, Junior, Senior, or Graduate');
  form.addTextItem()
    .setTitle('Anticipated Graduation')
    .setRequired(false)
    .setHelpText('e.g. Spring 2027');

  // Campus involvement
  form.addParagraphTextItem()
    .setTitle('Please list campus organizations...')
    .setRequired(false)
    .setHelpText('Update only if changed since last semester.');

  form.addMultipleChoiceItem()
    .setTitle('Do you hold a leadership position...')
    .setRequired(false)
    .setChoiceValues(['Yes', 'No']);

  form.addTextItem()
    .setTitle('If so, which ones and what positions?')
    .setRequired(false);

  form.addMultipleChoiceItem()
    .setTitle('Are any of these service-based?')
    .setRequired(false)
    .setChoiceValues(['Yes', 'No', 'N/A']);

  form.addMultipleChoiceItem()
    .setTitle('Do you have a car on campus?')
    .setRequired(false)
    .setChoiceValues(['Yes', 'No']);

  form.addMultipleChoiceItem()
    .setTitle('T-Shirt Size')
    .setRequired(false)
    .setChoiceValues(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']);

  form.addParagraphTextItem()
    .setTitle('Anything else we should know?')
    .setRequired(false);
}

// ---- Form → Sheet linking ----------------------------------

// Links form to spreadsheet, waits for the auto-created response
// sheet, then renames it to expectedSheetName. If expectedSheetName
// already exists and is empty, it is deleted first so the rename
// succeeds cleanly.
function _cfLinkFormToSheet(form, ss, expectedSheetName) {
  // Drop any existing destination so we can re-link cleanly
  try { form.removeDestination(); } catch (_) {}

  var sheetIdsBefore = ss.getSheets().map(function(s) { return s.getSheetId(); });

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  // Wait for the response sheet to be created
  Utilities.sleep(2500);

  var responseSheet = null;
  var sheetsAfter = ss.getSheets();
  for (var i = 0; i < sheetsAfter.length; i++) {
    if (sheetIdsBefore.indexOf(sheetsAfter[i].getSheetId()) === -1) {
      responseSheet = sheetsAfter[i];
      break;
    }
  }

  if (!responseSheet) {
    // Fallback: find by title pattern (Form creates "Form Responses N")
    for (var j = 0; j < sheetsAfter.length; j++) {
      var n = sheetsAfter[j].getName();
      if (n.indexOf('Form Responses') !== -1 || n.indexOf(form.getTitle().substring(0, 10)) !== -1) {
        responseSheet = sheetsAfter[j];
        break;
      }
    }
  }

  if (responseSheet) {
    // If the target sheet exists and is empty (just a header row or less), remove it
    var existing = ss.getSheetByName(expectedSheetName);
    if (existing && existing.getSheetId() !== responseSheet.getSheetId()) {
      if (existing.getLastRow() <= 1) {
        ss.deleteSheet(existing);
      } else {
        // Target sheet has data — keep it, log the collision
        logInfo('_cfLinkFormToSheet',
          'Sheet "' + expectedSheetName + '" already has data; form will write to "' +
          responseSheet.getName() + '" — rename manually if needed.');
        setConfigValue(expectedSheetName + '_sheet_override', responseSheet.getName());
        return {
          formId:    form.getId(),
          publicUrl: form.getPublishedUrl(),
          editUrl:   form.getEditUrl()
        };
      }
    }
    try {
      responseSheet.setName(expectedSheetName);
    } catch (_) {
      logInfo('_cfLinkFormToSheet',
        'Could not rename to "' + expectedSheetName + '" — using: ' + responseSheet.getName());
    }
  }

  return {
    formId:    form.getId(),
    publicUrl: form.getPublishedUrl(),
    editUrl:   form.getEditUrl()
  };
}

// ============================================================
// Collection window management
// ============================================================

// Opens or closes the collection window for the given form type
// ('new' or 'returning'). Officers call this to control when
// members can submit forms.
function setFormCollectionWindow(formType, isOpen, pin) {
  if (!_checkOfficerPin(pin)) {
    logError('setFormCollectionWindow', 'Unauthorized attempt — wrong PIN');
    return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  }
  try {
    var key = formType === 'new' ? 'new_member_form_open' : 'returning_member_form_open';
    var val = isOpen ? 'true' : 'false';
    setConfigValue(key, val);
    logInfo('setFormCollectionWindow', formType + ' = ' + val);
    return JSON.stringify({ success: true, formType: formType, open: isOpen });
  } catch (err) {
    logError('setFormCollectionWindow', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Returns true if the collection window for formType is open.
function isFormCollectionOpen(formType) {
  try {
    var key = formType === 'new' ? 'new_member_form_open' : 'returning_member_form_open';
    return String(getConfigValue(key) || 'false').toLowerCase() === 'true';
  } catch (_) { return false; }
}

// ============================================================
// Response tracking
// ============================================================

// Returns tracking data for both forms:
//   returning: which active members have/haven't submitted
//   new:       raw count of responses + how many became AMs
function getFormResponseStatus() {
  try {
    var ss = getSpreadsheet();
    var semester = getConfigValue('semester') || '';

    // ---- Returning members ----
    var responded = [], pending = [];
    var memData = [];
    var memSheet = ss.getSheetByName('members');
    if (memSheet) memData = memSheet.getDataRange().getValues();
    var amSheet  = ss.getSheetByName('AMs');
    var amData   = amSheet ? amSheet.getDataRange().getValues() : [];

    var _scanForFormStatus = function(rows) {
      if (!rows.length) return;
      var cm = _buildColMap(rows[0]);
      var fcCol  = cm['form_completed_this_semester'];
      var stCol  = cm['status'] !== undefined ? cm['status'] : 4;
      for (var i = 1; i < rows.length; i++) {
        var st = String(rows[i][stCol] || '');
        if (st !== 'active' && st !== 'associate' && st !== 'inactive') continue;
        var name = _displayName(rows[i], cm);
        var completed = fcCol !== undefined ? !!rows[i][fcCol] : false;
        if (completed) {
          responded.push(name);
        } else if (st === 'active' || st === 'associate') {
          pending.push(name);
        }
      }
    };
    _scanForFormStatus(memData);
    _scanForFormStatus(amData);

    // ---- New member responses (pledges/AMs not yet in system) ----
    var nmSheet = ss.getSheetByName('new_member_responses');
    var nmResponseCount = nmSheet && nmSheet.getLastRow() > 1 ? nmSheet.getLastRow() - 1 : 0;

    var amCount = 0;
    var amThisSemester = _getMembersStructured('AMs').filter(function(m) {
      return m.pledgeClass === semester;
    });
    amCount = amThisSemester.length;

    // Pending review
    var prSheet = ss.getSheetByName('form_responses_pending_review');
    var pendingReviewCount = 0;
    if (prSheet && prSheet.getLastRow() > 1) {
      var prData = prSheet.getDataRange().getValues();
      var prCM = _buildColMap(prData[0]);
      var resolvedCol = prCM['resolved'];
      for (var p = 1; p < prData.length; p++) {
        var isResolved = resolvedCol !== undefined && prData[p][resolvedCol];
        if (!isResolved) pendingReviewCount++;
      }
    }

    return JSON.stringify({
      success: true,
      returningForm: {
        responded:   responded,
        pending:     pending,
        total:       responded.length + pending.length,
        respondedCount: responded.length,
        pendingCount:   pending.length,
        completionPct:  (responded.length + pending.length > 0)
          ? Math.round(responded.length / (responded.length + pending.length) * 100)
          : 100,
        windowOpen: isFormCollectionOpen('returning')
      },
      newMemberForm: {
        responseCount:    nmResponseCount,
        processedAsAMs:   amCount,
        pendingProcessing: Math.max(0, nmResponseCount - amCount),
        windowOpen: isFormCollectionOpen('new')
      },
      pendingReviewCount: pendingReviewCount
    });
  } catch (err) {
    logError('getFormResponseStatus', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Returns detailed list of members who have NOT submitted the given
// form type. formType: 'returning' or 'new'.
function getFormNonRespondersJson(formType) {
  try {
    if (formType === 'returning') {
      return _cfGetReturningNonResponders();
    }
    return _cfGetNewMemberFormStats();
  } catch (err) {
    logError('getFormNonRespondersJson', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

function _cfGetReturningNonResponders() {
  var ss = getSpreadsheet();
  var nonResponders = [];

  var _scan = function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (!data.length) return;
    var cm = _buildColMap(data[0]);
    var fcCol = cm['form_completed_this_semester'];
    var stCol = cm['status'] !== undefined ? cm['status'] : 4;
    var emCol = cm['personal_email'] !== undefined ? cm['personal_email']
              : cm['email'] !== undefined ? cm['email'] : 3;
    for (var i = 1; i < data.length; i++) {
      var st = String(data[i][stCol] || '');
      if (st !== 'active' && st !== 'associate') continue;
      if (fcCol !== undefined && data[i][fcCol]) continue;
      nonResponders.push({
        memberId:    String(data[i][0] || ''),
        name:        _displayName(data[i], cm),
        email:       String(data[i][emCol] || ''),
        status:      st,
        pledgeClass: cm['pledge_class'] !== undefined ? String(data[i][cm['pledge_class']] || '') : ''
      });
    }
  };

  _scan('members');
  _scan('AMs');

  nonResponders.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return JSON.stringify({ success: true, formType: 'returning', nonResponders: nonResponders, count: nonResponders.length });
}

function _cfGetNewMemberFormStats() {
  var ss = getSpreadsheet();
  var nmSheet = ss.getSheetByName('new_member_responses');
  var responses = [];

  if (nmSheet && nmSheet.getLastRow() > 1) {
    var data = nmSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    var emailCol = cm['Personal Email'] !== undefined ? cm['Personal Email'] : 6;
    var firstCol = cm['Legal First Name'] !== undefined ? cm['Legal First Name'] : 2;
    var lastCol  = cm['Legal Last Name']  !== undefined ? cm['Legal Last Name']  : 4;
    var tsCol    = cm['Timestamp']        !== undefined ? cm['Timestamp']        : 0;

    for (var i = 1; i < data.length; i++) {
      responses.push({
        email:     String(data[i][emailCol] || ''),
        name:      (String(data[i][firstCol] || '') + ' ' + String(data[i][lastCol] || '')).trim(),
        timestamp: data[i][tsCol] ? String(data[i][tsCol]) : ''
      });
    }
  }

  return JSON.stringify({ success: true, formType: 'new', responses: responses, count: responses.length });
}

// ============================================================
// Deduplication
// ============================================================

// Deduplicates both form response sheets: keeps the MOST RECENT
// response per key (email for NM form; BK# → name fallback for RM form).
// Safe to call multiple times — idempotent.
// Returns summary { nmRemoved, rmRemoved }.
function deduplicateFormResponses(pin) {
  // PIN is optional here — this is called internally by runSemesterSync
  // without a PIN. When called from the officer UI, a PIN is supplied.
  if (pin && !_checkOfficerPin(pin)) {
    logError('deduplicateFormResponses', 'Unauthorized attempt — wrong PIN');
    return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  }
  try {
    var ss = getSpreadsheet();

    var nmSheet = ss.getSheetByName('new_member_responses');
    var nmResult = nmSheet ? _cfDeduplicateSheet(nmSheet, 'Personal Email') : { removed: 0 };

    var rmSheet = ss.getSheetByName('returning_member_responses');
    var rmResult = rmSheet ? _cfDeduplicateSheet(rmSheet, 'BK #') : { removed: 0 };

    logInfo('deduplicateFormResponses',
      'NM removed: ' + nmResult.removed + ' | RM removed: ' + rmResult.removed);

    return JSON.stringify({
      success: true,
      newMemberDupsRemoved:      nmResult.removed,
      returningMemberDupsRemoved: rmResult.removed
    });
  } catch (err) {
    logError('deduplicateFormResponses', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Deduplicates a response sheet by keyHeader column, keeping the row
// with the latest Timestamp per unique key value. Rows with no key
// value are left untouched. Operates bottom-to-top to preserve indices.
function _cfDeduplicateSheet(sheet, keyHeader) {
  if (!sheet || sheet.getLastRow() <= 1) return { removed: 0 };

  var data   = sheet.getDataRange().getValues();
  var cm     = _buildColMap(data[0]);
  var keyCol = cm[keyHeader];
  var tsCol  = cm['Timestamp'] !== undefined ? cm['Timestamp'] : 0;

  if (keyCol === undefined) return { removed: 0 };

  // Find the latest-timestamp row index for each unique key
  var latestByKey = {};
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][keyCol] || '').trim().toLowerCase();
    if (!key) continue;
    var rawTs = data[i][tsCol];
    var ts = rawTs instanceof Date ? rawTs.getTime() : new Date(String(rawTs || 0)).getTime();
    if (!latestByKey[key] || ts > latestByKey[key].ts) {
      latestByKey[key] = { rowIdx: i, ts: ts };
    }
  }

  var keepSet = {};
  Object.keys(latestByKey).forEach(function(k) { keepSet[latestByKey[k].rowIdx] = true; });

  // Collect rows to delete (have a key but aren't the latest for that key)
  var toDelete = [];
  for (var j = 1; j < data.length; j++) {
    var k2 = String(data[j][keyCol] || '').trim().toLowerCase();
    if (k2 && !keepSet[j]) toDelete.push(j + 1); // 1-indexed
  }

  // Delete from bottom to top so indices stay valid
  toDelete.sort(function(a, b) { return b - a; });
  toDelete.forEach(function(rowNum) { sheet.deleteRow(rowNum); });

  return { removed: toDelete.length };
}

// ============================================================
// Reminder emails
// ============================================================

// Sends reminder emails to members who have NOT submitted the
// specified form. formType: 'returning'. (For 'new' there is no
// pre-existing roster to compare against.)
function sendFormReminders(formType, pin) {
  if (!_checkOfficerPin(pin)) {
    logError('sendFormReminders', 'Unauthorized attempt — wrong PIN');
    return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  }
  try {
    if (formType !== 'returning') {
      return JSON.stringify({ success: false, error: 'Reminders are only supported for the returning-member form.' });
    }

    var formUrl   = String(getConfigValue('returning_member_form_url') || '');
    if (!formUrl) {
      return JSON.stringify({ success: false, error: 'Returning member form URL not configured. Create the form first.' });
    }

    var status   = JSON.parse(_cfGetReturningNonResponders());
    if (!status.success) return JSON.stringify(status);

    var nonResponders = status.nonResponders;
    if (!nonResponders.length) {
      return JSON.stringify({ success: true, sent: 0, message: 'All active members have already responded.' });
    }

    var chName  = getChapterConfig().chapter.chapter_name || 'Chapter';
    var semester = getConfigValue('semester') || 'this semester';
    var subject  = '[' + chName + '] Reminder: Please submit your semester update form';
    var bodyHtml =
      '<p>Hi,</p>' +
      '<p>This is a reminder to submit your semester update form for <strong>' + semester + '</strong>.</p>' +
      '<p><a href="' + formUrl + '" style="display:inline-block;background:#093D20;color:#FFB71D;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700">Fill Out Form</a></p>' +
      '<p>It only takes a few minutes. If your information hasn\'t changed, you can still submit to confirm everything is up to date.</p>' +
      '<p style="color:#666;font-size:12px">Sent by ' + chName + ' Chore System</p>';

    var sent = 0, skipped = 0;
    nonResponders.forEach(function(m) {
      if (!m.email) { skipped++; return; }
      try {
        GmailApp.sendEmail(m.email, subject, 'Please submit your semester update form: ' + formUrl,
          { htmlBody: bodyHtml, name: chName });
        sent++;
      } catch (emailErr) {
        logError('sendFormReminders', 'Failed to email ' + m.email + ': ' + emailErr);
        skipped++;
      }
    });

    logInfo('sendFormReminders', 'Sent: ' + sent + ' | Skipped (no email): ' + skipped);
    return JSON.stringify({ success: true, sent: sent, skipped: skipped, total: nonResponders.length });
  } catch (err) {
    logError('sendFormReminders', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// ============================================================
// Edge-case handling — called by runSemesterSync
// ============================================================

// Ensures the form_responses_pending_review sheet exists.
function _cfEnsurePendingReviewSheet(ss) {
  var sheet = ss.getSheetByName('form_responses_pending_review');
  if (!sheet) {
    sheet = ss.insertSheet('form_responses_pending_review');
    sheet.appendRow(PENDING_REVIEW_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Writes an unmatched returning-member form response to the
// pending-review queue. Officers can see these in the Admin tab.
function _cfQueuePendingReview(ss, formType, rr, rmCM) {
  try {
    var prSheet = _cfEnsurePendingReviewSheet(ss);
    var rid = 'PR' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
    var submittedAt = rr[rmCM['Timestamp'] !== undefined ? rmCM['Timestamp'] : 0];
    var bkNum  = String(rr[rmCM['BK #']           !== undefined ? rmCM['BK #']           : 1] || '');
    var first  = String(rr[rmCM['Legal First Name']!== undefined ? rmCM['Legal First Name']: 2] || '');
    var last   = String(rr[rmCM['Legal Last Name'] !== undefined ? rmCM['Legal Last Name'] : 3] || '');
    var statusReq = String(rr[rmCM['Status this semester'] !== undefined ? rmCM['Status this semester'] : 4] || '');
    var raw = JSON.stringify(rr.map(function(v) { return v instanceof Date ? v.toISOString() : v; }));
    prSheet.appendRow([rid, formType, submittedAt ? String(submittedAt) : new Date().toISOString(),
      bkNum, first, last, '', statusReq, raw, false, '', '']);
  } catch (err) {
    logError('_cfQueuePendingReview', err);
  }
}

// Applies status changes declared in the returning member form to
// the member row found at matchRow in memData/memSheet. Also removes
// chore assignments when a member goes inactive.
// Returns: 'inactive' | 'active' | 'grad_candidate' | '' (no change).
function _cfApplyStatusFromForm(rr, rmCM, matchRow, memData, memSheet, memCM, ss) {
  var statusCol = rmCM['Status this semester'];
  if (statusCol === undefined) return '';

  var raw = String(rr[statusCol] || '').trim().toLowerCase();
  if (!raw) return '';

  var memberId = String(memData[matchRow][0] || '');

  // Map form values to internal status codes
  if (raw === 'inactive' || raw.indexOf('inactive') !== -1) {
    if (memCM['status']          !== undefined) memSheet.getRange(matchRow+1, memCM['status']+1).setValue('inactive');
    if (memCM['inactive_reason'] !== undefined) {
      var reason = raw.indexOf('co-op') !== -1 ? 'co-op'
        : raw.indexOf('study abroad') !== -1 ? 'study_abroad' : 'voluntary';
      memSheet.getRange(matchRow+1, memCM['inactive_reason']+1).setValue(reason);
    }
    if (memberId) _removeChoreAssignments(ss, memberId);
    return 'inactive';
  }

  if (raw === 'active') {
    if (memCM['status']          !== undefined) memSheet.getRange(matchRow+1, memCM['status']+1).setValue('active');
    if (memCM['inactive_reason'] !== undefined) memSheet.getRange(matchRow+1, memCM['inactive_reason']+1).setValue('');
    return 'active';
  }

  if (raw === 'graduated') {
    return 'grad_candidate';
  }

  return '';
}

// Returns whether a form submission timestamp falls outside the
// configured collection window. Returns false (not late) when no
// window is configured for the given formType.
function _cfIsLateSubmission(submittedAt, formType) {
  try {
    var openKey  = formType === 'new' ? 'new_member_form_open'  : 'returning_member_form_open';
    var isOpen   = String(getConfigValue(openKey) || 'true').toLowerCase();
    // If window is currently open, nothing is "late"
    if (isOpen === 'true') return false;
    // Window is closed — any response that arrived after it closed is late.
    // Since we don't store a close timestamp, treat "window closed" as
    // "flag for info only" rather than blocking processing.
    return isOpen === 'false';
  } catch (_) { return false; }
}

// ============================================================
// Pending review management (officer UI)
// ============================================================

// Returns all unresolved pending-review entries.
function getPendingReviewEntries(pin) {
  if (!_checkOfficerPin(pin)) {
    return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  }
  try {
    var ss = getSpreadsheet();
    var prSheet = ss.getSheetByName('form_responses_pending_review');
    if (!prSheet || prSheet.getLastRow() <= 1) {
      return JSON.stringify({ success: true, entries: [] });
    }
    var data = prSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    var entries = [];
    for (var i = 1; i < data.length; i++) {
      var resolved = cm['resolved'] !== undefined && data[i][cm['resolved']];
      if (resolved) continue;
      entries.push({
        reviewId:        String(data[i][cm['review_id']        || 0] || ''),
        formType:        String(data[i][cm['form_type']        || 1] || ''),
        submittedAt:     String(data[i][cm['submitted_at']     || 2] || ''),
        bkNumber:        String(data[i][cm['bk_number']        || 3] || ''),
        legalFirst:      String(data[i][cm['legal_first']      || 4] || ''),
        legalLast:       String(data[i][cm['legal_last']       || 5] || ''),
        statusRequested: String(data[i][cm['status_requested'] || 7] || ''),
        rowNum: i + 1
      });
    }
    return JSON.stringify({ success: true, entries: entries });
  } catch (err) {
    logError('getPendingReviewEntries', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}

// Marks a pending-review entry as resolved (officer has handled it manually).
function resolvePendingReview(reviewId, resolvedBy, pin) {
  if (!_checkOfficerPin(pin)) {
    return JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
  }
  try {
    var ss = getSpreadsheet();
    var prSheet = ss.getSheetByName('form_responses_pending_review');
    if (!prSheet) return JSON.stringify({ success: false, error: 'No pending review sheet found.' });
    var data = prSheet.getDataRange().getValues();
    var cm   = _buildColMap(data[0]);
    var ridCol = cm['review_id'] !== undefined ? cm['review_id'] : 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][ridCol]) === String(reviewId)) {
        if (cm['resolved']    !== undefined) prSheet.getRange(i+1, cm['resolved']+1).setValue(true);
        if (cm['resolved_by'] !== undefined) prSheet.getRange(i+1, cm['resolved_by']+1).setValue(resolvedBy || 'Officer');
        if (cm['resolved_at'] !== undefined) prSheet.getRange(i+1, cm['resolved_at']+1).setValue(new Date().toISOString());
        logInfo('resolvePendingReview', reviewId + ' resolved by ' + (resolvedBy || 'Officer'));
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, error: 'Entry not found.' });
  } catch (err) {
    logError('resolvePendingReview', err);
    return JSON.stringify({ success: false, error: err.toString() });
  }
}
