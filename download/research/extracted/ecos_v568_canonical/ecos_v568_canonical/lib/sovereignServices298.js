'use strict';
/**
 * src/lib/sovereignServices298.js — ECOS V298 (Phase P186) — Sovereign Services + Formula-Contract SEED
 *
 * Two seeds for "sellable sovereignty beyond AI":
 *   1. ServiceCatalog298 — a registry of priced, sellable services (payments,
 *      domains, servers/compute, agents, security, smart-contract building, …),
 *      each priced in CREDITS so it plugs straight into the credit economy and is
 *      discoverable via the V287 mesh. Fulfilment is a stub interface future
 *      modules/connectors bind to (e.g. a real registrar, cloud, or payment rail).
 *   2. FormulaContract298 — a "smart contract managed by formulas" SEED: a
 *      parameterized, guarded spec that can be SIMULATED offline (no live deploy),
 *      so logic is validated and invariant-checked before it ever touches an EVM
 *      chain. A future module can compile a validated spec to a real deployment.
 *
 * Pure + dependency-free (R6); version-suffixed (…298). No live funds / no live deploy.
 * @version 298.0.0
 */

const SVC_VERSION_298 = '298.0.0';
const SVC_CATEGORIES_298 = ['payments', 'domains', 'servers', 'agents', 'security', 'contracts', 'data', 'ai'];

class ServiceError298 extends Error {
  constructor(msg, code) { super(msg); this.name = 'ServiceError298'; this.code = code || 'SVC_ERROR'; this.statusCode = 400; }
}
const _SLUG_298 = /^[a-z0-9][a-z0-9_-]{1,63}$/;

// ── Sellable service catalog ─────────────────────────────────────────────────
class ServiceCatalog298 {
  constructor() { this.services = new Map(); }
  register(svc) {
    if (!svc || !_SLUG_298.test(String(svc.id || ''))) throw new ServiceError298('id must be a slug', 'BAD_ID');
    if (!SVC_CATEGORIES_298.includes(svc.category)) throw new ServiceError298('category must be one of: ' + SVC_CATEGORIES_298.join(', '), 'BAD_CATEGORY');
    const priceCredits = Number(svc.priceCredits);
    if (!isFinite(priceCredits) || priceCredits < 0) throw new ServiceError298('priceCredits must be >= 0', 'BAD_PRICE');
    const stored = {
      id: svc.id, name: svc.name || svc.id, category: svc.category,
      priceCredits, unit: svc.unit || 'each',
      requiresKyc: !!svc.requiresKyc,
      sovereign: !!svc.sovereign,                 // runs on our own infra/chain
      fulfil: typeof svc.fulfil === 'function' ? svc.fulfil : null, // stub interface
      tags: Array.isArray(svc.tags) ? svc.tags.slice() : [],
    };
    this.services.set(svc.id, stored);
    return { registered: svc.id, category: stored.category, priceCredits };
  }
  get(id) { const s = this.services.get(id); if (!s) return null; const { fulfil, ...meta } = s; return { ...meta, fulfilable: !!fulfil }; }
  list(filter = {}) {
    let out = [...this.services.values()];
    if (filter.category) out = out.filter(s => s.category === filter.category);
    if (filter.sovereign != null) out = out.filter(s => s.sovereign === !!filter.sovereign);
    return out.map(({ fulfil, ...m }) => ({ ...m, fulfilable: !!fulfil }));
  }
  /** Build an order (credit charge) for a service — does NOT settle; returns the charge spec. */
  quote(id, qty = 1) {
    const s = this.services.get(id);
    if (!s) throw new ServiceError298('unknown service: ' + id, 'UNKNOWN');
    const q = Number(qty); if (!isFinite(q) || q <= 0) throw new ServiceError298('qty must be > 0', 'BAD_QTY');
    return { serviceId: id, qty: q, unit: s.unit, totalCredits: s.priceCredits * q, requiresKyc: s.requiresKyc };
  }
  stats() {
    const byCat = {};
    for (const s of this.services.values()) byCat[s.category] = (byCat[s.category] || 0) + 1;
    return { total: this.services.size, byCategory: byCat, sovereign: [...this.services.values()].filter(s => s.sovereign).length };
  }
}

// ── Formula-managed smart contract (SEED: simulate, never deploy) ────────────
const FC_OPS_298 = {
  // safe, deterministic formula primitives a "contract" may use
  add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b,
  div: (a, b) => (b === 0 ? 0 : a / b), min: Math.min, max: Math.max,
  pct: (a, p) => a * (p / 100),
};

class FormulaContract298 {
  /**
   * @param {{id, params:object, guards?:Array<{expr:(s)=>boolean, msg}>, step:(state, input, ops)=>object}} spec
   */
  constructor(spec) {
    if (!spec || !spec.id || typeof spec.step !== 'function') throw new ServiceError298('contract needs id + step()', 'BAD_CONTRACT');
    this.id = spec.id;
    this.params = spec.params || {};
    this.guards = Array.isArray(spec.guards) ? spec.guards : [];
    this.step = spec.step;
  }
  _checkGuards(state) {
    for (const g of this.guards) {
      let ok = true; try { ok = !!g.expr(state); } catch (_) { ok = false; }
      if (!ok) throw new ServiceError298('guard violated: ' + (g.msg || 'invariant'), 'GUARD_VIOLATION');
    }
  }
  /** Run the contract over a sequence of inputs from an initial state. Pure simulation. */
  simulate(initialState, inputs) {
    let state = Object.assign({}, initialState);
    const trace = [];
    this._checkGuards(state);
    for (const input of (inputs || [])) {
      const next = this.step(Object.assign({}, state), input, FC_OPS_298, this.params);
      this._checkGuards(next);
      trace.push({ input, state: next });
      state = next;
    }
    return { contractId: this.id, finalState: state, steps: trace.length, trace, simulatedOnly: true };
  }
}

let _defaultCatalog298 = null;
function defaultServiceCatalog298() {
  if (!_defaultCatalog298) {
    _defaultCatalog298 = new ServiceCatalog298();
    // seed a few canonical sovereign services (priced in credits; fulfilment bound later)
    _defaultCatalog298.register({ id: 'domain-register', name: 'Domain Registration', category: 'domains', priceCredits: 120000, unit: 'year', sovereign: true, tags: ['dns', 'identity'] });
    _defaultCatalog298.register({ id: 'managed-server', name: 'Managed Server / Compute', category: 'servers', priceCredits: 50000, unit: 'month', sovereign: true, tags: ['compute', 'hosting'] });
    _defaultCatalog298.register({ id: 'agent-rental', name: 'Autonomous Agent (managed)', category: 'agents', priceCredits: 10000, unit: 'task', sovereign: true, tags: ['ai', 'automation'] });
    _defaultCatalog298.register({ id: 'security-audit', name: 'Security / Contract Audit', category: 'security', priceCredits: 200000, unit: 'engagement', requiresKyc: true, tags: ['audit', 'evm'] });
    _defaultCatalog298.register({ id: 'contract-build', name: 'Formula Smart-Contract Build', category: 'contracts', priceCredits: 300000, unit: 'contract', sovereign: true, requiresKyc: true, tags: ['evm', 'formula'] });
    _defaultCatalog298.register({ id: 'payment-rail', name: 'Payment Rail (credit↔crypto)', category: 'payments', priceCredits: 0, unit: 'txn', sovereign: true, tags: ['x402', 'usdc'] });
  }
  return _defaultCatalog298;
}

module.exports = {
  SVC_VERSION_298, SVC_CATEGORIES_298, ServiceError298,
  ServiceCatalog298, FormulaContract298, FC_OPS_298,
  defaultServiceCatalog298,
};
