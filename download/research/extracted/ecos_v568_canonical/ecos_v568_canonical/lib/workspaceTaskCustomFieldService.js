/**
 * lib/workspaceTaskCustomFieldService.js — V165
 * ===============================================
 * Task Custom Fields
 * הגדרת שדות מותאמים אישית לכל workspace (text, number, date, select)
 * הגדרת ערכים לכל משימה + סינון משימות לפי ערך שדה
 *
 * תכונות:
 *  - Define custom field schemas per workspace (text, number, date, select)
 *  - Set/get custom field values per task
 *  - Filter tasks by custom field value (equality)
 *  - In-memory + DB dual persistence
 *  - DB: workspace_custom_fields, workspace_task_custom_values
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V165-T01]
 */

'use strict';

const crypto = require('crypto');

// ── Constants ───────────────────────────────────────────────────────────────

const FIELD_TYPES = ['text', 'number', 'date', 'select'];
const MAX_FIELDS_PER_WORKSPACE = 50;
const MAX_SELECT_OPTIONS = 30;

// ── Errors ──────────────────────────────────────────────────────────────────

class CustomFieldNotFoundError extends Error {
  constructor(id) {
    super(`Custom field not found: ${id}`);
    this.name = 'CustomFieldNotFoundError';
    this.code = 'CUSTOM_FIELD_NOT_FOUND';
    this.statusCode = 404;
  }
}

class CustomFieldValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'CustomFieldValidationError';
    this.code = 'CUSTOM_FIELD_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

class CustomFieldLimitError extends Error {
  constructor() {
    super(`Maximum ${MAX_FIELDS_PER_WORKSPACE} custom fields per workspace`);
    this.name = 'CustomFieldLimitError';
    this.code = 'CUSTOM_FIELD_LIMIT';
    this.statusCode = 422;
  }
}

// ── CustomFieldSchema record ─────────────────────────────────────────────────

class CustomFieldSchema {
  /**
   * @param {object} data
   * @param {string} data.workspaceId
   * @param {string} data.name          — display name
   * @param {'text'|'number'|'date'|'select'} data.type
   * @param {string[]} [data.options]   — only for type=select
   * @param {boolean} [data.required]
   * @param {string} [data.id]
   * @version V165
   */
  constructor(data) {
    this.id          = data.id          || `cf_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.name        = (data.name || '').slice(0, 100);
    this.type        = data.type;
    this.options     = data.type === 'select' ? (data.options || []).slice(0, MAX_SELECT_OPTIONS) : [];
    this.required    = !!data.required;
    this.createdAt   = data.createdAt   || new Date().toISOString();
    this.updatedAt   = data.updatedAt   || new Date().toISOString();
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      name:        this.name,
      type:        this.type,
      options:     this.options,
      required:    this.required,
      createdAt:   this.createdAt,
      updatedAt:   this.updatedAt,
    };
  }
}

// ── CustomFieldValue record ──────────────────────────────────────────────────

class CustomFieldValue {
  /**
   * @param {object} data
   * @param {string} data.workspaceId
   * @param {string} data.taskId
   * @param {string} data.fieldId
   * @param {*}      data.value
   * @version V165
   */
  constructor(data) {
    this.id          = data.id          || `cfv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.taskId      = data.taskId;
    this.fieldId     = data.fieldId;
    this.value       = data.value !== undefined ? data.value : null;
    this.createdAt   = data.createdAt   || new Date().toISOString();
    this.updatedAt   = data.updatedAt   || new Date().toISOString();
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      taskId:      this.taskId,
      fieldId:     this.fieldId,
      value:       this.value,
      createdAt:   this.createdAt,
      updatedAt:   this.updatedAt,
    };
  }
}

// ── WorkspaceTaskCustomFieldService ─────────────────────────────────────────

class WorkspaceTaskCustomFieldService {
  /**
   * @param {object} [opts]
   * @param {object} [opts.db]     — pg pool (optional)
   * @param {object} [opts.logger] — pino logger (optional)
   * @version V165
   */
  constructor(opts = {}) {
    // in-memory schemas: fieldId → CustomFieldSchema
    this._schemas = new Map();
    // index: workspaceId → Set<fieldId>
    this._byWorkspace = new Map();
    // in-memory values: `${workspaceId}::${taskId}::${fieldId}` → CustomFieldValue
    this._values = new Map();
    // index: `${workspaceId}::${taskId}` → Set<fieldId>
    this._valuesByTask = new Map();

    this._db  = opts.db     || null;
    this._log = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };
    this._totalFieldsCreated = 0;
    this._totalValuesSet     = 0;
  }

  setDb(db)         { this._db  = db; }
  setLogger(logger) { this._log = logger; }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _validateType(type) {
    if (!FIELD_TYPES.includes(type)) {
      throw new CustomFieldValidationError(`Invalid type "${type}". Must be one of: ${FIELD_TYPES.join(', ')}`);
    }
  }

  _validateValue(schema, value) {
    if (value === null || value === undefined) {
      if (schema.required) throw new CustomFieldValidationError(`Field "${schema.name}" is required`);
      return;
    }
    if (schema.type === 'number' && typeof value !== 'number') {
      throw new CustomFieldValidationError(`Field "${schema.name}" must be a number`);
    }
    if (schema.type === 'date') {
      const d = new Date(value);
      if (isNaN(d.getTime())) throw new CustomFieldValidationError(`Field "${schema.name}" must be a valid date`);
    }
    if (schema.type === 'select' && schema.options.length > 0 && !schema.options.includes(value)) {
      throw new CustomFieldValidationError(`Value "${value}" not in allowed options for field "${schema.name}"`);
    }
  }

  _wsIdx(workspaceId, ...parts) {
    return [workspaceId, ...parts].join('::');
  }

  _addToIndex(map, key, id) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  }

  // ── Schema CRUD ────────────────────────────────────────────────────────────

  /**
   * Create a new custom field schema for a workspace.
   * @param {string} workspaceId
   * @param {object} data
   * @param {string} data.name
   * @param {'text'|'number'|'date'|'select'} data.type
   * @param {string[]} [data.options]
   * @param {boolean} [data.required]
   * @returns {Promise<CustomFieldSchema>}
   * [V165-T01]
   */
  async createField(workspaceId, data) {
    if (!workspaceId) throw new CustomFieldValidationError('workspaceId required');
    if (!data.name)   throw new CustomFieldValidationError('name required');
    this._validateType(data.type);

    // Check limit
    const existing = this._byWorkspace.get(workspaceId) || new Set();
    if (existing.size >= MAX_FIELDS_PER_WORKSPACE) throw new CustomFieldLimitError();

    const schema = new CustomFieldSchema({ ...data, workspaceId });
    this._schemas.set(schema.id, schema);
    this._addToIndex(this._byWorkspace, workspaceId, schema.id);
    this._totalFieldsCreated++;

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_custom_fields
             (id, workspace_id, name, type, options, required, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO NOTHING`,
          [schema.id, workspaceId, schema.name, schema.type,
           JSON.stringify(schema.options), schema.required, schema.createdAt, schema.updatedAt],
        );
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[customField] DB createField failed');
      }
    }

    this._log.info({ workspaceId, fieldId: schema.id, type: schema.type }, '[customField] field created');
    return schema;
  }

  /**
   * List all custom field schemas for a workspace.
   * @param {string} workspaceId
   * @returns {Promise<{ fields: object[], count: number }>}
   * [V165-T02]
   */
  async listFields(workspaceId) {
    if (!workspaceId) throw new CustomFieldValidationError('workspaceId required');

    if (this._db) {
      try {
        const r = await this._db.query(
          `SELECT * FROM workspace_custom_fields
            WHERE workspace_id = $1 ORDER BY created_at ASC`,
          [workspaceId],
        );
        const fields = r.rows.map(row => ({
          id:          row.id,
          workspaceId: row.workspace_id,
          name:        row.name,
          type:        row.type,
          options:     row.options || [],
          required:    row.required,
          createdAt:   row.created_at,
          updatedAt:   row.updated_at,
        }));
        return { fields, count: fields.length };
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[customField] DB listFields failed, fallback');
      }
    }

    const ids = this._byWorkspace.get(workspaceId) || new Set();
    const fields = [...ids]
      .map(id => this._schemas.get(id))
      .filter(Boolean)
      .map(s => s.toJSON());
    return { fields, count: fields.length };
  }

  /**
   * Get a single field schema by id.
   * @param {string} workspaceId
   * @param {string} fieldId
   * @returns {Promise<CustomFieldSchema>}
   */
  async getField(workspaceId, fieldId) {
    if (!workspaceId) throw new CustomFieldValidationError('workspaceId required');
    if (!fieldId)     throw new CustomFieldValidationError('fieldId required');

    if (this._db) {
      try {
        const r = await this._db.query(
          `SELECT * FROM workspace_custom_fields WHERE id = $1 AND workspace_id = $2`,
          [fieldId, workspaceId],
        );
        if (r.rows.length) {
          const row = r.rows[0];
          return new CustomFieldSchema({
            id:          row.id,
            workspaceId: row.workspace_id,
            name:        row.name,
            type:        row.type,
            options:     row.options || [],
            required:    row.required,
            createdAt:   row.created_at,
            updatedAt:   row.updated_at,
          });
        }
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[customField] DB getField failed, fallback');
      }
    }

    const schema = this._schemas.get(fieldId);
    if (!schema || schema.workspaceId !== workspaceId) throw new CustomFieldNotFoundError(fieldId);
    return schema;
  }

  /**
   * Delete a custom field schema (and all its values).
   * @param {string} workspaceId
   * @param {string} fieldId
   * @returns {Promise<{ ok: boolean }>}
   * [V165-T03]
   */
  async deleteField(workspaceId, fieldId) {
    if (!workspaceId) throw new CustomFieldValidationError('workspaceId required');
    if (!fieldId)     throw new CustomFieldValidationError('fieldId required');

    const schema = this._schemas.get(fieldId);
    if (schema && schema.workspaceId === workspaceId) {
      this._schemas.delete(fieldId);
      const wsSet = this._byWorkspace.get(workspaceId);
      if (wsSet) wsSet.delete(fieldId);
    }

    if (this._db) {
      try {
        await this._db.query(
          `DELETE FROM workspace_custom_fields WHERE id = $1 AND workspace_id = $2`,
          [fieldId, workspaceId],
        );
        await this._db.query(
          `DELETE FROM workspace_task_custom_values WHERE field_id = $1 AND workspace_id = $2`,
          [fieldId, workspaceId],
        );
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[customField] DB deleteField failed');
      }
    }

    return { ok: true, fieldId };
  }

  // ── Value Set/Get ──────────────────────────────────────────────────────────

  /**
   * Set (upsert) a custom field value for a task.
   * @param {string} workspaceId
   * @param {string} taskId
   * @param {string} fieldId
   * @param {*}      value
   * @returns {Promise<CustomFieldValue>}
   * [V165-T04]
   */
  async setValue(workspaceId, taskId, fieldId, value) {
    if (!workspaceId) throw new CustomFieldValidationError('workspaceId required');
    if (!taskId)      throw new CustomFieldValidationError('taskId required');
    if (!fieldId)     throw new CustomFieldValidationError('fieldId required');

    // Validate against schema if available
    const schema = this._schemas.get(fieldId);
    if (schema) this._validateValue(schema, value);

    const key = this._wsIdx(workspaceId, taskId, fieldId);
    const existing = this._values.get(key);

    let record;
    if (existing) {
      existing.value     = value;
      existing.updatedAt = new Date().toISOString();
      record = existing;
    } else {
      record = new CustomFieldValue({ workspaceId, taskId, fieldId, value });
      this._values.set(key, record);
      this._addToIndex(this._valuesByTask, this._wsIdx(workspaceId, taskId), fieldId);
    }
    this._totalValuesSet++;

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_task_custom_values
             (id, workspace_id, task_id, field_id, value, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (workspace_id, task_id, field_id)
           DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
          [record.id, workspaceId, taskId, fieldId,
           JSON.stringify(value), record.createdAt, record.updatedAt],
        );
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[customField] DB setValue failed');
      }
    }

    this._log.info({ workspaceId, taskId, fieldId }, '[customField] value set');
    return record;
  }

  /**
   * Get all custom field values for a task.
   * @param {string} workspaceId
   * @param {string} taskId
   * @returns {Promise<{ values: object[], count: number }>}
   * [V165-T05]
   */
  async getTaskValues(workspaceId, taskId) {
    if (!workspaceId) throw new CustomFieldValidationError('workspaceId required');
    if (!taskId)      throw new CustomFieldValidationError('taskId required');

    if (this._db) {
      try {
        const r = await this._db.query(
          `SELECT v.*, f.name as field_name, f.type as field_type
            FROM workspace_task_custom_values v
            LEFT JOIN workspace_custom_fields f ON f.id = v.field_id
            WHERE v.workspace_id = $1 AND v.task_id = $2
            ORDER BY v.created_at ASC`,
          [workspaceId, taskId],
        );
        const values = r.rows.map(row => ({
          id:          row.id,
          workspaceId: row.workspace_id,
          taskId:      row.task_id,
          fieldId:     row.field_id,
          fieldName:   row.field_name,
          fieldType:   row.field_type,
          value:       row.value,
          createdAt:   row.created_at,
          updatedAt:   row.updated_at,
        }));
        return { values, count: values.length };
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[customField] DB getTaskValues failed, fallback');
      }
    }

    const taskKey = this._wsIdx(workspaceId, taskId);
    const fieldIds = this._valuesByTask.get(taskKey) || new Set();
    const values = [...fieldIds]
      .map(fid => this._values.get(this._wsIdx(workspaceId, taskId, fid)))
      .filter(Boolean)
      .map(v => v.toJSON());
    return { values, count: values.length };
  }

  /**
   * Filter tasks by custom field value (equality).
   * @param {string} workspaceId
   * @param {string} fieldId
   * @param {*}      value
   * @param {object} [opts]
   * @param {number} [opts.limit=50]
   * @returns {Promise<{ taskIds: string[], count: number }>}
   * [V165-T06]
   */
  async filterTasksByFieldValue(workspaceId, fieldId, value, opts = {}) {
    if (!workspaceId) throw new CustomFieldValidationError('workspaceId required');
    if (!fieldId)     throw new CustomFieldValidationError('fieldId required');
    if (value === undefined) throw new CustomFieldValidationError('value required');

    const limit = Math.min(parseInt(opts.limit || 50, 10), 200);

    if (this._db) {
      try {
        const r = await this._db.query(
          `SELECT task_id FROM workspace_task_custom_values
            WHERE workspace_id = $1 AND field_id = $2 AND value = $3
            ORDER BY updated_at DESC LIMIT $4`,
          [workspaceId, fieldId, JSON.stringify(value), limit],
        );
        const taskIds = r.rows.map(row => row.task_id);
        return { taskIds, count: taskIds.length, fieldId, value };
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[customField] DB filterTasksByFieldValue failed, fallback');
      }
    }

    // In-memory fallback
    const taskIds = [];
    for (const [key, record] of this._values) {
      if (record.workspaceId === workspaceId &&
          record.fieldId     === fieldId &&
          JSON.stringify(record.value) === JSON.stringify(value)) {
        taskIds.push(record.taskId);
      }
    }
    return { taskIds: taskIds.slice(0, limit), count: taskIds.length, fieldId, value };
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  stats() {
    return {
      totalSchemas:       this._schemas.size,
      totalValues:        this._values.size,
      totalFieldsCreated: this._totalFieldsCreated,
      totalValuesSet:     this._totalValuesSet,
      workspacesWithFields: this._byWorkspace.size,
    };
  }
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  WorkspaceTaskCustomFieldService,
  CustomFieldSchema,
  CustomFieldValue,
  CustomFieldNotFoundError,
  CustomFieldValidationError,
  CustomFieldLimitError,
  FIELD_TYPES,
  MAX_FIELDS_PER_WORKSPACE,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._service = new WorkspaceTaskCustomFieldService();
}
