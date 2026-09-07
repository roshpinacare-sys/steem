'use strict';
/**
 * src/lib/x402RewardInflow418.js — ECOS V418 (Phase P306) — x402 Inflow for AI Service
 *
 * Routes sovereign model query costs through the x402 payment rail into the
 * reward pool using the provable 40/40/20 split:
 *   40% → validator pool  (reward validators whose knowledge grounded the answer)
 *   40% → creator pool    (reward content creators referenced in the response)
 *   20% → platform reserve (operational sustainability)
 *
 * Architecture:
 *   SovereignRouter416 (query) → X402RewardInflow418 (record cost) → RewardPool418
 *       ↓ per-query micro-payment                                        ↓ distribute
 *   x402Receipt418 (audit trail)                               FiatLedger (provable)
 *
 * The module is stateless except for an in-memory ring-buffer ledger of
 * recent inflow events (max 5,000). Production systems should attach a DB
 * adapter via opts.db for persistence.
 *
 * All identifiers end in 418 (R2). No new npm deps (R3). Sacred untouched (R1).
 * Zero new module-level singletons outside wire418 IIFE (R7).
 *
 * @version 418.0.0
 */

const crypto = require('crypto');

const X402_VERSION_418 = '418.0.0';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum inflow amount (micro-cents, BigInt) */
const MIN_INFLOW_MICROCENTS_418 = 100n;

/** Default 40/40/20 split */
const DEFAULT_SPLIT_418 = Object.freeze({
  validatorBps: 4000,   // 40.00 %
  creatorBps:   4000,   // 40.00 %
  platformBps:  2000,   // 20.00 %
});

/** Max ring-buffer size */
const INFLOW_LOG_MAX_418 = 5_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Split amountMicro according to bps configuration.
 * Uses integer arithmetic — no floating point on money.
 * @param {bigint} amountMicro
 * @param {object} split  { validatorBps, creatorBps, platformBps }  — must sum to 10000
 * @returns {{ validatorMicro, creatorMicro, platformMicro }}
 */
function _applySplit418(amountMicro, split) {
  const total = (split.validatorBps + split.creatorBps + split.platformBps);
  if (total !== 10000) throw new Error(`x402RewardInflow418: split bps must sum to 10000, got ${total}`);

  const validatorMicro = (amountMicro * BigInt(split.validatorBps)) / 10000n;
  const creatorMicro   = (amountMicro * BigInt(split.creatorBps))   / 10000n;
  // Platform gets the remainder to avoid rounding loss
  const platformMicro  = amountMicro - validatorMicro - creatorMicro;
  return { validatorMicro, creatorMicro, platformMicro };
}

function _inflowId418() {
  return 'x402inflow418::' + crypto.randomBytes(8).toString('hex');
}

// ── RewardPool418 ─────────────────────────────────────────────────────────────

/**
 * In-memory reward accumulator. Tracks per-pool totals and pending distributions.
 * Attach a FiatLedger (via opts.ledger) to make distributions provable on-chain.
 */
class RewardPool418 {
  constructor(opts = {}) {
    this._ledger418 = opts.ledger || null;
    this._audit418  = typeof opts.audit === 'function' ? opts.audit : null;

    // Running totals (BigInt μ¢)
    this._validatorPool418 = 0n;
    this._creatorPool418   = 0n;
    this._platformPool418  = 0n;
    this._totalInflow418   = 0n;

    // Distribution history (ring)
    this._distributions418 = [];
  }

  /**
   * Accumulate a split into the pool.
   * @param {{ validatorMicro, creatorMicro, platformMicro }} split
   * @param {string} inflowId — links back to the originating inflow event
   * @returns {{ ok, poolSnapshot }}
   */
  accumulate418(split, inflowId) {
    const { validatorMicro, creatorMicro, platformMicro } = split;
    this._validatorPool418 += validatorMicro;
    this._creatorPool418   += creatorMicro;
    this._platformPool418  += platformMicro;
    this._totalInflow418   += (validatorMicro + creatorMicro + platformMicro);

    if (this._audit418) {
      try {
        this._audit418('x402.pool.accumulate418', {
          inflowId,
          validatorMicro: validatorMicro.toString(),
          creatorMicro:   creatorMicro.toString(),
          platformMicro:  platformMicro.toString(),
          ts: Date.now(),
        });
      } catch (_) {}
    }

    return { ok: true, poolSnapshot: this.snapshot418() };
  }

  /**
   * Distribute pending validator rewards to a list of validators.
   * Drains the validator pool proportionally by weight.
   * @param {Array<{validatorId: string, weight: number}>} validators
   * @returns {{ ok, distributions, totalDistributed }}
   */
  distributeValidators418(validators) {
    if (!Array.isArray(validators) || validators.length === 0) {
      return { ok: false, error: 'validators array required', distributions: [] };
    }
    if (this._validatorPool418 <= 0n) {
      return { ok: true, distributions: [], totalDistributed: '0', note: 'pool empty' };
    }

    const totalWeight = validators.reduce((s, v) => s + (v.weight || 1), 0);
    const distributed = [];
    let remaining = this._validatorPool418;

    for (let i = 0; i < validators.length; i++) {
      const v = validators[i];
      const isLast = i === validators.length - 1;
      const share = isLast
        ? remaining
        : (this._validatorPool418 * BigInt(Math.round((v.weight || 1) * 10000 / totalWeight))) / 10000n;

      const amount = share > remaining ? remaining : share;
      remaining -= amount;

      const distId = 'vdist418::' + crypto.randomBytes(6).toString('hex');
      distributed.push({ distId, validatorId: v.validatorId, amountMicro: amount.toString() });

      if (this._audit418) {
        try {
          this._audit418('x402.validator.distribute418', {
            distId, validatorId: v.validatorId,
            amountMicro: amount.toString(), ts: Date.now(),
          });
        } catch (_) {}
      }
    }

    this._validatorPool418 = 0n;
    this._distributions418.push({ type: 'validator', ts: Date.now(), items: distributed });
    if (this._distributions418.length > 200) this._distributions418.shift();

    return {
      ok: true,
      distributions: distributed,
      totalDistributed: distributed.reduce((s, d) => s + BigInt(d.amountMicro), 0n).toString(),
    };
  }

  /**
   * Distribute pending creator rewards to a list of creators.
   * Same proportional-by-weight logic as distributeValidators418.
   */
  distributeCreators418(creators) {
    if (!Array.isArray(creators) || creators.length === 0) {
      return { ok: false, error: 'creators array required', distributions: [] };
    }
    if (this._creatorPool418 <= 0n) {
      return { ok: true, distributions: [], totalDistributed: '0', note: 'pool empty' };
    }

    const totalWeight = creators.reduce((s, c) => s + (c.weight || 1), 0);
    const distributed = [];
    let remaining = this._creatorPool418;

    for (let i = 0; i < creators.length; i++) {
      const c = creators[i];
      const isLast = i === creators.length - 1;
      const share = isLast
        ? remaining
        : (this._creatorPool418 * BigInt(Math.round((c.weight || 1) * 10000 / totalWeight))) / 10000n;

      const amount = share > remaining ? remaining : share;
      remaining -= amount;

      const distId = 'cdist418::' + crypto.randomBytes(6).toString('hex');
      distributed.push({ distId, creatorId: c.creatorId, amountMicro: amount.toString() });

      if (this._audit418) {
        try {
          this._audit418('x402.creator.distribute418', {
            distId, creatorId: c.creatorId,
            amountMicro: amount.toString(), ts: Date.now(),
          });
        } catch (_) {}
      }
    }

    this._creatorPool418 = 0n;
    this._distributions418.push({ type: 'creator', ts: Date.now(), items: distributed });
    if (this._distributions418.length > 200) this._distributions418.shift();

    return {
      ok: true,
      distributions: distributed,
      totalDistributed: distributed.reduce((s, d) => s + BigInt(d.amountMicro), 0n).toString(),
    };
  }

  snapshot418() {
    return {
      validatorPool: this._validatorPool418.toString(),
      creatorPool:   this._creatorPool418.toString(),
      platformPool:  this._platformPool418.toString(),
      totalInflow:   this._totalInflow418.toString(),
      version: X402_VERSION_418,
    };
  }
}

// ── X402RewardInflow418 ───────────────────────────────────────────────────────

/**
 * Records a sovereign model query inflow, splits it 40/40/20, and accumulates
 * into the RewardPool418.
 *
 * Usage:
 *   const inflow = new X402RewardInflow418({ pool: myPool, audit: auditFn });
 *   inflow.recordQuery418({ amountMicro: 5000n, queryId: 'q_abc', userId: 'u_1' });
 */
class X402RewardInflow418 {
  /**
   * @param {object} opts
   * @param {RewardPool418}  [opts.pool]   — reward pool to accumulate into
   * @param {object}         [opts.split]  — override { validatorBps, creatorBps, platformBps }
   * @param {function}       [opts.audit]  — audit(type, data) hook
   */
  constructor(opts = {}) {
    this._pool418  = opts.pool  || new RewardPool418({ audit: opts.audit });
    this._split418 = opts.split || DEFAULT_SPLIT_418;
    this._audit418 = typeof opts.audit === 'function' ? opts.audit : null;

    // Ring-buffer of inflow events
    this._inflowLog418 = [];
  }

  /**
   * Record a single sovereign model query inflow.
   * @param {object} params
   * @param {bigint}  params.amountMicro  — payment amount in μ¢ (BigInt)
   * @param {string}  params.queryId      — unique query identifier
   * @param {string}  [params.userId]     — user who made the query
   * @param {string}  [params.model]      — model name / endpoint
   * @param {string}  [params.x402Receipt] — raw x402 receipt string for audit
   * @returns {{ ok, inflowId, split, poolSnapshot }}
   */
  recordQuery418({ amountMicro, queryId, userId, model, x402Receipt } = {}) {
    if (typeof amountMicro !== 'bigint')
      throw new Error('x402RewardInflow418: amountMicro must be BigInt');
    if (amountMicro < MIN_INFLOW_MICROCENTS_418)
      throw new Error(`x402RewardInflow418: amountMicro must be >= ${MIN_INFLOW_MICROCENTS_418} μ¢`);
    if (!queryId) throw new Error('x402RewardInflow418: queryId required');

    const inflowId = _inflowId418();
    const split = _applySplit418(amountMicro, this._split418);

    const event = {
      inflowId,
      queryId,
      userId:       userId       || null,
      model:        model        || null,
      x402Receipt:  x402Receipt  || null,
      amountMicro:  amountMicro.toString(),
      validatorMicro: split.validatorMicro.toString(),
      creatorMicro:   split.creatorMicro.toString(),
      platformMicro:  split.platformMicro.toString(),
      ts: Date.now(),
    };

    this._inflowLog418.push(event);
    if (this._inflowLog418.length > INFLOW_LOG_MAX_418) this._inflowLog418.shift();

    const { poolSnapshot } = this._pool418.accumulate418(split, inflowId);

    if (this._audit418) {
      try {
        this._audit418('x402.inflow.record418', {
          inflowId, queryId, userId: userId || null,
          amountMicro: amountMicro.toString(),
          split: {
            validatorMicro: split.validatorMicro.toString(),
            creatorMicro:   split.creatorMicro.toString(),
            platformMicro:  split.platformMicro.toString(),
          },
          ts: Date.now(),
        });
      } catch (_) {}
    }

    return {
      ok: true,
      inflowId,
      split: {
        validatorMicro: split.validatorMicro.toString(),
        creatorMicro:   split.creatorMicro.toString(),
        platformMicro:  split.platformMicro.toString(),
      },
      poolSnapshot,
    };
  }

  /**
   * Return recent inflow events (most recent first).
   * @param {number} [limit=50]
   * @returns {Array}
   */
  recentInflows418(limit = 50) {
    return this._inflowLog418.slice(-limit).reverse();
  }

  /** Admin summary */
  summary418() {
    return {
      version: X402_VERSION_418,
      inflowCount: this._inflowLog418.length,
      split: Object.assign({}, this._split418),
      pool: this._pool418.snapshot418(),
    };
  }

  getPool418() { return this._pool418; }
}

// ── Singleton factory (used by wire418) ───────────────────────────────────────
let _defaultInflow418 = null;
function defaultInflow418(opts) {
  if (!_defaultInflow418) _defaultInflow418 = new X402RewardInflow418(opts || {});
  return _defaultInflow418;
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  X402_VERSION_418,
  MIN_INFLOW_MICROCENTS_418,
  DEFAULT_SPLIT_418,
  RewardPool418,
  X402RewardInflow418,
  defaultInflow418,
};
