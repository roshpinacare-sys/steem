/**
 * lib/disputeArbiter210.js — ECOS V210
 * Dispute Resolution Arbiter: 3-validator panel for pay-for-proof disputes.
 * Research: Kleros decentralized court + Aragon court — deterministic rule-based arbitration.
 */
'use strict';

const ARBITER_PANEL_SIZE_210     = 3;      // exactly 3 arbiters per dispute
const ARBITER_MIN_REP_210        = 300;    // minimum reputation to serve as arbiter
const DISPUTE_WINDOW_MS_210      = 72 * 60 * 60 * 1000; // 72-hour voting window
const VOTE_COOLDOWN_MS_210       = 0;      // no cooldown (one vote per arbiter)
const MAX_DISPUTES_210           = 10_000;
const ARBITER_REWARD_CREDITS_210 = 15;     // credits paid to arbiters on resolution
const LOSING_PARTY_SLASH_PCT_210 = 0.05;   // 5% of escrow slashed from losing party

class DisputeError210 extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DisputeError210';
    this.code = code || 'DISPUTE_ERROR_210';
    this.statusCode = 400;
  }
}

// _disputes210: disputeId → dispute object
const _disputes210 = new Map();
let _disputeCounter210 = 0;

/**
 * openDispute210 — open a dispute over a task's proof or payment.
 * @param {object} params
 * @param {string} params.taskId
 * @param {string} params.disputeReason — 'proof_rejected' | 'proof_not_delivered' | 'amount_wrong' | 'other'
 * @param {string} params.raisedBy — userId of the disputing party
 * @param {string} params.againstParty — userId of the other party
 * @param {number} params.escrowAmountUsd — disputed escrow amount
 * @param {string[]} params.arbiterIds — exactly 3 arbiter userIds
 * @param {number[]} params.arbiterReps — reputation scores matching arbiterIds
 */
function openDispute210(params) {
  if (!params || typeof params !== 'object') throw new DisputeError210('params required');
  const { taskId, disputeReason, raisedBy, againstParty, escrowAmountUsd, arbiterIds, arbiterReps } = params;

  if (!taskId)           throw new DisputeError210('taskId required');
  if (!raisedBy)         throw new DisputeError210('raisedBy required');
  if (!againstParty)     throw new DisputeError210('againstParty required');
  if (raisedBy === againstParty) throw new DisputeError210('raisedBy and againstParty cannot be the same');
  if (!escrowAmountUsd || typeof escrowAmountUsd !== 'number' || escrowAmountUsd <= 0) {
    throw new DisputeError210('escrowAmountUsd must be positive');
  }
  if (!Array.isArray(arbiterIds) || arbiterIds.length !== ARBITER_PANEL_SIZE_210) {
    throw new DisputeError210(`Exactly ${ARBITER_PANEL_SIZE_210} arbiter IDs required`);
  }
  if (!Array.isArray(arbiterReps) || arbiterReps.length !== ARBITER_PANEL_SIZE_210) {
    throw new DisputeError210(`Exactly ${ARBITER_PANEL_SIZE_210} arbiter reputations required`);
  }
  if (new Set(arbiterIds).size !== arbiterIds.length) throw new DisputeError210('Duplicate arbiter IDs');
  if (arbiterIds.includes(raisedBy) || arbiterIds.includes(againstParty)) {
    throw new DisputeError210('Parties cannot be arbiters in their own dispute');
  }

  for (let i = 0; i < arbiterIds.length; i++) {
    if (arbiterReps[i] < ARBITER_MIN_REP_210) {
      throw new DisputeError210(`Arbiter ${arbiterIds[i]} lacks minimum reputation ${ARBITER_MIN_REP_210}`, 'INSUFFICIENT_ARBITER_REP_210');
    }
  }

  if (_disputes210.size >= MAX_DISPUTES_210) throw new DisputeError210('Dispute store full');

  const disputeId = `dispute-${++_disputeCounter210}-${Date.now()}`;
  const validReasons = ['proof_rejected', 'proof_not_delivered', 'amount_wrong', 'other'];
  const dispute = {
    disputeId,
    taskId,
    disputeReason: validReasons.includes(disputeReason) ? disputeReason : 'other',
    raisedBy,
    againstParty,
    escrowAmountUsd: +escrowAmountUsd.toFixed(6),
    slashAmount:     +(escrowAmountUsd * LOSING_PARTY_SLASH_PCT_210).toFixed(6),
    arbiters: arbiterIds.map((id, i) => ({
      arbiterId: id,
      reputation: arbiterReps[i],
      vote: null,         // null | 'for_raiser' | 'for_against'
      votedAt: null,
      reasoning: null,
    })),
    status:    'open',    // open | resolved_for_raiser | resolved_for_against | deadlocked | expired
    openedAt:  new Date().toISOString(),
    expiresAt: new Date(Date.now() + DISPUTE_WINDOW_MS_210).toISOString(),
    resolvedAt: null,
    resolution: null,     // 'for_raiser' | 'for_against'
    verdict:   null,
  };
  _disputes210.set(disputeId, dispute);
  return { ok: true, dispute: { ...dispute } };
}

/**
 * castArbiterVote210 — an arbiter votes on the dispute.
 * @param {string} disputeId
 * @param {string} arbiterId
 * @param {string} vote — 'for_raiser' | 'for_against'
 * @param {string} [reasoning]
 */
function castArbiterVote210(disputeId, arbiterId, vote, reasoning) {
  if (!disputeId)  throw new DisputeError210('disputeId required');
  if (!arbiterId)  throw new DisputeError210('arbiterId required');
  if (!['for_raiser', 'for_against'].includes(vote)) {
    throw new DisputeError210('vote must be for_raiser or for_against');
  }

  const dispute = _disputes210.get(disputeId);
  if (!dispute) {
    const e = new DisputeError210(`Dispute ${disputeId} not found`, 'DISPUTE_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }
  if (dispute.status !== 'open') throw new DisputeError210(`Dispute is ${dispute.status}`);
  if (new Date(dispute.expiresAt).getTime() < Date.now()) {
    dispute.status = 'expired'; throw new DisputeError210('Dispute voting window expired', 'DISPUTE_EXPIRED_210');
  }

  const arbiter = dispute.arbiters.find(a => a.arbiterId === arbiterId);
  if (!arbiter) throw new DisputeError210(`${arbiterId} is not an arbiter for this dispute`, 'NOT_AN_ARBITER_210');
  if (arbiter.vote !== null) throw new DisputeError210('Arbiter already voted', 'ALREADY_VOTED_210');

  arbiter.vote      = vote;
  arbiter.votedAt   = new Date().toISOString();
  arbiter.reasoning = reasoning || null;

  // Check if all arbiters have voted → resolve
  const allVoted   = dispute.arbiters.every(a => a.vote !== null);
  const raiserVotes = dispute.arbiters.filter(a => a.vote === 'for_raiser').length;
  const againstVotes = dispute.arbiters.filter(a => a.vote === 'for_against').length;

  if (allVoted) {
    dispute.resolvedAt = new Date().toISOString();
    if (raiserVotes > againstVotes) {
      dispute.status     = 'resolved_for_raiser';
      dispute.resolution = 'for_raiser';
      dispute.verdict    = `Panel voted ${raiserVotes}-${againstVotes} in favor of raiser`;
    } else if (againstVotes > raiserVotes) {
      dispute.status     = 'resolved_for_against';
      dispute.resolution = 'for_against';
      dispute.verdict    = `Panel voted ${againstVotes}-${raiserVotes} in favor of respondent`;
    } else {
      dispute.status     = 'deadlocked';
      dispute.verdict    = 'Panel deadlocked — automatic refund to raiser';
    }
  }

  return {
    ok: true,
    vote: { arbiterId, vote, votedAt: arbiter.votedAt },
    resolved: allVoted,
    dispute:  { ...dispute },
    raiserVotes,
    againstVotes,
    pendingVotes: dispute.arbiters.filter(a => a.vote === null).length,
  };
}

/**
 * getDispute210 — read a dispute by ID.
 */
function getDispute210(disputeId) {
  if (!disputeId) throw new DisputeError210('disputeId required');
  const d = _disputes210.get(disputeId);
  if (!d) {
    const e = new DisputeError210(`Dispute ${disputeId} not found`, 'DISPUTE_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }
  if (d.status === 'open' && new Date(d.expiresAt).getTime() < Date.now()) {
    d.status = 'expired';
  }
  return { ...d };
}

module.exports = {
  openDispute210,
  castArbiterVote210,
  getDispute210,
  DisputeError210,
  ARBITER_PANEL_SIZE_210,
  ARBITER_MIN_REP_210,
  DISPUTE_WINDOW_MS_210,
  ARBITER_REWARD_CREDITS_210,
  LOSING_PARTY_SLASH_PCT_210,
  _disputes210,
};
