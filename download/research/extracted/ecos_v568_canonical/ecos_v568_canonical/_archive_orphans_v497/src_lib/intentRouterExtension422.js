'use strict';
/**
 * src/lib/intentRouterExtension422.js — ECOS V422 (Phase P310) — Multi-Modal Intent Routing
 *
 * Extends V414 routeIntent414 with a richer intent taxonomy so routing is more
 * accurate for edge-case user intents. Adds multi-modal hints, multi-intent
 * detection, confidence scoring per intent type, and edge-case flags.
 *
 * All new identifiers end in 422 (R2). No new npm deps (R3). Sacred untouched (R1).
 *
 * @version 422.0.0
 */

const { routeIntent414 } = require('../../lib/conversationIntelligence414.js');

const INTENT_ROUTER_VERSION_422 = '422.0.0';

// ── Rich intent taxonomy patterns (edge-case aware) ──────────────────────────
const _RICH_INTENT_PATTERNS_422 = Object.freeze({
  clarification: [ /\bwhat\s+do\s+you\s+mean\b/i, /\bexplain\b/i, /\bclarify\b/i, /\bdid\s+you\s+say\b/i, /\brephrase\b/i ],
  comparison:    [ /\bvs\b/i, /\bversus\b/i, /\bcompare\b/i, /\bdifference\s+between\b/i, /\bbetter\s+than\b/i, /\bpros?\s+and\s+cons\b/i ],
  summarization: [ /\bsummarize\b/i, /\btl;?dr\b/i, /\bbrief\b/i, /\bshort\s+version\b/i, /\bgive\s+me\s+the\s+gist\b/i, /\bkey\s+points\b/i ],
  creative:      [ /\bwrite\b/i, /\bdraft\b/i, /\bpoem\b/i, /\bstory\b/i, /\bcompose\b/i, /\bgenerate\s+(a|an)\b/i ],
  code:          [ /\bcode\b/i, /\bfunction\b/i, /\bscript\b/i, /\bprogram\b/i, /\bimplement\b/i, /\balgorithm\b/i, /\bpseudocode\b/i ],
  analysis:      [ /\banalyze\b/i, /\bevaluate\b/i, /\bassess\b/i, /\bbreak\s+down\b/i, /\bexamine\b/i, /\binterpret\b/i ],
  meta:          [ /\bhelp\b/i, /\bcommands\b/i, /\bwhat\s+can\s+you\s+do\b/i, /\bcapabilities\b/i, /\bhow\s+do\s+i\b/i, /\bmenu\b/i ],
  image:         [ /\bimage\b/i, /\bpicture\b/i, /\bphoto\b/i, /\bdiagram\b/i, /\bchart\b/i, /\bvisual\b/i, /\bgenerate\s+(an?\s+)?image\b/i ],
  audio:         [ /\baudio\b/i, /\bvoice\b/i, /\bsound\b/i, /\bpodcast\b/i, /\bnarration\b/i, /\bspeak\b/i ],
  table:         [ /\btable\b/i, /\bcsv\b/i, /\bspreadsheet\b/i, /\brows?\s+and\s+columns?\b/i, /\bdata\s+sheet\b/i ],
  calculator:    [ /\bcalculate\b/i, /\bmath\b/i, /\bcompute\b/i, /\bsum\b/i, /\bmultiply\b/i, /\bdivide\b/i, /\bequation\b/i, /\bsolve\b/i ],
  translation:   [ /\btranslat(e|ion)\b/i, /\bin\s+(spanish|french|german|chinese|hebrew|arabic|japanese|korean|portuguese|russian|italian)\b/i, /\bto\s+(spanish|french|german|chinese|hebrew|arabic|japanese|korean|portuguese|russian|italian)\b/i ],
  scheduling:    [ /\bschedule\b/i, /\bremind\s+me\b/i, /\bset\s+a\s+timer\b/i, /\balarm\b/i, /\bcalendar\b/i, /\bdeadline\b/i ],
});

// ── Edge-case patterns (ambiguous / hard-to-route) ─────────────────────────
const _EDGE_CASE_PATTERNS_422 = Object.freeze([
  /\bor\b.*\bor\b/i,               // multiple OR branches
  /\bdepends?\b/i,                  // conditional request
  /\bmaybe\b/i,                    // uncertain intent
  /\bsomething\s+like\b/i,          // vague reference
  /\bwhatever\b/i,                  // open-ended
  /\bjust\b.*\bcheck\b/i,          // casual monitoring
  /\bcan\s+you\b.*\band\b.*\bcan\s+you\b/i, // compound multi-request
]);

function _matchesAny422(text, patterns) {
  return patterns.some(p => p.test(text));
}

function _scoreIntents422(text) {
  const scores = {};
  const lower = String(text || '').toLowerCase();
  for (const [intent, patterns] of Object.entries(_RICH_INTENT_PATTERNS_422)) {
    let hits = 0;
    for (const p of patterns) {
      const m = lower.match(p);
      if (m) hits += (m[0].length / lower.length) + 1; // longer matches score higher
    }
    scores[intent] = Math.min(1, hits / 3); // normalize roughly
  }
  return scores;
}

function _detectEdgeCase422(text) {
  const t = String(text || '');
  return _matchesAny422(t, _EDGE_CASE_PATTERNS_422);
}

function _multimodalHint422(text, richScores) {
  const hints = [];
  if (richScores.image >= 0.3) hints.push('image');
  if (richScores.audio >= 0.3) hints.push('audio');
  if (richScores.table >= 0.3) hints.push('table');
  if (richScores.code >= 0.3) hints.push('code');
  return hints;
}

// ── routeIntent422 — richer taxonomy wrapper around routeIntent414 ────────────

/**
 * Route a user message with richer intent taxonomy and edge-case detection.
 * Returns everything routeIntent414 returns, plus rich intent metadata.
 * @param {string} userMessage
 * @param {object} meshRouter  IntentRouter287 instance
 * @returns {object}
 */
function routeIntent422(userMessage, meshRouter) {
  // Base V414 routing (preserved — R6)
  const base = routeIntent414(userMessage, meshRouter);

  const richScores = _scoreIntents422(userMessage);
  const edgeCase = _detectEdgeCase422(userMessage);

  // Pick primary rich intent (highest score above threshold)
  const threshold = 0.25;
  let primaryIntent = null;
  let primaryScore = 0;
  for (const [intent, score] of Object.entries(richScores)) {
    if (score >= threshold && score > primaryScore) {
      primaryIntent = intent;
      primaryScore = score;
    }
  }

  // If V414 says 'action' but our rich taxonomy finds a more specific creative/code/etc intent,
  // we still keep V414's action flag for backwards compatibility but annotate richer type.
  const richIntentTypes = Object.entries(richScores)
    .filter(([, s]) => s >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([name, confidence]) => ({ name, confidence: Math.round(confidence * 100) / 100 }));

  return Object.assign({}, base, {
    richIntentTypes422: richIntentTypes,
    primaryIntent422: primaryIntent,
    primaryIntentConfidence422: Math.round(primaryScore * 100) / 100,
    edgeCaseDetected422: edgeCase,
    multimodalHint422: _multimodalHint422(userMessage, richScores),
    taxonomyVersion422: INTENT_ROUTER_VERSION_422,
    note422: 'V422 rich taxonomy extends V414 base routing; base fields remain unchanged (R6)',
  });
}

// ── assessTurn422 — minimal extension marker (not required by prompt, but useful) ──
// Kept out because the prompt only asks to extend routeIntent414.

module.exports = {
  INTENT_ROUTER_VERSION_422,
  routeIntent422,
  _RICH_INTENT_PATTERNS_422,
  _EDGE_CASE_PATTERNS_422,
};
