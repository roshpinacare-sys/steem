/**
 * lib/reputationStaking210.js — ECOS V210
 * Reputation Staking: members stake reputation on task outcomes; slashed on wrong validation.
 * Research: Eigenlayer re-staking, Kleros juror stake-slash — skin-in-the-game for validators.
 */
'use strict';

const STAKE_MIN_REP_210         = 100;    // minimum reputation to stake
const STAKE_MAX_PCT_210         = 0.50;   // max 50% of reputation can be staked at once
const SLASH_PCT_210             = 0.20;   // 20% of staked amount slashed on wrong validation
const REWARD_PCT_210            = 0.10;   // 10% bonus on staked amount for correct validation
const MAX_STAKES_210            = 10_000;
const STAKE_WINDOW_MS_210       = 7 * 24 * 60 * 60 * 1000; // 7-day stake window

class StakingError210 extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StakingError210';
    this.code = code || 'STAKING_ERROR_210';
    this.statusCode = 400;
  }
}

// In-memory stake store: stakeId → stake object
const _stakes210 = new Map();
let _stakeCounter210 = 0;

/**
 * createStake210 — a validator stakes reputation on a task outcome.
 * @param {object} params
 * @param {string} params.validatorId
 * @param {string} params.taskId
 * @param {number} params.currentRep — validator's current reputation score
 * @param {number} params.stakeAmount — reputation points to stake
 * @param {string} params.prediction — 'approve' | 'reject'
 */
function createStake210(params) {
  if (!params || typeof params !== 'object') throw new StakingError210('params required');
  const { validatorId, taskId, currentRep, stakeAmount, prediction } = params;

  if (!validatorId) throw new StakingError210('validatorId required');
  if (!taskId)      throw new StakingError210('taskId required');
  if (typeof currentRep !== 'number' || currentRep < STAKE_MIN_REP_210) {
    throw new StakingError210(`Minimum reputation ${STAKE_MIN_REP_210} required to stake`, 'INSUFFICIENT_REP_210');
  }
  if (typeof stakeAmount !== 'number' || stakeAmount <= 0) {
    throw new StakingError210('stakeAmount must be positive');
  }
  if (stakeAmount > currentRep * STAKE_MAX_PCT_210) {
    throw new StakingError210(`Cannot stake more than ${STAKE_MAX_PCT_210 * 100}% of current reputation`, 'STAKE_EXCEEDS_MAX_210');
  }
  if (!['approve', 'reject'].includes(prediction)) {
    throw new StakingError210('prediction must be approve or reject');
  }
  if (_stakes210.size >= MAX_STAKES_210) throw new StakingError210('Stake store full');

  const stakeId = `stake-${++_stakeCounter210}-${Date.now()}`;
  const stake = {
    stakeId,
    validatorId,
    taskId,
    stakeAmount: Math.round(stakeAmount),
    prediction,
    status: 'active',    // active | resolved_correct | resolved_wrong | expired
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + STAKE_WINDOW_MS_210).toISOString(),
    resolvedAt: null,
    outcome: null,       // 'approve' | 'reject' (actual task outcome)
    repDelta: null,      // positive = reward, negative = slash
  };
  _stakes210.set(stakeId, stake);
  return { ok: true, stake: { ...stake }, maxStakeable: Math.floor(currentRep * STAKE_MAX_PCT_210) };
}

/**
 * resolveStake210 — resolve a stake after task outcome is known.
 * @param {string} stakeId
 * @param {string} actualOutcome — 'approve' | 'reject' (what actually happened)
 */
function resolveStake210(stakeId, actualOutcome) {
  if (!stakeId) throw new StakingError210('stakeId required');
  if (!['approve', 'reject'].includes(actualOutcome)) {
    throw new StakingError210('actualOutcome must be approve or reject');
  }
  const stake = _stakes210.get(stakeId);
  if (!stake) {
    const e = new StakingError210(`Stake ${stakeId} not found`, 'STAKE_NOT_FOUND_210');
    e.statusCode = 404; throw e;
  }
  if (stake.status !== 'active') throw new StakingError210(`Stake is already ${stake.status}`);

  const correct = stake.prediction === actualOutcome;
  const repDelta = correct
    ? Math.round(stake.stakeAmount * REWARD_PCT_210)
    : -Math.round(stake.stakeAmount * SLASH_PCT_210);

  stake.status     = correct ? 'resolved_correct' : 'resolved_wrong';
  stake.resolvedAt = new Date().toISOString();
  stake.outcome    = actualOutcome;
  stake.repDelta   = repDelta;

  return {
    ok: true,
    stake: { ...stake },
    correct,
    repDelta,
    slashPct:  SLASH_PCT_210,
    rewardPct: REWARD_PCT_210,
  };
}

/**
 * getStakeStatus210 — get all stakes for a validator or task.
 */
function getStakeStatus210(filter) {
  if (!filter || typeof filter !== 'object') throw new StakingError210('filter object required');
  const { validatorId, taskId } = filter;
  if (!validatorId && !taskId) throw new StakingError210('validatorId or taskId required');

  const stakes = [..._stakes210.values()].filter(s => {
    if (validatorId && s.validatorId !== validatorId) return false;
    if (taskId && s.taskId !== taskId) return false;
    return true;
  });

  const totalStaked   = stakes.reduce((sum, s) => sum + (s.status === 'active' ? s.stakeAmount : 0), 0);
  const totalEarned   = stakes.reduce((sum, s) => sum + (s.repDelta > 0 ? s.repDelta : 0), 0);
  const totalSlashed  = stakes.reduce((sum, s) => sum + (s.repDelta < 0 ? -s.repDelta : 0), 0);
  const netRepDelta   = stakes.reduce((sum, s) => sum + (s.repDelta || 0), 0);

  return {
    stakes,
    totalStaked,
    totalEarned,
    totalSlashed,
    netRepDelta,
    activeCount:  stakes.filter(s => s.status === 'active').length,
    correctCount: stakes.filter(s => s.status === 'resolved_correct').length,
    wrongCount:   stakes.filter(s => s.status === 'resolved_wrong').length,
  };
}

module.exports = {
  createStake210,
  resolveStake210,
  getStakeStatus210,
  StakingError210,
  STAKE_MIN_REP_210,
  STAKE_MAX_PCT_210,
  SLASH_PCT_210,
  REWARD_PCT_210,
  STAKE_WINDOW_MS_210,
  _stakes210,
};
