/**
   * lib/tokenBurnScheduler209.js — ECOS V209
   * Token Burn Scheduler: 10% of platform's 40% share buys-and-burns protocol token
   * Research: FTX/Terra/Celsius autopsy — deflationary protocol health mechanism
   */
  'use strict';

  const PLATFORM_SHARE_PCT_209 = 0.40;      // 40% platform share
  const BURN_ALLOCATION_PCT_209 = 0.10;     // 10% of platform share → burn
  const BURN_PERIOD_MS_209      = 7 * 24 * 60 * 60 * 1000; // 7-day burn cycle
  const MIN_BURN_AMOUNT_USD_209 = 1.0;      // minimum $1 USD to trigger burn
  const MAX_BURN_QUEUE_209      = 52;       // max ~1 year of scheduled burns in queue

  class BurnValidationError209 extends Error {
    constructor(message) {
      super(message);
      this.name = 'BurnValidationError209';
      this.statusCode = 400;
      this.code = 'BURN_VALIDATION_ERROR_209';
    }
  }

  // In-memory burn queue: { id, scheduledAt, amountUsd, status, txHash, executedAt }
  const _burnQueue209 = [];
  let _burnCounter209 = 0;

  /**
   * computeBurnAmount209 — how much USD to allocate for the next burn cycle.
   * @param {object} params
   * @param {number} params.totalRevenueUsd   — total platform revenue for the period
   * @param {number} [params.platformSharePct] — override (default 40%)
   * @param {number} [params.burnAllocationPct] — override (default 10%)
   * @returns {{ platformShare, burnAmount, periodRevenue, belowMinimum }}
   */
  function computeBurnAmount209(params) {
    if (!params || typeof params !== 'object') {
      throw new BurnValidationError209('params must be an object');
    }
    const { totalRevenueUsd } = params;
    if (typeof totalRevenueUsd !== 'number' || isNaN(totalRevenueUsd) || totalRevenueUsd < 0) {
      throw new BurnValidationError209('totalRevenueUsd must be a non-negative number');
    }
    const platformPct  = typeof params.platformSharePct   === 'number' ? params.platformSharePct  : PLATFORM_SHARE_PCT_209;
    const burnPct      = typeof params.burnAllocationPct  === 'number' ? params.burnAllocationPct : BURN_ALLOCATION_PCT_209;
    const platformShare = totalRevenueUsd * platformPct;
    const burnAmount    = platformShare   * burnPct;
    return {
      periodRevenue: totalRevenueUsd,
      platformShare: +platformShare.toFixed(6),
      burnAmount:    +burnAmount.toFixed(6),
      platformSharePct: platformPct,
      burnAllocationPct: burnPct,
      belowMinimum: burnAmount < MIN_BURN_AMOUNT_USD_209,
    };
  }

  /**
   * scheduleBurn209 — queue a new burn event.
   * @param {object} params
   * @param {number} params.amountUsd
   * @param {string} [params.periodStart]  ISO date
   * @param {string} [params.periodEnd]    ISO date
   */
  function scheduleBurn209(params) {
    if (!params || typeof params !== 'object') {
      throw new BurnValidationError209('params required');
    }
    const { amountUsd } = params;
    if (typeof amountUsd !== 'number' || isNaN(amountUsd) || amountUsd <= 0) {
      throw new BurnValidationError209('amountUsd must be a positive number');
    }
    if (amountUsd < MIN_BURN_AMOUNT_USD_209) {
      throw new BurnValidationError209(`amountUsd ${amountUsd} below minimum ${MIN_BURN_AMOUNT_USD_209}`);
    }
    if (_burnQueue209.length >= MAX_BURN_QUEUE_209) {
      throw new BurnValidationError209(`Burn queue full (max ${MAX_BURN_QUEUE_209} items)`);
    }
    const entry = {
      id: `burn-${++_burnCounter209}-${Date.now()}`,
      amountUsd: +amountUsd.toFixed(6),
      scheduledAt: new Date().toISOString(),
      periodStart: params.periodStart || null,
      periodEnd:   params.periodEnd   || null,
      status: 'pending',
      txHash: null,
      executedAt: null,
    };
    _burnQueue209.push(entry);
    return { ok: true, burn: entry, queueDepth: _burnQueue209.length };
  }

  /**
   * executeBurn209 — mark a queued burn as executed (stub: real on-chain tx handled externally).
   */
  function executeBurn209(burnId, txHash) {
    if (!burnId) throw new BurnValidationError209('burnId required');
    const entry = _burnQueue209.find(b => b.id === burnId);
    if (!entry) {
      const err = new BurnValidationError209(`Burn ${burnId} not found`);
      err.code = 'BURN_NOT_FOUND_209';
      err.statusCode = 404;
      throw err;
    }
    if (entry.status !== 'pending') {
      throw new BurnValidationError209(`Burn ${burnId} already ${entry.status}`);
    }
    entry.status     = 'executed';
    entry.txHash     = txHash || `0x${Date.now().toString(16).padStart(64, '0')}`;
    entry.executedAt = new Date().toISOString();
    return { ok: true, burn: entry };
  }

  /**
   * getBurnStats209 — aggregate stats on the burn queue.
   */
  function getBurnStats209() {
    const pending  = _burnQueue209.filter(b => b.status === 'pending');
    const executed = _burnQueue209.filter(b => b.status === 'executed');
    const totalExecutedUsd = executed.reduce((s, b) => s + b.amountUsd, 0);
    const totalPendingUsd  = pending.reduce((s, b)  => s + b.amountUsd, 0);
    return {
      totalBurns: _burnQueue209.length,
      pendingBurns: pending.length,
      executedBurns: executed.length,
      totalExecutedUsd: +totalExecutedUsd.toFixed(6),
      totalPendingUsd:  +totalPendingUsd.toFixed(6),
      burnPeriodMs: BURN_PERIOD_MS_209,
      burnAllocationPct: BURN_ALLOCATION_PCT_209,
      platformSharePct: PLATFORM_SHARE_PCT_209,
      minBurnAmountUsd: MIN_BURN_AMOUNT_USD_209,
    };
  }

  module.exports = {
    computeBurnAmount209,
    scheduleBurn209,
    executeBurn209,
    getBurnStats209,
    BurnValidationError209,
    BURN_ALLOCATION_PCT_209,
    PLATFORM_SHARE_PCT_209,
    BURN_PERIOD_MS_209,
    MIN_BURN_AMOUNT_USD_209,
    _burnQueue209,
  };
  