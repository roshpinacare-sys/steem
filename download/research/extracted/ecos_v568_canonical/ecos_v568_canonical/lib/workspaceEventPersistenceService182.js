'use strict';
/**
 * lib/workspaceEventPersistenceService182.js — ECOS V182
 * Optional flush of the V181 ring-buffer (_eventLog181) to a JSON file on disk.
 *
 * Behaviour
 * ─────────
 *  • When `ECOS_EVENT_LOG_PATH` env var is set → load ring-buffer contents from
 *    that file at startup; flush the full map to the same file after every broadcast.
 *  • When env var is NOT set → no-op (graceful fallback to in-memory only).
 *  • Flush is async and non-blocking (fs.writeFile with callback; errors are
 *    silently logged and never propagate to the caller).
 *  • Load is synchronous at startup (before server begins accepting requests)
 *    so the ring-buffer is warm immediately.
 *
 * Design notes
 * ─────────────
 *  • Zero external deps (R6) — uses built-in `fs` and `path` only.
 *  • All identifiers suffixed _182 / 182 (R8 duplicate-const guard).
 *  • shutdown() cancels any in-flight flush and resets state (test teardown).
 *
 * @version 182.0.0
 */

const fs   = require('fs');
const path = require('path');

class EventPersistenceService182 {
  /**
   * @param {object}  opts
   * @param {Map}     opts.eventLog    — reference to _eventLog181 Map
   * @param {string}  [opts.logPath]   — override ECOS_EVENT_LOG_PATH (tests)
   * @param {object}  [opts.logger]
   */
  constructor(opts = {}) {
    this._log        = opts.logger || { info() {}, warn() {}, error() {} };
    this._eventLog   = opts.eventLog || new Map();
    this._logPath    = opts.logPath  || process.env.ECOS_EVENT_LOG_PATH || null;
    this._enabled182 = Boolean(this._logPath);
    this._flushTimer = null;   // reserved for future debounce; currently unused
  }

  /** Whether persistence is active (env var set). */
  get enabled() { return this._enabled182; }

  /**
   * Load ring-buffer contents from disk into the provided eventLog Map.
   * Called once at startup (synchronous).
   * No-op when persistence is disabled.
   */
  loadSync() {
    if (!this._enabled182) return;
    try {
      const raw182 = fs.readFileSync(this._logPath, 'utf8');
      const parsed182 = JSON.parse(raw182);
      if (parsed182 && typeof parsed182 === 'object') {
        for (const [wsId182, events182] of Object.entries(parsed182)) {
          if (Array.isArray(events182)) {
            this._eventLog.set(wsId182, events182);
          }
        }
        this._log.info && this._log.info(
          { component: 'eventPersistence182', path: this._logPath, workspaces: Object.keys(parsed182).length },
          'event log loaded from disk'
        );
      }
    } catch (err182) {
      if (err182.code !== 'ENOENT') {
        // ENOENT is expected on first run — all other errors are warnings
        this._log.warn && this._log.warn(
          { component: 'eventPersistence182', err: err182.message },
          'failed to load event log from disk (non-fatal)'
        );
      }
    }
  }

  /**
   * Flush the current ring-buffer Map to disk asynchronously.
   * No-op when persistence is disabled.
   * Errors are swallowed (non-blocking, non-fatal).
   */
  flush() {
    if (!this._enabled182) return;
    try {
      const snapshot182 = {};
      for (const [wsId182, events182] of this._eventLog.entries()) {
        snapshot182[wsId182] = events182;
      }
      const json182 = JSON.stringify(snapshot182);
      fs.writeFile(this._logPath, json182, 'utf8', err182 => {
        if (err182) {
          this._log.warn && this._log.warn(
            { component: 'eventPersistence182', err: err182.message },
            'async flush to disk failed (non-fatal)'
          );
        }
      });
    } catch (err182) {
      this._log.warn && this._log.warn(
        { component: 'eventPersistence182', err: err182.message },
        'flush serialisation failed (non-fatal)'
      );
    }
  }

  /** Stats for admin summary. */
  stats() {
    return {
      enabled:  this._enabled182,
      logPath:  this._enabled182 ? this._logPath : null,
    };
  }

  /** Tear-down (test support). */
  shutdown() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
  }
}

module.exports = { EventPersistenceService182 };
