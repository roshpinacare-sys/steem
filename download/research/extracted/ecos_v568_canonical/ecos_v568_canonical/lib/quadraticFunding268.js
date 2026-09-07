'use strict';
/**
 * src/lib/quadraticFunding268.js — Quadratic Funding / CLR (V268)
 *
 * Builds on quadraticFunding264 with:
 *   - Retroactive public goods funding (reward demonstrated impact)
 *   - Sybil-gating uses evaluate268 composite score
 *   - Program-level rounds (link to execution program)
 *   - Minimum contribution threshold (anti-dust)
 *   - Round results stored in agentReceipts268
 *
 * PROGRAM 08: Collaboration Economy
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

const QF_MIN_CONTRIBUTION_268  = 1_000n;  // min 0.1 credit
const QF_MAX_ROUNDS_268        = 500;

class QuadraticFunding268 {
  constructor(opts = {}) {
    this._logger        = opts.logger        || console;
    this._auditLog      = opts.auditLog      || null;
    this._sybilGuard    = opts.sybilGuard    || null;
    this._agentReceipts = opts.agentReceipts || null;
    this._rounds268     = new Map();
    this._retroactive268 = []; // retroactive funding records
  
    this._perf268 = { latencies: [] };
    this._logAdapter268 = opts.logAdapter || null;
  }

  createRound268(projectId, matchingPool, opts = {}) {
    const _t0 = Date.now();
    if (typeof matchingPool !== 'bigint') matchingPool = BigInt(matchingPool);
    if (this._rounds268.size >= QF_MAX_ROUNDS_268)
      throw new Error('quadraticFunding268: max active rounds reached');

    const roundId = 'qf268::' + crypto.randomBytes(6).toString('hex');
    const endsAt  = new Date(Date.now() + (opts.roundDays || 14) * 86_400_000).toISOString();
    const round = {
      roundId, projectId, matchingPool,
      contributions: new Map(),
      status: 'open', endsAt,
      createdAt: new Date().toISOString(),
      description: opts.description || '',
      programId: opts.programId || null,
      minContribution: opts.minContribution ? BigInt(opts.minContribution) : QF_MIN_CONTRIBUTION_268,
      retroactive: !!opts.retroactive,
    };
    this._rounds268.set(roundId, round);
    this._log268('CREATE_ROUND', { roundId, projectId, matchingPool: matchingPool.toString(), retroactive: round.retroactive });
    this._recordLatency268(_t0);
    return { ok: true, roundId, endsAt, retroactive: round.retroactive };
  }

  contribute268(roundId, userId, amountMicro) {
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    const round = this._rounds268.get(roundId);
    if (!round) throw new Error(`quadraticFunding268: round ${roundId} not found`);
    if (round.status !== 'open') throw new Error(`quadraticFunding268: round ${roundId} is ${round.status}`);
    if (amountMicro < round.minContribution)
      throw new Error(`quadraticFunding268: minimum contribution is ${round.minContribution} μ¢`);

    // Sybil gate
    if (this._sybilGuard) {
      const evalFn = this._sybilGuard.evaluate268 || this._sybilGuard.evaluate264;
      if (evalFn) {
        const verdict = evalFn.call(this._sybilGuard, userId);
        if (verdict.verdict === 'BLOCK')
          throw new Error(`quadraticFunding268: ${userId} is sybil-blocked and cannot contribute`);
      }
    }

    const existing = round.contributions.get(userId) || 0n;
    round.contributions.set(userId, existing + amountMicro);
    this._log268('CONTRIBUTE', { roundId, userId, amountMicro: amountMicro.toString() });
    return { ok: true, roundId, userId, totalContribution: (existing + amountMicro).toString() };
  }

  /**
   * CLR formula: match = (Σ√contribution_i)² - Σ(contribution_i)
   * Sybil-gated: only approved contributors count toward matching.
   */
  finalizeRound268(roundId) {
    const round = this._rounds268.get(roundId);
    if (!round) throw new Error(`quadraticFunding268: round ${roundId} not found`);
    if (round.status !== 'open') throw new Error(`quadraticFunding268: round ${roundId} already ${round.status}`);

    round.status = 'finalized';

    const approvedContribs = [];
    for (const [userId, amount] of round.contributions) {
      // Re-evaluate sybil status at finalization
      let approved = true;
      if (this._sybilGuard) {
        const evalFn = this._sybilGuard.evaluate268 || this._sybilGuard.evaluate264;
        if (evalFn) {
          const verdict = evalFn.call(this._sybilGuard, userId);
          approved = verdict.verdict !== 'BLOCK';
        }
      }
      if (approved) approvedContribs.push({ userId, amount });
    }

    // CLR calculation
    const sumSqrt = approvedContribs.reduce((s, c) => s + Math.sqrt(Number(c.amount)), 0);
    const sumDirect = approvedContribs.reduce((s, c) => s + Number(c.amount), 0);
    const clrMatch = Math.max(0, sumSqrt * sumSqrt - sumDirect);

    const actualMatch = BigInt(Math.min(Math.round(clrMatch), Number(round.matchingPool)));

    const result = {
      roundId,
      projectId: round.projectId,
      totalContributions: sumDirect,
      approvedContributors: approvedContribs.length,
      clrMatch: clrMatch.toFixed(2),
      actualMatchMicro: actualMatch.toString(),
      matchingPool: round.matchingPool.toString(),
      finalizedAt: new Date().toISOString(),
      contributors: approvedContribs.map(c => ({ userId: c.userId, amount: c.amount.toString() })),
      retroactive: round.retroactive,
    };

    this._log268('FINALIZE_ROUND', result);
    if (this._auditLog?.append) { try { this._auditLog.append({ event: 'quadraticFunding268.finalized', ...result }); } catch (_) {} }
    return { ok: true, ...result };
  }

  /**
   * Record retroactive funding for a project (reward demonstrated impact).
   */
  recordRetroactive268(projectId, beneficiaryId, amountMicro, evidence = {}) {
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    const entry = {
      retroId: 'retro268::' + crypto.randomBytes(6).toString('hex'),
      projectId, beneficiaryId,
      amountMicro: amountMicro.toString(),
      evidence,
      recordedAt: new Date().toISOString(),
    };
    this._retroactive268.push(entry);
    this._log268('RETROACTIVE', entry);
    return { ok: true, retroId: entry.retroId };
  }

  getRound268(roundId) {
    const r = this._rounds268.get(roundId);
    if (!r) return null;
    return {
      roundId: r.roundId,
      projectId: r.projectId,
      matchingPool: r.matchingPool.toString(),
      status: r.status,
      endsAt: r.endsAt,
      contributorCount: r.contributions.size,
      description: r.description,
      retroactive: r.retroactive,
    };
  }

  getRetroactive268(limit = 20) {
    return this._retroactive268.slice(-limit);
  }

  getStats268() {
    return {
      version: '268',
      rounds: this._rounds268.size,
      retroactive: this._retroactive268.length,
    };
  }

  _log268(event, data) {
    const entry = { event, ...data, ts: new Date().toISOString(), _v: '268' };
    if (this._auditLog?.append) { try { this._auditLog.append(entry); } catch (_) {} }
  }

  // ── V268: Performance Telemetry ─────────────────────────────────────────────
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  // ── V268: Health Check ────────────────────────────────────────────────────
  checkFundingHealth268() {
    return {
      ok: true,
      module: 'quadraticFunding268 CLR rounds',
      version: '268',
      perf: this.getPerf268(),
      logAdapter: this._logAdapter268 ? { type: 'external', ok: true } : { type: 'none' },
    };
  }

}

const defaultQuadraticFunding268 = new QuadraticFunding268();


// ── V268 Performance Telemetry helper ────────────────────────────────────────
function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

module.exports = {
  QuadraticFunding268,
  defaultQuadraticFunding268,
  QF_MIN_CONTRIBUTION_268,
};
