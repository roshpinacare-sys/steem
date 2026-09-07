/**
   * proofAttestation212.js — Proof Attestation Registry (V212)
   * Sacred files untouched. Zero new npm deps.
   */
  'use strict';
  const _crypto212 = require('crypto');
  const _attestations212 = new Map();
  const ATTEST_MAX_212 = 10000;
  const CID_PREFIX_212 = 'bafybeiv212';
  function _attestErr212(msg, code, status) { const e = new Error(msg); e.code = code; e.statusCode = status || 400; return e; }
  function _makeCid212(proofId, plaintext, approverId) {
    const payload = [proofId, plaintext || '', approverId || ''].join(':');
    const hash = _crypto212.createHash('sha256').update(payload).digest('hex').slice(0, 32);
    return CID_PREFIX_212 + hash;
  }
  function attestProof212(proofId, body) {
    if (!proofId) throw _attestErr212('proofId required', 'ATTEST_MISSING_PROOF');
    const { plaintext, approverId, approverRep, metadata } = body || {};
    if (!plaintext || !approverId) throw _attestErr212('plaintext and approverId required', 'ATTEST_MISSING_FIELDS');
    for (const [, a] of _attestations212) { if (a.proofId === proofId) throw _attestErr212('Attestation already exists for proof ' + proofId + ' — duplicate attestation', 'ATTEST_DUPLICATE'); }
    if (_attestations212.size >= ATTEST_MAX_212) throw _attestErr212('Attestation registry full', 'ATTEST_CAPACITY', 503);
    const attestId = 'attest212_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const contentHash = _crypto212.createHash('sha256').update(plaintext).digest('hex');
    const cid = _makeCid212(proofId, plaintext, approverId);
    const attestation = { attestId, proofId, approverId, approverRep: Number(approverRep) || 0, contentHash, cid, metadata: metadata || {}, attestedAt: new Date().toISOString(), revoked: false };
    _attestations212.set(attestId, attestation);
    return { ok: true, attestId, proofId, cid, contentHash, attestedAt: attestation.attestedAt };
  }
  function getAttestation212(proofId) {
    for (const [, a] of _attestations212) { if (a.proofId === proofId) return { ok: true, attestation: a }; }
    throw _attestErr212('No attestation found for proof ' + proofId, 'ATTEST_NOT_FOUND', 404);
  }
  function listAttestations212({ limit = 50, offset = 0 } = {}) {
    const all = Array.from(_attestations212.values()).sort((a, b) => a.attestedAt < b.attestedAt ? 1 : -1);
    return { ok: true, attestations: all.slice(offset, offset + limit), total: all.length, limit, offset };
  }
  function revokeAttestation212(proofId, body) {
    const { revokerId, reason } = body || {};
    if (!revokerId) throw _attestErr212('revokerId required', 'ATTEST_MISSING_REVOKER');
    for (const [, a] of _attestations212) {
      if (a.proofId === proofId) {
        if (a.revoked) throw _attestErr212('Already revoked', 'ATTEST_ALREADY_REVOKED');
        a.revoked = true; a.revokedBy = revokerId; a.revokedReason = reason || ''; a.revokedAt = new Date().toISOString();
        return { ok: true, attestId: a.attestId, proofId, revokedAt: a.revokedAt };
      }
    }
    throw _attestErr212('No attestation found for proof ' + proofId, 'ATTEST_NOT_FOUND', 404);
  }
  module.exports = { attestProof212, getAttestation212, listAttestations212, revokeAttestation212, _attestations212, ATTEST_MAX_212, CID_PREFIX_212 };
  