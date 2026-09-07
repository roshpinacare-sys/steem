'use strict';
/**
 * src/lib/conversationIntelligence414.js — ECOS V414 (Phase P302) — Conversation Intelligence
 *
 * The pilot's heart is the chat. This layer governs HOW the chat behaves toward the
 * user, turning the most-complained-about AI weaknesses into enforced strengths, and
 * making the system LEARN from real usage. It is not a new model — it is a quality /
 * behavior layer that wraps each turn and routes intent to REAL capabilities (so the
 * chat does, not just talks). It connects existing infra: the V287 mesh IntentRouter
 * (route to real tools), the audit log (tamper-evident feedback), and the V402
 * money-guard (any money-touching action must pass the chokepoint).
 *
 * Known AI complaint            →  Enforced strength here
 * ───────────────────────────────────────────────────────────────────────────
 * sycophancy / flattery          →  sycophancy detection → truthful by design
 * hallucination / confident-wrong →  grounding state + uncertainty hedging
 * "just talks, doesn't do"        →  intent routing to real capabilities
 * opacity (no "why")             →  every turn carries grounding + confidence
 * verbosity / not actionable      →  actionability check + trim suggestion
 * context amnesia                →  conversation goal + turn tracking
 * never improves                  →  feedback loop → self-improvement report
 *
 * Pure JS, no new deps (R3/R6). Read-only over sacred. Version-suffixed (…414).
 *
 * @version 414.0.0
 */

const CONV_VERSION_414 = '414.0.0';

// ── heuristic signal detectors (real, detectable patterns — advisory, not censorship) ──
const _SYCOPHANCY_PATTERNS_414 = [
  /\b(great|excellent|amazing|fantastic|brilliant|wonderful)\s+(question|point|idea|observation)\b/i,
  /\byou'?re\s+(absolutely|totally|completely|so)\s+right\b/i,
  /\bi\s+(completely|totally|whole?heartedly)\s+agree\b/i,
  /\bwhat\s+a\s+(great|fantastic|wonderful)\b/i,
];
const _HEDGE_PATTERNS_414 = [
  /\bi'?m not (sure|certain)\b/i, /\bi\s+(don'?t|do not)\s+know\b/i, /\bmight\b/i, /\bcould be\b/i,
  /\bi\s+believe\b/i, /\bas far as i know\b/i, /\bverify\b/i, /\buncertain\b/i, /\bi\s+can'?t\s+confirm\b/i,
];
const _FACTUAL_CLAIM_PATTERNS_414 = [
  /\b\d{4}\b/, /\b\d+(\.\d+)?\s*(%|percent|usd|dollars|million|billion)\b/i,
  /\bis\s+the\s+(largest|first|only|best|fastest)\b/i, /\balways\b/i, /\bnever\b/i,
];
const _DO_INTENT_PATTERNS_414 = [
  /\b(send|transfer|pay|buy|sell|create|make|build|deploy|schedule|book|cancel|delete|update|set|register|mint|withdraw|swap|stake)\b/i,
];

function _matchesAny(text, patterns) { return patterns.some(p => p.test(text)); }
function _countSentences(text) { return (String(text).match(/[.!?]+(\s|$)/g) || []).length || 1; }

/**
 * Assess a candidate assistant turn. Returns quality metadata + a verdict the chat
 * layer applies BEFORE showing the response — turning weaknesses into strengths.
 * @param {{ userMessage, draftResponse, grounding?:{sources?:Array, routedToTool?:bool, fromMemory?:bool}, maxSentences?:number }} p
 */
function assessTurn414(p = {}) {
  const user = String(p.userMessage || '');
  const draft = String(p.draftResponse || '');
  const g = p.grounding || {};
  const reasons = []; const adjustments = [];

  // 1) grounding state — is the answer backed by a tool/memory/source, or free generation?
  const grounded = !!(g.routedToTool || g.fromMemory || (Array.isArray(g.sources) && g.sources.length > 0));
  const groundingState = grounded ? 'grounded' : 'ungrounded';

  // 2) hallucination guard — ungrounded factual/numeric claims should hedge or cite
  const makesFactualClaim = _matchesAny(draft, _FACTUAL_CLAIM_PATTERNS_414);
  const hasHedge = _matchesAny(draft, _HEDGE_PATTERNS_414);
  if (!grounded && makesFactualClaim && !hasHedge) {
    reasons.push('ungrounded factual claim without hedging or sources (hallucination risk)');
    adjustments.push('hedge_or_cite');
  }

  // 3) anti-sycophancy — flattery / pure agreement without substance
  const sycophantic = _matchesAny(draft, _SYCOPHANCY_PATTERNS_414);
  const sycophancyScore = sycophantic ? (draft.length < 200 ? 0.8 : 0.4) : 0.0;
  if (sycophancyScore >= 0.6) { reasons.push('sycophantic opener without substance — be truthful and direct'); adjustments.push('remove_flattery'); }

  // 4) actionability — a "do" request should route to a real capability, not just explain
  const isDoIntent = _matchesAny(user, _DO_INTENT_PATTERNS_414);
  const respondedWithAction = !!g.routedToTool;
  if (isDoIntent && !respondedWithAction) { reasons.push('user asked to DO something but the turn only explains — route to a capability'); adjustments.push('route_to_capability'); }

  // 5) verbosity — overly long answers to simple asks
  const maxS = p.maxSentences || 12;
  if (_countSentences(draft) > maxS) { reasons.push('response is long — trim to the actionable core'); adjustments.push('trim'); }

  // 6) confidence — high when grounded, low when ungrounded+claims
  let confidence = grounded ? 0.9 : (makesFactualClaim ? 0.35 : 0.6);
  if (hasHedge && !grounded) confidence = Math.max(confidence, 0.5);
  const shouldHedge = confidence < 0.5;

  const verdict = reasons.length === 0 ? 'ok' : 'revise';
  return {
    version: CONV_VERSION_414, verdict,
    groundingState, confidence: Math.round(confidence * 100) / 100, shouldHedge,
    sycophancyScore, actionable: !isDoIntent || respondedWithAction,
    reasons, adjustments,
  };
}

/**
 * Route a user message to a REAL capability via the V287 mesh IntentRouter, so the
 * chat can DO. Flags money-touching capabilities as requiring the V402 chokepoint.
 * @param {string} userMessage  @param {object} meshRouter  IntentRouter287 instance
 */
function routeIntent414(userMessage, meshRouter) {
  const isDo = _matchesAny(String(userMessage || ''), _DO_INTENT_PATTERNS_414);
  let route = null;
  try { if (meshRouter && typeof meshRouter.route === 'function') route = meshRouter.route(userMessage); } catch (_) {}
  const best = route && route.best ? route.best : null;
  const moneyTouching = best ? /credit|ledger|payment|transfer|withdraw|mint|payout|market|reserve|fiat/i.test(best.id || best.module || '') : false;
  return {
    intentType: isDo ? 'action' : 'question',
    matched: !!best,
    capability: best ? (best.id || best.module) : null,
    confidence: route ? route.confidence : 0,
    alternatives: route && route.alternatives ? route.alternatives.slice(0, 3).map(a => a.id || a.module) : [],
    mustPassMoneyGuard: moneyTouching,   // → caller MUST route through guardMint402/guardWithdraw402 (V402)
    note: 'advisory routing; money-touching capabilities require the V402 chokepoint',
  };
}

// ── conversation continuity (anti-amnesia) ───────────────────────────────────
class Conversation414 {
  constructor(id, goal) { this.id = id; this.goal = goal || null; this.turns = []; this.startedAt = Date.now(); }
  addTurn(role, text, meta) { this.turns.push({ role, text: String(text || ''), meta: meta || null, at: Date.now() }); return this.turns.length; }
  setGoal(goal) { this.goal = goal; }
  recentContext(n = 6) { return this.turns.slice(-n).map(t => ({ role: t.role, text: t.text })); }
  summary() { return { id: this.id, goal: this.goal, turnCount: this.turns.length, openSince: this.startedAt }; }
}

// ── self-improvement from real usage ─────────────────────────────────────────
class SelfImprovementLoop414 {
  constructor(opts = {}) {
    this.feedback = [];                 // {turnId, signal, topic, at}
    this.audit = typeof opts.audit === 'function' ? opts.audit : null;
    this.maxFeedback = opts.maxFeedback || 5000;
  }
  /** signal: 'positive' | 'negative' | 'correction'  */
  recordFeedback(turnId, signal, topic) {
    if (!['positive', 'negative', 'correction'].includes(signal)) throw new Error('signal must be positive|negative|correction');
    const entry = { turnId: String(turnId), signal, topic: topic || null, at: Date.now() };
    this.feedback.push(entry);
    if (this.feedback.length > this.maxFeedback) this.feedback.shift();
    if (this.audit) { try { this.audit('chat.feedback', { turnId: entry.turnId, signal, topic: entry.topic }); } catch (_) {} }
    return { recorded: true };
  }
  /** What has the system learned from usage? Drives behavior adjustments. */
  report() {
    const counts = { positive: 0, negative: 0, correction: 0 };
    const byTopic = {};
    for (const f of this.feedback) {
      counts[f.signal]++;
      if (f.topic) { byTopic[f.topic] = byTopic[f.topic] || { negative: 0, correction: 0, positive: 0 }; byTopic[f.topic][f.signal]++; }
    }
    const total = this.feedback.length || 1;
    const dissatisfaction = (counts.negative + counts.correction) / total;
    // adaptive recommendation: if corrections are frequent, increase grounding/hedging
    const recommendations = [];
    if (dissatisfaction > 0.3) recommendations.push('raise grounding/hedging thresholds — correction rate is high');
    const hotTopics = Object.entries(byTopic)
      .map(([t, c]) => ({ topic: t, corrections: c.correction, negatives: c.negative }))
      .filter(x => x.corrections + x.negatives >= 3)
      .sort((a, b) => (b.corrections + b.negatives) - (a.corrections + a.negatives)).slice(0, 10);
    return { totalFeedback: this.feedback.length, counts, dissatisfaction: Math.round(dissatisfaction * 100) / 100, hotTopics, recommendations };
  }
}

let _defaultLoop414 = null;
function defaultSelfImprovementLoop414(opts) { if (!_defaultLoop414) _defaultLoop414 = new SelfImprovementLoop414(opts); return _defaultLoop414; }

module.exports = {
  CONV_VERSION_414,
  assessTurn414, routeIntent414,
  Conversation414, SelfImprovementLoop414, defaultSelfImprovementLoop414,
  _matchesAny, _SYCOPHANCY_PATTERNS_414, _HEDGE_PATTERNS_414,
};
