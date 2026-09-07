/**
 * checkpointScheduler.js — ECOS V125
 * =====================================
 * Auto-generates signed MMR checkpoints every N new MMR leaves.
 *
 * Design:
 *  - Wraps mmrCheckpoint.generateCheckpoint().
 *  - Triggered from _snapshotLedger() after every audit append.
 *  - Interval (N) is configurable via:
 *      1. CHECKPOINT_INTERVAL env var (integer, default 50)
 *      2. checkpoint_schedule_config DB table (runtime override)
 *  - Persists generated checkpoints to mmr_checkpoints table (same as manual endpoint).
 *  - Non-fatal on any error — never blocks the main flow.
 *
 * Usage:
 *   const scheduler = getCheckpointScheduler();
 *   scheduler.setDeps({ pool, mmr, mmrCheckpointLib, agentId });
 *   // Call after every MMR append:
 *   await scheduler.tick(currentLeafCount);
 *
 * [V125-P16-05] Initial implementation
 */

'use strict';

const DEFAULT_INTERVAL = parseInt(process.env.CHECKPOINT_INTERVAL || '50', 10);

class CheckpointScheduler {
  constructor() {
    this._pool         = null;
    this._mmr          = null;
    this._lib          = null;  // mmrCheckpoint module
    this._agentId      = 'unknown';
    this._interval     = DEFAULT_INTERVAL;
    this._lastLeafCount = 0;
    this._enabled      = true;
    this._configLoaded = false;
  }

  setDeps({ pool, mmr, mmrCheckpointLib, agentId }) {
    this._pool    = pool;
    this._mmr     = mmr;
    this._lib     = mmrCheckpointLib;
    this._agentId = agentId || 'unknown';
  }

  /**
   * Load schedule config from DB (called once at startup).
   * Non-blocking, non-fatal.
   */
  async loadConfig() {
    if (!this._pool || this._configLoaded) return;
    try {
      const result = await this._pool.query(
        `SELECT checkpoint_interval, enabled
         FROM checkpoint_schedule_config
         WHERE id = 1`
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        this._interval = row.checkpoint_interval || DEFAULT_INTERVAL;
        this._enabled  = row.enabled !== false;
      }
      this._configLoaded = true;
    } catch (_) {
      // table may not exist yet (pre-migration) — use defaults
    }
  }

  /**
   * Called after every MMR leaf append.
   * Fires a checkpoint if enough new leaves have accumulated.
   *
   * @param {number} currentLeafCount — current MMR leaf count
   */
  async tick(currentLeafCount) {
    if (!this._enabled) return;
    if (!this._lib || !this._mmr) return;

    const newLeaves = currentLeafCount - this._lastLeafCount;
    if (newLeaves < this._interval) return;

    this._lastLeafCount = currentLeafCount;

    // Fire async, non-blocking
    this._generateCheckpoint().catch(() => {});
  }

  async _generateCheckpoint() {
    try {
      const cp = this._lib.generateCheckpoint(this._mmr, this._agentId);
      if (!cp) return;

      if (this._pool) {
        await this._pool.query(
          `INSERT INTO mmr_checkpoints
             (root, leaf_count, server_id, ecos_version, signature, canonical)
           VALUES ($1, $2, $3, 'V125', $4, $5)`,
          [cp.root, cp.leafCount, cp.serverId, cp.signature, cp.canonical]
        );
      }
    } catch (_) {
      // Non-fatal
    }
  }

  /**
   * Update the schedule interval at runtime (e.g. from a PUT endpoint).
   */
  async setInterval(n, persist = false) {
    if (!Number.isInteger(n) || n < 1) throw new Error('interval must be a positive integer');
    this._interval = n;
    if (persist && this._pool) {
      await this._pool.query(
        `UPDATE checkpoint_schedule_config
         SET checkpoint_interval = $1, updated_at = NOW()
         WHERE id = 1`,
        [n]
      );
    }
  }

  setEnabled(flag) {
    this._enabled = !!flag;
  }

  stats() {
    return {
      enabled:        this._enabled,
      interval:       this._interval,
      lastLeafCount:  this._lastLeafCount,
      configLoaded:   this._configLoaded,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
let _instance = null;
function getCheckpointScheduler() {
  if (!_instance) _instance = new CheckpointScheduler();
  return _instance;
}

module.exports = { CheckpointScheduler, getCheckpointScheduler };
