/**
   * lib/multiSigTreasury209.js — ECOS V209
   * Multi-Signature Treasury: M-of-N approval required for large treasury withdrawals.
   * Research: Celsius/Build Finance — unilateral treasury access = catastrophic risk.
   */
  'use strict';

  const MULTISIG_QUORUM_209       = 3;          // M: minimum approvers needed
  const MULTISIG_SIGNERS_MAX_209  = 11;         // N: max signers in a multisig config
  const MULTISIG_HIGH_VALUE_209   = 10_000;     // USD threshold for multisig enforcement
  const MULTISIG_WINDOW_MS_209    = 48 * 60 * 60 * 1000; // 48h signing window
  const MAX_MULTISIG_REQUESTS_209 = 1_000;

  class MultiSigError209 extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'MultiSigError209';
      this.code = code || 'MULTISIG_ERROR_209';
      this.statusCode = 400;
    }
  }

  // In-memory treasury withdrawal request store
  const _withdrawalRequests209 = new Map();
  let _withdrawalCounter209 = 0;

  /**
   * createWithdrawalRequest209 — initiate a treasury withdrawal requiring M-of-N signatures.
   */
  function createWithdrawalRequest209(params) {
    if (!params || typeof params !== 'object') throw new MultiSigError209('params required');
    const { requestId, amountUsd, destination, requestedBy, signers, requiredSignatures } = params;

    if (!requestId)    throw new MultiSigError209('requestId required');
    if (!destination)  throw new MultiSigError209('destination required');
    if (!requestedBy)  throw new MultiSigError209('requestedBy required');
    if (typeof amountUsd !== 'number' || amountUsd <= 0) throw new MultiSigError209('amountUsd must be positive');
    if (_withdrawalRequests209.has(requestId)) throw new MultiSigError209(`Request ${requestId} already exists`, 'DUPLICATE_REQUEST_209');
    if (_withdrawalRequests209.size >= MAX_MULTISIG_REQUESTS_209) throw new MultiSigError209('Request store full');

    if (!Array.isArray(signers) || signers.length < 2 || signers.length > MULTISIG_SIGNERS_MAX_209) {
      throw new MultiSigError209(`signers must be array of 2-${MULTISIG_SIGNERS_MAX_209} member IDs`);
    }
    if (new Set(signers).size !== signers.length) throw new MultiSigError209('Duplicate signer IDs not allowed');

    const required = typeof requiredSignatures === 'number'
      ? requiredSignatures
      : Math.max(MULTISIG_QUORUM_209, Math.ceil(signers.length * 0.6));

    if (required > signers.length) throw new MultiSigError209(`requiredSignatures (${required}) cannot exceed total signers (${signers.length})`);

    const requiresMultisig = amountUsd >= MULTISIG_HIGH_VALUE_209;

    const req = {
      requestId,
      amountUsd: +amountUsd.toFixed(6),
      destination, requestedBy,
      signers: [...signers],
      requiredSignatures: required,
      requiresMultisig,
      status: 'pending',    // pending | approved | rejected | executed | expired
      signatures: [],
      rejections: [],
      createdAt:  new Date().toISOString(),
      expiresAt:  new Date(Date.now() + MULTISIG_WINDOW_MS_209).toISOString(),
      executedAt: null, rejectedAt: null,
    };
    _withdrawalRequests209.set(requestId, req);
    return { ok: true, request: { ...req } };
  }

  /**
   * signWithdrawal209 — a signer approves or rejects a withdrawal request.
   */
  function signWithdrawal209(requestId, signerId, action) {
    if (!requestId) throw new MultiSigError209('requestId required');
    if (!signerId)  throw new MultiSigError209('signerId required');
    if (!['approve', 'reject'].includes(action)) throw new MultiSigError209('action must be approve or reject');

    const req = _withdrawalRequests209.get(requestId);
    if (!req) { const e = new MultiSigError209(`Request ${requestId} not found`, 'REQUEST_NOT_FOUND_209'); e.statusCode = 404; throw e; }
    if (req.status !== 'pending') throw new MultiSigError209(`Request is ${req.status}`);
    if (!req.signers.includes(signerId)) throw new MultiSigError209(`${signerId} is not an authorized signer`, 'NOT_AUTHORIZED_SIGNER_209');

    const alreadySigned = [...req.signatures, ...req.rejections].find(s => s.signerId === signerId);
    if (alreadySigned) throw new MultiSigError209('Signer already voted', 'ALREADY_SIGNED_209');

    if (new Date(req.expiresAt).getTime() < Date.now()) {
      req.status = 'expired';
      throw new MultiSigError209('Request has expired', 'REQUEST_EXPIRED_209');
    }

    const record = { signerId, action, signedAt: new Date().toISOString() };
    if (action === 'approve') req.signatures.push(record);
    else                      req.rejections.push(record);

    // Check if approved
    if (req.signatures.length >= req.requiredSignatures) {
      req.status     = 'approved';
      req.approvedAt = new Date().toISOString();
    }
    // Check if definitively rejected (more than N-M+1 rejections = can never approve)
    const maxPossibleApprovals = req.signers.length - req.rejections.length;
    if (maxPossibleApprovals < req.requiredSignatures) {
      req.status     = 'rejected';
      req.rejectedAt = new Date().toISOString();
    }

    return {
      ok: true,
      signature: record,
      status: req.status,
      signaturesCollected: req.signatures.length,
      required: req.requiredSignatures,
      request: { ...req },
    };
  }

  /**
   * getWithdrawalRequest209 — read a withdrawal request.
   */
  function getWithdrawalRequest209(requestId) {
    if (!requestId) throw new MultiSigError209('requestId required');
    const req = _withdrawalRequests209.get(requestId);
    if (!req) { const e = new MultiSigError209(`Request ${requestId} not found`, 'REQUEST_NOT_FOUND_209'); e.statusCode = 404; throw e; }
    // Lazy expiry
    if (req.status === 'pending' && new Date(req.expiresAt).getTime() < Date.now()) req.status = 'expired';
    return { ...req };
  }

  module.exports = {
    createWithdrawalRequest209,
    signWithdrawal209,
    getWithdrawalRequest209,
    MultiSigError209,
    MULTISIG_QUORUM_209,
    MULTISIG_SIGNERS_MAX_209,
    MULTISIG_HIGH_VALUE_209,
    MULTISIG_WINDOW_MS_209,
    _withdrawalRequests209,
  };
  