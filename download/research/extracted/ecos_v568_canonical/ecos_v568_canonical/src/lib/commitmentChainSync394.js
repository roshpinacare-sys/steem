'use strict';
/**
 * lib/commitmentChainSync394.js — ECOS V394 (Phase P282) — Commitment Chain Sync
 *
 * Direction 4 (V394): Periodic timer (configurable interval) that calls
 * buildIdentityCommitmentChain393 and appends the head hash to the audit log
 * as a commitment_chain_sync_event_type_394 event, creating a running audit
 * trail of chain head progression over time.
 *
 * Exports:
 *   createCommitmentChainSync394(opts)
 *     — { start394, stop394, runOnce394, stats394 }
 *
 * Pure JS, Node built-ins only (R3). All identifiers end with 394 (R2).
 * Sacred files untouched (R1). V361–V393 preserved (R6).
 *
 * @version 394.0.0
 */

const COMMITMENT_CHAIN_SYNC_VERSION_394  = '394.0.0';
const COMMITMENT_CHAIN_SYNC_SCHEMA_394   = 'ecos.sovereign.identity.commitment.chain.sync/v394';
const COMMITMENT_CHAIN_SYNC_EVENT_394    = 'commitment_chain_sync_event_type_394';
const COMMITMENT_CHAIN_SYNC_ERROR_EVENT_394 = 'commitment_chain_sync_error_event_type_394';

const DEFAULT_INTERVAL_MS_394 = 60 * 1000; // 1 minute
const MIN_INTERVAL_MS_394     = 5 * 1000;  // 5 seconds
const MAX_INTERVAL_MS_394     = 24 * 60 * 60 * 1000; // 24 hours

class CommitmentChainSyncError394 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'CommitmentChainSyncError394';
    this.code = code || 'SYNC_ERROR';
    this.statusCode = 500;
  }
}

/**
 * Create the commitment chain sync timer.
 *
 * @param {object} opts
 * @param {object}   opts.commitmentChain      — identityCommitmentChain393 instance
 *                                              (must expose buildIdentityCommitmentChain393())
 * @param {function} [opts.audit]              — (type, payload) => void — the append target for sync events
 * @param {object}   [opts.logger]
 * @param {number}   [opts.intervalMs]         — timer interval in ms (default: 60000)
 *                                              Overridden by ECOS_COMMIT_CHAIN_SYNC_INTERVAL_MS env
 * @param {boolean}  [opts.includePayloads]    — pass includePayloads to buildIdentityCommitmentChain393 (default: false)
 * @param {boolean}  [opts.autoStart]          — start immediately on creation (default: false)
 */
function createCommitmentChainSync394(opts = {}) {
  if (!opts.commitmentChain ||
      typeof opts.commitmentChain.buildIdentityCommitmentChain393 !== 'function') {
    throw new CommitmentChainSyncError394(
      'commitmentChainSync394: opts.commitmentChain must expose buildIdentityCommitmentChain393()',
      'BAD_CONFIG'
    );
  }

  if (!opts.audit || typeof opts.audit !== 'function') {
    throw new CommitmentChainSyncError394(
      'commitmentChainSync394: opts.audit function required to write sync events',
      'BAD_CONFIG'
    );
  }

  const commitmentChain = opts.commitmentChain;
  const audit           = opts.audit;
  const includePayloads = opts.includePayloads === true;

  const _envRaw = process.env.ECOS_COMMIT_CHAIN_SYNC_INTERVAL_MS;
  const _envMs  = _envRaw !== undefined ? parseInt(_envRaw, 10) : NaN;
  const _raw    = Number.isFinite(_envMs) && _envMs >= MIN_INTERVAL_MS_394 ? _envMs
    : (Number.isFinite(opts.intervalMs) && opts.intervalMs >= MIN_INTERVAL_MS_394 ? opts.intervalMs
       : DEFAULT_INTERVAL_MS_394);
  const intervalMs = Math.min(_raw, MAX_INTERVAL_MS_394);

  const _stats394 = {
    syncsRun:      0,
    syncsSucceeded: 0,
    syncsFailed:   0,
    lastSyncAt:    null,
    lastHeadHash:  null,
    lastChainLen:  null,
    running:       false,
  };

  let _timer = null;

  /**
   * Execute a single sync pass:
   *  1. Build the commitment chain.
   *  2. Append the head hash + length as a sync audit event.
   *
   * @returns {{ syncedAt: string, headHash: string, chainLength: number, genesisHash: string }}
   */
  function runOnce394() {
    const syncedAt = new Date().toISOString();
    _stats394.syncsRun++;

    let chainResult;
    try {
      chainResult = commitmentChain.buildIdentityCommitmentChain393({ includePayloads });
    } catch (e) {
      _stats394.syncsFailed++;
      try {
        audit(COMMITMENT_CHAIN_SYNC_ERROR_EVENT_394, {
          syncedAt, error: e.message, code: e.code || 'BUILD_ERROR', ts: syncedAt,
        });
      } catch (_) {}
      throw new CommitmentChainSyncError394(
        'commitmentChainSync394: buildIdentityCommitmentChain393 failed: ' + e.message,
        'BUILD_ERROR'
      );
    }

    const { headHash, genesisHash, length } = chainResult;
    _stats394.syncsSucceeded++;
    _stats394.lastSyncAt   = syncedAt;
    _stats394.lastHeadHash = headHash;
    _stats394.lastChainLen = length;

    try {
      audit(COMMITMENT_CHAIN_SYNC_EVENT_394, {
        syncedAt, headHash, genesisHash, chainLength: length,
        intervalMs, version: COMMITMENT_CHAIN_SYNC_VERSION_394, ts: syncedAt,
      });
    } catch (e) {
      // audit write failure is non-fatal; log but don't throw
      _stats394.syncsFailed++;
    }

    return { syncedAt, headHash, genesisHash, chainLength: length };
  }

  /**
   * Start the periodic timer.
   * Safe to call multiple times — subsequent calls are no-ops if already running.
   */
  function start394() {
    if (_timer !== null) return; // already running
    _stats394.running = true;
    _timer = setInterval(() => {
      try { runOnce394(); } catch (_) { /* errors already counted; don't crash the interval */ }
    }, intervalMs);
    // Allow Node to exit even if timer is active
    if (_timer.unref) _timer.unref();
  }

  /**
   * Stop the periodic timer.
   */
  function stop394() {
    if (_timer !== null) {
      clearInterval(_timer);
      _timer = null;
    }
    _stats394.running = false;
  }

  function stats394() {
    return {
      ..._stats394,
      intervalMs,
      includePayloads,
      version: COMMITMENT_CHAIN_SYNC_VERSION_394,
    };
  }

  if (opts.autoStart) start394();

  return {
    start394,
    stop394,
    runOnce394,
    stats394,
    COMMITMENT_CHAIN_SYNC_VERSION_394,
    COMMITMENT_CHAIN_SYNC_EVENT_394,
    COMMITMENT_CHAIN_SYNC_ERROR_EVENT_394,
  };
}

module.exports = {
  createCommitmentChainSync394,
  COMMITMENT_CHAIN_SYNC_VERSION_394,
  COMMITMENT_CHAIN_SYNC_SCHEMA_394,
  COMMITMENT_CHAIN_SYNC_EVENT_394,
  COMMITMENT_CHAIN_SYNC_ERROR_EVENT_394,
  DEFAULT_INTERVAL_MS_394,
  MIN_INTERVAL_MS_394,
  MAX_INTERVAL_MS_394,
  CommitmentChainSyncError394,
};
