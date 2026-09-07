// ============================================================
// src/lib/agentSpendApproval228.js — HITL Spend Approval (P122-B)
// V228. Manages the lifecycle of agent spend approvals:
//   1. Approval gate — record that an operator has reviewed and approved
//      a project's spend (clears hitlRequired flag).
//   2. Audit bridge — emits an approval event to _eventLog181 (same log
//      used by all other ECOS audit events).
//   3. History — stores the approval record in-process (per-project ring,
//      max 50 entries) so the approval log survives the session.
//
// This module is intentionally stateless beyond the in-process ring so it
// can be used from both the API server patch and from test suites without
// needing a live database.
//
// R1: sacred files untouched.
// R2: all new identifiers end in _228.
// R3: zero new npm deps; Node built-ins + existing ECOS modules only.
// ============================================================
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const APPROVAL_RING_MAX_228  = 50;   // max approval records kept per project
const APPROVAL_VERSION_228   = 'V228';

// ── In-process approval log (projectId → ApprovalEntry[]) ────────────────────
// External integrators can inject their own store via opts.approvalStore_228.
const _defaultApprovalStore_228 = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the approval history array for a project (creates it if absent).
 * @param {Map} store
 * @param {string} projectId
 * @returns {Array}
 */
function _getHistory_228(store, projectId) {
  const key = String(projectId);
  if (!store.has(key)) store.set(key, []);
  return store.get(key);
}

/**
 * Appends an approval entry to the per-project ring, evicting the oldest
 * entry once the ring is full.
 * @param {Map} store
 * @param {string} projectId
 * @param {object} entry
 */
function _appendHistory_228(store, projectId, entry) {
  const hist = _getHistory_228(store, projectId);
  hist.push(entry);
  if (hist.length > APPROVAL_RING_MAX_228) hist.shift();
}

/**
 * Emits an audit event to _eventLog181 (if provided). Non-fatal — any error
 * is caught and returned in the result's `auditError` field.
 * @param {Map|null} eventLog
 * @param {object} entry
 * @returns {{ ok: boolean, auditError?: string }}
 */
function _emitAudit_228(eventLog, entry) {
  if (!eventLog) return { ok: true };
  try {
    // _eventLog181 is a Map<eventId, event> — generate a simple sequential key.
    const id_228 = `audit-approval-228-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    eventLog.set(id_228, { ...entry, _logId: id_228, _logVersion: APPROVAL_VERSION_228 });
    return { ok: true };
  } catch (e228) {
    return { ok: false, auditError: e228.message };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Records a HITL approval for a project:
 *   1. Validates input.
 *   2. Clears the spend ledger entry (via spendMap_227 from agentLoop227).
 *   3. Appends an immutable approval record to the local history ring.
 *   4. Emits an audit event to _eventLog181.
 *
 * @param {object} opts
 * @param {string}  opts.projectId         — project being approved
 * @param {string}  opts.approvedBy_228     — operator identity (email / ID)
 * @param {string}  [opts.note_228]         — optional human note
 * @param {Map}     [opts.spendMap_227]     — agentLoop227 spend map (cleared on approval)
 * @param {Map}     [opts.approvalStore_228]— override in-process approval store
 * @param {Map}     [opts.eventLog_228]     — _eventLog181 reference for audit emission
 * @returns {{ ok: boolean, approvalId?: string, error?: string }}
 */
function approveProjectSpend_228(opts) {
  const o = opts || {};
  const projectId_228   = String(o.projectId || '').trim();
  const approvedBy_228  = String(o.approvedBy_228 || '').trim();
  const note_228        = o.note_228 ? String(o.note_228).slice(0, 500) : '';
  const spendMap_228    = (o.spendMap_227 instanceof Map) ? o.spendMap_227 : null;
  const store_228       = (o.approvalStore_228 instanceof Map) ? o.approvalStore_228 : _defaultApprovalStore_228;
  const eventLog_228    = (o.eventLog_228 instanceof Map) ? o.eventLog_228 : null;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!projectId_228) {
    return { ok: false, error: 'APPROVAL_228: projectId is required' };
  }
  if (!approvedBy_228) {
    return { ok: false, error: 'APPROVAL_228: approvedBy_228 is required — operator identity must be recorded' };
  }

  // ── Clear spend ledger ──────────────────────────────────────────────────────
  let previousSpendMicroCents_228 = '0';
  if (spendMap_228) {
    const pid = String(projectId_228);
    previousSpendMicroCents_228 = (spendMap_228.get(pid) || 0n).toString();
    spendMap_228.delete(pid);
  }

  // ── Build approval record ───────────────────────────────────────────────────
  const approvalId_228 = `appr-228-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const approvalTs_228 = new Date().toISOString();

  const record_228 = {
    approvalId: approvalId_228,
    projectId: projectId_228,
    approvedBy: approvedBy_228,
    note: note_228,
    previousSpendMicroCents: previousSpendMicroCents_228,
    previousSpendUsd: (Number(BigInt(previousSpendMicroCents_228)) / 10_000).toFixed(4),
    approvedAt: approvalTs_228,
    ecosVersion: APPROVAL_VERSION_228,
    event: 'HITL_APPROVED_228',
  };

  // ── Persist to history ring ─────────────────────────────────────────────────
  _appendHistory_228(store_228, projectId_228, record_228);

  // ── Emit audit event ────────────────────────────────────────────────────────
  const auditResult_228 = _emitAudit_228(eventLog_228, record_228);

  return {
    ok: true,
    approvalId: approvalId_228,
    projectId: projectId_228,
    approvedBy: approvedBy_228,
    approvedAt: approvalTs_228,
    previousSpendUsd: record_228.previousSpendUsd,
    spendCleared: spendMap_228 !== null,
    auditEmitted: auditResult_228.ok,
    auditError: auditResult_228.auditError || null,
    ecosVersion: APPROVAL_VERSION_228,
  };
}

/**
 * Returns the approval history for a project.
 * @param {string} projectId
 * @param {Map} [approvalStore_228]
 * @returns {{ ok: boolean, projectId: string, history: Array, count: number }}
 */
function getApprovalHistory_228(projectId, approvalStore_228) {
  const store = (approvalStore_228 instanceof Map) ? approvalStore_228 : _defaultApprovalStore_228;
  const pid   = String(projectId || '').trim();
  if (!pid) return { ok: false, error: 'APPROVAL_228: projectId required' };
  const history = _getHistory_228(store, pid).slice(); // defensive copy
  return {
    ok: true,
    projectId: pid,
    history,
    count: history.length,
    ecosVersion: APPROVAL_VERSION_228,
  };
}

/**
 * Clears all approval history for a project (test utility / admin use).
 * @param {string} projectId
 * @param {Map} [approvalStore_228]
 */
function clearApprovalHistory_228(projectId, approvalStore_228) {
  const store = (approvalStore_228 instanceof Map) ? approvalStore_228 : _defaultApprovalStore_228;
  store.delete(String(projectId || ''));
}

module.exports = {
  approveProjectSpend_228,
  getApprovalHistory_228,
  clearApprovalHistory_228,
  APPROVAL_RING_MAX_228,
  APPROVAL_VERSION_228,
  _defaultApprovalStore_228,
};
