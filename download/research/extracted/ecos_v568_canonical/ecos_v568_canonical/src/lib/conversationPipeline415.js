'use strict';
/**
 * src/lib/conversationPipeline415.js — ECOS V415 (Phase P303) — Live Chat Turn Pipeline
 *
 * V415 wires assessTurn414 into the LIVE chat turn pipeline so every assistant
 * response is ASSESSED and AUTO-ADJUSTED (hedge/route/trim/de-flatter) BEFORE
 * the user sees it. This is the load-bearing step the NEXT_SESSION_PROMPT_V414
 * called "High-leverage #1".
 *
 * The pipeline executes in three stages:
 *   1. PRE-TURN: route the user message through routeIntent414 → resolve capability
 *   2. ASSESS: assessTurn414 on the draft response (with grounding from stage 1)
 *   3. APPLY:  apply adjustments from the assessment (hedge, trim, de-flatten) and
 *              produce a final response object with full quality metadata attached
 *
 * The pipeline also:
 *   - feeds every turn into SelfImprovementLoop414 (so assessments accumulate)
 *   - writes an audit entry per turn (tamper-evident, R1-compliant)
 *   - gates money-touching routes through a mustPassMoneyGuard flag (V402 contract)
 *   - is purely in-memory, zero new npm deps (R3/R6), sacred files untouched (R1)
 *
 * @version 415.0.0
 */

const {
  assessTurn414, routeIntent414,
  Conversation414, SelfImprovementLoop414, defaultSelfImprovementLoop414,
} = require('./conversationIntelligence414.js');

const PIPELINE_VERSION_415 = '415.0.0';

// ── text adjustment helpers ──────────────────────────────────────────────────

const _FLATTERY_OPENERS_415 = [
  /^(great|excellent|amazing|fantastic|brilliant|wonderful)\s+(question|point|idea|observation)[!.]?\s*/i,
  /^what\s+a\s+(great|fantastic|wonderful)[^.]*[.!]?\s*/i,
  /^(absolutely|totally|certainly)!\s*/i,
];

function _removeFlattery415(text) {
  let t = String(text || '');
  for (const p of _FLATTERY_OPENERS_415) t = t.replace(p, '');
  return t.trimStart();
}

function _addHedge415(text) {
  const t = String(text || '');
  if (/\b(i'm not sure|i do not know|might|could be|i believe|as far as i know|verify|uncertain|i can't confirm)\b/i.test(t)) return t;
  return 'Note: this answer is unverified — please confirm before acting. ' + t;
}

function _trim415(text, maxSentences = 12) {
  const sentences = String(text || '').match(/[^.!?]*[.!?]+(\s|$)/g) || [text];
  if (sentences.length <= maxSentences) return text;
  return sentences.slice(0, maxSentences).join('').trimEnd() + ' [trimmed for brevity]';
}

// ── core pipeline ────────────────────────────────────────────────────────────

/**
 * Run a single chat turn through the full assess+adjust pipeline.
 *
 * @param {object} p
 * @param {string}  p.userMessage       - The user's message
 * @param {string}  p.draftResponse     - The draft assistant response (before pipeline)
 * @param {object}  [p.meshRouter]      - IntentRouter287 instance (optional)
 * @param {object}  [p.conversation]    - Conversation414 instance (optional; for anti-amnesia)
 * @param {function}[p.audit]           - audit(type, data) hook (optional)
 * @param {number}  [p.maxSentences]    - verbosity cap (default 12)
 * @param {object}  [p.improvementLoop] - SelfImprovementLoop414 instance (optional)
 * @returns {object} PipelineResult415
 */
function runTurn415(p = {}) {
  const user        = String(p.userMessage   || '');
  const draft       = String(p.draftResponse || '');
  const router      = p.meshRouter      || null;
  const conv        = p.conversation    || null;
  const audit       = typeof p.audit === 'function' ? p.audit : null;
  const maxS        = p.maxSentences    || 12;
  const loop        = p.improvementLoop || defaultSelfImprovementLoop414();

  // 1) route intent → resolve capability + grounding
  const routing     = routeIntent414(user, router);
  const grounding   = {
    routedToTool: routing.matched,
    sources:      routing.matched ? [routing.capability] : [],
    fromMemory:   false,
  };

  // 2) assess the draft
  const assessment  = assessTurn414({
    userMessage:  user,
    draftResponse: draft,
    grounding,
    maxSentences: maxS,
  });

  // 3) apply adjustments
  let finalText = draft;
  const applied = [];

  if (assessment.adjustments.includes('remove_flattery')) {
    finalText = _removeFlattery415(finalText);
    applied.push('remove_flattery');
  }
  if (assessment.adjustments.includes('hedge_or_cite')) {
    finalText = _addHedge415(finalText);
    applied.push('hedge_or_cite');
  }
  if (assessment.adjustments.includes('trim')) {
    finalText = _trim415(finalText, maxS);
    applied.push('trim');
  }
  // 'route_to_capability' adjustment is advisory (caller must act on routing.capability)

  // 4) track in conversation (anti-amnesia)
  if (conv instanceof Conversation414) {
    conv.addTurn('user',      user,      { routing });
    conv.addTurn('assistant', finalText, { assessment });
  }

  // 5) audit entry (tamper-evident per R1)
  const turnId415 = 'turn415_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  if (audit) {
    try {
      audit('chat.turn415', {
        turnId: turnId415,
        verdict: assessment.verdict,
        adjustmentsApplied: applied,
        mustPassMoneyGuard: routing.mustPassMoneyGuard,
        groundingState: assessment.groundingState,
        confidence: assessment.confidence,
      });
    } catch (_) {}
  }

  // 6) feed into self-improvement loop for aggregate learning
  // We record a lightweight signal so the loop accumulates data from real usage
  try {
    if (assessment.verdict === 'revise') {
      loop.recordFeedback(turnId415, 'negative', assessment.reasons[0] || 'quality');
    }
    // positive signal only when clean pass and grounded (avoid noise)
    if (assessment.verdict === 'ok' && grounding.routedToTool) {
      loop.recordFeedback(turnId415, 'positive', 'grounded_turn');
    }
  } catch (_) {}

  return {
    version: PIPELINE_VERSION_415,
    turnId: turnId415,
    finalResponse: finalText,
    originalDraft: draft,
    assessment,
    routing,
    adjustmentsApplied: applied,
    mustPassMoneyGuard: routing.mustPassMoneyGuard,
    conversationState: conv instanceof Conversation414 ? conv.summary() : null,
  };
}

/**
 * Create a pipeline-bound Conversation415 session.
 * Convenience wrapper — returns a Conversation414 with an attached runTurn helper.
 */
function createSession415(opts = {}) {
  const id   = opts.id   || ('session415_' + Date.now());
  const goal = opts.goal || null;
  const conv = new Conversation414(id, goal);
  const loop = opts.improvementLoop || defaultSelfImprovementLoop414();

  return {
    id,
    conversation: conv,
    improvementLoop: loop,

    /** Run a single turn through the pipeline, mutating conv in place. */
    turn(userMessage, draftResponse, extra = {}) {
      return runTurn415(Object.assign({
        userMessage, draftResponse,
        conversation: conv,
        improvementLoop: loop,
      }, extra));
    },

    summary() {
      return { session: conv.summary(), improvement: loop.report() };
    },
  };
}

module.exports = {
  PIPELINE_VERSION_415,
  runTurn415,
  createSession415,
  // exported helpers for tests
  _removeFlattery415,
  _addHedge415,
  _trim415,
};
