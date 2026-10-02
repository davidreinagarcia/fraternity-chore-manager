// ============================================================
// Seed.gs — Demo data for dev/testing
// ============================================================
// Every demo row has an id containing "DEMO" in its first column, so
// removeDemoData() deletes exactly what loadDemoData() created and never
// touches real rows. Fictional people only (example.com emails, 555 phones).
// Menu: Fraternity System > Admin > Load / Remove demo data.

var DEMO_FIRST = ['Alex','Ben','Carlos','Daniel','Ethan','Felipe','Gabriel','Hugo','Ivan','Jack','Kyle','Liam','Marco','Nate','Oscar','Pablo','Quinn','Ryan','Sam','Tomas','Uri','Victor','Will','Xavier','Yago','Zach','Adrian','Bruno','Cole','Dylan','Eli','Finn','Gus','Hector','Isaac'];
var DEMO_LAST  = ['Alvarez','Brooks','Castro','Dixon','Evans','Fischer','Gomez','Hayes','Ibarra','Jensen','Klein','Lopez','Mendez','Nguyen','Ortega','Patel','Quintero','Rivera','Soto','Torres','Underwood','Vega','Walsh','Xu','Young','Zimmer','Alonso','Bravo','Cruz','Dunn','Ellis','Ford','Grant','Hill','Iglesias'];
var DEMO_MAJORS = ['Industrial Engineering','Computer Science','Mechanical Engineering','Business Administration','Aerospace Engineering','Biomedical Engineering','Electrical Engineering','Economics','Physics','Civil Engineering'];
var DEMO_YEARS = ['Freshman','Sophomore','Junior','Senior'];
var DEMO_CHORES = [
  { name: 'Kitchen',         people: 5 },
  { name: 'Living Room',     people: 4 },
  { name: 'Bathrooms 1st',   people: 4 },
  { name: 'Bathrooms 2nd',   people: 4 },
  { name: 'Trash and Recycling', people: 3 },
  { name: 'Yard and Patio',  people: 4 }
];

function _demoDate(offsetDays) {
  var d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return Utilities.formatDate(d, _getTimezone(), 'yyyy-MM-dd');
}

function _demoIso(offsetDays, hour) {
  var d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour || 12, 0, 0, 0);
  return d.toISOString();
}

// Appends objects to a tab by header name; unknown keys are ignored, missing ones are blank.
function _demoAppend(ss, tab, objs, textCols) {
  if (!objs.length) return;
  var sheet = ss.getSheetByName(tab);
  if (!sheet) throw new Error('Missing tab: ' + tab + ' (run Setup: Create Required Tabs first)');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var rows = objs.map(function(o) {
    return headers.map(function(h) { return o[h] === undefined ? '' : o[h]; });
  });
  var start = sheet.getLastRow() + 1;
  (textCols || []).forEach(function(c) {
    var idx = headers.indexOf(c);
    if (idx !== -1) sheet.getRange(start, idx + 1, rows.length, 1).setNumberFormat('@');
  });
  sheet.getRange(start, 1, rows.length, headers.length).setValues(rows);
}

function _demoPerson(i, status, suffix) {
  var first = DEMO_FIRST[i % DEMO_FIRST.length];
  var last  = DEMO_LAST[i % DEMO_LAST.length];
  var slug  = (first + last).toLowerCase() + (10 + i);
  return {
    first: first, last: last, slug: slug,
    phone: '555-01' + ('0' + (i % 100)).slice(-2) + '-' + (1000 + i * 37),
    email: slug + '@example.com',
    major: DEMO_MAJORS[i % DEMO_MAJORS.length],
    year: DEMO_YEARS[i % DEMO_YEARS.length],
    grad: (i % 4 === 3 ? 'Spring 2027' : i % 4 === 2 ? 'Spring 2028' : i % 4 === 1 ? 'Spring 2029' : 'Spring 2030'),
    sizes: ['S','M','L','XL'][i % 4]
  };
}

function loadDemoData() {
  var ss = getSpreadsheet();
  ensureTabsExist();
  removeDemoData();

  var semester = String(getConfigValue('semester') || '').trim();
  if (!semester) { semester = 'Fall 2026'; setConfigValue('semester', semester); }
  var weekStart = _normDate(getConfigValue('week_start'));
  if (!weekStart) {
    var now = new Date();
    var back = (now.getDay() + 6) % 7; // days since Monday
    weekStart = _demoDate(-back);
    setConfigValue('week_start', weekStart);
  }
  var prevWeek = Utilities.formatDate(new Date(new Date(weekStart + 'T12:00:00').getTime() - 7 * 86400000), _getTimezone(), 'yyyy-MM-dd');

  // ---- Active members (28) --------------------------------------------------
  var roles = { 0: 'President', 1: 'Vice President', 2: 'Treasurer', 3: 'Secretary', 4: 'Risk Manager', 5: 'Recruitment Chair', 6: 'Philanthropy Chair', 7: 'Social Chair', 8: 'High Kappa' };
  var members = [];
  for (var i = 0; i < 28; i++) {
    var p = _demoPerson(i);
    var id = 'MDEMO' + ('0' + (i + 1)).slice(-2);
    var m = {
      member_id: id, 'BK#': String(2100 + i), legal_first: p.first, preferred_name: p.first, legal_last: p.last,
      phone: p.phone, personal_email: p.email, GT_email: p.slug + '@example.com', GT_username: p.slug,
      GTID: String(903100000 + i * 13), hometown: ['Atlanta, GA','Alicante, Spain','Miami, FL','Austin, TX','Madrid, Spain','Chicago, IL','Denver, CO'][i % 7],
      birthday: (2003 - (i % 4)) + '-' + ('0' + (1 + (i * 5) % 12)).slice(-2) + '-' + ('0' + (1 + (i * 7) % 28)).slice(-2),
      dietary_restrictions: i % 9 === 0 ? 'Vegetarian' : '', allergies: i % 11 === 0 ? 'Peanuts' : '',
      emergency_contact_name: 'Parent of ' + p.first, emergency_contact_phone: '555-02' + ('0' + (i % 100)).slice(-2) + '-' + (2000 + i * 11),
      major: p.major, year: p.year, anticipated_graduation: p.grad,
      living_in_house: i % 3 !== 0 ? 'Yes' : 'No', meal_plan: i % 2 === 0 ? 'Yes' : 'No', car_on_campus: i % 3 === 0 ? 'Yes' : 'No',
      shirt_size: p.sizes, campus_orgs: i % 2 === 0 ? 'Student Government, Club Soccer' : 'Robotics Club',
      leadership_positions: i % 4 === 0 ? 'Yes' : 'No', which_positions: i % 4 === 0 ? 'Treasurer of Robotics Club' : '',
      service_orgs: i % 5 === 0 ? 'Habitat for Humanity' : '',
      status: 'active', officer_role: roles[i] || '', pledge_class: ['Alpha','Beta','Gamma','Delta'][i % 4],
      form_completed_this_semester: i % 6 !== 5, added_date: _demoIso(-120, 10), last_updated: _demoIso(-3, 10),
      room_number: i % 3 !== 0 ? String(100 + i) : ''
    };
    if (i === 20) { m.suspension = true; m.suspension_reason = 'Conduct violation (demo)'; m.suspension_end = _demoDate(30); }
    if (i === 21) { m.probation = true; m.probation_type = 'Academic'; m.probation_reason = 'GPA below chapter minimum (demo)'; m.probation_end = _demoDate(60); }
    if (i === 22) { m.academic_suspension = true; }
    if (i === 23) { m.co_op_semester = semester; }
    members.push(m);
  }
  // Two inactive brothers
  [28, 29].forEach(function(k, j) {
    var p = _demoPerson(k);
    members.push({
      member_id: 'MDEMO' + (k + 1), 'BK#': String(2100 + k), legal_first: p.first, preferred_name: p.first, legal_last: p.last,
      phone: p.phone, personal_email: p.email, GT_email: p.email, major: p.major, year: 'Senior', anticipated_graduation: 'Spring 2027',
      status: 'inactive', inactive_reason: j === 0 ? 'Studying abroad' : 'Co-op', pledge_class: 'Alpha', added_date: _demoIso(-400, 10), last_updated: _demoIso(-30, 10)
    });
  });
  _demoAppend(ss, 'members', members, ['birthday', 'suspension_end', 'probation_end']);

  // ---- Associate members (7) ---------------------------------------------------
  var ams = [];
  for (var a = 0; a < 7; a++) {
    var q = _demoPerson(30 + a);
    ams.push({
      member_id: 'MDEMOA' + (a + 1), 'BK#': String(2200 + a), bid_order: a + 2, legal_first: q.first, preferred_name: q.first, legal_last: q.last,
      phone: q.phone, personal_email: q.email, GT_email: q.email, major: q.major, year: 'Freshman', anticipated_graduation: 'Spring 2030',
      shirt_size: q.sizes, hometown: 'Atlanta, GA', status: 'associate', pledge_class: 'Epsilon',
      added_date: _demoIso(-35, 10), last_updated: _demoIso(-1, 10), points: [12, 9, 7, 6, 4, 2, 0][a]
    });
  }
  _demoAppend(ss, 'AMs', ams, ['birthday']);

  // ---- Alumni (8) --------------------------------------------------------------
  var alumni = [];
  for (var l = 0; l < 8; l++) {
    var r = _demoPerson(40 + l);
    alumni.push({
      member_id: 'MDEMOL' + (l + 1), 'BK#': String(1900 + l * 7), legal_first: r.first, preferred_name: r.first, legal_last: r.last,
      phone: r.phone, personal_email: r.email, GT_email: r.email, major: r.major, hometown: 'Atlanta, GA',
      pledge_class: ['Alpha','Beta','Gamma'][l % 3], officer_role: l === 0 ? 'Past President' : '',
      graduated_semester: l % 2 ? 'Spring 2026' : 'Fall 2025', moved_to_alumni_date: _demoDate(-60 - l * 20), notes: l === 0 ? 'Alumni board contact (demo)' : ''
    });
  }
  _demoAppend(ss, 'alumni', alumni, ['birthday']);

  // ---- Chore ratios file (only if there is none) ---------------------------
  if (!DriveApp.getFilesByName('chore_ratios.json').hasNext()) {
    DriveApp.createFile('chore_ratios.json', JSON.stringify({ chores: DEMO_CHORES }, null, 2), 'application/json');
  }

  // ---- Chore assignments: spread active brothers over the 6 chores -----------
  var assignments = [], submissions = [], fines = [], k2 = 0;
  var chorePool = [];
  DEMO_CHORES.forEach(function(c) { for (var n = 0; n < c.people; n++) chorePool.push(c.name); });
  members.filter(function(m) { return m.status === 'active'; }).forEach(function(m, idx) {
    var chore = chorePool[idx % chorePool.length];
    var gid = 'G' + chore.replace(/[^A-Za-z0-9]/g, '').substring(0, 8) + '_' + semester.replace(/\s/g, '');
    assignments.push({ assignment_id: 'ADEMO' + (idx + 1), member_id: m.member_id, chore_name: chore, group_id: gid, semester: semester, assigned_date: _demoDate(-40) });

    // Current-week submission for ~70%: mostly passed, a few flagged, a couple verified by an officer
    var mod = idx % 10;
    if (mod < 7) {
      var auto = mod === 5 ? 'flagged' : 'passed';
      submissions.push({
        submission_id: 'SDEMO' + (idx + 1), member_id: m.member_id, chore_name: chore, week_start: weekStart,
        submitted_at: _demoIso(-(idx % 3), 9 + (idx % 8)), photo_url: 'https://placehold.co/600x400?text=' + encodeURIComponent(chore + ' (demo)'),
        photo_hash: 'demo' + idx, exif_date: _demoDate(-(idx % 3)), auto_status: auto,
        human_status: mod === 5 ? 'verified' : (mod === 6 ? 'failed' : ''), verified_by: (mod === 5 || mod === 6) ? 'Officer' : '',
        notes: mod === 6 ? 'Photo too dark (demo)' : ''
      });
    }
    // Fines from last week for brothers that skipped
    if (mod === 8 || mod === 9) {
      fines.push({ fine_id: 'FDEMO' + (++k2), member_id: m.member_id, chore_name: chore, week_start: prevWeek, reason: 'Missed chore submission', issued_at: _demoIso(-5, 8), issued_by: 'system' });
    }
  });
  _demoAppend(ss, 'chore_assignments', assignments, ['assigned_date']);
  _demoAppend(ss, 'submissions', submissions, ['week_start', 'exif_date']);
  _demoAppend(ss, 'fines', fines, ['week_start']);

  // ---- Events (past + upcoming) and attendance -----------------------------
  var evDefs = [
    { off: -21, title: 'Chapter Meeting',        type: 'Chapter',      start: '19:00', end: '20:30', loc: 'Chapter Room',       att: 'brothers', counts: false },
    { off: -17, title: 'Rush Kickoff Social',    type: 'Recruitment',  start: '18:00', end: '21:00', loc: 'Fraternity House',   att: 'everyone', counts: true,  pts: 2 },
    { off: -14, title: 'Chapter Meeting',        type: 'Chapter',      start: '19:00', end: '20:30', loc: 'Chapter Room',       att: 'brothers', counts: false },
    { off: -12, title: 'Habitat for Humanity Build', type: 'Philanthropy', start: '09:00', end: '14:00', loc: 'West End, Atlanta', att: 'everyone', counts: true, pts: 3 },
    { off: -9,  title: 'Brotherhood Dinner',     type: 'Brotherhood',  start: '18:30', end: '20:30', loc: 'Fraternity House',   att: 'everyone', counts: true,  pts: 1 },
    { off: -7,  title: 'Chapter Meeting',        type: 'Chapter',      start: '19:00', end: '20:30', loc: 'Chapter Room',       att: 'brothers', counts: false },
    { off: -4,  title: 'AM Education Night',     type: 'Brotherhood',  start: '20:00', end: '21:00', loc: 'Chapter Room',       att: 'novatos',  counts: true,  pts: 1 },
    { off: -2,  title: 'Mixer with Sorority',    type: 'Social',       start: '21:00', end: '23:59', loc: 'Fraternity House',   att: 'none',     counts: false },
    { off: 0,   title: 'Chapter Meeting',        type: 'Chapter',      start: '19:00', end: '20:30', loc: 'Chapter Room',       att: 'brothers', counts: false },
    { off: 2,   title: 'Intramural Soccer',      type: 'Brotherhood',  start: '17:30', end: '18:30', loc: 'Campus Rec Fields',  att: 'none',     counts: false },
    { off: 4,   title: 'Philanthropy Car Wash',  type: 'Philanthropy', start: '10:00', end: '14:00', loc: 'Fraternity House',   att: 'everyone', counts: true,  pts: 2 },
    { off: 7,   title: 'Chapter Meeting',        type: 'Chapter',      start: '19:00', end: '20:30', loc: 'Chapter Room',       att: 'brothers', counts: false },
    { off: 10,  title: 'Alumni Weekend Dinner',  type: 'Other',        start: '18:00', end: '21:00', loc: 'Fraternity House',   att: 'none',     counts: false },
    { off: 14,  title: 'Chapter Meeting',        type: 'Chapter',      start: '19:00', end: '20:30', loc: 'Chapter Room',       att: 'brothers', counts: false },
    { off: 18,  title: 'Bid Day Cookout',        type: 'Recruitment',  start: '12:00', end: '15:00', loc: 'Fraternity House',   att: 'everyone', counts: true,  pts: 2 }
  ];
  var events = [], attendance = [];
  var actives = members.filter(function(m) { return m.status === 'active'; });
  evDefs.forEach(function(e, n) {
    var eid = 'EDEMO' + ('0' + (n + 1)).slice(-2);
    events.push({
      event_id: eid, title: e.title, event_type: e.type, event_date: _demoDate(e.off), start_time: e.start, end_time: e.end, all_day: '',
      location: e.loc, description: 'Demo event', gcal_event_id: '', created_by: 'Officer', created_at: _demoIso(-30, 10), updated_at: _demoIso(-30, 10),
      attendance: e.att, counts_for_novatos: e.counts ? 'Y' : '', points: e.pts || 1, series_id: '', gcal_dirty: ''
    });
    if (e.off < 0 && e.att !== 'none') {
      if (e.att === 'brothers' || e.att === 'everyone') {
        actives.forEach(function(m, idx) {
          if ((idx + n) % 6 === 0) return; // ~1 in 6 absent, varies per event
          attendance.push({ event_id: eid, member_id: m.member_id, member_name: m.preferred_name + ' ' + m.legal_last, member_type: 'brother', marked_by: 'Officer', marked_at: _demoIso(e.off, 20) });
        });
      }
      if (e.att === 'novatos' || e.att === 'everyone') {
        ams.forEach(function(m, idx) {
          if ((idx + n) % 5 === 0) return;
          attendance.push({ event_id: eid, member_id: m.member_id, member_name: m.preferred_name + ' ' + m.legal_last, member_type: 'novato', marked_by: 'Officer', marked_at: _demoIso(e.off, 20) });
        });
      }
    }
  });
  _demoAppend(ss, 'events', events, ['event_date', 'start_time', 'end_time']);
  _demoAppend(ss, 'event_attendance', attendance);

  // ---- AM events, attendance and signatures ---------------------------------
  var amEvents = [
    { category: 'Kappa',   title: 'Study Hall Night',     off: -20, pts: 2 },
    { category: 'Beta',    title: 'House Cleanup',        off: -14, pts: 3 },
    { category: 'Rho',     title: 'Brother Interviews',   off: -8,  pts: 2 },
    { category: 'Epsilon', title: 'Intramural Volleyball', off: -3, pts: 1 }
  ].map(function(e, n) {
    return { event_id: 'AEDEMO' + (n + 1), category: e.category, title: e.title, event_date: _demoDate(e.off), points: e.pts, active: true, created_at: _demoIso(e.off - 2, 10) };
  });
  var amAtt = [];
  amEvents.forEach(function(e, n) {
    ams.forEach(function(m, idx) {
      if ((idx + n) % 4 === 3) return;
      amAtt.push({ event_id: e.event_id, member_id: m.member_id, marked_by: 'Officer', marked_at: _demoIso(-3 - n, 21) });
    });
  });
  _demoAppend(ss, 'am_events', amEvents, ['event_date']);
  _demoAppend(ss, 'am_attendance', amAtt);

  var activities = ['Played FIFA together', 'Went to lunch at the dining hall', 'Studied for midterm', 'Watched the game', 'Went on a run', 'Cooked dinner at the house'];
  var sigs = [];
  ams.forEach(function(m, idx) {
    for (var s = 0; s < Math.max(1, 4 - Math.floor(idx / 2)); s++) {
      var b = members[(idx * 3 + s * 5) % 20];
      sigs.push({
        sig_id: 'SIGDEMO' + (sigs.length + 1), am_member_id: m.member_id, am_name: m.preferred_name + ' ' + m.legal_last,
        brother_name: b.legal_first + ' ' + b.legal_last, activity: activities[(idx + s) % activities.length],
        photo_url: 'https://placehold.co/600x400?text=Signature+(demo)', semester: semester, timestamp: _demoIso(-(s * 4 + idx), 16), points_awarded: 1
      });
    }
  });
  _demoAppend(ss, 'signatures', sigs);

  // ---- Member notes ---------------------------------------------------------
  _demoAppend(ss, 'member_notes', [
    { note_id: 'NDEMO1', member_id: 'MDEMO21', note_text: 'Met with president about conduct (demo)', note_type: 'disciplinary', created_by: 'Officer', created_at: _demoIso(-10, 15) },
    { note_id: 'NDEMO2', member_id: 'MDEMO22', note_text: 'Study plan agreed with academic chair (demo)', note_type: 'academic', created_by: 'Officer', created_at: _demoIso(-8, 15) },
    { note_id: 'NDEMO3', member_id: 'MDEMO05', note_text: 'Great job organizing the car wash (demo)', note_type: 'positive', created_by: 'Officer', created_at: _demoIso(-2, 15) }
  ]);

  // ---- Philanthropy responses (only if the form already exists) --------------
  var forms = ss.getSheetByName('forms');
  if (forms && ss.getSheetByName('form_responses')) {
    var fdata = forms.getDataRange().getValues();
    var fcm = _buildColMap(fdata[0]);
    var formId = '';
    for (var f = 1; f < fdata.length; f++) {
      if (String(fdata[f][fcm['action']]).indexOf('"philanthropy"') !== -1) { formId = String(fdata[f][fcm['form_id']]); break; }
    }
    if (formId) {
      var orgs = ['Habitat for Humanity', 'Atlanta Food Bank', 'Special Olympics', 'Park cleanup', 'Animal shelter'];
      var resp = [];
      for (var h = 0; h < 12; h++) {
        var mm = actives[h];
        var st = h % 4 === 3 ? 'pending' : (h % 7 === 6 ? 'denied' : 'approved');
        resp.push({
          response_id: 'RDEMO' + (h + 1), form_id: formId, member_id: mm.member_id, member_type: 'brother', member_name: mm.preferred_name + ' ' + mm.legal_last,
          answers: JSON.stringify({ f1: orgs[h % orgs.length], f2: _demoDate(-(h * 3 + 2)), f3: [2, 3, 1.5, 4, 2.5][h % 5], f4: 'Volunteered with the team (demo)', f5: [] }),
          submitted_at: _demoIso(-(h * 3 + 1), 18), review_status: st === 'pending' ? 'pending' : st,
          reviewed_by: st === 'pending' ? '' : 'Officer', reviewed_at: st === 'pending' ? '' : _demoIso(-(h * 3), 12), review_note: st === 'denied' ? 'Missing proof (demo)' : ''
        });
      }
      _demoAppend(ss, 'form_responses', resp);
    }
  }

  logInfo('loadDemoData', 'Demo data loaded: ' + members.length + ' members, ' + ams.length + ' AMs, ' + alumni.length + ' alumni, ' + events.length + ' events.');
  return 'Demo data loaded (' + members.length + ' members, ' + ams.length + ' AMs, ' + alumni.length + ' alumni, ' + events.length + ' events).';
}

// Deletes every row whose first column contains "DEMO". Returns the number of rows removed.
function removeDemoData() {
  var ss = getSpreadsheet();
  var tabs = ['members', 'AMs', 'alumni', 'chore_assignments', 'submissions', 'fines', 'events', 'event_attendance',
              'am_events', 'am_attendance', 'signatures', 'member_notes', 'form_responses'];
  var removed = 0;
  tabs.forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) {
      if (String(ids[i][0]).indexOf('DEMO') !== -1) { sheet.deleteRow(i + 2); removed++; }
    }
  });
  return removed;
}

function loadDemoDataMenu() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Load demo data', 'Adds fictional members, AMs, alumni, chores, events and responses (ids contain DEMO). Existing demo rows are replaced; real rows are untouched.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  try { ui.alert(loadDemoData()); } catch (e) { logError('loadDemoData', e); ui.alert('Error: ' + e); }
}

function removeDemoDataMenu() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Remove demo data', 'Deletes every row whose id contains DEMO. Real rows are untouched.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  ui.alert(removeDemoData() + ' demo rows removed.');
}
