'use strict';

/**
 * RailRegistry — Registry for all PaymentRail implementations.
 * Manages registration, lookup, and selection of payment rails.
 *
 * V111 — Sovereign Economy
 */

class RailRegistry {
  constructor() {
    this._rails = new Map();
  }

  /**
   * Register a PaymentRail instance.
   * @param {import('./paymentRail').PaymentRail} rail
   */
  register(rail) {
    if (!rail || typeof rail.id !== 'string') {
      throw new Error('RailRegistry.register: invalid rail (missing id)');
    }
    this._rails.set(rail.id, rail);
    return this;
  }

  /**
   * Get a rail by id.
   * @param {string} id
   * @returns {import('./paymentRail').PaymentRail|undefined}
   */
  getRail(id) {
    return this._rails.get(id);
  }

  /**
   * Returns only rails where isAvailable === true.
   * @returns {import('./paymentRail').PaymentRail[]}
   */
  availableRails() {
    return Array.from(this._rails.values()).filter(r => r.isAvailable);
  }

  /**
   * Returns the first available rail that can accept deposits.
   * @returns {import('./paymentRail').PaymentRail|undefined}
   */
  defaultDepositRail() {
    return this.availableRails().find(r => r.capabilities.canDeposit);
  }

  /**
   * Returns rails whose capabilities.regions include the given region,
   * plus all global rails (regions = []).
   * @param {string} region  e.g. 'IL', 'US'
   * @returns {import('./paymentRail').PaymentRail[]}
   */
  pickForRegion(region) {
    return this.availableRails().filter(r => {
      const regions = r.capabilities.regions || [];
      return regions.length === 0 || regions.includes(region);
    });
  }

  /**
   * Serialize all registered rails for API responses.
   */
  toJSON() {
    return Array.from(this._rails.values()).map(r => r.toJSON());
  }
}

module.exports = { RailRegistry };
