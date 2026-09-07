// ============================================================
// src/lib/spendLedgerPersistence231.js — Spend Ledger Persistence (P125-A)
// V231. Optional append-only persistence for agentLoop spend ledger.
//
// Features:
//   - On _addSpend_230 writes entry to data/spend_ledger_231.jsonl
//   - Ring buffer: max MAX_LEDGER_ENTRIES_231 lines; compacts automatically.
//   - Graceful degradation: if filesystem is unavailable, logs warn and
//     continues in-memory only (no crash).
//
// Iron rules:
//   R1  Sacred files untouched.
//   R2  All new identifiers end in _231.
//   R3  Zero new npm deps — only fs, path (Node built-ins).
//   R7  Does not replace spendRateTables229 or any existing store.
// ============================================================
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────────────────
const MAX_LEDGER_ENTRIES_231   = 10_000;   // ring cap (total lines)
const COMPACT_THRESHOLD_231    = 12_000;   // trigger compaction when file exceeds this
const DEFAULT_DATA_DIR_231     = path.resolve(process.cwd(), 'data');
const DEFAULT_LEDGER_FILE_231  = path.join(DEFAULT_DATA_DIR_231, 'spend_ledger_231.jsonl');

// ── Internal state ────────────────────────────────────────────────────────────
let _ledgerFile_231       = DEFAULT_LEDGER_FILE_231;
let _persistEnabled_231   = false;
let _initAttempted_231    = false;
let _writeCount_231       = 0;
let _compactCount_231     = 0;
let _lastError_231        = null;

// ── Init ──────────────────────────────────────────────────────────────────────
/**
 * initLedger_231([filePath])
 * Call once at startup (or lazily on first write).
 * Creates data/ dir and ledger file if absent.
 * Returns { ok, filePath, error }.
 */
function initLedger_231(filePath) {
  _ledgerFile_231     = filePath || DEFAULT_LEDGER_FILE_231;
  _initAttempted_231  = true;
  try {
    const dir = path.dirname(_ledgerFile_231);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(_ledgerFile_231)) {
      fs.writeFileSync(_ledgerFile_231, '', 'utf8');
    }
    _persistEnabled_231 = true;
    return { ok: true, filePath: _ledgerFile_231 };
  } catch (err) {
    _lastError_231      = err.message;
    _persistEnabled_231 = false;
    return { ok: false, filePath: _ledgerFile_231, error: err.message };
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────
/**
 * appendSpend_231(projectId, delta, newTotal)
 * Appends one JSONL line to the ledger.
 * Triggers compaction when file grows beyond COMPACT_THRESHOLD_231.
 * Returns { ok, written } — never throws.
 */
function appendSpend_231(projectId, delta, newTotal) {
  if (!_initAttempted_231) {
    initLedger_231();
  }
  if (!_persistEnabled_231) {
    return { ok: false, reason: 'persist-disabled' };
  }
  try {
    const entry = JSON.stringify({
      t: new Date().toISOString(),
      projectId: String(projectId),
      deltaMicro: delta.toString(),
      totalMicro: newTotal.toString(),
      ecosVersion: 'V231',
    }) + '\n';
    fs.appendFileSync(_ledgerFile_231, entry, 'utf8');
    _writeCount_231++;

    // Compaction check
    const stat = fs.statSync(_ledgerFile_231);
    const lineCount = _countLines_231();
    if (lineCount > COMPACT_THRESHOLD_231) {
      _compact_231();
    }
    return { ok: true, written: true };
  } catch (err) {
    _lastError_231 = err.message;
    return { ok: false, reason: err.message };
  }
}

// ── Compaction ────────────────────────────────────────────────────────────────
function _countLines_231() {
  try {
    const content = fs.readFileSync(_ledgerFile_231, 'utf8');
    return content.split('\n').filter(l => l.trim()).length;
  } catch (_) { return 0; }
}

/**
 * _compact_231()
 * Keeps last MAX_LEDGER_ENTRIES_231 lines; drops older entries.
 */
function _compact_231() {
  try {
    const content = fs.readFileSync(_ledgerFile_231, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length <= MAX_LEDGER_ENTRIES_231) return;
    const kept = lines.slice(lines.length - MAX_LEDGER_ENTRIES_231);
    fs.writeFileSync(_ledgerFile_231, kept.join('\n') + '\n', 'utf8');
    _compactCount_231++;
  } catch (err) {
    _lastError_231 = err.message;
  }
}

// ── Read / replay ─────────────────────────────────────────────────────────────
/**
 * replayLedger_231([limit])
 * Returns last `limit` entries from the ledger file as parsed objects.
 * Returns [] if ledger is absent or unreadable.
 */
function replayLedger_231(limit) {
  const n = typeof limit === 'number' && limit > 0 ? limit : MAX_LEDGER_ENTRIES_231;
  if (!_persistEnabled_231 && !_initAttempted_231) {
    initLedger_231();
  }
  try {
    if (!fs.existsSync(_ledgerFile_231)) return [];
    const content = fs.readFileSync(_ledgerFile_231, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    return lines.slice(-n).map(l => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  } catch (_) { return []; }
}

/**
 * rebuildSpendMap_231()
 * Reconstructs a projectId→BigInt spend Map from the ledger file.
 * Useful for restoring in-memory state after a server restart.
 * Returns { ok, spendMap, entryCount }.
 */
function rebuildSpendMap_231() {
  const entries = replayLedger_231();
  const spendMap = new Map();
  for (const e of entries) {
    if (e && e.projectId && e.totalMicro) {
      try {
        spendMap.set(e.projectId, BigInt(e.totalMicro));
      } catch (_) {}
    }
  }
  return { ok: true, spendMap, entryCount: entries.length };
}

// ── Status ────────────────────────────────────────────────────────────────────
function getLedgerStatus_231() {
  let fileSizeBytes = null;
  let lineCount = null;
  if (_persistEnabled_231) {
    try {
      fileSizeBytes = fs.statSync(_ledgerFile_231).size;
      lineCount = _countLines_231();
    } catch (_) {}
  }
  return {
    persistEnabled: _persistEnabled_231,
    ledgerFile: _ledgerFile_231,
    writeCount: _writeCount_231,
    compactCount: _compactCount_231,
    maxEntries: MAX_LEDGER_ENTRIES_231,
    fileSizeBytes,
    lineCount,
    lastError: _lastError_231,
    ecosVersion: 'V231',
  };
}

// ── Test reset ────────────────────────────────────────────────────────────────
function _resetLedgerState_231() {
  _persistEnabled_231 = false;
  _initAttempted_231  = false;
  _writeCount_231     = 0;
  _compactCount_231   = 0;
  _lastError_231      = null;
  _ledgerFile_231     = DEFAULT_LEDGER_FILE_231;
}

module.exports = {
  initLedger_231,
  appendSpend_231,
  replayLedger_231,
  rebuildSpendMap_231,
  getLedgerStatus_231,
  _resetLedgerState_231,
  _compact_231,
  MAX_LEDGER_ENTRIES_231,
  COMPACT_THRESHOLD_231,
  DEFAULT_LEDGER_FILE_231,
};
