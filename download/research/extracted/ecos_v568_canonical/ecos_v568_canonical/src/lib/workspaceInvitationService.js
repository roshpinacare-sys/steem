/**
 * lib/workspaceInvitationService.js — V159
 * ==========================================
 * Workspace Member Invitation System
 * שירות הזמנות לחברות ב-workspace — יצירת JWT tokens קצרי-TTL + קבלת הזמנה
 *
 * תכונות:
 *  - יצירת invite token (JWT, TTL 48 שעות)
 *  - קבלת הזמנה → יצירת workspace_members row
 *  - ביטול הזמנה
 *  - רשימת הזמנות ממתינות
 *  - מניעת כפילות (workspace + email)
 *  - DB integration: טבלת workspace_invitations
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — לא נגענו
 * [V159-TASK-05]
 */

'use strict';

const crypto = require('crypto');

const INVITATION_TTL_HOURS = 48;
const VALID_ROLES          = ['admin', 'manager', 'member', 'viewer'];

// ── Lightweight HS256 JWT (no external dep) ──────────────────────────────────
const _b64url = b => Buffer.from(b).toString('base64url');
const _unb64  = s => Buffer.from(s, 'base64url').toString('utf8');
const _JWT_HEADER = _b64url('{"alg":"HS256","typ":"JWT"}');

function _jwtSign(payload, secret, expiresInMs) {
  const p   = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor((Date.now() + expiresInMs) / 1000) };
  const msg = `${_JWT_HEADER}.${_b64url(JSON.stringify(p))}`;
  const sig = crypto.createHmac('sha256', secret).update(msg).digest('base64url');
  return `${msg}.${sig}`;
}

function _jwtVerify(token, secret) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const msg     = `${parts[0]}.${parts[1]}`;
  const sigCalc = crypto.createHmac('sha256', secret).update(msg).digest('base64url');
  // timing-safe compare
  const a = Buffer.from(sigCalc);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid token signature');
  const payload = JSON.parse(_unb64(parts[1]));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) throw new Error('Token expired');
  return payload;
}

// ── WorkspaceInvitation record ───────────────────────────────────────────────
class WorkspaceInvitation {
  constructor(data) {
    this.id          = data.id          || `inv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.workspaceId = data.workspaceId;
    this.email       = (data.email || '').toLowerCase().trim();
    this.role        = VALID_ROLES.includes(data.role) ? data.role : 'member';
    this.invitedBy   = data.invitedBy   || null;
    this.token       = data.token       || null;
    this.status      = data.status      || 'pending'; // pending | accepted | revoked | expired
    this.createdAt   = data.createdAt   || new Date().toISOString();
    this.expiresAt   = data.expiresAt   || new Date(Date.now() + INVITATION_TTL_HOURS * 3600000).toISOString();
    this.acceptedAt  = data.acceptedAt  || null;
  }

  isExpired() {
    return this.status !== 'accepted' && new Date() > new Date(this.expiresAt);
  }

  toJSON() {
    return {
      id:          this.id,
      workspaceId: this.workspaceId,
      email:       this.email,
      role:        this.role,
      invitedBy:   this.invitedBy,
      status:      this.isExpired() && this.status === 'pending' ? 'expired' : this.status,
      createdAt:   this.createdAt,
      expiresAt:   this.expiresAt,
      acceptedAt:  this.acceptedAt,
    };
  }
}

// ── WorkspaceInvitationService ───────────────────────────────────────────────
class WorkspaceInvitationService {
  constructor({ db = null, logger = null, jwtSecret = null } = {}) {
    /** @type {Map<string, WorkspaceInvitation>} inviteId → invitation */
    this._store     = new Map();
    this._db        = db;
    this._log       = logger || { info: () => {}, warn: () => {} };
    this._jwtSecret = jwtSecret || process.env.JWT_SECRET || 'ecos-dev-invitation-secret';
    this._version   = 'V159';
  }

  setDb(db) { this._db = db; }

  // ── יצירת הזמנה ─────────────────────────────────────────────────────────
  async createInvitation(workspaceId, data) {
    if (!workspaceId) throw new Error('workspaceId required');
    if (!data.email)  throw new Error('email required');
    if (!this._isValidEmail(data.email)) throw new Error('Invalid email address');
    if (data.role && !VALID_ROLES.includes(data.role)) {
      throw new Error(`Invalid role: ${data.role}. Valid: ${VALID_ROLES.join(', ')}`);
    }

    // בדוק כפילות: האם כבר קיימת הזמנה ממתינה לאותו email+workspace
    const existing = [...this._store.values()].find(
      inv => inv.workspaceId === workspaceId &&
             inv.email === data.email.toLowerCase().trim() &&
             inv.status === 'pending' &&
             !inv.isExpired()
    );
    if (existing) {
      return { invitation: existing.toJSON(), alreadyExists: true };
    }

    const inv = new WorkspaceInvitation({ ...data, workspaceId });

    // צור native HS256 token
    inv.token = _jwtSign(
      {
        sub:         `invite:${inv.id}`,
        workspaceId: inv.workspaceId,
        email:       inv.email,
        role:        inv.role,
        inviteId:    inv.id,
        type:        'workspace_invitation',
      },
      this._jwtSecret,
      INVITATION_TTL_HOURS * 3600000
    );

    this._store.set(inv.id, inv);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO workspace_invitations
            (id, workspace_id, email, role, invited_by, token, status, created_at, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO NOTHING`,
          [inv.id, workspaceId, inv.email, inv.role, inv.invitedBy,
           inv.token, inv.status, inv.createdAt, inv.expiresAt]
        );
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[invitationService] DB insert failed (in-memory persisted)');
      }
    }

    this._log.info({ inviteId: inv.id, workspaceId, email: inv.email }, '[invitationService] invitation created');
    return { invitation: inv.toJSON(), token: inv.token, alreadyExists: false };
  }

  // ── קבלת הזמנה ──────────────────────────────────────────────────────────
  async acceptInvitation(token, acceptingUserId) {
    if (!token)           throw new Error('token required');
    if (!acceptingUserId) throw new Error('acceptingUserId required');

    // פענח native HS256 token
    let decoded;
    try {
      decoded = _jwtVerify(token, this._jwtSecret);
    } catch (err) {
      throw new Error(`Invalid or expired invitation token: ${err.message}`);
    }

    if (decoded.type !== 'workspace_invitation') throw new Error('Not a workspace invitation token');

    const inv = this._store.get(decoded.inviteId);
    if (!inv) {
      // Try DB
      if (this._db) {
        try {
          const r = await this._db.query(
            'SELECT * FROM workspace_invitations WHERE id=$1 AND token=$2',
            [decoded.inviteId, token]
          );
          if (!r.rows[0]) throw new Error('Invitation not found');
          const row = r.rows[0];
          if (row.status !== 'pending') throw new Error(`Invitation already ${row.status}`);
          if (new Date() > new Date(row.expires_at)) throw new Error('Invitation has expired');
        } catch (err) {
          throw err;
        }
      } else {
        throw new Error('Invitation not found');
      }
    } else {
      if (inv.status !== 'pending')  throw new Error(`Invitation already ${inv.status}`);
      if (inv.isExpired())           throw new Error('Invitation has expired');
    }

    // עדכן סטטוס
    if (inv) {
      inv.status     = 'accepted';
      inv.acceptedAt = new Date().toISOString();
    }

    if (this._db) {
      try {
        await this._db.query(
          `UPDATE workspace_invitations SET status='accepted', accepted_at=NOW() WHERE id=$1`,
          [decoded.inviteId]
        );
        // Add to workspace_members
        const memberId = `wm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        await this._db.query(
          `INSERT INTO workspace_members (id, workspace_id, user_id, role, invited_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role=EXCLUDED.role`,
          [memberId, decoded.workspaceId, acceptingUserId, decoded.role, decoded.email]
        ).catch(() => {});
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[invitationService] DB accept failed (non-fatal)');
      }
    }

    this._log.info({ inviteId: decoded.inviteId, workspaceId: decoded.workspaceId, userId: acceptingUserId }, '[invitationService] invitation accepted');

    return {
      ok:          true,
      workspaceId: decoded.workspaceId,
      email:       decoded.email,
      role:        decoded.role,
      inviteId:    decoded.inviteId,
      userId:      acceptingUserId,
      acceptedAt:  new Date().toISOString(),
    };
  }

  // ── ביטול הזמנה ─────────────────────────────────────────────────────────
  async revokeInvitation(workspaceId, inviteId) {
    const inv = this._store.get(inviteId);
    if (inv && inv.workspaceId === workspaceId) {
      inv.status = 'revoked';
    }
    if (this._db) {
      try {
        await this._db.query(
          `UPDATE workspace_invitations SET status='revoked' WHERE id=$1 AND workspace_id=$2`,
          [inviteId, workspaceId]
        );
      } catch (_) {}
    }
    return inv ? inv.toJSON() : null;
  }

  // ── רשימת הזמנות ─────────────────────────────────────────────────────────
  async listInvitations(workspaceId, status = null) {
    if (this._db) {
      try {
        const conditions = ['workspace_id=$1'];
        const params     = [workspaceId];
        if (status) { conditions.push(`status=$2`); params.push(status); }
        const r = await this._db.query(
          `SELECT id,workspace_id,email,role,invited_by,status,created_at,expires_at,accepted_at
           FROM workspace_invitations WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
          params
        );
        return r.rows.map(row => ({
          id:         row.id,
          workspaceId: row.workspace_id,
          email:      row.email,
          role:       row.role,
          invitedBy:  row.invited_by,
          status:     new Date() > new Date(row.expires_at) && row.status === 'pending' ? 'expired' : row.status,
          createdAt:  row.created_at,
          expiresAt:  row.expires_at,
          acceptedAt: row.accepted_at,
        }));
      } catch (dbErr) {
        this._log.warn({ err: dbErr.message }, '[invitationService] DB list failed, fallback to memory');
      }
    }
    let invites = [...this._store.values()].filter(i => i.workspaceId === workspaceId);
    if (status) invites = invites.filter(i => (i.isExpired() && i.status === 'pending' ? 'expired' : i.status) === status);
    return invites.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(i => i.toJSON());
  }

  // ── קבלת הזמנה בודדת ─────────────────────────────────────────────────────
  getInvitation(inviteId) {
    const inv = this._store.get(inviteId);
    return inv ? inv.toJSON() : null;
  }

  // ── ניקוי פגות תוקף ─────────────────────────────────────────────────────
  cleanupExpired() {
    let removed = 0;
    for (const [id, inv] of this._store) {
      if (inv.isExpired() && inv.status === 'pending') {
        inv.status = 'expired';
        removed++;
      }
    }
    return removed;
  }

  // ── utils ─────────────────────────────────────────────────────────────────
  _isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  get VALID_ROLES() { return VALID_ROLES; }
  get TTL_HOURS()   { return INVITATION_TTL_HOURS; }
}

// Singleton
const defaultInvitationService = new WorkspaceInvitationService();

module.exports = {
  WorkspaceInvitationService,
  defaultInvitationService,
  VALID_ROLES,
  INVITATION_TTL_HOURS,
};
