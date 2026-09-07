'use strict';
/**
 * src/lib/splitModule268.js — 0xSplits-Style Revenue Splitting (V268)
 *
 * V268 additions over V266:
 *   - antiDumpProvider and vestingProvider interface validation at construction
 *   - Performance telemetry: `.getPerf268()` with distribute latency percentiles
 *   - `checkProviderHealth268()`: probe both provider interfaces
 *
 * PROGRAM 08: Collaboration Economy
 * Zero new npm deps. Identifiers end with 268.
 */
'use strict';

const crypto = require('node:crypto');

const BPS_TOTAL_268          = 10_000n;
const VESTING_MIN_DAYS_268   = 365;   // ≥ 12 months mandatory
const SPLIT_40_EXECUTOR_268  = 4_000n; // 40% to executor
const SPLIT_40_PLATFORM_268  = 4_000n; // 40% to platform
const SPLIT_20_CONNECTORS_268 = 2_000n; // 20% to connectors

function _calcPercentiles268(arr) {
  if (!arr || arr.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (pct) => sorted[Math.min(Math.floor(n * pct / 100), n - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: n };
}

class SplitModule268 {
  constructor(opts = {}) {
    this._logger        = opts.logger        || console;
    this._auditLog      = opts.auditLog      || null;
    this._logAdapter268 = opts.logAdapter || null;
    this._reserve       = opts.creditReserve || null;
    this._agentReceipts = opts.agentReceipts || null;
    // V268: validate antiDumpProvider interface
    if (opts.antiDumpProvider !== null && opts.antiDumpProvider !== undefined) {
      if (typeof opts.antiDumpProvider.evaluateDumpRisk !== 'function') {
        throw new Error('splitModule268: antiDumpProvider must implement evaluateDumpRisk(splitId, amountMicro, policy, totalDistributed, meta)');
      }
    }
    this._antiDumpProvider = opts.antiDumpProvider || null;
    // V268: validate vestingProvider interface
    if (opts.vestingProvider !== null && opts.vestingProvider !== undefined) {
      if (typeof opts.vestingProvider.validateVesting !== 'function') {
        throw new Error('splitModule268: vestingProvider must implement validateVesting(vestingDays, enforceVesting)');
      }
    }
    this._vestingProvider = opts.vestingProvider || null;
    this._splits268     = new Map();
    this._vestingSchedules268 = new Map();
    this._antiDumpEvents268 = new Map();
    this._stats268      = { created: 0, distributed: 0n, vested: 0n, antiDumpFlags: 0 };
    // V268: perf tracking
    this._perf268 = { latencies: [] };
  }

  // ── 40/40/20 Primary Split ────────────────────────────────────────────────

  /**
   * Apply the canonical 40/40/20 split to a realized value.
   * Asserts reserve backing before executing.
   * @param {string} missionId
   * @param {bigint} totalMicro — total realized value in μ¢
   * @param {object} opts — { executorId, platformId, connectorIds[], missionId }
   */
  applyPrimarysplit268(missionId, totalMicro, opts = {}) {
    if (typeof totalMicro !== 'bigint') totalMicro = BigInt(totalMicro);

    // Assert reserve backing (iron rule: 40/40/20 operates ONLY on realized value)
    if (this._reserve?.assertRealizedValue268) {
      this._reserve.assertRealizedValue268(totalMicro);
    } else if (this._reserve?.assertRealizedValue264) {
      this._reserve.assertRealizedValue264(totalMicro);
    }

    const executorMicro    = (totalMicro * SPLIT_40_EXECUTOR_268)   / BPS_TOTAL_268;
    const platformMicro    = (totalMicro * SPLIT_40_PLATFORM_268)   / BPS_TOTAL_268;
    const connectorsMicro  = (totalMicro * SPLIT_20_CONNECTORS_268) / BPS_TOTAL_268;

    const splitResult = {
      missionId,
      totalMicro:       totalMicro.toString(),
      executorMicro:    executorMicro.toString(),
      platformMicro:    platformMicro.toString(),
      connectorsMicro:  connectorsMicro.toString(),
      executorId:       opts.executorId   || null,
      connectorIds:     opts.connectorIds || [],
      ts: new Date().toISOString(),
    };

    // Emit into mandate chain
    if (this._agentReceipts?.emitSplit268) {
      try { this._agentReceipts.emitSplit268(missionId, splitResult); } catch (_) {}
    }

    this._stats268.distributed += totalMicro;
    this._log268('PRIMARY_SPLIT', splitResult);
    return splitResult;
  }

  // ── Collaboration Split Table ─────────────────────────────────────────────

  /**
   * Create a split table (sub-split of executor's 40%).
   */
  createSplit268(creatorId, recipients, opts = {}) {
    const totalBps = recipients.reduce((s, r) => s + BigInt(r.bps), 0n);
    if (totalBps !== BPS_TOTAL_268)
      throw new Error(`splitModule268: recipients must sum to 10,000 bps, got ${totalBps}`);
    if (recipients.some(r => r.bps <= 0))
      throw new Error('splitModule268: all recipient bps must be > 0');

    // Vesting enforcement (delegated to provider if available)
    const vestingDays = opts.vestingDays || 0;
    if (this._vestingProvider?.validateVesting) {
      this._vestingProvider.validateVesting(vestingDays, opts.enforceVesting);
    } else if (opts.enforceVesting && vestingDays < VESTING_MIN_DAYS_268) {
      throw new Error(`splitModule268: vesting period must be ≥ ${VESTING_MIN_DAYS_268} days`);
    }

    const splitId = 'split268::' + crypto.randomBytes(6).toString('hex');
    const split = {
      splitId, creatorId,
      recipients: recipients.map(r => ({
        userId: r.userId, bps: BigInt(r.bps),
        accumulated: 0n, vested: 0n,
      })),
      waterfall:    !!opts.waterfall,
      vestingDays:  vestingDays,
      enforceVesting: !!opts.enforceVesting,
      antiDumpPolicy: opts.antiDumpPolicy || { maxImmediateBps: 2_500, reviewWindowDays: 30 },
      parentSplitId: opts.parentSplitId || null,
      programId:    opts.programId || null,
      createdAt:    new Date().toISOString(),
      totalDistributed: 0n,
    };

    this._splits268.set(splitId, split);
    this._stats268.created++;

    if (vestingDays > 0) {
      if (this._vestingProvider?.createVestingSchedule) {
        this._vestingProvider.createVestingSchedule(splitId, vestingDays, opts.cliffDays);
      } else {
        this._vestingSchedules268.set(splitId, {
          startDate: new Date().toISOString(),
          vestingDays,
          vestingStartMs: Date.now(),
          cliffDays: opts.cliffDays || 0,
        });
      }
    }

    this._antiDumpEvents268.set(splitId, []);
    this._log268('CREATE_SPLIT', { splitId, creatorId, recipientCount: recipients.length, vestingDays, antiDumpPolicy: split.antiDumpPolicy });
    if (this._auditLog?.append) { try { this._auditLog.append({ event: 'splitModule268.create', splitId, creatorId, recipients: recipients.map(r => ({ userId: r.userId, bps: r.bps.toString() })) }); } catch (_) {} }

    return { ok: true, splitId, split: this._toPublic268(split) };
  }

  /**
   * Distribute an amount through a split table.
   */
  distribute268(splitId, amountMicro, meta = {}) {
    const _t0 = Date.now();
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    const split = this._splits268.get(splitId);
    if (!split) throw new Error(`splitModule268: split ${splitId} not found`);

    if (this._reserve?.assertRealizedValue268) {
      this._reserve.assertRealizedValue268(amountMicro);
    }

    const antiDump = this.evaluateDumpRisk268(splitId, amountMicro, meta);
    if (antiDump.flagged && meta.blockOnDumpRisk) {
      throw new Error(`splitModule268: anti-dump review required (${antiDump.reason})`);
    }

    // Vesting check (delegated to provider if available)
    if (split.enforceVesting && split.vestingDays > 0) {
      if (this._vestingProvider?.getVestedAmount) {
        const vestedResult = this._vestingProvider.getVestedAmount(splitId, amountMicro);
        if (vestedResult.error) throw new Error(`splitModule268: vesting error (${vestedResult.error})`);
        amountMicro = vestedResult.vestedAmount;
      } else {
        const vsch = this._vestingSchedules268.get(splitId);
        if (vsch) {
          const elapsedDays = (Date.now() - vsch.vestingStartMs) / (24 * 3600_000);
          if (elapsedDays < vsch.cliffDays)
            throw new Error(`splitModule268: cliff period (${vsch.cliffDays}d) not yet passed (elapsed: ${Math.round(elapsedDays)}d)`);
          const vestedFraction = Math.min(1, elapsedDays / split.vestingDays);
          amountMicro = BigInt(Math.floor(Number(amountMicro) * vestedFraction));
        }
      }
    }

    const distributions = [];

    if (split.waterfall) {
      let remaining = amountMicro;
      for (const r of split.recipients) {
        if (remaining <= 0n) break;
        const share = remaining < (amountMicro * r.bps / BPS_TOTAL_268)
          ? remaining
          : amountMicro * r.bps / BPS_TOTAL_268;
        r.accumulated += share;
        remaining -= share;
        distributions.push({ userId: r.userId, amountMicro: share.toString(), mode: 'waterfall' });
      }
    } else {
      for (const r of split.recipients) {
        const share = amountMicro * r.bps / BPS_TOTAL_268;
        r.accumulated += share;
        distributions.push({ userId: r.userId, amountMicro: share.toString(), mode: 'pro_rata' });
      }
    }

    split.totalDistributed += amountMicro;
    this._stats268.distributed += amountMicro;

    this._log268('DISTRIBUTE', { splitId, amountMicro: amountMicro.toString(), recipientCount: distributions.length });
    if (this._auditLog?.append) { try { this._auditLog.append({ event: 'splitModule268.distribute', splitId, amountMicro: amountMicro.toString(), distributions }); } catch (_) {} }

    this._recordLatency268(_t0);
    return { ok: true, splitId, distributions, totalDistributed: split.totalDistributed.toString(), antiDump };
  }

  getSplit268(splitId) {
    const s = this._splits268.get(splitId);
    return s ? this._toPublic268(s) : null;
  }

  getVestingStatus268(splitId) {
    if (this._vestingProvider?.getVestingStatus) {
      return this._vestingProvider.getVestingStatus(splitId);
    } else {
      const vsch = this._vestingSchedules268.get(splitId);
      if (!vsch) return null;
      const elapsedDays = (Date.now() - vsch.vestingStartMs) / (24 * 3600_000);
      const vestedFraction = Math.min(1, elapsedDays / vsch.vestingDays);
      return {
        splitId, vestingDays: vsch.vestingDays,
        elapsedDays: Math.round(elapsedDays * 10) / 10,
        vestedFraction: Math.round(vestedFraction * 1000) / 1000,
        vestedPct: Math.round(vestedFraction * 100 * 10) / 10,
        cliffDays: vsch.cliffDays,
        cliffPassed: elapsedDays >= vsch.cliffDays,
        antiDumpEvents: (this._antiDumpEvents268.get(splitId) || []).length,
      };
    }
  }

  evaluateDumpRisk268(splitId, amountMicro, meta = {}) {
    if (typeof amountMicro !== 'bigint') amountMicro = BigInt(amountMicro);
    const split = this._splits268.get(splitId);
    if (!split) throw new Error(`splitModule268: split ${splitId} not found`);

    if (this._antiDumpProvider?.evaluateDumpRisk) {
      const result = this._antiDumpProvider.evaluateDumpRisk(splitId, amountMicro, split.antiDumpPolicy, split.totalDistributed, meta);
      if (result.flagged) {
        const events = this._antiDumpEvents268.get(splitId) || [];
        events.push({ ...result, amountMicro: amountMicro.toString(), ts: new Date().toISOString(), meta });
        this._antiDumpEvents268.set(splitId, events.slice(-500));
        this._stats268.antiDumpFlags++;
        this._log268('ANTI_DUMP_FLAG', result);
      }
      return result;
    } else {
      const policy = split.antiDumpPolicy || { maxImmediateBps: 2_500, reviewWindowDays: 30 };
      const totalAfter = split.totalDistributed + amountMicro;
      const immediateBps = totalAfter === 0n ? 0 : Number((amountMicro * BPS_TOTAL_268) / totalAfter);
      const vesting = this.getVestingStatus268(splitId);
      const cliffBlocked = !!vesting && !vesting.cliffPassed;
      const exceedsImmediate = immediateBps > Number(policy.maxImmediateBps || 2_500);
      const flagged = !!meta.withdrawalRequest || !!meta.transferRequest || cliffBlocked || exceedsImmediate;
      const reason = cliffBlocked ? 'cliff_not_passed' : exceedsImmediate ? 'immediate_amount_above_policy' : flagged ? 'withdrawal_or_transfer_review' : 'ok';
      const result = { flagged, reason, immediateBps, maxImmediateBps: Number(policy.maxImmediateBps || 2_500), cliffBlocked, splitId };
      if (flagged) {
        const events = this._antiDumpEvents268.get(splitId) || [];
        events.push({ ...result, amountMicro: amountMicro.toString(), ts: new Date().toISOString(), meta });
        this._antiDumpEvents268.set(splitId, events.slice(-500));
        this._stats268.antiDumpFlags++;
        this._log268('ANTI_DUMP_FLAG', result);
      }
      return result;
    }
  }

  getAntiDumpEvents268(splitId) { return (this._antiDumpEvents268.get(splitId) || []).slice(); }

  getMobileSplit268(splitId) {
    const s = this._splits268.get(splitId);
    if (!s) return null;
    return {
      id: splitId, n: s.recipients.length,
      td: s.totalDistributed.toString(),
      wf: s.waterfall,
      vd: s.vestingDays,
    };
  }

  getStats268() {
    return {
      version: '268',
      created: this._stats268.created,
      totalDistributed: this._stats268.distributed.toString(),
      totalVested: this._stats268.vested.toString(),
      antiDumpFlags: this._stats268.antiDumpFlags,
      splitCount: this._splits268.size,
    };
  }

  /** V268: Performance telemetry */
  getPerf268() { return _calcPercentiles268(this._perf268.latencies); }

  /** V268: Check provider health */
  checkProviderHealth268() {
    return {
      ok: true,
      antiDumpProvider: this._antiDumpProvider
        ? { ok: typeof this._antiDumpProvider.evaluateDumpRisk === 'function', type: 'external' }
        : { ok: true, type: 'stub' },
      vestingProvider: this._vestingProvider
        ? { ok: typeof this._vestingProvider.validateVesting === 'function', type: 'external' }
        : { ok: true, type: 'stub' },
    };
  }

  _recordLatency268(t0) {
    const ms = Date.now() - t0;
    this._perf268.latencies.push(ms);
    if (this._perf268.latencies.length > 1000) this._perf268.latencies.shift();
  }

  _toPublic268(split) {
    return {
      splitId:    split.splitId,
      creatorId:  split.creatorId,
      recipients: split.recipients.map(r => ({
        userId: r.userId,
        bps: r.bps.toString(),
        accumulated: r.accumulated.toString(),
        vested: r.vested.toString(),
      })),
      waterfall:        split.waterfall,
      vestingDays:      split.vestingDays,
      enforceVesting:   split.enforceVesting,
      antiDumpPolicy:   split.antiDumpPolicy,
      antiDumpEvents:   (this._antiDumpEvents268.get(split.splitId) || []).length,
      parentSplitId:    split.parentSplitId,
      programId:        split.programId,
      createdAt:        split.createdAt,
      totalDistributed: split.totalDistributed.toString(),
    };
  }

  _log268(event, data) {
    const entry = { event, ...data, ts: new Date().toISOString(), _v: '268' };
    if (this._auditLog?.append) { try { this._auditLog.append(entry); } catch (_) {} }
  }
}

const defaultSplitModule268 = new SplitModule268();

module.exports = {
  SplitModule268,
  defaultSplitModule268,
  BPS_TOTAL_268,
  VESTING_MIN_DAYS_268,
  SPLIT_40_EXECUTOR_268,
  SPLIT_40_PLATFORM_268,
  SPLIT_20_CONNECTORS_268,
};
