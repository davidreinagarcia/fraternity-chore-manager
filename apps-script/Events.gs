// ============================================================
// Events.gs — chapter-wide events with automatic Google Calendar sync.
// Sheet tab `events` is the source of truth; every save/delete mirrors
// to the Google Calendar picked in config key `events_calendar_id`
// (chosen from the dashboard: Events > Google Calendar). If the calendar
// call fails the sheet write still stands and the row is left unsynced
// (blank gcal_event_id) so "Sync pending" can retry it later.
// Separate from AM Events (AMEvents.gs), which stays as its own point system.
// ============================================================


// attendance: 'none' | 'brothers' | 'novatos' | 'everyone' (who is expected;
// anything but 'none' means a roll call is taken). counts_for_novatos feeds the
// event into the novato attendance % (AM Manager) with `points` weight.
// series_id ties the occurrences of a repeating event together (rule in the
// `event_series` tab); gcal_dirty = 'Y' means the row changed and still has to be
// pushed to Google Calendar.
var EVENT_HEADERS = ['event_id', 'title', 'event_type', 'event_date', 'start_time', 'end_time', 'all_day', 'location', 'description', 'gcal_event_id', 'created_by', 'created_at', 'updated_at', 'attendance', 'counts_for_novatos', 'points', 'series_id', 'gcal_dirty'];
var EVENT_ATTENDANCE_HEADERS = ['event_id', 'member_id', 'member_name', 'member_type', 'marked_by', 'marked_at'];
var EVENT_SERIES_HEADERS = ['series_id', 'rule', 'materialized_until'];
var EVENT_ATTENDANCE_MODES = ['none', 'brothers', 'novatos', 'everyone'];
var EVENT_FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
var EVENT_TYPES_DEFAULT = 'Chapter,Social,Brotherhood,Philanthropy,Recruitment,Other';
var EVENT_SYNC_BUDGET_MS = 40000;
var EVENT_MAX_SERIES_LEN = 500;

function _audienceTypes(mode) {
  return { brothers: ['brother'], novatos: ['novato'], everyone: ['brother', 'novato'] }[mode] || [];
}

function _getEventTypes() {
  var raw = String(getChapterConfig().options.event_types || EVENT_TYPES_DEFAULT);
  var types = raw.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
  return types.length ? types : EVENT_TYPES_DEFAULT.split(',');
}

// Times are stored as plain text ('HH:mm'); a default-formatted cell would
// turn '19:00' into a 1899 Date and read back shifted by LMT offsets.
function _getEventsSheet(ss) {
  var sheet = ss.getSheetByName('events');
  if (!sheet) {
    sheet = ss.insertSheet('events');
    sheet.appendRow(EVENT_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 4, sheet.getMaxRows(), 3).setNumberFormat('@');
  }
  // Older installs created the tab before attendance existed: add any missing columns.
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
  EVENT_HEADERS.forEach(function(h) {
    if (headers.indexOf(h) !== -1) return;
    if (sheet.getMaxColumns() < headers.length + 1) sheet.insertColumnAfter(sheet.getMaxColumns());
    sheet.getRange(1, headers.length + 1).setValue(h);
    headers.push(h);
  });
  _ensureTextDateColumn(sheet, headers);
  return sheet;
}

// event_date is stored as plain 'yyyy-MM-dd' text. Real Date cells go through the
// script/spreadsheet/config timezones twice (write and read) and can land on the
// neighbouring day; text can't. Converts older tabs that still hold Date cells.
function _ensureTextDateColumn(sheet, headers) {
  var col = headers.indexOf('event_date') + 1;
  if (!col || sheet.getRange(1, col).getNumberFormat() === '@') return;
  var last = sheet.getLastRow();
  var texts = last > 1 ? sheet.getRange(2, col, last - 1, 1).getValues().map(function(r) { return [_normDate(r[0])]; }) : [];
  sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat('@');
  if (texts.length) sheet.getRange(2, col, texts.length, 1).setValues(texts);
}

function _getEventAttendanceSheet(ss) {
  var sheet = ss.getSheetByName('event_attendance');
  if (!sheet) {
    sheet = ss.insertSheet('event_attendance');
    sheet.appendRow(EVENT_ATTENDANCE_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Attendance rows grouped by event: { eventId: [{ memberId, name, type }] }
function _readEventAttendance(ss) {
  var sheet = ss.getSheetByName('event_attendance');
  var out = {};
  if (!sheet) return out;
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return out;
  var cm = _buildColMap(data[0]);
  for (var i = 1; i < data.length; i++) {
    var eid = String(data[i][cm['event_id']]);
    if (!eid) continue;
    if (!out[eid]) out[eid] = [];
    out[eid].push({ memberId: String(data[i][cm['member_id']]), name: String(data[i][cm['member_name']] || ''), type: String(data[i][cm['member_type']]) });
  }
  return out;
}

// Deletes this event's attendance rows except those whose member_type is in keepTypes.
function _pruneEventAttendance(ss, eventId, keepTypes) {
  var sheet = ss.getSheetByName('event_attendance');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  var cm = _buildColMap(data[0]);
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][cm['event_id']]) === String(eventId) && keepTypes.indexOf(String(data[i][cm['member_type']])) === -1) sheet.deleteRow(i + 1);
  }
}

function _normTime(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, _getTimezone(), 'HH:mm');
  var m = String(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}


function _eventFromRow(r, cm) {
  var allDayRaw = r[cm['all_day']];
  var mode = String(r[cm['attendance']] || 'none').toLowerCase();
  if (EVENT_ATTENDANCE_MODES.indexOf(mode) === -1) mode = 'none';
  var countsRaw = r[cm['counts_for_novatos']];
  var pointsRaw = r[cm['points']];
  return {
    attendance: mode,
    countsForNovatos: countsRaw === true || String(countsRaw).toUpperCase() === 'TRUE',
    points: (pointsRaw === '' || pointsRaw === undefined) ? 1 : (Number(pointsRaw) || 0),
    eventId: String(r[cm['event_id']]),
    title: String(r[cm['title']] || ''),
    type: String(r[cm['event_type']] || ''),
    date: _normDate(r[cm['event_date']]),
    startTime: _normTime(r[cm['start_time']]),
    endTime: _normTime(r[cm['end_time']]),
    allDay: allDayRaw === true || String(allDayRaw).toUpperCase() === 'TRUE',
    location: String(r[cm['location']] || ''),
    description: String(r[cm['description']] || ''),
    gcalEventId: String(r[cm['gcal_event_id']] || ''),
    seriesId: String(r[cm['series_id']] || ''),
    gcalDirty: String(r[cm['gcal_dirty']] || '') === 'Y'
  };
}

function _addOneHour(hhmm) {
  var p = hhmm.split(':');
  var h = Number(p[0]) + 1;
  return h > 23 ? '23:59' : ('0' + h).slice(-2) + ':' + p[1];
}

function _eventNeedsSync(rec) { return !rec.gcal_event_id || rec.gcal_dirty === 'Y'; }

function getEventsData() {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('events') ? _getEventsSheet(ss) : null;
    if (sheet) _extendSeries(ss, sheet);
    var data = sheet ? sheet.getDataRange().getValues() : [];
    var cm = data.length ? _buildColMap(data[0]) : {};
    var attByEvent = _readEventAttendance(ss);
    var events = [];
    var pending = 0;
    for (var i = 1; i < data.length; i++) {
      if (!data[i].join('').trim()) continue;
      var ev = _eventFromRow(data[i], cm);
      if (!ev.gcalEventId || ev.gcalDirty) pending++;
      var att = attByEvent[ev.eventId] || [];
      ev.brothersAttended = att.filter(function(a) { return a.type === 'brother'; }).length;
      ev.novatosAttended = att.filter(function(a) { return a.type === 'novato'; }).length;
      events.push(ev);
    }
    events.sort(function(a, b) { return (a.date + (a.startTime || '00:00')).localeCompare(b.date + (b.startTime || '00:00')); });
    var series = {};
    _readSeries(ss).forEach(function(s) { series[s.seriesId] = s.rule; });
    var queued = ss.getSheetByName('event_gcal_deletes');
    if (queued && queued.getLastRow() > 1) pending += queued.getLastRow() - 1;
    var calId = String(getConfigValue('events_calendar_id') || '').trim();
    return JSON.stringify({ success: true, events: events, types: _getEventTypes(), calendarLinked: !!calId, pendingSync: pending, series: series });
  } catch (err) { logError('getEventsData', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// ---- Recurrence ------------------------------------------------
// A repeating event is stored as one row per occurrence (so each keeps its own
// attendance and Google Calendar id), tied together by series_id. The rule lives in
// the `event_series` tab. Occurrences are materialized up to a rolling horizon and
// topped up whenever the Events tab loads. Dates are 'yyyy-MM-dd' strings and all
// day math is done in UTC so it never depends on a timezone.

function _dParse(s) { var p = String(s).split('-'); return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))); }
function _dFmt(d) { return d.toISOString().substring(0, 10); }
function _dAdd(s, n) { var d = _dParse(s); d.setUTCDate(d.getUTCDate() + n); return _dFmt(d); }
function _dDiff(a, b) { return Math.round((_dParse(b).getTime() - _dParse(a).getTime()) / 86400000); }
function _dDow(s) { return _dParse(s).getUTCDay(); }
function _daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
function _ymd(y, m, d) { return y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + d).slice(-2); }
function _todayStr() { return Utilities.formatDate(new Date(), _getTimezone(), 'yyyy-MM-dd'); }
function _newEventId() { return 'EV' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase(); }
function _newSeriesId() { return 'SR' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase(); }

// Cleans a rule coming from the client. Monthly/yearly details are always derived
// from the anchor date so they can never disagree with it.
function _normalizeRule(rule, anchor) {
  if (!rule || EVENT_FREQS.indexOf(rule.freq) === -1) return null;
  var r = { freq: rule.freq, interval: Math.max(1, Math.min(99, parseInt(rule.interval, 10) || 1)), anchor: anchor, ends: 'never' };
  if (r.freq === 'weekly') {
    var seen = {};
    r.byDay = (rule.byDay || []).map(Number).filter(function(d) {
      if (!(d >= 0 && d <= 6) || seen[d]) return false;
      seen[d] = true;
      return true;
    }).sort();
    if (!r.byDay.length) r.byDay = [_dDow(anchor)];
  }
  if (r.freq === 'monthly') {
    var day = Number(anchor.substring(8));
    r.monthMode = (rule.monthMode === 'nth' || rule.monthMode === 'last') ? rule.monthMode : 'dom';
    r.dom = day;
    r.weekday = _dDow(anchor);
    r.nth = Math.ceil(day / 7);
    if (r.monthMode === 'last' && day + 7 <= _daysInMonth(Number(anchor.substring(0, 4)), Number(anchor.substring(5, 7)) - 1)) r.monthMode = 'nth';
  }
  if (rule.ends === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(rule.until || '')) && rule.until >= anchor) { r.ends = 'date'; r.until = rule.until; }
  else if (rule.ends === 'count') { r.ends = 'count'; r.count = Math.max(1, Math.min(EVENT_MAX_SERIES_LEN, parseInt(rule.count, 10) || 1)); }
  return r;
}

// All occurrence dates of a rule up to `horizon` (inclusive). The anchor is always the first one.
function _expandRule(r, horizon) {
  var limit = horizon;
  if (r.ends === 'date' && r.until < limit) limit = r.until;
  var a = r.anchor, c = [a], guard = 0;
  var ay = Number(a.substring(0, 4)), am = Number(a.substring(5, 7)) - 1, ad = Number(a.substring(8));
  if (r.freq === 'daily') {
    for (var d = a; d <= limit && guard++ < 5000; d = _dAdd(d, r.interval)) c.push(d);
  } else if (r.freq === 'weekly') {
    for (var w = _dAdd(a, -_dDow(a)); w <= limit && guard++ < 5000; w = _dAdd(w, 7 * r.interval)) {
      for (var j = 0; j < r.byDay.length; j++) c.push(_dAdd(w, r.byDay[j]));
    }
  } else if (r.freq === 'monthly') {
    for (var k = 0; guard++ < 5000; k += r.interval) {
      var tm = am + k, y = ay + Math.floor(tm / 12), m = tm % 12;
      if (_ymd(y, m, 1) > limit) break;
      var dim = _daysInMonth(y, m), day;
      if (r.monthMode === 'dom') day = r.dom;
      else if (r.monthMode === 'last') day = dim - ((_dDow(_ymd(y, m, dim)) - r.weekday + 7) % 7);
      else day = 1 + ((r.weekday - _dDow(_ymd(y, m, 1)) + 7) % 7) + (r.nth - 1) * 7;
      if (day <= dim) c.push(_ymd(y, m, day));
    }
  } else {
    for (var n = 0; guard++ < 5000; n += r.interval) {
      var yy = ay + n;
      if (_ymd(yy, am, 1) > limit) break;
      if (ad <= _daysInMonth(yy, am)) c.push(_ymd(yy, am, ad));
    }
  }
  c.sort();
  var seen = {}, out = [];
  c.forEach(function(x) {
    if (seen[x] || x < a || (x !== a && x > limit)) return;
    seen[x] = true;
    out.push(x);
  });
  return r.ends === 'count' ? out.slice(0, r.count) : out;
}

// How far ahead occurrences are kept materialized (a repeating event never ends,
// so only the next stretch exists as rows and the tail is topped up on load).
function _seriesHorizon(r, today) {
  var base = today > r.anchor ? today : r.anchor;
  return _dAdd(base, { daily: 90, weekly: 180, monthly: 365, yearly: 1095 }[r.freq]);
}

function _getSeriesSheet(ss) {
  var sheet = ss.getSheetByName('event_series');
  if (!sheet) {
    sheet = ss.insertSheet('event_series');
    sheet.appendRow(EVENT_SERIES_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, sheet.getMaxRows(), 3).setNumberFormat('@');
  }
  return sheet;
}

function _readSeries(ss) {
  var sheet = ss.getSheetByName('event_series');
  var out = [];
  if (!sheet) return out;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var rule = null;
    try { rule = JSON.parse(String(data[i][1])); } catch (_) {}
    if (rule && EVENT_FREQS.indexOf(rule.freq) !== -1) out.push({ seriesId: String(data[i][0]), rule: rule, materializedUntil: _normDate(data[i][2]) });
  }
  return out;
}

function _writeSeries(ss, list) {
  var sheet = _getSeriesSheet(ss);
  var old = sheet.getLastRow();
  if (list.length) {
    if (sheet.getMaxRows() < list.length + 1) sheet.insertRowsAfter(sheet.getMaxRows(), list.length + 20);
    sheet.getRange(2, 1, list.length, 3).setNumberFormat('@').setValues(list.map(function(s) {
      return [s.seriesId, JSON.stringify(s.rule), s.materializedUntil];
    }));
  }
  if (old > list.length + 1) sheet.getRange(list.length + 2, 1, old - list.length - 1, 3).clearContent();
}

// Whole events tab as plain records so a save can touch many occurrences with a
// single read and a single write. Date/time columns are normalized to text.
function _loadEventTable(sheet) {
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(String);
  var recs = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i].join('').trim()) continue;
    var rec = {};
    headers.forEach(function(h, c) { rec[h] = data[i][c]; });
    rec.event_id = String(rec.event_id);
    rec.event_date = _normDate(rec.event_date);
    rec.start_time = _normTime(rec.start_time);
    rec.end_time = _normTime(rec.end_time);
    rec.all_day = rec.all_day === true || String(rec.all_day).toUpperCase() === 'TRUE';
    rec.counts_for_novatos = rec.counts_for_novatos === true || String(rec.counts_for_novatos).toUpperCase() === 'TRUE';
    rec.title = String(rec.title || '');
    rec.location = String(rec.location || '');
    rec.description = String(rec.description || '');
    rec.gcal_event_id = String(rec.gcal_event_id || '');
    rec.series_id = String(rec.series_id || '');
    rec.gcal_dirty = String(rec.gcal_dirty || '');
    recs.push(rec);
  }
  return { headers: headers, recs: recs };
}

function _writeEventTable(sheet, tbl) {
  var n = tbl.recs.length, ncols = tbl.headers.length;
  var oldLast = sheet.getLastRow();
  if (sheet.getMaxRows() < n + 2) sheet.insertRowsAfter(sheet.getMaxRows(), n + 52 - sheet.getMaxRows());
  ['event_date', 'start_time', 'end_time'].forEach(function(h) {
    var c = tbl.headers.indexOf(h) + 1;
    if (c) sheet.getRange(2, c, Math.max(n, oldLast - 1, 1), 1).setNumberFormat('@');
  });
  if (n) {
    sheet.getRange(2, 1, n, ncols).setValues(tbl.recs.map(function(rec) {
      return tbl.headers.map(function(h) { return rec[h] === undefined || rec[h] === null ? '' : rec[h]; });
    }));
  }
  if (oldLast > n + 1) sheet.getRange(n + 2, 1, oldLast - n - 1, ncols).clearContent();
}

function _makeEventRec(f, date, seriesId, who, now) {
  return {
    event_id: _newEventId(), title: f.title, event_type: f.type, event_date: date, start_time: f.startTime, end_time: f.endTime,
    all_day: f.allDay, location: f.location, description: f.description, gcal_event_id: '', created_by: who, created_at: now, updated_at: now,
    attendance: f.attendance, counts_for_novatos: f.counts, points: f.points, series_id: seriesId || '', gcal_dirty: 'Y'
  };
}

// Applies the form fields to an existing row. Anything Google Calendar shows marks it
// dirty; flipping all-day retires the old calendar entry (the kind can't be converted).
function _updateEventRec(rec, f, date, now, gcalQueue) {
  var visible = rec.event_date !== date || rec.title !== f.title || rec.start_time !== f.startTime || rec.end_time !== f.endTime ||
    rec.all_day !== f.allDay || rec.location !== f.location || rec.description !== f.description;
  if (rec.gcal_event_id && rec.all_day !== f.allDay) { gcalQueue.push(rec.gcal_event_id); rec.gcal_event_id = ''; }
  rec.title = f.title; rec.event_type = f.type; rec.event_date = date; rec.start_time = f.startTime; rec.end_time = f.endTime;
  rec.all_day = f.allDay; rec.location = f.location; rec.description = f.description;
  rec.attendance = f.attendance; rec.counts_for_novatos = f.counts; rec.points = f.points;
  if (visible) rec.gcal_dirty = 'Y';
  rec.updated_at = now;
}

function _recForCalendar(rec) {
  return { title: rec.title, location: rec.location, description: rec.description, date: rec.event_date, allDay: rec.all_day, startTime: rec.start_time, endTime: rec.end_time };
}

// plan: { eventId: [member types to keep] } ([] removes every entry). Returns how many
// entries were (or, with dryRun, would be) removed.
function _pruneAttendanceBulk(ss, plan, dryRun) {
  var sheet = ss.getSheetByName('event_attendance');
  if (!sheet) return 0;
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  var cm = _buildColMap(data[0]);
  var keep = [data[0]], lost = 0;
  for (var i = 1; i < data.length; i++) {
    var eid = String(data[i][cm['event_id']]);
    var types = Object.prototype.hasOwnProperty.call(plan, eid) ? plan[eid] : null;
    if (types && types.indexOf(String(data[i][cm['member_type']])) === -1) lost++;
    else keep.push(data[i]);
  }
  if (!dryRun && lost) {
    var ncols = data[0].length;
    sheet.getRange(1, 1, keep.length, ncols).setValues(keep);
    sheet.getRange(keep.length + 1, 1, data.length - keep.length, ncols).clearContent();
  }
  return lost;
}

function _hasLinkedCalendar() { return !!String(getConfigValue('events_calendar_id') || '').trim(); }

// Calendar entries of removed occurrences wait in this tab until they are deleted, so
// deleting a long series is never lost if the calendar is slow or briefly unavailable.
function _queueGcalDeletes(ss, ids) {
  ids = ids.filter(Boolean);
  if (!ids.length || !_hasLinkedCalendar()) return;
  var sheet = ss.getSheetByName('event_gcal_deletes');
  if (!sheet) {
    sheet = ss.insertSheet('event_gcal_deletes');
    sheet.appendRow(['gcal_event_id']);
    sheet.setFrozenRows(1);
  }
  var start = sheet.getLastRow() + 1;
  if (sheet.getMaxRows() < start + ids.length) sheet.insertRowsAfter(sheet.getMaxRows(), ids.length + 20);
  sheet.getRange(start, 1, ids.length, 1).setValues(ids.map(function(id) { return [id]; }));
}

// Deletes queued calendar entries until the deadline. Returns { deleted, remaining }.
function _drainGcalDeletes(ss, deadline, alreadyLocked) {
  var sheet = ss.getSheetByName('event_gcal_deletes');
  if (!sheet || sheet.getLastRow() < 2) return { deleted: 0, remaining: 0 };
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().map(function(r) { return String(r[0]); }).filter(Boolean);
  var cal = null;
  try { cal = _getLinkedCalendar(); } catch (e) { logError('_drainGcalDeletes', e); }
  if (!cal) return { deleted: 0, remaining: ids.length };
  var done = {}, deleted = 0;
  for (var i = 0; i < ids.length; i++) {
    if (Date.now() > deadline) break;
    try {
      var g = cal.getEventById(ids[i]);
      if (g) g.deleteEvent();
      done[ids[i]] = true;
      deleted++;
    } catch (e2) { logError('_drainGcalDeletes', e2); }
  }
  if (!deleted) return { deleted: 0, remaining: ids.length };
  var lock = LockService.getScriptLock();
  var got = alreadyLocked || lock.tryLock(15000);
  if (!got) return { deleted: deleted, remaining: ids.length - deleted };
  try {
    var last = sheet.getLastRow();
    var cur = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getValues().map(function(r) { return String(r[0]); }).filter(Boolean) : [];
    var left = cur.filter(function(id) { return !done[id]; });
    if (last > 1) sheet.getRange(2, 1, last - 1, 1).clearContent();
    if (left.length) sheet.getRange(2, 1, left.length, 1).setValues(left.map(function(id) { return [id]; }));
    return { deleted: deleted, remaining: left.length };
  } finally { if (!alreadyLocked) lock.releaseLock(); }
}

// Tops up open-ended series so occurrences always exist a few months ahead.
function _extendSeries(ss, sheet) {
  var series = _readSeries(ss);
  if (!series.length) return;
  var today = _todayStr();
  function limitOf(s) {
    var h = _seriesHorizon(s.rule, today);
    return s.rule.ends === 'date' && s.rule.until < h ? s.rule.until : h;
  }
  var due = series.filter(function(s) { return limitOf(s) > s.materializedUntil; });
  if (!due.length) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var tbl = _loadEventTable(sheet);
    var now = new Date().toISOString(), added = 0;
    due.forEach(function(s) {
      var rows = tbl.recs.filter(function(r) { return r.series_id === s.seriesId; });
      if (!rows.length) return;
      var tmpl = rows.reduce(function(a, b) { return b.event_date > a.event_date ? b : a; });
      var have = {};
      rows.forEach(function(r) { have[r.event_date] = true; });
      var lim = limitOf(s);
      var f = { title: tmpl.title, type: tmpl.event_type, startTime: tmpl.start_time, endTime: tmpl.end_time, allDay: tmpl.all_day, location: tmpl.location,
        description: tmpl.description, attendance: tmpl.attendance, counts: tmpl.counts_for_novatos, points: tmpl.points };
      _expandRule(s.rule, lim).forEach(function(d) {
        if (d <= s.materializedUntil || have[d]) return;
        tbl.recs.push(_makeEventRec(f, d, s.seriesId, 'Auto (repeat)', now));
        added++;
      });
      s.materializedUntil = lim;
    });
    if (added) _writeEventTable(sheet, tbl);
    var live = {};
    tbl.recs.forEach(function(r) { if (r.series_id) live[r.series_id] = true; });
    _writeSeries(ss, series.filter(function(s) { return live[s.seriesId]; }));
  } finally { lock.releaseLock(); }
}

// Creates (eventId blank) or updates an event. payloadJson:
// { eventId, title, type, date, startTime, endTime, allDay, location, description,
//   attendance, countsForNovatos, points,
//   rule: null | { freq, interval, byDay, monthMode, ends, until, count },
//   scope: 'this' | 'following' | 'all' (only used when editing a repeating event),
//   confirmLoss: true once the user accepted losing recorded attendance }
function saveEvent(payloadJson, performedBy) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var p = JSON.parse(payloadJson);
    var who = performedBy || 'Officer';
    var title = String(p.title || '').trim();
    var date = String(p.date || '').trim();
    var allDay = !!p.allDay;
    var startTime = allDay ? '' : _normTime(p.startTime);
    var endTime = allDay ? '' : _normTime(p.endTime);
    var type = String(p.type || '').trim() || _getEventTypes()[0];
    if (!title) return JSON.stringify({ success: false, error: 'Event title is required.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return JSON.stringify({ success: false, error: 'Date is required.' });
    if (!allDay) {
      if (!startTime) return JSON.stringify({ success: false, error: 'Start time is required (or mark the event all day).' });
      if (!endTime) endTime = _addOneHour(startTime);
      if (endTime <= startTime) return JSON.stringify({ success: false, error: 'End time must be after the start time.' });
    }
    var mode = String(p.attendance || 'none').toLowerCase();
    if (EVENT_ATTENDANCE_MODES.indexOf(mode) === -1) mode = 'none';
    var points = p.points === '' || p.points === undefined || p.points === null ? 1 : Number(p.points);
    if (isNaN(points) || points < 0) return JSON.stringify({ success: false, error: 'Points must be a non-negative number.' });
    var rawRule = p.rule && p.rule.freq ? p.rule : null;
    if (rawRule && rawRule.ends === 'date' && !(/^\d{4}-\d{2}-\d{2}$/.test(String(rawRule.until || '')) && rawRule.until >= date)) {
      return JSON.stringify({ success: false, error: 'Pick a repeat end date that is on or after the event date.' });
    }
    var f = {
      title: title, type: type, startTime: startTime, endTime: endTime, allDay: allDay,
      location: String(p.location || '').trim(), description: String(p.description || '').trim(),
      attendance: mode, counts: (mode === 'novatos' || mode === 'everyone') && !!p.countsForNovatos, points: points
    };

    locked = lock.tryLock(20000);
    if (!locked) return JSON.stringify({ success: false, error: 'The events sheet is busy right now. Try again in a few seconds.' });

    var ss = getSpreadsheet();
    var sheet = _getEventsSheet(ss);
    var tbl = _loadEventTable(sheet);
    var recs = tbl.recs;
    var seriesList = _readSeries(ss);
    var now = new Date().toISOString();
    var today = _todayStr();
    var audience = _audienceTypes(mode);
    var gcalQueue = [], attPlan = {}, removed = {};
    var cur = null, msg = '';

    function removeRec(r) {
      removed[r.event_id] = true;
      attPlan[r.event_id] = [];
      if (r.gcal_event_id) gcalQueue.push(r.gcal_event_id);
    }
    function findSeries(id) { return seriesList.filter(function(s) { return s.seriesId === id; })[0]; }
    function truncateSeries(s, beforeDate) { s.rule.ends = 'date'; s.rule.until = _dAdd(beforeDate, -1); delete s.rule.count; }

    // Lays `rule` over the given existing occurrences (their dates shifted by delta),
    // reusing rows so ids, attendance and calendar entries survive; extra dates become
    // new rows and rows with no matching date are removed. Returns { horizon, count }.
    function layoutSeries(rule, seriesId, rows, delta, minHorizon) {
      var horizon = _seriesHorizon(rule, today);
      if (minHorizon && minHorizon > horizon) horizon = minHorizon;
      var dates = _expandRule(rule, horizon);
      if (dates.indexOf(date) === -1) { dates.push(date); dates.sort(); }
      if (dates.length > EVENT_MAX_SERIES_LEN) throw new Error('That repeat pattern would create ' + dates.length + ' events. Shorten it or set an end date.');
      var byDate = {};
      rows.forEach(function(r) { byDate[_dAdd(r.event_date, delta)] = r; });
      dates.forEach(function(d) {
        var r = byDate[d];
        if (r) {
          delete byDate[d];
          _updateEventRec(r, f, d, now, gcalQueue);
          r.series_id = seriesId;
          attPlan[r.event_id] = audience;
        } else {
          recs.push(_makeEventRec(f, d, seriesId, who, now));
        }
      });
      Object.keys(byDate).forEach(function(k) { removeRec(byDate[k]); });
      return { horizon: horizon, count: dates.length };
    }

    if (p.eventId) {
      cur = recs.filter(function(r) { return r.event_id === String(p.eventId); })[0];
      if (!cur) return JSON.stringify({ success: false, error: 'Event not found.' });
    }

    if (!cur) {
      cur = _makeEventRec(f, date, '', who, now);
      recs.push(cur);
      var rule = rawRule ? _normalizeRule(rawRule, date) : null;
      if (rule) {
        var sid = _newSeriesId();
        var L = layoutSeries(rule, sid, [cur], 0);
        seriesList.push({ seriesId: sid, rule: rule, materializedUntil: L.horizon });
        msg = 'Repeating event added (' + L.count + ' events scheduled).';
      } else msg = 'Event added.';
    } else if (!cur.series_id) {
      var rule0 = rawRule ? _normalizeRule(rawRule, date) : null;
      _updateEventRec(cur, f, date, now, gcalQueue);
      attPlan[cur.event_id] = audience;
      if (rule0) {
        var sid0 = _newSeriesId();
        var L0 = layoutSeries(rule0, sid0, [cur], 0);
        seriesList.push({ seriesId: sid0, rule: rule0, materializedUntil: L0.horizon });
        msg = 'Event updated and set to repeat (' + L0.count + ' events scheduled).';
      } else msg = 'Event updated.';
    } else {
      var oldDate = cur.event_date;
      var seriesRows = recs.filter(function(r) { return r.series_id === cur.series_id; });
      var scope = p.scope === 'following' || p.scope === 'all' ? p.scope : 'this';
      if (scope === 'following' && !seriesRows.some(function(r) { return r.event_date < oldDate; })) scope = 'all';
      var sr = findSeries(cur.series_id);
      if (scope === 'this') {
        _updateEventRec(cur, f, date, now, gcalQueue);
        attPlan[cur.event_id] = audience;
        msg = 'Event updated.';
      } else {
        var affected = scope === 'all' ? seriesRows : seriesRows.filter(function(r) { return r.event_date >= oldDate; });
        var delta = _dDiff(oldDate, date);
        if (!rawRule) {
          var dropped = 0;
          affected.forEach(function(r) { if (r !== cur) { removeRec(r); dropped++; } });
          _updateEventRec(cur, f, date, now, gcalQueue);
          attPlan[cur.event_id] = audience;
          var oldSeriesId = cur.series_id;
          cur.series_id = '';
          if (sr) {
            if (scope === 'all') seriesList = seriesList.filter(function(s) { return s.seriesId !== oldSeriesId; });
            else truncateSeries(sr, oldDate);
          }
          msg = dropped ? 'Event updated. It no longer repeats (' + dropped + ' other event' + (dropped === 1 ? '' : 's') + ' removed).' : 'Event updated.';
        } else {
          var dates = affected.map(function(r) { return r.event_date; }).sort();
          var anchor = _dAdd(dates[0], delta);
          var rule2 = _normalizeRule(rawRule, anchor);
          if (scope === 'following' && rule2.ends === 'count') rule2.count = Math.max(1, rule2.count - (seriesRows.length - affected.length));
          var minH = _dAdd(dates[dates.length - 1], delta);
          if (scope === 'all') {
            var L2 = layoutSeries(rule2, cur.series_id, affected, delta, minH);
            if (sr) { sr.rule = rule2; sr.materializedUntil = L2.horizon; }
            else seriesList.push({ seriesId: cur.series_id, rule: rule2, materializedUntil: L2.horizon });
            msg = 'All events in the series updated (' + L2.count + ' scheduled).';
          } else {
            var sid2 = _newSeriesId();
            var L3 = layoutSeries(rule2, sid2, affected, delta, minH);
            if (sr) truncateSeries(sr, oldDate);
            seriesList.push({ seriesId: sid2, rule: rule2, materializedUntil: L3.horizon });
            msg = 'This and the following events updated (' + L3.count + ' scheduled).';
          }
        }
      }
    }

    // Narrowing the audience (or removing occurrences) drops recorded attendance: ask first.
    var lost = _pruneAttendanceBulk(ss, attPlan, true);
    if (lost > 0 && !p.confirmLoss) {
      return JSON.stringify({ success: false, needsConfirm: true, lost: lost });
    }

    tbl.recs = recs.filter(function(r) { return !removed[r.event_id]; });
    _writeEventTable(sheet, tbl);
    var liveSeries = {};
    tbl.recs.forEach(function(r) { if (r.series_id) liveSeries[r.series_id] = true; });
    _writeSeries(ss, seriesList.filter(function(s) { return liveSeries[s.seriesId]; }));
    if (lost) _pruneAttendanceBulk(ss, attPlan, false);
    _queueGcalDeletes(ss, gcalQueue);

    var cm = _buildColMap(tbl.headers);
    var rowNum = tbl.recs.indexOf(cur) + 2;
    var savedDate = _normDate(sheet.getRange(rowNum, cm['event_date'] + 1).getValue());
    if (savedDate !== date) {
      logError('saveEvent', 'date mismatch after save: wrote ' + date + ', read ' + savedDate);
      return JSON.stringify({ success: false, error: 'The date did not save correctly (wrote ' + date + ', sheet has ' + savedDate + '). Nothing was synced to Google Calendar.' });
    }

    var sync = { skipped: true };
    if (_hasLinkedCalendar()) {
      var oldGcalId = cur.gcal_event_id;
      sync = _syncEventToCalendar(_recForCalendar(cur), oldGcalId, cur.all_day);
      if (sync.ok) {
        sheet.getRange(rowNum, cm['gcal_event_id'] + 1).setValue(sync.gcalId);
        sheet.getRange(rowNum, cm['gcal_dirty'] + 1).setValue('');
        cur.gcal_event_id = sync.gcalId;
        cur.gcal_dirty = '';
      }
    }
    var drained = _drainGcalDeletes(ss, Date.now() + 6000, true);
    var pending = drained.remaining;
    tbl.recs.forEach(function(r) { if (_eventNeedsSync(r)) pending++; });
    _logAudit('saveEvent', cur.event_id, title, who, msg + ' (' + type + ', ' + date + ')' + (sync.error ? ' [calendar sync failed]' : ''));

    if (sync.ok && _hasLinkedCalendar()) msg += ' Synced to Google Calendar.';
    return JSON.stringify({ success: true, eventId: cur.event_id, message: msg, calendarSkipped: !!sync.skipped, calendarError: sync.error || '', pendingSync: _hasLinkedCalendar() ? pending : 0 });
  } catch (err) { logError('saveEvent', err); return JSON.stringify({ success: false, error: err.toString() }); }
  finally { if (locked) { try { lock.releaseLock(); } catch (_) {} } }
}

// scope: 'this' | 'following' | 'all' (repeating events only).
function deleteEvent(eventId, performedBy, scope, confirmLoss) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('events');
    if (!sheet) return JSON.stringify({ success: false, error: 'events tab not found.' });
    locked = lock.tryLock(20000);
    if (!locked) return JSON.stringify({ success: false, error: 'The events sheet is busy right now. Try again in a few seconds.' });
    var tbl = _loadEventTable(sheet);
    var cur = tbl.recs.filter(function(r) { return r.event_id === String(eventId); })[0];
    if (!cur) return JSON.stringify({ success: false, error: 'Event not found.' });

    var seriesList = _readSeries(ss);
    var doomed = [cur];
    if (cur.series_id && (scope === 'all' || scope === 'following')) {
      var rows = tbl.recs.filter(function(r) { return r.series_id === cur.series_id; });
      var hasEarlier = rows.some(function(r) { return r.event_date < cur.event_date; });
      doomed = scope === 'all' || !hasEarlier ? rows : rows.filter(function(r) { return r.event_date >= cur.event_date; });
      if (hasEarlier && scope === 'following') {
        var sr = seriesList.filter(function(s) { return s.seriesId === cur.series_id; })[0];
        if (sr) { sr.rule.ends = 'date'; sr.rule.until = _dAdd(cur.event_date, -1); delete sr.rule.count; }
      }
    }
    var plan = {}, gcalIds = [], gone = {};
    doomed.forEach(function(r) { plan[r.event_id] = []; gone[r.event_id] = true; if (r.gcal_event_id) gcalIds.push(r.gcal_event_id); });
    var lost = _pruneAttendanceBulk(ss, plan, true);
    if (lost > 0 && !confirmLoss) return JSON.stringify({ success: false, needsConfirm: true, lost: lost });

    tbl.recs = tbl.recs.filter(function(r) { return !gone[r.event_id]; });
    _writeEventTable(sheet, tbl);
    var live = {};
    tbl.recs.forEach(function(r) { if (r.series_id) live[r.series_id] = true; });
    _writeSeries(ss, seriesList.filter(function(s) { return live[s.seriesId]; }));
    if (lost) _pruneAttendanceBulk(ss, plan, false);
    _queueGcalDeletes(ss, gcalIds);
    var drained = _drainGcalDeletes(ss, Date.now() + 8000, true);
    var pending = drained.remaining;
    tbl.recs.forEach(function(r) { if (_eventNeedsSync(r)) pending++; });
    _logAudit('deleteEvent', eventId, cur.title, performedBy || 'Officer', 'deleted ' + doomed.length + ' event(s)' + (drained.remaining ? ' [calendar delete pending]' : ''));
    return JSON.stringify({
      success: true, message: doomed.length > 1 ? doomed.length + ' events deleted.' : 'Event deleted.',
      pendingSync: _hasLinkedCalendar() ? pending : 0, calendarError: ''
    });
  } catch (err) { logError('deleteEvent', err); return JSON.stringify({ success: false, error: err.toString() }); }
  finally { if (locked) { try { lock.releaseLock(); } catch (_) {} } }
}

// ---- Attendance ------------------------------------------------

function _findEvent(ss, eventId) {
  var sheet = ss.getSheetByName('events');
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  if (!data.length) return null;
  var cm = _buildColMap(data[0]);
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][cm['event_id']]) === String(eventId)) return _eventFromRow(data[i], cm);
  }
  return null;
}

// Who can be marked for an event: active brothers and/or novatos (associate or
// inactive, same as AM Events), limited to the event's audience.
function _eventRoster(mode) {
  var types = _audienceTypes(mode);
  var roster = [];
  if (types.indexOf('brother') !== -1) {
    _getMembersStructured().forEach(function(m) {
      if (m.status.toLowerCase() === 'active') roster.push({ memberId: m.memberId, name: m.name, type: 'brother' });
    });
  }
  if (types.indexOf('novato') !== -1) {
    _getMembersStructured('AMs').forEach(function(m) {
      var st = m.status.toLowerCase();
      if (st === 'associate' || st === 'inactive') roster.push({ memberId: m.memberId, name: m.name, type: 'novato', inactive: st === 'inactive' });
    });
  }
  roster.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return roster;
}

// Roster for the roll-call modal plus the saved attendee keys ('type:memberId').
// Attendees who have since left the roster (alumni, dissociated, status change)
// are appended as `former` so they stay visible and are not silently dropped on save.
function getEventAttendanceData(eventId) {
  try {
    var ss = getSpreadsheet();
    var ev = _findEvent(ss, eventId);
    if (!ev) return JSON.stringify({ success: false, error: 'Event not found.' });
    if (ev.attendance === 'none') return JSON.stringify({ success: false, error: 'This event has no attendance requirement.' });
    var roster = _eventRoster(ev.attendance);
    var attendees = (_readEventAttendance(ss)[eventId] || []);
    var inRoster = {};
    roster.forEach(function(m) { inRoster[m.type + ':' + m.memberId] = true; });
    attendees.forEach(function(a) {
      if (!inRoster[a.type + ':' + a.memberId]) roster.push({ memberId: a.memberId, name: a.name || a.memberId, type: a.type, former: true });
    });
    return JSON.stringify({
      success: true,
      event: { eventId: ev.eventId, title: ev.title, date: ev.date, attendance: ev.attendance, countsForNovatos: ev.countsForNovatos },
      roster: roster,
      attendees: attendees.map(function(a) { return a.type + ':' + a.memberId; })
    });
  } catch (err) { logError('getEventAttendanceData', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Replaces the full attendee list for one event. attendeesJson: [{ memberId, type }].
// Each row snapshots the member's name so the record stays readable if they leave the roster.
function saveEventAttendance(eventId, attendeesJson, performedBy) {
  try {
    var ss = getSpreadsheet();
    var ev = _findEvent(ss, eventId);
    if (!ev) return JSON.stringify({ success: false, error: 'Event not found.' });
    var allowed = _audienceTypes(ev.attendance);
    if (!allowed.length) return JSON.stringify({ success: false, error: 'This event has no attendance requirement.' });

    var names = {};
    _getMembersStructured().forEach(function(m) { names['brother:' + m.memberId] = m.name; });
    _getMembersStructured('AMs').forEach(function(m) { names['novato:' + m.memberId] = m.name; });
    var previous = _readEventAttendance(ss)[eventId] || [];
    previous.forEach(function(a) { if (!names[a.type + ':' + a.memberId]) names[a.type + ':' + a.memberId] = a.name; });

    var who = performedBy || 'Officer';
    var now = new Date().toISOString();
    var seen = {}, rows = [];
    JSON.parse(attendeesJson || '[]').forEach(function(a) {
      var key = a.type + ':' + a.memberId;
      if (allowed.indexOf(a.type) === -1 || seen[key]) return;
      seen[key] = true;
      rows.push([eventId, String(a.memberId), names[key] || '', a.type, who, now]);
    });

    var sheet = _getEventAttendanceSheet(ss);
    _pruneEventAttendance(ss, eventId, []);
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, EVENT_ATTENDANCE_HEADERS.length).setValues(rows);

    _logAudit('saveEventAttendance', eventId, ev.title, who, rows.length + ' attendee(s)');
    return JSON.stringify({ success: true, message: 'Attendance saved: ' + rows.length + ' present.' });
  } catch (err) { logError('saveEventAttendance', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Events flagged "counts toward novato attendance", shaped like the AM Events
// entries so the AM Manager's Att.% can sum them with the category events.
function _getNovatoCountedEvents() {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('events');
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    var cm = _buildColMap(data[0]);
    var attByEvent = _readEventAttendance(ss);
    var out = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i].join('').trim()) continue;
      var ev = _eventFromRow(data[i], cm);
      if (!ev.countsForNovatos || (ev.attendance !== 'novatos' && ev.attendance !== 'everyone')) continue;
      out.push({
        eventId: ev.eventId, title: ev.title, date: ev.date, points: ev.points, active: true,
        attendees: (attByEvent[ev.eventId] || []).filter(function(a) { return a.type === 'novato'; }).map(function(a) { return a.memberId; })
      });
    }
    return out;
  } catch (err) { logError('_getNovatoCountedEvents', err); return []; }
}

// ---- Google Calendar -------------------------------------------

function _getLinkedCalendar() {
  var calId = String(getConfigValue('events_calendar_id') || '').trim();
  if (!calId) return null;
  return CalendarApp.getCalendarById(calId);
}

// Mirrors one event into the linked calendar, updating in place when we
// already hold its gcal id. Returns { ok, skipped, gcalId, error }.
function _syncEventToCalendar(ev, oldGcalId, oldAllDay) {
  try {
    if (!String(getConfigValue('events_calendar_id') || '').trim()) return { skipped: true };
    var cal = _getLinkedCalendar();
    if (!cal) return { error: 'The linked Google Calendar was not found or this account has no access to it.' };

    var tz = _getTimezone();
    var opts = { location: ev.location, description: ev.description };
    var existing = null;
    if (oldGcalId) { try { existing = cal.getEventById(oldGcalId); } catch (_) {} }
    if (existing && oldAllDay !== ev.allDay) { existing.deleteEvent(); existing = null; }

    var start, end;
    if (ev.allDay) {
      start = Utilities.parseDate(ev.date, tz, 'yyyy-MM-dd');
    } else {
      start = Utilities.parseDate(ev.date + ' ' + ev.startTime, tz, 'yyyy-MM-dd HH:mm');
      end = Utilities.parseDate(ev.date + ' ' + ev.endTime, tz, 'yyyy-MM-dd HH:mm');
    }

    if (existing) {
      existing.setTitle(ev.title);
      existing.setLocation(ev.location);
      existing.setDescription(ev.description);
      if (ev.allDay) existing.setAllDayDate(start); else existing.setTime(start, end);
      return { ok: true, gcalId: existing.getId() };
    }
    var created = ev.allDay ? cal.createAllDayEvent(ev.title, start, opts) : cal.createEvent(ev.title, start, end, opts);
    return { ok: true, gcalId: created.getId() };
  } catch (err) {
    logError('_syncEventToCalendar', err);
    return { error: err.toString() };
  }
}


// Pushes events that still need it (no calendar entry yet, or edited since the last
// push) and deletes queued calendar entries, for at most EVENT_SYNC_BUDGET_MS per call.
// The dashboard calls this repeatedly until `remaining` reaches 0, so long series of
// events sync without hitting the Apps Script time limit.
function syncPendingEvents(performedBy) {
  try {
    if (!_hasLinkedCalendar()) return JSON.stringify({ success: false, error: 'Link a Google Calendar first.' });
    var ss = getSpreadsheet();
    var deadline = Date.now() + EVENT_SYNC_BUDGET_MS;
    var del = _drainGcalDeletes(ss, deadline, false);
    var sheet = ss.getSheetByName('events');
    if (!sheet) return JSON.stringify({ success: true, synced: 0, failed: 0, deleted: del.deleted, remaining: del.remaining, message: 'No events to sync.' });
    var tbl = _loadEventTable(sheet);
    var today = _todayStr();
    var todo = tbl.recs.filter(_eventNeedsSync).sort(function(a, b) {
      return ((a.event_date < today) - (b.event_date < today)) || a.event_date.localeCompare(b.event_date);
    });
    var results = [], failed = 0, lastError = '';
    for (var i = 0; i < todo.length; i++) {
      if (Date.now() > deadline) break;
      var r = todo[i];
      var res = _syncEventToCalendar(_recForCalendar(r), r.gcal_event_id, r.all_day);
      if (res.ok) results.push({ id: r.event_id, gcalId: res.gcalId, version: String(r.updated_at) });
      else { failed++; lastError = res.error || lastError; }
    }
    if (results.length) _applySyncResults(ss, sheet, results);
    var remaining = todo.length - results.length + del.remaining;
    if (results.length || del.deleted || failed) _logAudit('syncPendingEvents', '', '', performedBy || 'Officer', results.length + ' synced, ' + failed + ' failed, ' + del.deleted + ' removed');
    return JSON.stringify({ success: true, synced: results.length, failed: failed, deleted: del.deleted, remaining: remaining, error: lastError,
      message: results.length + ' event(s) synced' + (del.deleted ? ', ' + del.deleted + ' removed' : '') + (failed ? ', ' + failed + ' failed' : '') + '.' });
  } catch (err) { logError('syncPendingEvents', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Stores the calendar ids from a sync run. Re-reads the sheet under the lock and only
// clears the dirty flag when the row has not been edited since it was read.
function _applySyncResults(ss, sheet, results) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The events sheet is busy, sync will retry.');
  try {
    var data = sheet.getDataRange().getValues();
    var cm = _buildColMap(data[0]);
    var byId = {};
    results.forEach(function(r) { byId[r.id] = r; });
    var gcalCol = [], dirtyCol = [];
    for (var i = 1; i < data.length; i++) {
      var id = String(data[i][cm['event_id']]);
      var g = data[i][cm['gcal_event_id']], d = data[i][cm['gcal_dirty']];
      if (byId[id]) {
        g = byId[id].gcalId;
        if (String(data[i][cm['updated_at']]) === byId[id].version) d = '';
        byId[id].used = true;
      }
      gcalCol.push([g]);
      dirtyCol.push([d]);
    }
    if (gcalCol.length) {
      sheet.getRange(2, cm['gcal_event_id'] + 1, gcalCol.length, 1).setValues(gcalCol);
      sheet.getRange(2, cm['gcal_dirty'] + 1, dirtyCol.length, 1).setValues(dirtyCol);
    }
    var orphans = results.filter(function(r) { return !r.used; }).map(function(r) { return r.gcalId; });
    _queueGcalDeletes(ss, orphans);
  } finally { lock.releaseLock(); }
}


// Lists the calendars this account can see, for the picker in the
// dashboard, plus the currently linked id.
function getEventCalendars() {
  try {
    var cals = CalendarApp.getAllCalendars().map(function(c) {
      return { id: c.getId(), name: c.getName(), owned: c.isOwnedByMe() };
    });
    cals.sort(function(a, b) { return (b.owned - a.owned) || a.name.localeCompare(b.name); });
    return JSON.stringify({ success: true, calendars: cals, currentId: String(getConfigValue('events_calendar_id') || '').trim() });
  } catch (err) { logError('getEventCalendars', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function setEventsCalendar(calendarId, performedBy) {
  try {
    calendarId = String(calendarId || '').trim();
    if (!calendarId) {
      setConfigValue('events_calendar_id', '');
      _logAudit('setEventsCalendar', '', '', performedBy || 'Officer', 'unlinked');
      return JSON.stringify({ success: true, name: '', message: 'Google Calendar unlinked. Events stay in the sheet only.' });
    }
    var cal = CalendarApp.getCalendarById(calendarId);
    if (!cal) return JSON.stringify({ success: false, error: 'Calendar not found or no access.' });
    setConfigValue('events_calendar_id', calendarId);
    _logAudit('setEventsCalendar', '', cal.getName(), performedBy || 'Officer', 'linked');
    return JSON.stringify({ success: true, name: cal.getName(), message: 'Linked to "' + cal.getName() + '".' });
  } catch (err) { logError('setEventsCalendar', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function createEventsCalendar(name, performedBy) {
  try {
    name = String(name || '').trim() || (getChapterConfig().chapter.chapter_name + ' Events');
    var cal = CalendarApp.createCalendar(name);
    setConfigValue('events_calendar_id', cal.getId());
    _logAudit('createEventsCalendar', '', name, performedBy || 'Officer', 'created and linked');
    return JSON.stringify({ success: true, id: cal.getId(), name: name, message: 'Created and linked "' + name + '".' });
  } catch (err) { logError('createEventsCalendar', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Web app executions cannot show Google's consent screen, so chapters that
// installed before the calendar scope existed authorize it once from the
// sheet menu (Fraternity System > Setup: Authorize Google Calendar).
// Fresh installs get it in the first-run consent prompt.
function authorizeCalendar() {
  return CalendarApp.getAllCalendars().length + ' calendar(s) visible. Google Calendar access is authorized.';
}

function authorizeCalendarFromMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    ui.alert('Google Calendar', authorizeCalendar() + '\n\nYou can now go to the Events tab of the dashboard and pick your calendar.', ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Google Calendar', 'Authorization failed: ' + err + '\n\nRun this menu item again and tick ALL the permission checkboxes, including Google Calendar.', ui.ButtonSet.OK);
  }
}

