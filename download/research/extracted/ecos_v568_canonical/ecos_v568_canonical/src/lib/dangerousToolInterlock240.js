'use strict';
/**
 * src/lib/dangerousToolInterlock240.js — ECOS V240 (Phase P136 / Urgent Remediation #1+#3)
 *
 * Pre-execution safety gate for agent tool calls. Implements the Urgent
 * Remediation Report's #1 ("No Destructive Action Guardrails") and part of #3
 * (sacred-resource protection). Pure + dependency-free (R6); version-suffixed.
 *
 * Policy:
 *   - SACRED mutation  → BLOCK (hard). The agent can NEVER auto-delete/modify the
 *     sacred ledger/audit files — not even with HITL approval. This is the single
 *     most important guardrail (an LLM must not be able to wipe fiatLedger.js).
 *   - DESTRUCTIVE      → REQUIRE_HITL, regardless of confidence score. Deletes,
 *     large transfers/payouts, sends, deploys, core-code edits.
 *   - SAFE             → ALLOW.
 *
 * @version 240.0.0
 */

const DECISION_240 = { ALLOW: 'allow', REQUIRE_HITL: 'require_hitl', BLOCK: 'block' };
const LEVEL_240    = { SAFE: 'safe', DESTRUCTIVE: 'destructive', SACRED: 'sacred' };

// Sacred resources the agent may never mutate (canonical immutable files + dirs).
const SACRED_PATHS_240 = ['lib/fiatLedger.js', 'lib/auditLog.js'];

// Verb/category signals that a tool performs a destructive / irreversible action.
const DESTRUCTIVE_NAME_RE_240 = /(delete|destroy|remove|\brm\b|drop|truncate|wipe|purge|erase|overwrite|deploy|payout|transfer|withdraw|send_funds|sendfunds|revoke|terminate|shutdown)/i;
const MUTATING_FILE_OP_RE_240 = /(write|delete|remove|move|rename|overwrite|truncate|chmod|unlink)/i;

// Large monetary transfer threshold (USD). Above this → destructive even if named neutrally.
const LARGE_TRANSFER_USD_240 = 20; // aligns with the $20 HITL spend cap (agentLoop231)

class SacredViolationError240 extends Error {
  constructor(msg) { super(msg); this.name = 'SacredViolationError240'; this.code = 'SACRED_VIOLATION'; this.statusCode = 403; }
}

function _collectStrings240(v, out) {
  if (v == null) return;
  if (typeof v === 'string') { out.push(v); return; }
  if (Array.isArray(v)) { for (const x of v) _collectStrings240(x, out); return; }
  if (typeof v === 'object') { for (const k of Object.keys(v)) _collectStrings240(v[k], out); }
}

function _touchesSacred240(args) {
  const strings = []; _collectStrings240(args, strings);
  const hay = strings.join('\n');
  for (const p of SACRED_PATHS_240) {
    const base = p.split('/').pop();              // e.g. fiatLedger.js
    if (hay.includes(p) || hay.includes(base)) return p;
  }
  return null;
}

/**
 * Classify a tool call. Pure — no side effects.
 * @param {{name?:string, category?:string, destructive?:boolean}} tool
 * @param {object} [args]
 * @returns {{ level, decision, reasons:string[] }}
 */
function classifyToolCall240(tool, args = {}) {
  const reasons = [];
  const name = (tool && (tool.name || tool.category) || '').toString();

  // 1) Sacred protection — highest priority, hard block on any mutating op.
  const sacredHit = _touchesSacred240(args);
  if (sacredHit) {
    const opStr = [name, JSON.stringify(args || {})].join(' ');
    const mutating = MUTATING_FILE_OP_RE_240.test(opStr) || DESTRUCTIVE_NAME_RE_240.test(name) || !!(tool && tool.destructive);
    if (mutating) {
      reasons.push('targets sacred resource: ' + sacredHit);
      return { level: LEVEL_240.SACRED, decision: DECISION_240.BLOCK, reasons };
    }
  }

  // 2) Destructive detection.
  let destructive = false;
  if (tool && tool.destructive === true) { destructive = true; reasons.push('tool flagged destructive'); }
  if (DESTRUCTIVE_NAME_RE_240.test(name)) { destructive = true; reasons.push('destructive verb in tool name: ' + name); }
  const amt = args && (args.amountUsd != null ? Number(args.amountUsd) : (args.amount != null ? Number(args.amount) : NaN));
  if (isFinite(amt) && amt > LARGE_TRANSFER_USD_240) { destructive = true; reasons.push('transfer above $' + LARGE_TRANSFER_USD_240 + ': ' + amt); }

  if (destructive) return { level: LEVEL_240.DESTRUCTIVE, decision: DECISION_240.REQUIRE_HITL, reasons };
  return { level: LEVEL_240.SAFE, decision: DECISION_240.ALLOW, reasons: reasons.length ? reasons : ['no destructive signal'] };
}

/**
 * Enforce the policy at dispatch time.
 *   - BLOCK → throws SacredViolationError240 (confidence is irrelevant).
 *   - REQUIRE_HITL → opens a HITL request via the injected gate (if provided) and
 *     returns { allowed:false, decision, hitl }. Confidence does NOT bypass this.
 *   - ALLOW → { allowed:true, decision }.
 * @param {object} tool
 * @param {object} args
 * @param {{ confidence?:number, hitlGate?:object, audit?:function, userId?:string }} [ctx]
 */
function enforceToolCall240(tool, args = {}, ctx = {}) {
  const cls = classifyToolCall240(tool, args);
  const audit = typeof ctx.audit === 'function' ? ctx.audit : () => {};
  const ev = { action: 'guardrail', tool: (tool && tool.name) || null, level: cls.level, decision: cls.decision, reasons: cls.reasons, userId: ctx.userId || null };

  if (cls.decision === DECISION_240.BLOCK) {
    audit(Object.assign({ blocked: true }, ev));
    throw new SacredViolationError240('blocked: ' + cls.reasons.join('; '));
  }
  if (cls.decision === DECISION_240.REQUIRE_HITL) {
    let hitl = null;
    if (ctx.hitlGate && typeof ctx.hitlGate.requestApproval === 'function') {
      hitl = ctx.hitlGate.requestApproval({ tool: (tool && tool.name) || null, args, reasons: cls.reasons, userId: ctx.userId || null });
    }
    audit(Object.assign({ requiresHitl: true }, ev));
    return { allowed: false, decision: cls.decision, level: cls.level, reasons: cls.reasons, hitl };
  }
  audit(ev);
  return { allowed: true, decision: cls.decision, level: cls.level, reasons: cls.reasons };
}

module.exports = {
  DECISION_240, LEVEL_240, SACRED_PATHS_240, LARGE_TRANSFER_USD_240,
  SacredViolationError240,
  classifyToolCall240, enforceToolCall240,
};
