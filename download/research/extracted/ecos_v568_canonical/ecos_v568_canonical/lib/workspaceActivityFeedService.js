/**
 * lib/workspaceActivityFeedService.js — V167
 * ===========================================
 * Workspace Activity Feed
 * מזין פעילות workspace — זרם מאורעות ניתן לדפדוף עם פגינציה על סמך cursor
 *
 * תכונות:
 *  - תיעוד אירועי פעילות (tasks, comments, SLA, bulk ops, members)
 *  - פגינציה מבוססת cursor (after/before)
 *  - סינון לפי type / actorId / dateRange
 *  - Fan-out בזמן אמת דרך WebSocket hub
 *  - In-memory + DB dual persistence
 *  - DB: workspace_activity_feed
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V167-T01]
 *
 * @version 167.0.0
 */

'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_FEED_PAGE_SIZE    = 100;
const DEFAULT_PAGE_SIZE     = 25;
const MAX_IN_MEMORY_PER_WS  = 500;   // circular buffer per workspace

/** Known activity event types */
const ACTIVITY_TYPES = Object.freeze([
  'task.created',
  'task.updated',
  'task.deleted',
  'task.assigned',
  'task.completed',
  'comment.created',
  'comment.deleted',
  'member.added',
  'member.removed',
  'sla.breached',
  'sla.warned',
  'bulk.update',
  'bulk.delete',
  'custom_field.set',
]);

// ── Errors ───────────────────────────────────────────────────────────────────

class ActivityFeedValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'ActivityFeedValidationError';
    this.code = 'ACTIVITY_FEED_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

class ActivityEventNotFoundError extends Error {
  constructor(id) {
    super(`Activity event not found: ${id}`);
    this.name = 'ActivityEventNotFoundError';
    this.code = 'ACTIVITY_EVENT_NOT_FOUND';
    this.statusCode = 404;
  }
}

// ── Value Object ─────────────────────────────────────────────────────────────

class ActivityEvent {
  constructor({
    id, workspaceId, eventType, actorId, actorName,
    targetId, targetType, targetName, payload, createdAt,
  }) {
    this.id          = id;
    this.workspaceId = workspaceId;
    this.eventType   = eventType;
    this.actorId     = actorId;
    this.actorName   = actorName   || null;
    this.targetId    = targetId    || null;
    this.targetType  = targetType  || null;
    this.targetName  = targetName  || null;
    this.payload     = payload     || {};
    this.createdAt   = createdAt   || new Date().toISOString();
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

class WorkspaceActivityFeedService {
  /**
   * @param {object} opts
   * @param {object|null} opts.pool        - pg Pool (null → in-memory only)
   * @param {boolean}     [opts.dbEnabled] - default true when pool provided
   * @param {object|null} [opts.wsHub]     - optional WebSocket hub for real-time fan-out
   * @param {function}    [opts.nanoid]    - id generator (default: built-in)
   */
  constructor({ pool, dbEnabled, wsHub = null, nanoid = null }) {
    this._pool      = pool;
    this._dbEnabled = dbEnabled !== false && pool != null;
    this._wsHub     = wsHub;
    this._nanoid    = nanoid || (() => `act_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

    /** @type {Map<string, ActivityEvent[]>} workspaceId → events (newest first) */
    this._store = new Map();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  _getOrCreateBucket(workspaceId) {
    if (!this._store.has(workspaceId)) {
      this._store.set(workspaceId, []);
    }
    return this._store.get(workspaceId);
  }

  _trimBucket(bucket) {
    if (bucket.length > MAX_IN_MEMORY_PER_WS) {
      bucket.splice(MAX_IN_MEMORY_PER_WS);
    }
  }

  // ── Validation ────────────────────────────────────────────────────────────

  _validateEventType(eventType) {
    if (!ACTIVITY_TYPES.includes(eventType)) {
      throw new ActivityFeedValidationError(
        `Unknown eventType "${eventType}". Valid: ${ACTIVITY_TYPES.join(', ')}`
      );
    }
  }

  _validatePageSize(limit) {
    if (limit < 1 || limit > MAX_FEED_PAGE_SIZE) {
      throw new ActivityFeedValidationError(
        `limit must be between 1 and ${MAX_FEED_PAGE_SIZE}`
      );
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Record an activity event into the feed.
   * Called internally by route handlers after each mutating operation.
   *
   * @param {string} workspaceId
   * @param {object} data - { eventType, actorId, actorName?, targetId?, targetType?, targetName?, payload? }
   * @returns {Promise<ActivityEvent>}
   */
  async recordEvent(workspaceId, data) {
    const { eventType, actorId } = data;
    if (!workspaceId) throw new ActivityFeedValidationError('workspaceId required');
    if (!actorId)     throw new ActivityFeedValidationError('actorId required');
    this._validateEventType(eventType);

    const event = new ActivityEvent({
      id:          this._nanoid(),
      workspaceId,
      eventType,
      actorId,
      actorName:   data.actorName   || null,
      targetId:    data.targetId    || null,
      targetType:  data.targetType  || null,
      targetName:  data.targetName  || null,
      payload:     data.payload     || {},
      createdAt:   new Date().toISOString(),
    });

    // In-memory
    const bucket = this._getOrCreateBucket(workspaceId);
    bucket.unshift(event);   // newest first
    this._trimBucket(bucket);

    // DB persistence
    if (this._dbEnabled) {
      await this._dbInsert(event);
    }

    // Real-time fan-out
    if (this._wsHub && typeof this._wsHub.broadcastToWorkspace === 'function') {
      this._wsHub.broadcastToWorkspace(workspaceId, {
        type:  'activity.new',
        event,
      });
    }

    return event;
  }

  /**
   * Paginated activity feed for a workspace.
   *
   * @param {string} workspaceId
   * @param {object} opts
   * @param {number}   [opts.limit=25]     - page size (1..100)
   * @param {string}   [opts.after]        - cursor — return events OLDER than this id
   * @param {string}   [opts.before]       - cursor — return events NEWER than this id
   * @param {string[]} [opts.types]        - filter by event types
   * @param {string}   [opts.actorId]      - filter by actor
   * @param {string}   [opts.since]        - ISO date lower bound
   * @param {string}   [opts.until]        - ISO date upper bound
   * @returns {Promise<{events: ActivityEvent[], nextCursor: string|null, prevCursor: string|null, total: number}>}
   */
  async getActivityFeed(workspaceId, opts = {}) {
    if (!workspaceId) throw new ActivityFeedValidationError('workspaceId required');

    const rawLimit = opts.limit != null ? parseInt(opts.limit, 10) : DEFAULT_PAGE_SIZE;
    this._validatePageSize(rawLimit);
    const limit = Math.min(rawLimit, MAX_FEED_PAGE_SIZE);

    if (opts.types) {
      for (const t of opts.types) this._validateEventType(t);
    }

    if (this._dbEnabled) {
      return this._dbGetFeed(workspaceId, { ...opts, limit });
    }

    return this._memGetFeed(workspaceId, { ...opts, limit });
  }

  /**
   * Get a single activity event by id.
   * @param {string} workspaceId
   * @param {string} eventId
   * @returns {Promise<ActivityEvent>}
   */
  async getEvent(workspaceId, eventId) {
    if (!workspaceId) throw new ActivityFeedValidationError('workspaceId required');
    if (!eventId)     throw new ActivityFeedValidationError('eventId required');

    const bucket = this._store.get(workspaceId) || [];
    const found  = bucket.find(e => e.id === eventId);
    if (found) return found;

    if (this._dbEnabled) {
      return this._dbGetEvent(workspaceId, eventId);
    }

    throw new ActivityEventNotFoundError(eventId);
  }

  /**
   * Clear all in-memory events for a workspace (test helper).
   * @param {string} workspaceId
   */
  clearWorkspace(workspaceId) {
    this._store.delete(workspaceId);
  }

  // ── In-Memory Implementation ──────────────────────────────────────────────

  _memGetFeed(workspaceId, opts) {
    const { limit, after, before, types, actorId, since, until } = opts;
    let bucket = (this._store.get(workspaceId) || []).slice(); // newest first

    // Cursor navigation
    if (after) {
      const idx = bucket.findIndex(e => e.id === after);
      if (idx !== -1) bucket = bucket.slice(idx + 1);
    }
    if (before) {
      const idx = bucket.findIndex(e => e.id === before);
      if (idx !== -1) bucket = bucket.slice(0, idx);
    }

    // Filters
    if (types && types.length) {
      bucket = bucket.filter(e => types.includes(e.eventType));
    }
    if (actorId) {
      bucket = bucket.filter(e => e.actorId === actorId);
    }
    if (since) {
      const sinceTs = new Date(since).getTime();
      bucket = bucket.filter(e => new Date(e.createdAt).getTime() >= sinceTs);
    }
    if (until) {
      const untilTs = new Date(until).getTime();
      bucket = bucket.filter(e => new Date(e.createdAt).getTime() <= untilTs);
    }

    const total      = bucket.length;
    const page       = bucket.slice(0, limit);
    const nextCursor = page.length === limit && total > limit ? page[page.length - 1].id : null;
    const prevCursor = after ? (page.length > 0 ? page[0].id : null) : null;

    return Promise.resolve({ events: page, nextCursor, prevCursor, total });
  }

  // ── DB Implementation ─────────────────────────────────────────────────────

  async _dbInsert(event) {
    const q = `
      INSERT INTO workspace_activity_feed
        (id, workspace_id, event_type, actor_id, actor_name,
         target_id, target_type, target_name, payload, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO NOTHING
    `;
    await this._pool.query(q, [
      event.id,
      event.workspaceId,
      event.eventType,
      event.actorId,
      event.actorName,
      event.targetId,
      event.targetType,
      event.targetName,
      JSON.stringify(event.payload),
      event.createdAt,
    ]);
  }

  async _dbGetFeed(workspaceId, opts) {
    const { limit, after, before, types, actorId, since, until } = opts;
    const params  = [workspaceId];
    const filters = ['workspace_id = $1'];
    let   pi      = 2;

    if (types && types.length) {
      filters.push(`event_type = ANY($${pi++})`);
      params.push(types);
    }
    if (actorId) {
      filters.push(`actor_id = $${pi++}`);
      params.push(actorId);
    }
    if (since) {
      filters.push(`created_at >= $${pi++}`);
      params.push(since);
    }
    if (until) {
      filters.push(`created_at <= $${pi++}`);
      params.push(until);
    }
    if (after) {
      // after cursor: events older than the cursor row
      filters.push(`created_at < (SELECT created_at FROM workspace_activity_feed WHERE id = $${pi++})`);
      params.push(after);
    }
    if (before) {
      filters.push(`created_at > (SELECT created_at FROM workspace_activity_feed WHERE id = $${pi++})`);
      params.push(before);
    }

    const where = filters.join(' AND ');
    const countQ = `SELECT COUNT(*) FROM workspace_activity_feed WHERE ${where}`;
    const dataQ  = `
      SELECT id, workspace_id, event_type, actor_id, actor_name,
             target_id, target_type, target_name, payload, created_at
      FROM workspace_activity_feed
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${pi}
    `;
    params.push(limit);

    const [countRes, dataRes] = await Promise.all([
      this._pool.query(countQ, params.slice(0, -1)),
      this._pool.query(dataQ, params),
    ]);

    const total  = parseInt(countRes.rows[0].count, 10);
    const events = dataRes.rows.map(r => new ActivityEvent({
      id:          r.id,
      workspaceId: r.workspace_id,
      eventType:   r.event_type,
      actorId:     r.actor_id,
      actorName:   r.actor_name,
      targetId:    r.target_id,
      targetType:  r.target_type,
      targetName:  r.target_name,
      payload:     typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
      createdAt:   r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    }));

    const nextCursor = events.length === limit ? events[events.length - 1].id : null;
    const prevCursor = after ? (events.length > 0 ? events[0].id : null) : null;

    return { events, nextCursor, prevCursor, total };
  }

  async _dbGetEvent(workspaceId, eventId) {
    const res = await this._pool.query(
      `SELECT * FROM workspace_activity_feed WHERE id = $1 AND workspace_id = $2`,
      [eventId, workspaceId]
    );
    if (!res.rows.length) throw new ActivityEventNotFoundError(eventId);
    const r = res.rows[0];
    return new ActivityEvent({
      id:          r.id,
      workspaceId: r.workspace_id,
      eventType:   r.event_type,
      actorId:     r.actor_id,
      actorName:   r.actor_name,
      targetId:    r.target_id,
      targetType:  r.target_type,
      targetName:  r.target_name,
      payload:     typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
      createdAt:   r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    });
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

/* istanbul ignore next */
if (process.env.NODE_ENV === 'test') {
  module.exports = {
    WorkspaceActivityFeedService,
    ActivityEvent,
    ActivityFeedValidationError,
    ActivityEventNotFoundError,
    ACTIVITY_TYPES,
    MAX_FEED_PAGE_SIZE,
    DEFAULT_PAGE_SIZE,
    MAX_IN_MEMORY_PER_WS,
  };
} else {
  module.exports = {
    WorkspaceActivityFeedService,
    ActivityEvent,
    ActivityFeedValidationError,
    ActivityEventNotFoundError,
    ACTIVITY_TYPES,
    MAX_FEED_PAGE_SIZE,
    DEFAULT_PAGE_SIZE,
    MAX_IN_MEMORY_PER_WS,
  };
}
