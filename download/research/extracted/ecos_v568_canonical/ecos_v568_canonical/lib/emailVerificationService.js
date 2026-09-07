'use strict';
/**
 * lib/emailVerificationService.js — ECOS V144
 * ─────────────────────────────────────────────────────────────────────────────
 * [V144-EMAIL-01] Email verification + password reset tokens.
 *
 * Design:
 *   - Tokens: 32 random bytes, base64url-encoded (URL-safe)
 *   - Storage: SHA-256 hash of token in DB (token_hash column) — raw token
 *     never stored, only sent to user via email/webhook.
 *   - TTL: 24h for email verification, 1h for password reset
 *   - One active token per (userId, type) — creating a new one invalidates old.
 *   - Delivery: via notificationService webhook (same pattern as rest of ECOS),
 *     OR stdout log in dev mode (ECOS_EMAIL_DEV_LOG=true).
 *
 * No external dependencies — only Node.js built-ins.
 *
 * Usage:
 *   const { emailVerificationService } = require('./emailVerificationService');
 *
 *   // Create + deliver verification token
 *   const { token, expiresAt } = await emailVerificationService.createToken(userId, 'verify_email');
 *   // token is sent to user's email; server only stores token_hash
 *
 *   // Verify user-submitted token
 *   const result = await emailVerificationService.consumeToken(rawToken, 'verify_email');
 *   // { ok: true, userId } | { ok: false, reason: 'expired'|'not_found'|'already_used' }
 */

const crypto = require('node:crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const TOKEN_BYTES = 32;  // 256 bits → 43-char base64url string

const TTL_SECONDS = {
  verify_email:   24 * 60 * 60,  // 24 hours
  reset_password:  1 * 60 * 60,  //  1 hour
};

const TOKEN_TYPES = new Set(['verify_email', 'reset_password']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

// ── In-memory store (DB fallback when Postgres unavailable) ──────────────────
// Structure: Map<tokenHash, { userId, type, expiresAt, usedAt }>

class InMemoryTokenStore {
  constructor() {
    this._tokens = new Map(); // tokenHash → record
    this._byUser = new Map(); // `${userId}:${type}` → tokenHash (latest)
  }

  /** Invalidate any existing token for this user+type. */
  invalidateExisting(userId, type) {
    const key = `${userId}:${type}`;
    const oldHash = this._byUser.get(key);
    if (oldHash) {
      this._tokens.delete(oldHash);
      this._byUser.delete(key);
    }
  }

  /** Store a new token. */
  set(tokenHash, record) {
    this._tokens.set(tokenHash, { ...record, usedAt: null });
    this._byUser.set(`${record.userId}:${record.type}`, tokenHash);
  }

  /** Look up by token hash. */
  get(tokenHash) {
    return this._tokens.get(tokenHash) || null;
  }

  /** Mark a token as used (consume). Returns false if already used. */
  consume(tokenHash) {
    const record = this._tokens.get(tokenHash);
    if (!record) return false;
    if (record.usedAt) return false; // already consumed
    record.usedAt = new Date().toISOString();
    return true;
  }

  /** Sweep expired tokens (call periodically). */
  sweepExpired() {
    const now = nowSeconds();
    for (const [hash, record] of this._tokens.entries()) {
      if (record.expiresAt < now) {
        this._byUser.delete(`${record.userId}:${record.type}`);
        this._tokens.delete(hash);
      }
    }
  }

  stats() {
    return { total: this._tokens.size };
  }
}

// ── DB Store (wraps a Postgres pool when available) ───────────────────────────

class DbTokenStore {
  constructor(pool) {
    this._pool = pool;
  }

  async invalidateExisting(userId, type) {
    await this._pool.query(
      `UPDATE email_verification_tokens
          SET used_at = NOW()
        WHERE user_id = $1 AND type = $2 AND used_at IS NULL`,
      [userId, type],
    );
  }

  async set(tokenHash, { userId, type, expiresAt }) {
    await this._pool.query(
      `INSERT INTO email_verification_tokens (token_hash, user_id, type, expires_at)
       VALUES ($1, $2, $3, to_timestamp($4))
       ON CONFLICT (token_hash) DO NOTHING`,
      [tokenHash, userId, type, expiresAt],
    );
  }

  async get(tokenHash) {
    const { rows } = await this._pool.query(
      `SELECT user_id, type, extract(epoch from expires_at)::int AS expires_at, used_at
         FROM email_verification_tokens
        WHERE token_hash = $1`,
      [tokenHash],
    );
    if (!rows.length) return null;
    return {
      userId:    rows[0].user_id,
      type:      rows[0].type,
      expiresAt: rows[0].expires_at,
      usedAt:    rows[0].used_at,
    };
  }

  async consume(tokenHash) {
    const { rowCount } = await this._pool.query(
      `UPDATE email_verification_tokens
          SET used_at = NOW()
        WHERE token_hash = $1 AND used_at IS NULL`,
      [tokenHash],
    );
    return rowCount > 0;
  }

  async sweepExpired() {
    await this._pool.query(
      `DELETE FROM email_verification_tokens WHERE expires_at < NOW() AND used_at IS NOT NULL`,
    );
  }

  stats() { return { source: 'db' }; }
}

// ── EmailVerificationService ──────────────────────────────────────────────────

class EmailVerificationService {
  /**
   * @param {object} opts
   * @param {object} [opts.dbPool]              — Postgres pool (optional)
   * @param {function} [opts.deliverFn]         — async (userId, email, type, token, expiresAt) => void
   *                                              Defaults to dev stdout log.
   */
  constructor({ dbPool = null, deliverFn = null } = {}) {
    this._store    = dbPool ? new DbTokenStore(dbPool) : new InMemoryTokenStore();
    this._deliver  = deliverFn || this._defaultDeliver.bind(this);
    this._devLog   = process.env.ECOS_EMAIL_DEV_LOG !== 'false'; // default: true in dev
  }

  /** Set a real DB pool after construction (called by server when pool is available). */
  setDbPool(pool) {
    this._store = new DbTokenStore(pool);
  }

  /** Set a custom delivery function (e.g. notificationService webhook). */
  setDeliverFn(fn) {
    this._deliver = fn;
  }

  // ── Core API ──────────────────────────────────────────────────────────────

  /**
   * Create a token for userId of given type.
   * Invalidates any existing active token of the same type.
   * Calls deliverFn to send the raw token to the user.
   *
   * @param {string} userId
   * @param {'verify_email'|'reset_password'} type
   * @param {object} [meta] — { email, displayName } for delivery
   * @returns {{ token: string, expiresAt: string, tokenHash: string }}
   */
  async createToken(userId, type, meta = {}) {
    if (!TOKEN_TYPES.has(type)) throw new Error(`Unknown token type: ${type}`);

    const rawToken  = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = nowSeconds() + TTL_SECONDS[type];

    // Invalidate old token first
    await this._store.invalidateExisting(userId, type);

    // Store new token (only the hash)
    await this._store.set(tokenHash, { userId, type, expiresAt });

    // Deliver (fire-and-forget — don't fail the caller on delivery error)
    const expiresAtISO = new Date(expiresAt * 1000).toISOString();
    this._deliver(userId, type, rawToken, expiresAtISO, meta).catch(err => {
      console.error('[emailVerificationService] delivery failed:', err.message);
    });

    return { token: rawToken, expiresAt: expiresAtISO, tokenHash };
  }

  /**
   * Consume (verify + mark used) a raw token.
   *
   * @param {string} rawToken
   * @param {'verify_email'|'reset_password'} type
   * @returns {{ ok: true, userId: string } | { ok: false, reason: string }}
   */
  async consumeToken(rawToken, type) {
    if (!rawToken || typeof rawToken !== 'string') {
      return { ok: false, reason: 'invalid_token' };
    }

    const tokenHash = hashToken(rawToken);
    const record    = await this._store.get(tokenHash);

    if (!record) {
      return { ok: false, reason: 'not_found' };
    }

    if (record.type !== type) {
      return { ok: false, reason: 'wrong_type' };
    }

    if (record.usedAt) {
      return { ok: false, reason: 'already_used' };
    }

    if (record.expiresAt < nowSeconds()) {
      return { ok: false, reason: 'expired' };
    }

    const consumed = await this._store.consume(tokenHash);
    if (!consumed) {
      return { ok: false, reason: 'already_used' }; // race condition
    }

    return { ok: true, userId: record.userId };
  }

  /**
   * Sweep expired tokens (call on a timer, e.g. hourly).
   */
  async sweepExpired() {
    await this._store.sweepExpired();
  }

  stats() {
    return { store: this._store.stats() };
  }

  // ── Default delivery (dev stdout + optional webhook) ──────────────────────

  async _defaultDeliver(userId, type, rawToken, expiresAt, meta) {
    const label = type === 'verify_email' ? 'Email Verification' : 'Password Reset';
    const link  = type === 'verify_email'
      ? `${process.env.APP_BASE_URL || 'http://localhost:4000'}/verify-email?token=${rawToken}`
      : `${process.env.APP_BASE_URL || 'http://localhost:4000'}/reset-password?token=${rawToken}`;

    if (this._devLog) {
      console.log(`\n[ECOS EMAIL - DEV] ─────────────────────────────────────`);
      console.log(`  Type:       ${label}`);
      console.log(`  User:       ${userId}${meta.email ? ` <${meta.email}>` : ''}`);
      console.log(`  Token:      ${rawToken}`);
      console.log(`  Link:       ${link}`);
      console.log(`  Expires:    ${expiresAt}`);
      console.log(`────────────────────────────────────────────────────────\n`);
    }

    // If a notificationService webhook is registered for this user, deliver there too
    // (lazy require to avoid circular deps)
    try {
      const { defaultNotificationService } = require('./notificationService');
      defaultNotificationService.deliver(userId, {
        event:     type,
        token:     rawToken,
        link,
        expiresAt,
        email:     meta.email,
      });
    } catch (_) {
      // notificationService not available — dev stdout is enough
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const emailVerificationService = new EmailVerificationService();

module.exports = {
  EmailVerificationService,
  InMemoryTokenStore,
  DbTokenStore,
  emailVerificationService,
  hashToken,
  TOKEN_TYPES,
  TTL_SECONDS,
};
