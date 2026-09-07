/**
 * ECOS HITL Gate
 * --------------
 * Human-in-the-Loop coordination layer. Every AI-produced output whose
 * confidence is below the auto-approve threshold (or whose policy requires
 * human review) becomes a *pending approval*. A human validator then either
 * APPROVES, MODIFIES, or REJECTS the result.
 *
 * On resolution:
 *   - the chosen decision is recorded into the audit log,
 *   - if approval was billable, the fiat ledger applies the 40/40/20 split,
 *   - the SSE broadcaster (provided by the host app) is notified so connected
 *     B2B dashboards update in real time.
 *
 * This module is intentionally framework-agnostic: it does NOT import Express
 * or Next. The HTTP routes (see apps/web/.../api/mission) wrap it.
 *
 * [FIX-V27-HITL] logger injection:
 *   constructor מקבל opts.logger — injectable pino logger.
 *   Same pattern as royaltyTrigger (FIX-V25-1):
 *     this._log = opts.logger || { warn, info, error } → console fallback.
 *   ecos-api-server.js מזריק:
 *     new HitlGate({ ledger, auditLog, broadcast, logger: logger.child({ component: 'hitl' }) })
 *   Fallback: console.warn/info/error (backward-compat — tests that don't inject logger).
 */

'use strict';

const { defaultLedger, SYSTEM_ACCOUNTS, usdToMicrocents } = require('./fiatLedger');
const { defaultAuditLog }                = require('./auditLog');
const { nanoid }                         = require('../vendor/nanoid');

const STATUS = Object.freeze({
  PENDING:  'pending',
  APPROVED: 'approved',
  MODIFIED: 'modified',
  REJECTED: 'rejected',
  EXPIRED:  'expired',
});

const DECISION = Object.freeze({
  APPROVE: 'approve',
  MODIFY:  'modify',
  REJECT:  'reject',
});

class HitlGate {
  /**
   * @param {object} [opts]
   * @param {import('./fiatLedger').FiatLedger}     [opts.ledger]
   * @param {import('./auditLog').AuditLog}         [opts.auditLog]
   * @param {(event:object)=>void}                  [opts.broadcast] - SSE fanout
   * @param {{ warn: Function, info: Function, error: Function }} [opts.logger] - pino child logger
   */
  constructor(opts = {}) {
    this.ledger      = opts.ledger    || defaultLedger;
    this.auditLog    = opts.auditLog  || defaultAuditLog;
    this.broadcast   = typeof opts.broadcast === 'function' ? opts.broadcast : null;
    // [FIX-V27-HITL] injectable logger — fallback to console for tests/CLI that don't inject
    // Pattern identical to royaltyTrigger.js (FIX-V25-1): opts.logger || { warn/info/error → console }
    this._log = opts.logger || {
      warn:  (obj, msg) => console.warn(msg  || obj),  // eslint-disable-line no-console
      info:  (obj, msg) => console.info(msg  || obj),  // eslint-disable-line no-console
      error: (obj, msg) => console.error(msg || obj),  // eslint-disable-line no-console
    };
    /** @type {Map<string, object>} approvalId → approval */
    this._approvals  = new Map();
    /** @type {Map<string, Set<string>>} missionId → Set<approvalId> */
    this._byMission  = new Map();
  }

  /**
   * Register a pending approval for an AI-produced artifact.
   *
   * @param {object} input
   * @param {string} input.missionId
   * @param {string} input.clientAccountId    Who pays when this is approved.
   * @param {string|number} input.priceUsd    Quoted price for the task.
   * @param {object} input.aiOutput           The proposed result from the AI.
   * @param {object} [input.context]          Free-form mission context.
   * @param {number} [input.confidence]       0..1 confidence from the model.
   * @returns {object} The newly created approval record.
   */
  createApproval(input) {
    const {
      missionId,
      clientAccountId,
      priceUsd,
      aiOutput,
      context = {},
      confidence = null,
    } = input || {};

    if (!missionId)        throw new TypeError('createApproval: missionId required');
    if (!clientAccountId)  throw new TypeError('createApproval: clientAccountId required');
    if (priceUsd === undefined || priceUsd === null) {
      throw new TypeError('createApproval: priceUsd required');
    }

    const approval = {
      id: 'apv_' + nanoid(16),
      missionId,
      clientAccountId,
      validatorAccountId: null,
      status: STATUS.PENDING,
      decision: null,
      priceUsd: String(priceUsd),
      aiOutput,
      finalOutput: null,
      context,
      confidence,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      ledgerEntries: [],
      auditRefs: [],
    };

    this._approvals.set(approval.id, approval);
    if (!this._byMission.has(missionId)) this._byMission.set(missionId, new Set());
    this._byMission.get(missionId).add(approval.id);

    // [FIX-V27-HITL] structured log: approval created
    this._log.info(
      { component: 'hitl', approvalId: approval.id, missionId, clientAccountId, priceUsd: approval.priceUsd, confidence },
      'approval created',
    );

    // Audit-log creation
    const auditEntry = this.auditLog.append('APPROVAL_CREATED', {
      approvalId: approval.id,
      missionId,
      clientAccountId,
      priceUsd: approval.priceUsd,
      confidence,
      aiOutputDigest: this._digestOf(aiOutput),
    });
    approval.auditRefs.push(auditEntry.hash);

    this._emit({
      type: 'approval.created',
      approvalId: approval.id,
      missionId,
      priceUsd: approval.priceUsd,
    });

    return approval;
  }

  /**
   * Resolve a pending approval.
   *
   * Two modes, selected by the caller:
   *
   * A) HITL (human validator) — normal path:
   *    Pass a real `validatorAccountId`. The ledger performs the 40/40/20
   *    distribution; the validator is credited atomically.
   *
   * B) AUTO_FLOW (no human validator) — pass `autoFlow: true`:
   *    [FIX-V13-BUG-B] `validatorAccountId` is ignored / not required.
   *    The ledger performs the 40/60 distribution (platform / insurance),
   *    with 0 going to any validator account. Previously the server passed
   *    SYSTEM_ACCOUNTS.PLATFORM as validatorAccountId, causing PLATFORM to
   *    receive 80% of gross (its own 40% + the spurious "validator" 40%).
   *    That inflated the PLATFORM balance and produced a misleading audit label.
   *
   * @param {string} approvalId
   * @param {object} resolution
   * @param {boolean} [resolution.autoFlow]           True → AUTO_FLOW path (no validator leg).
   * @param {string}  [resolution.validatorAccountId] Required when autoFlow is false/absent.
   * @param {'approve'|'modify'|'reject'} resolution.decision
   * @param {object}  [resolution.finalOutput]        Required if decision === 'modify'.
   * @param {string}  [resolution.note]               Free-form reviewer note.
   * @returns {object} The updated approval (with ledger receipt if billable).
   */
  resolveApproval(approvalId, resolution) {
    const approval = this._approvals.get(approvalId);
    if (!approval) {
      const err = new Error('resolveApproval: approval not found');
      err.code = 'NOT_FOUND';
      // [FIX-V27-HITL] log missing approval as warn (could be stale request, not necessarily a bug)
      this._log.warn({ component: 'hitl', approvalId }, 'resolveApproval: approval not found');
      throw err;
    }
    if (approval.status !== STATUS.PENDING) {
      const err = new Error(`resolveApproval: approval already ${approval.status}`);
      err.code = 'ALREADY_RESOLVED';
      // [FIX-V27-HITL] log double-resolve as warn
      this._log.warn({ component: 'hitl', approvalId, status: approval.status }, 'resolveApproval: already resolved');
      throw err;
    }

    const { autoFlow = false, validatorAccountId, decision, finalOutput, note } = resolution || {};

    // [FIX-V13-BUG-B] AUTO_FLOW has no human validator — skip validatorAccountId check.
    if (!autoFlow && !validatorAccountId) {
      throw new TypeError('resolveApproval: validatorAccountId required (or pass autoFlow:true)');
    }
    if (!Object.values(DECISION).includes(decision)) {
      throw new TypeError(
        `resolveApproval: decision must be one of ${Object.values(DECISION).join(', ')}`,
      );
    }
    if (decision === DECISION.MODIFY && !finalOutput) {
      throw new TypeError('resolveApproval: finalOutput required when decision is "modify"');
    }

    // For AUTO_FLOW, record null so the audit entry is unambiguous.
    approval.validatorAccountId = autoFlow ? null : validatorAccountId;
    approval.decision           = decision;
    approval.resolvedAt         = new Date().toISOString();

    if (decision === DECISION.APPROVE) {
      approval.status      = STATUS.APPROVED;
      approval.finalOutput = approval.aiOutput;
    } else if (decision === DECISION.MODIFY) {
      approval.status      = STATUS.MODIFIED;
      approval.finalOutput = finalOutput;
    } else {
      approval.status      = STATUS.REJECTED;
      approval.finalOutput = null;
    }

    let receipt = null;

    // Only billable outcomes trigger the fiat distribution.
    if (decision === DECISION.APPROVE || decision === DECISION.MODIFY) {
      if (autoFlow) {
        // [FIX-V13-BUG-B] AUTO_FLOW: 40% platform / 60% insurance — no validator leg.
        receipt = this.ledger.distributeAutoFlowPayment({
          clientAccountId: approval.clientAccountId,
          grossAmountUsd:  approval.priceUsd,
          meta: {
            approvalId: approval.id,
            missionId:  approval.missionId,
            decision,
            flow: 'AUTO_FLOW',
          },
        });
      } else {
        // HITL: canonical 40/40/20 split — validator is credited.
        receipt = this.ledger.distributeTaskPayment({
          clientAccountId:   approval.clientAccountId,
          validatorAccountId,
          grossAmountUsd:    approval.priceUsd,
          meta: {
            approvalId: approval.id,
            missionId:  approval.missionId,
            decision,
          },
        });
      }
      approval.ledgerEntries = receipt.entries.map(e => e.id);
    }

    // [FIX-V27-HITL] structured log: approval resolved
    this._log.info(
      {
        component: 'hitl',
        approvalId: approval.id,
        missionId: approval.missionId,
        decision,
        autoFlow,
        validatorAccountId: approval.validatorAccountId,
        billed: !!receipt,
      },
      'approval resolved',
    );

    // auditLabel differentiates AUTO_FLOW from HITL for traceability.
    const auditLabel = autoFlow ? 'APPROVAL_AUTO_RESOLVED' : 'APPROVAL_RESOLVED';
    const auditEntry = this.auditLog.append(auditLabel, {
      approvalId: approval.id,
      missionId: approval.missionId,
      decision,
      validatorAccountId: approval.validatorAccountId, // null for AUTO_FLOW
      autoFlow,
      note: note || null,
      finalOutputDigest: this._digestOf(approval.finalOutput),
      ledgerEntries: approval.ledgerEntries,
      billed: !!receipt,
    });
    approval.auditRefs.push(auditEntry.hash);

    this._emit({
      type: 'approval.resolved',
      approvalId: approval.id,
      missionId: approval.missionId,
      decision,
      validatorAccountId: approval.validatorAccountId,
      autoFlow,
      billed: !!receipt,
    });

    return { approval, receipt, audit: auditEntry };
  }

  // ---- Persistence helpers (public — replaces direct _approvals access) ----

  /**
   * [FIX-V10-1] Restore approval state from persisted log on startup.
   * Called by ecos-api-server.js during the NDJSON replay phase.
   * Replaces the V9 anti-pattern of writing directly to hitlGate._approvals.
   *
   * @param {'created'|'resolved'} event
   * @param {object} data  Raw parsed NDJSON line
   */
  restoreFromLog(event, data) {
    if (event === 'created') {
      const a = {
        id: data.id,
        missionId: data.missionId,
        clientAccountId: data.clientAccountId,
        validatorAccountId: null,
        status: 'pending',
        decision: null,
        priceUsd: data.priceUsd,
        aiOutput: data.aiOutput,
        finalOutput: null,
        context: data.context || {},
        confidence: data.confidence ?? null,
        createdAt: data.createdAt,
        resolvedAt: null,
        ledgerEntries: [],
        auditRefs: [],
      };
      this._approvals.set(a.id, a);
      if (!this._byMission.has(a.missionId)) {
        this._byMission.set(a.missionId, new Set());
      }
      this._byMission.get(a.missionId).add(a.id);
      // [FIX-V27-HITL] log restore
      this._log.info({ component: 'hitl', approvalId: a.id, missionId: a.missionId }, 'restored approval from log (created)');
      return a;
    }

    if (event === 'resolved') {
      const a = this._approvals.get(data.id);
      if (a) {
        a.status              = data.status;
        a.decision            = data.decision;
        a.validatorAccountId  = data.validatorAccountId;
        a.resolvedAt          = data.resolvedAt;
        a.finalOutput         = data.finalOutput ?? null;
        // [FIX-V27-HITL] log restore
        this._log.info({ component: 'hitl', approvalId: a.id, status: a.status, decision: a.decision }, 'restored approval from log (resolved)');
      } else {
        this._log.warn({ component: 'hitl', approvalId: data.id }, 'restoreFromLog: resolved event references unknown approval');
      }
      return a || null;
    }

    return null;
  }

  // ---- Query helpers ----
  getApproval(approvalId) {
    return this._approvals.get(approvalId) || null;
  }

  /**
   * List all approvals, optionally filtered by status.
   * This is the public API used by the server's GET /api/v1/approvals route.
   * It replaces the previous duck-typing access to `hitlGate._approvals`.
   *
   * @param {object}  [opts]
   * @param {string}  [opts.status]  'pending' | 'approved' | 'modified' | 'rejected' | 'all'
   * @param {number}  [opts.limit]   Max records to return (default: 200)
   * @returns {object[]} Approval records sorted most-recent first.
   */
  listApprovals({ status = 'pending', limit = 200 } = {}) {
    const out = [];
    for (const a of this._approvals.values()) {
      if (status !== 'all' && a.status !== status) continue;
      out.push(a);
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return limit > 0 ? out.slice(0, limit) : out;
  }

  listApprovalsForMission(missionId, { status } = {}) {
    const ids = this._byMission.get(missionId);
    if (!ids) return [];
    const out = [];
    for (const id of ids) {
      const a = this._approvals.get(id);
      if (!a) continue;
      if (status && status !== 'all' && a.status !== status) continue;
      out.push(a);
    }
    // Most-recent first.
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return out;
  }

  // ---- Internals ----
  _digestOf(obj) {
    if (obj === undefined || obj === null) return null;
    const { sha256Hex, canonicalize } = require('./auditLog');
    try {
      return sha256Hex(canonicalize(obj));
    } catch {
      return sha256Hex(String(obj));
    }
  }

  _emit(event) {
    if (this.broadcast) {
      try { this.broadcast(event); }
      catch (e) { /* never let a broken SSE pipe crash the gate */ }
    }
  }
}

const defaultHitlGate = new HitlGate();

module.exports = {
  HitlGate,
  defaultHitlGate,
  STATUS,
  DECISION,
};
