/**
 * lib/workspaceQuotaService.js — V160
 * ======================================
 * Workspace Quota Manager
 * ניהול מכסות per-workspace: מגביל tasks, members, webhooks, templates
 *
 * תכונות:
 *  - הגדרת מכסה לכל workspace (maxTasks, maxMembers, maxWebhooks, maxTemplates, maxDependencies)
 *  - בדיקת מכסה לפני כל פעולת יצירה — 429 אם חורג
 *  - Admin override: הגדלת/הגבלת מכסה
 *  - Default quotas per plan: 'free' | 'pro' | 'enterprise' | 'unlimited'
 *  - DB integration: טבלת workspace_quotas
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V160-TASK-03]
 */

'use strict';

const crypto = require('crypto');

// ── Default quota plans ────────────────────────────────────────────────────
const QUOTA_PLANS = {
  free:       { maxTasks: 100,     maxMembers: 5,   maxWebhooks: 2,   maxTemplates: 5,   maxDependencies: 50    },
  pro:        { maxTasks: 2000,    maxMembers: 25,  maxWebhooks: 10,  maxTemplates: 50,  maxDependencies: 500   },
  enterprise: { maxTasks: 50000,   maxMembers: 200, maxWebhooks: 50,  maxTemplates: 500, maxDependencies: 10000 },
  unlimited:  { maxTasks: Infinity, maxMembers: Infinity, maxWebhooks: Infinity, maxTemplates: Infinity, maxDependencies: Infinity },
};

const DEFAULT_PLAN = 'pro';

// ── WorkspaceQuota record ──────────────────────────────────────────────────
class WorkspaceQuota {
  constructor(data) {
    this.workspaceId        = data.workspaceId;
    this.plan               = data.plan           || DEFAULT_PLAN;
    this.maxTasks           = data.maxTasks        != null ? data.maxTasks        : QUOTA_PLANS[this.plan].maxTasks;
    this.maxMembers         = data.maxMembers       != null ? data.maxMembers       : QUOTA_PLANS[this.plan].maxMembers;
    this.maxWebhooks        = data.maxWebhooks      != null ? data.maxWebhooks      : QUOTA_PLANS[this.plan].maxWebhooks;
    this.maxTemplates       = data.maxTemplates     != null ? data.maxTemplates     : QUOTA_PLANS[this.plan].maxTemplates;
    this.maxDependencies    = data.maxDependencies  != null ? data.maxDependencies  : QUOTA_PLANS[this.plan].maxDependencies;
    this.overrideBy         = data.overrideBy       || null;
    this.createdAt          = data.createdAt        || new Date().toISOString();
    this.updatedAt          = data.updatedAt        || new Date().toISOString();
  }

  toJSON() {
    return {
      workspaceId:     this.workspaceId,
      plan:            this.plan,
      maxTasks:        this.maxTasks,
      maxMembers:      this.maxMembers,
      maxWebhooks:     this.maxWebhooks,
      maxTemplates:    this.maxTemplates,
      maxDependencies: this.maxDependencies,
      overrideBy:      this.overrideBy,
      updatedAt:       this.updatedAt,
    };
  }
}

// ── QuotaExceededError ─────────────────────────────────────────────────────
class QuotaExceededError extends Error {
  constructor(resource, current, limit, workspaceId) {
    super(`Quota exceeded: ${resource} (${current}/${limit}) for workspace ${workspaceId}`);
    this.name        = 'QuotaExceededError';
    this.code        = 'QUOTA_EXCEEDED';
    this.resource    = resource;
    this.current     = current;
    this.limit       = limit;
    this.workspaceId = workspaceId;
    this.statusCode  = 429;
  }
}

// ── WorkspaceQuotaService ─────────────────────────────────────────────────
class WorkspaceQuotaService {
  /**
   * @param {object} opts
   * @param {object} opts.logger pino logger
   * @param {object} opts.db     pg pool (optional)
   */
  constructor({ logger = null, db = null } = {}) {
    /** @type {Map<string, WorkspaceQuota>} workspaceId → quota */
    this._quotas  = new Map();
    this._db      = db;
    this._log     = logger || { info: () => {}, warn: () => {} };
    this._version = 'V160';
  }

  setDb(db) { this._db = db; }

  // ── get quota for workspace (create default if missing) ──────────────────
  async getQuota(workspaceId) {
    if (this._quotas.has(workspaceId)) {
      return this._quotas.get(workspaceId).toJSON();
    }
    if (this._db) {
      try {
        const r = await this._db.query(
          `SELECT * FROM workspace_quotas WHERE workspace_id=$1`,
          [workspaceId]
        );
        if (r.rows[0]) {
          const row = r.rows[0];
          const q   = new WorkspaceQuota({
            workspaceId:     row.workspace_id,
            plan:            row.plan,
            maxTasks:        row.max_tasks,
            maxMembers:      row.max_members,
            maxWebhooks:     row.max_webhooks,
            maxTemplates:    row.max_templates,
            maxDependencies: row.max_dependencies,
            overrideBy:      row.override_by,
            createdAt:       row.created_at,
            updatedAt:       row.updated_at,
          });
          this._quotas.set(workspaceId, q);
          return q.toJSON();
        }
      } catch (err) {
        this._log.warn({ err: err.message }, '[quotaService] DB load failed, using default');
      }
    }
    // Create default
    return this.setQuota(workspaceId, { plan: DEFAULT_PLAN });
  }

  // ── set or update quota ──────────────────────────────────────────────────
  async setQuota(workspaceId, data) {
    const existing = this._quotas.get(workspaceId);
    const q = new WorkspaceQuota({
      ...(existing ? existing : {}),
      ...data,
      workspaceId,
      updatedAt: new Date().toISOString(),
    });
    this._quotas.set(workspaceId, q);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_quotas
            (workspace_id, plan, max_tasks, max_members, max_webhooks, max_templates, max_dependencies, override_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
           ON CONFLICT (workspace_id) DO UPDATE
             SET plan=$2, max_tasks=$3, max_members=$4, max_webhooks=$5,
                 max_templates=$6, max_dependencies=$7, override_by=$8, updated_at=NOW()`,
          [workspaceId, q.plan, q.maxTasks, q.maxMembers, q.maxWebhooks, q.maxTemplates, q.maxDependencies, q.overrideBy]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[quotaService] DB upsert failed (in-memory persisted)');
      }
    }

    return q.toJSON();
  }

  // ── check quota (throw QuotaExceededError if exceeded) ───────────────────
  async checkQuota(workspaceId, resource, currentCount) {
    const quota   = await this.getQuota(workspaceId);
    const limitKey = {
      tasks:        'maxTasks',
      members:      'maxMembers',
      webhooks:     'maxWebhooks',
      templates:    'maxTemplates',
      dependencies: 'maxDependencies',
    }[resource];

    if (!limitKey) throw new Error(`Unknown resource type: ${resource}`);

    const limit = quota[limitKey];
    if (limit === Infinity || limit === -1) return { ok: true, resource, current: currentCount, limit, remaining: Infinity };
    if (currentCount >= limit) {
      throw new QuotaExceededError(resource, currentCount, limit, workspaceId);
    }
    return {
      ok:        true,
      resource,
      current:   currentCount,
      limit,
      remaining: limit - currentCount,
      usagePct:  parseFloat((currentCount / limit * 100).toFixed(1)),
    };
  }

  // ── admin override quota ──────────────────────────────────────────────────
  async adminOverride(workspaceId, overrides, adminId) {
    const current = await this.getQuota(workspaceId);
    return this.setQuota(workspaceId, { ...current, ...overrides, overrideBy: adminId });
  }

  // ── get usage summary ─────────────────────────────────────────────────────
  async getUsageSummary(workspaceId, countsProvider = null) {
    const quota   = await this.getQuota(workspaceId);
    const counts  = typeof countsProvider === 'function' ? await countsProvider(workspaceId) : {};
    const resources = ['tasks', 'members', 'webhooks', 'templates', 'dependencies'];
    const usage   = {};
    for (const res of resources) {
      const current = counts[res] || 0;
      const limit   = quota[`max${res.charAt(0).toUpperCase() + res.slice(1)}`];
      usage[res]    = {
        current,
        limit:      limit === Infinity ? null : limit,
        remaining:  limit === Infinity ? null : Math.max(0, limit - current),
        usagePct:   limit === Infinity || limit === 0 ? 0 : parseFloat((current / limit * 100).toFixed(1)),
        exceeded:   limit !== Infinity && current >= limit,
      };
    }
    return { workspaceId, plan: quota.plan, usage, updatedAt: quota.updatedAt };
  }

  // ── list all quotas ───────────────────────────────────────────────────────
  listAll() {
    return [...this._quotas.values()].map(q => q.toJSON());
  }

  // ── available plans ───────────────────────────────────────────────────────
  getPlans() {
    return Object.entries(QUOTA_PLANS).map(([name, limits]) => ({ name, ...limits }));
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  stats() {
    const quotas   = [...this._quotas.values()];
    const byPlan   = {};
    for (const q of quotas) byPlan[q.plan] = (byPlan[q.plan] || 0) + 1;
    return {
      totalWorkspacesWithQuota: quotas.length,
      byPlan,
      defaultPlan: DEFAULT_PLAN,
      version:     this._version,
    };
  }
}

// Express middleware factory
function quotaMiddleware(quotaService, resource, countFetcher) {
  return async (req, res, next) => {
    const workspaceId = req.params.workspaceId || req.params.id;
    if (!workspaceId) return next();
    try {
      const count = typeof countFetcher === 'function' ? await countFetcher(workspaceId, req) : 0;
      await quotaService.checkQuota(workspaceId, resource, count);
      next();
    } catch (err) {
      if (err.code === 'QUOTA_EXCEEDED') {
        return res.status(429).json({
          ok: false,
          error: err.message,
          resource: err.resource,
          current: err.current,
          limit: err.limit,
          ecosVersion: 'V160',
        });
      }
      next(err);
    }
  };
}

const defaultQuotaService = new WorkspaceQuotaService();

module.exports = {
  WorkspaceQuotaService,
  WorkspaceQuota,
  QuotaExceededError,
  QUOTA_PLANS,
  DEFAULT_PLAN,
  quotaMiddleware,
  defaultQuotaService,
};
