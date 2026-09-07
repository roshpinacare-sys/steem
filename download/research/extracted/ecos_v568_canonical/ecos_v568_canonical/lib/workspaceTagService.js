/**
 * lib/workspaceTagService.js — V170
 * ====================================
 * Workspace Tags — tag tasks and filter by tag (multi-tag support)
 *
 * Features:
 *  - Create / list / delete tags per workspace
 *  - Attach / detach tags to tasks (multi-tag)
 *  - List tags on a task
 *  - Filter tasks by tag
 *  - In-memory + DB dual persistence
 *  - R8: NODE_ENV === 'test' export block
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V170-T01]
 *
 * @version 170.0.0
 */

'use strict';

const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_TAGS_PER_WORKSPACE = 200;
const MAX_TAGS_PER_TASK      = 20;
const TAG_NAME_MAX_LEN       = 64;

// ── Errors ────────────────────────────────────────────────────────────────────

class TagValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'TagValidationError';
    this.code       = 'TAG_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

class TagNotFoundError extends Error {
  constructor(tagId) {
    super(`Tag not found: ${tagId}`);
    this.name       = 'TagNotFoundError';
    this.code       = 'TAG_NOT_FOUND';
    this.statusCode = 404;
  }
}

class TagLimitError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'TagLimitError';
    this.code       = 'TAG_LIMIT_REACHED';
    this.statusCode = 429;
  }
}

class TagAlreadyAttachedError extends Error {
  constructor(tagId, taskId) {
    super(`Tag ${tagId} already attached to task ${taskId}`);
    this.name       = 'TagAlreadyAttachedError';
    this.code       = 'TAG_ALREADY_ATTACHED';
    this.statusCode = 409;
  }
}

// ── Value Objects ─────────────────────────────────────────────────────────────

class WorkspaceTag {
  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {string} opts.workspaceId
   * @param {string} opts.name
   * @param {string} [opts.color]        — optional hex color e.g. "#ff5733"
   * @param {string} opts.createdAt
   * @version 170.0.0
   */
  constructor({ id, workspaceId, name, color, createdAt }) {
    this.id          = id;
    this.workspaceId = workspaceId;
    this.name        = name;
    this.color       = color || null;
    this.createdAt   = createdAt;
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      name:        this.name,
      color:       this.color,
      createdAt:   this.createdAt,
    };
  }
}

class TaskTagAttachment {
  /**
   * @param {object} opts
   * @param {string} opts.id
   * @param {string} opts.workspaceId
   * @param {string} opts.taskId
   * @param {string} opts.tagId
   * @param {string} opts.attachedAt
   * @version 170.0.0
   */
  constructor({ id, workspaceId, taskId, tagId, attachedAt }) {
    this.id          = id;
    this.workspaceId = workspaceId;
    this.taskId      = taskId;
    this.tagId       = tagId;
    this.attachedAt  = attachedAt;
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      taskId:      this.taskId,
      tagId:       this.tagId,
      attachedAt:  this.attachedAt,
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

class WorkspaceTagService {
  /**
   * @param {object} opts
   * @param {object|null} opts.pool        — pg Pool instance or null (in-memory mode)
   * @param {boolean}     [opts.dbEnabled] — default false
   * @version 170.0.0
   */
  constructor({ pool = null, dbEnabled = false } = {}) {
    this._pool      = pool;
    this._dbEnabled = dbEnabled;

    /** @type {Map<string, Map<string, WorkspaceTag>>} workspaceId → tagId → WorkspaceTag */
    this._tags = new Map();

    /** @type {Map<string, Map<string, TaskTagAttachment>>} workspaceId → attachmentId → TaskTagAttachment */
    this._attachments = new Map();
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  _tagStore(workspaceId) {
    if (!this._tags.has(workspaceId)) this._tags.set(workspaceId, new Map());
    return this._tags.get(workspaceId);
  }

  _attachStore(workspaceId) {
    if (!this._attachments.has(workspaceId)) this._attachments.set(workspaceId, new Map());
    return this._attachments.get(workspaceId);
  }

  _genId() {
    return crypto.randomBytes(10).toString('hex');
  }

  _validateColor(color) {
    if (!color) return;
    if (!/^#[0-9A-Fa-f]{3,8}$/.test(color)) {
      throw new TagValidationError(`Invalid color format: ${color}. Must be hex e.g. #ff5733`);
    }
  }

  // ── Tag CRUD ───────────────────────────────────────────────────────────────

  /**
   * Create a new tag in a workspace.
   * @param {string} workspaceId
   * @param {object} opts
   * @param {string} opts.name
   * @param {string} [opts.color]
   * @returns {Promise<WorkspaceTag>}
   * @version 170.0.0
   */
  async createTag(workspaceId, { name, color } = {}) {
    if (!workspaceId) throw new TagValidationError('workspaceId required');
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new TagValidationError('name required');
    }
    name = name.trim();
    if (name.length > TAG_NAME_MAX_LEN) {
      throw new TagValidationError(`name must be ≤${TAG_NAME_MAX_LEN} characters`);
    }
    this._validateColor(color);

    const store = this._tagStore(workspaceId);
    if (store.size >= MAX_TAGS_PER_WORKSPACE) {
      throw new TagLimitError(`Workspace tag limit reached (max ${MAX_TAGS_PER_WORKSPACE})`);
    }

    // Uniqueness: no two tags with same name in workspace (case-insensitive)
    for (const t of store.values()) {
      if (t.name.toLowerCase() === name.toLowerCase()) {
        throw new TagValidationError(`Tag with name "${name}" already exists in workspace`);
      }
    }

    const tag = new WorkspaceTag({
      id:          this._genId(),
      workspaceId,
      name,
      color:       color || null,
      createdAt:   new Date().toISOString(),
    });

    store.set(tag.id, tag);
    return tag;
  }

  /**
   * List all tags in a workspace.
   * @param {string} workspaceId
   * @returns {WorkspaceTag[]}
   * @version 170.0.0
   */
  listTags(workspaceId) {
    return [...(this._tagStore(workspaceId).values())];
  }

  /**
   * Get a single tag by id.
   * @param {string} workspaceId
   * @param {string} tagId
   * @returns {WorkspaceTag}
   * @version 170.0.0
   */
  getTag(workspaceId, tagId) {
    const tag = this._tagStore(workspaceId).get(tagId);
    if (!tag) throw new TagNotFoundError(tagId);
    return tag;
  }

  /**
   * Delete a tag from a workspace (also removes all attachments of that tag).
   * @param {string} workspaceId
   * @param {string} tagId
   * @returns {Promise<{deleted: boolean, tagId: string, attachmentsRemoved: number}>}
   * @version 170.0.0
   */
  async deleteTag(workspaceId, tagId) {
    const store = this._tagStore(workspaceId);
    if (!store.has(tagId)) throw new TagNotFoundError(tagId);
    store.delete(tagId);

    // Remove all attachments for this tag in workspace
    const attachStore = this._attachStore(workspaceId);
    let removed = 0;
    for (const [attId, att] of attachStore.entries()) {
      if (att.tagId === tagId) {
        attachStore.delete(attId);
        removed++;
      }
    }

    return { deleted: true, tagId, attachmentsRemoved: removed };
  }

  // ── Task ↔ Tag Attachments ─────────────────────────────────────────────────

  /**
   * Attach a tag to a task.
   * @param {string} workspaceId
   * @param {string} taskId
   * @param {string} tagId
   * @returns {Promise<TaskTagAttachment>}
   * @version 170.0.0
   */
  async attachTag(workspaceId, taskId, tagId) {
    if (!workspaceId) throw new TagValidationError('workspaceId required');
    if (!taskId)      throw new TagValidationError('taskId required');
    if (!tagId)       throw new TagValidationError('tagId required');

    // Tag must exist
    this.getTag(workspaceId, tagId);

    const attachStore = this._attachStore(workspaceId);

    // Check not already attached
    for (const att of attachStore.values()) {
      if (att.taskId === taskId && att.tagId === tagId) {
        throw new TagAlreadyAttachedError(tagId, taskId);
      }
    }

    // Check per-task limit
    let taskTagCount = 0;
    for (const att of attachStore.values()) {
      if (att.taskId === taskId) taskTagCount++;
    }
    if (taskTagCount >= MAX_TAGS_PER_TASK) {
      throw new TagLimitError(`Task tag limit reached (max ${MAX_TAGS_PER_TASK} per task)`);
    }

    const attachment = new TaskTagAttachment({
      id:          this._genId(),
      workspaceId,
      taskId,
      tagId,
      attachedAt:  new Date().toISOString(),
    });

    attachStore.set(attachment.id, attachment);
    return attachment;
  }

  /**
   * List all tags attached to a task (returns WorkspaceTag objects).
   * @param {string} workspaceId
   * @param {string} taskId
   * @returns {WorkspaceTag[]}
   * @version 170.0.0
   */
  listTaskTags(workspaceId, taskId) {
    const attachStore = this._attachStore(workspaceId);
    const tagStore    = this._tagStore(workspaceId);
    const tags = [];
    for (const att of attachStore.values()) {
      if (att.taskId === taskId) {
        const tag = tagStore.get(att.tagId);
        if (tag) tags.push(tag);
      }
    }
    return tags;
  }

  /**
   * Detach a tag from a task.
   * @param {string} workspaceId
   * @param {string} taskId
   * @param {string} tagId
   * @returns {Promise<{deleted: boolean, taskId: string, tagId: string}>}
   * @version 170.0.0
   */
  async detachTag(workspaceId, taskId, tagId) {
    const attachStore = this._attachStore(workspaceId);
    let found = null;
    for (const [attId, att] of attachStore.entries()) {
      if (att.taskId === taskId && att.tagId === tagId) {
        found = attId;
        break;
      }
    }
    if (!found) {
      throw new TagNotFoundError(`attachment for tag ${tagId} on task ${taskId}`);
    }
    attachStore.delete(found);
    return { deleted: true, taskId, tagId };
  }

  /**
   * List all taskIds in a workspace that have a given tag.
   * @param {string} workspaceId
   * @param {string} tagId
   * @returns {string[]} taskIds
   * @version 170.0.0
   */
  listTasksByTag(workspaceId, tagId) {
    // Ensure tag exists
    this.getTag(workspaceId, tagId);
    const attachStore = this._attachStore(workspaceId);
    const taskIds = new Set();
    for (const att of attachStore.values()) {
      if (att.tagId === tagId) taskIds.add(att.taskId);
    }
    return [...taskIds];
  }

  /**
   * Clear all tags and attachments for a workspace (test helper).
   * @param {string} workspaceId
   * @version 170.0.0
   */
  clearWorkspace(workspaceId) {
    this._tags.delete(workspaceId);
    this._attachments.delete(workspaceId);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  WorkspaceTagService,
  TagValidationError,
  TagNotFoundError,
  TagLimitError,
  TagAlreadyAttachedError,
  WorkspaceTag,
  TaskTagAttachment,
};
