// ============================================================
// EventsTwoWay.gs — brings edits made directly in Google Calendar back into the
// `events` tab (the dashboard -> calendar direction lives in Events.gs).
//
// Stateless reconcile: list the linked calendar, compare every entry with its row
// by content and, where they differ, copy the calendar's version into the row
// (unless the row has a newer dashboard edit still waiting to be pushed, then the
// most recent edit wins). Runs from the dashboard (on load, every minute while the
// Events tab is open, "Sync" button), from a calendar-update trigger and from a
// 5-minute time trigger. Uses the Calendar advanced service (enabled in
// appsscript.json) because it reports deletions explicitly.
//
// Google Calendar does not store the event type or attendance, so those stay in
// the sheet. Entries created in Google arrive as type "Other", no attendance.
// Not supported yet: events spanning several days, and repeating events created
// inside Google Calendar (repeat from the dashboard instead). Both are skipped.
// ============================================================

var EVENT_PULL_PAST_DAYS = 90;
var EVENT_PULL_FUTURE_DAYS = 1100;
var EVENT_PULL_IMPORT_PAST_DAYS = 7;
var EVENT_PULL_IMPORT_CAP = 300;
var EVENT_PULL_VERIFY_BUDGET_MS = 20000;
var EVENT_TAG = 'frat_event_id';
var EVENT_TICK_HANDLER = 'calendarTwoWayTick';
var EVENT_TICK_DEBOUNCE_MS = 20000;

function _gcalApiId(gid) { return String(gid || '').replace(/@google\.com$/, ''); }

function _gcalListAll(calId, minIso, maxIso) {
  var out = [], token = '';
  do {
    var params = { timeMin: minIso, timeMax: maxIso, singleEvents: true, showDeleted: false, maxResults: 2500 };
    if (token) params.pageToken = token;
    var res = Calendar.Events.list(calId, params);
    (res.items || []).forEach(function(it) { out.push(it); });
    token = res.nextPageToken || '';
  } while (token);
  return out;
}

// Google stores edited descriptions as HTML; the sheet keeps plain text.
function _gcalDescToText(d) {
  var s = String(d || '');
  if (/<\/?(br|p|div|b|i|u|em|strong|a|ul|ol|li|span|h[1-6])\b[^>]*>/i.test(s)) {
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  return s.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function _normText(v) { return String(v || '').replace(/\r\n/g, '\n').trim(); }

// Calendar entry -> the row fields it maps to, or null when it has no usable time.
function _gcalItemFields(item, tz) {
  if (!item || !item.start || !item.end) return null;
  var f = { title: String(item.summary || '').trim() || 'Untitled event', location: String(item.location || '').trim(), description: _gcalDescToText(item.description) };
  if (item.start.date) {
    f.allDay = true; f.date = item.start.date; f.startTime = ''; f.endTime = '';
    f.multiDay = _dDiff(item.start.date, item.end.date || item.start.date) > 1;
    return f;
  }
  if (!item.start.dateTime || !item.end.dateTime) return null;
  var s = new Date(item.start.dateTime), e = new Date(item.end.dateTime);
  f.allDay = false;
  f.date = Utilities.formatDate(s, tz, 'yyyy-MM-dd');
  f.startTime = Utilities.formatDate(s, tz, 'HH:mm');
  f.endTime = Utilities.formatDate(e, tz, 'HH:mm');
  f.multiDay = Utilities.formatDate(e, tz, 'yyyy-MM-dd') !== f.date;
  return f;
}

function _sameFields(rec, f) {
  if (_normText(rec.title) !== f.title || rec.event_date !== f.date || !!rec.all_day !== f.allDay) return false;
  if (!f.allDay && (rec.start_time !== f.startTime || rec.end_time !== f.endTime)) return false;
  return _normText(rec.location) === f.location && _normText(rec.description) === f.description;
}

function _pullDefaultType() {
  var types = _getEventTypes();
  return types.indexOf('Other') !== -1 ? 'Other' : types[types.length - 1];
}

function pullCalendarChanges(performedBy) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    if (!_hasLinkedCalendar()) return JSON.stringify({ success: true, skipped: true, changed: 0, message: '', notes: [] });
    if (typeof Calendar === 'undefined') {
      return JSON.stringify({ success: false, error: 'The Google Calendar advanced service is not enabled for this script. Push the latest code (appsscript.json turns it on) and try again.' });
    }
    locked = lock.tryLock(8000);
    if (!locked) return JSON.stringify({ success: true, busy: true, changed: 0, message: '', notes: [] });

    var ss = getSpreadsheet();
    var sheet = _getEventsSheet(ss);
    var calId = String(getConfigValue('events_calendar_id') || '').trim();
    var tz = _getTimezone();
    var today = _todayStr();
    var minDate = _dAdd(today, -EVENT_PULL_PAST_DAYS), maxDate = _dAdd(today, EVENT_PULL_FUTURE_DAYS);
    var items = _gcalListAll(calId, Utilities.parseDate(minDate, tz, 'yyyy-MM-dd').toISOString(), Utilities.parseDate(maxDate, tz, 'yyyy-MM-dd').toISOString());

    var tbl = _loadEventTable(sheet);
    var recs = tbl.recs;
    var byGid = {}, byId = {};
    recs.forEach(function(r) { byId[r.event_id] = r; if (r.gcal_event_id) byGid[_gcalApiId(r.gcal_event_id)] = r; });
    var queued = {};
    var qSheet = ss.getSheetByName('event_gcal_deletes');
    if (qSheet && qSheet.getLastRow() > 1) {
      qSheet.getRange(2, 1, qSheet.getLastRow() - 1, 1).getValues().forEach(function(r) { if (r[0]) queued[_gcalApiId(r[0])] = true; });
    }
    var attByEvent = _readEventAttendance(ss);
    var now = new Date().toISOString();
    var res = { updated: 0, imported: 0, removed: 0, restored: 0, conflicts: 0, linked: 0, skippedMulti: 0, suspicious: 0, importOverflow: 0 };
    var recurringSeen = {};
    var seen = {}, toImport = [];

    function adopt(rec, f) {
      rec.title = f.title; rec.event_date = f.date; rec.start_time = f.startTime; rec.end_time = f.endTime;
      rec.all_day = f.allDay; rec.location = f.location; rec.description = f.description;
      rec.gcal_dirty = ''; rec.updated_at = now;
      res.updated++;
    }
    // Same content: nothing to do. Different: the calendar wins unless the row has an
    // unpushed dashboard edit that is newer than the calendar's last change.
    function reconcile(rec, f, item) {
      if (f.multiDay) { res.skippedMulti++; return; }
      if (_sameFields(rec, f)) return;
      if (rec.gcal_dirty === 'Y') {
        if ((Date.parse(item.updated || '') || 0) <= (Date.parse(rec.updated_at) || 0)) return;
        res.conflicts++;
      }
      adopt(rec, f);
    }

    items.forEach(function(item) {
      if (item.status === 'cancelled') return;
      seen[item.id] = true;
      if (item.eventType && item.eventType !== 'default') return;
      if (item.recurringEventId) { recurringSeen[item.recurringEventId] = true; return; }
      var rec = byGid[item.id];
      var tag = item.extendedProperties && item.extendedProperties.private && item.extendedProperties.private[EVENT_TAG];
      if (!rec && tag && byId[tag] && !byId[tag].gcal_event_id) {
        rec = byId[tag];
        rec.gcal_event_id = item.iCalUID || (item.id + '@google.com');
        byGid[item.id] = rec;
        res.linked++;
      }
      var f = _gcalItemFields(item, tz);
      if (!f) return;
      if (rec) { reconcile(rec, f, item); return; }
      if (tag || queued[item.id]) return;
      if (f.multiDay) { res.skippedMulti++; return; }
      if (f.date < _dAdd(today, -EVENT_PULL_IMPORT_PAST_DAYS)) return;
      toImport.push({ item: item, f: f });
    });

    var linkedInWindow = recs.filter(function(r) { return r.gcal_event_id && r.event_date >= minDate && r.event_date <= maxDate; });
    var missing = linkedInWindow.filter(function(r) { return !seen[_gcalApiId(r.gcal_event_id)]; });
    var gone = [];
    var verifyDeadline = Date.now() + EVENT_PULL_VERIFY_BUDGET_MS;
    for (var i = 0; i < missing.length; i++) {
      if (Date.now() > verifyDeadline) break;
      var rec2 = missing[i], g = null, deleted = false;
      try {
        g = Calendar.Events.get(calId, _gcalApiId(rec2.gcal_event_id));
        if (!g || g.status === 'cancelled') deleted = true;
      } catch (e) {
        if (/404|410|not found|deleted|gone/i.test(String(e))) deleted = true;
        else { logError('pullCalendarChanges', e); continue; }
      }
      if (deleted) { gone.push(rec2); continue; }
      if (g.recurrence || g.recurringEventId) { recurringSeen[g.recurringEventId || g.id] = true; continue; }
      if (g.eventType && g.eventType !== 'default') continue;
      var f2 = _gcalItemFields(g, tz);
      if (f2) reconcile(rec2, f2, g);
    }

    var removeSet = {};
    if (gone.length > 5 && gone.length > linkedInWindow.length * 0.5) {
      res.suspicious = gone.length;
    } else {
      gone.forEach(function(r) {
        if ((attByEvent[r.event_id] || []).length) { r.gcal_event_id = ''; r.gcal_dirty = 'Y'; res.restored++; }
        else { removeSet[r.event_id] = true; res.removed++; }
      });
    }

    var defaultType = _pullDefaultType();
    toImport.slice(0, EVENT_PULL_IMPORT_CAP).forEach(function(x) {
      recs.push({
        event_id: _newEventId(), title: x.f.title, event_type: defaultType, event_date: x.f.date, start_time: x.f.startTime, end_time: x.f.endTime,
        all_day: x.f.allDay, location: x.f.location, description: x.f.description, gcal_event_id: x.item.iCalUID || (x.item.id + '@google.com'),
        created_by: 'Google Calendar', created_at: now, updated_at: now, attendance: 'none', counts_for_novatos: false, points: 1, series_id: '', gcal_dirty: ''
      });
      res.imported++;
    });
    res.importOverflow = Math.max(0, toImport.length - EVENT_PULL_IMPORT_CAP);

    var changed = res.updated + res.imported + res.removed + res.restored;
    if (changed || res.linked) {
      if (res.removed) {
        tbl.recs = recs.filter(function(r) { return !removeSet[r.event_id]; });
        var live = {};
        tbl.recs.forEach(function(r) { if (r.series_id) live[r.series_id] = true; });
        _writeSeries(ss, _readSeries(ss).filter(function(s) { return live[s.seriesId]; }));
      }
      _writeEventTable(sheet, tbl);
    }

    var parts = [];
    if (res.updated) parts.push(res.updated + ' updated');
    if (res.imported) parts.push(res.imported + ' added');
    if (res.removed) parts.push(res.removed + ' removed');
    var message = '';
    if (parts.length) message = 'Updated from Google Calendar: ' + parts.join(', ') + '.';
    if (res.restored) {
      message += (message ? ' ' : '') + res.restored + ' event(s) deleted in Google Calendar were kept (and put back there) because they have attendance records. Delete them here if you really want them gone.';
    }
    var notes = [];
    if (res.skippedMulti) notes.push(res.skippedMulti + ' event(s) spanning several days in Google Calendar were left alone (multi-day events are not supported yet).');
    var nRec = Object.keys(recurringSeen).length;
    if (nRec) notes.push(nRec + ' repeating event(s) created inside Google Calendar were ignored. Create repeating events from the dashboard.');
    if (res.suspicious) notes.push(res.suspicious + ' events vanished from Google Calendar at once, so nothing was removed. If you switched calendars, relink it from the Google Calendar button.');
    if (res.importOverflow) notes.push(res.importOverflow + ' more event(s) from Google Calendar will be added on the next check.');
    if (changed) {
      _logAudit('pullCalendarChanges', '', '', performedBy || 'Google Calendar sync',
        res.updated + ' updated, ' + res.imported + ' added, ' + res.removed + ' removed, ' + res.restored + ' kept, ' + res.conflicts + ' conflicts resolved by most recent edit');
    }
    return JSON.stringify({ success: true, changed: changed, updated: res.updated, imported: res.imported, removed: res.removed, restored: res.restored, conflicts: res.conflicts, message: message, notes: notes });
  } catch (err) {
    logError('pullCalendarChanges', err);
    return JSON.stringify({ success: false, error: err.toString() });
  } finally { if (locked) { try { lock.releaseLock(); } catch (_) {} } }
}

// ---- Triggers ----------------------------------------------------

function _tickTriggers() {
  return ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === EVENT_TICK_HANDLER; });
}

function _removeTwoWayTriggers() {
  _tickTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
}

// A 5-minute time trigger always; plus a calendar-update trigger so changes show up
// within seconds (it can fail for calendars shared with edit-only access, the time
// trigger then covers it). Returns { calendar: bool }.
function _installTwoWayTriggers() {
  _removeTwoWayTriggers();
  ScriptApp.newTrigger(EVENT_TICK_HANDLER).timeBased().everyMinutes(5).create();
  var calendar = false;
  try {
    ScriptApp.newTrigger(EVENT_TICK_HANDLER).forUserCalendar(String(getConfigValue('events_calendar_id') || '').trim()).onEventUpdated().create();
    calendar = true;
  } catch (e) { logError('_installTwoWayTriggers', e); }
  return { calendar: calendar };
}

function _twoWayInfo() {
  var enabled = false;
  try { enabled = _tickTriggers().length > 0; } catch (e) { logError('_twoWayInfo', e); }
  return { enabled: enabled, userOff: String(getConfigValue('events_twoway') || '').toLowerCase() === 'off' };
}

function setCalendarTwoWay(on, performedBy) {
  try {
    if (!_hasLinkedCalendar()) return JSON.stringify({ success: false, error: 'Link a Google Calendar first.' });
    if (on) {
      var st = _installTwoWayTriggers();
      setConfigValue('events_twoway', 'on');
      _logAudit('setCalendarTwoWay', '', '', performedBy || 'Officer', 'on' + (st.calendar ? '' : ' (time trigger only)'));
      return JSON.stringify({ success: true, enabled: true, calendarTrigger: st.calendar, message: 'Two-way sync with Google Calendar is on.' });
    }
    _removeTwoWayTriggers();
    setConfigValue('events_twoway', 'off');
    _logAudit('setCalendarTwoWay', '', '', performedBy || 'Officer', 'off');
    return JSON.stringify({ success: true, enabled: false, message: 'Two-way sync is off. Only changes made here go to Google Calendar.' });
  } catch (err) { logError('setCalendarTwoWay', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Handler for both triggers. Calendar triggers can fire in bursts (our own pushes
// count too), so runs closer than EVENT_TICK_DEBOUNCE_MS apart are skipped.
function calendarTwoWayTick() {
  try {
    if (!_hasLinkedCalendar()) { _removeTwoWayTriggers(); return; }
    var cache = CacheService.getScriptCache();
    var last = Number(cache.get('twoway_last') || 0);
    if (Date.now() - last < EVENT_TICK_DEBOUNCE_MS) return;
    cache.put('twoway_last', String(Date.now()), 600);
    pullCalendarChanges('Google Calendar sync');
    syncPendingEvents('Google Calendar sync');
  } catch (err) { logError('calendarTwoWayTick', err); }
}
