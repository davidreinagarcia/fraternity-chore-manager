// ============================================================
// Events.gs — chapter-wide events with automatic Google Calendar sync.
// Sheet tab `events` is the source of truth; every save/delete mirrors
// to the Google Calendar picked in config key `events_calendar_id`
// (chosen from the dashboard: Events > Google Calendar). If the calendar
// call fails the sheet write still stands and the row is left unsynced
// (blank gcal_event_id) so "Sync pending" can retry it later.
// Separate from AM Events (AMEvents.gs), which stays as its own point system.
// ============================================================

var EVENT_HEADERS = ['event_id', 'title', 'event_type', 'event_date', 'start_time', 'end_time', 'all_day', 'location', 'description', 'gcal_event_id', 'created_by', 'created_at', 'updated_at'];
var EVENT_TYPES_DEFAULT = 'Chapter,Social,Brotherhood,Philanthropy,Recruitment,Other';

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
    sheet.getRange(1, 5, sheet.getMaxRows(), 2).setNumberFormat('@');
  }
  return sheet;
}

function _normTime(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, _getTimezone(), 'HH:mm');
  var m = String(v).match(/^(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

function _eventFromRow(r, cm) {
  var allDayRaw = r[cm['all_day']];
  return {
    eventId: String(r[cm['event_id']]),
    title: String(r[cm['title']] || ''),
    type: String(r[cm['event_type']] || ''),
    date: _normDate(r[cm['event_date']]),
    startTime: _normTime(r[cm['start_time']]),
    endTime: _normTime(r[cm['end_time']]),
    allDay: allDayRaw === true || String(allDayRaw).toUpperCase() === 'TRUE',
    location: String(r[cm['location']] || ''),
    description: String(r[cm['description']] || ''),
    gcalEventId: String(r[cm['gcal_event_id']] || '')
  };
}

function _addOneHour(hhmm) {
  var p = hhmm.split(':');
  var h = Number(p[0]) + 1;
  return h > 23 ? '23:59' : ('0' + h).slice(-2) + ':' + p[1];
}

function getEventsData() {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('events');
    var data = sheet ? sheet.getDataRange().getValues() : [];
    var cm = data.length ? _buildColMap(data[0]) : {};
    var events = [];
    var pending = 0;
    for (var i = 1; i < data.length; i++) {
      if (!data[i].join('').trim()) continue;
      var ev = _eventFromRow(data[i], cm);
      if (!ev.gcalEventId) pending++;
      events.push(ev);
    }
    events.sort(function(a, b) { return (a.date + (a.startTime || '00:00')).localeCompare(b.date + (b.startTime || '00:00')); });
    var calId = String(getConfigValue('events_calendar_id') || '').trim();
    return JSON.stringify({ success: true, events: events, types: _getEventTypes(), calendarLinked: !!calId, pendingSync: pending });
  } catch (err) { logError('getEventsData', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Creates (eventId blank) or updates an event. payloadJson:
// { eventId, title, type, date, startTime, endTime, allDay, location, description }
function saveEvent(payloadJson, performedBy) {
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

    var ss = getSpreadsheet();
    var sheet = _getEventsSheet(ss);
    var data = sheet.getDataRange().getValues();
    var cm = _buildColMap(data[0]);
    var now = new Date().toISOString();
    var ev = {
      title: title, type: type, date: date, startTime: startTime, endTime: endTime, allDay: allDay,
      location: String(p.location || '').trim(), description: String(p.description || '').trim()
    };

    var rowNum = -1, oldGcalId = '', oldAllDay = false;
    if (p.eventId) {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][cm['event_id']]) === String(p.eventId)) {
          rowNum = i + 1;
          var old = _eventFromRow(data[i], cm);
          oldGcalId = old.gcalEventId;
          oldAllDay = old.allDay;
          break;
        }
      }
      if (rowNum === -1) return JSON.stringify({ success: false, error: 'Event not found.' });
    }

    var eventId = p.eventId || 'EV' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
    var values = {
      event_id: eventId, title: title, event_type: type, event_date: _parseAMEventDate(date),
      start_time: startTime, end_time: endTime, all_day: allDay, location: ev.location,
      description: ev.description, updated_at: now
    };
    if (rowNum === -1) {
      values.created_by = who;
      values.created_at = now;
      values.gcal_event_id = '';
      sheet.appendRow(EVENT_HEADERS.map(function(h) { return values[h] !== undefined ? values[h] : ''; }));
      rowNum = sheet.getLastRow();
    } else {
      Object.keys(values).forEach(function(k) {
        if (cm[k] !== undefined) sheet.getRange(rowNum, cm[k] + 1).setValue(values[k]);
      });
    }

    var sync = _syncEventToCalendar(ev, oldGcalId, oldAllDay);
    if (sync.gcalId !== undefined && sync.gcalId !== oldGcalId) {
      sheet.getRange(rowNum, cm['gcal_event_id'] + 1).setValue(sync.gcalId);
    }
    _logAudit('saveEvent', eventId, title, who, (p.eventId ? 'updated' : 'created') + ' (' + type + ', ' + date + ')' + (sync.error ? ' [calendar sync failed]' : ''));

    var msg = p.eventId ? 'Event updated.' : 'Event added.';
    if (sync.ok) msg += ' Synced to Google Calendar.';
    return JSON.stringify({ success: true, eventId: eventId, message: msg, calendarSkipped: !!sync.skipped, calendarError: sync.error || '' });
  } catch (err) { logError('saveEvent', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function deleteEvent(eventId, performedBy) {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('events');
    if (!sheet) return JSON.stringify({ success: false, error: 'events tab not found.' });
    var data = sheet.getDataRange().getValues();
    var cm = _buildColMap(data[0]);
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][cm['event_id']]) !== String(eventId)) continue;
      var ev = _eventFromRow(data[i], cm);
      var calendarError = '';
      if (ev.gcalEventId) {
        try {
          var cal = _getLinkedCalendar();
          var gev = cal ? cal.getEventById(ev.gcalEventId) : null;
          if (gev) gev.deleteEvent();
        } catch (e) { calendarError = e.toString(); logError('deleteEvent.calendar', e); }
      }
      sheet.deleteRow(i + 1);
      _logAudit('deleteEvent', eventId, ev.title, performedBy || 'Officer', 'deleted' + (calendarError ? ' [calendar delete failed]' : ''));
      return JSON.stringify({ success: true, message: 'Event deleted.', calendarError: calendarError });
    }
    return JSON.stringify({ success: false, error: 'Event not found.' });
  } catch (err) { logError('deleteEvent', err); return JSON.stringify({ success: false, error: err.toString() }); }
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

// Pushes every event that has no gcal id yet (saved before a calendar was
// linked, or whose sync failed). Never touches already-synced events, so
// manual edits made in Google Calendar are not overwritten.
function syncPendingEvents(performedBy) {
  try {
    if (!String(getConfigValue('events_calendar_id') || '').trim()) {
      return JSON.stringify({ success: false, error: 'Link a Google Calendar first.' });
    }
    var sheet = getSpreadsheet().getSheetByName('events');
    if (!sheet) return JSON.stringify({ success: true, synced: 0, failed: 0, message: 'No events to sync.' });
    var data = sheet.getDataRange().getValues();
    var cm = _buildColMap(data[0]);
    var synced = 0, failed = 0, lastError = '';
    for (var i = 1; i < data.length; i++) {
      if (!data[i].join('').trim()) continue;
      var ev = _eventFromRow(data[i], cm);
      if (ev.gcalEventId) continue;
      var res = _syncEventToCalendar(ev, '', ev.allDay);
      if (res.ok) { sheet.getRange(i + 1, cm['gcal_event_id'] + 1).setValue(res.gcalId); synced++; }
      else { failed++; lastError = res.error || lastError; }
    }
    _logAudit('syncPendingEvents', '', '', performedBy || 'Officer', synced + ' synced, ' + failed + ' failed');
    return JSON.stringify({ success: true, synced: synced, failed: failed, error: lastError,
      message: synced + ' event(s) synced' + (failed ? ', ' + failed + ' failed' : '') + '.' });
  } catch (err) { logError('syncPendingEvents', err); return JSON.stringify({ success: false, error: err.toString() }); }
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
