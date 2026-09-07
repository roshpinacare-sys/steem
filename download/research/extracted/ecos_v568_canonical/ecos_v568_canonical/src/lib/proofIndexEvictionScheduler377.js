'use strict';
/**
 * lib/proofIndexEvictionScheduler377.js — ECOS V377 (Phase P265)
 *
 * DIRECTION 1: TTL eviction scheduled via cooldown.
 *
 * Wires `evictOldEntries376` to a recurring cooldown policy so that
 * eviction runs at most once per `evictionWindowMs377` (default 6h)
 * without operator action. Mirrors the V370 `enforceDeliveryReplayCompactionPolicy370`
 * pattern, adapted for the proof index TTL eviction.
 *
 * Exports:
 *   EVICTION_SCHEDULER_VERSION_377           — '377.0.0'
 *   EVICTION_SCHEDULER_SCHEMA_377            — schema tag
 *   EVICTION_POLICY_BLOCKED_TYPE_377         — audit event type
 *   DEFAULT_EVICTION_WINDOW_MS_377           — 6 * 60 * 60 * 1000 (6h)
 *   createEvictionPolicyRepo377(opts)        — tiny file/memory-backed cooldown store
 *   enforceProofIndexEvictionPolicy377(repo, opts) — cooldown-gated eviction runner
 *
 * Endpoint: POST /api/v1/missions/proof-index/evict/policy [V377-T01]
 *
 * Pure (R3 — no new npm deps; uses Node built-ins only: fs, path, crypto).
 * All new identifiers end with 377 (R2). Sacred untouched (R1).
 * V361..V376 preserved (R6).
 *
 * @version 377.0.0
 */

const fs     = require('fs');
const path   = require('path');
const EVICT  = require('../db/proofIndexTtlEviction376.js');

const EVICTION_SCHEDULER_VERSION_377   = '377.0.0';
const EVICTION_SCHEDULER_SCHEMA_377    = 'ecos.integrity.mission.proof.index.eviction.policy/v377';
const EVICTION_POLICY_BLOCKED_TYPE_377 = 'integrity.mission.proof.index.eviction_policy_blocked377';
const DEFAULT_EVICTION_WINDOW_MS_377   = 6 * 60 * 60 * 1000; // 6 hours

const DEFAULT_POLICY_REPO_FILE_377 = 'data/proofIndexEvictionPolicy377.json';

// ── eviction policy repo ──────────────────────────────────────────────────────

function _atomicWrite377(filePath, payload) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, filePath);
}

function _safeRead377(filePath) {
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(txt);
    if (obj && typeof obj === 'object') return obj;
  } catch (_) {}
  return { schema: EVICTION_SCHEDULER_SCHEMA_377, lastRunAt: null };
}

/**
 * Create a lightweight policy repo that records the last successful
 * proof-index eviction timestamp.
 *
 * @param {{ filePath?: string, ephemeral?: boolean }} [opts]
 * @returns {{ schema: string, lastRunAt: () => string|null, recordRun: (ts: string) => void, ephemeral: boolean, filePath: string|null, _reset: () => void }}
 */
function createEvictionPolicyRepo377(opts) {
  const o = opts || {};
  const ephemeral = !!o.ephemeral;
  const filePath = ephemeral
    ? null
    : path.resolve(
        o.filePath ||
        process.env.ECOS_PROOF_INDEX_EVICTION_POLICY_FILE_377 ||
        DEFAULT_POLICY_REPO_FILE_377
      );

  let lastRun = null;
  if (filePath) {
    const persisted = _safeRead377(filePath);
    if (persisted && typeof persisted.lastRunAt === 'string') lastRun = persisted.lastRunAt;
  }

  function _flush() {
    if (!filePath) return;
    _atomicWrite377(filePath, {
      schema: EVICTION_SCHEDULER_SCHEMA_377,
      lastRunAt: lastRun,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    schema: EVICTION_SCHEDULER_SCHEMA_377,
    ephemeral,
    filePath,
    lastRunAt() { return lastRun; },
    recordRun(ts) {
      lastRun = typeof ts === 'string' ? ts : new Date().toISOString();
      _flush();
    },
    _reset() {
      lastRun = null;
      if (filePath) {
        try { fs.unlinkSync(filePath); } catch (_) {}
      }
    },
  };
}

// ── enforceProofIndexEvictionPolicy377 ───────────────────────────────────────

/**
 * Cooldown-gated eviction: runs `evictOldEntries376` at most once per
 * `opts.evictionWindowMs` (default 6h). Suppressed calls emit a
 * `EVICTION_POLICY_BLOCKED_TYPE_377` audit event and return
 * `{ blocked: true }`. Successful runs delegate to V376 and record the
 * timestamp in the policy repo.
 *
 * @param {object} proofIndexRepo  — MissionProofIndexRepo374 or DB adapter
 * @param {{
 *   evictionWindowMs?: number,
 *   ttlMs?: number,
 *   dryRun?: boolean,
 *   now?: number,
 *   auditLog?: object,
 *   evictionPolicyRepo?: object,
 * }} [opts]
 * @returns {Promise<object>}  eviction summary with `blocked` flag
 */
async function enforceProofIndexEvictionPolicy377(proofIndexRepo, opts) {
  const o          = opts || {};
  const now        = (typeof o.now === 'number') ? o.now : Date.now();
  const windowMs   = (typeof o.evictionWindowMs === 'number' && o.evictionWindowMs >= 0)
    ? o.evictionWindowMs
    : (Number(process.env.ECOS_PROOF_INDEX_EVICTION_WINDOW_MS_377) || DEFAULT_EVICTION_WINDOW_MS_377);
  const policyRepo = o.evictionPolicyRepo || null;
  const auditLog   = o.auditLog || null;

  const baseSummary = {
    schema:           EVICTION_SCHEDULER_SCHEMA_377,
    evictionWindowMs: windowMs,
    ts:               new Date(now).toISOString(),
    version:          EVICTION_SCHEDULER_VERSION_377,
  };

  // Check cooldown
  if (policyRepo && typeof policyRepo.lastRunAt === 'function') {
    let lastRunMs = NaN;
    try { lastRunMs = Date.parse(policyRepo.lastRunAt() || ''); } catch (_) { lastRunMs = NaN; }
    if (Number.isFinite(lastRunMs) && (now - lastRunMs) < windowMs) {
      const nextEligibleAt = new Date(lastRunMs + windowMs).toISOString();
      const blocked = Object.assign({}, baseSummary, {
        blocked:         true,
        evicted:         0,
        reason:          'cooldown active',
        lastRunAt:       new Date(lastRunMs).toISOString(),
        nextEligibleAt,
      });
      if (auditLog && typeof auditLog.append === 'function') {
        try {
          auditLog.append(EVICTION_POLICY_BLOCKED_TYPE_377, {
            evictionWindowMs: windowMs,
            lastRunAt:        blocked.lastRunAt,
            nextEligibleAt,
            ts:               blocked.ts,
          });
        } catch (_) {}
      }
      return blocked;
    }
  }

  // Run the V376 eviction
  const evictResult = await EVICT.evictOldEntries376(proofIndexRepo, {
    ttlMs:    o.ttlMs,
    dryRun:   o.dryRun === true,
    auditLog,
    now,
  });

  // Record successful run (even in dryRun — scheduler still ticks)
  if (policyRepo && typeof policyRepo.recordRun === 'function') {
    try { policyRepo.recordRun(new Date(now).toISOString()); } catch (_) {}
  }

  return Object.assign({}, evictResult, {
    blocked:          false,
    evictionWindowMs: windowMs,
    policyEnforced:   !!policyRepo,
    version:          EVICTION_SCHEDULER_VERSION_377,
  });
}

module.exports = {
  EVICTION_SCHEDULER_VERSION_377,
  EVICTION_SCHEDULER_SCHEMA_377,
  EVICTION_POLICY_BLOCKED_TYPE_377,
  DEFAULT_EVICTION_WINDOW_MS_377,
  createEvictionPolicyRepo377,
  enforceProofIndexEvictionPolicy377,
};
