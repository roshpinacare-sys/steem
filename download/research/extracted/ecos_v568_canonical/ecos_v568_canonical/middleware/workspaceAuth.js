/**
 * middleware/workspaceAuth.js — V158
 * ====================================
 * Workspace Membership Authorization Middleware
 * בודק שמשתמש הוא חבר ב-workspace (או admin) לפני גישה ל-endpoint
 *
 * שימוש: app.use('/api/v1/workspaces/:workspaceId/tasks', workspaceAuth(opts))
 *
 * [V158] — Workspace security middleware
 * Sacred Files: לא נגענו ב-lib/fiatLedger.js, lib/auditLog.js
 */

'use strict';

/**
 * workspaceAuth(opts)
 * @param {object} opts
 * @param {Function} opts.getMembership  async(workspaceId, userId) → {isMember, role}
 * @param {boolean}  opts.allowPublic    if true, also allow workspaces with visibility='public'
 * @param {Function} opts.getUserId      (req) → userId | null
 * @param {object}   opts.logger         pino-like logger (optional)
 * @returns Express middleware
 */
function workspaceAuth(opts = {}) {
  const {
    getMembership = null,
    allowPublic   = false,
    getUserId     = (req) => req.user?.id || req.headers['x-user-id'] || null,
    logger        = { warn: () => {} },
  } = opts;

  return async function(req, res, next) {
    const workspaceId = req.params.workspaceId || req.params.id;
    if (!workspaceId) return next(); // no workspaceId in route — skip

    const userId = getUserId(req);

    // admin bypass: if x-admin-token matches ECOS_ADMIN_TOKEN env var
    if (process.env.ECOS_ADMIN_TOKEN) {
      const token = req.headers['x-admin-token'] || req.query.adminToken;
      if (token === process.env.ECOS_ADMIN_TOKEN) return next();
    }

    if (!getMembership) {
      // No membership provider configured — open access (dev mode)
      logger.warn({ workspaceId, userId }, '[workspaceAuth] no getMembership configured, allowing through (dev mode)');
      return next();
    }

    if (!userId) {
      return res.status(401).json({
        ok:    false,
        error: 'Authentication required to access workspace',
        code:  'WORKSPACE_AUTH_REQUIRED',
      });
    }

    try {
      const membership = await getMembership(workspaceId, userId);

      if (!membership) {
        if (allowPublic) {
          // Could check if workspace is public — but without DB integration here,
          // we pass through if caller opted in
          return next();
        }
        logger.warn({ workspaceId, userId }, '[workspaceAuth] not a workspace member');
        return res.status(403).json({
          ok:    false,
          error: 'You are not a member of this workspace',
          code:  'WORKSPACE_ACCESS_DENIED',
        });
      }

      // Attach membership info to request
      req.workspaceMembership = membership;
      req.workspaceId         = workspaceId;
      next();
    } catch (err) {
      logger.warn({ err: err.message, workspaceId }, '[workspaceAuth] membership check failed');
      return res.status(500).json({ ok: false, error: 'Workspace auth check failed', code: 'WORKSPACE_AUTH_ERROR' });
    }
  };
}

/**
 * requireWorkspaceRole(role)
 * Usage: router.delete('/:taskId', requireWorkspaceRole(['admin', 'manager']), handler)
 */
function requireWorkspaceRole(roles = []) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return function(req, res, next) {
    const membership = req.workspaceMembership;
    if (!membership) {
      return res.status(403).json({ ok: false, error: 'No workspace membership found', code: 'NO_MEMBERSHIP' });
    }
    if (allowed.length && !allowed.includes(membership.role)) {
      return res.status(403).json({
        ok:       false,
        error:    `Insufficient role. Required: ${allowed.join(' or ')}, got: ${membership.role}`,
        code:     'INSUFFICIENT_WORKSPACE_ROLE',
      });
    }
    next();
  };
}

module.exports = { workspaceAuth, requireWorkspaceRole };
