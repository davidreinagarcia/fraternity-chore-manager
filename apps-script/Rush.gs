// ============================================================
// Rush.gs — recruitment tools for the Rush chair.
//
// Three public/officer surfaces share the tabs below:
//   ?app=rushdoor  RushDoorApp.html  PNM check-in form kept open at the door (no login).
//   ?app=rush      RushApp.html      live board for brothers: who is in the house + comments.
//   Officer dashboard > Rush         list, visits per day, bids, accepted, flushed.
//
// Tabs (all text columns, see the dates rule in CLAUDE.md):
//   rush_pnms      one row per person per semester. status: active | bid | accepted | declined | flushed
//   rush_visits    one row per person per day they were in the house (deduped by pnm_id + date)
//   rush_comments  live comments written by brothers about a PNM
//
// A returning PNM is matched by phone, then social handle, then (only if one
// side has neither) exact name, so the door form never creates duplicates.
//
// Config keys: rush_open (door form accepts check-ins), rush_code (optional
// access code for the brothers board), rush_year_options, rush_welcome_subject,
// rush_welcome_template. The brothers board polls rushPoll(), which compares a
// cached version stamp (bumped by every write) before it reads any sheet.
// ============================================================

var RUSH_PNM_HEADERS = ['pnm_id', 'name', 'year', 'instagram', 'phone', 'email', 'status', 'semester', 'bid_owner', 'bid_at', 'response_at', 'welcome_sent_at', 'source', 'created_at', 'updated_at'];
var RUSH_VISIT_HEADERS = ['visit_id', 'pnm_id', 'date', 'arrived_at', 'source', 'logged_by'];
var RUSH_COMMENT_HEADERS = ['comment_id', 'pnm_id', 'author_key', 'author_name', 'text', 'created_at'];
var RUSH_DEFAULT_YEARS = 'Freshman,Sophomore,Junior,Senior,Other';
var RUSH_MAX_PNMS = 1500;
var RUSH_MAX_COMMENT = 1000;
var RUSH_NM_LINK_PLACEHOLDER = '[new member form link goes here]';

function _rushDeny(pin) { return _fmDeny(pin); }
function _rushFail(msg) { return JSON.stringify({ success: false, error: msg }); }

function _rushSemester() { return String(getConfigValue('semester') || ''); }

function _rushLocked(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---- Version stamp (cheap change detection for polling) ----

function _rushTouch() {
  try { CacheService.getScriptCache().put('rush_ver', String(Date.now()), 21600); } catch (e) {}
}

function _rushVersion() {
  var cache = CacheService.getScriptCache();
  var v = cache.get('rush_ver');
  if (!v) { v = String(Date.now()); cache.put('rush_ver', v, 21600); }
  return v;
}

// ---- Settings ----------------------------------------------

function _rushDefaultSubject(cfg) { return 'Welcome to ' + (cfg.chapter.chapter_name || 'the chapter'); }

function _rushDefaultTemplate(cfg) {
  var bid = String(cfg.labels.label_bid || 'bid').toLowerCase();
  return 'Hey {first_name},\n\nCongratulations and welcome to {chapter}! We are glad you accepted your ' + bid +
    '. To get you registered, please fill out this {new_member} form:\n\n{link}\n\nSee you soon!';
}

function _rushSettings() {
  var cfg = getChapterConfig();
  var years = String(getConfigValue('rush_year_options') || RUSH_DEFAULT_YEARS).split(',')
    .map(function(s) { return s.trim(); }).filter(Boolean).slice(0, 12);
  return {
    open: String(getConfigValue('rush_open')).toLowerCase() === 'true',
    code: String(getConfigValue('rush_code') || '').trim(),
    yearOptions: years.length ? years : RUSH_DEFAULT_YEARS.split(','),
    welcomeSubject: String(getConfigValue('rush_welcome_subject') || '').trim() || _rushDefaultSubject(cfg),
    welcomeTemplate: String(getConfigValue('rush_welcome_template') || '').trim() || _rushDefaultTemplate(cfg),
    customSubject: !!String(getConfigValue('rush_welcome_subject') || '').trim(),
    customTemplate: !!String(getConfigValue('rush_welcome_template') || '').trim(),
    newMemberFormUrl: String(getConfigValue('new_member_form_url') || '').trim()
  };
}

function _rushCodeOk(settings, code) {
  if (!settings.code) return true;
  var a = String(code || '').trim().toLowerCase(), b = settings.code.toLowerCase();
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) === Number(b);
  return a === b;
}

function rushSaveSettings(pin, payloadJson, performedBy) {
  var denied = _rushDeny(pin); if (denied) return denied;
  try {
    var p = _fmJson(payloadJson, {});
    if (p.open !== undefined) setConfigValue('rush_open', p.open ? 'true' : 'false');
    if (p.code !== undefined) {
      var code = String(p.code).trim();
      if (code.length > 40) return _rushFail('The access code can be at most 40 characters.');
      setConfigValue('rush_code', code);
    }
    if (p.yearOptions !== undefined) {
      var years = String(p.yearOptions).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      if (!years.length || years.length > 12) return _rushFail('Give between 1 and 12 year options, separated by commas.');
      if (years.some(function(y) { return y.length > 30; })) return _rushFail('Each year option can be at most 30 characters.');
      setConfigValue('rush_year_options', years.join(','));
    }
    if (p.welcomeSubject !== undefined) {
      var subj = String(p.welcomeSubject).trim();
      if (subj.length > 150) return _rushFail('The email subject can be at most 150 characters.');
      setConfigValue('rush_welcome_subject', subj);
    }
    if (p.welcomeTemplate !== undefined) {
      var tpl = String(p.welcomeTemplate).trim();
      if (tpl.length > 3000) return _rushFail('The welcome message can be at most 3000 characters.');
      setConfigValue('rush_welcome_template', tpl);
    }
    _rushTouch();
    logInfo('rushSaveSettings', 'by ' + (performedBy || 'Officer') + ' keys=' + Object.keys(p).join(','));
    return JSON.stringify({ success: true });
  } catch (err) { logError('rushSaveSettings', err); return _rushFail(err.toString()); }
}

// ---- Sheets ------------------------------------------------

function _rushSheets(ss) {
  return {
    pnm: _fmSheet(ss, 'rush_pnms', RUSH_PNM_HEADERS),
    visit: _fmSheet(ss, 'rush_visits', RUSH_VISIT_HEADERS),
    comment: _fmSheet(ss, 'rush_comments', RUSH_COMMENT_HEADERS)
  };
}

function _rushRows(sheet) {
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(String);
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var o = { _row: i + 1 };
    for (var j = 0; j < headers.length; j++) {
      var v = data[i][j];
      o[headers[j]] = v instanceof Date ? v.toISOString() : String(v == null ? '' : v);
    }
    out.push(o);
  }
  return out;
}

function _rushAppend(sheet, headers, obj) {
  sheet.appendRow(headers.map(function(h) { return obj[h] == null ? '' : obj[h]; }));
}

function _rushUpdate(sheet, row, fields) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var cur = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  Object.keys(fields).forEach(function(k) {
    var ix = headers.indexOf(k);
    if (ix !== -1) cur[ix] = fields[k];
  });
  sheet.getRange(row, 1, 1, lastCol).setValues([cur]);
}

function _rushDeleteRows(sheet, rows) {
  rows.slice().sort(function(a, b) { return b - a; }).forEach(function(r) { sheet.deleteRow(r); });
}

// ---- Matching / normalization -------------------------------

function _rushClean(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().substring(0, max); }

function _rushDigits(s) {
  var d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.substring(1);
  return d.length >= 7 ? d : '';
}

function _rushHandle(s) {
  var t = String(s || '').trim().toLowerCase();
  if (!t) return '';
  var m = t.match(/(?:instagram\.com|instagr\.am)\/([a-z0-9._]+)/);
  if (m) return m[1];
  return t.replace(/^@+/, '').replace(/\s+/g, '');
}

function _rushNameKey(s) {
  s = String(s || '').toLowerCase();
  try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

function _rushFindMatch(pnms, rec) {
  var ph = _rushDigits(rec.phone), ig = _rushHandle(rec.instagram), nk = _rushNameKey(rec.name);
  var i, p;
  for (i = 0; i < pnms.length; i++) {
    p = pnms[i];
    if (ph && _rushDigits(p.phone) === ph) return p;
    if (ig && _rushHandle(p.instagram) === ig) return p;
  }
  for (i = 0; i < pnms.length; i++) {
    p = pnms[i];
    if (_rushNameKey(p.name) !== nk) continue;
    var pHas = _rushDigits(p.phone) || _rushHandle(p.instagram);
    if (!pHas || !(ph || ig)) return p;
  }
  return null;
}

function _rushValidEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

// Cleans and validates person fields. Returns { rec } or { error }.
function _rushCleanRec(p, settings) {
  var rec = {
    name: _rushClean(p.name, 80).replace(/\s+/g, ' '),
    year: _rushClean(p.year, 30),
    instagram: _rushClean(p.instagram, 100),
    phone: _rushClean(p.phone, 30),
    email: _rushClean(p.email, 120).toLowerCase()
  };
  if (rec.name.length < 2 || !/[A-Za-z\u00C0-\u024F]/.test(rec.name)) return { error: 'Please enter the full name.' };
  if (rec.year && settings.yearOptions.indexOf(rec.year) === -1) return { error: 'Pick a year from the list.' };
  if (rec.phone && !_rushDigits(rec.phone)) return { error: 'That phone number does not look right.' };
  if (rec.email && !_rushValidEmail(rec.email)) return { error: 'That email does not look right.' };
  return { rec: rec };
}

// ---- Core upsert + visit ------------------------------------

function _rushAddVisit(sh, visits, pnmId, date, source, by) {
  for (var i = 0; i < visits.length; i++) {
    if (visits[i].pnm_id === pnmId && visits[i].date === date) return false;
  }
  var v = { visit_id: _fmNewId('V'), pnm_id: pnmId, date: date, arrived_at: new Date().toISOString(), source: source, logged_by: by || '' };
  _rushAppend(sh.visit, RUSH_VISIT_HEADERS, v);
  visits.push(v);
  return true;
}

// Creates the PNM (or finds the existing one) and records today's visit.
// opts: { source, by, visit (bool), requireNew (bool) }
function _rushUpsert(ss, rec, opts) {
  var sh = _rushSheets(ss), sem = _rushSemester();
  var pnms = _rushRows(sh.pnm).filter(function(p) { return p.semester === sem; });
  var visits = _rushRows(sh.visit);
  var match = _rushFindMatch(pnms, rec);
  var now = new Date().toISOString(), p, created = false;

  if (match) {
    if (opts.requireNew) return { error: match.name + ' is already on the list.', existingId: match.pnm_id };
    var upd = {};
    ['year', 'instagram', 'phone', 'email'].forEach(function(k) { if (!match[k] && rec[k]) upd[k] = rec[k]; });
    if (match.status === 'flushed') upd.status = 'active';
    if (Object.keys(upd).length) { upd.updated_at = now; _rushUpdate(sh.pnm, match._row, upd); Object.keys(upd).forEach(function(k) { match[k] = upd[k]; }); }
    p = match;
  } else {
    if (pnms.length >= RUSH_MAX_PNMS) return { error: 'The list is full.' };
    p = {
      pnm_id: _fmNewId('P'), name: rec.name, year: rec.year, instagram: rec.instagram, phone: rec.phone, email: rec.email,
      status: 'active', semester: sem, bid_owner: '', bid_at: '', response_at: '', welcome_sent_at: '',
      source: opts.source, created_at: now, updated_at: now
    };
    _rushAppend(sh.pnm, RUSH_PNM_HEADERS, p);
    created = true;
  }
  var added = false;
  if (opts.visit) added = _rushAddVisit(sh, visits, p.pnm_id, _todayStr(), opts.source, opts.by);
  var days = visits.filter(function(v) { return v.pnm_id === p.pnm_id; }).length;
  return { pnm: p, created: created, visitAdded: added, days: days };
}

// ---- Public: door check-in ----------------------------------

function rushGetDoorInfo() {
  try {
    var s = _rushSettings();
    return JSON.stringify({ success: true, open: s.open, yearOptions: s.yearOptions });
  } catch (err) { logError('rushGetDoorInfo', err); return _rushFail('Could not load the check-in form.'); }
}

function rushSubmitCheckin(payloadJson) {
  try {
    var p = _fmJson(payloadJson, {});
    if (p.hp) return JSON.stringify({ success: true, returning: false, firstName: '' });
    var s = _rushSettings();
    if (!s.open) return _rushFail('Check-in is closed right now.');
    var c = _rushCleanRec(p, s);
    if (c.error) return _rushFail(c.error);
    if (!c.rec.year) return _rushFail('Pick your year.');
    if (!c.rec.phone) return _rushFail('Please enter your phone number.');
    var r = _rushLocked(function() { return _rushUpsert(getSpreadsheet(), c.rec, { source: 'form', by: '', visit: true }); });
    if (r.error) return _rushFail(r.error);
    _rushTouch();
    return JSON.stringify({ success: true, returning: !r.created, firstName: r.pnm.name.split(' ')[0] });
  } catch (err) { logError('rushSubmitCheckin', err); return _rushFail('Something went wrong. Please try again.'); }
}

// ---- Public: brothers board ---------------------------------

function _rushBoardRoster() {
  return _eventRoster('everyone').map(function(m) { return { key: m.type + ':' + m.memberId, name: m.name }; });
}

function rushBoardAccess(code) {
  try {
    var s = _rushSettings();
    var ok = _rushCodeOk(s, code);
    var out = { success: true, codeRequired: !!s.code, authorized: ok, chapterOpen: s.open };
    if (ok) out.roster = _rushBoardRoster();
    return JSON.stringify(out);
  } catch (err) { logError('rushBoardAccess', err); return _rushFail('Could not load the board.'); }
}

function _rushLoad(ss, sem) {
  var sh = _rushSheets(ss);
  var pnms = _rushRows(sh.pnm).filter(function(p) { return p.semester === sem; });
  var byId = {};
  pnms.forEach(function(p) { byId[p.pnm_id] = p; });
  return {
    sh: sh, pnms: pnms, byId: byId,
    visits: _rushRows(sh.visit).filter(function(v) { return byId[v.pnm_id]; }),
    comments: _rushRows(sh.comment).filter(function(c) { return byId[c.pnm_id]; })
  };
}

function _rushAssemble(L, forOfficer) {
  var vBy = {}, cBy = {};
  L.visits.forEach(function(v) { (vBy[v.pnm_id] = vBy[v.pnm_id] || []).push(v); });
  L.comments.forEach(function(c) { (cBy[c.pnm_id] = cBy[c.pnm_id] || []).push(c); });
  return L.pnms.map(function(p) {
    var visits = (vBy[p.pnm_id] || []).map(function(v) {
      var o = { date: v.date, at: v.arrived_at };
      if (forOfficer) { o.id = v.visit_id; o.source = v.source; o.by = v.logged_by; }
      return o;
    }).sort(function(a, b) { return a.date === b.date ? (a.at < b.at ? -1 : 1) : (a.date < b.date ? -1 : 1); });
    var comments = (cBy[p.pnm_id] || []).map(function(c) {
      var o = { id: c.comment_id, author: c.author_name, text: c.text, at: c.created_at };
      if (forOfficer) o.authorKey = c.author_key;
      return o;
    }).sort(function(a, b) { return a.at < b.at ? -1 : 1; });
    var out = { id: p.pnm_id, name: p.name, year: p.year, instagram: p.instagram, visits: visits, comments: comments };
    if (forOfficer) {
      out.phone = p.phone; out.email = p.email; out.status = p.status; out.bidOwner = p.bid_owner; out.bidAt = p.bid_at;
      out.responseAt = p.response_at; out.welcomeSentAt = p.welcome_sent_at; out.source = p.source; out.createdAt = p.created_at;
    }
    return out;
  });
}

// One call for the brothers page: returns the board only when something changed.
function rushPoll(code, knownToken) {
  try {
    var s = _rushSettings();
    if (!_rushCodeOk(s, code)) return _rushFail('Wrong access code.');
    var sem = _rushSemester();
    var token = _rushVersion() + '|' + sem;
    if (knownToken && String(knownToken) === token) return JSON.stringify({ success: true, changed: false, token: token });
    var L = _rushLoad(getSpreadsheet(), sem);
    var pnms = _rushAssemble(L, false);
    var status = {};
    L.pnms.forEach(function(p) { status[p.pnm_id] = p.status; });
    pnms = pnms.filter(function(p) { return status[p.id] === 'active' || status[p.id] === 'bid'; });
    return JSON.stringify({ success: true, changed: true, token: token, today: _todayStr(), pnms: pnms });
  } catch (err) { logError('rushPoll', err); return _rushFail('Could not load the board.'); }
}

function rushAddComment(code, authorKey, pnmId, text) {
  try {
    var s = _rushSettings();
    if (!_rushCodeOk(s, code)) return _rushFail('Wrong access code.');
    var body = _rushClean(text, RUSH_MAX_COMMENT);
    if (!body) return _rushFail('Write a comment first.');
    var author = _rushBoardRoster().filter(function(m) { return m.key === String(authorKey); })[0];
    if (!author) return _rushFail('Pick your name from the list first.');
    var c = _rushLocked(function() {
      var ss = getSpreadsheet(), sh = _rushSheets(ss);
      var p = _rushRows(sh.pnm).filter(function(r) { return r.pnm_id === String(pnmId) && r.semester === _rushSemester(); })[0];
      if (!p || (p.status !== 'active' && p.status !== 'bid')) return null;
      var row = { comment_id: _fmNewId('C'), pnm_id: p.pnm_id, author_key: author.key, author_name: author.name, text: body, created_at: new Date().toISOString() };
      _rushAppend(sh.comment, RUSH_COMMENT_HEADERS, row);
      return row;
    });
    if (!c) return _rushFail('That person is no longer on the list.');
    _rushTouch();
    return JSON.stringify({ success: true });
  } catch (err) { logError('rushAddComment', err); return _rushFail('Could not post the comment. Try again.'); }
}

// ---- Officer: dashboard data --------------------------------

function rushGetDashboard(pin, semester, knownToken) {
  var denied = _rushDeny(pin); if (denied) return denied;
  try {
    var cur = _rushSemester();
    var sem = semester ? String(semester) : cur;
    var token = _rushVersion() + '|' + sem;
    if (knownToken && String(knownToken) === token) return JSON.stringify({ success: true, unchanged: true });
    var ss = getSpreadsheet();
    var L = _rushLoad(ss, sem);
    var seen = {};
    _rushRows(L.sh.pnm).forEach(function(p) { seen[p.semester] = true; });
    seen[cur] = true;
    var s = _rushSettings();
    return JSON.stringify({
      success: true, token: token, semester: sem, currentSemester: cur,
      semesters: Object.keys(seen).filter(Boolean).sort().reverse(),
      today: _todayStr(),
      settings: { open: s.open, code: s.code, yearOptions: s.yearOptions, hasNewMemberForm: !!s.newMemberFormUrl, customSubject: s.customSubject, customTemplate: s.customTemplate, welcomeSubject: s.welcomeSubject, welcomeTemplate: s.welcomeTemplate },
      pnms: _rushAssemble(L, true),
      roster: _rushBoardRoster()
    });
  } catch (err) { logError('rushGetDashboard', err); return _rushFail(err.toString()); }
}

// ---- Officer: edit people -----------------------------------

function rushAddPnm(pin, payloadJson, performedBy) {
  var denied = _rushDeny(pin); if (denied) return denied;
  try {
    var p = _fmJson(payloadJson, {});
    var c = _rushCleanRec(p, _rushSettings());
    if (c.error) return _rushFail(c.error);
    var by = _rushClean(performedBy || 'Officer', 60);
    var r = _rushLocked(function() {
      return _rushUpsert(getSpreadsheet(), c.rec, { source: 'manual', by: by, visit: !!p.markToday, requireNew: !p.markToday });
    });
    if (r.error) return _rushFail(r.error);
    _rushTouch();
    return JSON.stringify({ success: true, id: r.pnm.pnm_id, created: r.created, visitAdded: r.visitAdded, name: r.pnm.name });
  } catch (err) { logError('rushAddPnm', err); return _rushFail(err.toString()); }
}

function rushUpdatePnm(pin, pnmId, payloadJson, performedBy) {
  var denied = _rushDeny(pin); if (denied) return denied;
  try {
    var c = _rushCleanRec(_fmJson(payloadJson, {}), _rushSettings());
    if (c.error) return _rushFail(c.error);
    return _rushLocked(function() {
      var sh = _rushSheets(getSpreadsheet());
      var p = _rushRows(sh.pnm).filter(function(r) { return r.pnm_id === String(pnmId); })[0];
      if (!p) return _rushFail('Person not found.');
      _rushUpdate(sh.pnm, p._row, { name: c.rec.name, year: c.rec.year, instagram: c.rec.instagram, phone: c.rec.phone, email: c.rec.email, updated_at: new Date().toISOString() });
      _rushTouch();
      return JSON.stringify({ success: true });
    });
  } catch (err) { logError('rushUpdatePnm', err); return _rushFail(err.toString()); }
}

function rushSetVisit(pin, pnmId, date, present, performedBy) {
  var denied = _rushDeny(pin); if (denied) return denied;
  try {
    date = String(date || '').substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2020-01-01' || date > _todayStr()) return _rushFail('Pick a valid day that is not in the future.');
    return _rushLocked(function() {
      var sh = _rushSheets(getSpreadsheet());
      var p = _rushRows(sh.pnm).filter(function(r) { return r.pnm_id === String(pnmId); })[0];
      if (!p) return _rushFail('Person not found.');
      var visits = _rushRows(sh.visit);
      if (present) {
        _rushAddVisit(sh, visits, p.pnm_id, date, 'manual', _rushClean(performedBy || 'Officer', 60));
      } else {
        var rows = visits.filter(function(v) { return v.pnm_id === p.pnm_id && v.date === date; }).map(function(v) { return v._row; });
        _rushDeleteRows(sh.visit, rows);
      }
      _rushTouch();
      return JSON.stringify({ success: true });
    });
  } catch (err) { logError('rushSetVisit', err); return _rushFail(err.toString()); }
}

function rushDeleteComment(pin, commentId) {
  var denied = _rushDeny(pin); if (denied) return denied;
  try {
    return _rushLocked(function() {
      var sh = _rushSheets(getSpreadsheet());
      var c = _rushRows(sh.comment).filter(function(r) { return r.comment_id === String(commentId); })[0];
      if (!c) return _rushFail('Comment not found.');
      sh.comment.deleteRow(c._row);
      _rushTouch();
      return JSON.stringify({ success: true });
    });
  } catch (err) { logError('rushDeleteComment', err); return _rushFail(err.toString()); }
}

// Permanently removes a person with their visits and comments (spam / mistakes).
function rushDeletePnm(pin, pnmId, performedBy) {
  var denied = _rushDeny(pin); if (denied) return denied;
  try {
    return _rushLocked(function() {
      var sh = _rushSheets(getSpreadsheet());
      var p = _rushRows(sh.pnm).filter(function(r) { return r.pnm_id === String(pnmId); })[0];
      if (!p) return _rushFail('Person not found.');
      _rushDeleteRows(sh.visit, _rushRows(sh.visit).filter(function(v) { return v.pnm_id === p.pnm_id; }).map(function(v) { return v._row; }));
      _rushDeleteRows(sh.comment, _rushRows(sh.comment).filter(function(c) { return c.pnm_id === p.pnm_id; }).map(function(c) { return c._row; }));
      sh.pnm.deleteRow(p._row);
      _rushTouch();
      logInfo('rushDeletePnm', p.name + ' deleted by ' + (performedBy || 'Officer'));
      return JSON.stringify({ success: true });
    });
  } catch (err) { logError('rushDeletePnm', err); return _rushFail(err.toString()); }
}

// ---- Officer: flush / bid / accept --------------------------

// action: flush | restore | bid | bid_owner | take_back | accept | decline | reopen
function rushAct(pin, pnmId, action, extraJson, performedBy) {
  var denied = _rushDeny(pin); if (denied) return denied;
  try {
    var extra = _fmJson(extraJson, {});
    return _rushLocked(function() {
      var sh = _rushSheets(getSpreadsheet());
      var p = _rushRows(sh.pnm).filter(function(r) { return r.pnm_id === String(pnmId); })[0];
      if (!p) return _rushFail('Person not found.');
      var st = p.status, now = new Date().toISOString(), upd = { updated_at: now };
      var owner = _rushClean(extra.owner, 80);
      var wrong = function() { return _rushFail('That action is not available for someone in the "' + st + '" state.'); };
      if (action === 'flush') {
        if (st !== 'active') return wrong();
        upd.status = 'flushed';
      } else if (action === 'restore') {
        if (st !== 'flushed' && st !== 'declined') return wrong();
        upd.status = 'active'; upd.bid_owner = ''; upd.bid_at = ''; upd.response_at = '';
      } else if (action === 'bid') {
        if (st !== 'active') return wrong();
        upd.status = 'bid'; upd.bid_owner = owner; upd.bid_at = now; upd.response_at = '';
      } else if (action === 'bid_owner') {
        if (st !== 'bid') return wrong();
        upd.bid_owner = owner;
      } else if (action === 'take_back') {
        if (st !== 'bid') return wrong();
        upd.status = 'active'; upd.bid_owner = ''; upd.bid_at = ''; upd.response_at = '';
      } else if (action === 'accept' || action === 'decline') {
        if (st !== 'bid') return wrong();
        upd.status = action === 'accept' ? 'accepted' : 'declined'; upd.response_at = now;
      } else if (action === 'reopen') {
        if (st !== 'accepted' && st !== 'declined') return wrong();
        upd.status = 'bid'; upd.response_at = '';
      } else {
        return _rushFail('Unknown action.');
      }
      _rushUpdate(sh.pnm, p._row, upd);
      _rushTouch();
      logInfo('rushAct', action + ' ' + p.name + ' by ' + (performedBy || 'Officer'));
      return JSON.stringify({ success: true });
    });
  } catch (err) { logError('rushAct', err); return _rushFail(err.toString()); }
}

// ---- Officer: welcome message for accepted PNMs -------------

function _rushRender(tpl, p) {
  var cfg = getChapterConfig();
  var link = String(getConfigValue('new_member_form_url') || '').trim() || RUSH_NM_LINK_PLACEHOLDER;
  var vars = {
    name: p.name, first_name: p.name.split(' ')[0], chapter: cfg.chapter.chapter_name || '',
    new_member: cfg.labels.label_new_member || '', link: link
  };
  return String(tpl).replace(/\{(name|first_name|chapter|new_member|link)\}/g, function(_, k) { return vars[k]; });
}

function _rushAcceptedPnm(sh, pnmId) {
  var p = _rushRows(sh.pnm).filter(function(r) { return r.pnm_id === String(pnmId); })[0];
  if (!p) return { error: 'Person not found.' };
  if (p.status !== 'accepted') return { error: 'Only accepted people can be welcomed.' };
  return { p: p };
}

function rushPrepareWelcome(pin, pnmId) {
  var denied = _rushDeny(pin); if (denied) return denied;
  try {
    var sh = _rushSheets(getSpreadsheet());
    var r = _rushAcceptedPnm(sh, pnmId);
    if (r.error) return _rushFail(r.error);
    var s = _rushSettings();
    return JSON.stringify({
      success: true, name: r.p.name, email: r.p.email, sentAt: r.p.welcome_sent_at,
      subject: _rushRender(s.welcomeSubject, r.p), body: _rushRender(s.welcomeTemplate, r.p),
      linkIsPlaceholder: !s.newMemberFormUrl
    });
  } catch (err) { logError('rushPrepareWelcome', err); return _rushFail(err.toString()); }
}

// The recipient always comes from the stored record, never from the client.
function rushSendWelcome(pin, pnmId, subject, body, performedBy) {
  var denied = _rushDeny(pin); if (denied) return denied;
  try {
    subject = _rushClean(subject, 150);
    body = String(body || '').trim();
    if (!subject || !body) return _rushFail('The subject and message cannot be empty.');
    if (body.length > 5000) return _rushFail('The message is too long.');
    return _rushLocked(function() {
      var sh = _rushSheets(getSpreadsheet());
      var r = _rushAcceptedPnm(sh, pnmId);
      if (r.error) return _rushFail(r.error);
      if (!r.p.email) return _rushFail('This person has no email on file. Use "Copy message" and send it yourself.');
      GmailApp.sendEmail(r.p.email, subject, body, { name: getChapterConfig().chapter.chapter_name || 'Chapter' });
      var now = new Date().toISOString();
      _rushUpdate(sh.pnm, r.p._row, { welcome_sent_at: now, updated_at: now });
      _rushTouch();
      logInfo('rushSendWelcome', r.p.name + ' by ' + (performedBy || 'Officer'));
      return JSON.stringify({ success: true, sentAt: now });
    });
  } catch (err) { logError('rushSendWelcome', err); return _rushFail(err.toString()); }
}

// Marks the welcome as handled outside the app (copied text sent by hand).
function rushMarkWelcomed(pin, pnmId, performedBy) {
  var denied = _rushDeny(pin); if (denied) return denied;
  try {
    return _rushLocked(function() {
      var sh = _rushSheets(getSpreadsheet());
      var r = _rushAcceptedPnm(sh, pnmId);
      if (r.error) return _rushFail(r.error);
      var now = new Date().toISOString();
      _rushUpdate(sh.pnm, r.p._row, { welcome_sent_at: now, updated_at: now });
      _rushTouch();
      return JSON.stringify({ success: true, sentAt: now });
    });
  } catch (err) { logError('rushMarkWelcomed', err); return _rushFail(err.toString()); }
}
