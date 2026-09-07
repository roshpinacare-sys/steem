'use strict';
/**
 * lib/meshDispatcher289.js — ECOS V289 (Phase P177) — the GUARDED + CHOREOGRAPHED mesh
 *
 * V288 made 1,900+ capabilities ACTIONABLE (SafeInvoker288 + MeshDispatcher288
 * + ChoreographyEngine288). It deliberately refused any mutating verb at the
 * HTTP edge — mutations still went through the V240 interlock + actionVerifier
 * + V268 agentReceipts path, but as a separate, hand-wired flow.
 *
 * V289 closes the loop: a single GuardedDispatcher289 wraps the V288 dispatcher
 * so that even an `allowMutating:true` variant is callable safely from one
 * place, with:
 *
 *   1. GuardedDispatcher289 — pre-flight `enforceToolCall240` interlock
 *      (SACRED → BLOCK, DESTRUCTIVE → REQUIRE_HITL, SAFE → ALLOW), then invokes
 *      via a (possibly mutating) SafeInvoker288, then runs verifyAction240
 *      if a verify spec was provided, and emits the full AP2 mandate chain
 *      via AgentReceipts268 (INTENT → PLAN → ACTION → VERIFICATION). End state:
 *      ANY capability — read or mutating — is callable from one place, every
 *      call has a verifiable receipt, every refusal is auditable.
 *
 *   2. DefaultPlaybook289 — a small canonical set of choreography rules
 *      registered out-of-the-box (credit.issued → creditHealthMonitor.*.getStatus,
 *      rep.changed → leaderboardSnapshot.*.getStatus, etc.) so the V288
 *      ChoreographyEngine is value-on-boot, not empty-on-boot. The playbook is
 *      *advisory*: rules that don't resolve against the current capability
 *      graph are reported as `skipped`, not as failures. Exposed read-only.
 *
 *   3. ConsolidationWorker289 — for each stale duplicate capability surfaced
 *      by V287's `CapabilityGraph287.duplicationReport()`, plan / optionally
 *      write a thin `latest` alias module that re-exports the newest version
 *      (so `creditReserve.latest` always points at the current implementation).
 *      Dry-run by default; `apply()` is gated on `{ confirm:true }` AND
 *      refuses ever to touch sacred paths.
 *
 *   4. DispatchStream289 — bounded ring + listener fan-out for SSE clients,
 *      backed by the V287 `mesh.dispatched` bus topic. Lets `/api/v1/mesh/
 *      dispatch/stream` deliver live dispatch events without polling.
 *
 * Pure + dependency-free (R6: only fs/path builtins, no new npm deps).
 * Sacred files untouched (R1). All new identifiers end in 289 (R2).
 *
 * @version 289.0.0
 */

const fs = require('fs');
const path = require('path');

const D288 = require('./meshDispatcher288.js');
const Mesh287 = require('./moduleMesh287.js');

const GUARDED_VERSION_289 = '289.0.0';
const STREAM_RING_MAX_289 = 200;

// ── Optional dependency loader (interlock / verifier / receipts may be absent
//    in a stripped-down build; degrade gracefully without breaking V288).
function _tryRequire289(rel) {
  try { return require(rel); } catch (_) { return null; }
}
const _Interlock240 = _tryRequire289('./dangerousToolInterlock240.js');
const _Verifier240  = _tryRequire289('./actionVerifier240.js');
const _Receipts268  = _tryRequire289('./agentReceipts268.js');

// ── Guarded dispatcher ──────────────────────────────────────────────────────
class GuardedDispatcher289 {
  /**
   * @param {object} opts
   * @param {object} opts.dispatcher — a MeshDispatcher288 (read-only path)
   * @param {object} [opts.mutatingInvoker] — SafeInvoker288({allowMutating:true})
   * @param {object} [opts.receipts] — AgentReceipts268 instance (or null)
   * @param {function} [opts.hitlGate] — V240 hitl gate (optional)
   * @param {function} [opts.audit]    — audit sink (optional)
   * @param {string[]} [opts.libDirs]
   */
  constructor(opts = {}) {
    if (!opts.dispatcher) throw new Error('GuardedDispatcher289 requires {dispatcher}');
    this.dispatcher = opts.dispatcher;
    this.libDirs = Array.isArray(opts.libDirs) && opts.libDirs.length
      ? opts.libDirs : [path.resolve(__dirname)];
    this.mutating = opts.mutatingInvoker
      || new D288.SafeInvoker288({ libDirs: this.libDirs, allowMutating: true });
    this.receipts = opts.receipts
      || (_Receipts268 && typeof _Receipts268.defaultAgentReceipts268 === 'function'
            ? _Receipts268.defaultAgentReceipts268()
            : (_Receipts268 && _Receipts268.AgentReceipts268
                ? new _Receipts268.AgentReceipts268()
                : null));
    this.hitlGate = opts.hitlGate || null;
    this.audit = typeof opts.audit === 'function' ? opts.audit : () => {};
    this._stats = { total: 0, allowed: 0, blocked: 0, hitl: 0, verified: 0, verifyFailed: 0 };
  }

  /**
   * Guarded dispatch.
   * @param {object} req
   * @param {string} req.capabilityId — e.g. "creditReserve268.getStatus"
   * @param {Array}  [req.args]
   * @param {object} [req.verify]     — actionVerifier240 spec
   * @param {object} [req.tool]       — interlock tool descriptor {name, destructive}
   * @param {string} [req.missionId]  — explicit missionId (otherwise auto)
   * @param {string} [req.userId]
   * @param {string} [req.intent]     — human-readable intent string for the receipt
   */
  dispatch(req = {}) {
    const at = new Date().toISOString();
    this._stats.total += 1;
    const capabilityId = String(req.capabilityId || '');
    if (!capabilityId) {
      return { ok: false, at, error: 'capabilityId required', code: 'NO_TARGET' };
    }
    const args = Array.isArray(req.args) ? req.args : [];
    const tool = req.tool || { name: capabilityId, destructive: false };
    // 1) Interlock — refuses sacred mutations, escalates destructive verbs to HITL.
    let gate = { allowed: true, decision: 'allow', level: 'safe', reasons: ['no interlock loaded'] };
    if (_Interlock240 && _Interlock240.enforceToolCall240) {
      try {
        gate = _Interlock240.enforceToolCall240(tool, _argsToObject289(args), {
          hitlGate: this.hitlGate, audit: this.audit, userId: req.userId || null,
        });
      } catch (e) {
        this._stats.blocked += 1;
        this.audit({ action: 'guarded.block', capabilityId, reason: e.message });
        return { ok: false, at, capabilityId, error: e.message, code: e.code || 'BLOCKED' };
      }
      if (!gate.allowed) {
        this._stats.hitl += 1;
        return { ok: false, at, capabilityId, code: 'REQUIRE_HITL',
          decision: gate.decision, reasons: gate.reasons, hitl: gate.hitl || null };
      }
    }
    this._stats.allowed += 1;

    // 2) Receipts — open a mandate chain so every guarded call is provable.
    const missionId = req.missionId || ('mesh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));
    let chainOpened = false;
    if (this.receipts) {
      try {
        this.receipts.initReceipt268(missionId, {
          userId: req.userId || null, taskType: 'mesh.dispatch.guarded',
          description: req.intent || capabilityId, agentId: 'GuardedDispatcher289',
        });
        chainOpened = true;
        this.receipts.emitIntent268(missionId, req.intent || capabilityId);
        this.receipts.emitPlan268(missionId, { capabilityId, args, verify: req.verify || null });
      } catch (_) { /* never let receipts failure break dispatch */ }
    }

    // 3) Invoke — through the (mutating-capable) SafeInvoker288 so the same
    //    allow-list machinery still applies; here we use a separate invoker
    //    so default reads still flow through the V288 dispatcher's gated one.
    let invokeResult, invokeError = null;
    try {
      invokeResult = this.mutating.invoke(capabilityId, args);
    } catch (e) {
      invokeError = { message: e.message, code: e.code || null };
    }
    if (chainOpened) {
      try {
        this.receipts.emitAction268(missionId, {
          capabilityId, ok: !invokeError,
          latencyMs: invokeResult ? (invokeResult.latencyMs || 0) : 0,
          error: invokeError ? invokeError.message : null,
        });
      } catch (_) {}
    }
    if (invokeError) {
      return { ok: false, at, capabilityId, missionId,
        error: invokeError.message, code: invokeError.code || 'INVOKE_FAILED' };
    }

    // 4) Post-action verification — only if caller provided a spec.
    let verification = null;
    if (req.verify && _Verifier240 && _Verifier240.verifyAction240) {
      try {
        verification = _Verifier240.verifyAction240(req.verify);
        if (verification.verified) this._stats.verified += 1;
        else this._stats.verifyFailed += 1;
        if (chainOpened) {
          try { this.receipts.emitVerification268(missionId, verification); } catch (_) {}
        }
      } catch (e) {
        verification = { verified: false, type: req.verify.type || 'unknown', detail: e.message };
        this._stats.verifyFailed += 1;
      }
    }

    return {
      ok: true, at, capabilityId, missionId,
      decision: gate.decision, level: gate.level,
      latencyMs: invokeResult.latencyMs || 0,
      result: invokeResult.result,
      verification,
    };
  }

  stats() {
    return Object.assign({ version: GUARDED_VERSION_289 }, this._stats);
  }
}

function _argsToObject289(args) {
  // Interlock inspects arg strings/paths; flatten an arg array to a plain object.
  if (!Array.isArray(args)) return {};
  const out = {};
  args.forEach((a, i) => { out['_' + i] = a; });
  return out;
}

// ── Default playbook ────────────────────────────────────────────────────────
//   Topic, capabilitySearchQuery, name. The playbook resolves capabilities at
//   seed-time using V287's `CapabilityGraph287.searchLatest()` so we always
//   register the CURRENT version (e.g. creditHealthMonitor273.getStatus today,
//   …275.getStatus tomorrow).
const DEFAULT_PLAYBOOK_289 = Object.freeze([
  { name: 'on-credit-issued', topic: 'credit.issued',  query: 'credit health status' },
  { name: 'on-rep-changed',   topic: 'rep.changed',    query: 'leaderboard snapshot status' },
  { name: 'on-task-completed',topic: 'task.completed', query: 'task metrics status' },
  { name: 'on-mission-done',  topic: 'mission.done',   query: 'mission report status' },
  { name: 'on-alert',         topic: 'alert.raised',   query: 'alert digest status' },
  { name: 'on-mesh-dispatched', topic: 'mesh.dispatched', query: 'mesh stats summary' },
]);

class DefaultPlaybook289 {
  constructor(opts = {}) {
    if (!opts.choreo || !opts.graph) throw new Error('DefaultPlaybook289 requires {choreo, graph}');
    this.choreo = opts.choreo;
    this.graph = opts.graph;
    this.seeded = [];
    this.skipped = [];
  }

  seed() {
    this.seeded = [];
    this.skipped = [];
    for (const rule of DEFAULT_PLAYBOOK_289) {
      const matches = this.graph.searchLatest(rule.query, 1);
      const best = matches[0];
      if (!best) {
        this.skipped.push({ name: rule.name, topic: rule.topic, reason: 'no matching capability' });
        continue;
      }
      // Only auto-seed safe verbs (the playbook is choreography, not mutation).
      if (!D288._isSafeSymbol288(best.symbol)) {
        this.skipped.push({ name: rule.name, topic: rule.topic, reason: 'best match not safe: ' + best.id });
        continue;
      }
      try {
        this.choreo.register(rule.name, rule.topic, best.id);
        this.seeded.push({ name: rule.name, topic: rule.topic, capabilityId: best.id });
      } catch (e) {
        this.skipped.push({ name: rule.name, topic: rule.topic, reason: e.message });
      }
    }
    return { ok: true, seeded: this.seeded.slice(), skipped: this.skipped.slice(),
      version: GUARDED_VERSION_289 };
  }

  list() {
    return { rules: DEFAULT_PLAYBOOK_289.slice(),
      seeded: this.seeded.slice(), skipped: this.skipped.slice(),
      version: GUARDED_VERSION_289 };
  }
}

// ── Consolidation worker ────────────────────────────────────────────────────
const SACRED_BASENAMES_289 = new Set(['fiatLedger.js', 'auditLog.js']);

class ConsolidationWorker289 {
  constructor(opts = {}) {
    if (!opts.graph) throw new Error('ConsolidationWorker289 requires {graph}');
    this.graph = opts.graph;
    this.libDir = opts.libDir || path.resolve(__dirname);
  }

  /**
   * Plan a `latest` alias for each module that has at least one newer version
   * AND at least one stale duplicate. Never targets sacred basenames. Pure
   * computation; writes nothing.
   */
  plan() {
    // Bucket capabilities by base module name; pick highest-version module for each.
    const byBase = new Map(); // baseModule -> { latest: {module, version}, versions: Set<string> }
    for (const cap of this.graph.capabilities) {
      const base = cap.module.replace(/\d+$/, '');
      if (SACRED_BASENAMES_289.has(base + '.js')) continue;
      const entry = byBase.get(base) || { latest: null, versions: new Set() };
      entry.versions.add(cap.module);
      if (!entry.latest || (cap.version || 0) > (entry.latest.version || 0)) {
        entry.latest = { module: cap.module, version: cap.version || 0 };
      }
      byBase.set(base, entry);
    }
    const aliases = [];
    const deprecations = [];
    for (const [base, info] of byBase.entries()) {
      // Only worth aliasing if there's >1 version AND a real "latest".
      if (info.versions.size < 2 || !info.latest) continue;
      const aliasFile = path.join(this.libDir, base + 'Latest289.js');
      const targetRel = './' + info.latest.module + '.js';
      aliases.push({ aliasFile, aliasModule: base + 'Latest289', target: targetRel });
      for (const v of info.versions) {
        if (v !== info.latest.module) deprecations.push({ module: v, supersededBy: info.latest.module });
      }
    }
    return { ok: true, aliases, deprecations, totalAliases: aliases.length,
      totalDeprecations: deprecations.length, version: GUARDED_VERSION_289 };
  }

  /**
   * Materialise the planned aliases on disk. Gated on `{confirm:true}`. Refuses
   * to overwrite any existing file (idempotent: same plan, same output).
   */
  apply(opts = {}) {
    if (!opts || opts.confirm !== true) {
      return { ok: false, error: 'confirm:true required to write alias files', code: 'NO_CONFIRM' };
    }
    const plan = this.plan();
    const written = [];
    const skipped = [];
    for (const a of plan.aliases) {
      const base = path.basename(a.aliasFile);
      if (SACRED_BASENAMES_289.has(base)) {
        skipped.push({ aliasFile: a.aliasFile, reason: 'sacred basename' }); continue;
      }
      if (fs.existsSync(a.aliasFile)) {
        skipped.push({ aliasFile: a.aliasFile, reason: 'already exists' }); continue;
      }
      const body =
        "'use strict';\n" +
        "// AUTO-GENERATED V289 alias — re-exports the newest version of " + a.aliasModule.replace(/Latest289$/, '') + ".\n" +
        "// Pure pass-through: same surface as the underlying module, no transformation.\n" +
        "module.exports = require('" + a.target + "');\n";
      try {
        fs.writeFileSync(a.aliasFile, body);
        written.push(a);
      } catch (e) {
        skipped.push({ aliasFile: a.aliasFile, reason: e.message });
      }
    }
    return { ok: true, written, skipped, deprecations: plan.deprecations,
      version: GUARDED_VERSION_289 };
  }
}

// ── Streaming dispatch log ──────────────────────────────────────────────────
class DispatchStream289 {
  constructor(opts = {}) {
    if (!opts.bus) throw new Error('DispatchStream289 requires {bus}');
    this.bus = opts.bus;
    this.ring = [];
    this.listeners = new Set(); // (entry) => void
    this._unsubscribe = this.bus.subscribe('mesh.dispatched', (msg) => {
      const entry = msg && msg.payload;
      if (!entry) return;
      this.ring.push(entry);
      if (this.ring.length > STREAM_RING_MAX_289) this.ring.shift();
      for (const fn of this.listeners) { try { fn(entry); } catch (_) {} }
    });
  }

  /** Register an SSE listener; returns an unsubscribe function. */
  addListener(fn) {
    if (typeof fn !== 'function') throw new Error('listener must be a function');
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Snapshot of the most recent N events (for SSE "replay on connect"). */
  snapshot(n = 20) { return this.ring.slice(-Math.max(0, n | 0)); }

  /** Render an entry as an SSE chunk string. */
  static toSseChunk289(entry) {
    return 'event: mesh.dispatched\n' +
           'data: ' + JSON.stringify(entry) + '\n\n';
  }

  stats() {
    return { listeners: this.listeners.size, buffered: this.ring.length,
      version: GUARDED_VERSION_289 };
  }

  close() { try { this._unsubscribe && this._unsubscribe(); } catch (_) {} this.listeners.clear(); }
}

module.exports = {
  GUARDED_VERSION_289,
  STREAM_RING_MAX_289,
  DEFAULT_PLAYBOOK_289,
  SACRED_BASENAMES_289,
  GuardedDispatcher289,
  DefaultPlaybook289,
  ConsolidationWorker289,
  DispatchStream289,
};
