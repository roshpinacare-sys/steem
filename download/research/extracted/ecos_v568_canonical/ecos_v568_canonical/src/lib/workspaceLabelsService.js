/**
 * lib/workspaceLabelsService.js — V161
 * ======================================
 * Workspace Labels System
 * ניהול תוויות צבעוניות לtasks — label CRUD + apply/remove + filter
 *
 * תכונות:
 *  - CRUD מלא לlabels (name, color, description) per workspace
 *  - Apply / remove label מ-task (many-to-many)
 *  - Filter tasks by label
 *  - Statistics: most-used labels, task count per label
 *  - DB integration: workspace_labels + workspace_task_labels
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V161-TASK-01]
 */

'use strict';

const crypto = require('crypto');

const HEX_COLOR_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

// ── Errors ────────────────────────────────────────────────────────────────
class LabelNotFoundError extends Error {
  constructor(id) {
    super(`Label not found: ${id}`);
    this.name = 'LabelNotFoundError';
    this.code = 'LABEL_NOT_FOUND';
    this.statusCode = 404;
  }
}

class LabelAlreadyAppliedError extends Error {
  constructor(labelId, taskId) {
    super(`Label ${labelId} already applied to task ${taskId}`);
    this.name = 'LabelAlreadyAppliedError';
    this.code = 'LABEL_ALREADY_APPLIED';
    this.statusCode = 409;
  }
}

// ── Label record ──────────────────────────────────────────────────────────
class Label {
  constructor(data) {
    this.id          = data.id          || `lbl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.name        = (data.name        || '').trim().slice(0, 100);
    this.color       = HEX_COLOR_RE.test(data.color || '') ? data.color : '#6B7280';
    this.description = (data.description || '').slice(0, 500);
    this.createdBy   = data.createdBy   || null;
    this.createdAt   = data.createdAt   || new Date().toISOString();
    this.updatedAt   = data.updatedAt   || new Date().toISOString();
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      name:        this.name,
      color:       this.color,
      description: this.description,
      createdBy:   this.createdBy,
      createdAt:   this.createdAt,
      updatedAt:   this.updatedAt,
    };
  }
}

// ── WorkspaceLabelsService ────────────────────────────────────────────────
class WorkspaceLabelsService {
  /**
   * @param {object} [opts]
   * @param {import('pg').Pool} [opts.db]
   * @param {object} [opts.logger]
   */
  constructor(opts = {}) {
    this._db  = opts.db  || null;
    this._log = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };

    // in-memory stores
    this._labels     = new Map(); // labelId → Label
    this._taskLabels = new Map(); // `${workspaceId}:${taskId}:${labelId}` → { labelId, taskId, workspaceId, appliedAt, appliedBy }
  }

  setDb(pool)    { this._db = pool; }
  setLogger(log) { this._log = log; }

  // ── CRUD ────────────────────────────────────────────────────────────────

  /**
   * Create a new label in a workspace.
   * @param {string} workspaceId
   * @param {{ name: string, color?: string, description?: string, createdBy?: string }} data
   * @returns {Promise<Label>}
   */
  async createLabel(workspaceId, data) {
    if (!workspaceId) throw new Error('workspaceId is required');
    if (!data.name || !data.name.trim()) throw new Error('name is required');

    const label = new Label({ ...data, workspaceId });
    this._labels.set(label.id, label);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_labels (id, workspace_id, name, color, description, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
          [label.id, label.workspaceId, label.name, label.color, label.description,
           label.createdBy, label.createdAt, label.updatedAt]
        );
      } catch (e) { this._log.warn({ err: e }, 'workspaceLabels.createLabel DB error'); }
    }

    return label;
  }

  /**
   * List all labels for a workspace.
   * @param {string} workspaceId
   * @returns {Promise<Label[]>}
   */
  async listLabels(workspaceId) {
    if (!workspaceId) throw new Error('workspaceId is required');
    const mem = [...this._labels.values()]
      .filter(l => l.workspaceId === workspaceId)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (this._db) {
      try {
        const { rows } = await this._db.query(
          `SELECT * FROM workspace_labels WHERE workspace_id=$1 ORDER BY name ASC`,
          [workspaceId]
        );
        return rows.map(r => new Label({
          id: r.id, workspaceId: r.workspace_id, name: r.name,
          color: r.color, description: r.description, createdBy: r.created_by,
          createdAt: r.created_at, updatedAt: r.updated_at,
        }));
      } catch (e) { this._log.warn({ err: e }, 'workspaceLabels.listLabels DB error'); }
    }
    return mem;
  }

  /**
   * Get a single label by id.
   */
  async getLabel(workspaceId, labelId) {
    const label = this._labels.get(labelId);
    if (label && label.workspaceId === workspaceId) return label;
    if (this._db) {
      try {
        const { rows } = await this._db.query(
          `SELECT * FROM workspace_labels WHERE id=$1 AND workspace_id=$2`,
          [labelId, workspaceId]
        );
        if (rows.length) return new Label({ id: rows[0].id, workspaceId: rows[0].workspace_id, name: rows[0].name, color: rows[0].color, description: rows[0].description, createdBy: rows[0].created_by, createdAt: rows[0].created_at, updatedAt: rows[0].updated_at });
      } catch (e) { this._log.warn({ err: e }, 'workspaceLabels.getLabel DB error'); }
    }
    throw new LabelNotFoundError(labelId);
  }

  /**
   * Update a label's properties.
   */
  async updateLabel(workspaceId, labelId, updates) {
    const label = await this.getLabel(workspaceId, labelId);
    if (updates.name       !== undefined) label.name        = (updates.name || '').trim().slice(0, 100);
    if (updates.color      !== undefined) label.color       = HEX_COLOR_RE.test(updates.color || '') ? updates.color : label.color;
    if (updates.description !== undefined) label.description = (updates.description || '').slice(0, 500);
    label.updatedAt = new Date().toISOString();
    this._labels.set(label.id, label);

    if (this._db) {
      try {
        await this._db.query(
          `UPDATE workspace_labels SET name=$1, color=$2, description=$3, updated_at=$4 WHERE id=$5 AND workspace_id=$6`,
          [label.name, label.color, label.description, label.updatedAt, labelId, workspaceId]
        );
      } catch (e) { this._log.warn({ err: e }, 'workspaceLabels.updateLabel DB error'); }
    }
    return label;
  }

  /**
   * Delete a label and all its task associations.
   */
  async deleteLabel(workspaceId, labelId) {
    const label = await this.getLabel(workspaceId, labelId);
    this._labels.delete(label.id);

    // remove all task-label associations
    for (const [key] of this._taskLabels) {
      if (key.includes(`:${labelId}`)) this._taskLabels.delete(key);
    }

    if (this._db) {
      try {
        await this._db.query(`DELETE FROM workspace_task_labels WHERE workspace_id=$1 AND label_id=$2`, [workspaceId, labelId]);
        await this._db.query(`DELETE FROM workspace_labels WHERE id=$1 AND workspace_id=$2`, [labelId, workspaceId]);
      } catch (e) { this._log.warn({ err: e }, 'workspaceLabels.deleteLabel DB error'); }
    }
    return { deleted: true, labelId };
  }

  // ── Apply / Remove ────────────────────────────────────────────────────

  /**
   * Apply a label to a task.
   */
  async applyLabel(workspaceId, taskId, labelId, appliedBy) {
    // verify label exists
    await this.getLabel(workspaceId, labelId);

    const key = `${workspaceId}:${taskId}:${labelId}`;
    if (this._taskLabels.has(key)) throw new LabelAlreadyAppliedError(labelId, taskId);

    const rec = { workspaceId, taskId, labelId, appliedBy: appliedBy || null, appliedAt: new Date().toISOString() };
    this._taskLabels.set(key, rec);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_task_labels (workspace_id, task_id, label_id, applied_by, applied_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id, task_id, label_id) DO NOTHING`,
          [workspaceId, taskId, labelId, appliedBy, rec.appliedAt]
        );
      } catch (e) { this._log.warn({ err: e }, 'workspaceLabels.applyLabel DB error'); }
    }
    return rec;
  }

  /**
   * Remove a label from a task.
   */
  async removeLabel(workspaceId, taskId, labelId) {
    const key = `${workspaceId}:${taskId}:${labelId}`;
    const existed = this._taskLabels.has(key);
    this._taskLabels.delete(key);

    if (this._db) {
      try {
        await this._db.query(
          `DELETE FROM workspace_task_labels WHERE workspace_id=$1 AND task_id=$2 AND label_id=$3`,
          [workspaceId, taskId, labelId]
        );
      } catch (e) { this._log.warn({ err: e }, 'workspaceLabels.removeLabel DB error'); }
    }
    return { removed: existed, taskId, labelId };
  }

  /**
   * Get all labels applied to a specific task.
   */
  async getTaskLabels(workspaceId, taskId) {
    const labelIds = [...this._taskLabels.values()]
      .filter(r => r.workspaceId === workspaceId && r.taskId === taskId)
      .map(r => r.labelId);

    const labels = [];
    for (const id of labelIds) {
      try { labels.push(await this.getLabel(workspaceId, id)); } catch (_) {}
    }
    return labels;
  }

  /**
   * List all tasks that have a specific label applied.
   */
  async getTasksByLabel(workspaceId, labelId) {
    await this.getLabel(workspaceId, labelId); // ensure label exists
    return [...this._taskLabels.values()]
      .filter(r => r.workspaceId === workspaceId && r.labelId === labelId)
      .map(r => ({ taskId: r.taskId, appliedBy: r.appliedBy, appliedAt: r.appliedAt }));
  }

  // ── Stats ─────────────────────────────────────────────────────────────

  /**
   * Return label usage statistics for a workspace.
   */
  stats(workspaceId) {
    const labels = [...this._labels.values()].filter(l => l.workspaceId === workspaceId);
    const usageMap = {};
    for (const rec of this._taskLabels.values()) {
      if (rec.workspaceId !== workspaceId) continue;
      usageMap[rec.labelId] = (usageMap[rec.labelId] || 0) + 1;
    }
    const withCounts = labels.map(l => ({ ...l.toJSON(), taskCount: usageMap[l.id] || 0 }))
      .sort((a, b) => b.taskCount - a.taskCount);
    return {
      totalLabels:      labels.length,
      totalAssignments: Object.values(usageMap).reduce((s, v) => s + v, 0),
      labels:           withCounts,
    };
  }
}

// ── Singleton export ──────────────────────────────────────────────────────
const defaultLabelsService = new WorkspaceLabelsService();

module.exports = {
  WorkspaceLabelsService,
  defaultLabelsService,
  LabelNotFoundError,
  LabelAlreadyAppliedError,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._labels     = defaultLabelsService;
  module.exports.Label       = Label;
}
