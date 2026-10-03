// ============================================================
// Forms.gs — native form builder. Officers define a form (fields, audience,
// due date, optional review + action) in the dashboard; members answer it on
// the public page ?app=form&f=<form_id> (FormApp.html), identified by picking
// their name from the roster. Definitions live in tab `forms`, answers in
// `form_responses` (answers JSON keyed by field id). Separate from the
// semester Google Forms (CustomForms.gs).
//
// An optional `action` gives a form behavior. 'absence': an event field marks
// that member as excused for that event; the excuse is DERIVED from the
// responses (approved, or any non-denied when review is off) so there is no
// second copy of the state to keep in sync. See _fmExcusesForEvent.
// 'philanthropy': a number field (hours) + a photo field (proof); approved
// hours are summed per member by fmPhilanthropySummary for the Philanthropy page.
// ============================================================

var FM_HEADERS = ['form_id', 'title', 'description', 'status', 'audience', 'fields', 'due_date', 'requires_review', 'allow_multiple', 'action', 'created_by', 'created_at', 'updated_at', 'category'];
var FM_CATEGORIES = ['general', 'finance', 'philanthropy', 'rush', 'events'];
var FM_RESP_HEADERS = ['response_id', 'form_id', 'member_id', 'member_type', 'member_name', 'answers', 'submitted_at', 'review_status', 'reviewed_by', 'reviewed_at', 'review_note'];
var FM_FIELD_TYPES = ['text', 'textarea', 'choice', 'multi', 'number', 'date', 'yesno', 'event', 'photo', 'list', 'info'];
var FM_AUDIENCES = ['brothers', 'novatos', 'everyone'];
var FM_MAX_FIELDS = 40;
var FM_MAX_PHOTOS = 6;
var FM_MAX_LIST = 30;
var FM_MAX_HOURS = 100;

// All columns are text ('@'): ISO timestamps and yyyy-MM-dd dates must not be
// auto-parsed into Date cells (see the dates rule in CLAUDE.md).
function _fmSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
  }
  return sheet;
}

// Sheets created before the category column existed get it appended once.
function _fmEnsureColumns(sheet) {
  try {
    var lc = sheet.getLastColumn();
    if (lc < 1) return;
    var head = sheet.getRange(1, 1, 1, lc).getValues()[0].map(String);
    FM_HEADERS.forEach(function(h) {
      if (head.indexOf(h) !== -1) return;
      head.push(h);
      sheet.getRange(1, head.length, sheet.getMaxRows(), 1).setNumberFormat('@');
      sheet.getRange(1, head.length).setValue(h);
    });
  } catch (e) { logError('_fmEnsureColumns', e); }
}

function _fmJson(s, fallback) {
  try { var v = JSON.parse(String(s || '')); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
}

function _fmDeny(pin) {
  return _checkOfficerPin(pin) ? null : JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
}

function _fmNewId(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase(); }

function _fmFormFromRow(r, cm, rowNum) {
  function g(k) { return cm[k] === undefined ? '' : r[cm[k]]; }
  var audience = String(g('audience'));
  var action = _fmJson(g('action'), { type: 'none' });
  var category = String(g('category'));
  if (FM_CATEGORIES.indexOf(category) === -1 || category === 'general') {
    category = action && (action.type === 'philanthropy' || action.type === 'service_event') ? 'philanthropy' : 'general';
  }
  return {
    formId: String(g('form_id')),
    title: String(g('title')),
    description: String(g('description')),
    status: String(g('status')) === 'closed' ? 'closed' : 'open',
    audience: FM_AUDIENCES.indexOf(audience) === -1 ? 'brothers' : audience,
    fields: _fmJson(g('fields'), []),
    dueDate: String(g('due_date') || '').substring(0, 10),
    requiresReview: String(g('requires_review')) === 'Y',
    allowMultiple: String(g('allow_multiple')) === 'Y',
    action: action && action.type ? action : { type: 'none' },
    createdBy: String(g('created_by')),
    createdAt: String(g('created_at')),
    updatedAt: String(g('updated_at')),
    category: category,
    _rowNum: rowNum
  };
}

function _fmReadForms(ss) {
  var data = _fmSheet(ss, 'forms', FM_HEADERS).getDataRange().getValues();
  var cm = _buildColMap(data[0]);
  if (cm['category'] === undefined) _fmEnsureColumns(_fmSheet(ss, 'forms', FM_HEADERS));
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][cm['form_id']]) out.push(_fmFormFromRow(data[i], cm, i + 1));
  }
  return out;
}

function _fmFindForm(ss, formId) {
  var forms = _fmReadForms(ss);
  for (var i = 0; i < forms.length; i++) if (forms[i].formId === String(formId)) return forms[i];
  return null;
}

function _fmReadResponses(ss, formId) {
  var data = _fmSheet(ss, 'form_responses', FM_RESP_HEADERS).getDataRange().getValues();
  var cm = _buildColMap(data[0]);
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[cm['response_id']]) continue;
    if (formId && String(r[cm['form_id']]) !== String(formId)) continue;
    out.push({
      responseId: String(r[cm['response_id']]),
      formId: String(r[cm['form_id']]),
      memberId: String(r[cm['member_id']]),
      memberType: String(r[cm['member_type']]),
      memberName: String(r[cm['member_name']]),
      answers: _fmJson(r[cm['answers']], {}),
      submittedAt: String(r[cm['submitted_at']]),
      reviewStatus: String(r[cm['review_status']] || ''),
      reviewedBy: String(r[cm['reviewed_by']] || ''),
      reviewedAt: String(r[cm['reviewed_at']] || ''),
      reviewNote: String(r[cm['review_note']] || ''),
      _rowNum: i + 1
    });
  }
  return out;
}

function _fmFormUrl(formId) {
  return ScriptApp.getService().getUrl() + '?app=form&f=' + encodeURIComponent(formId);
}

function _fmIsAccepting(form) {
  if (form.status !== 'open') return { ok: false, reason: 'This form is closed.' };
  if (form.dueDate && _todayStr() > form.dueDate) return { ok: false, reason: 'The deadline for this form has passed.' };
  return { ok: true };
}

// Upcoming events that take attendance and involve the form's audience; with
// anyEvent (parties, socials) every upcoming event is offered.
function _fmEventOptions(ss, audience, anyEvent) {
  var allowed = { brothers: ['brothers', 'everyone'], novatos: ['novatos', 'everyone'], everyone: ['brothers', 'novatos', 'everyone'] }[audience] || [];
  var sheet = _getEventsSheet(ss);
  var data = sheet.getDataRange().getValues();
  var cm = _buildColMap(data[0]);
  var today = _todayStr();
  var evs = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][cm['event_id']]) continue;
    var ev = _eventFromRow(data[i], cm);
    if (ev.date >= today && (anyEvent || allowed.indexOf(ev.attendance) !== -1)) evs.push(ev);
  }
  evs.sort(function(a, b) { return (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')); });
  return evs.map(function(ev) {
    return { eventId: ev.eventId, label: ev.title + ' (' + Utilities.formatDate(_dParse(ev.date), 'UTC', 'EEE MMM d') + ')' };
  });
}

function _fmAnswerText(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'multi') return (value || []).join(', ');
  if (field.type === 'event') return value.label || '';
  if (field.type === 'yesno') return value === 'yes' ? 'Yes' : 'No';
  if (field.type === 'list') return (value || []).join('; ');
  if (field.type === 'photo') return (value || []).map(function(p) { return p.url; }).join(' ');
  return String(value);
}

function _fmEventOpts(ss, form) {
  return {
    std: form.fields.some(function(f) { return f.type === 'event' && !f.allEvents; }) ? _fmEventOptions(ss, form.audience) : [],
    all: form.fields.some(function(f) { return f.type === 'event' && f.allEvents; }) ? _fmEventOptions(ss, form.audience, true) : []
  };
}

// ---- Public side (no login) --------------------------------

function fmGetPublicForm(formId) {
  try {
    var ss = getSpreadsheet();
    var form = _fmFindForm(ss, formId);
    if (!form) return JSON.stringify({ success: false, error: 'This form does not exist.' });
    var acc = _fmIsAccepting(form);
    var out = {
      success: true,
      accepting: acc.ok,
      closedReason: acc.reason || '',
      form: { formId: form.formId, title: form.title, description: form.description, audience: form.audience, dueDate: form.dueDate, fields: form.fields, allowMultiple: form.allowMultiple }
    };
    if (acc.ok) {
      out.roster = _eventRoster(form.audience).map(function(m) { return { key: m.type + ':' + m.memberId, name: m.name, type: m.type }; });
      var eo = _fmEventOpts(ss, form);
      out.events = eo.std;
      out.eventsAll = eo.all;
    }
    return JSON.stringify(out);
  } catch (err) { logError('fmGetPublicForm', err); return JSON.stringify({ success: false, error: 'Could not load the form. Try again.' }); }
}

// photoCounts: how many photos were sent per photo field (uploaded later, so
// clean[fieldId] is only a placeholder here).
function _fmValidateAnswers(form, answers, eventOpts, photoCounts) {
  var clean = {};
  for (var i = 0; i < form.fields.length; i++) {
    var f = form.fields[i];
    if (f.type === 'info') continue;
    if (f.type === 'photo') {
      var cnt = photoCounts[f.id] || 0;
      if (!cnt) { if (f.required) return { error: '"' + f.label + '" needs at least one photo.' }; continue; }
      if (cnt > FM_MAX_PHOTOS) return { error: 'At most ' + FM_MAX_PHOTOS + ' photos for "' + f.label + '".' };
      clean[f.id] = [];
      continue;
    }
    var v = answers[f.id];
    var empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) {
      if (f.required) return { error: '"' + f.label + '" is required.' };
      continue;
    }
    if (f.type === 'text' || f.type === 'textarea') {
      v = String(v).trim();
      if (v.length > (f.type === 'text' ? 300 : 2000)) return { error: '"' + f.label + '" is too long.' };
      if (!v) { if (f.required) return { error: '"' + f.label + '" is required.' }; continue; }
    } else if (f.type === 'choice') {
      if ((f.options || []).indexOf(String(v)) === -1) return { error: 'Pick a valid option for "' + f.label + '".' };
      v = String(v);
    } else if (f.type === 'multi') {
      if (!Array.isArray(v)) return { error: 'Pick valid options for "' + f.label + '".' };
      var seen = {};
      v = v.map(String).filter(function(o) { if (seen[o]) return false; seen[o] = true; return true; });
      for (var k = 0; k < v.length; k++) if ((f.options || []).indexOf(v[k]) === -1) return { error: 'Pick valid options for "' + f.label + '".' };
    } else if (f.type === 'number') {
      var n = Number(v);
      if (!isFinite(n)) return { error: '"' + f.label + '" must be a number.' };
      v = n;
    } else if (f.type === 'date') {
      v = String(v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || _dFmt(_dParse(v)) !== v) return { error: '"' + f.label + '" must be a valid date.' };
    } else if (f.type === 'yesno') {
      if (v !== 'yes' && v !== 'no') return { error: 'Answer yes or no for "' + f.label + '".' };
    } else if (f.type === 'event') {
      var opt = (f.allEvents ? eventOpts.all : eventOpts.std).filter(function(e) { return e.eventId === String(v); })[0];
      if (!opt) return { error: 'That event is not available for this form.' };
      v = { eventId: opt.eventId, label: opt.label };
    } else if (f.type === 'list') {
      if (!Array.isArray(v)) return { error: '"' + f.label + '" must be a list.' };
      v = v.map(function(x) { return String(x).trim(); }).filter(Boolean);
      if (!v.length) { if (f.required) return { error: '"' + f.label + '" is required.' }; continue; }
      if (v.length > FM_MAX_LIST) return { error: 'At most ' + FM_MAX_LIST + ' entries for "' + f.label + '".' };
      for (var q = 0; q < v.length; q++) if (v[q].length > 100) return { error: 'An entry in "' + f.label + '" is too long.' };
    }
    clean[f.id] = v;
  }
  return { clean: clean };
}

// ---- Photos (Drive) ----------------------------------------

function _fmIsJpeg(bytes) { return bytes.length > 3 && (bytes[0] & 255) === 255 && (bytes[1] & 255) === 216; }

// Forms/<semester>/<form title>/ under the Drive root (DriveStorage.gs); files are
// link-viewable like the signature photos.
function _fmSavePhoto(bytes, form, memberName, n) {
  try {
    var formF = driveFolder('forms', getConfigValue('semester'), [String(form.title).substring(0, 60)]);
    var name = String(memberName || 'member').replace(/[^A-Za-z0-9]/g, '_') + '__' + Date.now() + '_' + n + '.jpg';
    var file = formF.createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { id: file.getId(), url: file.getUrl() };
  } catch (err) { logError('_fmSavePhoto', err); return null; }
}

function _fmTrashPhotos(ids) {
  ids.forEach(function(id) {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (err) { logError('_fmTrashPhotos', err); }
  });
}

function _fmPhotoIds(form, answers) {
  var ids = [];
  form.fields.forEach(function(f) {
    if (f.type === 'photo' && Array.isArray(answers[f.id])) answers[f.id].forEach(function(p) { if (p && p.id) ids.push(p.id); });
  });
  return ids;
}

// photosJson: { fieldId: [{ data: <base64 jpeg> }] }. Validation and Drive
// uploads happen before the lock so slow uploads never block other submitters.
function fmSubmitResponse(formId, memberKey, answersJson, photosJson) {
  var uploaded = [];
  var fail = function(msg) { _fmTrashPhotos(uploaded); return JSON.stringify({ success: false, message: msg }); };
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var ss = getSpreadsheet();
    var form = _fmFindForm(ss, formId);
    if (!form) return fail('This form does not exist.');
    var acc = _fmIsAccepting(form);
    if (!acc.ok) return fail(acc.reason);

    var member = _eventRoster(form.audience).filter(function(m) { return m.type + ':' + m.memberId === String(memberKey); })[0];
    if (!member) return fail('Pick your name from the list.');

    var photosIn = _fmJson(photosJson, {});
    var photoCounts = {};
    form.fields.forEach(function(f) { if (f.type === 'photo') photoCounts[f.id] = Array.isArray(photosIn[f.id]) ? photosIn[f.id].length : 0; });

    var v = _fmValidateAnswers(form, _fmJson(answersJson, {}), _fmEventOpts(ss, form), photoCounts);
    if (v.error) return fail(v.error);

    if (form.action.type === 'philanthropy') {
      var hours = v.clean[form.action.hoursField];
      if (!(hours > 0 && hours <= FM_MAX_HOURS)) return fail('Hours must be more than 0 and at most ' + FM_MAX_HOURS + '.');
    }

    var decoded = [];
    form.fields.forEach(function(f) {
      if (f.type !== 'photo' || !photoCounts[f.id]) return;
      photosIn[f.id].forEach(function(item) { decoded.push({ fid: f.id, bytes: item && item.data ? Utilities.base64Decode(String(item.data)) : [] }); });
    });
    for (var d = 0; d < decoded.length; d++) {
      if (decoded[d].bytes.length < 5120) return fail('A photo is too small or empty. Pick real photos.');
      if (decoded[d].bytes.length > 8 * 1024 * 1024) return fail('A photo is too large.');
      if (!_fmIsJpeg(decoded[d].bytes)) return fail('Photos must be JPEG images.');
    }
    for (var u = 0; u < decoded.length; u++) {
      var saved = _fmSavePhoto(decoded[u].bytes, form, member.name, u + 1);
      if (!saved) return fail('Could not save a photo. Please try again.');
      uploaded.push(saved.id);
      v.clean[decoded[u].fid].push(saved);
    }

    lock.waitLock(20000);
    locked = true;
    var mine = _fmReadResponses(ss, form.formId).filter(function(r) { return r.memberId === member.memberId && r.memberType === member.type; });

    if (form.action.type === 'absence') {
      var evId = (v.clean[form.action.eventField] || {}).eventId;
      var dupe = mine.filter(function(r) {
        return r.reviewStatus !== 'denied' && (r.answers[form.action.eventField] || {}).eventId === evId;
      })[0];
      if (dupe) return fail('You already sent an absence request for that event.');
    }

    var now = new Date().toISOString();
    var review = form.requiresReview ? 'pending' : '';
    var sheet = _fmSheet(ss, 'form_responses', FM_RESP_HEADERS);
    if (!form.allowMultiple && mine.length) {
      var row = mine[0]._rowNum;
      sheet.getRange(row, 6, 1, 6).setValues([[JSON.stringify(v.clean), now, review, '', '', '']]);
      logInfo('fmSubmitResponse', form.formId + ' updated by ' + member.name);
      var oldIds = _fmPhotoIds(form, mine[0].answers);
      uploaded = [];
      if (locked) { try { lock.releaseLock(); } catch (e) {} locked = false; }
      _fmTrashPhotos(oldIds);
      return JSON.stringify({ success: true, updated: true, message: 'Your response was updated.' });
    }
    sheet.appendRow([_fmNewId('RS'), form.formId, member.memberId, member.type, member.name, JSON.stringify(v.clean), now, review, '', '', '']);
    logInfo('fmSubmitResponse', form.formId + ' submitted by ' + member.name);
    uploaded = [];
    return JSON.stringify({ success: true, message: form.requiresReview ? 'Submitted. An officer will review it.' : 'Thanks, your response was recorded.' });
  } catch (err) {
    logError('fmSubmitResponse', err);
    return fail('Submission failed. Please try again or contact an officer.');
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e) {} }
  }
}

// ---- Officer side (PIN-gated) ------------------------------

function fmListForms(pin) {
  var denied = _fmDeny(pin); if (denied) return denied;
  try {
    var ss = getSpreadsheet();
    var forms = _fmReadForms(ss);
    var responses = _fmReadResponses(ss);
    var sizes = {};
    var out = forms.map(function(f) {
      if (sizes[f.audience] === undefined) sizes[f.audience] = _eventRoster(f.audience).length;
      var rs = responses.filter(function(r) { return r.formId === f.formId; });
      var who = {};
      rs.forEach(function(r) { who[r.memberType + ':' + r.memberId] = true; });
      return {
        formId: f.formId, title: f.title, status: f.status, audience: f.audience, dueDate: f.dueDate,
        requiresReview: f.requiresReview, actionType: f.action.type, category: f.category,
        responses: rs.length, responders: Object.keys(who).length, audienceSize: sizes[f.audience],
        pending: rs.filter(function(r) { return r.reviewStatus === 'pending'; }).length,
        accepting: _fmIsAccepting(f).ok, url: _fmFormUrl(f.formId)
      };
    });
    return JSON.stringify({ success: true, forms: out });
  } catch (err) { logError('fmListForms', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Public (no PIN): every form members can fill right now, for the Home page.
function fmListOpenForms() {
  try {
    var forms = _fmReadForms(getSpreadsheet()).filter(function(f) { return _fmIsAccepting(f).ok; });
    return JSON.stringify({ success: true, forms: forms.map(function(f) {
      return { formId: f.formId, title: f.title, description: f.description.substring(0, 160), audience: f.audience, dueDate: f.dueDate, category: f.category };
    }) });
  } catch (err) { logError('fmListOpenForms', err); return JSON.stringify({ success: false, error: 'Could not load the forms.' }); }
}

function fmGetForm(pin, formId) {
  var denied = _fmDeny(pin); if (denied) return denied;
  try {
    var form = _fmFindForm(getSpreadsheet(), formId);
    if (!form) return JSON.stringify({ success: false, error: 'Form not found.' });
    delete form._rowNum;
    return JSON.stringify({ success: true, form: form });
  } catch (err) { logError('fmGetForm', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Keeps existing field ids on edit so stored answers stay attached to their field.
function _fmCleanFields(raw) {
  if (!Array.isArray(raw) || !raw.length) return { error: 'Add at least one field.' };
  if (raw.length > FM_MAX_FIELDS) return { error: 'A form can have at most ' + FM_MAX_FIELDS + ' fields.' };
  var used = {}, maxN = 0;
  raw.forEach(function(f) { var m = /^f(\d+)$/.exec(String(f.id || '')); if (m) maxN = Math.max(maxN, Number(m[1])); });
  var out = [], answerable = 0;
  for (var i = 0; i < raw.length; i++) {
    var f = raw[i];
    var type = String(f.type || '');
    if (FM_FIELD_TYPES.indexOf(type) === -1) return { error: 'Unknown field type "' + type + '".' };
    var label = String(f.label || '').trim().substring(0, 200);
    if (!label) return { error: 'Every field needs a label.' };
    var id = String(f.id || '');
    if (!/^f\d+$/.test(id) || used[id]) id = 'f' + (++maxN);
    used[id] = true;
    var field = { id: id, type: type, label: label, help: String(f.help || '').trim().substring(0, 500), required: type !== 'info' && !!f.required };
    if (type === 'choice' || type === 'multi') {
      var seen = {};
      field.options = (f.options || []).map(function(o) { return String(o).trim(); }).filter(function(o) {
        if (!o || seen[o]) return false; seen[o] = true; return true;
      });
      if (field.options.length < 2) return { error: '"' + label + '" needs at least two options.' };
    }
    if (type === 'event' && f.allEvents) field.allEvents = true;
    if (f.role === 'going' || f.role === 'slots') field.role = f.role;
    if (type !== 'info') answerable++;
    out.push(field);
  }
  if (!answerable) return { error: 'Add at least one field members can answer.' };
  return { fields: out };
}

function fmSaveForm(pin, payloadJson, performedBy) {
  var denied = _fmDeny(pin); if (denied) return denied;
  try {
    var p = _fmJson(payloadJson, {});
    var title = String(p.title || '').trim();
    if (!title) return JSON.stringify({ success: false, error: 'Give the form a title.' });
    var audience = String(p.audience || '');
    if (FM_AUDIENCES.indexOf(audience) === -1) return JSON.stringify({ success: false, error: 'Pick who the form is for.' });
    var dueDate = String(p.dueDate || '').trim();
    if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || _dFmt(_dParse(dueDate)) !== dueDate)) return JSON.stringify({ success: false, error: 'The deadline is not a valid date.' });
    var category = String(p.category || 'general');
    if (FM_CATEGORIES.indexOf(category) === -1) return JSON.stringify({ success: false, error: 'Pick a valid category.' });
    var cf = _fmCleanFields(p.fields);
    if (cf.error) return JSON.stringify({ success: false, error: cf.error });

    var action = { type: 'none' };
    if (p.action && p.action.type === 'absence') {
      var ev = cf.fields.filter(function(f) { return f.type === 'event'; })[0];
      if (!ev) return JSON.stringify({ success: false, error: 'An absence form needs an event field.' });
      ev.required = true;
      var reason = cf.fields.filter(function(f) { return f.type === 'choice'; })[0];
      action = { type: 'absence', eventField: ev.id, reasonField: reason ? reason.id : '' };
    }

    if (p.action && p.action.type === 'philanthropy') {
      var hf = cf.fields.filter(function(f) { return f.type === 'number'; })[0];
      var pf = cf.fields.filter(function(f) { return f.type === 'photo'; })[0];
      if (!hf) return JSON.stringify({ success: false, error: 'A philanthropy form needs a number field for the hours.' });
      if (!pf) return JSON.stringify({ success: false, error: 'A philanthropy form needs a photo field for the proof.' });
      hf.required = true; pf.required = true;
      var tf = cf.fields.filter(function(f) { return f.type === 'text'; })[0];
      var df = cf.fields.filter(function(f) { return f.type === 'date'; })[0];
      action = { type: 'philanthropy', hoursField: hf.id, photoField: pf.id, titleField: tf ? tf.id : '', dateField: df ? df.id : '' };
    }

    if (p.action && p.action.type === 'service_event') {
      var gf = cf.fields.filter(function(f) { return f.role === 'going' && f.type === 'yesno'; })[0];
      if (!gf) return JSON.stringify({ success: false, error: 'A service event needs a going yes/no field.' });
      gf.required = true;
      var sf = cf.fields.filter(function(f) { return f.role === 'slots'; })[0];
      var eventDate = String(p.action.eventDate || '').trim();
      if (eventDate && (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || _dFmt(_dParse(eventDate)) !== eventDate)) return JSON.stringify({ success: false, error: 'The event date is not valid.' });
      var dh = Number(p.action.defaultHours);
      action = { type: 'service_event', goingField: gf.id, slotField: sf ? sf.id : '', eventDate: eventDate, defaultHours: isFinite(dh) && dh > 0 && dh <= FM_MAX_HOURS ? dh : 0 };
    }

    var ss = getSpreadsheet();
    var sheet = _fmSheet(ss, 'forms', FM_HEADERS);
    _fmEnsureColumns(sheet);
    var who = performedBy || 'Officer';
    var now = new Date().toISOString();
    var existing = p.formId ? _fmFindForm(ss, p.formId) : null;
    if (p.formId && !existing) return JSON.stringify({ success: false, error: 'Form not found.' });
    var row = [
      existing ? existing.formId : _fmNewId('FM'), title, String(p.description || '').trim().substring(0, 2000),
      existing ? existing.status : 'open', audience, JSON.stringify(cf.fields), dueDate,
      p.requiresReview ? 'Y' : 'N', p.allowMultiple ? 'Y' : 'N', JSON.stringify(action),
      existing ? existing.createdBy : who, existing ? existing.createdAt : now, now, category
    ];
    if (existing) sheet.getRange(existing._rowNum, 1, 1, FM_HEADERS.length).setValues([row]);
    else sheet.appendRow(row);
    logInfo('fmSaveForm', row[0] + ' "' + title + '" by ' + who);
    return JSON.stringify({ success: true, formId: row[0], message: existing ? 'Form updated.' : 'Form created.' });
  } catch (err) { logError('fmSaveForm', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function fmSetStatus(pin, formId, status) {
  var denied = _fmDeny(pin); if (denied) return denied;
  try {
    var ss = getSpreadsheet();
    var form = _fmFindForm(ss, formId);
    if (!form) return JSON.stringify({ success: false, error: 'Form not found.' });
    var next = status === 'closed' ? 'closed' : 'open';
    _fmSheet(ss, 'forms', FM_HEADERS).getRange(form._rowNum, FM_HEADERS.indexOf('status') + 1).setValue(next);
    return JSON.stringify({ success: true, message: next === 'open' ? 'Form reopened.' : 'Form closed.' });
  } catch (err) { logError('fmSetStatus', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function fmDeleteForm(pin, formId) {
  var denied = _fmDeny(pin); if (denied) return denied;
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(20000);
    locked = true;
    var ss = getSpreadsheet();
    var form = _fmFindForm(ss, formId);
    if (!form) return JSON.stringify({ success: false, error: 'Form not found.' });
    var respSheet = _fmSheet(ss, 'form_responses', FM_RESP_HEADERS);
    var resps = _fmReadResponses(ss, form.formId);
    var photoIds = [];
    resps.forEach(function(r) { photoIds = photoIds.concat(_fmPhotoIds(form, r.answers)); });
    var rows = resps.map(function(r) { return r._rowNum; }).sort(function(a, b) { return b - a; });
    rows.forEach(function(n) { respSheet.deleteRow(n); });
    _fmTrashPhotos(photoIds);
    _fmSheet(ss, 'forms', FM_HEADERS).deleteRow(form._rowNum);
    logInfo('fmDeleteForm', form.formId + ' "' + form.title + '" with ' + rows.length + ' response(s)');
    return JSON.stringify({ success: true, message: 'Form deleted.' });
  } catch (err) { logError('fmDeleteForm', err); return JSON.stringify({ success: false, error: err.toString() }); }
  finally { if (locked) { try { lock.releaseLock(); } catch (e) {} } }
}

function _fmMemberEmails() {
  var map = {};
  _getMembersStructured().forEach(function(m) { map['brother:' + m.memberId] = m.email; });
  _getMembersStructured('AMs').forEach(function(m) { map['novato:' + m.memberId] = m.email; });
  return map;
}

function fmGetResponses(pin, formId) {
  var denied = _fmDeny(pin); if (denied) return denied;
  try {
    var ss = getSpreadsheet();
    var form = _fmFindForm(ss, formId);
    if (!form) return JSON.stringify({ success: false, error: 'Form not found.' });
    var fieldById = {};
    form.fields.forEach(function(f) { fieldById[f.id] = f; });
    var responses = _fmReadResponses(ss, form.formId);
    var responded = {};
    responses.forEach(function(r) { responded[r.memberType + ':' + r.memberId] = true; });
    var emails = _fmMemberEmails();
    var nonResponders = _eventRoster(form.audience).filter(function(m) { return !responded[m.type + ':' + m.memberId]; })
      .map(function(m) { return { name: m.name, type: m.type, hasEmail: !!emails[m.type + ':' + m.memberId] }; });
    delete form._rowNum;
    return JSON.stringify({
      success: true,
      form: form,
      url: _fmFormUrl(form.formId),
      accepting: _fmIsAccepting(form).ok,
      responses: responses.map(function(r) {
        var display = {}, photos = {};
        Object.keys(r.answers).forEach(function(id) {
          if (!fieldById[id]) return;
          display[id] = _fmAnswerText(fieldById[id], r.answers[id]);
          if (fieldById[id].type === 'photo') photos[id] = r.answers[id];
        });
        return { photos: photos, responseId: r.responseId, memberName: r.memberName, memberType: r.memberType, submittedAt: r.submittedAt, display: display, reviewStatus: r.reviewStatus, reviewedBy: r.reviewedBy, reviewNote: r.reviewNote };
      }).sort(function(a, b) { return b.submittedAt.localeCompare(a.submittedAt); }),
      nonResponders: nonResponders
    });
  } catch (err) { logError('fmGetResponses', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function fmReviewResponse(pin, responseId, decision, note, performedBy) {
  var denied = _fmDeny(pin); if (denied) return denied;
  try {
    if (['approved', 'denied', 'pending'].indexOf(decision) === -1) return JSON.stringify({ success: false, error: 'Invalid decision.' });
    var ss = getSpreadsheet();
    var r = _fmReadResponses(ss).filter(function(x) { return x.responseId === String(responseId); })[0];
    if (!r) return JSON.stringify({ success: false, error: 'Response not found.' });
    var who = decision === 'pending' ? '' : (performedBy || 'Officer');
    var at = decision === 'pending' ? '' : new Date().toISOString();
    _fmSheet(ss, 'form_responses', FM_RESP_HEADERS).getRange(r._rowNum, 8, 1, 4)
      .setValues([[decision, who, at, decision === 'pending' ? '' : String(note || '').trim().substring(0, 500)]]);
    logInfo('fmReviewResponse', r.responseId + ' ' + decision + ' by ' + (performedBy || 'Officer'));
    return JSON.stringify({ success: true, message: 'Marked ' + decision + '.' });
  } catch (err) { logError('fmReviewResponse', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function fmDeleteResponse(pin, responseId) {
  var denied = _fmDeny(pin); if (denied) return denied;
  try {
    var ss = getSpreadsheet();
    var r = _fmReadResponses(ss).filter(function(x) { return x.responseId === String(responseId); })[0];
    if (!r) return JSON.stringify({ success: false, error: 'Response not found.' });
    var form = _fmFindForm(ss, r.formId);
    _fmSheet(ss, 'form_responses', FM_RESP_HEADERS).deleteRow(r._rowNum);
    if (form) _fmTrashPhotos(_fmPhotoIds(form, r.answers));
    return JSON.stringify({ success: true, message: 'Response deleted.' });
  } catch (err) { logError('fmDeleteResponse', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function fmSendReminders(pin, formId) {
  var denied = _fmDeny(pin); if (denied) return denied;
  try {
    var ss = getSpreadsheet();
    var form = _fmFindForm(ss, formId);
    if (!form) return JSON.stringify({ success: false, error: 'Form not found.' });
    var acc = _fmIsAccepting(form);
    if (!acc.ok) return JSON.stringify({ success: false, error: acc.reason + ' Reopen it before sending reminders.' });

    var responded = {};
    _fmReadResponses(ss, form.formId).forEach(function(r) { responded[r.memberType + ':' + r.memberId] = true; });
    var emails = _fmMemberEmails();
    var targets = _eventRoster(form.audience).filter(function(m) { return !responded[m.type + ':' + m.memberId]; });
    if (!targets.length) return JSON.stringify({ success: true, sent: 0, skipped: 0, message: 'Everyone has already responded.' });

    var chName = getChapterConfig().chapter.chapter_name || 'Chapter';
    var url = _fmFormUrl(form.formId);
    var subject = '[' + chName + '] Please fill out: ' + form.title;
    var esc = function(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var html =
      '<p>Hi,</p><p>This is a reminder to fill out <strong>' + esc(form.title) + '</strong>' +
      (form.dueDate ? ' before <strong>' + form.dueDate + '</strong>' : '') + '.</p>' +
      '<p><a href="' + url + '" style="display:inline-block;background:#093D20;color:#FFB71D;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700">Open form</a></p>' +
      '<p style="color:#666;font-size:12px">Sent by ' + esc(chName) + ' Chore System</p>';
    var sent = 0, skipped = 0;
    targets.forEach(function(m) {
      var to = emails[m.type + ':' + m.memberId];
      if (!to) { skipped++; return; }
      try { GmailApp.sendEmail(to, subject, 'Please fill out ' + form.title + ': ' + url, { htmlBody: html, name: chName }); sent++; }
      catch (e) { logError('fmSendReminders', 'Failed to email ' + to + ': ' + e); skipped++; }
    });
    logInfo('fmSendReminders', form.formId + ' sent=' + sent + ' skipped=' + skipped);
    return JSON.stringify({ success: true, sent: sent, skipped: skipped });
  } catch (err) { logError('fmSendReminders', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// ---- Absence action ----------------------------------------

// Map 'type:memberId' -> { status: 'approved'|'pending', reason } for one event,
// derived from the responses of every form whose action is 'absence'.
function _fmExcusesForEvent(ss, eventId) {
  var out = {};
  _fmReadForms(ss).filter(function(f) { return f.action.type === 'absence'; }).forEach(function(f) {
    var fieldById = {};
    f.fields.forEach(function(x) { fieldById[x.id] = x; });
    _fmReadResponses(ss, f.formId).forEach(function(r) {
      if ((r.answers[f.action.eventField] || {}).eventId !== eventId) return;
      var status = f.requiresReview ? r.reviewStatus : 'approved';
      if (status !== 'approved' && status !== 'pending') return;
      var rf = fieldById[f.action.reasonField];
      var key = r.memberType + ':' + r.memberId;
      if (out[key] && out[key].status === 'approved') return;
      out[key] = { status: status, reason: rf ? _fmAnswerText(rf, r.answers[rf.id]) : '' };
    });
  });
  return out;
}

// ---- Philanthropy action -----------------------------------

// Hours per member: philanthropy-form submissions plus hours awarded by the chair
// for service events, scoped to the current semester. Built in Philanthropy.gs.
function fmPhilanthropySummary(pin) {
  var denied = _fmDeny(pin); if (denied) return denied;
  try {
    return JSON.stringify(_phSummaryBuild(getSpreadsheet()));
  } catch (err) { logError('fmPhilanthropySummary', err); return JSON.stringify({ success: false, error: err.toString() }); }
}
