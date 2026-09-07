/**
   * lib/disputeAppeal211.js — ECOS V211
   * Dispute Appeal Layer: losing party can appeal to a larger 5-arbiter panel.
   * Cost: 3x original dispute fee. Extends disputeArbiter210.js pattern.
   */
  'use strict';

  const APPEAL_PANEL_SIZE_211    = 5;      // 5 arbiters for appeals (vs 3 for original)
  const APPEAL_MIN_REP_211       = 500;    // higher rep bar for appeal arbiters
  const APPEAL_FEE_MULTIPLIER_211 = 3;    // costs 3x original dispute fee
  const APPEAL_WINDOW_MS_211     = 96 * 60 * 60 * 1000; // 96-hour voting window
  const MAX_APPEALS_211          = 5_000;
  const APPEAL_SLASH_PCT_211     = 0.08;  // 8% slash on losing party (higher than first-level 5%)

  class AppealError211 extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'AppealError211';
      this.code = code || 'APPEAL_ERROR_211';
      this.statusCode = 400;
    }
  }

  const _appeals211 = new Map();
  let _appealCounter211 = 0;

  /**
   * openAppeal211 — open an appeal against a resolved dispute.
   * @param {string} originalDisputeId
   * @param {object} params
   * @param {string}   params.appellantId       — the party appealing (must be the losing party)
   * @param {string}   params.appellantRole     — 'raiser'|'against'
   * @param {string}   params.appealReason
   * @param {number}   params.originalEscrowUsd — original dispute escrow amount
   * @param {string[]} params.arbiterIds        — exactly 5 senior arbiter IDs
   * @param {number[]} params.arbiterReps       — reputation scores matching arbiterIds
   */
  function openAppeal211(originalDisputeId, params) {
    if (!originalDisputeId) throw new AppealError211('originalDisputeId required');
    if (!params || typeof params !== 'object') throw new AppealError211('params required');
    const { appellantId, appellantRole, appealReason, originalEscrowUsd, arbiterIds, arbiterReps } = params;

    if (!appellantId)  throw new AppealError211('appellantId required');
    if (!['raiser', 'against'].includes(appellantRole)) throw new AppealError211('appellantRole must be raiser|against');
    if (!appealReason) throw new AppealError211('appealReason required');
    if (typeof originalEscrowUsd !== 'number' || originalEscrowUsd <= 0) throw new AppealError211('originalEscrowUsd must be positive');
    if (!Array.isArray(arbiterIds) || arbiterIds.length !== APPEAL_PANEL_SIZE_211) {
      throw new AppealError211('Exactly ' + APPEAL_PANEL_SIZE_211 + ' arbiter IDs required for appeal');
    }
    if (!Array.isArray(arbiterReps) || arbiterReps.length !== APPEAL_PANEL_SIZE_211) {
      throw new AppealError211('Exactly ' + APPEAL_PANEL_SIZE_211 + ' arbiter reputations required');
    }
    if (new Set(arbiterIds).size !== arbiterIds.length) throw new AppealError211('Duplicate arbiter IDs');
    if (arbiterIds.includes(appellantId)) throw new AppealError211('Appellant cannot be an arbiter');

    for (let i = 0; i < arbiterIds.length; i++) {
      if (arbiterReps[i] < APPEAL_MIN_REP_211) {
        throw new AppealError211(
          'Appeal arbiter ' + arbiterIds[i] + ' requires minimum reputation ' + APPEAL_MIN_REP_211,
          'INSUFFICIENT_APPEAL_ARBITER_REP_211'
        );
      }
    }
    // Check for duplicate appeal
    for (const [, ap] of _appeals211) {
      if (ap.originalDisputeId === originalDisputeId) {
        throw new AppealError211('Appeal already exists for dispute ' + originalDisputeId, 'DUPLICATE_APPEAL_211');
      }
    }
    if (_appeals211.size >= MAX_APPEALS_211) throw new AppealError211('Appeal store full');

    const appealFeeUsd    = +(originalEscrowUsd * APPEAL_FEE_MULTIPLIER_211 * 0.05).toFixed(6);
    const appealSlashUsd  = +(originalEscrowUsd * APPEAL_SLASH_PCT_211).toFixed(6);
    const appealId = 'appeal-' + (++_appealCounter211) + '-' + Date.now();

    const appeal = {
      appealId,
      originalDisputeId,
      appellantId,
      appellantRole,
      appealReason,
      originalEscrowUsd: +originalEscrowUsd.toFixed(6),
      appealFeeUsd,
      slashOnLoss: appealSlashUsd,
      status: 'active',    // active | upheld | dismissed | expired
      createdAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + APPEAL_WINDOW_MS_211).toISOString(),
      arbiters: arbiterIds.map((id, i) => ({ arbiterId: id, rep: arbiterReps[i], vote: null, votedAt: null })),
      votesFor: 0,      // for appellant (uphold appeal)
      votesAgainst: 0,  // against appellant (dismiss)
      resolution: null,
    };

    _appeals211.set(appealId, appeal);
    return { ok: true, appealId, appealFeeUsd, slashOnLoss: appealSlashUsd, endsAt: appeal.endsAt };
  }

  /**
   * castAppealVote211 — an arbiter votes on the appeal.
   * @param {string} appealId
   * @param {object} params
   * @param {string} params.arbiterId
   * @param {string} params.vote  — 'uphold'|'dismiss'
   */
  function castAppealVote211(appealId, params) {
    if (!appealId) throw new AppealError211('appealId required');
    const appeal = _appeals211.get(appealId);
    if (!appeal) {
      const e = new AppealError211('Appeal ' + appealId + ' not found', 'APPEAL_NOT_FOUND_211');
      e.statusCode = 404; throw e;
    }
    if (appeal.status !== 'active') throw new AppealError211('Appeal is ' + appeal.status);
    if (new Date(appeal.endsAt).getTime() < Date.now()) {
      appeal.status = 'expired'; throw new AppealError211('Appeal window has closed', 'APPEAL_CLOSED_211');
    }

    const { arbiterId, vote } = params || {};
    if (!arbiterId) throw new AppealError211('arbiterId required');
    if (!['uphold', 'dismiss'].includes(vote)) throw new AppealError211('vote must be uphold|dismiss');

    const arbiter = appeal.arbiters.find(a => a.arbiterId === arbiterId);
    if (!arbiter) throw new AppealError211('Arbiter ' + arbiterId + ' not on this appeal panel', 'NOT_ON_PANEL_211');
    if (arbiter.vote !== null) throw new AppealError211('Arbiter ' + arbiterId + ' already voted', 'ALREADY_VOTED_211');

    arbiter.vote    = vote;
    arbiter.votedAt = new Date().toISOString();
    if (vote === 'uphold') appeal.votesFor++;
    else appeal.votesAgainst++;

    // Auto-resolve when majority reached (3 of 5)
    const majority = Math.ceil(APPEAL_PANEL_SIZE_211 / 2) + 1; // 3
    if (appeal.votesFor >= majority) {
      appeal.status = 'upheld';
      appeal.resolution = { outcome: 'upheld', decidedAt: new Date().toISOString(), slashParty: 'original_winner' };
    } else if (appeal.votesAgainst >= majority) {
      appeal.status = 'dismissed';
      appeal.resolution = { outcome: 'dismissed', decidedAt: new Date().toISOString(), slashParty: appeal.appellantId };
    }

    return {
      ok: true,
      appealId,
      votesFor: appeal.votesFor,
      votesAgainst: appeal.votesAgainst,
      status: appeal.status,
      resolution: appeal.resolution,
    };
  }

  function getAppeal211(appealId) {
    if (!appealId) throw new AppealError211('appealId required');
    const appeal = _appeals211.get(appealId);
    if (!appeal) {
      const e = new AppealError211('Appeal ' + appealId + ' not found', 'APPEAL_NOT_FOUND_211');
      e.statusCode = 404; throw e;
    }
    return { ok: true, appeal };
  }

  module.exports = {
    openAppeal211, castAppealVote211, getAppeal211,
    APPEAL_PANEL_SIZE_211, APPEAL_MIN_REP_211, APPEAL_FEE_MULTIPLIER_211,
    _appeals211,
  };
  