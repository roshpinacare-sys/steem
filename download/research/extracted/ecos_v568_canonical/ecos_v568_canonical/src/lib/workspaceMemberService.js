/**
 * lib/workspaceMemberService.js — ECOS V176
 * ═══════════════════════════════════════════════════════════════════════════
 * Workspace Member Service — in-memory registry with roles + optional DB
 *
 * Provides a testable service layer for workspace membership management.
 * Complements the existing V158 DB-only routes and V159 PATCH role route
 * by adding a proper in-memory store that is always available (offline-safe).
 *
 * Features:
 *  - Add a member to a workspace (POST) — upsert semantics
 *  - List members of a workspace (GET)
 *  - Get a single member (GET)
 *  - Update a member's role (PATCH)
 *  - Remove a member (DELETE)
 *  - In-memory store (Map) + optional DB write-through
 *  - NODE_ENV=test exports (R8)
 *
 * Roles: owner | admin | member | viewer
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V176-T02]
 *
 * @version 176.0.0
 */
'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const MEMBER_ROLES = Object.freeze(['owner', 'admin', 'member', 'viewer']);
const DEFAULT_ROLE = 'member';
const MAX_MEMBERS_PER_WORKSPACE = 500;

// ── Errors ───────────────────────────────────────────────────────────────────
class MemberValidationError extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'MemberValidationError';
    this.code       = 'MEMBER_VALIDATION_ERROR';
    this.statusCode = 400;
  }
}

class MemberNotFoundError extends Error {
  constructor(workspaceId, userId) {
    super(`Member ${userId} not found in workspace ${workspaceId}`);
    this.name       = 'MemberNotFoundError';
    this.code       = 'MEMBER_NOT_FOUND';
    this.statusCode = 404;
  }
}

class MemberLimitError extends Error {
  constructor(workspaceId) {
    super(`Workspace ${workspaceId} has reached the maximum member limit (${MAX_MEMBERS_PER_WORKSPACE})`);
    this.name       = 'MemberLimitError';
    this.code       = 'MEMBER_LIMIT_REACHED';
    this.statusCode = 429;
  }
}

// ── Domain object ─────────────────────────────────────────────────────────────
class WorkspaceMember {
  /**
   * @param {object} opts
   * @param {string}  opts.workspaceId
   * @param {string}  opts.userId
   * @param {string} [opts.role]
   * @param {string} [opts.addedBy]
   * @param {string} [opts.joinedAt]
   * @param {string} [opts.updatedAt]
   */
  constructor(opts = {}) {
    this.workspaceId = opts.workspaceId;
    this.userId      = opts.userId;
    this.role        = MEMBER_ROLES.includes(opts.role) ? opts.role : DEFAULT_ROLE;
    this.addedBy     = opts.addedBy  || null;
    this.joinedAt    = opts.joinedAt || new Date().toISOString();
    this.updatedAt   = opts.updatedAt || this.joinedAt;
  }

  toJSON() {
    return {
      workspaceId: this.workspaceId,
      userId:      this.userId,
      role:        this.role,
      addedBy:     this.addedBy,
      joinedAt:    this.joinedAt,
      updatedAt:   this.updatedAt,
    };
  }
}

// ── Service ───────────────────────────────────────────────────────────────────
class WorkspaceMemberService {
  /**
   * @param {object}  opts
   * @param {object} [opts.pool]      — pg pool (optional; null → in-memory only)
   * @param {boolean} [opts.dbEnabled]
   * @param {object} [opts.logger]
   */
  constructor({ pool = null, dbEnabled = true, logger = null } = {}) {
    /**
     * In-memory store: Map<`${workspaceId}:${userId}`, WorkspaceMember>
     */
    this._store     = new Map();
    this._pool      = pool;
    this._dbEnabled = dbEnabled && pool !== null;
    this._log       = logger || { info: () => {}, warn: () => {}, error: () => {} };
    this._version   = 'V176';
  }

  /** @private */
  _key(workspaceId, userId) {
    return `${workspaceId}:${userId}`;
  }

  // ── addMember ─────────────────────────────────────────────────────────────
  /**
   * Add (or update) a member in a workspace. Upsert semantics: if the user is
   * already a member, their role is updated.
   *
   * @param {string} workspaceId
   * @param {string} userId
   * @param {object} [opts]
   * @param {string} [opts.role]
   * @param {string} [opts.addedBy]
   * @returns {Promise<{ member: WorkspaceMember, created: boolean }>}
   */
  async addMember(workspaceId, userId, { role = DEFAULT_ROLE, addedBy = null } = {}) {
    if (!workspaceId) throw new MemberValidationError('workspaceId required');
    if (!userId)      throw new MemberValidationError('userId required');
    if (!MEMBER_ROLES.includes(role)) {
      throw new MemberValidationError(`Invalid role "${role}". Valid roles: ${MEMBER_ROLES.join(', ')}`);
    }

    const key     = this._key(workspaceId, userId);
    const existing = this._store.get(key);

    if (existing) {
      // Upsert: update role
      existing.role      = role;
      existing.updatedAt = new Date().toISOString();
      if (this._dbEnabled && this._pool) {
        this._pool.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by, joined_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
          [workspaceId, userId, role, addedBy]
        ).catch(err => this._log.warn({ err: err.message }, '[V176] DB member upsert failed (non-fatal)'));
      }
      return { member: existing, created: false };
    }

    // Enforce limit
    const wsMembers = [...this._store.values()].filter(m => m.workspaceId === workspaceId);
    if (wsMembers.length >= MAX_MEMBERS_PER_WORKSPACE) {
      throw new MemberLimitError(workspaceId);
    }

    const member = new WorkspaceMember({ workspaceId, userId, role, addedBy });
    this._store.set(key, member);

    if (this._dbEnabled && this._pool) {
      this._pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by, joined_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [workspaceId, userId, role, addedBy]
      ).catch(err => this._log.warn({ err: err.message }, '[V176] DB member insert failed (non-fatal)'));
    }

    this._log.info({ workspaceId, userId, role }, '[V176-T02] Member added');
    return { member, created: true };
  }

  // ── getMember ─────────────────────────────────────────────────────────────
  /**
   * Get a single member record.
   *
   * @param {string} workspaceId
   * @param {string} userId
   * @returns {WorkspaceMember}
   * @throws {MemberNotFoundError}
   */
  getMember(workspaceId, userId) {
    if (!workspaceId) throw new MemberValidationError('workspaceId required');
    if (!userId)      throw new MemberValidationError('userId required');
    const member = this._store.get(this._key(workspaceId, userId));
    if (!member) throw new MemberNotFoundError(workspaceId, userId);
    return member;
  }

  // ── listMembers ───────────────────────────────────────────────────────────
  /**
   * List all members of a workspace, optionally filtered by role.
   *
   * @param {string}  workspaceId
   * @param {object} [opts]
   * @param {string} [opts.role]
   * @returns {WorkspaceMember[]}
   */
  listMembers(workspaceId, { role } = {}) {
    if (!workspaceId) throw new MemberValidationError('workspaceId required');
    return [...this._store.values()]
      .filter(m => m.workspaceId === workspaceId && (!role || m.role === role))
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }

  // ── updateRole ────────────────────────────────────────────────────────────
  /**
   * Update a member's role.
   *
   * @param {string} workspaceId
   * @param {string} userId
   * @param {string} newRole
   * @returns {WorkspaceMember}
   * @throws {MemberNotFoundError}
   */
  updateRole(workspaceId, userId, newRole) {
    if (!workspaceId) throw new MemberValidationError('workspaceId required');
    if (!userId)      throw new MemberValidationError('userId required');
    if (!MEMBER_ROLES.includes(newRole)) {
      throw new MemberValidationError(`Invalid role "${newRole}". Valid roles: ${MEMBER_ROLES.join(', ')}`);
    }

    const member = this._store.get(this._key(workspaceId, userId));
    if (!member) throw new MemberNotFoundError(workspaceId, userId);

    member.role      = newRole;
    member.updatedAt = new Date().toISOString();

    if (this._dbEnabled && this._pool) {
      this._pool.query(
        'UPDATE workspace_members SET role=$3, updated_at=NOW() WHERE workspace_id=$1 AND user_id=$2',
        [workspaceId, userId, newRole]
      ).catch(err => this._log.warn({ err: err.message }, '[V176] DB role update failed (non-fatal)'));
    }

    this._log.info({ workspaceId, userId, newRole }, '[V176-T02] Member role updated');
    return member;
  }

  // ── removeMember ──────────────────────────────────────────────────────────
  /**
   * Remove a member from a workspace.
   *
   * @param {string} workspaceId
   * @param {string} userId
   * @returns {{ removed: boolean }}
   */
  removeMember(workspaceId, userId) {
    if (!workspaceId) throw new MemberValidationError('workspaceId required');
    if (!userId)      throw new MemberValidationError('userId required');

    const key     = this._key(workspaceId, userId);
    const existed = this._store.delete(key);

    if (existed && this._dbEnabled && this._pool) {
      this._pool.query(
        'DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',
        [workspaceId, userId]
      ).catch(err => this._log.warn({ err: err.message }, '[V176] DB member delete failed (non-fatal)'));
    }

    if (existed) {
      this._log.info({ workspaceId, userId }, '[V176-T02] Member removed');
    }
    return { removed: existed };
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  /**
   * Return aggregate statistics.
   *
   * @returns {{ totalMembers: number, workspaceCount: number, roleBreakdown: object }}
   */
  stats() {
    const members = [...this._store.values()];
    const roleBreakdown = {};
    for (const role of MEMBER_ROLES) roleBreakdown[role] = 0;
    for (const m of members) roleBreakdown[m.role] = (roleBreakdown[m.role] || 0) + 1;
    return {
      totalMembers:    members.length,
      workspaceCount:  new Set(members.map(m => m.workspaceId)).size,
      roleBreakdown,
    };
  }

  /** @internal — for testing only */
  _clear() { this._store.clear(); }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
const defaultMemberService = new WorkspaceMemberService({ pool: null, dbEnabled: false });

module.exports = {
  WorkspaceMemberService,
  WorkspaceMember,
  MemberValidationError,
  MemberNotFoundError,
  MemberLimitError,
  MEMBER_ROLES,
  DEFAULT_ROLE,
  MAX_MEMBERS_PER_WORKSPACE,
  defaultMemberService,
};

if (process.env.NODE_ENV === 'test') {
  module.exports._members = defaultMemberService;
}
