'use strict';
/**
 * lib/workspaceTokenService181.js — ECOS V181
 * In-memory per-workspace broadcast auth token store.
 *
 * Stores an optional secret token per workspaceId.  When a token is set the
 * POST /workspaces/:id/broadcast handler checks the `X-Workspace-Token` header
 * and rejects requests that carry the wrong token (HTTP 403).  Workspaces
 * without a token configured remain open (backwards-compatible default).
 *
 * Design notes
 * ─────────────
 *  • Zero external deps (R6) — only built-in `crypto`.
 *  • Timing-safe comparison via `crypto.timingSafeEqual` to prevent timing
 *    attacks on the token check.
 *  • All identifiers suffixed _181 / 181 (R8 duplicate-const guard).
 *  • shutdown() clears the store (test / graceful-teardown support).
 *
 * @version 181.0.0
 */

const crypto = require('crypto');

class TokenValidationError181 extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'TokenValidationError181';
    this.code       = 'TOKEN_VALIDATION_181';
    this.statusCode = 400;
  }
}

class TokenAuthError181 extends Error {
  constructor(msg) {
    super(msg);
    this.name       = 'TokenAuthError181';
    this.code       = 'TOKEN_AUTH_FORBIDDEN_181';
    this.statusCode = 403;
  }
}

class WorkspaceTokenService181 {
  constructor(opts = {}) {
    this._log    = opts.logger || { info() {}, warn() {}, error() {} };
    // workspaceId -> token string (plaintext — stored server-side only)
    this._tokens = new Map();
  }

  setLogger(log) { this._log = log; }

  /**
   * Set (or replace) the broadcast auth token for a workspace.
   * @param {string} workspaceId
   * @param {string} token — must be a non-empty string, max 256 chars
   * @returns {{ workspaceId, set: true }}
   */
  setToken(workspaceId, token) {
    if (!workspaceId || typeof workspaceId !== 'string') {
      throw new TokenValidationError181('workspaceId is required');
    }
    if (!token || typeof token !== 'string') {
      throw new TokenValidationError181('token must be a non-empty string');
    }
    if (token.length > 256) {
      throw new TokenValidationError181('token must be ≤256 characters');
    }
    this._tokens.set(workspaceId, token);
    this._log.info && this._log.info({ component: 'tokenService181', workspaceId }, 'broadcast token set');
    return { workspaceId, set: true };
  }

  /**
   * Remove the token for a workspace (makes it open again).
   * @param {string} workspaceId
   * @returns {boolean} true if a token existed and was removed
   */
  clearToken(workspaceId) {
    const existed = this._tokens.has(workspaceId);
    this._tokens.delete(workspaceId);
    return existed;
  }

  /**
   * Check whether a workspace has a token configured.
   * @param {string} workspaceId
   * @returns {boolean}
   */
  hasToken(workspaceId) {
    return this._tokens.has(workspaceId);
  }

  /**
   * Verify a provided token against the stored token for a workspace.
   *
   * Rules:
   *  • If no token is configured for the workspace → passes (open workspace).
   *  • If a token is configured and `provided` is missing/wrong → throws
   *    TokenAuthError181 (HTTP 403).
   *  • Comparison is timing-safe.
   *
   * @param {string} workspaceId
   * @param {string|undefined} provided — value from X-Workspace-Token header
   * @returns {true} if authorised
   * @throws {TokenAuthError181} if token mismatch
   */
  verify(workspaceId, provided) {
    const stored = this._tokens.get(workspaceId);
    if (!stored) return true; // no token configured → open
    if (!provided) {
      throw new TokenAuthError181('X-Workspace-Token header is required for this workspace');
    }
    // Timing-safe comparison
    let match = false;
    try {
      const storedBuf   = Buffer.from(stored,   'utf8');
      const providedBuf = Buffer.from(provided, 'utf8');
      // buffers must be same length for timingSafeEqual; pad to avoid length leak
      if (storedBuf.length === providedBuf.length) {
        match = crypto.timingSafeEqual(storedBuf, providedBuf);
      }
    } catch (_) {
      match = false;
    }
    if (!match) {
      throw new TokenAuthError181('Invalid X-Workspace-Token');
    }
    return true;
  }

  /** Stats for the admin summary. */
  stats() {
    return {
      configuredWorkspaces: this._tokens.size,
    };
  }

  /** Tear-down (test support). */
  shutdown() {
    this._tokens.clear();
  }
}

const defaultTokenService181 = new WorkspaceTokenService181();

module.exports = {
  WorkspaceTokenService181,
  TokenValidationError181,
  TokenAuthError181,
  defaultTokenService181,
};
