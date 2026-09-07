'use strict';

/**
 * PaymentRail — Base class for all money movement abstractions.
 * Sits ABOVE fiatLedger.js. Never modifies the ledger directly;
 * calls the existing ledger functions (deposit, debit, balance).
 *
 * V111 — Sovereign Economy
 */

class PaymentRail {
  /** @returns {string} 'manual' | 'stripe' | 'bank' | 'crypto' */
  get id() { throw new Error('PaymentRail.id must be overridden'); }

  /** @returns {string} Human-readable display name */
  get displayName() { throw new Error('PaymentRail.displayName must be overridden'); }

  /**
   * @returns {boolean} Whether this rail can operate given current env/config
   */
  get isAvailable() { throw new Error('PaymentRail.isAvailable must be overridden'); }

  /**
   * @returns {{ canDeposit: boolean, canWithdraw: boolean, instant: boolean, regions: string[] }}
   */
  get capabilities() { throw new Error('PaymentRail.capabilities must be overridden'); }

  /**
   * Move external value IN → credit the internal ledger.
   * @param {{ accountId: string, amountMicro: bigint, reference: string, metadata: object }} params
   * @returns {Promise<{ ok: boolean, railId: string, externalRef: string, amountMicro: bigint, ledgerEntryHash?: string }>}
   */
  async deposit({ accountId, amountMicro, reference, metadata }) {
    throw new Error('PaymentRail.deposit must be overridden');
  }

  /**
   * Move internal credits OUT → debit ledger, send externally.
   * @param {{ accountId: string, amountMicro: bigint, destination: string, metadata: object }} params
   * @returns {Promise<{ ok: boolean, railId: string, externalRef: string, amountMicro: bigint }>}
   */
  async withdraw({ accountId, amountMicro, destination, metadata }) {
    throw new Error('PaymentRail.withdraw must be overridden');
  }

  /**
   * Check the status of a pending transfer.
   * @param {string} externalRef
   * @returns {Promise<{ ok: boolean, status: string, details?: object }>}
   */
  async getStatus(externalRef) {
    throw new Error('PaymentRail.getStatus must be overridden');
  }

  toJSON() {
    return {
      id:           this.id,
      displayName:  this.displayName,
      isAvailable:  this.isAvailable,
      capabilities: this.capabilities,
    };
  }
}

module.exports = { PaymentRail };
