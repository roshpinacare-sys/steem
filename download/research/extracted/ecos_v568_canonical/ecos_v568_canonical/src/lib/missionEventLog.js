/**
 * ECOS MissionEventLog — Append-Only Mission Event Sourcing System [V97/V99]
 * --------------------------------------------------------------------------
 * Stores a structured, ordered log of all meaningful events that occur
 * within a mission's lifecycle. Provides a queryable audit trail for
 * compliance, debugging, and real-time UI display on the chain explorer.
 *
 * Design decisions:
 *   - In-memory Map for fast reads; optional NDJSON file persistence [V99].
 *   - Events are immutable once appended. No update/delete.
 *   - Cursor-based pagination on listForMission and listRecent.
 *   - Thread-safe: synchronous JS, no shared state conflicts.
 *   - Rotation: when file exceeds 10 MB it is renamed to events.ndjson.1
 *     and a fresh events.ndjson is started. [V99]
 *
 * Event schema:
 *   {
 *     id:        string  — monotonic "mev_<seq>" — stable, URL-safe
 *     missionId: string
 *     type:      string  — e.g. 'task.created', 'gate.evaluated', 'approval.created'
 *     actor:     string|null  — system component or accountId that caused the event
 *     data:      object|null  — event-type-specific payload (sanitized — no secrets)
 *     ts:        string  — ISO 8601 timestamp
 *     seq:       number  — per-mission sequence number, 1-based
 *   }
 *
 * Standard event types (callers should prefer these):
 *   task.created         — new task POSTed to /api/v1/task
 *   gate.evaluated       — HITL gate made an AUTO or HITL_QUEUE decision
 *   approval.created     — new approval record created in HitlGate
 *   approval.resolved    — approval approved/rejected/modified
 *   ledger.credited      — ledger entry recorded for a split payment
 *   mission.completed    — all approvals resolved, mission is done
 *   event.custom         — caller-supplied arbitrary event (POST endpoint)
 *   routing.assigned     — validator router assigned a task [V99]
 *
 * Usage (in-memory, backward-compatible):
 *   const log = new MissionEventLog();
 *
 * Usage (with NDJSON persistence, production):
 *   const log = new MissionEventLog(path.join(__dirname, 'data'));
 *
 * [V97] New system. No external dependencies.
 * [V99] NDJSON file persistence: write-ahead append, startup reload, rotation.
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

// Rotation threshold: 10 MB
const ROTATE_BYTES = 10 * 1024 * 1024;

// Global sequence counter for id uniqueness across all missions
let _globalSeq = 0;

class MissionEventLog {
  /**
   * @param {string|null} [dataDir]  — If provided AND NODE_ENV !== 'test',
   *   enables NDJSON file persistence under dataDir/events.ndjson.
   *   Pass null (default) for pure in-memory mode (tests, etc.).
   */
  constructor(dataDir = null) {
    // Map<missionId, Event[]>  — arrays are sorted ascending by seq
    this._byMission = new Map();
    // Flat global array for listRecent() — references same objects
    this._globalLog = [];
    // NDJSON file path (null = in-memory only)
    this._filePath  = null;

    if (dataDir && process.env.NODE_ENV !== 'test') {
      this._filePath = path.join(dataDir, 'events.ndjson');
      // Ensure directory exists
      try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
      // Rotate if oversized before loading
      this._rotateIfNeeded();
      // Reload existing events
      this._loadFromDisk();
    }
  }

  // ── _rotateIfNeeded ───────────────────────────────────────────────────────
  _rotateIfNeeded() {
    if (!this._filePath) return;
    try {
      const stat = fs.statSync(this._filePath);
      if (stat.size > ROTATE_BYTES) {
        const rotated = this._filePath + '.1';
        fs.renameSync(this._filePath, rotated);
      }
    } catch (_) { /* file doesn't exist yet — fine */ }
  }

  // ── _loadFromDisk ─────────────────────────────────────────────────────────
  /**
   * Read events.ndjson line-by-line on startup and re-populate in-memory state.
   * Skips malformed lines. Returns count of events loaded.
   * @returns {number}
   */
  _loadFromDisk() {
    if (!this._filePath) return 0;
    let loaded = 0;
    try {
      const content = fs.readFileSync(this._filePath, 'utf8');
      const lines   = content.split('\n');
      const existingIds = new Set(this._globalLog.map(e => e.id));

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let ev;
        try { ev = JSON.parse(trimmed); }
        catch (_) {
          process.stderr.write('[MissionEventLog] Warning: skipped malformed line\n');
          continue;
        }
        if (!ev || typeof ev.id !== 'string' || existingIds.has(ev.id)) continue;
        if (!ev.missionId || !ev.type) continue;

        if (!this._byMission.has(ev.missionId)) {
          this._byMission.set(ev.missionId, []);
        }
        const frozen = Object.freeze({ ...ev });
        this._byMission.get(ev.missionId).push(frozen);
        this._globalLog.push(frozen);
        existingIds.add(ev.id);

        // Keep global seq counter ahead
        const seqMatch = String(ev.id).match(/^mev_(\d+)$/);
        if (seqMatch) {
          const n = parseInt(seqMatch[1], 10);
          if (n >= _globalSeq) _globalSeq = n + 1;
        }
        loaded++;
      }

      // Sort after bulk load
      for (const arr of this._byMission.values()) {
        arr.sort((a, b) => a.seq - b.seq);
      }
      this._globalLog.sort((a, b) => {
        // sort by global seq embedded in id
        const ai = parseInt(String(a.id).replace('mev_', ''), 10) || 0;
        const bi = parseInt(String(b.id).replace('mev_', ''), 10) || 0;
        return ai - bi;
      });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        process.stderr.write(`[MissionEventLog] Warning: could not read ${this._filePath}: ${err.message}\n`);
      }
    }
    return loaded;
  }

  // ── append ────────────────────────────────────────────────────────────────
  /**
   * Append a new event for the given mission.
   * @param {string}      missionId
   * @param {string}      type     — event type string
   * @param {string|null} actor    — accountId, component name, or null
   * @param {object|null} data     — additional payload (will be shallow-cloned)
   * @returns {object} The created event object
   */
  append(missionId, type, actor = null, data = null) {
    if (!missionId || typeof missionId !== 'string') {
      throw new TypeError('missionEventLog.append: missionId must be a non-empty string');
    }
    if (!type || typeof type !== 'string') {
      throw new TypeError('missionEventLog.append: type must be a non-empty string');
    }

    if (!this._byMission.has(missionId)) {
      this._byMission.set(missionId, []);
    }
    const arr = this._byMission.get(missionId);
    const seq = arr.length + 1;
    _globalSeq++;

    const event = Object.freeze({
      id:        `mev_${_globalSeq}`,
      missionId,
      type,
      actor:     actor || null,
      data:      data ? { ...data } : null,
      ts:        new Date().toISOString(),
      seq,
    });

    arr.push(event);
    this._globalLog.push(event);

    // Write-ahead to NDJSON file (never throws)
    if (this._filePath) {
      try {
        this._rotateIfNeeded();
        fs.appendFileSync(this._filePath, JSON.stringify(event) + '\n');
      } catch (err) {
        process.stderr.write(`[MissionEventLog] Warning: write failed: ${err.message}\n`);
      }
    }

    return event;
  }

  // ── listForMission ────────────────────────────────────────────────────────
  /**
   * Return paginated events for a mission, oldest-first.
   * @param {string}  missionId
   * @param {object}  [opts]
   * @param {number}  [opts.limit=50]   — max events per page (1–200)
   * @param {string}  [opts.cursor]     — event id to start after
   * @returns {{ events: object[], count: number, cursor: string|null, hasMore: boolean }}
   */
  listForMission(missionId, { limit = 50, cursor = null } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const arr       = this._byMission.get(missionId) || [];

    let startIdx = 0;
    if (cursor) {
      const idx = arr.findIndex(e => e.id === cursor);
      if (idx !== -1) startIdx = idx + 1;
    }

    const page     = arr.slice(startIdx, startIdx + safeLimit);
    const hasMore  = startIdx + safeLimit < arr.length;
    const nextCur  = hasMore ? page[page.length - 1]?.id || null : null;

    return {
      events:   page,
      count:    arr.length,
      cursor:   nextCur,
      hasMore,
    };
  }

  // ── listRecent ────────────────────────────────────────────────────────────
  /**
   * Return the N most recent events across all missions (newest-first).
   * @param {object} [opts]
   * @param {number} [opts.limit=20]
   * @param {string} [opts.cursor]  — event id to start after (in newest-first order)
   * @returns {{ events: object[], count: number, cursor: string|null, hasMore: boolean }}
   */
  listRecent({ limit = 20, cursor = null } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    // newest-first
    const all       = this._globalLog.slice().reverse();

    let startIdx = 0;
    if (cursor) {
      const idx = all.findIndex(e => e.id === cursor);
      if (idx !== -1) startIdx = idx + 1;
    }

    const page    = all.slice(startIdx, startIdx + safeLimit);
    const hasMore = startIdx + safeLimit < all.length;
    const nextCur = hasMore ? page[page.length - 1]?.id || null : null;

    return {
      events:  page,
      count:   all.length,
      cursor:  nextCur,
      hasMore,
    };
  }

  // ── listAll ───────────────────────────────────────────────────────────────
  /**
   * Return all events with optional filters, in chronological order.
   * Used by the export/replay endpoints. [V99]
   * @param {object} [filters]
   * @param {string} [filters.since]     — ISO timestamp lower bound (inclusive)
   * @param {string} [filters.until]     — ISO timestamp upper bound (inclusive)
   * @param {string} [filters.missionId] — exact missionId filter
   * @returns {object[]}
   */
  listAll({ since, until, missionId } = {}) {
    let events = this._globalLog;
    if (missionId) {
      events = this._byMission.get(missionId) || [];
    }
    if (since) {
      events = events.filter(e => e.ts >= since);
    }
    if (until) {
      events = events.filter(e => e.ts <= until);
    }
    return events;
  }

  // ── countForMission ───────────────────────────────────────────────────────
  /**
   * Return total event count for a mission (cheap, no pagination).
   * @param {string} missionId
   * @returns {number}
   */
  countForMission(missionId) {
    return (this._byMission.get(missionId) || []).length;
  }

  // ── size ──────────────────────────────────────────────────────────────────
  /** Total number of events across all missions. */
  size() {
    return this._globalLog.length;
  }

  // ── importEvents ─────────────────────────────────────────────────────────
  /**
   * Bulk-import a previously serialized event array (for restart persistence).
   * Skips duplicate event ids.
   * @param {object[]} events  — array of event objects (as returned by listForMission)
   */
  importEvents(events) {
    if (!Array.isArray(events)) return;
    const existingIds = new Set(this._globalLog.map(e => e.id));
    for (const ev of events) {
      if (!ev || typeof ev.id !== 'string' || existingIds.has(ev.id)) continue;
      if (!ev.missionId || !ev.type) continue;

      if (!this._byMission.has(ev.missionId)) {
        this._byMission.set(ev.missionId, []);
      }
      const frozen = Object.freeze({ ...ev });
      this._byMission.get(ev.missionId).push(frozen);
      this._globalLog.push(frozen);
      existingIds.add(ev.id);

      // Keep global seq counter ahead of imported ids
      const seqMatch = String(ev.id).match(/^mev_(\d+)$/);
      if (seqMatch) {
        const n = parseInt(seqMatch[1], 10);
        if (n >= _globalSeq) _globalSeq = n + 1;
      }
    }
    // Re-sort by seq after import
    for (const arr of this._byMission.values()) {
      arr.sort((a, b) => a.seq - b.seq);
    }
    this._globalLog.sort((a, b) => {
      const ai = parseInt(String(a.id).replace('mev_', ''), 10) || 0;
      const bi = parseInt(String(b.id).replace('mev_', ''), 10) || 0;
      return ai - bi;
    });
  }
}

module.exports = { MissionEventLog };
