// ============================================================
// Signatures.gs — AM "signatures" system: an AM completes an
// activity with a brother, submits proof (SignatureApp.html), and
// earns points automatically via adjustAMPoints (Code.gs). Photos
// land in Drive under Signatures Pics/<semester>/<AM name>/ for the
// end-of-semester album. Points-per-signature is the 'signature_points'
// config key, editable in Admin > Config Editor (seeded by ensureTabsExist).
// ============================================================

var SIGNATURE_HEADERS = ['sig_id', 'am_member_id', 'am_name', 'brother_name', 'activity', 'photo_url', 'semester', 'timestamp', 'points_awarded'];

// 'Signatures Pics' lives inside this shared Drive folder (David's pick), not
// the script's own Drive root — https://drive.google.com/drive/folders/1mTuoYc5Bk2NQhDL33EoiA8zyPAk0y_xx
var SIGNATURES_PARENT_FOLDER_ID = '1mTuoYc5Bk2NQhDL33EoiA8zyPAk0y_xx';

// AMs currently eligible to submit a signature (associate status only).
function getActiveAMsForSignature() {
  try {
    var ams = _getMembersStructured('AMs')
      .filter(function(m) { return m.status === 'associate'; })
      .map(function(m) { return { id: m.memberId, name: m.name }; });
    ams.sort(function(a, b) { return a.name.localeCompare(b.name); });
    return JSON.stringify(ams);
  } catch (err) { logError('getActiveAMsForSignature', err); return JSON.stringify([]); }
}

function processSignatureSubmission(amMemberId, brotherName, activity, photoBase64, mimeType) {
  try {
    brotherName = String(brotherName || '').trim();
    activity    = String(activity || '').trim();
    if (!amMemberId)  return JSON.stringify({ success: false, message: 'Select your name.' });
    if (!brotherName) return JSON.stringify({ success: false, message: "Enter the brother's full name." });
    if (!activity)     return JSON.stringify({ success: false, message: 'Describe the activity.' });
    if (!photoBase64)  return JSON.stringify({ success: false, message: 'A photo is required.' });

    var am = _getMembersStructured('AMs').filter(function(m) {
      return m.memberId === amMemberId && m.status === 'associate';
    })[0];
    if (!am) return JSON.stringify({ success: false, message: 'AM not found or no longer active. Contact an officer.' });

    var bytes = Utilities.base64Decode(photoBase64);
    if (bytes.length < 5120) {
      return JSON.stringify({ success: false, message: 'Image file is too small. Please take a real photo.' });
    }

    var semester  = getConfigValue('semester') || 'Unknown Semester';
    var photoBlob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', 'signature.jpg');
    var photoUrl  = _saveSignaturePhotoToDrive(photoBlob, am.name, semester);

    var ss = getSpreadsheet();
    var sigSheet = ss.getSheetByName('signatures');
    if (!sigSheet) { sigSheet = ss.insertSheet('signatures'); sigSheet.appendRow(SIGNATURE_HEADERS); sigSheet.setFrozenRows(1); }

    var points   = Number(getConfigValue('signature_points') || 1);
    var sid = 'SIG' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
    // points_awarded is stored per-row so a later deletion (see deleteSignature)
    // reverts the exact amount this signature granted, even if signature_points
    // has since been reconfigured to a different value.
    sigSheet.appendRow([sid, amMemberId, am.name, brotherName, activity, photoUrl, semester, new Date().toISOString(), points]);

    var ptResult = JSON.parse(adjustAMPoints(amMemberId, points, 'Signature with ' + brotherName + ': ' + activity, 'AM Signature Form'));

    logInfo('processSignatureSubmission', sid + ' | ' + am.name + ' + ' + brotherName);
    return JSON.stringify({
      success: true,
      message: 'Signature submitted! +' + points + ' point' + (points === 1 ? '' : 's') + '.',
      signatureId: sid,
      newTotal: ptResult.newTotal
    });
  } catch (err) {
    logError('processSignatureSubmission', err);
    return JSON.stringify({ success: false, message: 'Submission failed. Please try again or contact an officer.' });
  }
}

// Signatures Pics/<semester>/<AM name>/ — auto-creates folders as needed, same
// pattern as _savePhotoToDrive in PhotoCheck.gs. Two AMs sharing an identical
// full name would share a folder here; rare enough not to special-case.
function _saveSignaturePhotoToDrive(photoBlob, amName, semester) {
  try {
    var parent = DriveApp.getFolderById(SIGNATURES_PARENT_FOLDER_ID);
    var root = _getOrCreateFolder(parent, 'Signatures Pics');
    var semF = _getOrCreateFolder(root, semester);
    var amF  = _getOrCreateFolder(semF, amName || 'Unknown AM');

    var name = String(amName || 'am').replace(/[^A-Za-z0-9]/g, '_') + '__' + Date.now() + '.jpg';
    photoBlob.setName(name);

    var file = amF.createFile(photoBlob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (err) {
    logError('_saveSignaturePhotoToDrive', err);
    return '';
  }
}

// Deletes a signature row (test submissions, fake/troll entries) and reverts
// the points it awarded via adjustAMPoints — using the row's own points_awarded,
// not the current signature_points config, so a reconfigured value later can't
// throw off the reversal. Also trashes the Drive photo so it doesn't linger in
// the end-of-semester album. If the AM already crossed to brotherhood (off the
// AMs sheet), adjustAMPoints can't find them and the point reversal is skipped —
// the row still deletes either way.
function deleteSignature(sigId, performedBy) {
  try {
    performedBy = performedBy || 'Officer';
    var ss = getSpreadsheet();
    var sigSheet = ss.getSheetByName('signatures');
    if (!sigSheet) return JSON.stringify({ success: false, error: 'signatures tab not found.' });

    var data = sigSheet.getDataRange().getValues();
    var cm = _buildColMap(data[0]);

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][cm['sig_id']]) === String(sigId)) {
        var row         = data[i];
        var amMemberId  = String(row[cm['am_member_id']]);
        var amName      = String(row[cm['am_name']] || '');
        var brotherName = String(row[cm['brother_name']] || '');
        var photoUrl    = String(row[cm['photo_url']] || '');
        var pointsAwarded = cm['points_awarded'] !== undefined ? (Number(row[cm['points_awarded']]) || 0) : 0;

        if (pointsAwarded) {
          adjustAMPoints(amMemberId, -pointsAwarded, 'Signature deleted (was: with ' + brotherName + ')', performedBy);
        }
        if (photoUrl) _trashSignaturePhoto(photoUrl);

        sigSheet.deleteRow(i + 1);
        _logAudit('deleteSignature', amMemberId, amName, performedBy, 'sig=' + sigId + ' points_reverted=' + pointsAwarded);
        return JSON.stringify({
          success: true,
          message: 'Signature deleted' + (pointsAwarded ? ' and ' + pointsAwarded + ' point' + (pointsAwarded === 1 ? '' : 's') + ' reverted.' : '.')
        });
      }
    }
    return JSON.stringify({ success: false, error: 'Signature not found.' });
  } catch (err) { logError('deleteSignature', err); return JSON.stringify({ success: false, error: err.toString() }); }
}

function _trashSignaturePhoto(photoUrl) {
  try {
    var m = String(photoUrl).match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (!m) return;
    DriveApp.getFileById(m[1]).setTrashed(true);
  } catch (err) {
    logError('_trashSignaturePhoto', err);
  }
}

// Officer-facing Signatures Dashboard: every currently-associate AM with their
// signature count and detail list, sorted by count descending (highest first) —
// same ranking the AM Manager itself sorts by, since a signature's points feed
// straight into that total via adjustAMPoints above.
function getSignaturesDashboardData() {
  try {
    var ams = _getMembersStructured('AMs').filter(function(m) { return m.status === 'associate'; });

    var sigSheet = getSpreadsheet().getSheetByName('signatures');
    var sigData  = sigSheet ? sigSheet.getDataRange().getValues() : [];
    var cm       = sigData.length ? _buildColMap(sigData[0]) : {};

    var byMember = {};
    for (var i = 1; i < sigData.length; i++) {
      var r = sigData[i];
      var amId = String(r[cm['am_member_id']]);
      if (!byMember[amId]) byMember[amId] = [];
      byMember[amId].push({
        sigId:       String(r[cm['sig_id']]       || ''),
        brotherName: String(r[cm['brother_name']] || ''),
        activity:    String(r[cm['activity']]     || ''),
        photoUrl:    String(r[cm['photo_url']]    || ''),
        timestamp:   String(r[cm['timestamp']]    || '')
      });
    }

    var result = ams.map(function(m) {
      var sigs = byMember[m.memberId] || [];
      sigs.sort(function(a, b) { return b.timestamp.localeCompare(a.timestamp); });
      return { memberId: m.memberId, name: m.name, count: sigs.length, signatures: sigs };
    });
    result.sort(function(a, b) {
      var diff = b.count - a.count;
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });

    return JSON.stringify({ success: true, data: result });
  } catch (err) { logError('getSignaturesDashboardData', err); return JSON.stringify({ success: false, error: err.toString() }); }
}
