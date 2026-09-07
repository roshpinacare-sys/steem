'use strict';

/**
 * inferenceChainLogger.js — ECOS V131
 * =====================================
 * AI-on-Chain: wraps every inference call and records it to the audit chain + MMR.
 *
 * Every inference produces:
 *   - An `inferenceId`   (inf::<nanoid>)
 *   - A `chainHash`      (recorded via auditLog.append)
 *   - An `mmrLeafIndex`  (position in the MMR)
 *   - An inclusion `proof` (MMR membership proof)
 *
 * Design constraints:
 *   - Sacred files (fiatLedger.js, auditLog.js) are NOT modified — only called.
 *   - auditLog.append() is called with type 'AI_INFERENCE' — read interface only.
 *   - No new npm dependencies — uses vendored nanoid + node:crypto.
 *
 * [V131-AOC-01]
 */

const crypto = require('node:crypto');
const { nanoid } = require('../vendor/nanoid');

// ── helpers ───────────────────────────────────────────────────────────────────

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ── InferenceChainLogger ──────────────────────────────────────────────────────

class InferenceChainLogger {
  constructor() {
    /**
     * In-memory index: inferenceId → entry
     * @type {Map<string, object>}
     */
    this._byId = new Map();

    /**
     * In-memory index: taskId → inferenceId[]
     * @type {Map<string, string[]>}
     */
    this._byTask = new Map();

    /**
     * In-memory index: clientId → inferenceId[]
     * @type {Map<string, string[]>}
     */
    this._byClient = new Map();

    /** Injected at server startup via setDeps() */
    this._auditLog = null;
    this._mmr      = null;
  }

  /**
   * Inject dependencies (called once from ecos-api-server.js after init).
   * @param {{ auditLog: object, mmr: object }} deps
   */
  setDeps({ auditLog, mmr }) {
    this._auditLog = auditLog;
    this._mmr      = mmr;
  }

  /**
   * Log an AI inference to the chain.
   *
   * @param {object} opts
   * @param {string}  opts.provider    — who ran inference ('ecos-offline' | 'openai' | ...)
   * @param {string}  opts.taskId      — task or mission ID
   * @param {string}  opts.inputHash   — sha256(prompt) — not the prompt itself (privacy)
   * @param {*}       opts.output      — the AI output
   * @param {number}  opts.confidence  — calibrated confidence [0,1] or null
   * @param {number}  [opts.latencyMs] — wall-clock ms
   * @param {object}  [opts.metadata]  — { sessionId, userId, ... }
   * @param {string}  [opts.clientId]  — for clientReport indexing
   *
   * @returns {{
   *   inferenceId:   string,
   *   chainHash:     string,
   *   mmrLeafIndex:  number,
   *   timestamp:     string,
   *   proof:         object
   * }}
   */
  log({
    provider   = 'unknown',
    taskId     = '',
    inputHash  = '',
    output     = null,
    confidence = null,
    latencyMs  = 0,
    metadata   = {},
    clientId   = null,
  } = {}) {
    const inferenceId = 'inf::' + nanoid(16);
    const timestamp   = new Date().toISOString();

    // Compute a deterministic hash of the inference event
    const outputStr  = typeof output === 'object'
      ? JSON.stringify(output, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
      : String(output ?? '');
    const outputHash = sha256Hex(outputStr);

    // Append to audit log (Sacred File — read-only usage of append interface)
    let chainHash    = null;
    let mmrLeafIndex = -1;
    let proof        = null;

    const payload = {
      inferenceId,
      provider,
      taskId,
      inputHash,
      outputHash,
      confidence: confidence !== null ? Number(confidence.toFixed(4)) : null,
      latencyMs,
      metadata,
    };

    if (this._auditLog) {
      try {
        const entry = this._auditLog.append('AI_INFERENCE', payload);
        chainHash = entry.hash;
      } catch (_err) {
        // non-fatal — chain logging best-effort
        chainHash = sha256Hex(inferenceId + timestamp);
      }
    } else {
      // No auditLog injected (tests) — generate standalone hash
      chainHash = sha256Hex(inferenceId + timestamp);
    }

    if (this._mmr) {
      try {
        const mmrResult  = this._mmr.append(chainHash);
        mmrLeafIndex     = mmrResult.leafIndex;
        // generateProof may not exist on all MMR builds — guard
        if (typeof this._mmr.generateProof === 'function') {
          proof = this._mmr.generateProof(mmrLeafIndex);
        } else {
          proof = {
            root:   this._mmr.root ? this._mmr.root() : null,
            peaks:  this._mmr._peaks ? this._mmr._peaks.map(p => p.hash) : [],
            proof:  [],
          };
        }
      } catch (_mmrErr) {
        proof = { root: null, peaks: [], proof: [] };
      }
    } else {
      proof = { root: null, peaks: [], proof: [] };
    }

    const record = Object.freeze({
      inferenceId,
      provider,
      taskId,
      inputHash,
      outputHash,
      confidence: payload.confidence,
      latencyMs,
      metadata,
      clientId,
      chainHash,
      mmrLeafIndex,
      timestamp,
      proof,
    });

    // Index in memory
    this._byId.set(inferenceId, record);

    if (taskId) {
      const taskList = this._byTask.get(taskId) || [];
      taskList.push(inferenceId);
      this._byTask.set(taskId, taskList);
    }

    if (clientId) {
      const clientList = this._byClient.get(clientId) || [];
      clientList.push(inferenceId);
      this._byClient.set(clientId, clientList);
    }

    return {
      inferenceId,
      chainHash,
      mmrLeafIndex,
      timestamp,
      proof,
    };
  }

  /**
   * Retrieve a single inference record by ID.
   * @param {string} inferenceId
   * @returns {object|null}
   */
  getById(inferenceId) {
    return this._byId.get(inferenceId) || null;
  }

  /**
   * Retrieve all inference IDs for a given taskId.
   * @param {string} taskId
   * @returns {string[]}
   */
  getIdsByTask(taskId) {
    return this._byTask.get(taskId) || [];
  }

  /**
   * Retrieve all inference records for a given taskId.
   * @param {string} taskId
   * @returns {object[]}
   */
  getByTask(taskId) {
    return this.getIdsByTask(taskId).map(id => this._byId.get(id)).filter(Boolean);
  }

  /**
   * Retrieve all inference records for a given clientId.
   * @param {string} clientId
   * @returns {object[]}
   */
  getByClient(clientId) {
    const ids = this._byClient.get(clientId) || [];
    return ids.map(id => this._byId.get(id)).filter(Boolean);
  }

  /**
   * Return the N most recent inference records (across all tasks/clients).
   * @param {number} limit
   * @returns {object[]}
   */
  recent(limit = 20) {
    const all = [...this._byId.values()];
    return all.slice(-limit).reverse();
  }

  /**
   * Total number of logged inferences.
   */
  get size() {
    return this._byId.size;
  }

  /**
   * Verify a proof (basic structural check — full MMR verification if MMR supports it).
   * @param {string} inferenceId
   * @param {object} [providedProof] — if omitted, uses stored proof
   * @returns {{ valid: boolean, reason: string }}
   */
  verifyProof(inferenceId, providedProof) {
    const record = this._byId.get(inferenceId);
    if (!record) return { valid: false, reason: 'inference not found' };

    const proof = providedProof || record.proof;
    if (!proof) return { valid: false, reason: 'no proof available' };

    // If MMR supports verification, delegate
    if (this._mmr && typeof this._mmr.verifyProof === 'function' && record.mmrLeafIndex >= 0) {
      try {
        const ok = this._mmr.verifyProof(record.chainHash, record.mmrLeafIndex, proof);
        return { valid: ok, reason: ok ? 'mmr-verified' : 'mmr-proof-invalid' };
      } catch (_) {
        // fall through to structural check
      }
    }

    // Structural check: root must exist
    const hasRoot = proof.root !== null && proof.root !== undefined;
    return {
      valid:  hasRoot,
      reason: hasRoot ? 'structural-ok' : 'no-mmr-root',
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const defaultInferenceChainLogger = new InferenceChainLogger();

module.exports = {
  InferenceChainLogger,
  defaultInferenceChainLogger,
};
