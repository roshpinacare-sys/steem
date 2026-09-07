'use strict';
/**
 * src/lib/retryDedupTtl429.js — ECOS V429
 *
 * Feature 2: Dedup Hash TTL
 * Expire seen-hash entries after a configurable TTL.
 *
 * Functions:
 *   configureDedupTtl429(opts)                 — set dedupTtlMs
 *   sweepExpiredHashes429(seenHashesMap)       — remove expired entries from the map
 *   getDedupTtlStatus429()                     — config + stats
 *   wireRetryDedupTtl429(app, opts, auditLog)  — registers HTTP endpoints
 *
 * @version 429.0.0
 * R1: Sacred untouched. R2: All identifiers end in 429. R3: No new npm deps.
 */

const RETRY_DEDUP_TTL_VERSION429 = '429.0.0';
const DEFAULT_DEDUP_TTL_MS429 = 86400000; // 24 hours

const _dedupTtlState429 = {
  dedupTtlMs: DEFAULT_DEDUP_TTL_MS429,
  stats: {
    totalSweeps: 0,
    totalExpired: 0,
  },
};

function configureDedupTtl429(opts) {
  const o = opts || {};
  if (o.dedupTtlMs !== undefined) {
    if (typeof o.dedupTtlMs !== 'number' || o.dedupTtlMs < 0) {
      throw new Error('retryDedupTtl429: dedupTtlMs must be a non-negative number');
    }
    _dedupTtlState429.dedupTtlMs = o.dedupTtlMs;
  }
  return { ok: true, dedupTtlMs: _dedupTtlState429.dedupTtlMs };
}

function sweepExpiredHashes429(seenHashesMap) {
  if (!(seenHashesMap instanceof Map)) return { ok: false, reason: 'invalid map' };
  
  const now = Date.now();
  let expired = 0;
  
  for (const [hash, data] of seenHashesMap.entries()) {
    const firstSeen = new Date(data.firstSeenAt).getTime();
    if (now - firstSeen > _dedupTtlState429.dedupTtlMs) {
      seenHashesMap.delete(hash);
      expired++;
    }
  }
  
  _dedupTtlState429.stats.totalSweeps++;
  _dedupTtlState429.stats.totalExpired += expired;
  
  return { ok: true, expired, totalRemaining: seenHashesMap.size };
}

function getDedupTtlStatus429() {
  return {
    version: RETRY_DEDUP_TTL_VERSION429,
    dedupTtlMs: _dedupTtlState429.dedupTtlMs,
    stats: { ..._dedupTtlState429.stats },
  };
}

function wireRetryDedupTtl429(app, opts, auditLog) {
  const o = opts || {};
  if (o.dedupTtlMs) configureDedupTtl429({ dedupTtlMs: o.dedupTtlMs });

  let seenHashes = null;
  try {
    const d428 = require('./retryQueueDedup428.js');
    if (d428._dedupState428 && d428._dedupState428.seenHashes) {
      seenHashes = d428._dedupState428.seenHashes;
    }
  } catch (_) {}

  const BASE429 = '/api/v1/alerts/webhook/retry/dedup/ttl';

  app.post(BASE429 + '/sweep', (req, res) => {
    try {
      if (!seenHashes) throw new Error('retryDedupTtl429: seenHashes map not found');
      const result = sweepExpiredHashes429(seenHashes);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get(BASE429 + '/status', (req, res) => {
    try {
      res.json(getDedupTtlStatus429());
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post(BASE429 + '/configure', (req, res) => {
    try {
      const result = configureDedupTtl429(req.body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });
}

module.exports = {
  RETRY_DEDUP_TTL_VERSION429,
  configureDedupTtl429,
  sweepExpiredHashes429,
  getDedupTtlStatus429,
  wireRetryDedupTtl429,
};
