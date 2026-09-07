/**
   * validatorPoolStaking212.js — Delegated Validator Pools (V212)
   * Sacred files untouched. Zero new npm deps.
   */
  'use strict';

  const _pools212 = new Map();
  const _poolMembers212 = new Map();
  const _poolStakes212 = new Map();

  const POOL_MIN_REP_212       = 200;
  const POOL_MAX_MEMBERS_212   = 20;
  const POOL_MIN_STAKE_PCT_212 = 0.01;
  const POOL_MAX_STAKE_PCT_212 = 0.40;
  const POOL_SLASH_PCT_212     = 0.15;
  const POOL_REWARD_PCT_212    = 0.08;
  const POOL_MAX_212           = 500;

  function _poolErr212(msg, code, status) { const e = new Error(msg); e.code = code; e.statusCode = status || 400; return e; }

  function createPool212(body) {
    const { name, creatorId, creatorRep, description } = body || {};
    if (!name || !creatorId) throw _poolErr212('name and creatorId required', 'POOL_MISSING_FIELDS');
    const rep = Number(creatorRep) || 0;
    if (rep < POOL_MIN_REP_212) throw _poolErr212(`creatorRep must be >= ${POOL_MIN_REP_212}`, 'POOL_INSUFFICIENT_REP');
    if (_pools212.size >= POOL_MAX_212) throw _poolErr212('Pool capacity reached', 'POOL_CAPACITY', 503);
    const poolId = 'pool212_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const now = new Date().toISOString();
    const pool = { poolId, name, creatorId, description: description || '', totalRep: rep, memberCount: 1, createdAt: now, status: 'active', totalEarned: 0, totalLost: 0 };
    _pools212.set(poolId, pool);
    const members = new Map();
    members.set(creatorId, { memberId: creatorId, rep, joinedAt: now, role: 'creator' });
    _poolMembers212.set(poolId, members);
    _poolStakes212.set(poolId, new Map());
    return { ok: true, poolId, pool };
  }

  function joinPool212(poolId, body) {
    const pool = _pools212.get(poolId);
    if (!pool) throw _poolErr212('Pool not found', 'POOL_NOT_FOUND', 404);
    if (pool.status !== 'active') throw _poolErr212('Pool is not active', 'POOL_INACTIVE');
    const { memberId, memberRep } = body || {};
    if (!memberId) throw _poolErr212('memberId required', 'POOL_MISSING_MEMBER');
    const rep = Number(memberRep) || 0;
    if (rep < POOL_MIN_REP_212) throw _poolErr212(`memberRep must be >= ${POOL_MIN_REP_212}`, 'POOL_INSUFFICIENT_REP');
    const members = _poolMembers212.get(poolId);
    if (members.has(memberId)) throw _poolErr212('Member already in pool — duplicate member', 'POOL_DUPLICATE_MEMBER');
    if (members.size >= POOL_MAX_MEMBERS_212) throw _poolErr212(`Pool full (max ${POOL_MAX_MEMBERS_212})`, 'POOL_FULL');
    members.set(memberId, { memberId, rep, joinedAt: new Date().toISOString(), role: 'member' });
    pool.totalRep += rep;
    pool.memberCount = members.size;
    return { ok: true, poolId, memberId, poolTotalRep: pool.totalRep, memberCount: pool.memberCount };
  }

  function stakePool212(poolId, body) {
    const pool = _pools212.get(poolId);
    if (!pool) throw _poolErr212('Pool not found', 'POOL_NOT_FOUND', 404);
    const { taskId, predictedOutcome, stakeAmountRep } = body || {};
    if (!taskId || !predictedOutcome) throw _poolErr212('taskId and predictedOutcome required', 'POOL_MISSING_STAKE_FIELDS');
    if (!['pass', 'fail'].includes(predictedOutcome)) throw _poolErr212('predictedOutcome must be pass or fail', 'POOL_BAD_OUTCOME');
    const stakes = _poolStakes212.get(poolId);
    if (stakes.has(taskId)) throw _poolErr212('Pool already staked on this task — duplicate stake', 'POOL_DUPLICATE_STAKE');
    const amount = Number(stakeAmountRep) || 0;
    const minStake = Math.ceil(pool.totalRep * POOL_MIN_STAKE_PCT_212);
    const maxStake = Math.floor(pool.totalRep * POOL_MAX_STAKE_PCT_212);
    if (amount < minStake) throw _poolErr212(`Stake must be >= ${minStake} (1% of pool rep) — min stake not met`, 'POOL_STAKE_TOO_LOW');
    if (amount > maxStake) throw _poolErr212(`Stake must be <= ${maxStake} (40% of pool rep)`, 'POOL_STAKE_TOO_HIGH');
    const record = { taskId, predictedOutcome, stakeAmountRep: amount, stakedAt: new Date().toISOString(), settled: false };
    stakes.set(taskId, record);
    return { ok: true, poolId, taskId, predictedOutcome, stakeAmountRep: amount, poolTotalRep: pool.totalRep };
  }

  function resolvePoolStake212(poolId, body) {
    const pool = _pools212.get(poolId);
    if (!pool) throw _poolErr212('Pool not found', 'POOL_NOT_FOUND', 404);
    const { taskId, actualOutcome } = body || {};
    if (!taskId || !actualOutcome) throw _poolErr212('taskId and actualOutcome required', 'POOL_MISSING_RESOLVE_FIELDS');
    const stakes = _poolStakes212.get(poolId);
    const stake = stakes.get(taskId);
    if (!stake) throw _poolErr212('No stake found for task', 'POOL_NO_STAKE', 404);
    if (stake.settled) throw _poolErr212('Stake already settled', 'POOL_ALREADY_SETTLED');
    const correct = stake.predictedOutcome === actualOutcome;
    let delta = 0;
    if (correct) { delta = Math.round(stake.stakeAmountRep * POOL_REWARD_PCT_212); pool.totalRep += delta; pool.totalEarned += delta; }
    else { delta = -Math.round(stake.stakeAmountRep * POOL_SLASH_PCT_212); pool.totalRep = Math.max(0, pool.totalRep + delta); pool.totalLost += Math.abs(delta); }
    stake.settled = true; stake.actualOutcome = actualOutcome; stake.correct = correct; stake.delta = delta; stake.settledAt = new Date().toISOString();
    return { ok: true, poolId, taskId, correct, delta, poolTotalRep: pool.totalRep };
  }

  function getPool212(poolId) {
    const pool = _pools212.get(poolId);
    if (!pool) throw _poolErr212('Pool not found', 'POOL_NOT_FOUND', 404);
    const members = Array.from((_poolMembers212.get(poolId) || new Map()).values());
    return { ok: true, pool, members };
  }

  module.exports = { createPool212, joinPool212, stakePool212, resolvePoolStake212, getPool212, _pools212, _poolMembers212, _poolStakes212, POOL_MIN_REP_212, POOL_MAX_MEMBERS_212, POOL_SLASH_PCT_212, POOL_REWARD_PCT_212 };
  