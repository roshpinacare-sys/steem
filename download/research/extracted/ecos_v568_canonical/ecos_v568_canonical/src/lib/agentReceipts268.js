'use strict';
/**
 * src/lib/agentReceipts268.js — AP2-Style Agent Receipts / Mandate Chain (V268)
 *
 * Builds on agentReceipts264 with full AP2 mandate chain:
 *   Intent → Plan → Action → x402 Payment → Verification → Split → Settlement
 *
 * V268 additions:
 *   - emitX402Intent268: records x402 payment events into the mandate chain
 *   - verifyChain268: cryptographic chain integrity check across all mandate steps
 *   - exportAP2Manifest268: exports mandate as AP2-compatible JSON
 *   - mobileReceipt268: compact mobile-first receipt payload
 *   - Mission linking: link related missions into execution programs
 *
 * The mandate chain is the ECOS moat — every agent action has a cryptographic
 * receipt that proves who did what, at what cost, with what split.
 *
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

// ── Mandate step types ────────────────────────────────────────────────────────
const MANDATE_STEPS_268 = Object.freeze([
  'INTENT', 'PLAN', 'ACTION', 'X402_PAYMENT', 'VERIFICATION', 'SPLIT', 'SETTLEMENT',
]);

// ── Receipt status ────────────────────────────────────────────────────────────
const RECEIPT_STATUS_268 = Object.freeze({
  PENDING:    'pending',
  IN_FLIGHT:  'in_flight',
  COMPLETE:   'complete',
  FAILED:     'failed',
  DISPUTED:   'disputed',
});

const RECEIPTS_RING_MAX_268 = 50_000;

// ── AgentReceipts268 ──────────────────────────────────────────────────────────
class AgentReceipts268 {
  constructor(opts = {}) {
    this._logger        = opts.logger        || console;
    this._auditLog      = opts.auditLog      || null;
    this._creditReserve = opts.creditReserve || null;
    this._receipts268   = new Map();   // missionId → Receipt268
    this._recentIds268  = [];          // ring buffer of missionIds (for listing)
    this._programs268   = new Map();   // programId → { missionIds[], description }
    this._stats268      = {
      total: 0, complete: 0, failed: 0, disputed: 0,
      totalSplitMicro: 0n, totalX402USDC: 0,
    };
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  // ── Receipt lifecycle ─────────────────────────────────────────────────────

  /**
   * Initialize a new mandate chain receipt for a mission.
   * @param {string} missionId
   * @param {object} meta — { userId, taskType, description, programId, agentId }
   */
  initReceipt268(missionId, meta = {}) {
    const _t0 = Date.now();
    if (this._receipts268.has(missionId))
      throw new Error(`agentReceipts268: receipt already exists for mission ${missionId}`);

    const receipt = {
      missionId,
      version:   '268',
      status:    RECEIPT_STATUS_268.PENDING,
      userId:    meta.userId    || null,
      taskType:  meta.taskType  || null,
      agentId:   meta.agentId   || null,
      programId: meta.programId || null,
      description: meta.description || '',
      chain:     [],  // ordered mandate steps
      chainHash: null,
      splitResult: null,
      x402Payments: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this._receipts268.set(missionId, receipt);
    this._recentIds268.push(missionId);
    if (this._recentIds268.length > RECEIPTS_RING_MAX_268) this._recentIds268.shift();
    this._stats268.total++;

    // Link to program
    if (meta.programId) {
      if (!this._programs268.has(meta.programId)) {
        this._programs268.set(meta.programId, { programId: meta.programId, missionIds: [], description: meta.programDescription || '' });
      }
      this._programs268.get(meta.programId).missionIds.push(missionId);
    }

    this._log268('RECEIPT_INIT', { missionId, userId: meta.userId, taskType: meta.taskType });
    this._recordLatency268(_t0);
    return { ok: true, missionId, receipt: this._publicReceipt268(receipt) };
  }

  /**
   * Emit a mandate chain step.
   * @param {string} missionId
   * @param {string} stepType — one of MANDATE_STEPS_268
   * @param {object} data
   */
  emitStep268(missionId, stepType, data = {}) {
    const receipt = this._getReceipt268(missionId);
    if (!MANDATE_STEPS_268.includes(stepType))
      throw new Error(`agentReceipts268: unknown step type "${stepType}"`);

    const prevHash = receipt.chain.length > 0
      ? receipt.chain[receipt.chain.length - 1].hash
      : null;

    const stepData = { stepType, data, ts: new Date().toISOString(), prevHash };
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(stepData))
      .digest('hex');

    const step = { ...stepData, hash, stepIndex: receipt.chain.length };
    receipt.chain.push(step);
    receipt.status = RECEIPT_STATUS_268.IN_FLIGHT;

    if (stepType === 'INTENT') receipt.status = RECEIPT_STATUS_268.IN_FLIGHT;

    this._log268('STEP_EMIT', { missionId, stepType, hash: hash.slice(0, 12) });
    return { ok: true, stepIndex: step.stepIndex, hash };
  }

  /**
   * Emit intent step (first step, AP2-style).
   */
  emitIntent268(missionId, intent) {
    return this.emitStep268(missionId, 'INTENT', { intent });
  }

  /**
   * Emit plan step.
   */
  emitPlan268(missionId, plan) {
    return this.emitStep268(missionId, 'PLAN', { plan });
  }

  /**
   * Emit action step.
   */
  emitAction268(missionId, action) {
    return this.emitStep268(missionId, 'ACTION', { action });
  }

  /**
   * Emit x402 payment event into the mandate chain.
   * Called by X402Processor268 on successful payment settlement.
   */
  emitX402Intent268(missionId, payment) {
    const receipt = this._receipts268.get(missionId);
    if (!receipt) return; // non-mission resource, ignore

    receipt.x402Payments.push({
      ...payment,
      ts: new Date().toISOString(),
    });
    this._stats268.totalX402USDC += payment.amountUSDC || 0;

    return this.emitStep268(missionId, 'X402_PAYMENT', { payment });
  }

  /**
   * Emit verification result.
   */
  emitVerification268(missionId, verification) {
    return this.emitStep268(missionId, 'VERIFICATION', { verification });
  }

  /**
   * Emit split result (40/40/20 distribution).
   */
  emitSplit268(missionId, splitResult) {
    const receipt = this._getReceipt268(missionId);
    receipt.splitResult = splitResult;
    if (splitResult?.totalMicro) {
      this._stats268.totalSplitMicro += BigInt(splitResult.totalMicro);
    }
    return this.emitStep268(missionId, 'SPLIT', { splitResult });
  }

  /**
   * Emit settlement and mark receipt complete.
   */
  emitSettlement268(missionId, settlement) {
    const receipt = this._getReceipt268(missionId);
    this.emitStep268(missionId, 'SETTLEMENT', { settlement });

    receipt.status = RECEIPT_STATUS_268.COMPLETE;
    receipt.completedAt = new Date().toISOString();
    receipt.chainHash = this._computeChainHash268(receipt);
    this._stats268.complete++;

    this._log268('RECEIPT_COMPLETE', { missionId, chainHash: receipt.chainHash?.slice(0, 12) });
    return { ok: true, missionId, chainHash: receipt.chainHash };
  }

  markFailed268(missionId, reason) {
    const receipt = this._getReceipt268(missionId);
    receipt.status = RECEIPT_STATUS_268.FAILED;
    receipt.failReason = reason;
    receipt.completedAt = new Date().toISOString();
    this._stats268.failed++;
    this._log268('RECEIPT_FAILED', { missionId, reason });
    return { ok: true, missionId, status: 'failed' };
  }

  // ── Verification ──────────────────────────────────────────────────────────

  /**
   * Verify chain integrity for a receipt.
   * Checks: each step's prevHash matches previous step's hash.
   */
  verifyChain268(missionId) {
    const receipt = this._receipts268.get(missionId);
    if (!receipt) return { valid: false, reason: 'receipt_not_found' };

    for (let i = 1; i < receipt.chain.length; i++) {
      const step = receipt.chain[i];
      const prev = receipt.chain[i - 1];
      if (step.prevHash !== prev.hash) {
        return { valid: false, reason: 'chain_broken', brokenAt: i, expectedPrev: prev.hash, gotPrev: step.prevHash };
      }
      // Recompute hash
      const recomputed = crypto.createHash('sha256').update(JSON.stringify({
        stepType: step.stepType, data: step.data, ts: step.ts, prevHash: step.prevHash,
      })).digest('hex');
      if (recomputed !== step.hash) {
        return { valid: false, reason: 'hash_mismatch', stepIndex: i };
      }
    }

    const chainHash = this._computeChainHash268(receipt);
    return {
      valid: true,
      missionId,
      steps: receipt.chain.length,
      chainHash,
      status: receipt.status,
    };
  }

  verifyReceipt268(missionId) {
    return this.verifyChain268(missionId);
  }

  // ── AP2 Export ────────────────────────────────────────────────────────────

  /**
   * Export the mandate chain as an AP2-compatible manifest.
   * Format mirrors Google AP2 (Intent/Cart/Payment mandate structure).
   */
  exportAP2Manifest268(missionId) {
    const receipt = this._receipts268.get(missionId);
    if (!receipt) throw new Error(`agentReceipts268: receipt not found for ${missionId}`);

    const steps = receipt.chain.reduce((acc, step) => {
      acc[step.stepType] = { data: step.data, ts: step.ts, hash: step.hash };
      return acc;
    }, {});

    return {
      ap2_version:  '1.0',
      ecos_version: '268',
      missionId:    receipt.missionId,
      userId:       receipt.userId,
      taskType:     receipt.taskType,
      status:       receipt.status,
      intent:       steps['INTENT']?.data?.intent || null,
      plan:         steps['PLAN']?.data?.plan || null,
      actions:      receipt.chain.filter(s => s.stepType === 'ACTION').map(s => s.data),
      payments:     receipt.x402Payments,
      verification: steps['VERIFICATION']?.data?.verification || null,
      split:        receipt.splitResult,
      settlement:   steps['SETTLEMENT']?.data?.settlement || null,
      chainHash:    receipt.chainHash,
      createdAt:    receipt.createdAt,
      completedAt:  receipt.completedAt,
      auditTrail:   receipt.chain.map(s => ({ stepType: s.stepType, hash: s.hash, ts: s.ts })),
    };
  }

  // ── Mobile compact receipt ────────────────────────────────────────────────

  mobileReceipt268(missionId) {
    const receipt = this._receipts268.get(missionId);
    if (!receipt) return null;
    return {
      id:  missionId,
      st:  receipt.status,
      tt:  receipt.taskType,
      uid: receipt.userId,
      sp:  receipt.splitResult ? {
        ex: receipt.splitResult.executorMicro,
        pl: receipt.splitResult.platformMicro,
        co: receipt.splitResult.connectorsMicro,
      } : null,
      ch:  receipt.chainHash?.slice(0, 16) || null,
      ca:  receipt.createdAt,
      n:   receipt.chain.length,
    };
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  getReceipt268(missionId) {
    const r = this._receipts268.get(missionId);
    return r ? this._publicReceipt268(r) : null;
  }

  listReceipts268(limit = 20) {
    const ids = this._recentIds268.slice(-limit).reverse();
    return ids.map(id => this._publicReceipt268(this._receipts268.get(id))).filter(Boolean);
  }

  getProgram268(programId) {
    return this._programs268.get(programId) || null;
  }

  getStats268() {
    return {
      ...this._stats268,
      totalSplitMicro: this._stats268.totalSplitMicro.toString(),
      total: this._stats268.total,
      programs: this._programs268.size,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _getReceipt268(missionId) {
    const r = this._receipts268.get(missionId);
    if (!r) throw new Error(`agentReceipts268: no receipt for mission ${missionId}`);
    return r;
  }

  _computeChainHash268(receipt) {
    const chainStr = receipt.chain.map(s => s.hash).join(':');
    return crypto.createHash('sha256').update(chainStr).digest('hex');
  }

  _publicReceipt268(receipt) {
    if (!receipt) return null;
    return {
      ...receipt,
      chain: receipt.chain.map(s => ({ stepType: s.stepType, hash: s.hash, ts: s.ts, stepIndex: s.stepIndex })),
    };
  }

  _log268(event, data) {
    const entry = { event, ...data, ts: new Date().toISOString(), _v: '268' };
    if (this._auditLog?.append) { try { this._auditLog.append(entry); } catch (_) {} }
  }

  // ── V268: Performance Telemetry ─────────────────────────────────────────────
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  // ── V268: Health Check ────────────────────────────────────────────────────
  checkReceiptsHealth268() {
    return {
      ok: true,
      module: 'agentReceipts268 mandate chain',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultAgentReceipts268 = new AgentReceipts268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  AgentReceipts268,
  defaultAgentReceipts268,
  MANDATE_STEPS_268,
  RECEIPT_STATUS_268,
};
