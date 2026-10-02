// ============================================================
// Philanthropy.gs — service-hour goals, service events and the hours ledger.
//
// Hours of a member in the current semester = approved submissions of the
// 'philanthropy' form(s) (Forms.gs) + hours the chair awarded from a service
// event (tab `service_hours`). "Current semester" starts at config
// philanthropy_semester_start (epoch ms, set by phCloseSemester; 0 = all time).
//
// Settings (config tab): philanthropy_min_hours (0 = no requirement),
// philanthropy_shortfall_action (none|probation|suspension),
// philanthropy_carry_over (true|false), philanthropy_carry (JSON key -> hours
// still owed from the previous semester).
//
// A service event is a normal form (Forms.gs) with action.type 'service_event':
// a "going" yes/no field plus optional time slots, photo and extra questions.
// ============================================================

var PH_LEDGER_HEADERS = ['entry_id', 'member_key', 'member_name', 'hours', 'source_form_id', 'source_title', 'note', 'awarded_by', 'awarded_at'];
var PH_ACTIONS = ['none', 'probation', 'suspension'];
var PH_EXTRA_TYPES = ['text', 'textarea', 'number', 'date', 'yesno', 'choice', 'multi'];

function _phDeny(pin) { return _fmDeny(pin); }

function _phSettings() {
  var min = Number(getConfigValue('philanthropy_min_hours'));
  if (!isFinite(min) || min < 0) min = 0;
  var act = String(getConfigValue('philanthropy_shortfall_action') || 'none');
  if (PH_ACTIONS.indexOf(act) === -1) act = 'none';
  return {
    minHours: min,
    shortfallAction: act,
    carryOver: String(getConfigValue('philanthropy_carry_over')).toLowerCase() === 'true',
    semesterStart: Number(getConfigValue('philanthropy_semester_start')) || 0,
    carry: _fmJson(getConfigValue('philanthropy_carry'), {})
  };
}

function phGetSettings(pin) {
  var denied = _phDeny(pin); if (denied) return denied;
  try {
    var s = _phSettings();
    return JSON.stringify({ success: true, settings: { minHours: s.minHours, shortfallAction: s.shortfallAction, carryOver: s.carryOver, semesterStart: s.semesterStart }, semester: String(getConfigValue('semester') || '') });
  } catch (err) { logError('phGetSettings', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function phSaveSettings(pin, payloadJson, performedBy) {
  var denied = _phDeny(pin); if (denied) return denied;
  try {
    var p = _fmJson(payloadJson, {});
    var min = Number(p.minHours);
    if (!isFinite(min) || min < 0 || min > 500) return JSON.stringify({ success: false, error: 'Minimum hours must be a number between 0 and 500.' });
    var act = String(p.shortfallAction || 'none');
    if (PH_ACTIONS.indexOf(act) === -1) return JSON.stringify({ success: false, error: 'Invalid end-of-semester action.' });
    setConfigValue('philanthropy_min_hours', Math.round(min * 100) / 100);
    setConfigValue('philanthropy_shortfall_action', act);
    setConfigValue('philanthropy_carry_over', p.carryOver ? 'true' : 'false');
    logInfo('phSaveSettings', 'min=' + min + ' action=' + act + ' carry=' + !!p.carryOver + ' by ' + (performedBy || 'Officer'));
    return JSON.stringify({ success: true, message: 'Philanthropy settings saved.' });
  } catch (err) { logError('phSaveSettings', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// ---- Ledger ------------------------------------------------

function _phReadLedger(ss) {
  var data = _fmSheet(ss, 'service_hours', PH_LEDGER_HEADERS).getDataRange().getValues();
  var cm = _buildColMap(data[0]);
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[cm['entry_id']]) continue;
    out.push({
      entryId: String(r[cm['entry_id']]), key: String(r[cm['member_key']]), name: String(r[cm['member_name']]),
      hours: Number(r[cm['hours']]) || 0, formId: String(r[cm['source_form_id']]), title: String(r[cm['source_title']]),
      note: String(r[cm['note']] || ''), awardedBy: String(r[cm['awarded_by']] || ''), awardedAt: String(r[cm['awarded_at']] || ''),
      _rowNum: i + 1
    });
  }
  return out;
}

function _phInSemester(iso, startMs) {
  if (!startMs) return true;
  var t = new Date(iso).getTime();
  return isFinite(t) && t >= startMs;
}

function _phRound(n) { return Math.round(n * 100) / 100; }

// ---- Summary (feeds the Philanthropy page) -----------------

function _phSummaryBuild(ss) {
  var forms = _fmReadForms(ss).filter(function(f) { return f.action.type === 'philanthropy'; });
  if (!forms.length) return { success: true, hasForm: false };
  var st = _phSettings();
  var byKey = {};
  var touch = function(key, name, type, current) {
    if (!byKey[key]) byKey[key] = { key: key, name: name, type: type, current: false, approved: 0, pending: 0, entries: [] };
    if (current) byKey[key].current = true;
    return byKey[key];
  };
  forms.forEach(function(f) {
    _eventRoster(f.audience).forEach(function(m) { touch(m.type + ':' + m.memberId, m.name, m.type, true); });
    var fieldById = {};
    f.fields.forEach(function(x) { fieldById[x.id] = x; });
    _fmReadResponses(ss, f.formId).forEach(function(r) {
      if (!_phInSemester(r.submittedAt, st.semesterStart)) return;
      var status = f.requiresReview ? (r.reviewStatus || 'pending') : 'approved';
      var hours = Number(r.answers[f.action.hoursField]) || 0;
      var m = touch(r.memberType + ':' + r.memberId, r.memberName, r.memberType, false);
      if (status === 'approved') m.approved += hours;
      else if (status === 'pending') m.pending += hours;
      m.entries.push({
        responseId: r.responseId, formId: f.formId, reviewable: f.requiresReview, submittedAt: r.submittedAt, status: status, hours: hours,
        activity: f.action.titleField ? _fmAnswerText(fieldById[f.action.titleField] || {}, r.answers[f.action.titleField]) : '',
        date: f.action.dateField ? String(r.answers[f.action.dateField] || '') : '',
        photos: r.answers[f.action.photoField] || [], reviewNote: r.reviewNote
      });
    });
  });
  _phReadLedger(ss).forEach(function(l) {
    if (!_phInSemester(l.awardedAt, st.semesterStart)) return;
    var type = l.key.split(':')[0] || 'brother';
    var m = touch(l.key, l.name, type, false);
    m.approved += l.hours;
    m.entries.push({
      awardId: l.entryId, formId: l.formId, reviewable: false, submittedAt: l.awardedAt, status: 'approved', hours: l.hours,
      activity: l.title, date: l.awardedAt.substring(0, 10), photos: [], reviewNote: l.note, awardedBy: l.awardedBy
    });
  });
  var members = Object.keys(byKey).map(function(k) { return byKey[k]; });
  var meeting = 0, notMeeting = 0;
  members.forEach(function(m) {
    m.approved = _phRound(m.approved);
    m.pending = _phRound(m.pending);
    m.carry = st.minHours > 0 ? _phRound(Number(st.carry[m.key]) || 0) : 0;
    m.required = st.minHours > 0 ? _phRound(st.minHours + m.carry) : 0;
    m.remaining = _phRound(Math.max(0, m.required - m.approved));
    m.meets = m.approved >= m.required;
    m.entries.sort(function(a, b) { return b.submittedAt.localeCompare(a.submittedAt); });
    if (m.current && st.minHours > 0) { if (m.meets) meeting++; else notMeeting++; }
  });
  members.sort(function(a, b) { return (b.approved - a.approved) || (b.pending - a.pending) || a.name.localeCompare(b.name); });
  var totalApproved = 0, totalPending = 0, contributors = 0;
  members.forEach(function(m) { totalApproved += m.approved; totalPending += m.pending; if (m.approved > 0) contributors++; });
  var primary = forms[0];
  return {
    success: true, hasForm: true,
    form: { formId: primary.formId, title: primary.title, url: _fmFormUrl(primary.formId), accepting: _fmIsAccepting(primary).ok },
    settings: { minHours: st.minHours, shortfallAction: st.shortfallAction, carryOver: st.carryOver, semesterStart: st.semesterStart },
    totals: { approved: _phRound(totalApproved), pending: _phRound(totalPending), contributors: contributors, members: members.length, meeting: meeting, notMeeting: notMeeting },
    members: members,
    events: _phEventList(ss)
  };
}

// ---- Service events ----------------------------------------

function _phEvents(ss) {
  return _fmReadForms(ss).filter(function(f) { return f.action.type === 'service_event'; });
}

function _phEventList(ss) {
  var forms = _phEvents(ss);
  if (!forms.length) return [];
  var ledger = _phReadLedger(ss);
  var responses = _fmReadResponses(ss);
  return forms.map(function(f) {
    var rs = responses.filter(function(r) { return r.formId === f.formId; });
    var going = rs.filter(function(r) { return r.answers[f.action.goingField] === 'yes'; }).length;
    var awarded = ledger.filter(function(l) { return l.formId === f.formId; });
    var total = 0;
    awarded.forEach(function(l) { total += l.hours; });
    return {
      formId: f.formId, title: f.title, description: f.description, eventDate: f.action.eventDate || '', dueDate: f.dueDate,
      status: f.status, accepting: _fmIsAccepting(f).ok, url: _fmFormUrl(f.formId), createdAt: f.createdAt,
      responses: rs.length, going: going, notGoing: rs.length - going, awardedPeople: awarded.length, awardedHours: _phRound(total)
    };
  }).sort(function(a, b) { return b.createdAt.localeCompare(a.createdAt); });
}

function phCreateEvent(pin, payloadJson, performedBy) {
  var denied = _phDeny(pin); if (denied) return denied;
  try {
    var p = _fmJson(payloadJson, {});
    var fields = [{ type: 'yesno', label: 'Are you going?', required: true, role: 'going' }];
    var slots = (p.slots || []).map(function(s) { return String(s).trim(); }).filter(Boolean);
    if (slots.length) {
      if (slots.length < 2) return JSON.stringify({ success: false, error: 'Add at least two time slots, or remove the time slot question.' });
      fields.push({ type: 'multi', label: String(p.slotLabel || 'Which time slots can you do?').trim(), help: 'Pick every slot that works for you.', options: slots, role: 'slots' });
    }
    (p.extra || []).forEach(function(q) {
      if (PH_EXTRA_TYPES.indexOf(String(q.type)) === -1) return;
      var label = String(q.label || '').trim();
      if (!label) return;
      var f = { type: String(q.type), label: label, required: !!q.required };
      if (f.type === 'choice' || f.type === 'multi') f.options = q.options || [];
      fields.push(f);
    });
    if (p.askPhoto) fields.push({ type: 'photo', label: String(p.photoLabel || 'Attach a photo').trim(), required: !!p.photoRequired });
    var res = _fmJson(fmSaveForm(pin, JSON.stringify({
      title: p.title, description: p.description, audience: p.audience === 'everyone' ? 'everyone' : 'brothers',
      dueDate: p.dueDate, requiresReview: false, allowMultiple: false, fields: fields,
      action: { type: 'service_event', eventDate: p.eventDate, defaultHours: p.defaultHours }
    }), performedBy), {});
    if (res.success) { res.url = _fmFormUrl(res.formId); res.message = 'Event created.'; }
    return JSON.stringify(res);
  } catch (err) { logError('phCreateEvent', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function phGetEvent(pin, formId) {
  var denied = _phDeny(pin); if (denied) return denied;
  try {
    var ss = getSpreadsheet();
    var form = _fmFindForm(ss, formId);
    if (!form || form.action.type !== 'service_event') return JSON.stringify({ success: false, error: 'Event not found.' });
    var fieldById = {};
    form.fields.forEach(function(f) { fieldById[f.id] = f; });
    var ledger = _phReadLedger(ss).filter(function(l) { return l.formId === form.formId; });
    var awardOf = {};
    ledger.forEach(function(l) { awardOf[l.key] = l; });
    var responses = _fmReadResponses(ss, form.formId);
    var responded = {};
    var people = responses.map(function(r) {
      var key = r.memberType + ':' + r.memberId;
      responded[key] = true;
      var details = [], photos = [];
      form.fields.forEach(function(f) {
        if (f.type === 'info' || f.id === form.action.goingField) return;
        var v = r.answers[f.id];
        if (f.type === 'photo') { if (Array.isArray(v) && v.length) photos = photos.concat(v); return; }
        var text = _fmAnswerText(f, v);
        if (text !== '') details.push({ label: f.label, text: text });
      });
      var aw = awardOf[key];
      return {
        key: key, responseId: r.responseId, name: r.memberName, type: r.memberType, going: r.answers[form.action.goingField] === 'yes',
        details: details, photos: photos, submittedAt: r.submittedAt, awarded: aw ? aw.hours : 0, awardId: aw ? aw.entryId : ''
      };
    }).sort(function(a, b) { return (Number(b.going) - Number(a.going)) || a.name.localeCompare(b.name); });
    var pending = _eventRoster(form.audience).filter(function(m) { return !responded[m.type + ':' + m.memberId]; }).map(function(m) { return m.name; });
    return JSON.stringify({
      success: true,
      event: {
        formId: form.formId, title: form.title, description: form.description, eventDate: form.action.eventDate || '', dueDate: form.dueDate,
        status: form.status, accepting: _fmIsAccepting(form).ok, url: _fmFormUrl(form.formId), defaultHours: form.action.defaultHours || 0
      },
      people: people, notResponded: pending
    });
  } catch (err) { logError('phGetEvent', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// awardsJson: [{ key: 'brother:ID', hours }]. One award per member and event: a
// second call replaces the hours, and 0 removes the award.
function phAwardHours(pin, formId, awardsJson, performedBy) {
  var denied = _phDeny(pin); if (denied) return denied;
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var awards = _fmJson(awardsJson, []);
    if (!Array.isArray(awards) || !awards.length) return JSON.stringify({ success: false, error: 'Pick at least one person.' });
    lock.waitLock(20000);
    locked = true;
    var ss = getSpreadsheet();
    var form = _fmFindForm(ss, formId);
    if (!form || form.action.type !== 'service_event') return JSON.stringify({ success: false, error: 'Event not found.' });
    var who = performedBy || 'Officer';
    var responders = {};
    _fmReadResponses(ss, form.formId).forEach(function(r) { responders[r.memberType + ':' + r.memberId] = r.memberName; });
    var sheet = _fmSheet(ss, 'service_hours', PH_LEDGER_HEADERS);
    var ledger = _phReadLedger(ss).filter(function(l) { return l.formId === form.formId; });
    var now = new Date().toISOString();
    var added = 0, updated = 0, removed = 0, deleteRows = [];
    for (var i = 0; i < awards.length; i++) {
      var key = String(awards[i].key);
      var h = Number(awards[i].hours);
      if (!responders[key]) return JSON.stringify({ success: false, error: 'Someone in the list has not responded to this event.' });
      if (!isFinite(h) || h < 0 || h > FM_MAX_HOURS) return JSON.stringify({ success: false, error: 'Hours must be between 0 and ' + FM_MAX_HOURS + '.' });
      var existing = ledger.filter(function(l) { return l.key === key; })[0];
      if (h === 0) {
        if (existing) { deleteRows.push(existing._rowNum); removed++; }
      } else if (existing) {
        sheet.getRange(existing._rowNum, 4, 1, 1).setValue(h);
        sheet.getRange(existing._rowNum, 8, 1, 2).setValues([[who, now]]);
        updated++;
      } else {
        sheet.appendRow([_fmNewId('SH'), key, responders[key], h, form.formId, form.title, '', who, now]);
        added++;
      }
    }
    deleteRows.sort(function(a, b) { return b - a; }).forEach(function(n) { sheet.deleteRow(n); });
    logInfo('phAwardHours', form.formId + ' added=' + added + ' updated=' + updated + ' removed=' + removed + ' by ' + who);
    return JSON.stringify({ success: true, added: added, updated: updated, removed: removed, message: 'Hours saved for ' + (added + updated + removed) + ' ' + ((added + updated + removed) === 1 ? 'person' : 'people') + '.' });
  } catch (err) { logError('phAwardHours', err); return JSON.stringify({ success: false, error: err.toString() }); }
  finally { if (locked) { try { lock.releaseLock(); } catch (e) {} } }
}

function phRemoveAward(pin, entryId) {
  var denied = _phDeny(pin); if (denied) return denied;
  try {
    var ss = getSpreadsheet();
    var l = _phReadLedger(ss).filter(function(x) { return x.entryId === String(entryId); })[0];
    if (!l) return JSON.stringify({ success: false, error: 'Entry not found.' });
    _fmSheet(ss, 'service_hours', PH_LEDGER_HEADERS).deleteRow(l._rowNum);
    return JSON.stringify({ success: true, message: 'Hours removed.' });
  } catch (err) { logError('phRemoveAward', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// The event and its responses go; hours already awarded stay in the ledger.
function phDeleteEvent(pin, formId) {
  var denied = _phDeny(pin); if (denied) return denied;
  var form = _fmFindForm(getSpreadsheet(), formId);
  if (!form || form.action.type !== 'service_event') return JSON.stringify({ success: false, error: 'Event not found.' });
  return fmDeleteForm(pin, formId);
}

// ---- End of semester ---------------------------------------

function _phShortfalls(summary) {
  return summary.members.filter(function(m) { return m.current && m.required > 0 && !m.meets; });
}

function phPreviewClose(pin) {
  var denied = _phDeny(pin); if (denied) return denied;
  try {
    var s = _phSummaryBuild(getSpreadsheet());
    if (!s.hasForm) return JSON.stringify({ success: true, hasForm: false });
    var short = _phShortfalls(s).map(function(m) { return { key: m.key, name: m.name, type: m.type, approved: m.approved, required: m.required, remaining: m.remaining }; });
    return JSON.stringify({ success: true, hasForm: true, settings: s.settings, meeting: s.totals.meeting, shortfalls: short });
  } catch (err) { logError('phPreviewClose', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Applies the configured consequence to brothers who fell short, stores what each
// member still owes when carry-over is on, and starts a fresh hours period.
function phCloseSemester(pin, performedBy) {
  var denied = _phDeny(pin); if (denied) return denied;
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(20000);
    locked = true;
    var ss = getSpreadsheet();
    var st = _phSettings();
    if (!(st.minHours > 0)) return JSON.stringify({ success: false, error: 'Set a minimum number of hours first.' });
    var s = _phSummaryBuild(ss);
    if (!s.hasForm) return JSON.stringify({ success: false, error: 'No philanthropy form yet.' });
    var who = performedBy || 'Officer';
    var semester = String(getConfigValue('semester') || 'this semester');
    var short = _phShortfalls(s);
    var flags = {};
    _getMembersStructured().forEach(function(m) { flags[m.memberId] = m; });
    var applied = 0, skipped = 0;
    short.forEach(function(m) {
      if (st.shortfallAction === 'none' || m.type !== 'brother') return;
      var id = m.key.split(':')[1];
      var cur = flags[id];
      if (!cur) return;
      var reason = 'Service hours: ' + m.approved + ' of ' + m.required + ' required (' + semester + ')';
      if (st.shortfallAction === 'probation') {
        if (cur.probation) { skipped++; return; }
        if (_fmJson(placeProbation(id, 'chapter', reason, '', who), {}).success) applied++;
      } else if (st.shortfallAction === 'suspension') {
        if (cur.suspension) { skipped++; return; }
        if (_fmJson(placeSuspension(id, reason, '', false, who), {}).success) applied++;
      }
    });
    var carry = {};
    if (st.carryOver) short.forEach(function(m) { carry[m.key] = m.remaining; });
    setConfigValue('philanthropy_carry', JSON.stringify(carry));
    setConfigValue('philanthropy_semester_start', Date.now());
    logInfo('phCloseSemester', semester + ': short=' + short.length + ' action=' + st.shortfallAction + ' applied=' + applied + ' skipped=' + skipped + ' carried=' + Object.keys(carry).length + ' by ' + who);
    return JSON.stringify({ success: true, short: short.length, applied: applied, skipped: skipped, carried: Object.keys(carry).length, action: st.shortfallAction });
  } catch (err) { logError('phCloseSemester', err); return JSON.stringify({ success: false, error: err.toString() }); }
  finally { if (locked) { try { lock.releaseLock(); } catch (e) {} } }
}
