/**
   * multiRoundConsensus212.js — Multi-Round Consensus Scoring (V212)
   * Sacred files untouched. Zero new npm deps.
   */
  'use strict';
  const _rounds212 = new Map();
  const ROUND_MIN_VALIDATORS_212       = 3;
  const ROUND_MAX_VALIDATORS_212       = 11;
  const ROUND_TIEBREAK_MULTIPLIER_212  = 2.0;
  const ROUND_TOP_QUARTILE_PCT_212     = 0.75;
  const ROUND_MAX_212 = 5000;
  function _roundErr212(msg, code, status) { const e = new Error(msg); e.code = code; e.statusCode = status || 400; return e; }
  function openConsensusRound212(workspaceId, body) {
    if (!workspaceId) throw _roundErr212('workspaceId required', 'ROUND_MISSING_WS');
    const { taskId, validators, roundType } = body || {};
    if (!taskId) throw _roundErr212('taskId required', 'ROUND_MISSING_TASK');
    if (!Array.isArray(validators) || validators.length < ROUND_MIN_VALIDATORS_212) throw _roundErr212(`At least ${ROUND_MIN_VALIDATORS_212} validators required`, 'ROUND_TOO_FEW');
    if (validators.length > ROUND_MAX_VALIDATORS_212) throw _roundErr212(`Max ${ROUND_MAX_VALIDATORS_212} validators per round`, 'ROUND_TOO_MANY');
    if (_rounds212.size >= ROUND_MAX_212) throw _roundErr212('Round capacity reached', 'ROUND_CAPACITY', 503);
    const type = roundType === 'tiebreaker' ? 'tiebreaker' : 'standard';
    const reps = validators.map(v => Number(v.rep) || 0);
    const sorted = [...reps].sort((a, b) => b - a);
    const topQ = sorted[Math.floor(sorted.length * (1 - ROUND_TOP_QUARTILE_PCT_212))] || 0;
    const participantMap = {};
    validators.forEach(v => {
      const rep = Number(v.rep) || 0;
      const boost = (type === 'tiebreaker' && rep >= topQ && topQ > 0) ? ROUND_TIEBREAK_MULTIPLIER_212 : 1.0;
      participantMap[v.validatorId] = { validatorId: v.validatorId, rep, weight: rep * boost, vote: null };
    });
    const roundId = 'round212_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const now = new Date().toISOString();
    _rounds212.set(roundId, { roundId, workspaceId, taskId, type, participants: participantMap, status: 'voting', forWeight: 0, againstWeight: 0, abstainWeight: 0, outcome: null, tiebreakRoundId: null, openedAt: now, resolvedAt: null });
    return { ok: true, roundId, workspaceId, taskId, type, participantCount: validators.length, openedAt: now };
  }
  function castConsensusVote212(workspaceId, roundId, body) {
    const round = _rounds212.get(roundId);
    if (!round) throw _roundErr212('Round not found', 'ROUND_NOT_FOUND', 404);
    if (round.workspaceId !== workspaceId) throw _roundErr212('Round belongs to different workspace', 'ROUND_WS_MISMATCH');
    if (round.status !== 'voting') throw _roundErr212('Round is not in voting status', 'ROUND_NOT_VOTING');
    const { validatorId, vote } = body || {};
    if (!validatorId) throw _roundErr212('validatorId required', 'ROUND_MISSING_VALIDATOR');
    if (!['approve', 'reject', 'abstain'].includes(vote)) throw _roundErr212('vote must be approve, reject, or abstain', 'ROUND_BAD_VOTE');
    const participant = round.participants[validatorId];
    if (!participant) throw _roundErr212('Validator not in round', 'ROUND_NOT_PARTICIPANT');
    if (participant.vote !== null) throw _roundErr212('Already voted', 'ROUND_DOUBLE_VOTE');
    participant.vote = vote; participant.votedAt = new Date().toISOString();
    if (vote === 'approve')  round.forWeight     += participant.weight;
    if (vote === 'reject')   round.againstWeight += participant.weight;
    if (vote === 'abstain')  round.abstainWeight += participant.weight;
    const allVoted = Object.values(round.participants).every(p => p.vote !== null);
    if (allVoted) {
      const { forWeight, againstWeight } = round;
      const totalActive = forWeight + againstWeight;
      if (totalActive === 0) { round.outcome = 'abstained'; round.status = 'resolved'; }
      else if (forWeight > againstWeight) { round.outcome = 'approved'; round.status = 'resolved'; }
      else if (againstWeight > forWeight) { round.outcome = 'rejected'; round.status = 'resolved'; }
      else { round.outcome = 'tied'; round.status = 'needs_tiebreaker'; }
      round.resolvedAt = new Date().toISOString();
    }
    return { ok: true, roundId, validatorId, vote, roundStatus: round.status, outcome: round.outcome };
  }
  function getRound212(workspaceId, roundId) {
    const round = _rounds212.get(roundId);
    if (!round) throw _roundErr212('Round not found', 'ROUND_NOT_FOUND', 404);
    if (round.workspaceId !== workspaceId) throw _roundErr212('Round belongs to different workspace', 'ROUND_WS_MISMATCH');
    return { ok: true, round };
  }
  module.exports = { openConsensusRound212, castConsensusVote212, getRound212, _rounds212, ROUND_MIN_VALIDATORS_212, ROUND_MAX_VALIDATORS_212, ROUND_TIEBREAK_MULTIPLIER_212, ROUND_TOP_QUARTILE_PCT_212 };
  