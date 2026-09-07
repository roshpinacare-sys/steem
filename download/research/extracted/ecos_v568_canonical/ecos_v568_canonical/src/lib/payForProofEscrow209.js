/**
   * lib/payForProofEscrow209.js — ECOS V209
   * Pay-for-Proof Escrow: tasks managed via escrow — no unilateral payment release.
   * Research: Colony/Build Finance — pay-for-proof prevents ghost deliveries.
   */
  'use strict';

  const PROOF_ESCROW_STATES_209     = ['pending','proof_submitted','approved','rejected','disputed','released'];
  const PROOF_DISPUTE_WINDOW_MS_209 = 48 * 60 * 60 * 1000; // 48h dispute window
  const MAX_ESCROW_USD_209          = 1_000_000;
  const MIN_ESCROW_USD_209          = 0.01;
  const MAX_ESCROWS_209             = 10_000;

  class EscrowValidationError209 extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'EscrowValidationError209';
      this.code = code || 'ESCROW_VALIDATION_ERROR_209';
      this.statusCode = 400;
    }
  }

  const _escrows209 = new Map(); // taskId → escrow
  let _escrowCounter209 = 0;

  /**
   * createEscrow209 — lock funds for a task.
   */
  function createEscrow209(params) {
    if (!params || typeof params !== 'object') throw new EscrowValidationError209('params required');
    const { taskId, amountUsd, assigneeId, requesterId } = params;
    if (!taskId)     throw new EscrowValidationError209('taskId required');
    if (!assigneeId) throw new EscrowValidationError209('assigneeId required');
    if (!requesterId) throw new EscrowValidationError209('requesterId required');
    if (typeof amountUsd !== 'number' || amountUsd < MIN_ESCROW_USD_209 || amountUsd > MAX_ESCROW_USD_209) {
      throw new EscrowValidationError209(`amountUsd must be between ${MIN_ESCROW_USD_209} and ${MAX_ESCROW_USD_209}`);
    }
    if (_escrows209.has(taskId)) throw new EscrowValidationError209(`Escrow for ${taskId} already exists`, 'DUPLICATE_ESCROW_209');
    if (_escrows209.size >= MAX_ESCROWS_209) throw new EscrowValidationError209('Escrow store full');

    const escrow = {
      escrowId:    `escrow-${++_escrowCounter209}-${Date.now()}`,
      taskId, amountUsd: +amountUsd.toFixed(6),
      assigneeId, requesterId,
      state:       'pending',
      createdAt:   new Date().toISOString(),
      proofHash:   null, proofSubmittedAt: null,
      approvedAt:  null, releasedAt: null,
      rejectedAt:  null, rejectionReason: null,
      disputedAt:  null, disputeReason: null,
      disputeWindowExpiresAt: null,
    };
    _escrows209.set(taskId, escrow);
    return { ok: true, escrow: { ...escrow } };
  }

  /**
   * submitProof209 — assignee submits proof of work (hash of deliverable).
   */
  function submitProof209(taskId, proofHash, submittedBy) {
    if (!taskId)    throw new EscrowValidationError209('taskId required');
    if (!proofHash) throw new EscrowValidationError209('proofHash required');
    const e = _escrows209.get(taskId);
    if (!e) { const err = new EscrowValidationError209(`Escrow ${taskId} not found`, 'ESCROW_NOT_FOUND_209'); err.statusCode = 404; throw err; }
    if (e.state !== 'pending') throw new EscrowValidationError209(`Escrow is ${e.state}, expected pending`);
    if (submittedBy && submittedBy !== e.assigneeId) throw new EscrowValidationError209('Only assignee may submit proof', 'UNAUTHORIZED_PROOF_209');
    e.state               = 'proof_submitted';
    e.proofHash           = proofHash;
    e.proofSubmittedAt    = new Date().toISOString();
    e.disputeWindowExpiresAt = new Date(Date.now() + PROOF_DISPUTE_WINDOW_MS_209).toISOString();
    return { ok: true, escrow: { ...e } };
  }

  /**
   * approveProof209 — requester approves proof, triggering payment release.
   */
  function approveProof209(taskId, approvedBy) {
    if (!taskId) throw new EscrowValidationError209('taskId required');
    const e = _escrows209.get(taskId);
    if (!e) { const err = new EscrowValidationError209(`Escrow ${taskId} not found`, 'ESCROW_NOT_FOUND_209'); err.statusCode = 404; throw err; }
    if (e.state !== 'proof_submitted') throw new EscrowValidationError209(`Escrow is ${e.state}, expected proof_submitted`);
    if (approvedBy && approvedBy !== e.requesterId) throw new EscrowValidationError209('Only requester may approve', 'UNAUTHORIZED_APPROVAL_209');
    e.state      = 'approved';
    e.approvedAt = new Date().toISOString();
    e.releasedAt = new Date().toISOString();
    e.state      = 'released';
    return { ok: true, escrow: { ...e }, paymentReleased: true, amountUsd: e.amountUsd };
  }

  /**
   * rejectProof209 — requester rejects proof (payment stays locked).
   */
  function rejectProof209(taskId, reason, rejectedBy) {
    if (!taskId) throw new EscrowValidationError209('taskId required');
    const e = _escrows209.get(taskId);
    if (!e) { const err = new EscrowValidationError209(`Escrow ${taskId} not found`, 'ESCROW_NOT_FOUND_209'); err.statusCode = 404; throw err; }
    if (e.state !== 'proof_submitted') throw new EscrowValidationError209(`Escrow is ${e.state}, expected proof_submitted`);
    if (rejectedBy && rejectedBy !== e.requesterId) throw new EscrowValidationError209('Only requester may reject', 'UNAUTHORIZED_REJECTION_209');
    e.state           = 'rejected';
    e.rejectedAt      = new Date().toISOString();
    e.rejectionReason = reason || 'Proof did not meet requirements';
    return { ok: true, escrow: { ...e } };
  }

  /**
   * getEscrow209 — read escrow state for a task.
   */
  function getEscrow209(taskId) {
    if (!taskId) throw new EscrowValidationError209('taskId required');
    const e = _escrows209.get(taskId);
    if (!e) { const err = new EscrowValidationError209(`Escrow ${taskId} not found`, 'ESCROW_NOT_FOUND_209'); err.statusCode = 404; throw err; }
    return { ...e };
  }

  module.exports = {
    createEscrow209,
    submitProof209,
    approveProof209,
    rejectProof209,
    getEscrow209,
    EscrowValidationError209,
    PROOF_ESCROW_STATES_209,
    PROOF_DISPUTE_WINDOW_MS_209,
    MAX_ESCROW_USD_209,
    MIN_ESCROW_USD_209,
    _escrows209,
  };
  