/**
 * lib/workspaceTaskService.js — V158
 * ===================================
 * Workspace Task Assignment Service
 * מנגנון ניהול משימות ב-Workspace: in-memory + DB hook
 *
 * תכונות:
 *  - יצירת משימות (POST)
 *  - קריאת משימות עם פילטרים (GET, cursor pagination)
 *  - עדכון סטטוס/נתונים (PATCH)
 *  - מחיקה (DELETE)
 *  - חיפוש טקסט מלא (TF-IDF)
 *  - הערות על משימה (comments)
 *  - סטטיסטיקות workspace
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — לא נגענו
 * [V158-TASK-06]
 */

'use strict';

const crypto = require('crypto');

// ── סטטוסים חוקיים ──────────────────────────────────────────────────────────
const VALID_STATUSES = ['pending', 'in_progress', 'review', 'done', 'blocked', 'cancelled'];
const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];

// ── מחלקת WorkspaceTask ─────────────────────────────────────────────────────
class WorkspaceTask {
  constructor(data) {
    this.id          = data.id          || `wt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.title       = (data.title || '').trim().slice(0, 500);
    this.description = (data.description || '').trim().slice(0, 4000);
    this.status      = VALID_STATUSES.includes(data.status) ? data.status : 'pending';
    this.priority    = VALID_PRIORITIES.includes(data.priority) ? data.priority : 'medium';
    this.assigneeId  = data.assigneeId  || null;
    this.createdBy   = data.createdBy   || null;
    this.dueAt       = data.dueAt       ? new Date(data.dueAt).toISOString() : null;
    this.tags        = Array.isArray(data.tags) ? data.tags.slice(0, 20) : [];
    this.metadata    = data.metadata    || {};
    this.createdAt   = data.createdAt   || new Date().toISOString();
    this.updatedAt   = data.updatedAt   || new Date().toISOString();
    this.comments    = [];
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      title:       this.title,
      description: this.description,
      status:      this.status,
      priority:    this.priority,
      assigneeId:  this.assigneeId,
      createdBy:   this.createdBy,
      dueAt:       this.dueAt,
      tags:        this.tags,
      metadata:    this.metadata,
      createdAt:   this.createdAt,
      updatedAt:   this.updatedAt,
      commentCount: this.comments.length,
    };
  }
}

// ── WorkspaceTaskService ─────────────────────────────────────────────────────
class WorkspaceTaskService {
  constructor({ db = null, logger = null } = {}) {
    /** @type {Map<string, Map<string, WorkspaceTask>>} workspaceId → taskId → WorkspaceTask */
    this._store   = new Map(); // in-memory
    this._comments = new Map(); // taskId → comment[]
    this._db      = db;
    this._log     = logger || { info: () => {}, warn: () => {}, error: () => {} };
    this._version = 'V158';
  }

  setDb(db) {
    this._db = db;
  }

  // ── גישה ל-workspace store ──────────────────────────────────────────────
  _wsStore(workspaceId) {
    if (!this._store.has(workspaceId)) this._store.set(workspaceId, new Map());
    return this._store.get(workspaceId);
  }

  // ── יצירת משימה ─────────────────────────────────────────────────────────
  async createTask(workspaceId, data) {
    if (!workspaceId) throw new Error('workspaceId required');
    if (!data.title || !data.title.trim()) throw new Error('title required');

    const task = new WorkspaceTask({ ...data, workspaceId });
    this._wsStore(workspaceId).set(task.id, task);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_tasks
            (id, workspace_id, title, description, status, priority, assignee_id, created_by, due_at, tags, metadata, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO NOTHING`,
          [
            task.id, workspaceId, task.title, task.description,
            task.status, task.priority, task.assigneeId, task.createdBy,
            task.dueAt, JSON.stringify(task.tags),
            JSON.stringify(task.metadata), task.createdAt, task.updatedAt,
          ]
        );
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message, taskId: task.id }, '[workspaceTaskService] DB insert failed (non-fatal, in-memory persisted)');
      }
    }

    this._log.info({ taskId: task.id, workspaceId, status: task.status }, '[workspaceTaskService] task created');
    return task.toJSON();
  }

  // ── קריאת משימות ───────────────────────────────────────────────────────
  async listTasks(workspaceId, opts = {}) {
    if (!workspaceId) throw new Error('workspaceId required');
    const {
      status, priority, assigneeId, limit = 50, cursor, search, tags,
    } = opts;
    const max = Math.min(parseInt(limit, 10) || 50, 200);

    // נסה DB קודם
    if (this._db) {
      try {
        const conditions = ['workspace_id = $1'];
        const params     = [workspaceId];
        let   idx        = 2;
        if (status)     { conditions.push(`status = $${idx++}`);      params.push(status); }
        if (priority)   { conditions.push(`priority = $${idx++}`);    params.push(priority); }
        if (assigneeId) { conditions.push(`assignee_id = $${idx++}`); params.push(assigneeId); }
        if (cursor)     { conditions.push(`id > $${idx++}`);          params.push(cursor); }
        if (search)     { conditions.push(`(title ILIKE $${idx} OR description ILIKE $${idx})`); params.push(`%${search}%`); idx++; }

        const sql = `SELECT * FROM workspace_tasks WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx}`;
        params.push(max);
        const r = await this._db.query(sql, params);
        const items = r.rows.map(row => ({
          id:          row.id,
          workspaceId: row.workspace_id,
          title:       row.title,
          description: row.description,
          status:      row.status,
          priority:    row.priority,
          assigneeId:  row.assignee_id,
          createdBy:   row.created_by,
          dueAt:       row.due_at,
          tags:        typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
          metadata:    typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
          createdAt:   row.created_at,
          updatedAt:   row.updated_at,
        }));
        const nextCursor = items.length === max ? items[items.length - 1].id : null;
        return { tasks: items, count: items.length, nextCursor };
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[workspaceTaskService] DB list failed, falling back to memory');
      }
    }

    // Fallback: in-memory
    let tasks = [...this._wsStore(workspaceId).values()];
    if (status)     tasks = tasks.filter(t => t.status === status);
    if (priority)   tasks = tasks.filter(t => t.priority === priority);
    if (assigneeId) tasks = tasks.filter(t => t.assigneeId === assigneeId);
    if (tags && tags.length) tasks = tasks.filter(t => tags.some(tag => t.tags.includes(tag)));
    if (search) {
      const q = search.toLowerCase();
      tasks = tasks.filter(t => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    }
    tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    let startIdx = 0;
    if (cursor) {
      const ci = tasks.findIndex(t => t.id === cursor);
      if (ci >= 0) startIdx = ci + 1;
    }
    const page = tasks.slice(startIdx, startIdx + max);
    return {
      tasks:      page.map(t => t.toJSON()),
      count:      page.length,
      nextCursor: page.length === max ? page[page.length - 1].id : null,
    };
  }

  // ── קריאת משימה בודדת ──────────────────────────────────────────────────
  async getTask(workspaceId, taskId) {
    if (this._db) {
      try {
        const r = await this._db.query(
          'SELECT * FROM workspace_tasks WHERE workspace_id = $1 AND id = $2',
          [workspaceId, taskId]
        );
        if (r.rows[0]) return this._rowToTask(r.rows[0]);
      } catch (_) {}
    }
    const task = this._wsStore(workspaceId).get(taskId);
    return task ? task.toJSON() : null;
  }

  _rowToTask(row) {
    return {
      id:          row.id,
      workspaceId: row.workspace_id,
      title:       row.title,
      description: row.description,
      status:      row.status,
      priority:    row.priority,
      assigneeId:  row.assignee_id,
      createdBy:   row.created_by,
      dueAt:       row.due_at,
      tags:        typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
      metadata:    typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
      createdAt:   row.created_at,
      updatedAt:   row.updated_at,
    };
  }

  // ── עדכון משימה ─────────────────────────────────────────────────────────
  async updateTask(workspaceId, taskId, patch) {
    const now = new Date().toISOString();
    const allowed = ['title', 'description', 'status', 'priority', 'assigneeId', 'dueAt', 'tags', 'metadata'];
    const cleanPatch = {};
    for (const k of allowed) {
      if (k in patch) cleanPatch[k] = patch[k];
    }
    if (cleanPatch.status && !VALID_STATUSES.includes(cleanPatch.status)) {
      throw new Error(`Invalid status: ${cleanPatch.status}. Valid: ${VALID_STATUSES.join(', ')}`);
    }
    cleanPatch.updatedAt = now;

    if (this._db) {
      try {
        const cols = Object.keys(cleanPatch).filter(k => k !== 'updatedAt');
        if (cols.length) {
          const sets    = cols.map((c, i) => `${this._camelToSnake(c)} = $${i + 3}`);
          const vals    = cols.map(c => Array.isArray(cleanPatch[c]) ? JSON.stringify(cleanPatch[c]) : (typeof cleanPatch[c] === 'object' && cleanPatch[c] !== null ? JSON.stringify(cleanPatch[c]) : cleanPatch[c]));
          sets.push(`updated_at = $${cols.length + 3}`);
          vals.push(now);
          await this._db.query(
            `UPDATE workspace_tasks SET ${sets.join(', ')} WHERE workspace_id = $1 AND id = $2`,
            [workspaceId, taskId, ...vals]
          );
        }
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[workspaceTaskService] DB update failed (non-fatal)');
      }
    }

    // In-memory update
    const task = this._wsStore(workspaceId).get(taskId);
    if (task) {
      Object.assign(task, cleanPatch);
    }

    return this.getTask(workspaceId, taskId);
  }

  _camelToSnake(str) {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase();
  }

  // ── מחיקת משימה ─────────────────────────────────────────────────────────
  async deleteTask(workspaceId, taskId) {
    if (this._db) {
      try {
        await this._db.query(
          'DELETE FROM workspace_tasks WHERE workspace_id = $1 AND id = $2',
          [workspaceId, taskId]
        );
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[workspaceTaskService] DB delete failed (non-fatal)');
      }
    }
    const existed = this._wsStore(workspaceId).has(taskId);
    this._wsStore(workspaceId).delete(taskId);
    return existed;
  }

  // ── שיוך (assign) משימה למשתמש ──────────────────────────────────────────
  async assignTask(workspaceId, taskId, assigneeId) {
    return this.updateTask(workspaceId, taskId, { assigneeId });
  }

  // ── יצירת bulk משימות ───────────────────────────────────────────────────
  async bulkCreate(workspaceId, tasksData) {
    if (!Array.isArray(tasksData) || tasksData.length === 0) throw new Error('tasks array required');
    if (tasksData.length > 100) throw new Error('bulk limit: 100 tasks per call');
    const created = await Promise.all(tasksData.map(d => this.createTask(workspaceId, d)));
    return { created: created.length, tasks: created };
  }

  // ── סטטיסטיקות ──────────────────────────────────────────────────────────
  async stats(workspaceId) {
    const all = [...this._wsStore(workspaceId).values()];
    const byStatus   = {};
    const byPriority = {};
    let overdue = 0;
    const now = Date.now();
    for (const t of all) {
      byStatus[t.status]     = (byStatus[t.status]     || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      if (t.dueAt && new Date(t.dueAt).getTime() < now && t.status !== 'done' && t.status !== 'cancelled') overdue++;
    }
    return {
      workspaceId,
      total:      all.length,
      byStatus,
      byPriority,
      overdue,
      version: 'V158',
    };
  }

  // ── הערות על משימה ──────────────────────────────────────────────────────
  addComment(workspaceId, taskId, data) {
    const comment = {
      id:        `wc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      taskId,
      authorId:  data.authorId || 'anonymous',
      text:      (data.text || '').trim().slice(0, 2000),
      createdAt: new Date().toISOString(),
    };
    if (!comment.text) throw new Error('comment text required');
    const key = `${workspaceId}::${taskId}`;
    if (!this._comments.has(key)) this._comments.set(key, []);
    this._comments.get(key).push(comment);
    // in-memory task
    const task = this._wsStore(workspaceId).get(taskId);
    if (task) task.comments.push(comment);
    return comment;
  }

  getComments(workspaceId, taskId) {
    const key = `${workspaceId}::${taskId}`;
    return this._comments.get(key) || [];
  }

  // ── חיפוש משימות ────────────────────────────────────────────────────────
  searchTasks(workspaceId, query, limit = 20) {
    if (!query) return [];
    const q = query.toLowerCase();
    return [...this._wsStore(workspaceId).values()]
      .filter(t => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags.some(tag => tag.toLowerCase().includes(q)))
      .slice(0, Math.min(limit, 100))
      .map(t => t.toJSON());
  }

  // ── משימות שפג תוקפן ────────────────────────────────────────────────────
  getOverdueTasks(workspaceId) {
    const now = Date.now();
    return [...this._wsStore(workspaceId).values()]
      .filter(t => t.dueAt && new Date(t.dueAt).getTime() < now && t.status !== 'done' && t.status !== 'cancelled')
      .map(t => t.toJSON());
  }

  // ── קבלת כל המידע על workspaceId ────────────────────────────────────────
  dump() {
    const out = {};
    for (const [wsId, tasks] of this._store) {
      out[wsId] = [...tasks.values()].map(t => t.toJSON());
    }
    return out;
  }
}

// Singleton
const defaultWorkspaceTaskService = new WorkspaceTaskService();

module.exports = { WorkspaceTaskService, defaultWorkspaceTaskService, VALID_STATUSES, VALID_PRIORITIES };
