// ============================================================
// DriveStorage.gs — one Drive root folder per chapter, chosen by the
// officers (Admin > Drive storage), with the app building the folder
// system inside it:
//
//   <root>/<AM officer label>/<semester>/Signatures/<AM name>/
//   <root>/<Chores label>/<semester>/Week_<yyyy-MM-dd>/
//   <root>/Forms/<semester>/<form title>/
//
// Every upload (signature photos, chore photos, form photos) goes through
// driveFolder(). The web app runs as the account that deployed it, so the
// root folder has to be reachable by that account. Config key
// 'drive_root_folder_id' holds the choice; with none set, the first upload
// creates "<chapter name> Files" in the deployer's My Drive and remembers it.
// ============================================================

var DRIVE_ROOT_KEY = 'drive_root_folder_id';
var DRIVE_AREAS = ['am', 'chores', 'forms'];

function _driveClean(name) {
  return String(name == null ? '' : name).replace(/[\\\/]/g, '-').trim().substring(0, 80) || 'Unnamed';
}

function _driveAreaName(area) {
  var L = (getChapterConfig().labels) || {};
  if (area === 'am') return _driveClean(L.label_am_officer || 'Associate Members');
  if (area === 'chores') {
    var c = String(L.label_chore || 'Chore');
    return _driveClean(/s$/i.test(c) ? c : /[^aeiou]y$/i.test(c) ? c.slice(0, -1) + 'ies' : c + 's');
  }
  return 'Forms';
}

// Accepts a Drive folder URL (…/folders/<id>, …?id=<id>) or a bare folder id.
function _driveParseFolderId(input) {
  var s = String(input || '').trim();
  var m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : '';
}

function _driveRoot() {
  var id = String(getConfigValue(DRIVE_ROOT_KEY) || '').trim();
  if (id) return DriveApp.getFolderById(id);
  var folder = DriveApp.createFolder(_driveClean((getChapterConfig().chapter.chapter_name || 'Chapter') + ' Files'));
  setConfigValue(DRIVE_ROOT_KEY, folder.getId());
  return folder;
}

// Returns <root>/<area>/<semester>/<parts...>, creating whatever is missing.
function driveFolder(area, semester, parts) {
  var f = _getOrCreateFolder(_driveRoot(), _driveAreaName(area));
  f = _getOrCreateFolder(f, _driveClean(semester || getConfigValue('semester') || 'Unknown Semester'));
  (parts || []).forEach(function(p) { f = _getOrCreateFolder(f, _driveClean(p)); });
  return f;
}

function _driveDeny(pin) {
  return _checkOfficerPin(pin) ? null : JSON.stringify({ success: false, error: 'Unauthorized: incorrect officer PIN.' });
}

// Pre-creates this semester's folders, including one signatures folder per
// current AM, so the album is browsable before the first upload.
function _driveBuildTree() {
  var sem = getConfigValue('semester') || 'Unknown Semester';
  var sigRoot = driveFolder('am', sem, ['Signatures']);
  var amCount = 0;
  _getMembersStructured('AMs').forEach(function(m) {
    if (m.status !== 'associate' || !m.name) return;
    _getOrCreateFolder(sigRoot, _driveClean(m.name));
    amCount++;
  });
  driveFolder('chores', sem);
  driveFolder('forms', sem);
  return amCount;
}

function _driveStatus() {
  var id = String(getConfigValue(DRIVE_ROOT_KEY) || '').trim();
  var sem = getConfigValue('semester') || 'Unknown Semester';
  if (!id) return { success: true, configured: false, semester: sem };
  var root;
  try {
    root = DriveApp.getFolderById(id);
    if (root.isTrashed && root.isTrashed()) throw new Error('The folder is in the trash.');
  } catch (err) {
    return { success: true, configured: true, broken: true, rootId: id, semester: sem,
      error: 'The saved folder can no longer be opened. Pick another one.' };
  }
  var areas = DRIVE_AREAS.map(function(a) {
    var name = _driveAreaName(a), url = '', semUrl = '';
    var it = root.getFoldersByName(name);
    if (it.hasNext()) {
      var af = it.next(); url = af.getUrl();
      var si = af.getFoldersByName(_driveClean(sem));
      if (si.hasNext()) semUrl = si.next().getUrl();
    }
    return { key: a, name: name, url: url, semesterUrl: semUrl };
  });
  return { success: true, configured: true, rootId: id, rootName: root.getName(), rootUrl: root.getUrl(), semester: sem, areas: areas };
}

function driveGetStorage(pin) {
  var denied = _driveDeny(pin); if (denied) return denied;
  try { return JSON.stringify(_driveStatus()); }
  catch (err) { logError('driveGetStorage', err); return JSON.stringify({ success: false, error: String(err) }); }
}

function driveSetRoot(pin, input) {
  var denied = _driveDeny(pin); if (denied) return denied;
  try {
    var id = _driveParseFolderId(input);
    if (!id) return JSON.stringify({ success: false, error: 'Paste the link of a Google Drive folder (drive.google.com/drive/folders/...).' });
    var folder;
    try { folder = DriveApp.getFolderById(id); }
    catch (e) { return JSON.stringify({ success: false, error: 'That folder cannot be opened. Check the link, and that it is shared with the Google account this app runs under.' }); }
    if (folder.isTrashed && folder.isTrashed()) return JSON.stringify({ success: false, error: 'That folder is in the trash.' });
    try { folder.createFolder('.write-test').setTrashed(true); }
    catch (e) { return JSON.stringify({ success: false, error: 'The app can open that folder but not write in it. Give the Google account this app runs under Editor access.' }); }
    setConfigValue(DRIVE_ROOT_KEY, id);
    var n = _driveBuildTree();
    logInfo('driveSetRoot', 'root = ' + id);
    var st = _driveStatus(); st.message = 'Folder saved. Created this semester\'s folders' + (n ? ' and ' + n + ' signature folder(s).' : '.') + ' Files already uploaded stay where they are.';
    return JSON.stringify(st);
  } catch (err) { logError('driveSetRoot', err); return JSON.stringify({ success: false, error: String(err) }); }
}

function driveCreateRoot(pin) {
  var denied = _driveDeny(pin); if (denied) return denied;
  try {
    var folder = DriveApp.createFolder(_driveClean((getChapterConfig().chapter.chapter_name || 'Chapter') + ' Files'));
    setConfigValue(DRIVE_ROOT_KEY, folder.getId());
    var n = _driveBuildTree();
    logInfo('driveCreateRoot', 'root = ' + folder.getId());
    var st = _driveStatus(); st.message = 'Created "' + folder.getName() + '" in the app account\'s Drive' + (n ? ' with ' + n + ' signature folder(s).' : '.');
    return JSON.stringify(st);
  } catch (err) { logError('driveCreateRoot', err); return JSON.stringify({ success: false, error: String(err) }); }
}

function driveBuildTree(pin) {
  var denied = _driveDeny(pin); if (denied) return denied;
  try {
    var n = _driveBuildTree();
    var st = _driveStatus(); st.message = 'Folders ready for ' + st.semester + (n ? ' (' + n + ' signature folder(s)).' : '.');
    return JSON.stringify(st);
  } catch (err) { logError('driveBuildTree', err); return JSON.stringify({ success: false, error: String(err) }); }
}
