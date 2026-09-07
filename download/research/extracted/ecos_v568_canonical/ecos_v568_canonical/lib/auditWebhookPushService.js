/**
 * lib/auditWebhookPushService.js — V166
 * ========================================
 * Audit Trail Webhook Push
 * שליחת אירועי audit trail לנקודות קצה חיצוניות דרך webhooks מנויים
 *
 * תכונות:
 *  - Subscribe webhooks to audit event types (audit.* wildcard supported)
 *  - Filter by specific audit event types or wildcard
 *  - Integrate with existing workspaceWebhookService.js delivery pipeline
 *  - Retry logic: 3 attempts, exponential backoff (1s, 4s, 16s)
 *  - HMAC-SHA256 signature on X-ECOS-Audit-Signature header
 *  - Delivery log (last 100 per subscription)
 *  - In-memory + DB dual persistence
 *  - DB: workspace_audit_webhook_subscriptions
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V166-T01]
 */

'use strict';

const crypto = require('crypto');
const https  = require('https');
const http   = require('http');
const { URL } = require('url');

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_SUBSCRIPTIONS_PER_WORKSPACE = 20;
const MAX_DELIVERIES_PER_SUB          = 100;
const RETRY_DELAYS_MS                 = [1000, 4000, 16000];
const AUDIT_WILDCARD                  = 'audit.*';

// Valid audit event type prefixes for filter validation
const AUDIT_EVENT_PREFIXES = [
  'task.', 'member.', 'webhook.', 'quota.', 'template.',
  'dependency.', 'label.', 'comment.', 'sla.', 'workspace.',
];

// ── Errors ───────────────────────────────────────────────────────────────────

class AuditWebhookNotFoundError extends Error {
  constructor(id) {
    super(`Audit webhook subscription not found: ${id}`);
    this.name = 'AuditWebhookNotFoundError';
    this.code = 'AUDIT_WEBHOOK_NOT_FOUND';
    this.statusCode = 404;
  }
}

class AuditWebhookLimitError extends Error {
  constructor() {
    super(`Workspace has reached the maximum of ${MAX_SUBSCRIPTIONS_PER_WORKSPACE} audit webhook subscriptions`);
    this.name = 'AuditWebhookLimitError';
    this.code = 'AUDIT_WEBHOOK_LIMIT_EXCEEDED';
    this.statusCode = 422;
  }
}

class AuditWebhookValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'AuditWebhookValidationError';
    this.code = 'AUDIT_WEBHOOK_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

// ── AuditWebhookSubscription record ─────────────────────────────────────────

class AuditWebhookSubscription {
  /**
   * @param {object} data
   * @param {string} data.workspaceId
   * @param {string} data.url          - Target HTTP/HTTPS endpoint
   * @param {string[]} data.eventTypes - e.g. ['audit.*'] or ['task.created','member.invited']
   * @param {string} [data.secret]     - HMAC signing secret (auto-generated if absent)
   * @param {string} [data.description]
   * @param {boolean} [data.active]
   */
  constructor(data) {
    this.id          = data.id          || `aws_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.url         = data.url;
    this.secret      = data.secret      || crypto.randomBytes(24).toString('hex');
    this.eventTypes  = Array.isArray(data.eventTypes) ? data.eventTypes : [AUDIT_WILDCARD];
    this.active      = data.active !== false;
    this.description = (data.description || '').slice(0, 200);
    this.createdAt   = data.createdAt   || new Date().toISOString();
    this.updatedAt   = data.updatedAt   || new Date().toISOString();
    this.deliveries  = [];
    this._deliveryCount = 0;
    this._successCount  = 0;
    this._failCount     = 0;
  }

  subscribesTo(eventType) {
    if (!this.active) return false;
    if (this.eventTypes.includes(AUDIT_WILDCARD)) return true;
    return this.eventTypes.includes(eventType);
  }

  recordDelivery(delivery) {
    this._deliveryCount++;
    if (delivery.success) this._successCount++;
    else                  this._failCount++;
    this.deliveries.push(delivery);
    if (this.deliveries.length > MAX_DELIVERIES_PER_SUB) {
      this.deliveries.shift();
    }
  }

  toJSON(includeSecret = false) {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      url:         this.url,
      secret:      includeSecret ? this.secret : `${this.secret.slice(0, 4)}****`,
      eventTypes:  this.eventTypes,
      active:      this.active,
      description: this.description,
      createdAt:   this.createdAt,
      updatedAt:   this.updatedAt,
      stats: {
        total:   this._deliveryCount,
        success: this._successCount,
        failure: this._failCount,
      },
      recentDeliveries: this.deliveries.slice(-5),
    };
  }
}

// ── AuditWebhookPushService ──────────────────────────────────────────────────

class AuditWebhookPushService {
  /**
   * @param {object} [opts]
   * @param {object} [opts.pool]   - pg Pool for DB persistence
   * @param {boolean} [opts.dbEnabled]
   */
  constructor(opts = {}) {
    this.pool      = opts.pool      || null;
    this.dbEnabled = opts.dbEnabled !== false && !!this.pool;

    // workspaceId → Map<subId, AuditWebhookSubscription>
    this._subs = new Map();
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  _validateUrl(url) {
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol)) {
        throw new AuditWebhookValidationError('URL must use http or https protocol');
      }
    } catch (e) {
      if (e instanceof AuditWebhookValidationError) throw e;
      throw new AuditWebhookValidationError(`Invalid URL: ${url}`);
    }
  }

  _validateEventTypes(eventTypes) {
    if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
      throw new AuditWebhookValidationError('eventTypes must be a non-empty array');
    }
    for (const et of eventTypes) {
      if (et === AUDIT_WILDCARD) continue;
      const valid = AUDIT_EVENT_PREFIXES.some(p => et.startsWith(p));
      if (!valid) {
        throw new AuditWebhookValidationError(
          `Invalid audit event type: "${et}". Use "audit.*" or a valid type like "task.created"`
        );
      }
    }
  }

  _getWsMap(workspaceId) {
    if (!this._subs.has(workspaceId)) {
      this._subs.set(workspaceId, new Map());
    }
    return this._subs.get(workspaceId);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /**
   * Create a new audit webhook subscription
   * [V166-T01]
   * @param {string} workspaceId
   * @param {object} opts
   * @param {string} opts.url
   * @param {string[]} [opts.eventTypes]
   * @param {string} [opts.secret]
   * @param {string} [opts.description]
   * @returns {AuditWebhookSubscription}
   */
  async createSubscription(workspaceId, opts = {}) {
    this._validateUrl(opts.url);
    const eventTypes = opts.eventTypes || [AUDIT_WILDCARD];
    this._validateEventTypes(eventTypes);

    const wsMap = this._getWsMap(workspaceId);
    if (wsMap.size >= MAX_SUBSCRIPTIONS_PER_WORKSPACE) {
      throw new AuditWebhookLimitError();
    }

    const sub = new AuditWebhookSubscription({
      workspaceId,
      url:         opts.url,
      eventTypes,
      secret:      opts.secret,
      description: opts.description,
      active:      opts.active !== false,
    });

    wsMap.set(sub.id, sub);

    if (this.dbEnabled) {
      await this._dbInsert(sub);
    }

    return sub;
  }

  /**
   * List subscriptions for a workspace
   * [V166-T02]
   */
  async listSubscriptions(workspaceId) {
    const wsMap = this._getWsMap(workspaceId);
    const subs  = Array.from(wsMap.values()).map(s => s.toJSON());
    return { subscriptions: subs, count: subs.length };
  }

  /**
   * Get single subscription
   * [V166-T03]
   */
  async getSubscription(workspaceId, subId) {
    const wsMap = this._getWsMap(workspaceId);
    const sub   = wsMap.get(subId);
    if (!sub) throw new AuditWebhookNotFoundError(subId);
    return sub.toJSON(true); // include secret on direct fetch
  }

  /**
   * Update subscription (eventTypes, active, description)
   * [V166-T04]
   */
  async updateSubscription(workspaceId, subId, patch = {}) {
    const wsMap = this._getWsMap(workspaceId);
    const sub   = wsMap.get(subId);
    if (!sub) throw new AuditWebhookNotFoundError(subId);

    if (patch.eventTypes !== undefined) {
      this._validateEventTypes(patch.eventTypes);
      sub.eventTypes = patch.eventTypes;
    }
    if (patch.active !== undefined)      sub.active      = Boolean(patch.active);
    if (patch.description !== undefined) sub.description = String(patch.description).slice(0, 200);
    if (patch.url !== undefined) {
      this._validateUrl(patch.url);
      sub.url = patch.url;
    }
    sub.updatedAt = new Date().toISOString();

    if (this.dbEnabled) {
      await this._dbUpdate(sub);
    }

    return sub.toJSON();
  }

  /**
   * Delete subscription
   * [V166-T05]
   */
  async deleteSubscription(workspaceId, subId) {
    const wsMap = this._getWsMap(workspaceId);
    if (!wsMap.has(subId)) throw new AuditWebhookNotFoundError(subId);
    wsMap.delete(subId);

    if (this.dbEnabled) {
      await this._dbDelete(workspaceId, subId);
    }

    return { deleted: true, subId };
  }

  // ── Push ──────────────────────────────────────────────────────────────────

  /**
   * Push an audit event to all matching subscriptions for a workspace.
   * Called by workspaceAuditTrailService after appending each event.
   * [V166-T06]
   *
   * @param {string} workspaceId
   * @param {object} auditEvent - AuditEvent.toJSON()
   */
  async pushAuditEvent(workspaceId, auditEvent) {
    const wsMap = this._getWsMap(workspaceId);
    if (wsMap.size === 0) return { dispatched: 0 };

    const matching = Array.from(wsMap.values()).filter(s => s.subscribesTo(auditEvent.eventType));
    if (matching.length === 0) return { dispatched: 0 };

    await Promise.all(matching.map(sub => this._deliverWithRetry(sub, auditEvent)));
    return { dispatched: matching.length };
  }

  // ── Delivery pipeline ────────────────────────────────────────────────────

  async _deliverWithRetry(sub, auditEvent) {
    const payload = JSON.stringify({
      type:    'audit.push',
      eventId: auditEvent.id,
      event:   auditEvent,
      sentAt:  new Date().toISOString(),
    });

    let lastErr = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        await _sleep(RETRY_DELAYS_MS[attempt - 1]);
      }
      try {
        const result = await this._deliver(sub, payload);
        sub.recordDelivery({
          ts:       new Date().toISOString(),
          eventId:  auditEvent.id,
          attempt:  attempt + 1,
          status:   result.statusCode,
          success:  result.statusCode >= 200 && result.statusCode < 300,
        });
        if (result.statusCode >= 200 && result.statusCode < 300) return;
        lastErr = new Error(`HTTP ${result.statusCode}`);
      } catch (err) {
        lastErr = err;
        sub.recordDelivery({
          ts:      new Date().toISOString(),
          eventId: auditEvent.id,
          attempt: attempt + 1,
          error:   err.message,
          success: false,
        });
      }
    }
    // all retries exhausted — silently log
    console.error(`[auditWebhookPush] Sub ${sub.id} delivery failed: ${lastErr?.message}`);
  }

  _deliver(sub, payload) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(sub.url);
      const sig    = crypto
        .createHmac('sha256', sub.secret)
        .update(payload)
        .digest('hex');

      const options = {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers:  {
          'Content-Type':            'application/json',
          'Content-Length':          Buffer.byteLength(payload),
          'X-ECOS-Audit-Signature':  `sha256=${sig}`,
          'X-ECOS-Event-Type':       'audit.push',
          'User-Agent':              'ECOS-AuditWebhook/166',
        },
        timeout: 10000,
      };

      const transport = parsed.protocol === 'https:' ? https : http;
      const req = transport.request(options, res => {
        res.resume();
        resolve({ statusCode: res.statusCode });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(payload);
      req.end();
    });
  }

  // ── DB persistence ────────────────────────────────────────────────────────

  async _dbInsert(sub) {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `INSERT INTO workspace_audit_webhook_subscriptions
           (id, workspace_id, url, secret, event_types, active, description, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [sub.id, sub.workspaceId, sub.url, sub.secret,
         JSON.stringify(sub.eventTypes), sub.active, sub.description,
         sub.createdAt, sub.updatedAt]
      );
    } catch (err) {
      console.error('[auditWebhookPush] DB insert error:', err.message);
    }
  }

  async _dbUpdate(sub) {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `UPDATE workspace_audit_webhook_subscriptions
         SET url=$1, event_types=$2, active=$3, description=$4, updated_at=$5
         WHERE id=$6 AND workspace_id=$7`,
        [sub.url, JSON.stringify(sub.eventTypes), sub.active,
         sub.description, sub.updatedAt, sub.id, sub.workspaceId]
      );
    } catch (err) {
      console.error('[auditWebhookPush] DB update error:', err.message);
    }
  }

  async _dbDelete(workspaceId, subId) {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `DELETE FROM workspace_audit_webhook_subscriptions WHERE id=$1 AND workspace_id=$2`,
        [subId, workspaceId]
      );
    } catch (err) {
      console.error('[auditWebhookPush] DB delete error:', err.message);
    }
  }

  async loadFromDb(workspaceId) {
    if (!this.pool) return;
    try {
      const res = await this.pool.query(
        `SELECT * FROM workspace_audit_webhook_subscriptions WHERE workspace_id=$1`,
        [workspaceId]
      );
      const wsMap = this._getWsMap(workspaceId);
      for (const row of res.rows) {
        const sub = new AuditWebhookSubscription({
          id:          row.id,
          workspaceId: row.workspace_id,
          url:         row.url,
          secret:      row.secret,
          eventTypes:  typeof row.event_types === 'string' ? JSON.parse(row.event_types) : row.event_types,
          active:      row.active,
          description: row.description,
          createdAt:   row.created_at,
          updatedAt:   row.updated_at,
        });
        wsMap.set(sub.id, sub);
      }
    } catch (err) {
      console.error('[auditWebhookPush] DB load error:', err.message);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Exports ──────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV === 'test') {
  module.exports = {
    AuditWebhookPushService,
    AuditWebhookSubscription,
    AuditWebhookNotFoundError,
    AuditWebhookLimitError,
    AuditWebhookValidationError,
    MAX_SUBSCRIPTIONS_PER_WORKSPACE,
    AUDIT_WILDCARD,
  };
} else {
  module.exports = {
    AuditWebhookPushService,
    AuditWebhookNotFoundError,
    AuditWebhookLimitError,
    AuditWebhookValidationError,
  };
}
