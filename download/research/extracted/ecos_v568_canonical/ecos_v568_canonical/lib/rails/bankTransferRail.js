'use strict';
/**
 * lib/rails/bankTransferRail.js — ECOS payment rail: Bank transfer (manual settlement).
 * Available by default; deposits credit the ledger once a transfer reference is recorded.
 */
class BankTransferRail {
  constructor({ ledger, auditLog } = {}) {
    this.id = 'bank';
    this.label = 'Bank transfer';
    this.ledger = ledger || null;
    this.auditLog = auditLog || null;
    this.capabilities = { canDeposit: true, canWithdraw: true };
  }
  get isAvailable() { return true; }
  async deposit({ accountId, amountMicro, reference } = {}) {
    if (!this.ledger) throw new Error('BankTransferRail.deposit: no ledger');
    const amt = typeof amountMicro === 'bigint' ? amountMicro : BigInt(amountMicro);
    if (amt <= 0n) throw new RangeError('BankTransferRail.deposit: amount must be > 0');
    this.ledger.credit(accountId, amt, { rail: 'bank', reference: reference || null });
    if (this.auditLog && typeof this.auditLog.append === 'function') { await this.auditLog.append({ event: 'rail.deposit', rail: 'bank', accountId, amountMicro: amt.toString(), reference: reference || null, at: new Date().toISOString() }); }
    return { ok: true, railId: 'bank', accountId, amountMicro: amt, reference: reference || null };
  }
}
module.exports = { BankTransferRail };
