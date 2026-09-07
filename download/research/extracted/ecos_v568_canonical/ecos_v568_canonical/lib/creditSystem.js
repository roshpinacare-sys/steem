'use strict';

/**
 * CreditSystem — ECOS Credit presentation and rules layer on top of fiatLedger.
 *
 * 1 ECOS Credit = 10,000 microcents = displayed as "1.00 ⊙"
 * Storage stays in the ledger (BigInt microcents).
 * This module is DISPLAY + RULES only — never uses floats for balances.
 *
 * V111 — Sovereign Economy
 */

const path   = require('path');
const crypto = require('crypto');

const MICROCENTS_PER_CREDIT = 10_000n; // 1 Credit = 10,000 μ¢

class CreditSystem {
  constructor({ ledger, auditLog, logger } = {}) {
    if (!ledger) throw new Error('CreditSystem requires a ledger instance');
    this._ledger     = ledger;
    this._auditLog   = auditLog || null;
    this._logger     = logger  || console;
    this._pricing    = this._loadPricing();
    this._freeTierDb = new Map(); // accountId → { granted, grantedAt }
  }

  _loadPricing() {
    try {
      return require(path.join(__dirname, '../config/pricing.json'));
    } catch (e) {
      return {
        autoFlowTask: 1.0, humanValidation: 5.0, priorityValidation: 10.0,
        patchAuthorRoyaltyRate: 0.10, freeTierGrant: 100.0, referralBonus: 25.0,
      };
    }
  }

  // ── Conversion helpers ─────────────────────────────────────────────────────

  /**
   * Credits (number) → microcents (BigInt). BigInt-safe.
   * @param {number} credits
   * @returns {bigint}
   */
  creditsToMicro(credits) {
    // Multiply by 10000 using integer math to avoid float imprecision
    const whole = Math.floor(credits);
    const frac  = Math.round((credits - whole) * 10000);
    return BigInt(whole) * MICROCENTS_PER_CREDIT + BigInt(frac);
  }

  /**
   * Microcents (BigInt or number) → credits (number). For DISPLAY ONLY.
   * @param {bigint|number} micro
   * @returns {number}
   */
  microToCredits(micro) {
    return Number(micro) / 10_000;
  }

  // ── Free tier ──────────────────────────────────────────────────────────────

  /**
   * Grant monthly free credits to a new or active account.
   * Default: 100 free credits on signup, refreshable monthly.
   */
  async grantFreeTier(accountId, { reason = 'free_tier_grant' } = {}) {
    const grantCredits = this._pricing.freeTierGrant || 100.0;
    const micro        = this.creditsToMicro(grantCredits);

    this._ledger.credit(accountId, micro);

    const now = new Date();
    const refreshesAt = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    this._freeTierDb.set(accountId, {
      granted:     grantCredits,
      grantedAt:   now.toISOString(),
      refreshesAt: refreshesAt.toISOString(),
    });

    if (this._auditLog) {
      try {
        await this._auditLog.append({
          event:      'credits.free_tier_grant',
          accountId,
          credits:    grantCredits,
          micro:      micro.toString(),
          reason,
          grantedAt:  now.toISOString(),
        });
      } catch (_) {}
    }

    return { ok: true, accountId, credits: grantCredits, micro };
  }

  /**
   * Spend credits for an action. Throws if insufficient balance.
   * @returns {{ ok: boolean, newBalance: number }}
   */
  async spend(accountId, amountCredits, { purpose = 'spend', missionId = null } = {}) {
    const micro   = this.creditsToMicro(amountCredits);
    const current = this._ledger.balance(accountId);
    if (current < micro) {
      throw new Error(
        `Insufficient balance: need ${amountCredits} ⊙ (${micro} μ¢), ` +
        `have ${this.microToCredits(current).toFixed(4)} ⊙`
      );
    }

    this._ledger.debit(accountId, micro);
    const newBalance = this.microToCredits(this._ledger.balance(accountId));

    if (this._auditLog) {
      try {
        await this._auditLog.append({
          event:      'credits.spend',
          accountId,
          credits:    amountCredits,
          micro:      micro.toString(),
          purpose,
          missionId,
        });
      } catch (_) {}
    }

    return { ok: true, newBalance };
  }

  /**
   * Earn credits (validator payout, royalty, referral bonus).
   * @returns {{ ok: boolean, newBalance: number }}
   */
  async earn(accountId, amountCredits, { source = 'earn', ref = null } = {}) {
    const micro = this.creditsToMicro(amountCredits);
    this._ledger.credit(accountId, micro);
    const newBalance = this.microToCredits(this._ledger.balance(accountId));

    if (this._auditLog) {
      try {
        await this._auditLog.append({
          event:   'credits.earn',
          accountId,
          credits: amountCredits,
          micro:   micro.toString(),
          source,
          ref,
        });
      } catch (_) {}
    }

    return { ok: true, newBalance };
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * @param {string} accountId
   * @returns {number} balance in credits (float, display only)
   */
  balanceCredits(accountId) {
    return this.microToCredits(this._ledger.balance(accountId));
  }

  /**
   * @param {string} accountId
   * @returns {{ granted: number, remaining: number, refreshesAt: string }}
   */
  freeTierStatus(accountId) {
    const rec = this._freeTierDb.get(accountId);
    if (!rec) {
      return { granted: 0, remaining: 0, refreshesAt: null };
    }
    const current   = this.balanceCredits(accountId);
    const remaining = Math.max(0, Math.min(rec.granted, current));
    return {
      granted:     rec.granted,
      remaining,
      refreshesAt: rec.refreshesAt,
    };
  }

  get pricing() { return { ...this._pricing }; }
}

module.exports = { CreditSystem, MICROCENTS_PER_CREDIT };
