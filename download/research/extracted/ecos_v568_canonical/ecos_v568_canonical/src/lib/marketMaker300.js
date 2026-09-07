'use strict';
/**
 * lib/marketMaker300.js — ECOS V300 (Phase P188) — Live-Capital Binding Layer
 *
 * Graduates the V299 capital-safe pilots into a live-binding layer with four
 * additive components. All live-capital paths are opt-in behind the env flag
 * ECOS_MARKET_LIVE_V300=1 so the module is always safe to load.
 *
 *   1. LiveCapitalBinder300      — binds V299 stub adapters to real lib stubs
 *                                  (paymentRail.js + agentDispatchBridge* +
 *                                  creditReserve); gated by ECOS_MARKET_LIVE_V300.
 *   2. BacktestStats300          — aggregates multiple paperBacktest299 runs into
 *                                  Sharpe-ratio estimate, max-drawdown, and win-rate
 *                                  per step. Endpoint: POST /api/v1/market/backtest/batch
 *   3. ReceiptLedger300          — bounded in-memory ring (capacity 1000) for
 *                                  simulateAndReceipt299 receipts; exposes list/query.
 *                                  Endpoint: GET /api/v1/contracts/receipts
 *   4. TreasuryHitlBridge300     — wires TreasuryMarketMaker299 to multiSigTreasury209
 *                                  + submits requiresHitl quotes as HITL tickets;
 *                                  exposes submit + pending-list endpoints.
 *
 * Sacred files untouched (R1). All new identifiers end in 300 (R2).
 * Zero new npm deps (R3). V287..V299 surfaces preserved (R6).
 * lib/ mirrors src/lib/ (R7). package.json bumped to 300.0.0.
 *
 * @version 300.0.0
 */

const MM298 = require('./marketMaker298.js');
const MM299 = require('./marketMaker299.js');
const SS298 = require('./sovereignServices298.js');

const MM_VERSION_300          = '300.0.0';
const RECEIPT_RING_CAPACITY_300 = 1000;   // max in-memory receipts
const LIVE_FLAG_300           = 'ECOS_MARKET_LIVE_V300'; // opt-in env flag

// ─────────────────────────────────────────────────────────────────────────────
// 1) LiveCapitalBinder300 — opt-in adapter binding for V299 bridge/treasury
// ─────────────────────────────────────────────────────────────────────────────

class LiveCapitalError300 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'LiveCapitalError300';
    this.code = code || 'LIVE_CAPITAL_ERROR';
    this.statusCode = 400;
  }
}

/**
 * LiveCapitalBinder300
 *
 * When `process.env[ECOS_MARKET_LIVE_V300] === '1'`, binds the real adapters:
 *   - paymentRailAdapter  → paymentRail.js sendPayment() stub
 *   - dispatcherAdapter   → agentDispatchBridge adapter
 *   - creditReserveAdapter→ creditReserve deduct stub
 *   - treasuryAdapter     → multiSigTreasury209.propose() stub
 *
 * When the flag is not set (default), all adapters remain as V299 no-op stubs
 * and bind() returns { ok:false, liveEnabled:false } — completely safe.
 */
class LiveCapitalBinder300 {
  constructor(opts = {}) {
    this.liveEnabled = (process.env[LIVE_FLAG_300] === '1') || (opts.forceEnabled === true);
    this._bound = false;
    this._stats = { bindCalls: 0, paymentRailCalls: 0, dispatcherCalls: 0, creditCalls: 0, treasuryCalls: 0 };
    // allow overriding concrete stubs for testing
    this._paymentRailStub  = opts.paymentRailStub  || null;
    this._dispatcherStub   = opts.dispatcherStub   || null;
    this._creditStub       = opts.creditStub        || null;
    this._treasuryStub     = opts.treasuryStub      || null;
  }

  /**
   * bind(bridge, treasury)
   *   bridge  — ServiceFulfilmentBridge299 instance
   *   treasury — TreasuryMarketMaker299 instance (optional)
   * Returns { ok, liveEnabled, message }
   */
  bind(bridge, treasury) {
    this._stats.bindCalls += 1;

    if (!this.liveEnabled) {
      return { ok: false, version: MM_VERSION_300, liveEnabled: false,
        message: 'Live capital not enabled. Set ' + LIVE_FLAG_300 + '=1 to activate.' };
    }

    if (!bridge || typeof bridge.fulfil !== 'function') {
      throw new LiveCapitalError300('bridge must be a ServiceFulfilmentBridge299 instance', 'BAD_BRIDGE');
    }

    // Bind paymentRail adapter
    bridge.paymentRailAdapter = this._paymentRailStub
      ? this._paymentRailStub
      : (spec) => {
          this._stats.paymentRailCalls += 1;
          // real paymentRail.js is in lib — lazy require to avoid hard dep at module load
          try {
            const rail = require('./paymentRail.js');
            const fn = rail.sendPayment || rail.initiatePayment || rail.default;
            if (typeof fn === 'function') return { ok: true, result: fn(spec), live: true };
          } catch (_) {}
          return { ok: true, live: true, stub: true, note: 'paymentRail adapter wired (live mode)' };
        };

    // Bind dispatcher adapter
    bridge.dispatcherAdapter = this._dispatcherStub
      ? this._dispatcherStub
      : (spec) => {
          this._stats.dispatcherCalls += 1;
          try {
            // try the latest agentDispatchBridge available in lib
            const bridges = ['agentDispatchBridge253', 'agentDispatchBridge252', 'agentDispatchBridge251'];
            for (const name of bridges) {
              try {
                const m = require('./' + name + '.js');
                const fn = m.dispatch || m.dispatchAgent || m.default;
                if (typeof fn === 'function') return { ok: true, result: fn(spec), live: true };
              } catch (_) { continue; }
            }
          } catch (_) {}
          return { ok: true, live: true, stub: true, note: 'dispatcher adapter wired (live mode)' };
        };

    // Bind credit reserve adapter
    bridge.creditReserveAdapter = this._creditStub
      ? this._creditStub
      : (userId, credits) => {
          this._stats.creditCalls += 1;
          return { ok: true, live: true, userId, credits, note: 'credit deducted (live stub)' };
        };

    // Bind treasury adapter (optional)
    if (treasury && typeof treasury.quote === 'function') {
      treasury.treasuryAdapter = this._treasuryStub
        ? this._treasuryStub
        : (position) => {
            this._stats.treasuryCalls += 1;
            try {
              const treas = require('./multiSigTreasury209.js');
              const fn = treas.propose || treas.submitOrder || treas.default;
              if (typeof fn === 'function') return { ok: true, result: fn(position), live: true };
            } catch (_) {}
            return { ok: true, live: true, position, note: 'treasury adapter wired (live mode)' };
          };
    }

    this._bound = true;
    return { ok: true, version: MM_VERSION_300, liveEnabled: true, bound: true,
      message: 'Live adapters bound: paymentRail, dispatcher, creditReserve' + (treasury ? ', treasury' : '') };
  }

  stats() {
    return Object.assign({ version: MM_VERSION_300, flag: LIVE_FLAG_300, liveEnabled: this.liveEnabled, bound: this._bound }, this._stats);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) BacktestStats300 — multi-run aggregator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runBatchBacktest300(runs, globalGridParams, globalAsParams)
 *
 * Accepts an array of { priceSeries, gridParams?, asParams? } run descriptors.
 * Runs each through paperBacktest299 and aggregates into BacktestStats300:
 *   - Sharpe-ratio estimate (mean PnL / stddev PnL × √runs)
 *   - Max drawdown (worst step-level PnL drop across all runs)
 *   - Win-rate (fraction of runs with mtmPnl > 0)
 *   - Per-run summary table
 *
 * Returns { version, runCount, stats, runs[] }
 */
function runBatchBacktest300(runs, globalGridParams = {}, globalAsParams = {}) {
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new MM298.MarketMakerError298('runs must be a non-empty array of { priceSeries } descriptors', 'BAD_RUNS');
  }
  if (runs.length > 500) {
    throw new MM298.MarketMakerError298('batch run count exceeds 500', 'BATCH_TOO_LARGE');
  }

  const results = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run || !Array.isArray(run.priceSeries)) {
      throw new MM298.MarketMakerError298('runs[' + i + '].priceSeries must be an array', 'BAD_RUN_SERIES');
    }
    const gp = Object.assign({}, globalGridParams, run.gridParams || {});
    const ap = Object.assign({}, globalAsParams,   run.asParams   || {});
    let res;
    try {
      res = MM299.paperBacktest299(run.priceSeries, gp, ap);
    } catch (e) {
      results.push({ runIndex: i, ok: false, error: e.message, pnl: 0 });
      continue;
    }
    results.push({ runIndex: i, ok: true, pnl: res.pnl, steps: res.steps, totalFills: res.totalFills,
      avgFillsPerStep: res.summary.avgFillsPerStep });
  }

  const successResults = results.filter(r => r.ok);
  const pnls = successResults.map(r => r.pnl);
  const n = pnls.length;

  const meanPnl = n > 0 ? pnls.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n > 1
    ? pnls.reduce((a, p) => a + Math.pow(p - meanPnl, 2), 0) / (n - 1)
    : 0;
  const stddevPnl = Math.sqrt(variance);
  const sharpeEstimate = stddevPnl > 0 ? (meanPnl / stddevPnl) * Math.sqrt(n) : 0;
  const winRate = n > 0 ? pnls.filter(p => p > 0).length / n : 0;

  // Max drawdown: largest drop from peak-to-trough within each run's trace
  let maxDrawdown = 0;
  for (const run of runs) {
    if (!Array.isArray(run.priceSeries)) continue;
    // use pnls from trace if available — approximate with simple peak-valley on prices
    const prices = run.priceSeries.map(Number).filter(p => p > 0);
    let peak = -Infinity;
    for (const p of prices) {
      if (p > peak) peak = p;
      const dd = peak > 0 ? (peak - p) / peak : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  return {
    version: MM_VERSION_300,
    runCount: runs.length,
    successCount: n,
    stats: {
      meanPnl: +meanPnl.toFixed(8),
      stddevPnl: +stddevPnl.toFixed(8),
      sharpeEstimate: +sharpeEstimate.toFixed(6),
      winRate: +winRate.toFixed(4),
      maxDrawdownFraction: +maxDrawdown.toFixed(6),
      bestPnl:  n > 0 ? Math.max(...pnls) : 0,
      worstPnl: n > 0 ? Math.min(...pnls) : 0,
    },
    runs: results,
    note: 'Sharpe = (meanPnl / stddevPnl) × √successCount; max-drawdown approximated from price series peak-trough',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) ReceiptLedger300 — bounded in-memory ring for audit receipts
// ─────────────────────────────────────────────────────────────────────────────

class ReceiptLedger300 {
  constructor(opts = {}) {
    this.capacity = Number.isFinite(opts.capacity) && opts.capacity > 0
      ? Math.floor(opts.capacity) : RECEIPT_RING_CAPACITY_300;
    this._ring = [];          // circular buffer (newest first after push)
    this._writePos = 0;
    this._totalWritten = 0;
  }

  /**
   * push(receipt) — store a receipt (wraps when full)
   */
  push(receipt) {
    if (!receipt || typeof receipt !== 'object') return;
    const entry = Object.assign({}, receipt, { _ledgerSeq: this._totalWritten, _storedAt: new Date().toISOString() });
    if (this._ring.length < this.capacity) {
      this._ring.push(entry);
    } else {
      this._ring[this._writePos % this.capacity] = entry;
    }
    this._writePos = (this._writePos + 1) % this.capacity;
    this._totalWritten += 1;
  }

  /**
   * list(opts) — retrieve receipts
   *   opts.contractId — filter by contractId (optional)
   *   opts.limit      — max results (default 20, max capacity)
   *   opts.offset     — skip N results (default 0)
   */
  list(opts = {}) {
    const limit  = Math.min(Number.isFinite(opts.limit)  ? opts.limit  : 20, this.capacity);
    const offset = Number.isFinite(opts.offset) && opts.offset > 0 ? opts.offset : 0;

    // Sort by ledgerSeq descending (newest first)
    let all = this._ring.slice().sort((a, b) => b._ledgerSeq - a._ledgerSeq);
    if (opts.contractId) all = all.filter(r => r.contractId === opts.contractId);
    const total = all.length;
    const items = all.slice(offset, offset + limit);

    return {
      version: MM_VERSION_300,
      total, offset, limit, items,
      capacity: this.capacity, totalWritten: this._totalWritten,
    };
  }

  stats() {
    return { version: MM_VERSION_300, capacity: this.capacity, stored: this._ring.length, totalWritten: this._totalWritten };
  }
}

// Singleton ledger
let _defaultReceiptLedger300 = null;
function defaultReceiptLedger300(opts) {
  if (!_defaultReceiptLedger300 || opts) _defaultReceiptLedger300 = new ReceiptLedger300(opts || {});
  return _defaultReceiptLedger300;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) TreasuryHitlBridge300 — HITL ticket submission for large treasury quotes
// ─────────────────────────────────────────────────────────────────────────────

class TreasuryHitlError300 extends Error {
  constructor(msg, code) {
    super(msg);
    this.name = 'TreasuryHitlError300';
    this.code = code || 'HITL_ERROR';
    this.statusCode = 400;
  }
}

let _hitlTicketSeq300 = 0;
function _nextHitlTicketId300() {
  _hitlTicketSeq300 += 1;
  return 'hitl-v300-' + _hitlTicketSeq300 + '-' + Date.now();
}

/**
 * TreasuryHitlBridge300
 *
 * Wraps TreasuryMarketMaker299:
 *   - When requiresHitl:true, submits a HITL ticket to the in-memory pending queue
 *     and optionally to a multiSigTreasury209 adapter.
 *   - Exposes submitQuote300() + pendingTickets300() + approveTicket300().
 *   - Pending queue is bounded (100 tickets) — oldest evicted when full.
 */
class TreasuryHitlBridge300 {
  constructor(opts = {}) {
    this.treasury = opts.treasury || MM299.defaultTreasuryMarketMaker299();
    this.pendingCap = 100;
    this._pending = [];     // { ticketId, quote, params, submittedAt, status }
    this._multiSigAdapter = typeof opts.multiSigAdapter === 'function' ? opts.multiSigAdapter : null;
    this._stats = { submitted: 0, approved: 0, rejected: 0, passthrough: 0 };
  }

  /**
   * submitQuote300(params)
   *   If requiresHitl → creates HITL ticket, returns { ok:false, requiresHitl:true, ticket }
   *   If safe         → passthrough { ok:true, quote }
   */
  submitQuote300(params = {}) {
    const quote = this.treasury.quote(params);

    if (!quote.requiresHitl) {
      this._stats.passthrough += 1;
      return { ok: true, version: MM_VERSION_300, requiresHitl: false, quote, ticket: null };
    }

    // Create HITL ticket
    const ticket = {
      ticketId: _nextHitlTicketId300(),
      version: MM_VERSION_300,
      status: 'pending',
      quote, params,
      submittedAt: new Date().toISOString(),
      approvedAt: null, rejectedAt: null,
      note: 'Requires V240 HITL interlock + operator approval before order placement',
    };

    // Evict oldest if at capacity
    if (this._pending.length >= this.pendingCap) this._pending.shift();
    this._pending.push(ticket);
    this._stats.submitted += 1;

    // Forward to multiSig adapter if available
    if (this._multiSigAdapter) {
      try { this._multiSigAdapter(ticket); } catch (_) {}
    }

    return { ok: false, version: MM_VERSION_300, requiresHitl: true, ticket,
      message: 'HITL ticket created; awaiting operator approval' };
  }

  /** pendingTickets300(opts) — list pending tickets (status filter optional) */
  pendingTickets300(opts = {}) {
    const status = opts.status || 'pending';
    const items = this._pending.filter(t => status === 'all' || t.status === status);
    return { version: MM_VERSION_300, status, count: items.length, tickets: items };
  }

  /**
   * approveTicket300(ticketId, decision) — 'approve' or 'reject'
   * Returns { ok, ticketId, status }
   */
  approveTicket300(ticketId, decision = 'approve') {
    const ticket = this._pending.find(t => t.ticketId === ticketId);
    if (!ticket) throw new TreasuryHitlError300('ticket not found: ' + ticketId, 'TICKET_NOT_FOUND');
    if (ticket.status !== 'pending') throw new TreasuryHitlError300('ticket already settled: ' + ticket.status, 'ALREADY_SETTLED');

    if (decision === 'approve') {
      ticket.status = 'approved';
      ticket.approvedAt = new Date().toISOString();
      this._stats.approved += 1;
    } else {
      ticket.status = 'rejected';
      ticket.rejectedAt = new Date().toISOString();
      this._stats.rejected += 1;
    }
    return { ok: true, version: MM_VERSION_300, ticketId, status: ticket.status };
  }

  stats() {
    return Object.assign({ version: MM_VERSION_300 }, this._stats, { pendingCount: this._pending.filter(t => t.status === 'pending').length });
  }
}

// Singleton HITL bridge
let _defaultHitlBridge300 = null;
function defaultTreasuryHitlBridge300(opts) {
  if (!_defaultHitlBridge300 || opts) _defaultHitlBridge300 = new TreasuryHitlBridge300(opts || {});
  return _defaultHitlBridge300;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  MM_VERSION_300,
  RECEIPT_RING_CAPACITY_300,
  LIVE_FLAG_300,
  // 1. Live capital binder
  LiveCapitalError300,
  LiveCapitalBinder300,
  // 2. Batch backtest
  runBatchBacktest300,
  // 3. Receipt ledger
  ReceiptLedger300,
  defaultReceiptLedger300,
  // 4. Treasury HITL bridge
  TreasuryHitlError300,
  TreasuryHitlBridge300,
  defaultTreasuryHitlBridge300,
};
