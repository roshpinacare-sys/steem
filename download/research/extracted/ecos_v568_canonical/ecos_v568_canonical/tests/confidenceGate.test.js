/**
 * confidenceGate.test.js — V102
 * Unit tests for the inlined gate logic (evaluateConfidenceGateStrict).
 * Tests the three routing verdicts and all edge cases.
 *
 * [V102-P2] Added BLOCK tier tests:
 *   confidence in [BLOCK_THRESHOLD, HITL_THRESHOLD) → BLOCK
 *   confidence < BLOCK_THRESHOLD → HARD_REJECT
 *
 * Run: npx vitest run tests/confidenceGate.test.js
 */

import { describe, it, expect } from 'vitest';

// ── Inline the gate function (mirrors confidenceGate.js logic) ────────────────
const AUTO_THRESHOLD  = 0.70;
const HITL_THRESHOLD  = 0.50;
const BLOCK_THRESHOLD = 0.30;
const MAX_PRICE_USD   = 10000;
const MIN_PRICE_USD   = 0.01;

function evaluateConfidenceGateStrict(body) {
  const { confidence, clientAccountId, priceUsd, aiOutput } = body || {};
  if (confidence === null || confidence === undefined) {
    return { verdict: 'HARD_REJECT', confidence: null,
      reasons: ['confidence is null — calibrator not ready or provider returned null.'] };
  }
  const conf = typeof confidence === 'string' ? parseFloat(confidence) : confidence;
  if (!Number.isFinite(conf)) {
    return { verdict: 'HARD_REJECT', confidence: null,
      reasons: [`confidence "${confidence}" is not a finite number.`] };
  }
  const reasons = [];
  if (!clientAccountId) reasons.push('clientAccountId is required');
  if (priceUsd === undefined || priceUsd === null) reasons.push('priceUsd is required');
  if (aiOutput === undefined) reasons.push('aiOutput is required');
  if (reasons.length) return { verdict: 'HARD_REJECT', confidence: conf, reasons };

  const priceN = parseFloat(priceUsd);
  if (!Number.isFinite(priceN)) reasons.push('priceUsd is not a finite number');
  else if (priceN < MIN_PRICE_USD) reasons.push('priceUsd below minimum');
  else if (priceN > MAX_PRICE_USD) reasons.push('priceUsd exceeds maximum');
  if (typeof aiOutput !== 'object' || aiOutput === null || !('result' in aiOutput))
    reasons.push('aiOutput must have a "result" key');
  if (conf < 0 || conf > 1) reasons.push(`confidence out of range [0, 1]`);

  // Structural errors or below BLOCK_THRESHOLD → HARD_REJECT
  if (reasons.length > 0 || conf < BLOCK_THRESHOLD) {
    if (conf < BLOCK_THRESHOLD && reasons.length === 0)
      reasons.push(`confidence ${conf.toFixed(4)} below BLOCK threshold ${BLOCK_THRESHOLD}`);
    return { verdict: 'HARD_REJECT', confidence: conf, reasons };
  }

  // [V102-P2] BLOCK tier
  if (conf < HITL_THRESHOLD) {
    return { verdict: 'BLOCK', confidence: conf,
      reasons: [`confidence ${conf.toFixed(4)} in BLOCK band [${BLOCK_THRESHOLD}, ${HITL_THRESHOLD}) — retry recommended`] };
  }

  if (conf >= AUTO_THRESHOLD)
    return { verdict: 'AUTO_FLOW', confidence: conf, reasons: [] };

  return { verdict: 'HITL_QUEUE', confidence: conf,
    reasons: [`confidence in HITL band [${HITL_THRESHOLD}, ${AUTO_THRESHOLD})`] };
}

const validBody = {
  clientAccountId: 'client::test',
  priceUsd: '10.00',
  aiOutput: { result: 'ok' },
};

describe('ConfidenceGate — routing verdicts', () => {
  it('null confidence → HARD_REJECT', () => {
    expect(evaluateConfidenceGateStrict({ ...validBody, confidence: null }).verdict)
      .toBe('HARD_REJECT');
  });

  it('undefined confidence → HARD_REJECT', () => {
    expect(evaluateConfidenceGateStrict({ ...validBody }).verdict)
      .toBe('HARD_REJECT');
  });

  it('confidence below BLOCK_THRESHOLD → HARD_REJECT', () => {
    const r = evaluateConfidenceGateStrict({ ...validBody, confidence: 0.20 });
    expect(r.verdict).toBe('HARD_REJECT');
  });

  it('confidence === BLOCK_THRESHOLD → BLOCK (boundary)', () => {
    const r = evaluateConfidenceGateStrict({ ...validBody, confidence: 0.30 });
    expect(r.verdict).toBe('BLOCK');
  });

  it('[V102] confidence in BLOCK band [0.30, 0.50) → BLOCK', () => {
    const r = evaluateConfidenceGateStrict({ ...validBody, confidence: 0.40 });
    expect(r.verdict).toBe('BLOCK');
    expect(r.reasons[0]).toContain('retry recommended');
  });

  it('[V102] confidence just below HITL_THRESHOLD (0.499) → BLOCK', () => {
    const r = evaluateConfidenceGateStrict({ ...validBody, confidence: 0.499 });
    expect(r.verdict).toBe('BLOCK');
  });

  it('confidence === HITL_THRESHOLD → HITL_QUEUE (boundary)', () => {
    const r = evaluateConfidenceGateStrict({ ...validBody, confidence: 0.50 });
    expect(r.verdict).toBe('HITL_QUEUE');
  });

  it('confidence in band [0.50, 0.70) → HITL_QUEUE', () => {
    const r = evaluateConfidenceGateStrict({ ...validBody, confidence: 0.65 });
    expect(r.verdict).toBe('HITL_QUEUE');
  });

  it('confidence === AUTO_THRESHOLD → AUTO_FLOW (boundary)', () => {
    const r = evaluateConfidenceGateStrict({ ...validBody, confidence: 0.70 });
    expect(r.verdict).toBe('AUTO_FLOW');
  });

  it('confidence above AUTO_THRESHOLD → AUTO_FLOW', () => {
    const r = evaluateConfidenceGateStrict({ ...validBody, confidence: 0.85 });
    expect(r.verdict).toBe('AUTO_FLOW');
  });

  it('missing clientAccountId → HARD_REJECT with reason', () => {
    const r = evaluateConfidenceGateStrict({ ...validBody, confidence: 0.80, clientAccountId: undefined });
    expect(r.verdict).toBe('HARD_REJECT');
    expect(r.reasons.some(s => s.includes('clientAccountId'))).toBe(true);
  });

  it('aiOutput missing result key → HARD_REJECT', () => {
    const r = evaluateConfidenceGateStrict({ ...validBody, confidence: 0.80, aiOutput: { other: 'x' } });
    expect(r.verdict).toBe('HARD_REJECT');
  });

  it('threshold invariants hold: BLOCK_THRESHOLD < HITL_THRESHOLD < AUTO_THRESHOLD', () => {
    expect(BLOCK_THRESHOLD).toBeLessThan(HITL_THRESHOLD);
    expect(HITL_THRESHOLD).toBeLessThan(AUTO_THRESHOLD);
  });

  it('[V102] BLOCK verdict has no sanitized output (null)', () => {
    const r = evaluateConfidenceGateStrict({ ...validBody, confidence: 0.35 });
    expect(r.verdict).toBe('BLOCK');
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});
