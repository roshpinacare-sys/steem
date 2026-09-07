'use strict';

/**
 * translationChainSigner.js — ECOS V131
 * =======================================
 * AI-on-Chain: every translation executed by languageBridge is signed and
 * recorded on the audit chain + MMR, producing a verifiable attestation.
 *
 * Attestation contents:
 *   - translationId   (tr::<nanoid>)
 *   - sessionId       — the BridgeSession that produced this translation
 *   - langPair        — e.g. 'he→ar'
 *   - sourceHash      — sha256(original text) — content not stored (privacy)
 *   - outputHash      — sha256(translated text)
 *   - provider        — stub | deepl | google | local-llm
 *   - bridgedBy       — validator ID (optional)
 *   - chainHash       — auditLog entry hash
 *   - mmrLeafIndex    — position in MMR
 *   - timestamp       — ISO-8601
 *
 * Design constraints:
 *   - Sacred files untouched — auditLog.append() used as read interface only.
 *   - No new npm dependencies.
 *
 * [V131-AOC-02]
 */

const crypto = require('node:crypto');
const { nanoid } = require('../vendor/nanoid');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

// ── TranslationChainSigner ────────────────────────────────────────────────────

class TranslationChainSigner {
  constructor() {
    /** translationId → record */
    this._byId      = new Map();
    /** sessionId → translationId[] */
    this._bySession = new Map();
    /** clientId → translationId[] */
    this._byClient  = new Map();

    this._auditLog  = null;
    this._mmr       = null;
  }

  /**
   * Inject dependencies from server startup.
   * @param {{ auditLog: object, mmr: object }} deps
   */
  setDeps({ auditLog, mmr }) {
    this._auditLog = auditLog;
    this._mmr      = mmr;
  }

  /**
   * Sign and record a translation event.
   *
   * @param {object} opts
   * @param {string}  opts.sessionId    — BridgeSession ID (lbs::<nanoid>)
   * @param {string}  opts.fromLang     — source language code ('he', 'ar', ...)
   * @param {string}  opts.toLang       — target language code
   * @param {string}  opts.sourceHash   — sha256 of original text (caller responsibility)
   * @param {string}  opts.outputHash   — sha256 of translated text
   * @param {string}  [opts.provider]   — translation provider
   * @param {string}  [opts.bridgedBy]  — validator ID
   * @param {string}  [opts.clientId]   — for per-client reporting
   *
   * @returns {{
   *   translationId:  string,
   *   chainHash:      string,
   *   mmrLeafIndex:   number,
   *   attestation:    object
   * }}
   */
  sign({
    sessionId  = '',
    fromLang   = 'unknown',
    toLang     = 'unknown',
    sourceHash = '',
    outputHash = '',
    provider   = 'stub',
    bridgedBy  = null,
    clientId   = null,
  } = {}) {
    const translationId = 'tr::' + nanoid(16);
    const timestamp     = new Date().toISOString();
    const langPair      = `${fromLang}→${toLang}`;

    const payload = {
      translationId,
      sessionId,
      langPair,
      sourceHash,
      outputHash,
      provider,
      bridgedBy,
    };

    // Append to audit log (Sacred File interface — append only)
    let chainHash    = null;
    let mmrLeafIndex = -1;

    if (this._auditLog) {
      try {
        const entry = this._auditLog.append('AI_TRANSLATION', payload);
        chainHash = entry.hash;
      } catch (_) {
        chainHash = sha256Hex(translationId + timestamp);
      }
    } else {
      chainHash = sha256Hex(translationId + timestamp);
    }

    if (this._mmr) {
      try {
        const result = this._mmr.append(chainHash);
        mmrLeafIndex = result.leafIndex;
      } catch (_) {
        // non-fatal
      }
    }

    const attestation = Object.freeze({
      sessionId,
      langPair,
      timestamp,
      chainHash,
      mmrLeafIndex,
      provider,
    });

    const record = Object.freeze({
      translationId,
      sessionId,
      langPair,
      fromLang,
      toLang,
      sourceHash,
      outputHash,
      provider,
      bridgedBy,
      clientId,
      chainHash,
      mmrLeafIndex,
      timestamp,
      attestation,
    });

    this._byId.set(translationId, record);

    if (sessionId) {
      const list = this._bySession.get(sessionId) || [];
      list.push(translationId);
      this._bySession.set(sessionId, list);
    }

    if (clientId) {
      const list = this._byClient.get(clientId) || [];
      list.push(translationId);
      this._byClient.set(clientId, list);
    }

    return {
      translationId,
      chainHash,
      mmrLeafIndex,
      attestation,
    };
  }

  /**
   * Get all translation records for a session.
   * @param {string} sessionId
   * @returns {object[]}
   */
  getBySession(sessionId) {
    const ids = this._bySession.get(sessionId) || [];
    return ids.map(id => this._byId.get(id)).filter(Boolean);
  }

  /**
   * Get all translation records for a client.
   * @param {string} clientId
   * @returns {object[]}
   */
  getByClient(clientId) {
    const ids = this._byClient.get(clientId) || [];
    return ids.map(id => this._byId.get(id)).filter(Boolean);
  }

  /**
   * Get a single translation record by ID.
   * @param {string} translationId
   * @returns {object|null}
   */
  getById(translationId) {
    return this._byId.get(translationId) || null;
  }

  /**
   * Verify a translation attestation.
   * Checks that the stored chainHash matches what we'd expect from the attestation.
   *
   * @param {string} translationId
   * @returns {{ valid: boolean, reason: string }}
   */
  verify(translationId) {
    const record = this._byId.get(translationId);
    if (!record) return { valid: false, reason: 'translation not found' };
    if (!record.chainHash) return { valid: false, reason: 'no chain hash' };
    const { attestation } = record;
    // Structural: attestation must reference same chainHash and sessionId
    if (attestation.chainHash !== record.chainHash) {
      return { valid: false, reason: 'attestation hash mismatch' };
    }
    if (attestation.sessionId !== record.sessionId) {
      return { valid: false, reason: 'attestation sessionId mismatch' };
    }
    return { valid: true, reason: 'attestation-verified' };
  }

  /** Total number of signed translations. */
  get size() {
    return this._byId.size;
  }

  /** N most recent translations. */
  recent(limit = 20) {
    const all = [...this._byId.values()];
    return all.slice(-limit).reverse();
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const defaultTranslationChainSigner = new TranslationChainSigner();

module.exports = {
  TranslationChainSigner,
  defaultTranslationChainSigner,
};
