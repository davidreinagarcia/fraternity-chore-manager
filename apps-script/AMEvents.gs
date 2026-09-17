// ============================================================
// AMEvents.gs — AM point system migrated from the "AM Points Fall 2026"
// Sheet: officers log category events (Kappa, Beta, Rho, Epsilon, Theta,
// Phi, Semi, Misc — see the Kappa Master Doc) on a calendar and mark which
// AMs attended. Each AM's event percentage (earned / total available
// points among active events) is what the 80%-for-initiation threshold
// checks against. Separate from signature points (Signatures.gs) and
// manual bonus points (adjustAMPoints in Code.gs) — both of those still
// add onto the AMs sheet 'points' column independently, e.g. for the
// quiz average or one-off bonuses like the old sheet's "Kahoot top 3".
// ============================================================

var AM_EVENT_HEADERS = ['event_id', 'category', 'title', 'event_date', 'points', 'active', 'created_at'];
var AM_ATTENDANCE_HEADERS = ['event_id', 'member_id', 'marked_by', 'marked_at'];

var AM_EVENT_CATEGORIES = ['Kappa', 'Beta', 'Rho', 'Epsilon', 'Theta', 'Phi', 'Semi', 'Misc'];

// Every event (any semester — nobody purges old ones, officers just stop
// adding new ones) with its attendee list, for the AM Manager's calendar
// tab and its Att.% column.
function getAMPointsData() {
  try {
    var ss = getSpreadsheet();
    var evSheet = ss.getSheetByName('am_events');
    var atSheet = ss.getSheetByName('am_attendance');
    var evData = evSheet ? evSheet.getDataRange().getValues() : [];
    var atData = atSheet ? atSheet.getDataRange().getValues() : [];
    var evCM = evData.length ? _buildColMap(evData[0]) : {};
    var atCM = atData.length ? _buildColMap(atData[0]) : {};

    var attendeesByEvent = {};
    for (var i = 1; i < atData.length; i++) {
      var eid = String(atData[i][atCM['event_id']]);
      if (!attendeesByEvent[eid]) attendeesByEvent[eid] = [];
      attendeesByEvent[eid].push(String(atData[i][atCM['member_id']]));
    }

    var events = [];
    for (var j = 1; j < evData.length; j++) {
      var r = evData[j];
      if (!r.join('').trim()) continue;
      var eventId = String(r[evCM['event_id']]);
      var activeRaw = r[evCM['active']];
      events.push({
        eventId: eventId,
        category: String(r[evCM['category']] || ''),
        title: String(r[evCM['title']] || ''),
        date: _normDate(r[evCM['event_date']]),
        points: Number(r[evCM['points']]) || 0,
        active: activeRaw !== false && String(activeRaw).toUpperCase() !== 'FALSE',
        attendees: attendeesByEvent[eventId] || []
      });
    }
    events.sort(function(a, b) { return a.date.localeCompare(b.date); });

    return JSON.stringify({ success: true, events: events, categories: AM_EVENT_CATEGORIES });
  } catch (err) { logError('getAMPointsData', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Creates a new event (eventId blank/omitted) or updates an existing one.
function saveAMEvent(eventId, category, title, eventDate, points, active, performedBy) {
  try {
    category = String(category || '').trim();
    title = String(title || '').trim();
    points = Number(points);
    if (!category) return JSON.stringify({ success: false, error: 'Category is required.' });
    if (!title) return JSON.stringify({ success: false, error: 'Event title is required.' });
    if (!eventDate) return JSON.stringify({ success: false, error: 'Date is required.' });
    if (isNaN(points) || points < 0) return JSON.stringify({ success: false, error: 'Points must be a non-negative number.' });

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('am_events');
    if (!sheet) { sheet = ss.insertSheet('am_events'); sheet.appendRow(AM_EVENT_HEADERS); sheet.setFrozenRows(1); }
    var data = sheet.getDataRange().getValues();
    var cm = data.length ? _buildColMap(data[0]) : _buildColMap(AM_EVENT_HEADERS);

    if (eventId) {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][cm['event_id']]) === String(eventId)) {
          sheet.getRange(i + 1, cm['category'] + 1).setValue(category);
          sheet.getRange(i + 1, cm['title'] + 1).setValue(title);
          sheet.getRange(i + 1, cm['event_date'] + 1).setValue(eventDate);
          sheet.getRange(i + 1, cm['points'] + 1).setValue(points);
          sheet.getRange(i + 1, cm['active'] + 1).setValue(!!active);
          _logAudit('saveAMEvent', eventId, title, performedBy || 'Officer', 'updated');
          return JSON.stringify({ success: true, eventId: eventId, message: 'Event updated.' });
        }
      }
      return JSON.stringify({ success: false, error: 'Event not found.' });
    }

    var newId = 'EV' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
    sheet.appendRow([newId, category, title, eventDate, points, true, new Date().toISOString()]);
    _logAudit('saveAMEvent', newId, title, performedBy || 'Officer', 'created (' + category + ', ' + points + ' pts)');
    return JSON.stringify({ success: true, eventId: newId, message: 'Event added.' });
  } catch (err) { logError('saveAMEvent', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Deletes an event and every attendance row logged against it.
function deleteAMEvent(eventId, performedBy) {
  try {
    var ss = getSpreadsheet();
    var evSheet = ss.getSheetByName('am_events');
    if (!evSheet) return JSON.stringify({ success: false, error: 'am_events tab not found.' });
    var data = evSheet.getDataRange().getValues();
    var cm = _buildColMap(data[0]);
    var title = '', found = false;
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][cm['event_id']]) === String(eventId)) {
        title = String(data[i][cm['title']] || '');
        evSheet.deleteRow(i + 1);
        found = true;
        break;
      }
    }
    if (!found) return JSON.stringify({ success: false, error: 'Event not found.' });

    var atSheet = ss.getSheetByName('am_attendance');
    if (atSheet) {
      var atData = atSheet.getDataRange().getValues();
      var atCM = _buildColMap(atData[0]);
      for (var j = atData.length - 1; j >= 1; j--) {
        if (String(atData[j][atCM['event_id']]) === String(eventId)) atSheet.deleteRow(j + 1);
      }
    }
    _logAudit('deleteAMEvent', eventId, title, performedBy || 'Officer', 'deleted');
    return JSON.stringify({ success: true, message: 'Event deleted.' });
  } catch (err) { logError('deleteAMEvent', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Replaces the full attendee list for one event in a single write — the
// attendance modal sends every checked AM at once instead of toggling
// rows one at a time.
function saveAMEventAttendance(eventId, memberIds, performedBy) {
  try {
    var ss = getSpreadsheet();
    var atSheet = ss.getSheetByName('am_attendance');
    if (!atSheet) { atSheet = ss.insertSheet('am_attendance'); atSheet.appendRow(AM_ATTENDANCE_HEADERS); atSheet.setFrozenRows(1); }
    var data = atSheet.getDataRange().getValues();
    var cm = data.length ? _buildColMap(data[0]) : _buildColMap(AM_ATTENDANCE_HEADERS);

    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][cm['event_id']]) === String(eventId)) atSheet.deleteRow(i + 1);
    }

    var now = new Date().toISOString();
    var who = performedBy || 'Officer';
    (memberIds || []).forEach(function(mid) {
      atSheet.appendRow([eventId, mid, who, now]);
    });

    _logAudit('saveAMEventAttendance', eventId, '', who, (memberIds || []).length + ' attendee(s)');
    return JSON.stringify({ success: true, message: 'Attendance saved for ' + (memberIds || []).length + ' AM(s).' });
  } catch (err) { logError('saveAMEventAttendance', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

// Internal helper: strips every attendance row for one AM, across all
// events — called from dissociateMember (Code.gs) so a dissociated AM
// stops counting toward any event's attendee list. Not called for a
// merely-inactive AM (leave of absence, co-op, etc.), since that's
// meant to be temporary and their history should stay intact.
function _removeAMAttendance(ss, memberId) {
  var atSheet = ss.getSheetByName('am_attendance');
  if (!atSheet) return;
  var data = atSheet.getDataRange().getValues();
  if (!data.length) return;
  var cm = _buildColMap(data[0]);
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][cm['member_id']]) === String(memberId)) atSheet.deleteRow(i + 1);
  }
}
