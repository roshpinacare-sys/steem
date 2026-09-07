/**
 * lib/workspaceAuditTrailService.js — V161
 * ==========================================
 * Workspace Immutable Audit Trail
 * לוג append-only של כל מוטציות workspace — בלתי-ניתן לשינוי
 *
 * תכונות:
 *  - Append-only event log (אין update/delete)
 *  - Events: task.created, task.updated, task.deleted, member.invited,
 *             webhook.fired, quota.changed, template.instantiated,
 *             dependency.added, label.applied, comment.created, sla.breached
 *  - Query: by workspaceId, by actorId, by event type, time range, cursor pagination
 *  - Export: JSON export endpoint
 *  - Integrity: SHA-256 chain hash (each event hashes prevHash + payload)
 *  - DB: workspace_audit_trail
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V161-TASK-04]
 */

'use strict';

const crypto = require('crypto');

// ── Supported event types ─────────────────────────────────────────────────
const AUDIT_EVENT_TYPES = [
  'task.created', 'task.updated', 'task.deleted',
  'member.invited', 'member.removed', 'member.role_changed',
  'webhook.fired', 'webhook.failed',
  'quota.changed', 'quota.exceeded',
  'template.instantiated', 'template.created', 'template.deleted',
  'dependency.added', 'dependency.removed',
  'label.applied', 'label.removed', 'label.created', 'label.deleted',
  'comment.created', 'comment.deleted',
  'sla.breached', 'sla.escalated',
  'workspace.created', 'workspace.settings_changed',
];

// ── AuditEvent record ─────────────────────────────────────────────────────
class AuditEvent {
  constructor(data) {
    this.id          = data.id          || `aud_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.eventType   = data.eventType;
    this.actorId     = data.actorId     || null;
    this.targetId    = data.targetId    || null;  // taskId, memberId, labelId, etc.
    this.targetType  = data.targetType  || null;  // 'task' | 'member' | 'webhook' | ...
    this.payload     = data.payload     || {};
    this.metadata    = data.metadata    || {};
    this.prevHash    = data.prevHash    || null;
    this.hash        = data.hash        || this._computeHash(data);
    this.createdAt   = data.createdAt   || new Date().toISOString();
  }

  _computeHash(data) {
    const src = JSON.stringify({
      id:          this.id,
      workspaceId: this.workspaceId,
      eventType:   this.eventType,
      actorId:     this.actorId,
      targetId:    this.targetId,
      payload:     this.payload,
      prevHash:    this.prevHash,
      createdAt:   this.createdAt,
    });
    return crypto.createHash('sha256').update(src).digest('hex');
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      eventType:   this.eventType,
      actorId:     this.actorId,
      targetId:    this.targetId,
      targetType:  this.targetType,
      payload:     this.payload,
      metadata:    this.metadata,
      prevHash:    this.prevHash,
      hash:        this.hash,
      createdAt:   this.createdAt,
    };
  }
}

// ── WorkspaceAuditTrailService ────────────────────────────────────────────
class WorkspaceAuditTrailService {
  /**
   * @param {object} [opts]
   * @param {import('pg').Pool} [opts.db]
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    this._db        = opts.db     || null;
    this._log       = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };
    this._events    = new Map();   // eventId → AuditEvent
    this._lastHash  = new Map();   // workspaceId → last event hash (for chaining)
    this._sequence  = new Map();   // workspaceId → sequence counter
  }

  setDb(pool)    { this._db = pool; }
  setLogger(log) { this._log = log; }

  // ── Record ─────────────────────────────────────────────────────────────

  /**
   * Append an event to the audit trail (never modifies existing events).
   * @param {string} workspaceId
   * @param {string} eventType
   * @param {{ actorId?: string, targetId?: string, targetType?: string, payload?: object, metadata?: object }} data
   * @returns {Promise<AuditEvent>}
   */
  async record(workspaceId, eventType, data = {}) {
    if (!workspaceId) throw new Error('workspaceId is required');
    if (!eventType)   throw new Error('eventType is required');

    const prevHash = this._lastHash.get(workspaceId) || null;
    const seq      = (this._sequence.get(workspaceId) || 0) + 1;
    this._sequence.set(workspaceId, seq);

    const evt = new AuditEvent({
      workspaceId,
      eventType,
      actorId:    data.actorId    || null,
      targetId:   data.targetId   || null,
      targetType: data.targetType || null,
      payload:    data.payload    || {},
      metadata:   { ...data.metadata, seq },
      prevHash,
    });

    this._events.set(evt.id, evt);
    this._lastHash.set(workspaceId, evt.hash);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_audit_trail
             (id, workspace_id, event_type, actor_id, target_id, target_type, payload, metadata, prev_hash, hash, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
          [evt.id, workspaceId, eventType, evt.actorId, evt.targetId, evt.targetType,
           JSON.stringify(evt.payload), JSON.stringify(evt.metadata),
           evt.prevHash, evt.hash, evt.createdAt]
        );
      } catch (e) { this._log.warn({ err: e }, 'auditTrail.record DB error'); }
    }

    return evt;
  }

  // ── Query ──────────────────────────────────────────────────────────────

  /**
   * List audit events with filtering + cursor pagination.
   * @param {string} workspaceId
   * @param {{ actorId?: string, eventType?: string, targetId?: string,
   *            since?: string, until?: string, limit?: number, cursor?: string }} [opts]
   * @returns {{ events: AuditEvent[], total: number, hasMore: boolean, nextCursor: string|null }}
   */
  list(workspaceId, opts = {}) {
    const {
      actorId, eventType, targetId,
      since, until,
      limit = 50, cursor,
    } = opts;

    let items = [...this._events.values()].filter(e => e.workspaceId === workspaceId);

    if (actorId)    items = items.filter(e => e.actorId    === actorId);
    if (eventType)  items = items.filter(e => e.eventType  === eventType);
    if (targetId)   items = items.filter(e => e.targetId   === targetId);
    if (since)      items = items.filter(e => e.createdAt  >= since);
    if (until)      items = items.filter(e => e.createdAt  <= until);

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first

    if (cursor) {
      const idx = items.findIndex(e => e.id === cursor);
      if (idx >= 0) items = items.slice(idx + 1);
    }

    const total     = items.length;
    const page      = items.slice(0, limit);
    const hasMore   = total > limit;
    const nextCursor = hasMore ? page[page.length - 1]?.id : null;

    return { events: page, total, hasMore, nextCursor };
  }

  /**
   * Export all events for a workspace as an array (for JSON export endpoint).
   * @param {string} workspaceId
   * @param {{ since?: string, until?: string }} [opts]
   * @returns {AuditEvent[]}
   */
  export(workspaceId, opts = {}) {
    const { since, until } = opts;
    let items = [...this._events.values()].filter(e => e.workspaceId === workspaceId);
    if (since) items = items.filter(e => e.createdAt >= since);
    if (until) items = items.filter(e => e.createdAt <= until);
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return items;
  }

  /**
   * Verify the hash chain integrity for a workspace.
   * @param {string} workspaceId
   * @returns {{ valid: boolean, checked: number, firstBrokenAt?: string }}
   */
  verifyChain(workspaceId) {
    const items = [...this._events.values()]
      .filter(e => e.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (let i = 0; i < items.length; i++) {
      const evt = items[i];
      const recomputed = new AuditEvent({
        id: evt.id, workspaceId: evt.workspaceId, eventType: evt.eventType,
        actorId: evt.actorId, targetId: evt.targetId, payload: evt.payload,
        prevHash: evt.prevHash, createdAt: evt.createdAt,
      });
      if (recomputed.hash !== evt.hash) {
        return { valid: false, checked: i + 1, firstBrokenAt: evt.id };
      }
      if (i > 0 && items[i - 1].hash !== evt.prevHash) {
        return { valid: false, checked: i + 1, firstBrokenAt: evt.id };
      }
    }
    return { valid: true, checked: items.length };
  }

  // ── Stats ─────────────────────────────────────────────────────────────

  stats(workspaceId) {
    const all = [...this._events.values()].filter(e => e.workspaceId === workspaceId);
    const byType = {};
    for (const e of all) byType[e.eventType] = (byType[e.eventType] || 0) + 1;
    const actorSet = new Set(all.map(e => e.actorId).filter(Boolean));
    return {
      totalEvents:   all.length,
      uniqueActors:  actorSet.size,
      byType,
      latestEventAt: all.length ? all[all.length - 1].createdAt : null,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────
const defaultAuditTrail = new WorkspaceAuditTrailService();

module.exports = {
  WorkspaceAuditTrailService,
  defaultAuditTrail,
  AuditEvent,
  AUDIT_EVENT_TYPES,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._auditTrail = defaultAuditTrail;
}
