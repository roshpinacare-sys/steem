'use strict';
/**
 * lib/rails/stripeRail.js — ECOS payment rail: Stripe.
 * Available only when STRIPE_API_KEY is set (so offline/default it is unavailable, by design).
 * Deposit here represents an external settlement that, once confirmed, credits the ledger.
 */
class StripeRail {
  constructor({ ledger, apiKey, auditLog } = {}) {
    this.id = 'stripe';
    this.label = 'Stripe';
    this.ledger = ledger || null;
    this.auditLog = auditLog || null;
    this.apiKey = apiKey || process.env.STRIPE_API_KEY || null;
    this.capabilities = { canDeposit: true, canWithdraw: true };
  }
  get isAvailable() { return !!(this.apiKey || process.env.STRIPE_API_KEY); }
  async deposit({ accountId, amountMicro, reference } = {}) {
    if (!this.isAvailable) throw new Error('StripeRail.deposit: unavailable (no STRIPE_API_KEY)');
    if (!this.ledger) throw new Error('StripeRail.deposit: no ledger');
    const amt = typeof amountMicro === 'bigint' ? amountMicro : BigInt(amountMicro);
    if (amt <= 0n) throw new RangeError('StripeRail.deposit: amount must be > 0');
    this.ledger.credit(accountId, amt, { rail: 'stripe', reference: reference || null });
    if (this.auditLog && typeof this.auditLog.append === 'function') { await this.auditLog.append({ event: 'rail.deposit', rail: 'stripe', accountId, amountMicro: amt.toString(), reference: reference || null, at: new Date().toISOString() }); }
    return { ok: true, railId: 'stripe', accountId, amountMicro: amt, reference: reference || null };
  }
}
module.exports = { StripeRail };
