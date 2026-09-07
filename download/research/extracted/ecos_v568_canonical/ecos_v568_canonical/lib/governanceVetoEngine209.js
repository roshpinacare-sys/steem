/**
   * lib/governanceVetoEngine209.js — ECOS V209
   * Lazy Consensus / Veto Gate: high-reputation members fast-veto suspicious treasury proposals
   * Research: Build Finance attack — governance must prevent hostile majority capture
   */
  'use strict';

  const VETO_QUORUM_PCT_209        = 0.65;   // 65% of governance power needed to approve
  const VETO_THRESHOLD_REP_209     = 500;    // min reputation to participate in veto
  const VETO_WINDOW_MS_209         = 72 * 60 * 60 * 1000; // 72-hour veto window
  const FAST_VETO_THRESHOLD_209    = 3;      // 3 high-rep vetoes triggers immediate rejection
  const FAST_VETO_REP_MIN_209      = 2000;   // min rep for fast-veto privilege
  const MAX_PROPOSALS_209          = 500;

  class VetoValidationError209 extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'VetoValidationError209';
      this.code  = code || 'VETO_VALIDATION_ERROR_209';
      this.statusCode = 400;
    }
  }

  // In-memory proposal store
  const _proposals209 = new Map(); // proposalId → proposal object

  function _now209() { return Date.now(); }

  /**
   * createProposal209 — register a governance proposal for veto review.
   */
  function createProposal209(params) {
    if (!params || typeof params !== 'object') throw new VetoValidationError209('params required');
    const { proposalId, description, proposerRep, totalGovernancePower, amountUsd } = params;
    if (!proposalId || typeof proposalId !== 'string') throw new VetoValidationError209('proposalId required');
    if (_proposals209.has(proposalId)) throw new VetoValidationError209(`Proposal ${proposalId} already exists`, 'DUPLICATE_PROPOSAL_209');
    if (typeof totalGovernancePower !== 'number' || totalGovernancePower <= 0) {
      throw new VetoValidationError209('totalGovernancePower must be positive number');
    }
    if (_proposals209.size >= MAX_PROPOSALS_209) throw new VetoValidationError209('Proposal store full');
    const proposal = {
      proposalId,
      description:  description || '',
      proposerRep:  proposerRep || 0,
      amountUsd:    typeof amountUsd === 'number' ? amountUsd : null,
      totalGovernancePower,
      createdAt:    new Date().toISOString(),
      expiresAt:    new Date(_now209() + VETO_WINDOW_MS_209).toISOString(),
      status:       'open',        // open | approved | rejected | expired
      vetoes:       [],
      approvals:    [],
      fastVetoTriggered: false,
    };
    _proposals209.set(proposalId, proposal);
    return { ok: true, proposal };
  }

  /**
   * castVeto209 — a member casts a veto (or approval) on a proposal.
   */
  function castVeto209(params) {
    if (!params || typeof params !== 'object') throw new VetoValidationError209('params required');
    const { proposalId, memberId, memberRep, governancePower, action } = params;
    if (!proposalId) throw new VetoValidationError209('proposalId required');
    if (!memberId)   throw new VetoValidationError209('memberId required');
    if (typeof memberRep !== 'number' || memberRep < VETO_THRESHOLD_REP_209) {
      throw new VetoValidationError209(`Insufficient reputation: need ${VETO_THRESHOLD_REP_209}, have ${memberRep}`, 'INSUFFICIENT_REPUTATION_209');
    }
    const gp = typeof governancePower === 'number' ? governancePower : Math.sqrt(memberRep);
    if (!['veto', 'approve'].includes(action)) throw new VetoValidationError209('action must be veto or approve');

    const proposal = _proposals209.get(proposalId);
    if (!proposal) {
      const e = new VetoValidationError209(`Proposal ${proposalId} not found`, 'PROPOSAL_NOT_FOUND_209');
      e.statusCode = 404; throw e;
    }
    if (proposal.status !== 'open') throw new VetoValidationError209(`Proposal ${proposalId} is ${proposal.status}`);
    if (new Date(proposal.expiresAt).getTime() < _now209()) {
      proposal.status = 'expired';
      throw new VetoValidationError209('Proposal has expired', 'PROPOSAL_EXPIRED_209');
    }

    // Check for duplicate vote
    const alreadyVoted = [...proposal.vetoes, ...proposal.approvals].find(v => v.memberId === memberId);
    if (alreadyVoted) throw new VetoValidationError209('Member already voted', 'DUPLICATE_VOTE_209');

    const vote = { memberId, memberRep, governancePower: gp, action, votedAt: new Date().toISOString() };
    if (action === 'veto')    proposal.vetoes.push(vote);
    else                      proposal.approvals.push(vote);

    // Fast-veto check: 3+ vetoes from very high-rep members
    const fastVetoers = proposal.vetoes.filter(v => v.memberRep >= FAST_VETO_REP_MIN_209);
    if (fastVetoers.length >= FAST_VETO_THRESHOLD_209) {
      proposal.status            = 'rejected';
      proposal.fastVetoTriggered = true;
      proposal.resolvedAt        = new Date().toISOString();
      proposal.rejectionReason   = `Fast-veto: ${fastVetoers.length} high-reputation members (${FAST_VETO_REP_MIN_209}+ rep) vetoed`;
    }

    // Quorum check on approvals
    const approvalPower = proposal.approvals.reduce((s, v) => s + v.governancePower, 0);
    if (approvalPower / proposal.totalGovernancePower >= VETO_QUORUM_PCT_209) {
      proposal.status     = 'approved';
      proposal.resolvedAt = new Date().toISOString();
    }

    return {
      ok: true,
      vote,
      proposal: { ...proposal },
      vetoCount: proposal.vetoes.length,
      approvalCount: proposal.approvals.length,
      fastVetoTriggered: proposal.fastVetoTriggered,
    };
  }

  /**
   * getProposal209 — read a proposal by ID.
   */
  function getProposal209(proposalId) {
    if (!proposalId) throw new VetoValidationError209('proposalId required');
    const p = _proposals209.get(proposalId);
    if (!p) {
      const e = new VetoValidationError209(`Proposal ${proposalId} not found`, 'PROPOSAL_NOT_FOUND_209');
      e.statusCode = 404; throw e;
    }
    // Lazy expiry check
    if (p.status === 'open' && new Date(p.expiresAt).getTime() < _now209()) {
      p.status = 'expired';
    }
    return { ...p };
  }

  module.exports = {
    createProposal209,
    castVeto209,
    getProposal209,
    VetoValidationError209,
    VETO_QUORUM_PCT_209,
    VETO_THRESHOLD_REP_209,
    VETO_WINDOW_MS_209,
    FAST_VETO_THRESHOLD_209,
    FAST_VETO_REP_MIN_209,
    _proposals209,
  };
  