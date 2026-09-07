'use strict';
/**
 * @ecos/client — Developer SDK for the ECOS API [V103-P3]
 *
 * A lightweight, zero-dependency typed client for the ECOS
 * (Economic Cognitive Operating System) protocol.
 *
 * Usage:
 *   const { EcosClient } = require('@ecos/client');
 *   const ecos = new EcosClient({ baseUrl: 'http://localhost:3000' });
 *
 *   const result = await ecos.submitTask({ ... });
 */

class EcosClient {
  /**
   * @param {object} opts
   * @param {string}  opts.baseUrl           - ECOS server base URL (e.g. 'http://localhost:3000')
   * @param {string}  [opts.depositApiKey]   - Bearer token for /deposit endpoint
   * @param {string}  [opts.validatorJwt]    - JWT for validator-protected endpoints
   * @param {number}  [opts.timeoutMs=30000] - Per-request timeout in milliseconds
   */
  constructor({ baseUrl, depositApiKey, validatorJwt, timeoutMs = 30000 } = {}) {
    if (!baseUrl) throw new Error('[EcosClient] baseUrl is required');
    this.baseUrl      = baseUrl.replace(/\/$/, '');
    this.depositApiKey = depositApiKey || null;
    this.validatorJwt  = validatorJwt  || null;
    this.timeoutMs     = timeoutMs;
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  async _fetch(method, path, body, authType) {
    const url     = `${this.baseUrl}${path}`;
    const headers = { 'Content-Type': 'application/json' };

    if (authType === 'deposit' && this.depositApiKey) {
      headers['Authorization'] = `Bearer ${this.depositApiKey}`;
    }
    if (authType === 'validator' && this.validatorJwt) {
      headers['Authorization'] = `Bearer ${this.validatorJwt}`;
    }

    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body:   body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { _raw: text }; }

    if (!res.ok) {
      const err = new Error(
        `[EcosClient] ${method} ${path} → ${res.status}: ${data?.error || text}`
      );
      err.status = res.status;
      err.body   = data;
      throw err;
    }
    return data;
  }

  // ─── Core Protocol ───────────────────────────────────────────────────────

  /**
   * Submit a task through the ECOS confidence gate.
   * @param {object} task
   * @param {string}  task.clientAccountId
   * @param {string}  task.priceUsd          - e.g. "1.00"
   * @param {number}  task.rawConfidence      - [0, 1]
   * @param {object}  task.aiOutput
   * @param {string}  [task.taskType]         - default: "default"
   * @param {string}  [task.idempotencyKey]
   * @returns {Promise<{verdict: string, approvalId: string, missionId: string}>}
   */
  submitTask(task) {
    return this._fetch('POST', '/api/v1/task', task);
  }

  /**
   * Natural language chat — runs inference internally.
   * @param {object} params
   * @param {string}  params.text
   * @param {string}  params.clientAccountId
   * @param {string}  params.priceUsd
   * @returns {Promise<{verdict: string, approvalId: string, aiResponse: string, confidence: number|null}>}
   */
  chat(params) {
    return this._fetch('POST', '/api/v1/chat', params);
  }

  // ─── Approvals ───────────────────────────────────────────────────────────

  /**
   * List approvals.
   * @param {{ status?: 'pending'|'approved'|'all', limit?: number }} [opts]
   * @returns {Promise<{approvals: object[], count: number}>}
   */
  listApprovals({ status = 'pending', limit = 50 } = {}) {
    return this._fetch(
      'GET',
      `/api/v1/approvals?status=${encodeURIComponent(status)}&limit=${limit}`,
      undefined,
      'validator'
    );
  }

  /**
   * Resolve an approval (validator decision).
   * @param {string} approvalId
   * @param {{ validatorAccountId: string, decision: 'approve'|'reject', note?: string }} resolution
   * @returns {Promise<{approval: object, receipt: object}>}
   */
  resolveApproval(approvalId, resolution) {
    return this._fetch(
      'POST',
      `/api/v1/approvals/${encodeURIComponent(approvalId)}/resolve`,
      resolution,
      'validator'
    );
  }

  /**
   * Bulk resolve up to 50 approvals in a single request.
   * @param {Array<{id: string, decision: 'approve'|'reject', validatorAccountId: string, note?: string}>} items
   * @returns {Promise<object>}
   */
  bulkResolve(items) {
    return this._fetch('POST', '/api/v1/approvals/bulk-resolve', { items }, 'validator');
  }

  // ─── Missions ────────────────────────────────────────────────────────────

  /**
   * Get full mission detail with audit trail.
   * @param {string} missionId
   * @returns {Promise<object>}
   */
  getMission(missionId) {
    return this._fetch('GET', `/api/v1/mission/${encodeURIComponent(missionId)}`);
  }

  /**
   * Mission Status Dashboard — aggregated view of all missions. [V103]
   * @returns {Promise<{totalMissions: number, pending: number, approved: number, rejected: number, blocked: number, autoFlow: number, hitlQueue: number, avgConfidence: number|null, chainIntact: boolean, topClients: object[], generatedAt: string, ecosVersion: string}>}
   */
  getMissionDashboard() {
    return this._fetch('GET', '/api/v1/missions/dashboard');
  }

  /**
   * Full-text mission search.
   * @param {{ q?: string, status?: string, clientId?: string, limit?: number, cursor?: string }} [opts]
   * @returns {Promise<{missions: object[], count: number, hasMore: boolean, cursor: string|null}>}
   */
  searchMissions(opts = {}) {
    const params = new URLSearchParams();
    if (opts.q)        params.set('q',        opts.q);
    if (opts.status)   params.set('status',   opts.status);
    if (opts.clientId) params.set('clientId', opts.clientId);
    if (opts.limit)    params.set('limit',    String(opts.limit));
    if (opts.cursor)   params.set('cursor',   opts.cursor);
    return this._fetch('GET', `/api/v1/missions/search?${params.toString()}`);
  }

  // ─── Finance ─────────────────────────────────────────────────────────────

  /**
   * Fund a client account (requires depositApiKey).
   * @param {{ clientAccountId: string, amountUsd: string, idempotencyKey: string }} params
   * @returns {Promise<{credited: string, balanceUsd: string}>}
   */
  deposit(params) {
    return this._fetch('POST', '/api/v1/deposit', params, 'deposit');
  }

  /**
   * Withdraw validator earnings to Stripe.
   * @param {{ validatorAccountId: string, amountUsd: string }} params
   * @returns {Promise<object>}
   */
  payout(params) {
    return this._fetch('POST', '/api/v1/payout', params, 'validator');
  }

  /**
   * Get account balance.
   * @param {string} accountId
   * @returns {Promise<{id: string, balance_micro: string, balance_usd: string}>}
   */
  getBalance(accountId) {
    return this._fetch('GET', `/api/v1/account?id=${encodeURIComponent(accountId)}`);
  }

  /**
   * Get validator earnings.
   * @param {string} validatorId
   * @returns {Promise<object>}
   */
  getEarnings(validatorId) {
    return this._fetch(
      'GET',
      `/api/v1/validator/${encodeURIComponent(validatorId)}/earnings`,
      undefined,
      'validator'
    );
  }

  // ─── Trust Infrastructure ────────────────────────────────────────────────

  /**
   * Get the current audit chain proof.
   * @returns {Promise<{intact: boolean, chainLength: number, headHash: string|null, tailHash: string|null, recentHashes: object[], verifiedAt: string, ecosVersion: string}>}
   */
  getChainProof() {
    return this._fetch('GET', '/api/v1/chain/proof');
  }

  /**
   * Get the persistent agent identity.
   * @returns {Promise<{agentId: string, source: string, ecosVersion: string}>}
   */
  getAgentIdentity() {
    return this._fetch('GET', '/api/v1/agent/identity');
  }

  // ─── Calibrator ──────────────────────────────────────────────────────────

  /**
   * Get calibrator status.
   * @returns {Promise<{isReady: boolean, fitted: boolean, sampleCount: number, samplesNeeded: number}>}
   */
  getCalibratorStatus() {
    return this._fetch('GET', '/api/v1/calibrator');
  }

  // ─── Replay Protection (Nonce) — V125/V126 ─────────────────────────────

  /**
   * Get the current nonce for a (scope, accountId) pair.
   * Use before calling resolveApproval() or deposit() with nonce enforcement.
   * [V126-P17-03]
   * @param {string} scope     — e.g. 'approval', 'deposit'
   * @param {string} accountId — the entity being tracked
   * @returns {Promise<{scope: string, accountId: string, currentNonce: number, nextExpected: number, ecosVersion: string}>}
   */
  getNonce(scope, accountId) {
    return this._fetch(
      'GET',
      `/api/v1/nonce/${encodeURIComponent(scope)}/${encodeURIComponent(accountId)}`
    );
  }

  /**
   * Resolve an approval with optional nonce for replay protection. [V125+]
   * @param {string} approvalId
   * @param {{ validatorAccountId: string, decision: string, finalOutput?: string, note?: string, nonce?: number }} params
   * @returns {Promise<object>}
   */
  resolveApproval(approvalId, params) {
    return this._fetch(
      'POST',
      `/api/v1/approvals/${encodeURIComponent(approvalId)}/resolve`,
      params,
      'validator'
    );
  }

  // ─── Chain Ops — V125/V126 ───────────────────────────────────────────────

  /**
   * Trigger manual MMR compaction (requires validatorJwt). [V125-P16-03]
   * @param {{ threshold?: number, archiveCount?: number }} [opts]
   * @returns {Promise<object>}
   */
  compactMMR(opts = {}) {
    return this._fetch('POST', '/api/v1/chain/mmr/compact', opts, 'validator');
  }

  /**
   * Backfill pre-V123 audit entries into MMR (requires validatorJwt). [V125-P16-04]
   * @param {{ batchSize?: number, maxBatches?: number }} [opts]
   * @returns {Promise<{processed: number, skipped: number, errors: number, done: boolean, ecosVersion: string}>}
   */
  backfillAuditEntries(opts = {}) {
    return this._fetch('POST', '/api/v1/chain/audit/backfill', opts, 'validator');
  }

  /**
   * Get checkpoint scheduler status. [V125-P16-05]
   * @returns {Promise<{enabled: boolean, interval: number, lastLeafCount: number, ecosVersion: string}>}
   */
  getCheckpointSchedule() {
    return this._fetch('GET', '/api/v1/chain/checkpoint/schedule');
  }

  /**
   * Update checkpoint scheduler config (requires validatorJwt). [V125-P16-05]
   * @param {{ interval?: number, enabled?: boolean }} params
   * @returns {Promise<object>}
   */
  updateCheckpointSchedule(params) {
    return this._fetch('PUT', '/api/v1/chain/checkpoint/schedule', params, 'validator');
  }

  /**
   * Get recent MMR compaction events. [V126-P17-05]
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<object>}
   */
  getCompactionLog(opts = {}) {
    const params = new URLSearchParams();
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return this._fetch('GET', `/api/v1/chain/mmr/compaction/log${qs ? '?' + qs : ''}`);
  }

  // ─── Health ──────────────────────────────────────────────────────────────

  /**
   * Health check.
   * @returns {Promise<{status: string, version: string, uptime: number, db: string}>}
   */
  healthCheck() {
    return this._fetch('GET', '/api/v1/health');
  }
}

module.exports = { EcosClient };
