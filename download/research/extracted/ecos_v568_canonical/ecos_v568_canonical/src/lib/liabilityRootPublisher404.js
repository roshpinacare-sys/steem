'use strict';
/**
 * src/lib/liabilityRootPublisher404.js — ECOS V404 (Phase P292) — Liability Root Publisher
 *
 * Periodically publishes the latest liability root from V403 with a retention
 * window, so external observers can fetch a stable, time-stamped series of roots
 * without scanning the full attestation log. Read-only (R1); no new deps (R3).
 *
 * @version 404.0.0
 */

const crypto = require('crypto');

const ROOT_PUBLISHER_VERSION_404 = '404.0.0';
const _sha404 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createLiabilityRootPublisher404(opts) {
  opts = opts || {};
  const intervalMs = Number.isFinite(opts.intervalMs) ? Math.max(1, opts.intervalMs | 0) : 60_000;
  const retentionMs = Number.isFinite(opts.retentionMs) ? Math.max(intervalMs, opts.retentionMs | 0) : 24 * 3600_000;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const published = [];
  let lastTs = -Infinity;

  function publish404(attestation) {
    if (!attestation || !attestation.liabilityRoot) {
      throw new Error('attestation with liabilityRoot required');
    }
    const ts = now();
    if (ts - lastTs < intervalMs) {
      return { published: false, reason: 'before next interval', nextAtMs: lastTs + intervalMs };
    }
    const entry = {
      ts,
      liabilityRoot: attestation.liabilityRoot,
      totalLiabilities: attestation.totalLiabilities || '0',
      solvent: attestation.solvent === true,
      digest: _sha404('pub404|' + ts + '|' + attestation.liabilityRoot + '|' + (attestation.totalLiabilities || '0')),
    };
    published.push(entry);
    lastTs = ts;
    _prune404();
    return { published: true, entry };
  }

  function _prune404() {
    const cutoff = now() - retentionMs;
    while (published.length && published[0].ts < cutoff) published.shift();
  }

  function listPublished404(limit) {
    _prune404();
    const n = Number.isFinite(limit) ? Math.max(0, limit | 0) : published.length;
    return published.slice(-n).map(e => Object.assign({}, e));
  }

  function latest404() { _prune404(); return published.length ? Object.assign({}, published[published.length - 1]) : null; }

  function stats404() {
    _prune404();
    return { count: published.length, intervalMs, retentionMs, lastTs: published.length ? published[published.length - 1].ts : null };
  }

  return { publish404, listPublished404, latest404, stats404 };
}

module.exports = {
  ROOT_PUBLISHER_VERSION_404,
  createLiabilityRootPublisher404,
};
