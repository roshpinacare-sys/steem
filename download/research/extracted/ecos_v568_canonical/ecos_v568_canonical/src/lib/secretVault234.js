'use strict';
/**
 * src/lib/secretVault234.js — ECOS V234 (Phase P128)
 *
 * Encrypted per-user / per-connector secret + OAuth token store. This is the
 * critical blocker from the Agent-Platform Gap Analysis: without a safe vault
 * you cannot connect real third-party apps. Pure + dependency-free (R6 — only
 * Node's `crypto`); version-suffixed (…234, BUG-L safe).
 *
 * Security properties:
 *  - AES-256-GCM authenticated encryption; per-record random IV; auth tag stored.
 *  - Master key from env `ECOS_VAULT_KEY` (hex/base64/utf8 → 32 bytes via SHA-256).
 *    A dev fallback key is used only when NODE_ENV!=='production' (flagged insecure).
 *  - Secret VALUES are never returned by list/status, never written to audit, and
 *    never serialized into metadata. Only `getSecret` (server-internal) decrypts.
 *  - Tamper of ciphertext/tag/iv → decryption throws (GCM integrity).
 *
 * Audit: an injectable `audit(event)` callback receives redacted events
 * `{ action, userId, connectorId, at }` — NEVER the secret payload.
 *
 * @version 234.0.0
 */

const crypto = require('crypto');

const ALG_234 = 'aes-256-gcm';
const IV_LEN_234 = 12;          // 96-bit IV recommended for GCM
const KEY_ENV_234 = 'ECOS_VAULT_KEY';

class VaultError234 extends Error {
  constructor(msg, code) { super(msg); this.name = 'VaultError234'; this.code = code || 'VAULT_ERROR'; this.statusCode = 400; }
}

// ── key derivation ─────────────────────────────────────────────────────────
function _deriveKey234(rawKey) {
  // Normalize any provided secret to a 32-byte key via SHA-256.
  return crypto.createHash('sha256').update(String(rawKey), 'utf8').digest();
}
function _resolveMasterKey234(explicitKey) {
  if (explicitKey) return { key: _deriveKey234(explicitKey), insecure: false };
  const env = process.env[KEY_ENV_234];
  if (env) return { key: _deriveKey234(env), insecure: false };
  if (process.env.NODE_ENV === 'production') {
    throw new VaultError234(`missing ${KEY_ENV_234} in production`, 'NO_KEY');
  }
  // dev-only deterministic fallback (clearly insecure)
  return { key: _deriveKey234('ecos-dev-insecure-vault-key-234'), insecure: true };
}

function _recordKey234(userId, connectorId) {
  if (!userId || !connectorId) throw new VaultError234('userId and connectorId are required', 'BAD_ID');
  return String(userId) + '\u0000' + String(connectorId);
}

// ── factory ──────────────────────────────────────────────────────────────—
/**
 * Create a vault instance.
 * @param {object} [opts]
 * @param {string} [opts.masterKey]   override master key (else env / dev fallback)
 * @param {(e:object)=>void} [opts.audit]  redacted audit sink
 * @param {(args:object)=>Promise<object>} [opts.oauthExchange] token-exchange fn
 *        receiving { userId, connectorId, code, ...beginMeta } → { accessToken, refreshToken?, expiresIn?, scope? }
 * @param {()=>number} [opts.now]     clock (ms) for tests
 */
function createSecretVault234(opts = {}) {
  const { key: MASTER_KEY, insecure } = _resolveMasterKey234(opts.masterKey);
  const audit = typeof opts.audit === 'function' ? opts.audit : () => {};
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const oauthExchange = typeof opts.oauthExchange === 'function' ? opts.oauthExchange : null;

  const store = new Map();        // recordKey → { iv, tag, ct, meta }
  const pendingOAuth = new Map(); // state → { userId, connectorId, createdAt, beginMeta }

  function _emit(action, userId, connectorId, extra) {
    try { audit(Object.assign({ action, userId, connectorId, at: new Date(now()).toISOString() }, extra || {})); } catch (_) {}
  }

  function _encrypt234(plainObj) {
    const iv = crypto.randomBytes(IV_LEN_234);
    const cipher = crypto.createCipheriv(ALG_234, MASTER_KEY, iv);
    const pt = Buffer.from(JSON.stringify(plainObj), 'utf8');
    const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') };
  }
  function _decrypt234(rec) {
    const decipher = crypto.createDecipheriv(ALG_234, MASTER_KEY, Buffer.from(rec.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(rec.tag, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(rec.ct, 'base64')), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  }

  // ── core API ──────────────────────────────────────────────────────────
  function putSecret(userId, connectorId, payload) {
    if (payload == null || typeof payload !== 'object') throw new VaultError234('payload must be an object', 'BAD_PAYLOAD');
    const rk = _recordKey234(userId, connectorId);
    const enc = _encrypt234(payload);
    const existing = store.get(rk);
    const meta = {
      userId: String(userId), connectorId: String(connectorId),
      createdAt: existing ? existing.meta.createdAt : new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
      keys: Object.keys(payload),     // names only, never values
      kind: payload.refreshToken || payload.accessToken ? 'oauth' : 'secret',
    };
    store.set(rk, { iv: enc.iv, tag: enc.tag, ct: enc.ct, meta });
    _emit('put', userId, connectorId, { kind: meta.kind, keys: meta.keys });
    return Object.assign({}, meta);  // redacted (no values)
  }

  function getSecret(userId, connectorId) {            // server-internal use only
    const rk = _recordKey234(userId, connectorId);
    const rec = store.get(rk);
    if (!rec) { _emit('get_miss', userId, connectorId); return null; }
    _emit('get', userId, connectorId);
    return _decrypt234(rec);
  }

  function hasSecret(userId, connectorId) { return store.has(_recordKey234(userId, connectorId)); }

  function statusSecret(userId, connectorId) {
    const rec = store.get(_recordKey234(userId, connectorId));
    return rec ? Object.assign({ exists: true }, rec.meta) : { exists: false };
  }

  function deleteSecret(userId, connectorId) {
    const ok = store.delete(_recordKey234(userId, connectorId));
    _emit('delete', userId, connectorId, { existed: ok });
    return { deleted: ok };
  }

  function listSecrets(userId) {                       // metadata only, no values
    const out = [];
    for (const rec of store.values()) if (rec.meta.userId === String(userId)) out.push(Object.assign({}, rec.meta));
    _emit('list', userId, null, { count: out.length });
    return out;
  }

  // ── OAuth lifecycle ─────────────────────────────────────────────────────
  function beginOAuth(userId, connectorId, beginMeta) {
    if (!userId || !connectorId) throw new VaultError234('userId and connectorId required', 'BAD_ID');
    const state = crypto.randomBytes(16).toString('hex');
    pendingOAuth.set(state, { userId: String(userId), connectorId: String(connectorId), createdAt: now(), beginMeta: beginMeta || {} });
    _emit('oauth_begin', userId, connectorId, { state });
    const authUrl = (beginMeta && beginMeta.authorizeUrl)
      ? `${beginMeta.authorizeUrl}${beginMeta.authorizeUrl.includes('?') ? '&' : '?'}state=${state}`
      : null;
    return { state, authUrl };
  }

  async function completeOAuth(userId, connectorId, params) {
    const { code, state } = params || {};
    if (!state || !pendingOAuth.has(state)) throw new VaultError234('unknown or expired oauth state', 'BAD_STATE');
    const pend = pendingOAuth.get(state);
    if (pend.userId !== String(userId) || pend.connectorId !== String(connectorId)) {
      throw new VaultError234('oauth state does not match user/connector', 'STATE_MISMATCH');
    }
    pendingOAuth.delete(state);
    if (!oauthExchange) throw new VaultError234('no oauthExchange configured', 'NO_EXCHANGE');
    const tokens = await oauthExchange(Object.assign({ userId, connectorId, code }, pend.beginMeta));
    if (!tokens || !tokens.accessToken) throw new VaultError234('exchange returned no accessToken', 'NO_TOKEN');
    const payload = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || null,
      scope: tokens.scope || null,
      expiresAt: tokens.expiresIn ? new Date(now() + tokens.expiresIn * 1000).toISOString() : null,
    };
    const meta = putSecret(userId, connectorId, payload);
    _emit('oauth_complete', userId, connectorId, { scope: payload.scope });
    return meta;  // redacted
  }

  async function refreshOAuth(userId, connectorId) {
    const cur = getSecret(userId, connectorId);
    if (!cur || !cur.refreshToken) throw new VaultError234('no refreshToken stored', 'NO_REFRESH');
    if (!oauthExchange) throw new VaultError234('no oauthExchange configured', 'NO_EXCHANGE');
    const tokens = await oauthExchange({ userId, connectorId, refreshToken: cur.refreshToken, grant: 'refresh' });
    if (!tokens || !tokens.accessToken) throw new VaultError234('refresh returned no accessToken', 'NO_TOKEN');
    const payload = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || cur.refreshToken,
      scope: tokens.scope || cur.scope || null,
      expiresAt: tokens.expiresIn ? new Date(now() + tokens.expiresIn * 1000).toISOString() : null,
    };
    const meta = putSecret(userId, connectorId, payload);
    _emit('oauth_refresh', userId, connectorId, { scope: payload.scope });
    return meta;
  }

  function stats() { return { records: store.size, pendingOAuth: pendingOAuth.size, insecureKey: insecure }; }

  return {
    putSecret, getSecret, hasSecret, statusSecret, deleteSecret, listSecrets,
    beginOAuth, completeOAuth, refreshOAuth, stats,
    _insecureKey: insecure,
  };
}

module.exports = { createSecretVault234, VaultError234, ALG_234, KEY_ENV_234 };
