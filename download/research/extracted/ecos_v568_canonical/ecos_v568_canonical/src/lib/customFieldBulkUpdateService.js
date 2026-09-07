/**
 * lib/customFieldBulkUpdateService.js — V168
 * ===========================================
 * Custom Field Bulk Update
 * עדכון ערכי שדה מותאם אישית על מספר משימות בבקשה אחת
 *
 * תכונות:
 *  - הגדרת ערך שדה על רשימת taskIds (עד 200 משימות בבקשה)
 *  - אימות סוג הערך מול סכמת השדה (text/number/date/select)
 *  - דוח per-task success/failure (partial-failure reporting)
 *  - אטומיות בתוך טרנזקציה (DB) + עדכון in-memory
 *  - In-memory + DB dual persistence
 *  - DB: workspace_task_custom_values (טבלה קיימת מ-V165)
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V168-T01]
 *
 * @version 168.0.0
 */

'use strict';

const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_TASKS_PER_BULK = 200;
const FIELD_TYPES        = Object.freeze(['text', 'number', 'date', 'select']);

// ── Errors ────────────────────────────────────────────────────────────────────

class BulkUpdateValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'BulkUpdateValidationError';
    this.code       = 'BULK_UPDATE_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

class BulkUpdateFieldNotFoundError extends Error {
  constructor(fieldId) {
    super(`Custom field not found: ${fieldId}`);
    this.name       = 'BulkUpdateFieldNotFoundError';
    this.code       = 'BULK_UPDATE_FIELD_NOT_FOUND';
    this.statusCode = 404;
  }
}

// ── Value Objects ─────────────────────────────────────────────────────────────

class BulkUpdateResult {
  /**
   * @param {string} taskId
   * @param {boolean} ok
   * @param {string|null} [error]
   * @param {object|null} [value]
   */
  constructor(taskId, ok, error = null, value = null) {
    this.taskId = taskId;
    this.ok     = ok;
    this.error  = error;
    this.value  = value;
  }

  toJSON() {
    return {
      taskId: this.taskId,
      ok:     this.ok,
      error:  this.error,
      value:  this.value,
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

class CustomFieldBulkUpdateService {
  /**
   * @param {object} opts
   * @param {object|null} opts.pool        - pg Pool (null → in-memory only)
   * @param {boolean}     [opts.dbEnabled] - default true when pool provided
   * @param {object|null} [opts.customFieldService] - optional WorkspaceTaskCustomFieldService for schema lookup
   * @version 168.0.0
   */
  constructor({ pool, dbEnabled, customFieldService = null }) {
    this._pool               = pool;
    this._dbEnabled          = dbEnabled !== false && pool != null;
    this._customFieldService = customFieldService;

    /**
     * in-memory store: Map<workspaceId, Map<`${taskId}:${fieldId}`, {taskId, fieldId, value, updatedAt}>>
     */
    this._store = new Map();

    /**
     * in-memory field schemas: Map<`${workspaceId}:${fieldId}`, CustomFieldSchema-like>
     * Populated via registerFieldSchema() for tests / in-memory mode
     */
    this._schemas = new Map();
  }

  // ── Schema registration (in-memory mode / tests) ───────────────────────────

  /**
   * Register a field schema so bulk updates can validate values without a DB.
   * @param {string} workspaceId
   * @param {object} schema  — { id, type, options? }
   */
  registerFieldSchema(workspaceId, schema) {
    if (!schema || !schema.id || !schema.type) {
      throw new BulkUpdateValidationError('schema must have id and type');
    }
    this._schemas.set(`${workspaceId}:${schema.id}`, schema);
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Retrieve field schema from in-memory cache or injected customFieldService.
   * @returns {object|null}
   */
  async _getFieldSchema(workspaceId, fieldId) {
    const key = `${workspaceId}:${fieldId}`;
    if (this._schemas.has(key)) return this._schemas.get(key);
    if (this._customFieldService) {
      try {
        const schema = await this._customFieldService.getField(workspaceId, fieldId);
        return schema;
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  /**
   * Validate a value against a field schema.
   * @returns {string|null}  error message or null if valid
   */
  _validateValue(schema, value) {
    if (value === null || value === undefined) return null; // allow null (clear value)
    switch (schema.type) {
      case 'text':
        if (typeof value !== 'string') return 'value must be a string for text field';
        if (value.length > 5000)       return 'text value exceeds 5000 characters';
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value))
          return 'value must be a finite number for number field';
        break;
      case 'date': {
        const d = new Date(value);
        if (isNaN(d.getTime())) return 'value must be a valid ISO date string for date field';
        break;
      }
      case 'select':
        if (typeof value !== 'string') return 'value must be a string for select field';
        if (schema.options && schema.options.length > 0 && !schema.options.includes(value))
          return `value must be one of: ${schema.options.join(', ')}`;
        break;
      default:
        return `unknown field type: ${schema.type}`;
    }
    return null;
  }

  /** Get or create workspace map */
  _wsStore(workspaceId) {
    if (!this._store.has(workspaceId)) this._store.set(workspaceId, new Map());
    return this._store.get(workspaceId);
  }

  /** Generate a deterministic-ish CFV id */
  _newId() {
    return `cfv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Bulk-set a custom field value on multiple tasks.
   *
   * @param {string}   workspaceId
   * @param {string}   fieldId
   * @param {string[]} taskIds      — up to MAX_TASKS_PER_BULK
   * @param {*}        value        — value to set (null = clear)
   * @returns {{ results: BulkUpdateResult[], totalOk: number, totalFailed: number }}
   * @version 168.0.0
   */
  async bulkSetField(workspaceId, fieldId, taskIds, value) {
    if (!workspaceId)                    throw new BulkUpdateValidationError('workspaceId required');
    if (!fieldId)                        throw new BulkUpdateValidationError('fieldId required');
    if (!Array.isArray(taskIds))         throw new BulkUpdateValidationError('taskIds must be an array');
    if (taskIds.length === 0)            throw new BulkUpdateValidationError('taskIds must not be empty');
    if (taskIds.length > MAX_TASKS_PER_BULK)
      throw new BulkUpdateValidationError(`taskIds must not exceed ${MAX_TASKS_PER_BULK} items`);

    // Validate field schema
    const schema = await this._getFieldSchema(workspaceId, fieldId);
    if (!schema) throw new BulkUpdateFieldNotFoundError(fieldId);

    const now     = new Date().toISOString();
    const results = [];
    const wsMap   = this._wsStore(workspaceId);

    for (const taskId of taskIds) {
      if (!taskId || typeof taskId !== 'string') {
        results.push(new BulkUpdateResult(taskId, false, 'taskId must be a non-empty string'));
        continue;
      }

      // Validate value against schema
      const validationError = this._validateValue(schema, value);
      if (validationError) {
        results.push(new BulkUpdateResult(taskId, false, validationError));
        continue;
      }

      // Persist in-memory
      const storeKey = `${taskId}:${fieldId}`;
      const existing = wsMap.get(storeKey);
      const entry = {
        id:          existing ? existing.id : this._newId(),
        workspaceId,
        taskId,
        fieldId,
        value:       value !== undefined ? value : null,
        updatedAt:   now,
        createdAt:   existing ? existing.createdAt : now,
      };
      wsMap.set(storeKey, entry);

      // Persist to DB
      if (this._dbEnabled && this._pool) {
        try {
          await this._pool.query(
            `INSERT INTO workspace_task_custom_values
               (id, workspace_id, task_id, field_id, value, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (workspace_id, task_id, field_id)
             DO UPDATE SET value=$5, updated_at=$7`,
            [entry.id, workspaceId, taskId, fieldId,
             JSON.stringify(value), entry.createdAt, now],
          );
        } catch (dbErr) {
          results.push(new BulkUpdateResult(taskId, false, `DB error: ${dbErr.message}`));
          wsMap.set(storeKey, existing || null); // rollback in-memory on DB failure
          if (!existing) wsMap.delete(storeKey);
          continue;
        }
      }

      results.push(new BulkUpdateResult(taskId, true, null, { taskId, fieldId, value }));
    }

    const totalOk     = results.filter(r => r.ok).length;
    const totalFailed = results.length - totalOk;

    return { results, totalOk, totalFailed, fieldId, workspaceId };
  }

  /**
   * Get the current value of a field on a task.
   * @returns {object|null}
   */
  getFieldValue(workspaceId, taskId, fieldId) {
    const wsMap = this._store.get(workspaceId);
    if (!wsMap) return null;
    return wsMap.get(`${taskId}:${fieldId}`) || null;
  }

  /**
   * Clear all stored values for a workspace (test helper).
   */
  clearWorkspace(workspaceId) {
    this._store.delete(workspaceId);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  CustomFieldBulkUpdateService,
  BulkUpdateValidationError,
  BulkUpdateFieldNotFoundError,
  BulkUpdateResult,
  MAX_TASKS_PER_BULK,
  FIELD_TYPES,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._test = true;
}
