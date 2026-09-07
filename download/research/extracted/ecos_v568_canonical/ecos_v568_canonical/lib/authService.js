'use strict';
/**
 * lib/authService.js — ECOS V143 Real Auth
 * ─────────────────────────────────────────────────────────────────────────────
 * [V143-AUTH-01] Email+password authentication with short-lived access JWTs
 * and long-lived refresh tokens (rotation + reuse detection).
 *
 * Design:
 *   - Access JWT:  15 minutes, signed with JWT_SECRET (HS256, manual)
 *   - Refresh token: 30 days, random bytes, stored as SHA-256 hash in DB
 *   - Rotation: each /auth/refresh invalidates old token, issues new one
 *   - Reuse detection: if a revoked token is used → revoke entire family
 *   - Passwords: Node.js built-in crypto.scrypt (no bcrypt dependency)
 *
 * No external dependencies — only Node.js built-ins.
 */

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scryptAsync = promisify(crypto.scrypt);

// ── Constants ─────────────────────────────────────────────────────────────────

const SCRYPT_N     = 16384;  // CPU/memory cost — OWASP recommendation
const SCRYPT_R     = 8;
const SCRYPT_P     = 1;
const KEY_LEN      = 64;     // bytes
const SALT_LEN     = 16;     // bytes

const ACCESS_TTL_SECONDS  = 15 * 60;        // 15 minutes
const REFRESH_TTL_SECONDS = 30 * 24 * 3600; // 30 days

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate a user ID: 'usr_' + 16 random hex chars */
function generateUserId() {
  return 'usr_' + crypto.randomBytes(8).toString('hex');
}

/** Generate a refresh token: 48 random bytes base64url */
function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

/** SHA-256 hash of a raw token (for storage) */
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ── Manual HS256 JWT (no external deps) ──────────────────────────────────────

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function jwtSign(payload, secret) {
  const header  = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body    = base64url(Buffer.from(JSON.stringify(payload)));
  const sig     = base64url(crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function jwtVerify(token, secret) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = base64url(crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest());
  // Constant-time comparison
  if (expected.length !== sig.length) return null;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig,      'utf8');
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
    if (p.exp && Math.floor(Date.now() / 1000) > p.exp) return null; // expired
    return p;
  } catch { return null; }
}

// ── AuthService ───────────────────────────────────────────────────────────────

class AuthService {
  /**
   * @param {{ db?: import('pg').Pool, logger?: object }} opts
   */
  constructor({ db, logger } = {}) {
    this._db     = db     || null;
    this._logger = logger || console;
    // In-memory fallback stores (used when no DB — dev/test mode)
    this._users    = new Map(); // userId → { id, email, passwordHash, displayName, roles, accountId, locked }
    this._byEmail  = new Map(); // email → userId
    this._tokens   = new Map(); // tokenHash → { userId, family, expiresAt, revoked }
    this._families = new Map(); // family → Set<tokenHash>
  }

  /** Wire in DB pool after startup */
  setDb(pool) { this._db = pool; }

  // ── Password hashing ───────────────────────────────────────────────────────

  async hashPassword(password) {
    const salt = crypto.randomBytes(SALT_LEN);
    const key  = await scryptAsync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`;
  }

  async verifyPassword(password, hash) {
    try {
      const [, N, r, p, saltHex, keyHex] = hash.split('$');
      const salt    = Buffer.from(saltHex, 'hex');
      const stored  = Buffer.from(keyHex,  'hex');
      const derived = await scryptAsync(password, salt, KEY_LEN, {
        N: parseInt(N, 10), r: parseInt(r, 10), p: parseInt(p, 10)
      });
      return crypto.timingSafeEqual(stored, derived);
    } catch { return false; }
  }

  // ── User management ────────────────────────────────────────────────────────

  /**
   * Register a new user.
   * @returns {{ userId, email, displayName, roles }}
   */
  async register({ email, password, displayName, roles = ['user'], accountId = null }) {
    if (!email || !password) throw new Error('email and password are required');
    const emailNorm = email.toLowerCase().trim();
    if (password.length < 8)  throw new Error('password must be ≥8 characters');

    // Check duplicate
    const existing = await this._findUserByEmail(emailNorm);
    if (existing) throw Object.assign(new Error('Email already registered'), { code: 'EMAIL_TAKEN' });

    const userId      = generateUserId();
    const passwordHash = await this.hashPassword(password);

    const user = { id: userId, email: emailNorm, passwordHash, displayName: displayName || emailNorm.split('@')[0], roles, accountId, locked: false };

    if (this._db) {
      await this._db.query(
        `INSERT INTO ecos_users (id, email, password_hash, display_name, roles, account_id)
         VALUES ($1, $2, $3, $4, $5::text[], $6)`,
        [userId, emailNorm, passwordHash, user.displayName, roles, accountId]
      );
    } else {
      this._users.set(userId, user);
      this._byEmail.set(emailNorm, userId);
    }

    this._logger.info({ component: 'auth', userId, email: emailNorm }, '[V143] User registered');
    return { userId, email: emailNorm, displayName: user.displayName, roles };
  }

  /**
   * Authenticate email+password → { accessToken, refreshToken, user }
   */
  async login({ email, password, ip, userAgent }) {
    const emailNorm = (email || '').toLowerCase().trim();
    if (!emailNorm || !password) throw Object.assign(new Error('email and password are required'), { code: 'MISSING_CREDENTIALS' });

    const user = await this._findUserByEmail(emailNorm);
    if (!user) throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' });
    if (user.locked) throw Object.assign(new Error('Account is locked'), { code: 'ACCOUNT_LOCKED' });

    const ok = await this.verifyPassword(password, user.passwordHash);
    if (!ok) throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' });

    const { accessToken, refreshToken } = await this._issueTokenPair(user, ip, userAgent);
    this._logger.info({ component: 'auth', userId: user.id }, '[V143] Login successful');

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TTL_SECONDS,
      tokenType: 'Bearer',
      user: { id: user.id, email: user.email, displayName: user.displayName, roles: user.roles },
    };
  }

  /**
   * Rotate refresh token → { accessToken, refreshToken }
   * Implements refresh token rotation with reuse detection.
   */
  async refresh({ refreshToken, ip, userAgent }) {
    if (!refreshToken) throw Object.assign(new Error('refreshToken required'), { code: 'MISSING_TOKEN' });

    const tokenHash = hashToken(refreshToken);
    const stored    = await this._findRefreshToken(tokenHash);

    if (!stored) throw Object.assign(new Error('Invalid or expired refresh token'), { code: 'INVALID_TOKEN' });

    // Reuse detection: if already revoked → revoke whole family (token theft)
    if (stored.revoked) {
      await this._revokeFamilyTokens(stored.family, 'reuse_detected');
      this._logger.warn({ component: 'auth', userId: stored.userId, family: stored.family },
        '[V143-AUTH-01] Refresh token reuse detected — family revoked');
      throw Object.assign(new Error('Token reuse detected — all sessions invalidated'), { code: 'TOKEN_REUSE' });
    }

    if (stored.expiresAt < new Date()) {
      throw Object.assign(new Error('Refresh token expired'), { code: 'TOKEN_EXPIRED' });
    }

    // Revoke current token (rotation)
    await this._revokeRefreshToken(tokenHash, 'rotated');

    // Find user and issue new pair (same family for chain tracking)
    const user = await this._findUserById(stored.userId);
    if (!user) throw Object.assign(new Error('User not found'), { code: 'USER_NOT_FOUND' });

    const newPair = await this._issueTokenPair(user, ip, userAgent, stored.family);
    this._logger.info({ component: 'auth', userId: user.id }, '[V143] Token rotated');

    return {
      accessToken:  newPair.accessToken,
      refreshToken: newPair.refreshToken,
      expiresIn:    ACCESS_TTL_SECONDS,
      tokenType:    'Bearer',
    };
  }

  /**
   * Revoke a specific refresh token (logout).
   */
  async logout({ refreshToken }) {
    if (!refreshToken) return;
    const tokenHash = hashToken(refreshToken);
    await this._revokeRefreshToken(tokenHash, 'logout');
  }

  /**
   * Verify an access JWT → decoded payload, or null if invalid/expired.
   */
  verifyAccessToken(token) {
    const secret = process.env.JWT_SECRET || process.env.VALIDATOR_JWT_SECRET || 'ecos-dev-secret';
    return jwtVerify(token, secret);
  }

  // ── Token issuance ─────────────────────────────────────────────────────────

  async _issueTokenPair(user, ip, userAgent, existingFamily = null) {
    const secret = process.env.JWT_SECRET || process.env.VALIDATOR_JWT_SECRET || 'ecos-dev-secret';
    const now    = Math.floor(Date.now() / 1000);

    // Access JWT
    const accessToken = jwtSign({
      sub:         user.id,
      email:       user.email,
      roles:       user.roles,
      accountId:   user.accountId || null,
      iat:         now,
      exp:         now + ACCESS_TTL_SECONDS,
      iss:         'ecos',
    }, secret);

    // Refresh token
    const rawRefresh  = generateRefreshToken();
    const tokenHash   = hashToken(rawRefresh);
    const family      = existingFamily || crypto.randomBytes(16).toString('hex');
    const expiresAt   = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
    const tokenId     = 'rt_' + crypto.randomBytes(8).toString('hex');

    if (this._db) {
      await this._db.query(
        `INSERT INTO auth_refresh_tokens (id, user_id, token_hash, family, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tokenId, user.id, tokenHash, family, expiresAt, ip || null, userAgent || null]
      );
    } else {
      this._tokens.set(tokenHash, { userId: user.id, family, expiresAt, revoked: false });
      if (!this._families.has(family)) this._families.set(family, new Set());
      this._families.get(family).add(tokenHash);
    }

    return { accessToken, refreshToken: rawRefresh };
  }

  // ── DB/memory helpers ──────────────────────────────────────────────────────

  async _findUserByEmail(email) {
    if (this._db) {
      const { rows } = await this._db.query(
        'SELECT id, email, password_hash AS "passwordHash", display_name AS "displayName", roles, account_id AS "accountId", locked FROM ecos_users WHERE email = $1',
        [email]
      );
      return rows[0] || null;
    }
    const uid = this._byEmail.get(email);
    return uid ? this._users.get(uid) || null : null;
  }

  async _findUserById(id) {
    if (this._db) {
      const { rows } = await this._db.query(
        'SELECT id, email, password_hash AS "passwordHash", display_name AS "displayName", roles, account_id AS "accountId", locked FROM ecos_users WHERE id = $1',
        [id]
      );
      return rows[0] || null;
    }
    return this._users.get(id) || null;
  }

  async _findRefreshToken(tokenHash) {
    if (this._db) {
      const { rows } = await this._db.query(
        `SELECT user_id AS "userId", family, expires_at AS "expiresAt", revoked FROM auth_refresh_tokens WHERE token_hash = $1`,
        [tokenHash]
      );
      return rows[0] || null;
    }
    return this._tokens.get(tokenHash) || null;
  }

  async _revokeRefreshToken(tokenHash, reason) {
    if (this._db) {
      await this._db.query(
        `UPDATE auth_refresh_tokens SET revoked = TRUE, revoked_reason = $1 WHERE token_hash = $2`,
        [reason, tokenHash]
      ).catch(() => {});
    } else {
      const t = this._tokens.get(tokenHash);
      if (t) { t.revoked = true; t.revokedReason = reason; }
    }
  }

  /**
   * [V144] Revoke ALL refresh tokens for a user (used after password reset).
   */
  async revokeAllTokensForUser(userId) {
    if (this._db) {
      await this._db.query(
        `UPDATE auth_refresh_tokens SET revoked = TRUE, revoked_reason = $1 WHERE user_id = $2`,
        ['password_reset', userId],
      ).catch(() => {});
    } else {
      for (const [hash, record] of this._tokens.entries()) {
        if (record.userId === userId) { record.revoked = true; record.revokedReason = 'password_reset'; }
      }
    }
  }

  async _revokeFamilyTokens(family, reason) {
    if (this._db) {
      await this._db.query(
        `UPDATE auth_refresh_tokens SET revoked = TRUE, revoked_reason = $1 WHERE family = $2`,
        [reason, family]
      ).catch(() => {});
    } else {
      const hashes = this._families.get(family) || new Set();
      for (const h of hashes) {
        const t = this._tokens.get(h);
        if (t) { t.revoked = true; t.revokedReason = reason; }
      }
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const defaultAuthService = new AuthService();

module.exports = { AuthService, defaultAuthService, jwtSign, jwtVerify, hashToken };
