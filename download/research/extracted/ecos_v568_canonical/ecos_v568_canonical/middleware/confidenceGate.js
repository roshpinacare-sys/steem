/**
 * ECOS Confidence Gate Middleware
 * --------------------------------
 * Enforces the Bounded AI contract at the API layer:
 *
 *   confidence >= AUTO_THRESHOLD (0.70) AND schema valid AND amount in range
 *     → AUTO_FLOW
 *
 *   confidence in [HITL_THRESHOLD, AUTO_THRESHOLD) (0.50-0.70)
 *   OR schema anomaly detected
 *     → HITL_QUEUE + pg_notify('hitl_queue', payload)
 *
 *   confidence in [BLOCK_THRESHOLD, HITL_THRESHOLD) (0.30-0.50)
 *     → BLOCK  (422 with verdict:"BLOCK" — logged, no approval created)
 *
 *   confidence < BLOCK_THRESHOLD (0.30) OR schema invalid OR amount out of range
 *     → HARD_REJECT (422 with verdict:"HARD_REJECT" — no approval created)
 *
 * [V102-P2] Three-tier trust model: AUTO_FLOW / HITL_QUEUE / BLOCK / HARD_REJECT
 *   BLOCK tier distinguishes "AI output too uncertain for human review" from
 *   "AI output is structurally invalid".  Callers can route BLOCK differently
 *   (e.g. retry with a different model) without treating it as a hard error.
 *
 * Iron Rule: the AI gateway NEVER calls resolveApproval — only createApproval.
 * Resolution is exclusively for human validators and the rule-engine.
 *
 * [FIX-V25-4] notifyHitlQueue console.error → injectable logger.
 *   Function signature: notifyHitlQueue(approvalId, missionId, confidence, priceUsd, log?)
 *   log parameter is optional — fallback to console.error for callers that don't inject.
 */

'use strict';

const { getPool } = require('../db/pool');

// ---------------------------------------------------------------------------
// Thresholds (tune via env for A/B rollout without code changes)
// ---------------------------------------------------------------------------
// [FIX-V16-THRESHOLD] HITL_THRESHOLD lowered from 0.75 to 0.50.
// [V102-P2] BLOCK_THRESHOLD: separates BLOCK (retry candidate) from HARD_REJECT (structural error).
const AUTO_THRESHOLD  = parseFloat(process.env.CONFIDENCE_AUTO  || '0.70');
const HITL_THRESHOLD  = parseFloat(process.env.CONFIDENCE_HITL  || '0.50');
const BLOCK_THRESHOLD = parseFloat(process.env.CONFIDENCE_BLOCK || '0.30');

// [FIX-V17-GATE-ASSERT] Runtime assertion to prevent gate inversion and dead HITL_QUEUE
if (HITL_THRESHOLD >= AUTO_THRESHOLD) {
  throw new Error(
    `CRITICAL_CONFIG_ERROR: HITL_THRESHOLD (${HITL_THRESHOLD}) must be strictly less than AUTO_THRESHOLD (${AUTO_THRESHOLD}).`
  );
}
if (BLOCK_THRESHOLD >= HITL_THRESHOLD) {
  throw new Error(
    `CRITICAL_CONFIG_ERROR: BLOCK_THRESHOLD (${BLOCK_THRESHOLD}) must be strictly less than HITL_THRESHOLD (${HITL_THRESHOLD}).`
  );
}

const MAX_PRICE_USD  = parseFloat(process.env.MAX_PRICE_USD    || '10000');
const MIN_PRICE_USD  = parseFloat(process.env.MIN_PRICE_USD    || '0.01');

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

const REQUIRED_AI_OUTPUT_KEYS = ['result'];
const MAX_OUTPUT_BYTES = 512 * 1024; // 512 KB

function _validateAiOutput(aiOutput) {
  const issues = [];
  if (aiOutput === null || typeof aiOutput !== 'object' || Array.isArray(aiOutput)) {
    issues.push('aiOutput must be a non-null object');
    return issues;
  }
  const raw = JSON.stringify(aiOutput);
  if (Buffer.byteLength(raw) > MAX_OUTPUT_BYTES) {
    issues.push(`aiOutput exceeds ${MAX_OUTPUT_BYTES / 1024}KB size limit`);
  }
  for (const key of REQUIRED_AI_OUTPUT_KEYS) {
    if (!(key in aiOutput)) issues.push(`aiOutput missing required key: "${key}"`);
  }
  return issues;
}

function _validatePrice(priceUsd) {
  const n = parseFloat(priceUsd);
  if (!Number.isFinite(n))    return 'priceUsd is not a finite number';
  if (n < MIN_PRICE_USD)      return `priceUsd ${n} below minimum ${MIN_PRICE_USD}`;
  if (n > MAX_PRICE_USD)      return `priceUsd ${n} exceeds maximum ${MAX_PRICE_USD}`;
  return null;
}

// ---------------------------------------------------------------------------
// Main gate function
// ---------------------------------------------------------------------------

/**
 * @param {object} body  Parsed POST body from the approvals route
 * @returns {{ verdict, confidence, reasons, sanitized }}
 */
function evaluateConfidenceGate(body) {
  const {
    clientAccountId,
    priceUsd,
    aiOutput,
    context = {},
    confidence,
    taskType = 'default',
    similarityKeys = [],
  } = body || {};

  const reasons = [];

  // 1. Structural pre-checks
  if (!clientAccountId) reasons.push('clientAccountId is required');
  if (priceUsd === undefined || priceUsd === null) reasons.push('priceUsd is required');
  if (aiOutput === undefined) reasons.push('aiOutput is required');

  if (reasons.length) {
    return { verdict: 'HARD_REJECT', confidence: 0, reasons, sanitized: null };
  }

  // 2. Price range check
  const priceErr = _validatePrice(priceUsd);
  if (priceErr) reasons.push(priceErr);

  // 3. AI output schema check
  const outputIssues = _validateAiOutput(aiOutput);
  reasons.push(...outputIssues);

  // 4. Confidence parsing and range check
  const conf = typeof confidence === 'number' ? confidence :
               typeof confidence === 'string' ? parseFloat(confidence) :
               NaN;

  if (!Number.isFinite(conf)) {
    reasons.push('confidence must be a finite number between 0 and 1');
  } else if (conf < 0 || conf > 1) {
    reasons.push(`confidence ${conf} out of range [0, 1]`);
  }

  // 5. Verdict
  const sanitized = {
    clientAccountId,
    priceUsd: String(priceUsd),
    aiOutput,
    context,
    confidence: Number.isFinite(conf) ? conf : null,
    taskType,
    similarityKeys,
  };

  if (reasons.length > 0 || !Number.isFinite(conf) || conf < BLOCK_THRESHOLD) {
    if (Number.isFinite(conf) && conf < BLOCK_THRESHOLD && reasons.length === 0) {
      reasons.push(`confidence ${conf.toFixed(4)} below BLOCK threshold ${BLOCK_THRESHOLD} — hard reject`);
    }
    return { verdict: 'HARD_REJECT', confidence: conf, reasons, sanitized: null };
  }

  // [V102-P2] BLOCK tier: confidence is finite but below HITL threshold
  // The output is not a structural error — the AI just isn't confident enough
  // for human review.  Callers should retry with a different model or prompt.
  if (conf < HITL_THRESHOLD) {
    return {
      verdict: 'BLOCK',
      confidence: conf,
      reasons: [`confidence ${conf.toFixed(4)} in BLOCK band [${BLOCK_THRESHOLD}, ${HITL_THRESHOLD}) — retry recommended`],
      sanitized: null,
    };
  }

  if (conf >= AUTO_THRESHOLD && reasons.length === 0) {
    return { verdict: 'AUTO_FLOW', confidence: conf, reasons: [], sanitized };
  }

  return {
    verdict: 'HITL_QUEUE',
    confidence: conf,
    reasons: reasons.length
      ? reasons
      : [`confidence ${conf.toFixed(4)} in HITL band [${HITL_THRESHOLD}, ${AUTO_THRESHOLD})`],
    sanitized,
  };
}

// ---------------------------------------------------------------------------
// pg NOTIFY helper
// [FIX-V25-4] accepts optional log parameter — pino logger child from server.
// Non-blocking: if NOTIFY fails, we log but don't throw.
// ---------------------------------------------------------------------------

/**
 * @param {string} approvalId
 * @param {string} missionId
 * @param {number} confidence
 * @param {string} priceUsd
 * @param {{ error: Function }|null} [log]  — optional pino logger (inject from server)
 */
async function notifyHitlQueue(approvalId, missionId, confidence, priceUsd, log) {
  const payload = JSON.stringify({
    approvalId, missionId, confidence, priceUsd,
    ts: new Date().toISOString(),
  });
  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query(`SELECT pg_notify('hitl_queue', $1)`, [payload]);
    } finally {
      client.release();
    }
  } catch (err) {
    // [FIX-V25-4] was: console.error(...)
    if (log && typeof log.error === 'function') {
      log.error({ component: 'confidence-gate', approvalId, err: err.message }, 'NOTIFY hitl_queue failed');
    } else {
      // eslint-disable-next-line no-console
      console.error('[confidence-gate] NOTIFY hitl_queue failed:', err.message);
    }
  }
}

module.exports = {
  evaluateConfidenceGate,
  notifyHitlQueue,
  AUTO_THRESHOLD,
  HITL_THRESHOLD,
  BLOCK_THRESHOLD,
  MAX_PRICE_USD,
  MIN_PRICE_USD,
};
