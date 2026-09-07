'use strict';
/**
 * db/rotationTranscriptRepo370.js — ECOS V370 (Phase P258)
 *
 * File-backed ledger of repo-integrity HMAC key rotation events.
 * Each record is `{activeKeyId, previousKeyIds, repoIntegrityHash,
 * manifestHashSig, ts}` as produced by
 * `recordRepoIntegrityRotation370`.
 *
 * Contract:
 *   createRotationTranscriptRepo370({ filePath?, ephemeral?, maxSize? })
 *     -> { append, list, size, _flush, _reset, filePath, ephemeral, schema }
 *
 * @version 370.0.0
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_SIZE_370 = 8192;
const DEFAULT_REL_PATH_370 = 'data/rotationTranscript370.json';
const SCHEMA_370 = 'ecos.integrity.subscribers.repo.rotation.transcript/v370';

function _atomicWrite370(filePath, payload) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, filePath);
}

function _safeRead370(filePath) {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(txt);
    if (obj && Array.isArray(obj.records)) return obj;
  } catch (_) {}
  return { schema: SCHEMA_370, records: [] };
}

function createRotationTranscriptRepo370(opts) {
  const o = opts || {};
  const ephemeral = !!o.ephemeral;
  const maxSize = (typeof o.maxSize === 'number' && o.maxSize > 0)
    ? o.maxSize : DEFAULT_MAX_SIZE_370;
  const filePath = ephemeral
    ? null
    : path.resolve(o.filePath || process.env.ECOS_ROTATION_TRANSCRIPT_REPO_FILE_370 || DEFAULT_REL_PATH_370);
  const records = [];
  if (filePath) {
    const persisted = _safeRead370(filePath);
    for (const r of persisted.records) {
      if (!r || typeof r !== 'object') continue;
      records.push(r);
    }
  }
  function _flush() {
    if (!filePath) return;
    _atomicWrite370(filePath, {
      schema: SCHEMA_370,
      records: records.slice(),
      updatedAt: new Date().toISOString(),
    });
  }
  return {
    schema: SCHEMA_370,
    filePath, ephemeral,
    append(record) {
      if (!record || typeof record !== 'object') return false;
      records.push(record);
      while (records.length > maxSize) records.shift();
      _flush();
      return true;
    },
    list() { return records.slice(); },
    size() { return records.length; },
    _flush,
    _reset() { records.length = 0; _flush(); },
  };
}

module.exports = {
  createRotationTranscriptRepo370,
  DEFAULT_MAX_SIZE_370,
  DEFAULT_REL_PATH_370,
  SCHEMA_370,
};
