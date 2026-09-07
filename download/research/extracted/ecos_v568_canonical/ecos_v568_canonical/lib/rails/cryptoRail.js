'use strict';
/**
 * lib/rails/cryptoRail.js — ECOS payment rail: Crypto (stub, gated).
 * Guarded by ECOS_CRYPTO_ENABLED env flag. Zero npm deps. Mirrors manualRail pattern.
 */
class CryptoRail {
  constructor({ ledger, auditLog } = {}) {
    this.id = 'crypto';
    this.label = 'Crypto Rail (gated)';
    this.ledger = ledger || null;
    this.auditLog = auditLog || null;
    this.capabilities = { canDeposit: false, canWithdraw: false };
  }
  get isAvailable() { return process.env.ECOS_CRYPTO_ENABLED === '1'; }
  async deposit({ accountId, amountMicro, reference } = {}) {
    if (!this.isAvailable) return { ok: false, railId: 'crypto', reason: 'ECOS_CRYPTO_ENABLED not set' };
    if (!accountId) throw new Error('CryptoRail.deposit: accountId required');
    const amt = typeof amountMicro === 'bigint' ? amountMicro : BigInt(amountMicro);
    if (amt <= 0n) throw new RangeError('CryptoRail.deposit: amount must be > 0');
    if (this.ledger) this.ledger.credit(accountId, amt, { rail: 'crypto', reference: reference || null });
    if (this.auditLog && typeof this.auditLog.append === 'function') {
      await this.auditLog.append({ event: 'rail.deposit', rail: 'crypto', accountId, amountMicro: amt.toString(), reference: reference || null, at: new Date().toISOString() });
    }
    return { ok: true, railId: 'crypto', accountId, amountMicro: amt, reference: reference || null };
  }
  async withdraw({ accountId, amountMicro, reference } = {}) {
    if (!this.isAvailable) return { ok: false, railId: 'crypto', reason: 'ECOS_CRYPTO_ENABLED not set' };
    return { ok: false, railId: 'crypto', reason: 'crypto withdrawals require manual operator approval', reference: reference || null };
  }
}
module.exports = { CryptoRail };
