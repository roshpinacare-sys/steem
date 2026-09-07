'use strict';
/**
 * ECOS Snapshot Engine — V106
 * ──────────────────────────────────────────────────────────────────────────────
 * Runtime snapshot export and import with deterministic serialization,
 * hash verification, and resumable state restoration.
 *
 * Supports:
 *   - Full in-memory state export (accounts, audit tail, approvals, agents)
 *   - JSON + optional gzip compression
 *   - SHA-256 integrity hash over full snapshot content
 *   - Import with hash pre-verification before apply
 *   - File-backed fallback for cold-start without DB
 *   - Replay checkpoints: labeled snapshot at any point in time
 *
 * Usage:
 *   const engine = new SnapshotEngine({ ledger, auditLog, hitlGate });
 *   const snap   = await engine.export();
 *   await engine.verify(snap);            // { ok: true }
 *   await engine.restore(snap);           // apply state
 *
 * API surface used by ecos-api-server.js:
 *   GET  /api/v1/snapshot         → engine.export()
 *   POST /api/v1/snapshot/restore → engine.restore(body)
 *   GET  /api/v1/snapshot/verify  → engine.verify(body)
 */

const crypto = require('node:crypto');
const fs     = require('node:fs');
const path   = require('node:path');
const { sha256Hex, canonicalize } = require('./auditLog');

const SNAPSHOT_VERSION = 1;

class SnapshotEngine {
  /**
   * @param {object} deps
   * @param {object} deps.ledger       — FiatLedger instance
   * @param {object} deps.auditLog     — AuditLog instance
   * @param {object} deps.hitlGate     — HitlGate instance (optional)
   * @param {object} deps.agentIdentity — agentIdentity module (optional)
   * @param {object} [opts]
   * @param {number} [opts.auditTailSize=200]  — entries to include in snapshot
   * @param {string} [opts.snapshotDir]         — directory for file-backed snapshots
   * @param {object} [opts.logger]
   */
  constructor(deps = {}, opts = {}) {
    this._ledger        = deps.ledger        || null;
    this._auditLog      = deps.auditLog      || null;
    this._hitlGate      = deps.hitlGate      || null;
    this._agentIdentity = deps.agentIdentity || null;
    this._auditTail     = opts.auditTailSize || 200;
    this._snapshotDir   = opts.snapshotDir   || null;
    this._log           = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };
    // ── P154-B: extras map — arbitrary key/value store for subsystems (e.g. scheduler257) ──
    this._extras        = Object.create(null);
  }

  // ── P154-B: setExtra / getExtra ───────────────────────────────────────────────

  /**
   * Store an arbitrary value under `key`. Persisted inside snapshot body as `extras`.
   * Used by automationScheduler257 to survive server reboots.
   * @param {string} key
   * @param {*} value  — must be JSON-serialisable
   */
  setExtra(key, value) {
    if (typeof key !== 'string' || !key) throw new TypeError('SnapshotEngine.setExtra: key must be a non-empty string');
    this._extras[key] = value;
  }

  /**
   * Retrieve a value previously stored with setExtra.
   * Returns `null` if the key has never been set.
   * @param {string} key
   * @returns {*}
   */
  getExtra(key) {
    if (typeof key !== 'string' || !key) throw new TypeError('SnapshotEngine.getExtra: key must be a non-empty string');
    return Object.prototype.hasOwnProperty.call(this._extras, key) ? this._extras[key] : null;
  }

  // ── Export ────────────────────────────────────────────────────────────────────

  /**
   * Export the current runtime state into a serializable snapshot object.
   * @param {object} [opts]
   * @param {string} [opts.label]       — human label for replay checkpoint
   * @param {object} [opts.extraMeta]   — arbitrary extra metadata
   * @returns {Promise<object>} snapshot
   */
  async export(opts = {}) {
    const ts    = new Date().toISOString();
    const label = opts.label || `snapshot-${ts}`;

    const accounts  = this._exportAccounts();
    const auditTail = this._exportAuditTail();
    const approvals = this._exportApprovals();
    const agentId   = await this._exportAgentIdentity();

    const body = {
      version:    SNAPSHOT_VERSION,
      label,
      exportedAt: ts,
      accounts,
      auditTail,
      approvals,
      agentIdentity: agentId,
      // ── P154-B: persist extras (e.g. scheduler257 config) ──
      extras: Object.assign(Object.create(null), this._extras),
      meta: {
        accountCount:  accounts.length,
        auditEntries:  auditTail.length,
        approvalCount: approvals.length,
        ...opts.extraMeta,
      },
    };

    // Compute integrity hash over canonicalized body (deterministic)
    const integrityHash = sha256Hex(canonicalize(body));

    const snapshot = { ...body, integrityHash };
    this._log.info({ component: 'snapshot', label, integrityHash, accounts: accounts.length },
      '[Snapshot] exported');
    return snapshot;
  }

  // ── Verify ────────────────────────────────────────────────────────────────────

  /**
   * Verify a snapshot's integrity hash without applying it.
   * @param {object} snapshot
   * @returns {{ ok: boolean, reason?: string, integrityHash?: string }}
   */
  verify(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return { ok: false, reason: 'snapshot must be an object' };
    }
    if (snapshot.version !== SNAPSHOT_VERSION) {
      return { ok: false, reason: `unsupported snapshot version: ${snapshot.version}` };
    }
    if (!snapshot.integrityHash) {
      return { ok: false, reason: 'snapshot missing integrityHash' };
    }

    // Recompute hash from body (without integrityHash field)
    const { integrityHash: claimed, ...body } = snapshot;
    const computed = sha256Hex(canonicalize(body));

    if (computed !== claimed) {
      return {
        ok:       false,
        reason:   'integrityHash mismatch — snapshot may be tampered',
        claimed,
        computed,
      };
    }
    return { ok: true, integrityHash: claimed };
  }

  // ── Restore ───────────────────────────────────────────────────────────────────

  /**
   * Verify then restore a snapshot into the current runtime.
   * CAUTION: this overwrites in-memory state. Not recommended in production
   * without a maintenance window. Safe for cold-start and test harnesses.
   *
   * @param {object} snapshot
   * @param {object} [opts]
   * @param {boolean} [opts.dryRun=false]  — verify only, do not apply
   * @returns {Promise<{ ok: boolean, applied: boolean, reason?: string }>}
   */
  async restore(snapshot, opts = {}) {
    const verification = this.verify(snapshot);
    if (!verification.ok) {
      return { ok: false, applied: false, reason: verification.reason };
    }

    if (opts.dryRun) {
      return { ok: true, applied: false, reason: 'dryRun=true — not applied' };
    }

    try {
      this._restoreAccounts(snapshot.accounts);
      this._restoreAuditTail(snapshot.auditTail);
      this._restoreApprovals(snapshot.approvals);
      // ── P154-B: restore extras map (e.g. scheduler257 config) ──
      if (snapshot.extras && typeof snapshot.extras === 'object') {
        this._extras = Object.assign(Object.create(null), snapshot.extras);
      }

      this._log.info({ component: 'snapshot', label: snapshot.label,
        accounts: snapshot.accounts?.length, ts: snapshot.exportedAt },
        '[Snapshot] restored');

      return { ok: true, applied: true };
    } catch (err) {
      this._log.error({ component: 'snapshot', err: err.message }, '[Snapshot] restore failed');
      return { ok: false, applied: false, reason: err.message };
    }
  }

  // ── File persistence ──────────────────────────────────────────────────────────

  /**
   * Save snapshot to disk (named file).
   * @param {object} snapshot
   * @param {string} [filename]
   * @returns {string} absolute file path
   */
  saveToFile(snapshot, filename) {
    if (!this._snapshotDir) throw new Error('snapshotDir not configured');
    fs.mkdirSync(this._snapshotDir, { recursive: true });
    const fname = filename || `snapshot_${Date.now()}.json`;
    const fpath = path.join(this._snapshotDir, fname);
    fs.writeFileSync(fpath, JSON.stringify(snapshot, null, 2), 'utf8');
    this._log.info({ component: 'snapshot', path: fpath }, '[Snapshot] saved to file');
    return fpath;
  }

  /**
   * Load and verify snapshot from disk.
   * @param {string} filePath
   * @returns {{ snapshot: object, verification: object }}
   */
  loadFromFile(filePath) {
    const raw      = fs.readFileSync(filePath, 'utf8');
    const snapshot = JSON.parse(raw);
    const verification = this.verify(snapshot);
    return { snapshot, verification };
  }

  /**
   * List all snapshots in snapshotDir (newest first).
   * @returns {Array<{ filename, size, mtime }>}
   */
  listSnapshots() {
    if (!this._snapshotDir || !fs.existsSync(this._snapshotDir)) return [];
    return fs.readdirSync(this._snapshotDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const stat = fs.statSync(path.join(this._snapshotDir, f));
        return { filename: f, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  }

  // ── Private: export helpers ───────────────────────────────────────────────────

  _exportAccounts() {
    if (!this._ledger) return [];
    return this._ledger.listAccounts().map(a => ({
      id:         a.id,
      microcents: a.microcents,
    }));
  }

  _exportAuditTail() {
    if (!this._auditLog) return [];
    const entries = this._auditLog.entries();
    return entries.slice(-this._auditTail).map(e => ({
      index:    e.index,
      ts:       e.ts,
      type:     e.type,
      payload:  e.payload,
      prevHash: e.prevHash,
      hash:     e.hash,
    }));
  }

  _exportApprovals() {
    if (!this._hitlGate) return [];
    try {
      return this._hitlGate.listApprovals({ status: 'pending' }).map(a => ({
        id:               a.id,
        status:           a.status,
        clientAccountId:  a.clientAccountId,
        grossUsd:         a.grossUsd,
        aiOutput:         a.aiOutput,
        confidence:       a.confidence,
        createdAt:        a.createdAt,
      }));
    } catch { return []; }
  }

  async _exportAgentIdentity() {
    if (!this._agentIdentity) return null;
    try {
      return await this._agentIdentity.load();
    } catch { return null; }
  }

  // ── Private: restore helpers ──────────────────────────────────────────────────

  _restoreAccounts(accounts) {
    if (!this._ledger || !Array.isArray(accounts)) return;
    for (const a of accounts) {
      this._ledger.ensureAccount(a.id);
      // Directly restore balance — bypass credit/debit to avoid audit entries
      if (this._ledger._accounts) {
        this._ledger._accounts.set(a.id, BigInt(a.microcents));
      }
    }
  }

  _restoreAuditTail(entries) {
    if (!this._auditLog || !Array.isArray(entries) || entries.length === 0) return;
    // Only restore if in-memory log is empty (cold start)
    if (this._auditLog.size() > 0) {
      this._log.warn({ component: 'snapshot' },
        '[Snapshot] audit log already has entries — skipping restore to preserve continuity');
      return;
    }
    // Re-hydrate entries directly (preserves hash chain)
    for (const e of entries) {
      this._auditLog._entries.push(Object.freeze(e));
    }
  }

  _restoreApprovals(approvals) {
    // HitlGate does not expose a bulk-load API — pending approvals from
    // snapshot must be re-submitted through normal channels.
    // This method is a no-op by design to avoid double-submission.
    if (approvals && approvals.length > 0) {
      this._log.warn({ component: 'snapshot', count: approvals.length },
        '[Snapshot] pending approvals from snapshot NOT auto-restored — resubmit via API');
    }
  }
}


// ── DB Persistence (V108-P5-04) ────────────────────────────────────────────────

/**
 * Export runtime state and persist it to the `snapshots` table.
 * The `snapshots` table was created in migration_phase5.sql.
 *
 * @param {object} pool — pg.Pool instance
 * @param {object} [opts]
 * @param {string} [opts.label]      — snapshot label
 * @param {string} [opts.savedBy='api'] — who triggered the save
 * @param {object} [opts.extraMeta]  — forwarded to export()
 * @returns {Promise<object>} snapshot with db `id` field added
 */
SnapshotEngine.prototype.exportToDB = async function exportToDB(pool, opts = {}) {
  if (!pool) throw new TypeError('SnapshotEngine.exportToDB: pool is required');

  const snapshot  = await this.export({ label: opts.label, extraMeta: opts.extraMeta });
  const savedBy   = opts.savedBy || 'api';
  const sourceVer = opts.sourceVersion || '108.0.0';

  // Build the INSERT row (match migration_phase5.sql schema + phase6 additions)
  const id = 'snap_' + require('node:crypto').randomBytes(8).toString('hex');

  try {
    await pool.query(
      `INSERT INTO snapshots
         (id, label, exported_at, integrity_hash, version, account_count,
          audit_entries, approval_count, body, source_version, saved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (integrity_hash) DO NOTHING`,
      [
        id,
        snapshot.label,
        snapshot.exportedAt,
        snapshot.integrityHash,
        snapshot.version,
        snapshot.meta?.accountCount  || 0,
        snapshot.meta?.auditEntries  || 0,
        snapshot.meta?.approvalCount || 0,
        JSON.stringify(snapshot),
        sourceVer,
        savedBy,
      ]
    );

    this._log.info({ component: 'snapshot', id, label: snapshot.label, savedBy },
      '[Snapshot] exportToDB: saved to DB');

    return { ...snapshot, dbId: id };
  } catch (err) {
    this._log.error({ component: 'snapshot', err: err.message }, '[Snapshot] exportToDB failed');
    throw err;
  }
};

/**
 * Load the most recent (or a labelled/identified) snapshot from `snapshots` table
 * and optionally restore it.
 *
 * @param {object} pool — pg.Pool instance
 * @param {object} [opts]
 * @param {string} [opts.id]      — load a specific snapshot by DB id
 * @param {string} [opts.label]   — filter by snapshot label (newest matching)
 * @param {boolean} [opts.dryRun=false] — verify only, do not apply state
 * @returns {Promise<{ ok, applied, snapshot, verification, reason? }>}
 */
SnapshotEngine.prototype.loadFromDB = async function loadFromDB(pool, opts = {}) {
  if (!pool) throw new TypeError('SnapshotEngine.loadFromDB: pool is required');

  let query  = 'SELECT id, label, exported_at, integrity_hash, body FROM snapshots WHERE 1=1';
  const params = [];

  if (opts.id) {
    params.push(opts.id);
    query += ` AND id = $${params.length}`;
  } else if (opts.label) {
    params.push(opts.label);
    query += ` AND label = $${params.length}`;
  }

  query += ' ORDER BY exported_at DESC LIMIT 1';

  let row;
  try {
    const result = await pool.query(query, params);
    row = result.rows[0] || null;
  } catch (err) {
    this._log.error({ component: 'snapshot', err: err.message }, '[Snapshot] loadFromDB query failed');
    throw err;
  }

  if (!row) {
    return { ok: false, applied: false, reason: 'No snapshot found in DB matching the given filters' };
  }

  // Body is stored as JSONB — pg returns it already parsed
  const snapshot = typeof row.body === 'string' ? JSON.parse(row.body) : row.body;

  const verification = this.verify(snapshot);
  if (!verification.ok) {
    this._log.warn({ component: 'snapshot', id: row.id, reason: verification.reason },
      '[Snapshot] loadFromDB: integrity check failed');
    return { ok: false, applied: false, snapshot, verification, reason: verification.reason };
  }

  if (opts.dryRun) {
    return { ok: true, applied: false, snapshot, verification, reason: 'dryRun=true — not applied' };
  }

  const restoreResult = await this.restore(snapshot, { dryRun: false });
  if (restoreResult.ok) {
    this._log.info({ component: 'snapshot', id: row.id, label: row.label },
      '[Snapshot] loadFromDB: restored from DB');
  }

  return { ...restoreResult, snapshot, verification, dbId: row.id };
};

module.exports = { SnapshotEngine, SNAPSHOT_VERSION };
