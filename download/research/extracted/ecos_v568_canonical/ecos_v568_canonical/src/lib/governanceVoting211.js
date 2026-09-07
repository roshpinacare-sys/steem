/**
   * lib/governanceVoting211.js — ECOS V211
   * Proof-of-Stake Governance Votes: weighted voting by staked reputation (not flat 1-person-1-vote).
   * Research: Compound Governor Bravo, MakerDAO MKR voting — stake-weighted on-chain governance.
   */
  'use strict';

  const GOV_MIN_REP_TO_PROPOSE_211 = 200;    // min rep to create a proposal
  const GOV_MIN_REP_TO_VOTE_211    = 50;     // min rep to cast a vote
  const GOV_VOTING_WINDOW_MS_211   = 7 * 24 * 60 * 60 * 1000;  // 7-day voting window
  const GOV_QUORUM_PCT_211         = 0.10;   // 10% of total staked rep needed for quorum
  const MAX_PROPOSALS_211          = 5_000;

  class GovernanceError211 extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'GovernanceError211';
      this.code = code || 'GOV_ERROR_211';
      this.statusCode = 400;
    }
  }

  const _proposals211 = new Map();
  let _proposalCounter211 = 0;

  /**
   * createProposal211 — create a new governance proposal.
   * @param {object} params
   * @param {string} params.proposerId
   * @param {number} params.proposerRep
   * @param {string} params.title
   * @param {string} params.description
   * @param {string} params.proposalType  — 'parameter_change'|'feature_enable'|'protocol_upgrade'|'treasury'
   * @param {object} [params.payload]     — arbitrary JSON payload
   */
  function createProposal211(params) {
    if (!params || typeof params !== 'object') throw new GovernanceError211('params required');
    const { proposerId, proposerRep, title, description, proposalType, payload } = params;
    if (!proposerId)    throw new GovernanceError211('proposerId required');
    if (typeof proposerRep !== 'number' || proposerRep < GOV_MIN_REP_TO_PROPOSE_211) {
      throw new GovernanceError211(
        'Minimum reputation ' + GOV_MIN_REP_TO_PROPOSE_211 + ' required to propose',
        'INSUFFICIENT_REP_211'
      );
    }
    if (!title || typeof title !== 'string' || !title.trim()) throw new GovernanceError211('title required');
    if (!description || typeof description !== 'string')      throw new GovernanceError211('description required');
    const validTypes = ['parameter_change', 'feature_enable', 'protocol_upgrade', 'treasury'];
    if (_proposals211.size >= MAX_PROPOSALS_211) throw new GovernanceError211('Proposal store full');

    const proposalId = 'prop-' + (++_proposalCounter211) + '-' + Date.now();
    const proposal = {
      proposalId,
      proposerId,
      proposerRep,
      title: title.trim(),
      description,
      proposalType: validTypes.includes(proposalType) ? proposalType : 'protocol_upgrade',
      payload: payload || {},
      status: 'active',        // active | passed | rejected | expired
      createdAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + GOV_VOTING_WINDOW_MS_211).toISOString(),
      votes: {},               // voterId → { rep, vote, castedAt }
      totalRepFor: 0,
      totalRepAgainst: 0,
      totalVoters: 0,
    };
    _proposals211.set(proposalId, proposal);
    return { ok: true, proposalId, proposal: _sanitiseProposal211(proposal) };
  }

  function _sanitiseProposal211(p) {
    return {
      proposalId: p.proposalId, proposerId: p.proposerId, title: p.title,
      proposalType: p.proposalType, status: p.status, createdAt: p.createdAt,
      endsAt: p.endsAt, totalRepFor: p.totalRepFor, totalRepAgainst: p.totalRepAgainst,
      totalVoters: p.totalVoters,
    };
  }

  /**
   * castVote211 — cast a weighted vote on a proposal (weight = voterRep).
   * @param {string} proposalId
   * @param {object} params
   * @param {string} params.voterId
   * @param {number} params.voterRep  — current rep (= voting weight)
   * @param {string} params.vote      — 'for' | 'against' | 'abstain'
   */
  function castVote211(proposalId, params) {
    if (!proposalId) throw new GovernanceError211('proposalId required');
    const proposal = _proposals211.get(proposalId);
    if (!proposal) {
      const e = new GovernanceError211('Proposal ' + proposalId + ' not found', 'PROPOSAL_NOT_FOUND_211');
      e.statusCode = 404; throw e;
    }
    if (proposal.status !== 'active') throw new GovernanceError211('Proposal is ' + proposal.status);
    if (new Date(proposal.endsAt).getTime() < Date.now()) {
      proposal.status = 'expired';
      throw new GovernanceError211('Voting window has closed', 'VOTING_CLOSED_211');
    }

    const { voterId, voterRep, vote } = params || {};
    if (!voterId)  throw new GovernanceError211('voterId required');
    if (typeof voterRep !== 'number' || voterRep < GOV_MIN_REP_TO_VOTE_211) {
      throw new GovernanceError211('Minimum reputation ' + GOV_MIN_REP_TO_VOTE_211 + ' required to vote', 'INSUFFICIENT_VOTE_REP_211');
    }
    if (!['for', 'against', 'abstain'].includes(vote)) throw new GovernanceError211('vote must be for|against|abstain');
    if (proposal.votes[voterId]) throw new GovernanceError211('Voter ' + voterId + ' already voted', 'ALREADY_VOTED_211');

    proposal.votes[voterId] = { rep: voterRep, vote, castedAt: new Date().toISOString() };
    proposal.totalVoters++;
    if (vote === 'for')     proposal.totalRepFor     += voterRep;
    if (vote === 'against') proposal.totalRepAgainst += voterRep;

    return {
      ok: true,
      proposalId,
      voterId,
      vote,
      weight: voterRep,
      totalRepFor: proposal.totalRepFor,
      totalRepAgainst: proposal.totalRepAgainst,
      totalVoters: proposal.totalVoters,
    };
  }

  /**
   * getProposalTally211 — get vote tally with quorum + outcome assessment.
   * @param {string} proposalId
   * @param {number} totalNetworkRep — current total staked rep in network (for quorum calc)
   */
  function getProposalTally211(proposalId, totalNetworkRep) {
    if (!proposalId) throw new GovernanceError211('proposalId required');
    const proposal = _proposals211.get(proposalId);
    if (!proposal) {
      const e = new GovernanceError211('Proposal ' + proposalId + ' not found', 'PROPOSAL_NOT_FOUND_211');
      e.statusCode = 404; throw e;
    }
    const netRep = typeof totalNetworkRep === 'number' && totalNetworkRep > 0 ? totalNetworkRep : 10000;
    const quorumThreshold = netRep * GOV_QUORUM_PCT_211;
    const totalVoted = proposal.totalRepFor + proposal.totalRepAgainst;
    const quorumReached = totalVoted >= quorumThreshold;
    const passed = quorumReached && proposal.totalRepFor > proposal.totalRepAgainst;
    const expired = new Date(proposal.endsAt).getTime() < Date.now();

    let projectedStatus = proposal.status;
    if (expired && proposal.status === 'active') projectedStatus = quorumReached ? (passed ? 'passed' : 'rejected') : 'expired';

    return {
      ok: true,
      proposalId,
      title: proposal.title,
      proposalType: proposal.proposalType,
      status: projectedStatus,
      endsAt: proposal.endsAt,
      expired,
      quorum: {
        threshold: quorumThreshold,
        totalVoted,
        reached: quorumReached,
        pct: +(totalVoted / netRep * 100).toFixed(2),
      },
      tally: {
        for:     proposal.totalRepFor,
        against: proposal.totalRepAgainst,
        abstain: proposal.totalVoters === 0 ? 0 : (proposal.totalVoters - Object.values(proposal.votes).filter(v => v.vote !== 'abstain').length),
        totalVoters: proposal.totalVoters,
      },
      outcome: quorumReached ? (passed ? 'passed' : 'rejected') : 'pending_quorum',
    };
  }

  function getProposal211(proposalId) {
    if (!proposalId) throw new GovernanceError211('proposalId required');
    const proposal = _proposals211.get(proposalId);
    if (!proposal) {
      const e = new GovernanceError211('Proposal ' + proposalId + ' not found', 'PROPOSAL_NOT_FOUND_211');
      e.statusCode = 404; throw e;
    }
    return { ok: true, proposal: _sanitiseProposal211(proposal) };
  }

  module.exports = {
    createProposal211, castVote211, getProposalTally211, getProposal211,
    GOV_MIN_REP_TO_PROPOSE_211, GOV_MIN_REP_TO_VOTE_211, GOV_QUORUM_PCT_211,
    _proposals211,
  };
  