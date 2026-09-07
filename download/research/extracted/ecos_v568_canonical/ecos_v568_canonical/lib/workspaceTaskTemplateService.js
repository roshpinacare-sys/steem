/**
 * lib/workspaceTaskTemplateService.js — V160
 * =============================================
 * Workspace Task Template System
 * שמירת task כ-template ויצירת task חדשה ממנה
 *
 * תכונות:
 *  - שמירת task כ-template (title, description, tags, priority, metadata, defaultAssigneeId)
 *  - Instantiate template → task חדשה ב-WorkspaceTaskService
 *  - CRUD מלא לtemplates
 *  - Category ו-tags על templates לגישה מהירה
 *  - DB integration: טבלת workspace_task_templates
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V160-TASK-04]
 */

'use strict';

const crypto = require('crypto');

const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];

// ── TaskTemplate record ────────────────────────────────────────────────────
class TaskTemplate {
  constructor(data) {
    this.id                 = data.id                 || `tpl_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId        = data.workspaceId;
    this.name               = (data.name         || '').trim().slice(0, 200);
    this.description        = (data.description  || '').slice(0, 5000);
    this.defaultTitle       = (data.defaultTitle || data.name || '').slice(0, 500);
    this.defaultDescription = (data.defaultDescription || data.description || '').slice(0, 5000);
    this.defaultPriority    = VALID_PRIORITIES.includes(data.defaultPriority)
      ? data.defaultPriority : 'medium';
    this.defaultAssigneeId  = data.defaultAssigneeId  || null;
    this.defaultTags        = Array.isArray(data.defaultTags) ? data.defaultTags : [];
    this.defaultMetadata    = data.defaultMetadata    || {};
    this.category           = (data.category || '').slice(0, 100);
    this.timesUsed          = data.timesUsed          || 0;
    this.createdBy          = data.createdBy          || null;
    this.createdAt          = data.createdAt          || new Date().toISOString();
    this.updatedAt          = data.updatedAt          || new Date().toISOString();
  }

  toJSON() {
    return {
      id:                 this.id,
      workspaceId:        this.workspaceId,
      name:               this.name,
      description:        this.description,
      defaultTitle:       this.defaultTitle,
      defaultDescription: this.defaultDescription,
      defaultPriority:    this.defaultPriority,
      defaultAssigneeId:  this.defaultAssigneeId,
      defaultTags:        this.defaultTags,
      defaultMetadata:    this.defaultMetadata,
      category:           this.category,
      timesUsed:          this.timesUsed,
      createdBy:          this.createdBy,
      createdAt:          this.createdAt,
      updatedAt:          this.updatedAt,
    };
  }
}

// ── WorkspaceTaskTemplateService ───────────────────────────────────────────
class WorkspaceTaskTemplateService {
  /**
   * @param {object} opts
   * @param {object} opts.logger  pino logger
   * @param {object} opts.db      pg pool (optional)
   * @param {object} opts.taskSvc WorkspaceTaskService instance (for instantiation)
   */
  constructor({ logger = null, db = null, taskSvc = null } = {}) {
    /** @type {Map<string, TaskTemplate>} id → template */
    this._templates = new Map();
    this._db        = db;
    this._log       = logger || { info: () => {}, warn: () => {} };
    this._taskSvc   = taskSvc;
    this._version   = 'V160';
  }

  setDb(db) { this._db = db; }
  setTaskService(svc) { this._taskSvc = svc; }

  // ── create template ────────────────────────────────────────────────────────
  async createTemplate(workspaceId, data) {
    if (!workspaceId)  throw new Error('workspaceId required');
    if (!data.name)    throw new Error('name required');

    const tpl = new TaskTemplate({ ...data, workspaceId });
    this._templates.set(tpl.id, tpl);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_task_templates
            (id, workspace_id, name, description, default_title, default_description,
             default_priority, default_assignee_id, default_tags, default_metadata,
             category, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (id) DO NOTHING`,
          [
            tpl.id, workspaceId, tpl.name, tpl.description,
            tpl.defaultTitle, tpl.defaultDescription, tpl.defaultPriority,
            tpl.defaultAssigneeId,
            JSON.stringify(tpl.defaultTags),
            JSON.stringify(tpl.defaultMetadata),
            tpl.category, tpl.createdBy, tpl.createdAt, tpl.updatedAt,
          ]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[templateService] DB insert failed (in-memory)');
      }
    }

    this._log.info({ id: tpl.id, workspaceId, name: tpl.name }, '[templateService] template created');
    return tpl.toJSON();
  }

  // ── save existing task as template ─────────────────────────────────────────
  async saveTaskAsTemplate(workspaceId, task, templateData = {}) {
    if (!task) throw new Error('task required');
    return this.createTemplate(workspaceId, {
      name:               templateData.name        || task.title,
      description:        templateData.description || `Template from task: ${task.id}`,
      defaultTitle:       task.title,
      defaultDescription: task.description,
      defaultPriority:    task.priority,
      defaultAssigneeId:  templateData.assigneeId !== undefined ? templateData.assigneeId : task.assigneeId,
      defaultTags:        task.tags,
      defaultMetadata:    task.metadata || {},
      category:           templateData.category || '',
      createdBy:          templateData.createdBy || null,
    });
  }

  // ── get template ─────────────────────────────────────────────────────────
  async getTemplate(workspaceId, templateId) {
    const cached = this._templates.get(templateId);
    if (cached && cached.workspaceId === workspaceId) return cached.toJSON();

    if (this._db) {
      try {
        const r = await this._db.query(
          `SELECT * FROM workspace_task_templates WHERE id=$1 AND workspace_id=$2`,
          [templateId, workspaceId]
        );
        if (r.rows[0]) {
          const row = r.rows[0];
          const tpl = this._rowToTemplate(row);
          this._templates.set(tpl.id, tpl);
          return tpl.toJSON();
        }
      } catch (err) {
        this._log.warn({ err: err.message }, '[templateService] DB get failed');
      }
    }
    return null;
  }

  // ── list templates ────────────────────────────────────────────────────────
  async listTemplates(workspaceId, opts = {}) {
    const { category, limit = 50, cursor = null } = opts;

    if (this._db) {
      try {
        const conditions = ['workspace_id=$1'];
        const params     = [workspaceId];
        if (category) { conditions.push(`category=$${params.length + 1}`); params.push(category); }
        const r = await this._db.query(
          `SELECT * FROM workspace_task_templates WHERE ${conditions.join(' AND ')}
           ORDER BY times_used DESC, created_at DESC LIMIT $${params.length + 1}`,
          [...params, Math.min(limit, 200)]
        );
        return r.rows.map(row => this._rowToTemplate(row).toJSON());
      } catch (err) {
        this._log.warn({ err: err.message }, '[templateService] DB list failed, using memory');
      }
    }

    let templates = [...this._templates.values()].filter(t => t.workspaceId === workspaceId);
    if (category) templates = templates.filter(t => t.category === category);
    return templates
      .sort((a, b) => b.timesUsed - a.timesUsed || new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map(t => t.toJSON());
  }

  // ── update template ───────────────────────────────────────────────────────
  async updateTemplate(workspaceId, templateId, patch) {
    const existing = await this.getTemplate(workspaceId, templateId);
    if (!existing) return null;

    const allowed = ['name', 'description', 'defaultTitle', 'defaultDescription',
                     'defaultPriority', 'defaultAssigneeId', 'defaultTags',
                     'defaultMetadata', 'category'];
    const updated  = { ...existing };
    for (const k of allowed) {
      if (k in patch) updated[k] = patch[k];
    }
    updated.updatedAt = new Date().toISOString();

    const tpl = new TaskTemplate({ ...updated, workspaceId });
    this._templates.set(templateId, tpl);

    if (this._db) {
      try {
        await this._db.query(
          `UPDATE workspace_task_templates
           SET name=$3, description=$4, default_title=$5, default_description=$6,
               default_priority=$7, default_assignee_id=$8, default_tags=$9,
               default_metadata=$10, category=$11, updated_at=NOW()
           WHERE id=$1 AND workspace_id=$2`,
          [
            templateId, workspaceId, tpl.name, tpl.description,
            tpl.defaultTitle, tpl.defaultDescription, tpl.defaultPriority,
            tpl.defaultAssigneeId,
            JSON.stringify(tpl.defaultTags),
            JSON.stringify(tpl.defaultMetadata),
            tpl.category,
          ]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[templateService] DB update failed');
      }
    }

    return tpl.toJSON();
  }

  // ── delete template ───────────────────────────────────────────────────────
  async deleteTemplate(workspaceId, templateId) {
    const tpl = this._templates.get(templateId);
    if (tpl && tpl.workspaceId === workspaceId) this._templates.delete(templateId);

    if (this._db) {
      try {
        await this._db.query(
          `DELETE FROM workspace_task_templates WHERE id=$1 AND workspace_id=$2`,
          [templateId, workspaceId]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[templateService] DB delete failed');
      }
    }

    return tpl ? tpl.toJSON() : null;
  }

  // ── instantiate template → create task ────────────────────────────────────
  async instantiate(workspaceId, templateId, overrides = {}) {
    const tpl = await this.getTemplate(workspaceId, templateId);
    if (!tpl) throw new Error(`Template ${templateId} not found`);

    const taskData = {
      title:       overrides.title      || tpl.defaultTitle      || tpl.name,
      description: overrides.description !== undefined ? overrides.description : tpl.defaultDescription,
      priority:    overrides.priority    || tpl.defaultPriority,
      assigneeId:  overrides.assigneeId  !== undefined ? overrides.assigneeId  : tpl.defaultAssigneeId,
      tags:        overrides.tags        || tpl.defaultTags,
      metadata:    { ...tpl.defaultMetadata, ...(overrides.metadata || {}), fromTemplate: templateId },
      dueAt:       overrides.dueAt       || null,
    };

    // Increment usage counter
    const record = this._templates.get(templateId);
    if (record) record.timesUsed++;
    if (this._db) {
      this._db.query(
        `UPDATE workspace_task_templates SET times_used = times_used + 1 WHERE id=$1`,
        [templateId]
      ).catch(() => {});
    }

    if (this._taskSvc) {
      const task = await this._taskSvc.createTask(workspaceId, taskData);
      this._log.info({ templateId, taskId: task.id }, '[templateService] task instantiated from template');
      return { task, template: tpl };
    }

    // Return task data without creating (no taskSvc wired)
    return { taskData, template: tpl, note: 'WorkspaceTaskService not wired — task data returned only' };
  }

  // ── list categories in workspace ──────────────────────────────────────────
  async listCategories(workspaceId) {
    const templates = await this.listTemplates(workspaceId, { limit: 1000 });
    const cats      = {};
    for (const t of templates) {
      if (t.category) cats[t.category] = (cats[t.category] || 0) + 1;
    }
    return Object.entries(cats).map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  stats(workspaceId = null) {
    let all = [...this._templates.values()];
    if (workspaceId) all = all.filter(t => t.workspaceId === workspaceId);
    const totalUsage = all.reduce((s, t) => s + t.timesUsed, 0);
    return {
      totalTemplates: all.length,
      totalUsage,
      avgUsage:       all.length ? parseFloat((totalUsage / all.length).toFixed(2)) : 0,
      version:        this._version,
    };
  }

  // ── private: row → TaskTemplate ───────────────────────────────────────────
  _rowToTemplate(row) {
    const parsedTags = typeof row.default_tags === 'string'
      ? JSON.parse(row.default_tags)
      : (row.default_tags || []);
    const parsedMeta = typeof row.default_metadata === 'string'
      ? JSON.parse(row.default_metadata)
      : (row.default_metadata || {});

    return new TaskTemplate({
      id:                 row.id,
      workspaceId:        row.workspace_id,
      name:               row.name,
      description:        row.description,
      defaultTitle:       row.default_title,
      defaultDescription: row.default_description,
      defaultPriority:    row.default_priority,
      defaultAssigneeId:  row.default_assignee_id,
      defaultTags:        parsedTags,
      defaultMetadata:    parsedMeta,
      category:           row.category,
      timesUsed:          row.times_used || 0,
      createdBy:          row.created_by,
      createdAt:          row.created_at,
      updatedAt:          row.updated_at,
    });
  }
}

const defaultTemplateService = new WorkspaceTaskTemplateService();

module.exports = {
  WorkspaceTaskTemplateService,
  TaskTemplate,
  defaultTemplateService,
  VALID_PRIORITIES,
};
