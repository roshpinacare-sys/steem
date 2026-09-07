'use strict';
/**
 * lib/rails/manualRail.js — ECOS payment rail: Manual (internal ledger credit).
 * Completes the rails/ subsystem that railRegistry.js + paymentRail.test.js expect.
 * Always available. Deposit credits the internal FiatLedger (SACRED) via its public API.
 */
class ManualRail {
  constructor({ ledger, auditLog } = {}) {
    this.id = 'manual';
    this.label = 'Manual (internal ledger)';
    this.ledger = ledger || null;
    this.auditLog = auditLog || null;
    this.capabilities = { canDeposit: true, canWithdraw: false };
  }
  get isAvailable() { return true; }
  async deposit({ accountId, amountMicro, reference } = {}) {
    if (!this.ledger) throw new Error('ManualRail.deposit: no ledger');
    if (typeof accountId !== 'string' || !accountId) throw new Error('ManualRail.deposit: accountId required');
    const amt = typeof amountMicro === 'bigint' ? amountMicro : BigInt(amountMicro);
    if (amt <= 0n) throw new RangeError('ManualRail.deposit: amount must be > 0');
    this.ledger.credit(accountId, amt, { rail: 'manual', reference: reference || null });
    if (this.auditLog && typeof this.auditLog.append === 'function') { await this.auditLog.append({ event: 'rail.deposit', rail: 'manual', accountId, amountMicro: amt.toString(), reference: reference || null, at: new Date().toISOString() }); }
    return { ok: true, railId: 'manual', accountId, amountMicro: amt, reference: reference || null };
  }
}
module.exports = { ManualRail };
