/**
 * lib/workspaceWebhookService.js — V159
 * =======================================
 * Workspace Webhook Notification Service
 * שירות Webhook לשליחת התראות HTTP על אירועי workspace לנקודות קצה חיצוניות
 *
 * תכונות:
 *  - רישום/מחיקת webhooks לכל workspace
 *  - שליחה אוטומטית על task.created/updated/assigned/done/deleted/comment_added
 *  - Retry logic: 3 ניסיונות, exponential backoff (1s, 4s, 16s)
 *  - HMAC-SHA256 signature ב-X-ECOS-Signature header
 *  - יומן deliveries (אחרונות 100 לכל webhook)
 *  - DB integration (טבלת workspace_webhooks)
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — לא נגענו
 * [V159-TASK-01]
 */

'use strict';

const crypto = require('crypto');
const https  = require('https');
const http   = require('http');
const { URL } = require('url');

// ── אירועים חוקיים ──────────────────────────────────────────────────────────
const WEBHOOK_EVENTS = [
  'task.created', 'task.updated', 'task.assigned', 'task.done',
  'task.deleted', 'task.comment_added', 'task.overdue', 'task.due_soon',
  'member.added', 'member.removed', 'workspace.archived', 'workspace.restored',
  '*', // wildcard — כל האירועים
];

// ── WorkspaceWebhook record ──────────────────────────────────────────────────
class WorkspaceWebhook {
  constructor(data) {
    this.id          = data.id          || `wh_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.url         = data.url;
    this.secret      = data.secret      || crypto.randomBytes(24).toString('hex');
    this.events      = Array.isArray(data.events) ? data.events : ['*'];
    this.active      = data.active !== false;
    this.description = (data.description || '').slice(0, 200);
    this.createdAt   = data.createdAt   || new Date().toISOString();
    this.updatedAt   = data.updatedAt   || new Date().toISOString();
    this.deliveries  = []; // circular buffer — max 100
    this._deliveryCount = 0;
    this._successCount  = 0;
    this._failCount     = 0;
  }

  toJSON(includeSecret = false) {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      url:         this.url,
      secret:      includeSecret ? this.secret : `${this.secret.slice(0, 4)}****`,
      events:      this.events,
      active:      this.active,
      description: this.description,
      createdAt:   this.createdAt,
      updatedAt:   this.updatedAt,
      deliveryStats: {
        total:    this._deliveryCount,
        success:  this._successCount,
        failure:  this._failCount,
      },
      recentDeliveries: this.deliveries.slice(-5),
    };
  }

  subscribesTo(eventType) {
    if (!this.active) return false;
    return this.events.includes('*') || this.events.includes(eventType);
  }

  recordDelivery(delivery) {
    this._deliveryCount++;
    if (delivery.success) this._successCount++;
    else                  this._failCount++;
    this.deliveries.push(delivery);
    if (this.deliveries.length > 100) this.deliveries.shift();
  }
}

// ── WorkspaceWebhookService ──────────────────────────────────────────────────
class WorkspaceWebhookService {
  /**
   * @param {object} opts
   * @param {object} opts.db      pg pool (optional)
   * @param {object} opts.logger  pino logger (optional)
   * @param {number} opts.timeoutMs HTTP request timeout (default: 10000)
   */
  constructor({ db = null, logger = null, timeoutMs = 10000 } = {}) {
    /** @type {Map<string, Map<string, WorkspaceWebhook>>} workspaceId → hookId → hook */
    this._store     = new Map();
    this._db        = db;
    this._log       = logger || { info: () => {}, warn: () => {}, error: () => {} };
    this._timeoutMs = timeoutMs;
    this._version   = 'V159';
  }

  setDb(db) { this._db = db; }

  _wsStore(workspaceId) {
    if (!this._store.has(workspaceId)) this._store.set(workspaceId, new Map());
    return this._store.get(workspaceId);
  }

  // ── רישום webhook ────────────────────────────────────────────────────────
  async registerWebhook(workspaceId, data) {
    if (!workspaceId) throw new Error('workspaceId required');
    if (!data.url)    throw new Error('url required');
    // Validate URL
    try { new URL(data.url); } catch (_) { throw new Error('Invalid webhook URL'); }
    if (!data.url.startsWith('http://') && !data.url.startsWith('https://')) {
      throw new Error('Webhook URL must start with http:// or https://');
    }
    // Validate events
    const events = data.events || ['*'];
    for (const ev of events) {
      if (!WEBHOOK_EVENTS.includes(ev)) throw new Error(`Unknown event: ${ev}. Valid: ${WEBHOOK_EVENTS.join(', ')}`);
    }

    const hook = new WorkspaceWebhook({ ...data, workspaceId });
    this._wsStore(workspaceId).set(hook.id, hook);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_webhooks
            (id, workspace_id, url, secret, events, active, description, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO NOTHING`,
          [hook.id, workspaceId, hook.url, hook.secret, JSON.stringify(hook.events),
           hook.active, hook.description, hook.createdAt, hook.updatedAt]
        );
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[webhookService] DB insert failed (in-memory persisted)');
      }
    }

    this._log.info({ hookId: hook.id, workspaceId, url: hook.url }, '[webhookService] webhook registered');
    return hook.toJSON(true); // return secret on creation
  }

  // ── עדכון webhook ─────────────────────────────────────────────────────────
  async updateWebhook(workspaceId, hookId, patch) {
    const now  = new Date().toISOString();
    const hook = this._wsStore(workspaceId).get(hookId);
    if (!hook) return null;

    const allowed = ['url', 'events', 'active', 'description'];
    for (const k of allowed) {
      if (k in patch) {
        if (k === 'url') {
          try { new URL(patch.url); } catch (_) { throw new Error('Invalid webhook URL'); }
        }
        if (k === 'events') {
          for (const ev of patch.events) {
            if (!WEBHOOK_EVENTS.includes(ev)) throw new Error(`Unknown event: ${ev}`);
          }
        }
        hook[k] = patch[k];
      }
    }
    hook.updatedAt = now;

    if (this._db) {
      try {
        const updates = [];
        const vals    = [workspaceId, hookId];
        let   idx     = 3;
        for (const k of allowed) {
          if (k in patch) {
            const col = k === 'active' ? 'active' : k === 'events' ? 'events' : k.replace(/([A-Z])/g, '_$1').toLowerCase();
            updates.push(`${col} = $${idx++}`);
            vals.push(k === 'events' ? JSON.stringify(patch[k]) : patch[k]);
          }
        }
        updates.push(`updated_at = $${idx}`);
        vals.push(now);
        if (updates.length > 1) {
          await this._db.query(
            `UPDATE workspace_webhooks SET ${updates.join(', ')} WHERE workspace_id=$1 AND id=$2`,
            vals
          );
        }
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[webhookService] DB update failed (non-fatal)');
      }
    }

    return hook.toJSON();
  }

  // ── מחיקת webhook ─────────────────────────────────────────────────────────
  async deleteWebhook(workspaceId, hookId) {
    const existed = this._wsStore(workspaceId).has(hookId);
    this._wsStore(workspaceId).delete(hookId);
    if (this._db) {
      try {
        await this._db.query(
          'DELETE FROM workspace_webhooks WHERE workspace_id=$1 AND id=$2',
          [workspaceId, hookId]
        );
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[webhookService] DB delete failed (non-fatal)');
      }
    }
    return existed;
  }

  // ── רשימת webhooks ────────────────────────────────────────────────────────
  async listWebhooks(workspaceId) {
    if (this._db) {
      try {
        const r = await this._db.query(
          'SELECT * FROM workspace_webhooks WHERE workspace_id=$1 ORDER BY created_at DESC',
          [workspaceId]
        );
        // merge with in-memory for delivery stats
        return r.rows.map(row => {
          const inMem = this._wsStore(workspaceId).get(row.id);
          return {
            id:          row.id,
            workspaceId: row.workspace_id,
            url:         row.url,
            secret:      `${row.secret.slice(0, 4)}****`,
            events:      typeof row.events === 'string' ? JSON.parse(row.events) : row.events,
            active:      row.active,
            description: row.description,
            createdAt:   row.created_at,
            updatedAt:   row.updated_at,
            deliveryStats: inMem ? { total: inMem._deliveryCount, success: inMem._successCount, failure: inMem._failCount } : { total: 0, success: 0, failure: 0 },
          };
        });
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[webhookService] DB list failed, fallback to memory');
      }
    }
    return [...this._wsStore(workspaceId).values()].map(h => h.toJSON());
  }

  // ── קבלת webhook בודד ────────────────────────────────────────────────────
  getWebhook(workspaceId, hookId) {
    const h = this._wsStore(workspaceId).get(hookId);
    return h ? h.toJSON() : null;
  }

  // ── deliveries log ────────────────────────────────────────────────────────
  getDeliveries(workspaceId, hookId) {
    const h = this._wsStore(workspaceId).get(hookId);
    return h ? h.deliveries : [];
  }

  // ── שליחת אירוע לכל webhooks של workspace ───────────────────────────────
  async dispatch(workspaceId, eventType, payload) {
    const hooks = [...this._wsStore(workspaceId).values()].filter(h => h.subscribesTo(eventType));
    if (hooks.length === 0) return { dispatched: 0 };

    const results = await Promise.allSettled(
      hooks.map(hook => this._deliverWithRetry(hook, workspaceId, eventType, payload))
    );

    const dispatched = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    return { dispatched, total: hooks.length };
  }

  // ── שליחה עם retry ────────────────────────────────────────────────────────
  async _deliverWithRetry(hook, workspaceId, eventType, payload) {
    const deliveryId = `dlv_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const body = JSON.stringify({
      id:          deliveryId,
      workspaceId,
      event:       eventType,
      payload,
      sentAt:      new Date().toISOString(),
      hookId:      hook.id,
      version:     this._version,
    });
    const sig = this._sign(hook.secret, body);
    const delays = [0, 1000, 4000]; // immediate + 2 retries

    let lastError = null;
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) await this._sleep(delays[attempt]);
      try {
        const status = await this._post(hook.url, body, sig, deliveryId);
        if (status >= 200 && status < 300) {
          const delivery = { deliveryId, eventType, status, attempt, success: true, ts: new Date().toISOString() };
          hook.recordDelivery(delivery);
          this._log.info({ hookId: hook.id, eventType, status, attempt }, '[webhookService] delivery success');
          return delivery;
        }
        lastError = `HTTP ${status}`;
      } catch (err) {
        lastError = err.message;
        this._log.warn({ hookId: hook.id, attempt, err: err.message }, '[webhookService] delivery attempt failed');
      }
    }

    const delivery = { deliveryId, eventType, status: 0, attempt: delays.length, success: false, error: lastError, ts: new Date().toISOString() };
    hook.recordDelivery(delivery);
    this._log.error({ hookId: hook.id, eventType, error: lastError }, '[webhookService] all delivery attempts failed');
    return delivery;
  }

  // ── HTTP POST helper ─────────────────────────────────────────────────────
  _post(url, body, signature, deliveryId) {
    return new Promise((resolve, reject) => {
      const parsed  = new URL(url);
      const options = {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'POST',
        headers: {
          'Content-Type':    'application/json',
          'Content-Length':  Buffer.byteLength(body),
          'X-ECOS-Event':    '',
          'X-ECOS-Signature': signature,
          'X-ECOS-Delivery': deliveryId,
          'User-Agent':      `ECOS-Webhook/${this._version}`,
        },
        timeout: this._timeoutMs,
      };
      const transport = parsed.protocol === 'https:' ? https : http;
      const req = transport.request(options, (res) => {
        res.resume(); // drain
        resolve(res.statusCode);
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // ── HMAC-SHA256 signature ─────────────────────────────────────────────────
  _sign(secret, body) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  // ── בדיקת signature נכנסת ────────────────────────────────────────────────
  verifySignature(secret, body, incomingSig) {
    const expected = this._sign(secret, typeof body === 'string' ? body : JSON.stringify(body));
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(incomingSig || ''));
    } catch (_) { return false; }
  }

  // ── שליחת test delivery ───────────────────────────────────────────────────
  async testDeliver(workspaceId, hookId) {
    const hook = this._wsStore(workspaceId).get(hookId);
    if (!hook) return null;
    return this._deliverWithRetry(hook, workspaceId, 'test', {
      message: 'ECOS webhook test delivery',
      hookId,
      workspaceId,
      timestamp: new Date().toISOString(),
    });
  }

  // ── סטטיסטיקות delivery ──────────────────────────────────────────────────
  stats(workspaceId) {
    const hooks = [...this._wsStore(workspaceId).values()];
    let totalDeliveries = 0, totalSuccess = 0, totalFail = 0;
    for (const h of hooks) {
      totalDeliveries += h._deliveryCount;
      totalSuccess    += h._successCount;
      totalFail       += h._failCount;
    }
    return {
      workspaceId,
      hookCount:       hooks.length,
      activeHooks:     hooks.filter(h => h.active).length,
      totalDeliveries,
      totalSuccess,
      totalFail,
      successRate:     totalDeliveries > 0 ? (totalSuccess / totalDeliveries).toFixed(4) : null,
      version:         this._version,
    };
  }

  // ── dump (admin) ─────────────────────────────────────────────────────────
  dump() {
    const out = {};
    for (const [wsId, hooks] of this._store) {
      out[wsId] = [...hooks.values()].map(h => h.toJSON());
    }
    return out;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// Singleton
const defaultWebhookService = new WorkspaceWebhookService();

module.exports = {
  WorkspaceWebhookService,
  defaultWebhookService,
  WEBHOOK_EVENTS,
};
