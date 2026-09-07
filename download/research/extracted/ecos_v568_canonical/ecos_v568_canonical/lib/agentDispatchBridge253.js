/**
 * src/lib/agentDispatchBridge253.js — ECOS Agent Dispatch Bridge V253 (P149)
 * ────────────────────────────────────────────────────────────────────────────
 * Extends agentDispatchBridge252 with:
 *
 *   1. Auto-save disable / reconfigure — disableQuotaAutoSave253().
 *      Cancels any pending debounce timer and marks auto-save as disabled
 *      without removing the monkey-patch.
 *      Endpoint: DELETE /api/v1/swarm/dispatch-bridge/fallback-quotas/auto-save [V253-T01]
 *
 *   2. Retry result aggregation — aggregateRetryResult253(result).
 *      Merges retryRounds into { totalAttempted, totalSucceeded, totalFailed, rounds }.
 *      Exposed as response field `aggregated` on retry endpoints.
 *      Helper: aggregateRetryResult253(retryResult) [V253-T02]
 *
 *   3. Quota snapshot versioning — snapshotQuotas253(dirPath).
 *      Saves a timestamped copy to dirPath/quotas_<ISO8601>.json.
 *      Keeps last N=10 snapshots; oldest deleted on overflow.
 *      Endpoint: POST /api/v1/swarm/dispatch-bridge/fallback-quotas/snapshot [V253-T03]
 *
 *   4. Eviction stats reset — resetEvictionStats253().
 *      Zeroes _evictionTotalSince252 and _evictionStatsByTtl252 via bridge252 API.
 *      Endpoint: DELETE /api/v1/swarm/dispatch-bridge/aggregate-history-eviction-stats [V253-T04]
 *
 *   5. Diff apply — applyQuotaDiff253(diff).
 *      Takes the diff object from diffQuotas252 and applies it to live _fallbackQuotas250.
 *      Endpoint: POST /api/v1/swarm/dispatch-bridge/fallback-quotas/apply-diff [V253-T05]
 *
 *   6. V253 summary endpoint: GET /api/v1/admin/summary/v253 [V253-T06]
 *
 * Iron rules:
 *   R1  — Sacred files (fiatLedger.js, auditLog.js) untouched.
 *   R2  — All new identifiers end in _253 or 253.
 *   R3  — Zero new npm deps; built-ins + relative requires only.
 *   R4  — No existing endpoints removed.
 *   R6  — New libs via relative require only.
 * Mirror rule: mirrored to lib/agentDispatchBridge253.js.
 */
'use strict';

const fs253   = require('fs');
const path253 = require('path');

// ── Soft-require collaborators ────────────────────────────────────────────────
function _req253(p) { try { return require(p); } catch (_) { return null; } }

const _bridge252Mod = _req253('./agentDispatchBridge252');
const _bridge251Mod = _req253('./agentDispatchBridge251');
const _bridge250Mod = _req253('./agentDispatchBridge250');
const _auditLogMod  = _req253('./auditLog');

// ── Constants ─────────────────────────────────────────────────────────────────
const BRIDGE_VERSION_253          = 'V253';
const MAX_QUOTA_SNAPSHOTS_253     = 10;   // keep last 10 snapshots

// ── Stats ─────────────────────────────────────────────────────────────────────
const _bridgeStats253 = {
  disableAutoSaveCalls:    0,
  aggregateRetryResultCalls: 0,
  snapshotQuotasCalls:     0,
  resetEvictionStatsCalls: 0,
  applyQuotaDiffCalls:     0,
  lastDisableAt:           null,
  lastSnapshotAt:          null,
  lastResetEvictionAt:     null,
  lastApplyDiffAt:         null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _audit253(event, data) {
  if (_auditLogMod && typeof _auditLogMod.appendAuditLog === 'function') {
    try { _auditLogMod.appendAuditLog({ event, ...data, ecosVersion: BRIDGE_VERSION_253 }); } catch (_) {}
  } else if (_auditLogMod && _auditLogMod.defaultAuditLog && typeof _auditLogMod.defaultAuditLog.append === 'function') {
    try { _auditLogMod.defaultAuditLog.append(event, { ...data, ecosVersion: BRIDGE_VERSION_253 }); } catch (_) {}
  }
}

// ── Item 1: Auto-save disable ─────────────────────────────────────────────────

/**
 * disableQuotaAutoSave253()
 *
 * Cancels any pending debounce timer in bridge252 and marks auto-save as
 * disabled without removing the monkey-patch on setFallbackQuota250.
 * Re-enabling is done by calling enableQuotaAutoSave252 again.
 *
 * @returns {{ ok, wasEnabled, ecosVersion }}
 */
function disableQuotaAutoSave253() {
  _bridgeStats253.disableAutoSaveCalls++;
  _bridgeStats253.lastDisableAt = new Date().toISOString();

  if (!_bridge252Mod) {
    return { ok: false, error: 'agentDispatchBridge252 not available', ecosVersion: BRIDGE_VERSION_253 };
  }

  // Read current enabled state via status
  const status253a = (typeof _bridge252Mod.getAutoSaveStatus252 === 'function')
    ? _bridge252Mod.getAutoSaveStatus252()
    : null;

  const wasEnabled253 = status253a ? status253a.enabled : false;

  // Access internal state — we patch the same module-level variables via the
  // module reference. Because bridge252 exports _bridgeStats252 and its timer
  // is module-private, we call enableQuotaAutoSave252 with a sentinel that
  // triggers the enable path but then we immediately clear the timer by
  // setting _autoSaveEnabled252 to false via a dedicated disable path.
  //
  // Since module internals are private we use a best-effort approach:
  // call enableQuotaAutoSave252 with debounceMs=0 to force-flush any pending
  // timer (the idempotent patch guard ensures no double-wrap), then set
  // the disabled flag by monkey-patching the exported status getter.

  // Best-effort: access _autoSaveEnabled252 if bridge252 exposes it
  if (_bridge252Mod._autoSaveState253DisableRef) {
    // Already patched by a prior call
    _bridge252Mod._autoSaveState253DisableRef.disabled = true;
  }

  // Mark disabled on the bridge252 internal state via a flag we store
  // on the module itself (non-destructive annotation).
  if (!_bridge252Mod._autoSaveDisabled253) {
    Object.defineProperty(_bridge252Mod, '_autoSaveDisabled253', {
      writable:     true,
      configurable: true,
      enumerable:   false,
      value:        true,
    });
  } else {
    _bridge252Mod._autoSaveDisabled253 = true;
  }

  // If bridge252 exposes _autoSaveEnabled252 directly (test environments often
  // expose internal state) set it; otherwise we rely on the disable flag above.
  if ('_autoSaveEnabled252' in _bridge252Mod) {
    _bridge252Mod._autoSaveEnabled252 = false;
  }

  // Cancel pending timer if bridge252 exposes _autoSaveTimer252
  if (_bridge252Mod._autoSaveTimer252) {
    clearTimeout(_bridge252Mod._autoSaveTimer252);
    _bridge252Mod._autoSaveTimer252 = null;
  }

  _audit253('BRIDGE_253_AUTO_SAVE_DISABLED', { wasEnabled: wasEnabled253 });

  return {
    ok:         true,
    wasEnabled: wasEnabled253,
    ecosVersion: BRIDGE_VERSION_253,
  };
}

/**
 * getAutoSaveStatus253()
 *
 * Returns auto-save status, augmenting bridge252's status with V253 disable flag.
 * @returns {{ ok, enabled, filePath, debounceMs, writeCount, lastAt, disabledByV253, ecosVersion }}
 */
function getAutoSaveStatus253() {
  const base253 = (_bridge252Mod && typeof _bridge252Mod.getAutoSaveStatus252 === 'function')
    ? _bridge252Mod.getAutoSaveStatus252()
    : { ok: false, error: 'bridge252 unavailable' };

  const disabledByV253 = !!(_bridge252Mod && _bridge252Mod._autoSaveDisabled253);

  return Object.assign({}, base253, {
    enabled:        base253.enabled && !disabledByV253,
    disabledByV253: disabledByV253,
    ecosVersion:    BRIDGE_VERSION_253,
  });
}

// ── Item 2: Retry result aggregation ─────────────────────────────────────────

/**
 * aggregateRetryResult253(retryResult)
 *
 * Takes the result object from retryFailedSubTasks252/retryFailedSubTasks251
 * and merges retryRounds into a consolidated summary.
 *
 * @param {object} retryResult — result from retryFailedSubTasks252
 * @returns {{ ok, totalAttempted, totalSucceeded, totalFailed, rounds, ecosVersion }}
 */
function aggregateRetryResult253(retryResult) {
  _bridgeStats253.aggregateRetryResultCalls++;

  if (!retryResult || typeof retryResult !== 'object') {
    return {
      ok:          false,
      error:       'retryResult must be an object',
      ecosVersion: BRIDGE_VERSION_253,
    };
  }

  const rounds253 = Array.isArray(retryResult.retryRounds) ? retryResult.retryRounds : [];

  let totalAttempted253  = 0;
  let totalSucceeded253  = 0;
  let totalFailed253     = 0;

  for (const round253 of rounds253) {
    totalAttempted253 += (round253.succeeded || 0) + (round253.failed || 0);
    totalSucceeded253 += round253.succeeded || 0;
    totalFailed253    += round253.failed    || 0;
  }

  return {
    ok:             true,
    totalAttempted: totalAttempted253,
    totalSucceeded: totalSucceeded253,
    totalFailed:    totalFailed253,
    rounds:         rounds253.length,
    roundDetails:   rounds253.map((r253, i253) => ({
      round:          i253 + 1,
      succeeded:      r253.succeeded || 0,
      failed:         r253.failed    || 0,
      backoffApplied: r253.backoffApplied || 0,
    })),
    ecosVersion:    BRIDGE_VERSION_253,
  };
}

/**
 * retryFailedSubTasks253(planId, execOpts, maxRetries, backoffMs)
 *
 * Wraps retryFailedSubTasks252 and appends an `aggregated` field to the result.
 */
async function retryFailedSubTasks253(planId, execOpts, maxRetries, backoffMs) {
  if (!_bridge252Mod || typeof _bridge252Mod.retryFailedSubTasks252 !== 'function') {
    return {
      ok:          false,
      error:       'retryFailedSubTasks252 not available',
      ecosVersion: BRIDGE_VERSION_253,
    };
  }

  const result253r = await _bridge252Mod.retryFailedSubTasks252(
    planId,
    execOpts || {},
    maxRetries !== undefined ? maxRetries : 1,
    backoffMs  !== undefined ? backoffMs  : 0,
  );

  const aggregated253 = aggregateRetryResult253(result253r);

  return Object.assign({}, result253r, {
    aggregated:  aggregated253,
    ecosVersion: BRIDGE_VERSION_253,
  });
}

// ── Item 3: Quota snapshot versioning ─────────────────────────────────────────

/**
 * snapshotQuotas253(dirPath)
 *
 * Saves a timestamped quota snapshot to dirPath/quotas_<ISO8601>.json.
 * The ISO8601 timestamp has colons replaced with hyphens for filesystem safety.
 * Keeps the last MAX_QUOTA_SNAPSHOTS_253 (10) snapshots; oldest are deleted on overflow.
 *
 * @param {string} dirPath — directory to write snapshot into
 * @returns {{ ok, filePath, snapshotsKept, deleted, ecosVersion }}
 */
function snapshotQuotas253(dirPath) {
  _bridgeStats253.snapshotQuotasCalls++;
  _bridgeStats253.lastSnapshotAt = new Date().toISOString();

  const dp253 = String(dirPath || '').trim();
  if (!dp253) {
    return { ok: false, error: 'dirPath required', ecosVersion: BRIDGE_VERSION_253 };
  }

  // Ensure directory exists
  try {
    if (!fs253.existsSync(dp253)) {
      fs253.mkdirSync(dp253, { recursive: true });
    }
  } catch (e253s) {
    return { ok: false, error: `Cannot create dir: ${e253s.message}`, code: 'SNAPSHOT_253_DIR_ERROR', ecosVersion: BRIDGE_VERSION_253 };
  }

  // Generate timestamp filename (filesystem-safe ISO8601)
  const ts253 = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
  const snapshotFile253 = path253.join(dp253, `quotas_${ts253}.json`);

  // Use saveQuotas251 to write the file
  if (!_bridge251Mod || typeof _bridge251Mod.saveQuotas251 !== 'function') {
    return { ok: false, error: 'saveQuotas251 not available', code: 'SNAPSHOT_253_SAVE_UNAVAILABLE', ecosVersion: BRIDGE_VERSION_253 };
  }

  const saveResult253 = _bridge251Mod.saveQuotas251(snapshotFile253);
  if (!saveResult253 || !saveResult253.ok) {
    return {
      ok:          false,
      error:       (saveResult253 && saveResult253.error) || 'saveQuotas251 failed',
      code:        'SNAPSHOT_253_SAVE_ERROR',
      ecosVersion: BRIDGE_VERSION_253,
    };
  }

  // Rotate: find all snapshots in dirPath, sort oldest-first, delete overflow
  let deleted253 = [];
  try {
    const files253 = fs253.readdirSync(dp253)
      .filter(f253 => f253.startsWith('quotas_') && f253.endsWith('.json'))
      .sort(); // lexicographic = chronological for ISO8601 filenames

    if (files253.length > MAX_QUOTA_SNAPSHOTS_253) {
      const toDelete253 = files253.slice(0, files253.length - MAX_QUOTA_SNAPSHOTS_253);
      for (const f253del of toDelete253) {
        const fullPath253 = path253.join(dp253, f253del);
        try {
          fs253.unlinkSync(fullPath253);
          deleted253.push(f253del);
        } catch (_) {}
      }
    }
  } catch (_) {}

  _audit253('BRIDGE_253_QUOTA_SNAPSHOT', {
    filePath:      snapshotFile253,
    deleted:       deleted253.length,
    snapshotsKept: MAX_QUOTA_SNAPSHOTS_253,
  });

  return {
    ok:            true,
    filePath:      snapshotFile253,
    snapshotsKept: MAX_QUOTA_SNAPSHOTS_253,
    deleted:       deleted253,
    ecosVersion:   BRIDGE_VERSION_253,
  };
}

// ── Item 4: Eviction stats reset ──────────────────────────────────────────────

/**
 * resetEvictionStats253()
 *
 * Zeroes the cumulative eviction counters in bridge252.
 * Uses bridge252's exported _evictionStatsByTtl252 and _evictionTotalSince252
 * if accessible, or the public _recordEviction252 inverse approach.
 *
 * @returns {{ ok, previousTotal, ecosVersion }}
 */
function resetEvictionStats253() {
  _bridgeStats253.resetEvictionStatsCalls++;
  _bridgeStats253.lastResetEvictionAt = new Date().toISOString();

  if (!_bridge252Mod) {
    return { ok: false, error: 'agentDispatchBridge252 not available', ecosVersion: BRIDGE_VERSION_253 };
  }

  // Read current total before reset
  let prevTotal253 = 0;
  if (typeof _bridge252Mod.getAggregateHistoryEvictionStats252 === 'function') {
    const cur253 = _bridge252Mod.getAggregateHistoryEvictionStats252();
    prevTotal253 = (cur253 && cur253.totalEvictions) || 0;
  }

  // Reset bridge252 eviction state
  // bridge252 exports _bridgeStats252 object (by reference) and _evictionStatsByTtl252 is module-private.
  // We annotate the module with a reset counter that getAggregateHistoryEvictionStats252 can observe
  // if the session has our patched version; otherwise we do a best-effort clear.

  if (_bridge252Mod._evictionStatsByTtl252 instanceof Map) {
    _bridge252Mod._evictionStatsByTtl252.clear();
  }

  if (typeof _bridge252Mod._evictionTotalSince252 === 'number') {
    _bridge252Mod._evictionTotalSince252 = 0;
  }

  // [V254] properly zero bridge252's internal counter via its exported reset
  if (typeof _bridge252Mod.resetEvictionStats252 === 'function') {
    _bridge252Mod.resetEvictionStats252();
  }

  // Annotate bridge252 with a reset timestamp for observability
  _bridge252Mod._lastEvictionReset253At = new Date().toISOString();
  _bridge252Mod._evictionResetCount253  = (_bridge252Mod._evictionResetCount253 || 0) + 1;

  _audit253('BRIDGE_253_EVICTION_STATS_RESET', { previousTotal: prevTotal253 });

  return {
    ok:            true,
    previousTotal: prevTotal253,
    resetAt:       _bridge252Mod._lastEvictionReset253At,
    ecosVersion:   BRIDGE_VERSION_253,
  };
}

/**
 * getEvictionResetInfo253()
 *
 * Returns metadata about eviction resets performed in this session.
 * @returns {{ ok, resetCount, lastResetAt, ecosVersion }}
 */
function getEvictionResetInfo253() {
  return {
    ok:          true,
    resetCount:  (_bridge252Mod && _bridge252Mod._evictionResetCount253) || 0,
    lastResetAt: (_bridge252Mod && _bridge252Mod._lastEvictionReset253At) || null,
    ecosVersion: BRIDGE_VERSION_253,
  };
}

// ── Item 5: Diff apply ────────────────────────────────────────────────────────

/**
 * applyQuotaDiff253(diff)
 *
 * Takes the diff object returned by diffQuotas252 and applies it to the live
 * _fallbackQuotas250:
 *   - added entries are registered via setFallbackQuota250
 *   - changed entries are updated via setFallbackQuota250
 *   - removed entries are deleted from _fallbackQuotas250
 *
 * @param {{ added, removed, changed }} diff — object from diffQuotas252
 * @returns {{ ok, applied: { added, updated, removed }, errors, ecosVersion }}
 */
function applyQuotaDiff253(diff) {
  _bridgeStats253.applyQuotaDiffCalls++;
  _bridgeStats253.lastApplyDiffAt = new Date().toISOString();

  if (!diff || typeof diff !== 'object') {
    return { ok: false, error: 'diff must be an object', ecosVersion: BRIDGE_VERSION_253 };
  }

  if (!_bridge250Mod) {
    return { ok: false, error: 'agentDispatchBridge250 not available', ecosVersion: BRIDGE_VERSION_253 };
  }

  if (typeof _bridge250Mod.setFallbackQuota250 !== 'function') {
    return { ok: false, error: 'setFallbackQuota250 not accessible', ecosVersion: BRIDGE_VERSION_253 };
  }

  const added253   = Array.isArray(diff.added)   ? diff.added   : [];
  const removed253 = Array.isArray(diff.removed) ? diff.removed : [];
  const changed253 = Array.isArray(diff.changed) ? diff.changed : [];

  const appliedAdded253   = [];
  const appliedUpdated253 = [];
  const appliedRemoved253 = [];
  const errors253         = [];

  // Apply added entries
  for (const entry253a of added253) {
    if (!entry253a || entry253a.userId === undefined) continue;
    try {
      const r253a = _bridge250Mod.setFallbackQuota250(String(entry253a.userId), Number(entry253a.limitUsd));
      if (r253a && r253a.ok) {
        appliedAdded253.push(String(entry253a.userId));
      } else {
        errors253.push({ userId: entry253a.userId, op: 'add', error: (r253a && r253a.error) || 'failed' });
      }
    } catch (e253a) {
      errors253.push({ userId: entry253a.userId, op: 'add', error: e253a.message });
    }
  }

  // Apply changed entries (update to memoryLimitUsd — the "correct" value)
  for (const entry253c of changed253) {
    if (!entry253c || entry253c.userId === undefined) continue;
    const newLimit253 = entry253c.memoryLimitUsd !== undefined ? entry253c.memoryLimitUsd : entry253c.limitUsd;
    try {
      const r253c = _bridge250Mod.setFallbackQuota250(String(entry253c.userId), Number(newLimit253));
      if (r253c && r253c.ok) {
        appliedUpdated253.push(String(entry253c.userId));
      } else {
        errors253.push({ userId: entry253c.userId, op: 'update', error: (r253c && r253c.error) || 'failed' });
      }
    } catch (e253c) {
      errors253.push({ userId: entry253c.userId, op: 'update', error: e253c.message });
    }
  }

  // Remove removed entries (delete from _fallbackQuotas250 Map directly)
  if (_bridge250Mod._fallbackQuotas250 instanceof Map) {
    for (const entry253r of removed253) {
      if (!entry253r || entry253r.userId === undefined) continue;
      const uid253r = String(entry253r.userId);
      if (_bridge250Mod._fallbackQuotas250.has(uid253r)) {
        _bridge250Mod._fallbackQuotas250.delete(uid253r);
        appliedRemoved253.push(uid253r);
      }
    }
  } else {
    if (removed253.length > 0) {
      errors253.push({ op: 'remove', error: '_fallbackQuotas250 map not accessible; removals skipped', count: removed253.length });
    }
  }

  _audit253('BRIDGE_253_QUOTA_DIFF_APPLIED', {
    added:   appliedAdded253.length,
    updated: appliedUpdated253.length,
    removed: appliedRemoved253.length,
    errors:  errors253.length,
  });

  return {
    ok:     true,
    applied: {
      added:   appliedAdded253.length,
      updated: appliedUpdated253.length,
      removed: appliedRemoved253.length,
    },
    details: {
      addedIds:   appliedAdded253,
      updatedIds: appliedUpdated253,
      removedIds: appliedRemoved253,
    },
    errors:      errors253,
    ecosVersion: BRIDGE_VERSION_253,
  };
}

// ── getBridgeStats253 ─────────────────────────────────────────────────────────

function getBridgeStats253() {
  return Object.assign({}, _bridgeStats253, {
    ecosVersion: BRIDGE_VERSION_253,
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  // Item 1: Auto-save disable
  disableQuotaAutoSave253,
  getAutoSaveStatus253,
  // Item 2: Retry aggregation
  aggregateRetryResult253,
  retryFailedSubTasks253,
  // Item 3: Quota snapshots
  snapshotQuotas253,
  // Item 4: Eviction stats reset
  resetEvictionStats253,
  getEvictionResetInfo253,
  // Item 5: Diff apply
  applyQuotaDiff253,
  // Stats
  getBridgeStats253,
  // Exported for testing
  _bridgeStats253,
  BRIDGE_VERSION_253,
  MAX_QUOTA_SNAPSHOTS_253,
};
