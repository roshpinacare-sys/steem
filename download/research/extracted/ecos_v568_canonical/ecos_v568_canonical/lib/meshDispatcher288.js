'use strict';
/**
 * lib/meshDispatcher288.js — ECOS V288 (Phase P176) — the ACTIVE mesh
 *
 * V287 made 1,900+ capabilities DISCOVERABLE (graph + intent router + bus).
 * V288 makes them ACTIONABLE & CHOREOGRAPHED — the second half of the leap
 * from "we have everything" to "everything coordinates."
 *
 *   1. SafeInvoker288  — actually require()s a capability by id and calls it,
 *      but only when the symbol name matches a read-only allow-list of safe verbs
 *      (get*, list*, search*, check*, stats, status, perf, summarize*, report*,
 *      describe*, find*, count*, has*). Mutating verbs are refused by default
 *      so the dispatcher is safe to expose; mutations still go through the
 *      V240 interlock + actionVerifier + agentReceipts path.
 *
 *   2. MeshDispatcher288  — one-call surface: dispatch a capabilityId OR an
 *      intent string (routed through V287's IntentRouter287 → newest version).
 *      Every dispatch is logged in a bounded ring + auto-published to the bus
 *      as `mesh.dispatched` so other modules can react (choreography).
 *
 *   3. ChoreographyEngine288 — declarative `{topic → capabilityId}` rules so
 *      events choreograph existing capabilities without hand-wired glue
 *      (e.g. on `credit.issued` → call the latest credit-health summary).
 *      Each rule subscribes via the V287 bus and runs through the SafeInvoker.
 *
 * Pure + dependency-free (R6: only fs/path builtins, no new npm deps).
 * Sacred files untouched (R1). All identifiers end in 288 (R2).
 *
 * @version 288.0.0
 */

const fs = require('fs');
const path = require('path');

const DISPATCH_VERSION_288 = '288.0.0';
const DISPATCH_LOG_MAX_288 = 500;
const SAFE_VERB_PATTERNS_288 = [
  /^get([A-Z]|$)/, /^list([A-Z]|$)/, /^search([A-Z]|$)/, /^check([A-Z]|$)/,
  /^summari[sz]e([A-Z]|$)/, /^report([A-Z]|$)/, /^describe([A-Z]|$)/,
  /^find([A-Z]|$)/, /^count([A-Z]|$)/, /^has([A-Z]|$)/,
  /^stats$/, /^status$/, /^perf$/, /^health$/, /^info$/,
];

function _isSafeSymbol288(symbol) {
  // Strip trailing version digits so getStatus286 etc. count as `getStatus`.
  const bare = String(symbol).replace(/\d+$/, '');
  return SAFE_VERB_PATTERNS_288.some(re => re.test(bare));
}

// ── Safe invoker ────────────────────────────────────────────────────────────
class SafeInvoker288 {
  constructor(opts = {}) {
    this.libDirs = Array.isArray(opts.libDirs) && opts.libDirs.length
      ? opts.libDirs : [path.resolve(__dirname)];
    this.allowMutating = !!opts.allowMutating; // default false
  }

  /** Resolve a capability id like "moduleMesh287.IntentRouter287" → {fn, modulePath}. */
  resolve(capabilityId) {
    const id = String(capabilityId || '');
    const dot = id.indexOf('.');
    if (dot <= 0) throw new Error('capabilityId must look like "module.symbol"');
    const moduleName = id.slice(0, dot);
    const symbol = id.slice(dot + 1);
    if (!/^[A-Za-z_$][\w$]*$/.test(moduleName) || !/^[A-Za-z_$][\w$]*$/.test(symbol)) {
      throw new Error('invalid module or symbol name');
    }
    let modulePath = null;
    for (const dir of this.libDirs) {
      const candidate = path.join(dir, moduleName + '.js');
      if (fs.existsSync(candidate)) { modulePath = candidate; break; }
    }
    if (!modulePath) throw new Error('module not found: ' + moduleName);
    // eslint-disable-next-line global-require
    const mod = require(modulePath);
    const fn = mod && mod[symbol];
    if (typeof fn === 'undefined') throw new Error('symbol not exported: ' + symbol);
    return { moduleName, symbol, modulePath, fn, kind: typeof fn };
  }

  /** Invoke if (and only if) the symbol matches the read-only safe-verb list. */
  invoke(capabilityId, args = []) {
    const r = this.resolve(capabilityId);
    if (!this.allowMutating && !_isSafeSymbol288(r.symbol)) {
      const err = new Error('refused: symbol "' + r.symbol + '" is not on the safe-verb allow-list');
      err.code = 'UNSAFE_SYMBOL_288';
      throw err;
    }
    if (typeof r.fn !== 'function') {
      // Constants/classes can still be returned (read-only inspection).
      return { ok: true, capabilityId, kind: r.kind, value: r.fn };
    }
    const startedAt = Date.now();
    const result = r.fn.apply(null, Array.isArray(args) ? args : []);
    return {
      ok: true,
      capabilityId,
      kind: 'function',
      result,
      latencyMs: Date.now() - startedAt,
    };
  }
}

// ── Mesh dispatcher ─────────────────────────────────────────────────────────
class MeshDispatcher288 {
  constructor(opts = {}) {
    if (!opts.graph || !opts.router) {
      throw new Error('MeshDispatcher288 requires {graph, router} from V287');
    }
    this.graph = opts.graph;
    this.router = opts.router;
    this.bus = opts.bus || null; // optional V287 MessageBus287
    this.invoker = opts.invoker || new SafeInvoker288({ libDirs: opts.libDirs });
    this.log = []; // ring of dispatch events
    this.minConfidence = typeof opts.minConfidence === 'number' ? opts.minConfidence : 0.2;
  }

  _record(entry) {
    this.log.push(entry);
    if (this.log.length > DISPATCH_LOG_MAX_288) this.log.shift();
    if (this.bus) { try { this.bus.publish('mesh.dispatched', entry); } catch (_) {} }
    return entry;
  }

  /** Dispatch by an explicit capability id. */
  dispatch(capabilityId, args = []) {
    const at = new Date().toISOString();
    try {
      const r = this.invoker.invoke(capabilityId, args);
      return this._record({ at, mode: 'explicit', capabilityId, ok: true, latencyMs: r.latencyMs || 0 });
    } catch (e) {
      return this._record({ at, mode: 'explicit', capabilityId, ok: false, error: e.message, code: e.code || null });
    }
  }

  /** Dispatch by intent: route → best latest capability → invoke (if confident). */
  dispatchByIntent(intent, args = []) {
    const at = new Date().toISOString();
    const plan = this.router.route(intent);
    if (!plan.matched || plan.confidence < this.minConfidence || !plan.best) {
      return this._record({
        at, mode: 'intent', intent, ok: false,
        error: 'no confident match', confidence: plan.confidence,
      });
    }
    const capabilityId = plan.best.id;
    try {
      const r = this.invoker.invoke(capabilityId, args);
      return this._record({
        at, mode: 'intent', intent, capabilityId, ok: true,
        confidence: plan.confidence, latencyMs: r.latencyMs || 0,
      });
    } catch (e) {
      return this._record({
        at, mode: 'intent', intent, capabilityId, ok: false,
        confidence: plan.confidence, error: e.message, code: e.code || null,
      });
    }
  }

  recent(n = 20) { return this.log.slice(-Math.max(0, n | 0)); }
  stats() {
    let ok = 0, fail = 0, intentRuns = 0;
    for (const e of this.log) { if (e.ok) ok++; else fail++; if (e.mode === 'intent') intentRuns++; }
    return { total: this.log.length, ok, fail, intentRuns, version: DISPATCH_VERSION_288 };
  }
}

// ── Choreography engine ─────────────────────────────────────────────────────
class ChoreographyEngine288 {
  constructor(opts = {}) {
    if (!opts.bus || !opts.dispatcher) {
      throw new Error('ChoreographyEngine288 requires {bus, dispatcher}');
    }
    this.bus = opts.bus;
    this.dispatcher = opts.dispatcher;
    this.rules = new Map(); // name -> {name, topic, capabilityId, unsubscribe, runs, lastAt}
  }

  /** Register a rule: when something publishes to `topic`, call `capabilityId`. */
  register(name, topic, capabilityId) {
    if (!name || typeof name !== 'string') throw new Error('rule name required');
    if (!topic || typeof topic !== 'string') throw new Error('topic required');
    if (!capabilityId) throw new Error('capabilityId required');
    if (this.rules.has(name)) this.unregister(name);
    const rule = { name, topic, capabilityId, runs: 0, lastAt: null };
    const unsubscribe = this.bus.subscribe(topic, (msg) => {
      // Forward the payload as a single argument.
      const r = this.dispatcher.dispatch(capabilityId, [msg && msg.payload]);
      rule.runs += 1;
      rule.lastAt = new Date().toISOString();
      rule.lastOk = !!r.ok;
      if (!r.ok) rule.lastError = r.error;
    });
    rule.unsubscribe = unsubscribe;
    this.rules.set(name, rule);
    return { ok: true, name, topic, capabilityId };
  }

  unregister(name) {
    const r = this.rules.get(name);
    if (!r) return { ok: false, error: 'rule not found' };
    try { r.unsubscribe && r.unsubscribe(); } catch (_) {}
    this.rules.delete(name);
    return { ok: true, name };
  }

  list() {
    return [...this.rules.values()].map(r => ({
      name: r.name, topic: r.topic, capabilityId: r.capabilityId,
      runs: r.runs, lastAt: r.lastAt, lastOk: r.lastOk, lastError: r.lastError || null,
    }));
  }

  stats() {
    let runs = 0;
    for (const r of this.rules.values()) runs += r.runs;
    return { rules: this.rules.size, runs, version: DISPATCH_VERSION_288 };
  }
}

module.exports = {
  DISPATCH_VERSION_288,
  DISPATCH_LOG_MAX_288,
  SAFE_VERB_PATTERNS_288,
  _isSafeSymbol288,
  SafeInvoker288,
  MeshDispatcher288,
  ChoreographyEngine288,
};
