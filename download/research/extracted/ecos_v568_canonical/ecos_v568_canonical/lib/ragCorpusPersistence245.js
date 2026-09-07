/**
 * src/lib/ragCorpusPersistence245.js — ECOS RAG Corpus Persistence (P141)
 * ─────────────────────────────────────────────────────────────────────────
 * Flush and reload the shared TF-IDF IDF corpus (from ragPipeline243) to
 * an NDJSON file so the corpus survives server restarts (warm-restart).
 *
 * Two entry points:
 *
 *   flushCorpus245(opts)   — serialize the live _idfCorpus243 + _idfDocCount243
 *                             to a local NDJSON file (one record per line).
 *                             Returns { ok, termsFlushed, docCount, filePath }.
 *
 *   loadCorpus245(opts)    — read the NDJSON file back and merge into the live
 *                             _idfCorpus243. Returns { ok, termsLoaded, docCount }.
 *
 * File format — each line is one of:
 *   { "_type": "meta", "docCount": N, "flushedAt": ISO }
 *   { "_type": "term", "term": "...", "df": N }
 *
 * Iron rules:
 *   R1 — Sacred files untouched.
 *   R2 — All new identifiers end in _245.
 *   R3 — Zero new npm deps; only Node built-ins (fs, path, os) + relative requires.
 * Mirror rule: this file is mirrored to lib/ragCorpusPersistence245.js.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Soft-require collaborators ────────────────────────────────────────────────
function _req245c(p) { try { return require(p); } catch (_) { return null; } }

const _rag243Mod   = _req245c('./ragPipeline243');
const _auditLog    = _req245c('./auditLog');

// ── Constants ─────────────────────────────────────────────────────────────────
const CORPUS_VERSION_245       = 'V245';
const CORPUS_DEFAULT_FILE_245  = path.join(os.tmpdir(), 'ecos_rag_corpus_245.ndjson');
const CORPUS_MAX_TERMS_245     = 10_000; // guard: refuse to load files with more terms

// ── Stats ─────────────────────────────────────────────────────────────────────
const _corpusStats245 = {
  flushCount:   0,
  loadCount:    0,
  lastFlushAt:  null,
  lastLoadAt:   null,
  lastFilePath: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the live _idfCorpus243 Map and _idfDocCount243 from ragPipeline243.
 * Returns null if ragPipeline243 is not loaded.
 */
function _resolveCorpus245() {
  if (!_rag243Mod) return null;
  // _idfCorpus243 is exported directly
  const idfMap    = _rag243Mod._idfCorpus243;
  const docCount  = typeof _rag243Mod._idfDocCount243 === 'number'
    ? _rag243Mod._idfDocCount243
    : 0;
  if (!(idfMap instanceof Map)) return null;
  return { idfMap, docCount };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * flushCorpus245(opts) → { ok, termsFlushed, docCount, filePath }
 *
 * opts.filePath {string} — path to write NDJSON file (default: CORPUS_DEFAULT_FILE_245)
 * opts.append   {boolean} — if true, append; otherwise overwrite (default false)
 */
function flushCorpus245(opts) {
  const o = opts || {};
  const filePath245 = String(o.filePath || CORPUS_DEFAULT_FILE_245);

  const corpus245 = _resolveCorpus245();
  if (!corpus245) {
    return { ok: false, error: 'ragPipeline243 not available', ecosVersion: CORPUS_VERSION_245 };
  }

  const { idfMap, docCount } = corpus245;
  const flag245 = o.append ? 'a' : 'w';

  try {
    const fd245 = fs.openSync(filePath245, flag245);
    // Write meta line first
    const metaLine245 = JSON.stringify({
      _type: 'meta',
      docCount,
      termCount: idfMap.size,
      flushedAt: new Date().toISOString(),
      ecosVersion: CORPUS_VERSION_245,
    }) + '\n';
    fs.writeSync(fd245, metaLine245);

    // Write one line per term
    let written245 = 0;
    for (const [term245, df245] of idfMap) {
      const line245 = JSON.stringify({ _type: 'term', term: term245, df: df245 }) + '\n';
      fs.writeSync(fd245, line245);
      written245++;
    }
    fs.closeSync(fd245);

    // Emit audit event
    if (_auditLog && typeof _auditLog.appendAuditLog === 'function') {
      try {
        _auditLog.appendAuditLog({
          event: 'RAG_CORPUS_FLUSH_245',
          termsFlushed: written245,
          docCount,
          filePath: filePath245,
          ecosVersion: CORPUS_VERSION_245,
        });
      } catch (_) {}
    }

    _corpusStats245.flushCount++;
    _corpusStats245.lastFlushAt  = new Date().toISOString();
    _corpusStats245.lastFilePath = filePath245;

    return { ok: true, termsFlushed: written245, docCount, filePath: filePath245, ecosVersion: CORPUS_VERSION_245 };
  } catch (e245f) {
    return { ok: false, error: e245f.message, filePath: filePath245, ecosVersion: CORPUS_VERSION_245 };
  }
}

/**
 * loadCorpus245(opts) → { ok, termsLoaded, docCount, merged }
 *
 * opts.filePath {string} — path to read NDJSON file (default: CORPUS_DEFAULT_FILE_245)
 * opts.merge    {boolean} — if true, merge into live corpus (default true).
 *                           If false, replace the corpus (flush existing first).
 */
function loadCorpus245(opts) {
  const o = opts || {};
  const filePath245 = String(o.filePath || CORPUS_DEFAULT_FILE_245);
  const merge245    = o.merge !== false; // default: merge

  const corpus245 = _resolveCorpus245();
  if (!corpus245) {
    return { ok: false, error: 'ragPipeline243 not available', ecosVersion: CORPUS_VERSION_245 };
  }

  if (!fs.existsSync(filePath245)) {
    return { ok: false, error: `File not found: ${filePath245}`, ecosVersion: CORPUS_VERSION_245 };
  }

  let raw245;
  try {
    raw245 = fs.readFileSync(filePath245, 'utf8');
  } catch (e245r) {
    return { ok: false, error: e245r.message, filePath: filePath245, ecosVersion: CORPUS_VERSION_245 };
  }

  const lines245    = raw245.split('\n').filter(l => l.trim());
  let metaDocCount  = 0;
  let termsLoaded   = 0;
  const { idfMap }  = corpus245;

  // Clear if replace mode
  if (!merge245) idfMap.clear();

  for (const line245 of lines245) {
    let rec245;
    try { rec245 = JSON.parse(line245); } catch (_) { continue; }
    if (!rec245 || !rec245._type) continue;
    if (rec245._type === 'meta') {
      metaDocCount = rec245.docCount || 0;
      continue;
    }
    if (rec245._type === 'term') {
      if (typeof rec245.term !== 'string' || typeof rec245.df !== 'number') continue;
      if (termsLoaded >= CORPUS_MAX_TERMS_245) break; // safety cap
      // Merge: add document frequencies
      idfMap.set(rec245.term, (idfMap.get(rec245.term) || 0) + rec245.df);
      termsLoaded++;
    }
  }

  // Bump the module-level _idfDocCount243 if accessible and we're replacing
  if (!merge245 && _rag243Mod && typeof _rag243Mod._idfDocCount243 === 'number') {
    try { _rag243Mod._idfDocCount243 = metaDocCount; } catch (_) {}
  }

  if (_auditLog && typeof _auditLog.appendAuditLog === 'function') {
    try {
      _auditLog.appendAuditLog({
        event: 'RAG_CORPUS_LOAD_245',
        termsLoaded,
        metaDocCount,
        merge: merge245,
        filePath: filePath245,
        ecosVersion: CORPUS_VERSION_245,
      });
    } catch (_) {}
  }

  _corpusStats245.loadCount++;
  _corpusStats245.lastLoadAt   = new Date().toISOString();
  _corpusStats245.lastFilePath = filePath245;

  return {
    ok: true,
    termsLoaded,
    docCount: metaDocCount,
    merged: merge245,
    filePath: filePath245,
    ecosVersion: CORPUS_VERSION_245,
  };
}

/**
 * getCorpusPersistenceStats245() — operational stats for /admin/summary endpoint.
 */
function getCorpusPersistenceStats245() {
  return Object.assign({}, _corpusStats245, { ecosVersion: CORPUS_VERSION_245 });
}

module.exports = {
  flushCorpus245,
  loadCorpus245,
  getCorpusPersistenceStats245,
  CORPUS_VERSION_245,
  CORPUS_DEFAULT_FILE_245,
  CORPUS_MAX_TERMS_245,
};

// ═══════════════════════════════════════════════════════════════════════
// V246 ADDITION — Corpus Flush Scheduler (P142, item 3)
// scheduleCorpusFlush246(intervalMs, opts) — auto-flush every intervalMs.
// Exposed via POST /api/v1/rag/corpus/schedule [V246-T05].
// ═══════════════════════════════════════════════════════════════════════

const _schedulerState246 = {
  timer:       null,
  intervalMs:  null,
  filePath:    null,
  startedAt:   null,
  flushCount:  0,
  lastFlushAt: null,
};

/**
 * scheduleCorpusFlush246(intervalMs, opts)
 *   Starts (or restarts) an auto-flush timer using setInterval(...).unref().
 *   Safe to call multiple times — cancels previous timer first.
 *
 * @param {number} intervalMs  — flush interval in ms (min 5 000; default 60 000)
 * @param {object} [opts]
 *   opts.filePath {string} — flush file path (default: CORPUS_DEFAULT_FILE_245)
 * @returns {{ ok, intervalMs, filePath, startedAt }}
 */
function scheduleCorpusFlush246(intervalMs, opts) {
  const o246s = opts || {};
  const ms246 = Math.max(5_000, Number(intervalMs) || 60_000);
  const fp246 = String(o246s.filePath || CORPUS_DEFAULT_FILE_245);

  // Cancel previous timer if running
  if (_schedulerState246.timer) {
    clearInterval(_schedulerState246.timer);
    _schedulerState246.timer = null;
  }

  const timer246 = setInterval(() => {
    const r246 = flushCorpus245({ filePath: fp246 });
    _schedulerState246.flushCount++;
    _schedulerState246.lastFlushAt = new Date().toISOString();
    // Non-fatal: ignore errors (corpus may be empty during test)
    void r246;
  }, ms246);

  // .unref() so the timer does not keep the process alive in tests
  if (timer246 && typeof timer246.unref === 'function') timer246.unref();

  _schedulerState246.timer      = timer246;
  _schedulerState246.intervalMs = ms246;
  _schedulerState246.filePath   = fp246;
  _schedulerState246.startedAt  = new Date().toISOString();

  return {
    ok:         true,
    intervalMs: ms246,
    filePath:   fp246,
    startedAt:  _schedulerState246.startedAt,
    ecosVersion: 'V246',
  };
}

/**
 * stopCorpusScheduler246() — cancel the running scheduler if any.
 * @returns {{ ok, wasRunning }}
 */
function stopCorpusScheduler246() {
  const wasRunning246 = !!_schedulerState246.timer;
  if (_schedulerState246.timer) {
    clearInterval(_schedulerState246.timer);
    _schedulerState246.timer      = null;
    _schedulerState246.intervalMs = null;
  }
  return { ok: true, wasRunning: wasRunning246, ecosVersion: 'V246' };
}

/**
 * getSchedulerStats246() — current scheduler state.
 */
function getSchedulerStats246() {
  return {
    running:     !!_schedulerState246.timer,
    intervalMs:  _schedulerState246.intervalMs,
    filePath:    _schedulerState246.filePath,
    startedAt:   _schedulerState246.startedAt,
    flushCount:  _schedulerState246.flushCount,
    lastFlushAt: _schedulerState246.lastFlushAt,
    ecosVersion: 'V246',
  };
}

// Re-export from the same module (additive; original exports unchanged)
module.exports = Object.assign(module.exports, {
  scheduleCorpusFlush246,
  stopCorpusScheduler246,
  getSchedulerStats246,
});

// ═══════════════════════════════════════════════════════════════════════
// V247 ADDITION — Corpus Scheduler Persistence (P143, item 3)
// Auto-restores scheduler config on _wireV247 from config/corpus_scheduler247.json
// ═══════════════════════════════════════════════════════════════════════

const _path247 = require('path');
const _fs247   = require('fs');

const SCHEDULER_CFG_PATH_247 = _path247.resolve(__dirname, '../../config/corpus_scheduler247.json');

/**
 * persistSchedulerConfig247(intervalMs, filePath)
 * Writes scheduler config to disk so it survives restarts.
 */
function persistSchedulerConfig247(intervalMs, filePath) {
  try {
    const cfg247 = { intervalMs, filePath, savedAt: new Date().toISOString(), ecosVersion: 'V247' };
    _fs247.writeFileSync(SCHEDULER_CFG_PATH_247, JSON.stringify(cfg247, null, 2), 'utf8');
    return { ok: true, path: SCHEDULER_CFG_PATH_247 };
  } catch (e247p) {
    return { ok: false, error: e247p.message };
  }
}

/**
 * loadSchedulerConfig247()
 * Reads persisted scheduler config. Returns null if not found or invalid.
 */
function loadSchedulerConfig247() {
  try {
    const raw247 = _fs247.readFileSync(SCHEDULER_CFG_PATH_247, 'utf8');
    const cfg247 = JSON.parse(raw247);
    if (cfg247 && typeof cfg247.intervalMs === 'number') return cfg247;
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * clearSchedulerConfig247()
 * Removes persisted config (used when scheduler is stopped explicitly).
 */
function clearSchedulerConfig247() {
  try { _fs247.unlinkSync(SCHEDULER_CFG_PATH_247); } catch (_) {}
  return { ok: true };
}

/**
 * restoreScheduler247()
 * If a persisted config exists, restarts the scheduler with saved params.
 * Called automatically from _wireV247 in the main server.
 * @returns {{ restored, intervalMs, filePath }|{ restored: false }}
 */
function restoreScheduler247() {
  const cfg247r = loadSchedulerConfig247();
  if (!cfg247r) return { restored: false, ecosVersion: 'V247' };
  // Use V246 scheduler function already in module.exports
  const result247r = scheduleCorpusFlush246(cfg247r.intervalMs, { filePath: cfg247r.filePath });
  return {
    restored:   true,
    intervalMs: cfg247r.intervalMs,
    filePath:   cfg247r.filePath,
    savedAt:    cfg247r.savedAt,
    ...result247r,
    ecosVersion: 'V247',
  };
}

// Extend module.exports additively
module.exports = Object.assign(module.exports, {
  persistSchedulerConfig247,
  loadSchedulerConfig247,
  clearSchedulerConfig247,
  restoreScheduler247,
  SCHEDULER_CFG_PATH_247,
});

// ═══════════════════════════════════════════════════════════════════════
// V248 ADDITION — Scheduler Health Endpoint (P144, item 4)
// Exposes last flush outcome, missed flushes, and next flush timing.
// ═══════════════════════════════════════════════════════════════════════

// Shared health-state record (mutated by schedulerHealthTrack248)
const _schedulerHealth248 = {
  missedFlushes:  0,
  lastFlushOk:    null,   // true/false/null (null = never flushed)
  lastFlushError: null,   // string | null
  lastFlushAt:    null,   // ISO timestamp | null
  nextFlushAt:    null,   // ISO timestamp | null (estimated)
};

/**
 * schedulerHealthTrack248(ok, error)
 * Called after each flush attempt to update health state.
 * Exported so ecos-api-server-v248-patch.js can wire it into the scheduler loop.
 */
function schedulerHealthTrack248(ok, error) {
  _schedulerHealth248.lastFlushAt = new Date().toISOString();
  _schedulerHealth248.lastFlushOk = !!ok;
  _schedulerHealth248.lastFlushError = ok ? null : (error ? String(error) : 'unknown error');
  if (!ok) _schedulerHealth248.missedFlushes++;

  // Estimate next flush time based on current scheduler interval
  const stats248h = getSchedulerStats246 ? getSchedulerStats246() : null;
  if (stats248h && stats248h.running && stats248h.intervalMs) {
    _schedulerHealth248.nextFlushAt = new Date(Date.now() + stats248h.intervalMs).toISOString();
  } else {
    _schedulerHealth248.nextFlushAt = null;
  }
}

/**
 * getSchedulerHealth248()
 * Returns { running, missedFlushes, lastFlushOk, lastFlushError, nextFlushAt }.
 */
function getSchedulerHealth248() {
  const stats248h = getSchedulerStats246 ? getSchedulerStats246() : {};
  return {
    running:        !!(stats248h && stats248h.running),
    missedFlushes:  _schedulerHealth248.missedFlushes,
    lastFlushOk:    _schedulerHealth248.lastFlushOk,
    lastFlushError: _schedulerHealth248.lastFlushError,
    lastFlushAt:    _schedulerHealth248.lastFlushAt,
    nextFlushAt:    _schedulerHealth248.nextFlushAt,
    ecosVersion:    'V248',
  };
}

// Extend module.exports additively
module.exports = Object.assign(module.exports, {
  schedulerHealthTrack248,
  getSchedulerHealth248,
  _schedulerHealth248,
});



// ─────────────────────────────────────────────────────────────────────────────
// V249 (P145): Scheduler missed-flush alert threshold
// Appended to ragCorpusPersistence245.js (mirror updated in lib/).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scheduler alert state — tracks registered alert callbacks.
 * @private
 */
const _schedulerAlert249 = {
  maxMissed:  null,
  callbacks:  [],
  triggered:  false,
};

/**
 * setSchedulerAlertThreshold249(maxMissed, callbackFn)
 *
 * Registers a callback fired when _schedulerHealth248.missedFlushes
 * reaches or exceeds maxMissed. Multiple calls accumulate callbacks.
 * Replaces the threshold value (last-write-wins on maxMissed).
 *
 * @param {number}   maxMissed  - minimum missed flushes to trigger alert
 * @param {Function} callbackFn - invoked with (missedFlushes, schedulerHealth)
 * @returns {{ ok, maxMissed, callbackCount, ecosVersion }}
 */
function setSchedulerAlertThreshold249(maxMissed, callbackFn) {
  const max249 = Number(maxMissed);
  if (isNaN(max249) || max249 < 0) {
    return { ok: false, error: 'maxMissed must be a non-negative number', ecosVersion: 'V249' };
  }
  if (typeof callbackFn !== 'function') {
    return { ok: false, error: 'callbackFn must be a function', ecosVersion: 'V249' };
  }
  _schedulerAlert249.maxMissed = max249;
  _schedulerAlert249.callbacks.push(callbackFn);
  _schedulerAlert249.triggered = false;
  return {
    ok:            true,
    maxMissed:     _schedulerAlert249.maxMissed,
    callbackCount: _schedulerAlert249.callbacks.length,
    ecosVersion:   'V249',
  };
}

/**
 * checkSchedulerAlert249()
 *
 * Called internally after each schedulerHealthTrack248 update.
 * Fires registered callbacks when missedFlushes >= maxMissed.
 * Idempotent per registration cycle (reset when threshold is re-set).
 *
 * @returns {boolean} true if alert fired in this call
 */
function checkSchedulerAlert249() {
  if (_schedulerAlert249.maxMissed === null) return false;
  if (_schedulerAlert249.callbacks.length === 0) return false;
  if (_schedulerAlert249.triggered) return false;
  let missed249 = 0;
  try {
    const h249 = typeof getSchedulerHealth248 === 'function' ? getSchedulerHealth248() : null;
    missed249 = (h249 && typeof h249.missedFlushes === 'number') ? h249.missedFlushes : 0;
  } catch (_) {}
  if (missed249 >= _schedulerAlert249.maxMissed) {
    _schedulerAlert249.triggered = true;
    let health249cb = {};
    try { health249cb = getSchedulerHealth248(); } catch (_) {}
    _schedulerAlert249.callbacks.forEach(cb => { try { cb(missed249, health249cb); } catch (_) {} });
    return true;
  }
  return false;
}

/**
 * getSchedulerAlertState249() - returns current alert registration state.
 */
function getSchedulerAlertState249() {
  return {
    maxMissed:     _schedulerAlert249.maxMissed,
    callbackCount: _schedulerAlert249.callbacks.length,
    triggered:     _schedulerAlert249.triggered,
    ecosVersion:   'V249',
  };
}

module.exports = Object.assign(module.exports, {
  setSchedulerAlertThreshold249,
  checkSchedulerAlert249,
  getSchedulerAlertState249,
  _schedulerAlert249,
});


// ─────────────────────────────────────────────────────────────────────────────
// V250 (P146): clearSchedulerAlerts250 — clear accumulated alert callbacks.
// Closes known limitation noted in NEXT_SESSION_PROMPT_V249:
// "setSchedulerAlertThreshold249 accumulates callbacks with each call (no deduplication)."
// Appended to ragCorpusPersistence245.js (mirror updated in lib/).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * clearSchedulerAlerts250()
 *
 * Resets the scheduler alert state completely: clears all accumulated callbacks,
 * resets the threshold, and clears the triggered flag.
 *
 * Use before re-registering on server restart to avoid stale callback accumulation.
 *
 * @returns {{ ok, clearedCallbacks, ecosVersion }}
 */
function clearSchedulerAlerts250() {
  const cleared250 = _schedulerAlert249.callbacks.length;
  _schedulerAlert249.callbacks = [];
  _schedulerAlert249.maxMissed = null;
  _schedulerAlert249.triggered = false;
  return {
    ok:               true,
    clearedCallbacks: cleared250,
    ecosVersion:      'V250',
  };
}

module.exports = Object.assign(module.exports, {
  clearSchedulerAlerts250,
});


// ─────────────────────────────────────────────────────────────────────────────
// V251 (P147): Wire checkSchedulerAlert249 auto-check into schedulerHealthTrack248.
// Closes the known limitation noted in NEXT_SESSION_PROMPT_V250 item 1:
// "checkSchedulerAlert249() is still not auto-called from schedulerHealthTrack248."
// Appended to ragCorpusPersistence245.js (mirror updated in lib/).
// ─────────────────────────────────────────────────────────────────────────────

// Patch schedulerHealthTrack248 to auto-call checkSchedulerAlert249 at its tail.
// We wrap the original export so callers continue to use the same reference.
(function _wireSchedulerAlertV251() {
  const _origTrack248 = module.exports.schedulerHealthTrack248;
  if (typeof _origTrack248 !== 'function') return;

  function schedulerHealthTrackV251Wired(ok, error) {
    // Original behaviour
    const result248 = _origTrack248(ok, error);
    // Auto-check: fire alert callbacks if threshold exceeded
    try {
      if (typeof module.exports.checkSchedulerAlert249 === 'function') {
        module.exports.checkSchedulerAlert249();
      }
    } catch (_) {}
    return result248;
  }

  // Replace the export while keeping the name visible for tests
  module.exports.schedulerHealthTrack248 = schedulerHealthTrackV251Wired;
  module.exports._schedulerAlertAutoWired251 = true;
})();

module.exports = Object.assign(module.exports, {
  _schedulerAlertAutoWired251: true,
});
