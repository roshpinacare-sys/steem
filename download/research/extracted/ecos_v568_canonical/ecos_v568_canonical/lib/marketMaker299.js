'use strict';
/**
 * lib/marketMaker299.js — ECOS V299 (Phase P187) — Capital-Safe Pilots
 *
 * Grows the V298 seeds (marketMaker298 + sovereignServices298) into
 * capital-safe pilots with four additive components, all purely offline /
 * simulated — zero live funds, zero live chain activity:
 *
 *   1. PaperTrader299       — backtest loop: run gridStrategy298 +
 *                             inventoryQuotes298 over a recorded price series
 *                             via simulateFill298; track PnL + inventory +
 *                             trade log per step. Expose summary stats.
 *   2. ServiceFulfilmentBridge299 — wires the V298 service catalog items
 *                             'payment-rail' and 'agent-rental' to existing
 *                             paymentRail.js / dispatcher stubs; charges
 *                             credits via the reserve shape; gates destructive
 *                             amounts via the V240 interlock shape.
 *   3. ContractAuditReceipt299 — when a FormulaContract298 simulation
 *                             completes without a guard violation, emits an
 *                             AgentReceipts268-shaped audit record (the
 *                             bridge toward a future compile/deploy step).
 *   4. TreasuryMarketMaker299 — lets a treasury position quote via
 *                             inventoryQuotes298 with size-gated HITL
 *                             annotation (every quote > threshold is tagged
 *                             requiresHitl so real orders pass V240).
 *
 * Pure + dependency-free (R3: no new npm deps).
 * Sacred files untouched (R1). All new identifiers end in 299 (R2).
 * V287..V298 surfaces preserved (R6). lib/ mirrors src/lib/ (R7).
 *
 * @version 299.0.0
 */

const MM298 = require('./marketMaker298.js');
const SS298 = require('./sovereignServices298.js');

const MM_VERSION_299        = '299.0.0';
const MM_MAX_BACKTEST_299   = 10000;   // max price-series length
const MM_RECEIPT_SEQ_MAX_299 = 1000000; // wrap-around receipt counter

// ─────────────────────────────────────────────────────────────────────────────
// 1) PaperTrader299 — offline backtest loop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a grid + inventory-spread strategy over a price series (paper-trading).
 * Each step: regenerate the grid from current reference price, simulate fill
 * at the step price, update inventory + cash, recompute inventory quotes.
 *
 * @param {number[]} priceSeries  — sequence of traded prices (≥1, ≤10 000)
 * @param {object}  gridParams    — forwarded to gridStrategy298
 * @param {object}  asParams      — forwarded to inventoryQuotes298 (minus mid/inventory)
 * @returns {object}  { version, steps, pnl, finalInventory, finalCash, summary, trace }
 */
function paperBacktest299(priceSeries, gridParams = {}, asParams = {}) {
  if (!Array.isArray(priceSeries) || priceSeries.length === 0) {
    throw new MM298.MarketMakerError298('priceSeries must be a non-empty array', 'BAD_SERIES');
  }
  if (priceSeries.length > MM_MAX_BACKTEST_299) {
    throw new MM298.MarketMakerError298('priceSeries length exceeds ' + MM_MAX_BACKTEST_299, 'SERIES_TOO_LONG');
  }
  let inventory = Number.isFinite(gridParams.initialInventory) ? gridParams.initialInventory : 0;
  let cash      = Number.isFinite(gridParams.initialCash)      ? gridParams.initialCash      : 0;
  const trace   = [];
  let totalFills = 0;

  for (let i = 0; i < priceSeries.length; i++) {
    const price = Number(priceSeries[i]);
    if (!Number.isFinite(price) || price <= 0) {
      throw new MM298.MarketMakerError298('priceSeries[' + i + '] must be a positive finite number', 'BAD_PRICE');
    }
    // use current price as reference for the grid
    const gp = Object.assign({}, gridParams, { reference: price });
    let grid, fill, quotes;
    try {
      grid  = MM298.gridStrategy298(gp);
      fill  = MM298.simulateFill298(grid.orders, price);
      quotes = MM298.inventoryQuotes298(Object.assign({}, asParams, { mid: price, inventory }));
    } catch (e) {
      // skip malformed steps gracefully (e.g. bounds misconfiguration at extreme prices)
      trace.push({ step: i, price, skipped: true, reason: e.message });
      continue;
    }
    inventory = +(inventory + fill.inventoryDelta).toFixed(8);
    cash      = +(cash      + fill.cashDelta).toFixed(8);
    totalFills += fill.filledCount;
    trace.push({
      step: i, price,
      filledCount: fill.filledCount, inventoryDelta: fill.inventoryDelta, cashDelta: fill.cashDelta,
      inventory, cash,
      bid: quotes.bid, ask: quotes.ask, skew: quotes.skew,
    });
  }

  // Mark-to-market PnL: cash + inventory valued at last traded price
  const lastPrice = Number(priceSeries[priceSeries.length - 1]) || 0;
  const mtmPnl    = +(cash + inventory * lastPrice).toFixed(8);

  return {
    version: MM_VERSION_299,
    steps: trace.length, totalFills,
    pnl: mtmPnl,
    finalInventory: inventory, finalCash: cash, lastPrice,
    summary: {
      avgFillsPerStep: trace.length ? +(totalFills / trace.length).toFixed(4) : 0,
      mtmPnl,
    },
    trace,
    paperOnly: true,
    note: 'offline paper-trading; no live funds or orders',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) ServiceFulfilmentBridge299 — wires catalog services to real stubs
// ─────────────────────────────────────────────────────────────────────────────

class FulfilmentResult299 {
  constructor(fields) { Object.assign(this, fields); }
}
class FulfilmentError299 extends Error {
  constructor(msg, code) { super(msg); this.name = 'FulfilmentError299'; this.code = code || 'FULFIL_ERROR'; this.statusCode = 400; }
}

const FULFIL_HITL_CREDIT_THRESHOLD_299 = 50000; // credits above which HITL is required

/**
 * ServiceFulfilmentBridge299 — charges credits and dispatches to a real stub.
 *
 * On construction, accepts optional adapters:
 *   paymentRailAdapter — function(chargeSpec) called for 'payment-rail' orders
 *   dispatcherAdapter  — function(chargeSpec) called for 'agent-rental' orders
 *   creditReserveAdapter — function(userId, credits) — deducts credits (stub)
 *
 * All adapters default to safe no-op stubs so the bridge is self-sufficient
 * when adapters are not yet wired.
 */
class ServiceFulfilmentBridge299 {
  constructor(opts = {}) {
    this.catalog           = opts.catalog           || SS298.defaultServiceCatalog298();
    this.paymentRailAdapter = typeof opts.paymentRailAdapter === 'function'
      ? opts.paymentRailAdapter
      : (_spec) => ({ ok: true, stub: true, note: 'payment-rail adapter not yet bound' });
    this.dispatcherAdapter  = typeof opts.dispatcherAdapter === 'function'
      ? opts.dispatcherAdapter
      : (_spec) => ({ ok: true, stub: true, note: 'dispatcher adapter not yet bound' });
    this.creditReserveAdapter = typeof opts.creditReserveAdapter === 'function'
      ? opts.creditReserveAdapter
      : (_userId, _credits) => ({ ok: true, stub: true, note: 'credit reserve not yet bound' });
    this._stats = { fulfils: 0, gated: 0, errors: 0, creditCharged: 0 };
  }

  /**
   * fulfil(serviceId, qty, opts)
   *   opts.userId     — requester (for credit charge)
   *   opts.userInput  — passed through to adapter (e.g. paymentAmount, taskSpec)
   * Returns { ok, serviceId, qty, quote, creditResult, adapterResult, requiresHitl, version }
   */
  fulfil(serviceId, qty, opts = {}) {
    let quote;
    try { quote = this.catalog.quote(serviceId, qty); }
    catch (e) { this._stats.errors += 1; throw new FulfilmentError299(e.message, e.code || 'QUOTE_FAIL'); }

    const requiresHitl = quote.totalCredits > FULFIL_HITL_CREDIT_THRESHOLD_299;
    if (requiresHitl) {
      this._stats.gated += 1;
      return new FulfilmentResult299({
        ok: false, version: MM_VERSION_299, serviceId, qty, quote,
        requiresHitl: true, code: 'HITL_REQUIRED',
        note: 'totalCredits > ' + FULFIL_HITL_CREDIT_THRESHOLD_299 + '; pass V240 interlock before fulfilment',
      });
    }

    // Charge credits (stub)
    let creditResult;
    try { creditResult = this.creditReserveAdapter(opts.userId || 'anon', quote.totalCredits); }
    catch (e) { this._stats.errors += 1; throw new FulfilmentError299('credit charge failed: ' + e.message, 'CREDIT_FAIL'); }

    // Dispatch to the right adapter
    let adapterResult;
    try {
      const spec = { serviceId, qty, quote, userId: opts.userId, userInput: opts.userInput };
      if (serviceId === 'payment-rail')  adapterResult = this.paymentRailAdapter(spec);
      else if (serviceId === 'agent-rental') adapterResult = this.dispatcherAdapter(spec);
      else adapterResult = { ok: true, stub: true, note: 'generic stub for ' + serviceId };
    } catch (e) {
      this._stats.errors += 1;
      throw new FulfilmentError299('adapter error: ' + e.message, 'ADAPTER_FAIL');
    }

    this._stats.fulfils += 1;
    this._stats.creditCharged += quote.totalCredits;
    return new FulfilmentResult299({
      ok: true, version: MM_VERSION_299, serviceId, qty, quote,
      requiresHitl: false, creditResult, adapterResult,
    });
  }

  stats() {
    return Object.assign({ version: MM_VERSION_299, threshold: FULFIL_HITL_CREDIT_THRESHOLD_299 }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) ContractAuditReceipt299 — emit audit receipt when simulation is clean
// ─────────────────────────────────────────────────────────────────────────────

let _receiptSeq299 = 0;
function _nextReceiptId299() {
  _receiptSeq299 = (_receiptSeq299 + 1) % MM_RECEIPT_SEQ_MAX_299;
  return 'receipt-v299-' + _receiptSeq299 + '-' + Date.now();
}

/**
 * simulateAndReceipt299(contract, initialState, inputs, opts)
 *
 * Runs FormulaContract298.simulate(). If it succeeds (no guard violation):
 *   — Builds an AgentReceipts268-shaped audit record: { intent, plan, action, verification }
 *   — Returns { ok:true, simulation, receipt }
 * If simulation throws:
 *   — Returns { ok:false, error, code:'GUARD_VIOLATION' } — no receipt emitted.
 *
 * opts.receiptSink — optional function(receipt) for real persistence
 */
function simulateAndReceipt299(contract, initialState, inputs, opts = {}) {
  if (!contract || typeof contract.simulate !== 'function') {
    throw new SS298.ServiceError298('contract must be a FormulaContract298 instance', 'BAD_CONTRACT');
  }

  let simulation;
  try {
    simulation = contract.simulate(initialState, inputs);
  } catch (e) {
    return {
      ok: false, version: MM_VERSION_299,
      contractId: contract.id, error: e.message, code: e.code || 'SIMULATION_FAIL',
      receipt: null,
    };
  }

  // Build AgentReceipts268-shaped record (additive shape; doesn't import AgentReceipts268 to avoid dep)
  const receiptId = _nextReceiptId299();
  const at = new Date().toISOString();
  const receipt = {
    receiptId, version: MM_VERSION_299, at,
    contractId: contract.id,
    // AgentReceipts268 four-phase mandate chain:
    intent:       { action: 'formula-contract.simulate', contractId: contract.id, at },
    plan:         { steps: simulation.steps, guardCount: Array.isArray(contract.guards) ? contract.guards.length : 0 },
    action:       { simulation: { steps: simulation.steps, finalState: simulation.finalState, simulatedOnly: true } },
    verification: { guardsAllPassed: true, steps: simulation.steps, finalState: simulation.finalState },
    simulatedOnly: true,
    note: 'Bridge toward EVM compile/deploy: validate spec offline → receipt → future deploy module',
  };

  // Optionally persist
  if (typeof opts.receiptSink === 'function') {
    try { opts.receiptSink(receipt); } catch (_) {}
  }

  return { ok: true, version: MM_VERSION_299, contractId: contract.id, simulation, receipt };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) TreasuryMarketMaker299 — treasury quotes via inventoryQuotes298
// ─────────────────────────────────────────────────────────────────────────────

const TREASURY_HITL_NOTIONAL_299 = 10000; // USD notional above which HITL is required

/**
 * TreasuryMarketMaker299 — wraps inventoryQuotes298 with treasury position tracking
 * and V240-style HITL annotation when quote size exceeds the notional threshold.
 *
 * Does NOT call multiSigTreasury209 directly (avoids a hard dep); instead it accepts
 * an optional `treasuryAdapter(position)` that callers bind to the real module.
 */
class TreasuryMarketMaker299 {
  constructor(opts = {}) {
    this.hitlThreshold = Number.isFinite(opts.hitlThreshold)
      ? opts.hitlThreshold
      : TREASURY_HITL_NOTIONAL_299;
    this.treasuryAdapter = typeof opts.treasuryAdapter === 'function'
      ? opts.treasuryAdapter
      : null;
    this._stats = { quotes: 0, hitlGated: 0, errors: 0 };
  }

  /**
   * quote(params) — params forwarded to inventoryQuotes298 (mid, inventory, sigma, gamma, …)
   *   plus:
   *   params.positionSize   — USD-equivalent position size (for HITL gate)
   *   params.userId         — for receipt
   * Returns the inventoryQuotes298 result enriched with HITL annotation.
   */
  quote(params = {}) {
    let q;
    try { q = MM298.inventoryQuotes298(params); }
    catch (e) { this._stats.errors += 1; throw e; }

    const positionSize = Number.isFinite(params.positionSize) ? params.positionSize : 0;
    const requiresHitl = positionSize > this.hitlThreshold;

    let treasuryPosition = null;
    if (this.treasuryAdapter) {
      try { treasuryPosition = this.treasuryAdapter({ inventory: params.inventory, mid: params.mid, positionSize }); }
      catch (_) {}
    }

    this._stats.quotes += 1;
    if (requiresHitl) this._stats.hitlGated += 1;

    return {
      ...q,
      version: MM_VERSION_299,
      positionSize, requiresHitl,
      hitlThreshold: this.hitlThreshold,
      destructive: requiresHitl,
      tool: 'treasury.place_order',
      treasuryPosition,
      note: requiresHitl
        ? 'positionSize > ' + this.hitlThreshold + '; real order requires V240 HITL interlock'
        : 'within safe size; no HITL required',
    };
  }

  stats() {
    return Object.assign({ version: MM_VERSION_299, hitlThreshold: this.hitlThreshold }, this._stats);
  }
}

// Singleton
let _defaultTreasuryMM299 = null;
function defaultTreasuryMarketMaker299(opts) {
  if (!_defaultTreasuryMM299 || opts) _defaultTreasuryMM299 = new TreasuryMarketMaker299(opts || {});
  return _defaultTreasuryMM299;
}

// Singleton fulfil bridge
let _defaultFulfilBridge299 = null;
function defaultFulfilBridge299(opts) {
  if (!_defaultFulfilBridge299 || opts) _defaultFulfilBridge299 = new ServiceFulfilmentBridge299(opts || {});
  return _defaultFulfilBridge299;
}

module.exports = {
  MM_VERSION_299,
  MM_MAX_BACKTEST_299,
  FULFIL_HITL_CREDIT_THRESHOLD_299,
  TREASURY_HITL_NOTIONAL_299,
  // 1. Paper trader
  paperBacktest299,
  // 2. Fulfilment bridge
  FulfilmentError299,
  FulfilmentResult299,
  ServiceFulfilmentBridge299,
  defaultFulfilBridge299,
  // 3. Contract audit receipt
  simulateAndReceipt299,
  // 4. Treasury market maker
  TreasuryMarketMaker299,
  defaultTreasuryMarketMaker299,
};
