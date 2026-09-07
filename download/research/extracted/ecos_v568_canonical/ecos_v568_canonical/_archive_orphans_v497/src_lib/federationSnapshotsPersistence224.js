// ============================================================
// src/lib/federationSnapshotsPersistence224.js
// ECOS V224 / Phase P111-A — Optional snapshot persistence.
// Flush `_federationSnapshots222` to a JSON file on graceful shutdown
// and rehydrate it from the same file at boot. Node `fs` only — no
// new npm deps (R3). Sacred files untouched (R1). All new identifiers
// end in 224 (R2). No new in-memory stores (R7).
// ============================================================
'use strict';

const fs   = require('fs');
const path = require('path');

const DEFAULT_SNAPSHOT_FILE_224 = path.join(
  process.cwd(),
  '.ecos-federation-snapshots224.json'
);
const SNAPSHOT_FILE_VERSION_224 = 1;

function _isValidSnapshot224(s) {
  return (
    s &&
    typeof s === 'object' &&
    typeof s.takenAt === 'number' &&
    Array.isArray(s.entries)
  );
}

function loadSnapshotsFromDisk224(filepath, _federationSnapshots222) {
  const fp = filepath || DEFAULT_SNAPSHOT_FILE_224;
  if (!Array.isArray(_federationSnapshots222)) {
    return { ok: false, error: 'snapshots ring is not an array', loaded: 0, file: fp };
  }
  if (!fs.existsSync(fp)) {
    return { ok: true, loaded: 0, file: fp, skipped: 'no-file' };
  }
  let raw;
  try {
    raw = fs.readFileSync(fp, 'utf8');
  } catch (e224a) {
    return { ok: false, error: 'read-failed: ' + e224a.message, loaded: 0, file: fp };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e224b) {
    return { ok: false, error: 'parse-failed: ' + e224b.message, loaded: 0, file: fp };
  }
  if (!parsed || parsed.version !== SNAPSHOT_FILE_VERSION_224 || !Array.isArray(parsed.snapshots)) {
    return { ok: false, error: 'bad-shape', loaded: 0, file: fp };
  }
  let loaded = 0;
  for (const s of parsed.snapshots) {
    if (_isValidSnapshot224(s)) {
      _federationSnapshots222.push({
        takenAt: s.takenAt,
        count: typeof s.count === 'number' ? s.count : s.entries.length,
        entries: s.entries,
      });
      loaded++;
    }
  }
  return { ok: true, loaded, file: fp, savedAt: parsed.savedAt || null };
}

function flushSnapshotsToDisk224(filepath, _federationSnapshots222) {
  const fp = filepath || DEFAULT_SNAPSHOT_FILE_224;
  if (!Array.isArray(_federationSnapshots222)) {
    return { ok: false, error: 'snapshots ring is not an array', written: 0, file: fp };
  }
  const payload = {
    version: SNAPSHOT_FILE_VERSION_224,
    savedAt: Date.now(),
    count: _federationSnapshots222.length,
    snapshots: _federationSnapshots222.filter(_isValidSnapshot224),
  };
  const tmp = fp + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, fp);
  } catch (e224c) {
    return { ok: false, error: 'write-failed: ' + e224c.message, written: 0, file: fp };
  }
  return { ok: true, written: payload.count, file: fp, savedAt: payload.savedAt };
}

let _shutdownInstalled224 = false;
function installShutdownHook224(filepath, _federationSnapshots222) {
  if (_shutdownInstalled224) return { ok: true, installed: false, reason: 'already-installed' };
  const handler = () => {
    try { flushSnapshotsToDisk224(filepath, _federationSnapshots222); } catch (_) { /* swallow */ }
  };
  process.once('SIGTERM', handler);
  process.once('SIGINT',  handler);
  process.once('beforeExit', handler);
  _shutdownInstalled224 = true;
  return { ok: true, installed: true, file: filepath || DEFAULT_SNAPSHOT_FILE_224 };
}

function _resetShutdownHookForTests224() {
  _shutdownInstalled224 = false;
}

module.exports = {
  DEFAULT_SNAPSHOT_FILE_224,
  SNAPSHOT_FILE_VERSION_224,
  loadSnapshotsFromDisk224,
  flushSnapshotsToDisk224,
  installShutdownHook224,
  _isValidSnapshot224,
  _resetShutdownHookForTests224,
};
