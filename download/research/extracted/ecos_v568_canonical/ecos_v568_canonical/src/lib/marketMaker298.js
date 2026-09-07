'use strict';
/**
 * src/lib/marketMaker298.js — ECOS V298 (Phase P186) — Algorithmic Market-Maker SEED
 *
 * A formula-driven market-making core so the system itself can quote and rebalance
 * like a market maker. This is a SEED: pure, deterministic math + a pluggable
 * strategy registry, with every generated order carrying a risk tag so real
 * placement must pass the V240 dangerous-tool interlock. No live exchange, no live
 * funds — offline-simulatable, so it is safe to grow before it is wired to capital.
 *
 * Implements two canonical models as plain formulas (peak-of-field, not fantasy):
 *   • Grid: ladder of buy levels below / sell levels above a reference price.
 *   • Inventory-aware spread (Avellaneda-Stoikov-lite): reservation price skews
 *     away from the mid by current inventory, widening the side you're long.
 *
 * Pure + dependency-free (R6); version-suffixed (…298, BUG-L safe).
 * @version 298.0.0
 */

const MM_VERSION_298 = '298.0.0';
const MM_MAX_GRID_LEVELS_298 = 200;        // safety bound on ladder size
const MM_DEFAULT_RISK_AVERSION_298 = 0.1;  // gamma in the AS-lite model

class MarketMakerError298 extends Error {
  constructor(msg, code) { super(msg); this.name = 'MarketMakerError298'; this.code = code || 'MM_ERROR'; this.statusCode = 400; }
}
function _num298(v, name) { const n = Number(v); if (!isFinite(n)) throw new MarketMakerError298(`${name} must be finite`); return n; }
function _round298(n, dp = 8) { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

/**
 * Grid strategy — arithmetic ladder between [lower, upper].
 * Returns buy orders strictly below `reference` and sell orders strictly above,
 * each sized `sizePerGrid`. Deterministic; pure.
 * @param {{lower,upper,levels,reference,sizePerGrid}} p
 */
function gridStrategy298(p = {}) {
  const lower = _num298(p.lower, 'lower');
  const upper = _num298(p.upper, 'upper');
  const levels = Math.floor(_num298(p.levels, 'levels'));
  const reference = _num298(p.reference != null ? p.reference : (lower + upper) / 2, 'reference');
  const sizePerGrid = _num298(p.sizePerGrid != null ? p.sizePerGrid : 1, 'sizePerGrid');
  if (lower <= 0 || upper <= lower) throw new MarketMakerError298('require 0 < lower < upper', 'BAD_BOUNDS');
  if (levels < 2 || levels > MM_MAX_GRID_LEVELS_298) throw new MarketMakerError298(`levels must be 2..${MM_MAX_GRID_LEVELS_298}`, 'BAD_LEVELS');
  if (sizePerGrid <= 0) throw new MarketMakerError298('sizePerGrid must be > 0', 'BAD_SIZE');

  const step = (upper - lower) / (levels - 1);
  const orders = [];
  for (let i = 0; i < levels; i++) {
    const price = _round298(lower + i * step);
    if (price < reference) orders.push({ side: 'buy', price, size: sizePerGrid });
    else if (price > reference) orders.push({ side: 'sell', price, size: sizePerGrid });
    // a level exactly at reference is skipped (no crossing)
  }
  return {
    strategy: 'grid', reference: _round298(reference), step: _round298(step),
    buyLevels: orders.filter(o => o.side === 'buy').length,
    sellLevels: orders.filter(o => o.side === 'sell').length,
    orders,
    notional: _round298(orders.reduce((s, o) => s + o.price * o.size, 0)),
  };
}

/**
 * Inventory-aware quotes (Avellaneda-Stoikov-lite). The reservation price skews
 * below mid when long (q>0) to encourage selling, above mid when short.
 *   r = mid - q * gamma * sigma^2 * tau
 *   half-spread = (gamma*sigma^2*tau)/2 + (1/gamma)*ln(1 + gamma/kappa)
 * @param {{mid,inventory,sigma,gamma,kappa,tau}} p
 */
function inventoryQuotes298(p = {}) {
  const mid = _num298(p.mid, 'mid');
  const q = _num298(p.inventory != null ? p.inventory : 0, 'inventory');
  const sigma = _num298(p.sigma != null ? p.sigma : 0.02, 'sigma');
  const gamma = _num298(p.gamma != null ? p.gamma : MM_DEFAULT_RISK_AVERSION_298, 'gamma');
  const kappa = _num298(p.kappa != null ? p.kappa : 1.5, 'kappa');
  const tau = _num298(p.tau != null ? p.tau : 1, 'tau');
  if (mid <= 0) throw new MarketMakerError298('mid must be > 0', 'BAD_MID');
  if (gamma <= 0 || kappa <= 0) throw new MarketMakerError298('gamma, kappa must be > 0', 'BAD_PARAM');

  const reservation = mid - q * gamma * sigma * sigma * tau;
  const halfSpread = (gamma * sigma * sigma * tau) / 2 + (1 / gamma) * Math.log(1 + gamma / kappa);
  const bid = _round298(reservation - halfSpread);
  const ask = _round298(reservation + halfSpread);
  return {
    strategy: 'inventory-spread',
    mid: _round298(mid), reservation: _round298(reservation), halfSpread: _round298(halfSpread),
    bid, ask, spread: _round298(ask - bid),
    skew: _round298(reservation - mid),   // <0 when long (encourages selling)
  };
}

/**
 * Deterministic single-step fill simulation against a traded price — for
 * offline backtests/guards before any capital is involved.
 */
function simulateFill298(orders, tradedPrice) {
  const px = _num298(tradedPrice, 'tradedPrice');
  let filled = [], dInv = 0, dCash = 0;
  for (const o of orders) {
    const hit = (o.side === 'buy' && px <= o.price) || (o.side === 'sell' && px >= o.price);
    if (hit) {
      filled.push(o);
      dInv += o.side === 'buy' ? o.size : -o.size;
      dCash += o.side === 'buy' ? -o.price * o.size : o.price * o.size;
    }
  }
  return { filledCount: filled.length, inventoryDelta: _round298(dInv), cashDelta: _round298(dCash), filled };
}

/**
 * Annotate generated orders with the risk decision shape expected by the V240
 * interlock, so the caller can hard-gate real placement. Pure (no enforcement here).
 */
function riskAnnotateOrders298(orders, opts = {}) {
  const maxNotionalUsd = _num298(opts.maxNotionalUsd != null ? opts.maxNotionalUsd : 20, 'maxNotionalUsd');
  return orders.map(o => {
    const notional = o.price * o.size;
    const requiresHitl = notional > maxNotionalUsd; // mirrors LARGE_TRANSFER_USD_240 default
    return { ...o, notional: _round298(notional), tool: `market.place_${o.side}`, destructive: true, requiresHitl };
  });
}

// ── Pluggable strategy registry (formula strategies discoverable via the mesh) ──
class StrategyRegistry298 {
  constructor() { this.strategies = new Map(); this._seedBuiltins(); }
  _seedBuiltins() {
    this.register({ id: 'grid', kind: 'market-maker', params: ['lower', 'upper', 'levels', 'sizePerGrid'], evaluate: gridStrategy298 });
    this.register({ id: 'inventory-spread', kind: 'market-maker', params: ['mid', 'inventory', 'sigma', 'gamma', 'kappa', 'tau'], evaluate: inventoryQuotes298 });
  }
  register(s) {
    if (!s || !s.id || typeof s.evaluate !== 'function') throw new MarketMakerError298('strategy needs id + evaluate()', 'BAD_STRATEGY');
    this.strategies.set(s.id, { id: s.id, kind: s.kind || 'custom', params: s.params || [], evaluate: s.evaluate });
    return { registered: s.id };
  }
  get(id) { return this.strategies.get(id) || null; }
  list() { return [...this.strategies.values()].map(s => ({ id: s.id, kind: s.kind, params: s.params })); }
  run(id, params) {
    const s = this.strategies.get(id);
    if (!s) throw new MarketMakerError298('unknown strategy: ' + id, 'UNKNOWN_STRATEGY');
    return s.evaluate(params || {});
  }
}

let _defaultRegistry298 = null;
function defaultStrategyRegistry298() { if (!_defaultRegistry298) _defaultRegistry298 = new StrategyRegistry298(); return _defaultRegistry298; }

module.exports = {
  MM_VERSION_298, MM_MAX_GRID_LEVELS_298, MM_DEFAULT_RISK_AVERSION_298, MarketMakerError298,
  gridStrategy298, inventoryQuotes298, simulateFill298, riskAnnotateOrders298,
  StrategyRegistry298, defaultStrategyRegistry298,
};
