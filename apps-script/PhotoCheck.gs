// ============================================================
// PhotoCheck.gs — Photo verification, hash checking, Drive storage
// ============================================================

function processPhotoSubmission(memberId, choreName, photoBase64, mimeType, clientDateIso) {
  try {
    const semester        = getConfigValue('semester');
    const weekStart       = _normDate(getConfigValue('week_start'));
    const hashThreshold   = parseInt(getConfigValue('photo_hash_threshold') || '10');
    const exifAgeLimit    = parseInt(getConfigValue('exif_age_limit_days') || '8');
    const ss              = getSpreadsheet();

    // ── Guard 1: member must be active ───────────────────────────────────────
    const memData = ss.getSheetByName('members').getDataRange().getValues();
    let memberActive = false;
    for (let i = 1; i < memData.length; i++) {
      if (memData[i][0] === memberId && memData[i][3] === 'active') { memberActive = true; break; }
    }
    if (!memberActive) {
      logError('processPhotoSubmission', `Inactive/unknown member tried to submit: ${memberId}`);
      return JSON.stringify({ success: false, autoStatus: 'rejected',
        message: 'Your account is not active. Contact an officer.' });
    }

    // ── Guard 2: member must be assigned to this chore this semester ──────────
    const asgData = ss.getSheetByName('chore_assignments').getDataRange().getValues();
    let isAssigned = false;
    for (let i = 1; i < asgData.length; i++) {
      if (asgData[i][1] === memberId && asgData[i][2] === choreName && asgData[i][4] === semester) {
        isAssigned = true; break;
      }
    }
    if (!isAssigned) {
      logError('processPhotoSubmission', `Unassigned submission attempt: ${memberId} → ${choreName}`);
      return JSON.stringify({ success: false, autoStatus: 'rejected',
        message: 'You are not assigned to this chore. Contact an officer if this is wrong.' });
    }

    // ── Guard 3: no double-submit (same member+chore+week) ────────────────────
    const subSheet = ss.getSheetByName('submissions');
    const existing = subSheet.getDataRange().getValues();
    for (let i = 1; i < existing.length; i++) {
      const r = existing[i];
      if (r[1] === memberId && r[2] === choreName && _normDate(r[3]) === weekStart) {
        // If an officer already failed this submission, lock it out entirely
        if (r[9] === 'failed') {
          return JSON.stringify({ success: false, autoStatus: 'rejected',
            message: 'An officer reviewed and failed your submission. You cannot resubmit — contact an officer.' });
        }
        return JSON.stringify({ success: false, autoStatus: 'rejected',
          message: 'You already submitted for this chore this week.',
          submissionId: r[0] });
      }
    }

    // ── Guard 4: minimum file size (real photos are always >5 KB) ────────────
    const bytes = Utilities.base64Decode(photoBase64);
    if (bytes.length < 5120) {
      logError('processPhotoSubmission', `Image too small (${bytes.length} bytes): ${memberId} → ${choreName}`);
      return JSON.stringify({ success: false, autoStatus: 'rejected',
        message: 'Image file is too small. Please take a real photo with your camera.' });
    }

    const photoBlob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', 'chore_photo.jpg');
    const photoUrl  = _savePhotoToDrive(photoBlob, memberId, choreName, semester, weekStart);
    const newHash   = computeImageHash(photoBlob);

    let autoStatus    = 'passed';
    let statusMessage = 'Photo submitted successfully!';
    let duplicateNote = '';

    // ── Guard 5: degenerate hash (solid color / blank image) ─────────────────
    if (newHash === '0'.repeat(64) || newHash === '1'.repeat(64)) {
      autoStatus    = 'flagged';
      statusMessage = 'Image appears to be blank or solid color — an officer will review it.';
      duplicateNote = 'Degenerate image hash (uniform pixel values).';
    }

    // ── Duplicate / near-duplicate check (vs. other chore members' photos) ────
    if (autoStatus === 'passed') {
      for (let i = 1; i < existing.length; i++) {
        const r = existing[i];
        if (r[2] !== choreName) continue;
        const existingHash = String(r[6]);
        if (!existingHash || existingHash.length !== 64) continue;
        if (existingHash === newHash) {
          autoStatus    = 'rejected';
          statusMessage = 'Exact duplicate detected. Please take a new photo.';
          duplicateNote = 'Exact duplicate of submission: ' + r[0];
          break;
        }
        const dist = hammingDistance(existingHash, newHash);
        if (dist < hashThreshold) {
          autoStatus    = 'flagged';
          statusMessage = 'Photo looks similar to an existing submission — an officer will review it.';
          duplicateNote = `Near-duplicate of ${r[0]} (distance=${dist})`;
          break;
        }
      }
    }

    // ── Photo age check (clientDate is advisory — attacker can spoof it) ──────
    let photoDate = null;
    if (clientDateIso) {
      try { photoDate = new Date(clientDateIso); } catch (_) {}
    }
    if (photoDate && autoStatus === 'passed') {
      const daysDiff = (Date.now() - photoDate.getTime()) / 86400000;
      if (daysDiff < 0) {
        // Future timestamp — clock skew or deliberate manipulation
        autoStatus    = 'flagged';
        statusMessage = 'Photo has a future timestamp — an officer will review it.';
        duplicateNote = `Suspicious future photo date: ${photoDate.toISOString()}`;
      } else if (daysDiff > exifAgeLimit) {
        autoStatus    = 'flagged';
        statusMessage = `Photo appears to be ${Math.floor(daysDiff)} days old — an officer will review it.`;
        duplicateNote = `Photo date: ${photoDate.toISOString()}`;
      }
    }

    // ── Write submission record ───────────────────────────────────────────────
    const sid = 'S' + Utilities.getUuid().replace(/-/g,'').substring(0,8).toUpperCase();
    subSheet.appendRow([
      sid, memberId, choreName, weekStart,
      new Date().toISOString(), photoUrl, newHash,
      photoDate ? photoDate.toISOString() : '',
      autoStatus, 'pending', '', duplicateNote
    ]);

    logInfo('processPhotoSubmission', `${sid} | ${choreName} | ${memberId} | ${autoStatus}`);
    return JSON.stringify({ success: autoStatus !== 'rejected', autoStatus, message: statusMessage, submissionId: sid });

  } catch (err) {
    logError('processPhotoSubmission', err);
    return JSON.stringify({ success: false, autoStatus: 'error',
      message: 'Submission failed. Please try again or contact an officer.' });
  }
}

// ---- Drive storage -----------------------------------------

function _savePhotoToDrive(photoBlob, memberId, choreName, semester, weekStart) {
  try {
    const root = _getOrCreateFolder(DriveApp.getRootFolder(), 'ChorePhotos');
    const semF = _getOrCreateFolder(root, semester);
    const weekF= _getOrCreateFolder(semF, 'Week_' + weekStart);

    const safe = choreName.replace(/[^A-Za-z0-9]/g, '_');
    const name = `${safe}__${memberId}__${Date.now()}.jpg`;
    photoBlob.setName(name);

    const file = weekF.createFile(photoBlob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (err) {
    logError('_savePhotoToDrive', err);
    return '';
  }
}

function _getOrCreateFolder(parent, name) {
  const iter = parent.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : parent.createFolder(name);
}

// ---- Perceptual hash ----------------------------------------
// Strategy: sample 64 evenly-spaced byte positions across the
// image body (past the header), compare each to the sample mean.
// Bit = 1 if value >= mean, else 0. Produces a 64-char binary string.

function computeImageHash(imageBlob) {
  try {
    const bytes = imageBlob.getBytes();
    const len   = bytes.length;
    if (len < 100) return '0'.repeat(64);

    // Skip past JPEG header (~first 10% of file, min 512 bytes)
    const start = Math.min(512, Math.floor(len * 0.1));
    const span  = len - start;

    const samples = [];
    for (let i = 0; i < 64; i++) {
      const pos = start + Math.floor((i / 64) * span);
      // Apps Script bytes are signed; normalize to 0-255
      samples.push(((bytes[pos] % 256) + 256) % 256);
    }

    const mean = samples.reduce((a, b) => a + b, 0) / 64;
    return samples.map(v => v >= mean ? '1' : '0').join('');
  } catch (err) {
    logError('computeImageHash', err);
    // Return unique-ish hash so nothing matches
    return Array.from({ length: 64 }, () => Math.round(Math.random())).join('');
  }
}

// ---- Hamming distance --------------------------------------

function hammingDistance(h1, h2) {
  if (!h1 || !h2 || h1.length !== h2.length) return 64;
  let d = 0;
  for (let i = 0; i < h1.length; i++) if (h1[i] !== h2[i]) d++;
  return d;
}
