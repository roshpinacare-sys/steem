/**
 * lib/workspaceMemberManager.js — ECOS V156
 * ─────────────────────────────────────────────────────────────────────────────
 * [V156-TASK-03] Workspace Member Management API
 *
 * Responsibilities:
 *   - Add collaborators to a workspace (POST /api/v1/workspaces/:id/members)
 *   - Remove collaborators from a workspace (DELETE /api/v1/workspaces/:id/members/:userId)
 *   - List workspace collaborators (GET /api/v1/workspaces/:id/members)
 *   - Track member roles: OWNER, ADMIN, EDITOR, VIEWER
 *   - Non-fatal: all errors logged, never crash the server
 *
 * Design principles:
 *   - Zero external deps (pure Node.js)
 *   - DB-backed via workspaceRegistry
 *   - Sacred files (fiatLedger.js, auditLog.js) are NEVER touched
 */
'use strict';

const MEMBER_ROLES = {
  OWNER:  'OWNER',   // can delete workspace, manage members
  ADMIN:  'ADMIN',   // can manage members, edit workspace
  EDITOR: 'EDITOR',  // can edit tasks
  VIEWER: 'VIEWER',  // read-only
};

class WorkspaceMemberManager {
  /**
   * @param {object} opts
   * @param {object} [opts.db] - Postgres pool
   * @param {object} [opts.logger] - pino logger
   */
  constructor(opts = {}) {
    this._db = opts.db || null;
    this._log = opts.logger || { info: () => {}, warn: () => {}, error: () => {} };
  }

  setDb(db)     { this._db = db; }
  setLogger(log) { this._log = log; }

  /**
   * Add a member to a workspace.
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} role - OWNER | ADMIN | EDITOR | VIEWER (default: VIEWER)
   * @returns {Promise<object>} { success, member, error }
   */
  async addMember(workspaceId, userId, role = 'VIEWER') {
    if (!this._db) {
      return { success: false, error: 'DB pool not available' };
    }

    if (!Object.values(MEMBER_ROLES).includes(role)) {
      return { success: false, error: `Invalid role: ${role}` };
    }

    try {
      const result = await this._db.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, added_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET role = $3, updated_at = NOW()
         RETURNING workspace_id, user_id, role, added_at`,
        [workspaceId, userId, role]
      );

      if (result.rows.length === 0) {
        return { success: false, error: 'Failed to add member' };
      }

      const member = result.rows[0];
      this._log.info(
        { workspaceId, userId, role },
        '[V156-TASK-03] Member added to workspace'
      );

      return { success: true, member };
    } catch (err) {
      this._log.error(
        { err: err.message, workspaceId, userId },
        '[V156-TASK-03] addMember failed'
      );
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove a member from a workspace.
   * @param {string} workspaceId
   * @param {string} userId
   * @returns {Promise<object>} { success, error }
   */
  async removeMember(workspaceId, userId) {
    if (!this._db) {
      return { success: false, error: 'DB pool not available' };
    }

    try {
      // Prevent removing the last OWNER
      const ownerCount = await this._db.query(
        `SELECT COUNT(*) as count FROM workspace_members
         WHERE workspace_id = $1 AND role = 'OWNER'`,
        [workspaceId]
      );

      if (ownerCount.rows[0].count <= 1) {
        const userRole = await this._db.query(
          `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
          [workspaceId, userId]
        );
        if (userRole.rows.length > 0 && userRole.rows[0].role === 'OWNER') {
          return { success: false, error: 'Cannot remove the last owner' };
        }
      }

      const result = await this._db.query(
        `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2
         RETURNING workspace_id, user_id`,
        [workspaceId, userId]
      );

      if (result.rowCount === 0) {
        return { success: false, error: 'Member not found' };
      }

      this._log.info(
        { workspaceId, userId },
        '[V156-TASK-03] Member removed from workspace'
      );

      return { success: true };
    } catch (err) {
      this._log.error(
        { err: err.message, workspaceId, userId },
        '[V156-TASK-03] removeMember failed'
      );
      return { success: false, error: err.message };
    }
  }

  /**
   * List members of a workspace.
   * @param {string} workspaceId
   * @param {object} [opts] - { limit, offset }
   * @returns {Promise<object>} { success, members, total, error }
   */
  async listMembers(workspaceId, opts = {}) {
    if (!this._db) {
      return { success: false, error: 'DB pool not available' };
    }

    const limit = Math.max(1, Math.min(opts.limit || 50, 500));
    const offset = Math.max(0, opts.offset || 0);

    try {
      // Get total count
      const countResult = await this._db.query(
        `SELECT COUNT(*) as count FROM workspace_members WHERE workspace_id = $1`,
        [workspaceId]
      );
      const total = countResult.rows[0].count;

      // Get paginated members
      const result = await this._db.query(
        `SELECT user_id, role, added_at, updated_at
         FROM workspace_members
         WHERE workspace_id = $1
         ORDER BY added_at DESC
         LIMIT $2 OFFSET $3`,
        [workspaceId, limit, offset]
      );

      this._log.debug(
        { workspaceId, count: result.rows.length, total },
        '[V156-TASK-03] Members listed'
      );

      return { success: true, members: result.rows, total };
    } catch (err) {
      this._log.error(
        { err: err.message, workspaceId },
        '[V156-TASK-03] listMembers failed'
      );
      return { success: false, error: err.message };
    }
  }

  /**
   * Get a member's role in a workspace.
   * @param {string} workspaceId
   * @param {string} userId
   * @returns {Promise<object>} { success, role, error }
   */
  async getMemberRole(workspaceId, userId) {
    if (!this._db) {
      return { success: false, error: 'DB pool not available' };
    }

    try {
      const result = await this._db.query(
        `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, userId]
      );

      if (result.rows.length === 0) {
        return { success: false, error: 'Member not found' };
      }

      return { success: true, role: result.rows[0].role };
    } catch (err) {
      this._log.error(
        { err: err.message, workspaceId, userId },
        '[V156-TASK-03] getMemberRole failed'
      );
      return { success: false, error: err.message };
    }
  }

  /**
   * Update a member's role.
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} newRole
   * @returns {Promise<object>} { success, member, error }
   */
  async updateMemberRole(workspaceId, userId, newRole) {
    if (!Object.values(MEMBER_ROLES).includes(newRole)) {
      return { success: false, error: `Invalid role: ${newRole}` };
    }

    if (!this._db) {
      return { success: false, error: 'DB pool not available' };
    }

    try {
      const result = await this._db.query(
        `UPDATE workspace_members SET role = $3, updated_at = NOW()
         WHERE workspace_id = $1 AND user_id = $2
         RETURNING user_id, role, updated_at`,
        [workspaceId, userId, newRole]
      );

      if (result.rows.length === 0) {
        return { success: false, error: 'Member not found' };
      }

      this._log.info(
        { workspaceId, userId, newRole },
        '[V156-TASK-03] Member role updated'
      );

      return { success: true, member: result.rows[0] };
    } catch (err) {
      this._log.error(
        { err: err.message, workspaceId, userId },
        '[V156-TASK-03] updateMemberRole failed'
      );
      return { success: false, error: err.message };
    }
  }
}

module.exports = {
  WorkspaceMemberManager,
  MEMBER_ROLES,
};
