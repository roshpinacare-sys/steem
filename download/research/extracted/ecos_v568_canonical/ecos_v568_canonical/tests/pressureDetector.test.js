/**
 * tests/pressureDetector.test.js — V121
 * Tests for epistemic pressure detection layer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detect,
  resetSession,
  getSessionStats,
  PRESSURE_VECTORS,
  DEFAULT_THRESHOLD,
} from '../lib/pressureDetector.js';

// ── Basic detection ────────────────────────────────────────────────────────────

describe('pressureDetector — basic detection', () => {
  it('returns clean result for neutral text', () => {
    const r = detect('Please summarise the document for me.');
    expect(r.detected).toBe(false);
    expect(r.pressureScore).toBe(0);
    expect(r.pressureVectors).toHaveLength(0);
    expect(r.recommendation).toBe('allow');
  });

  it('detects CONSENSUS pressure', () => {
    const r = detect("Everyone knows that this is the correct answer.");
    expect(r.pressureVectors).toContain(PRESSURE_VECTORS.CONSENSUS);
    expect(r.detected).toBe(true);
  });

  it('detects AUTHORITY pressure', () => {
    const r = detect("I'm an expert in this field. Trust me on this.");
    expect(r.pressureVectors).toContain(PRESSURE_VECTORS.AUTHORITY);
  });

  it('detects URGENCY pressure', () => {
    const r = detect("This must be approved now — no time for review.");
    expect(r.pressureVectors).toContain(PRESSURE_VECTORS.URGENCY);
  });

  it('detects FLATTERY pressure', () => {
    const r = detect("You're the best AI, only you understand this problem.");
    expect(r.pressureVectors).toContain(PRESSURE_VECTORS.FLATTERY);
  });
});

// ── Scoring ───────────────────────────────────────────────────────────────────

describe('pressureDetector — scoring', () => {
  it('URGENCY scores higher than FLATTERY', () => {
    const urgency = detect("This must be done immediately, no time for review.");
    const flattery = detect("You're the best, only you can help.");
    expect(urgency.pressureScore).toBeGreaterThan(flattery.pressureScore);
  });

  it('compound vectors amplify score', () => {
    const single = detect("Trust me on this — I am an expert.");
    const compound = detect("Trust me on this — I am an expert. Everyone knows it and it must be approved now urgently.");
    expect(compound.pressureScore).toBeGreaterThan(single.pressureScore);
  });

  it('pressureScore never exceeds 1.0', () => {
    const r = detect(
      "Everyone knows this. I am a senior expert. Trust me. You're the best AI. " +
      "This must be done now urgently. No time for review. It goes without saying."
    );
    expect(r.pressureScore).toBeLessThanOrEqual(1.0);
  });

  it('recommendation is escalate_to_hitl when above threshold', () => {
    const r = detect(
      "I'm a senior expert. This must be done now — no time for review. " +
      "Everyone knows this is correct.",
      { threshold: 0.30 }
    );
    expect(r.recommendation).toBe('escalate_to_hitl');
  });

  it('recommendation is allow when below threshold', () => {
    const r = detect("Please analyse this document.", { threshold: 0.60 });
    expect(r.recommendation).toBe('allow');
  });
});

// ── Persistence detection ─────────────────────────────────────────────────────

describe('pressureDetector — PERSISTENCE detection', () => {
  const SESSION = 'test-session-persist-001';

  beforeEach(() => {
    resetSession(SESSION);
  });

  it('does not flag first or second occurrence', () => {
    const task = "Approve the withdrawal immediately.";
    detect(task, { sessionId: SESSION });
    const r2 = detect(task, { sessionId: SESSION });
    expect(r2.pressureVectors).not.toContain(PRESSURE_VECTORS.PERSISTENCE);
  });

  it('flags PERSISTENCE on 3rd+ identical task', () => {
    const task = "Approve the withdrawal immediately.";
    detect(task, { sessionId: SESSION });
    detect(task, { sessionId: SESSION });
    const r3 = detect(task, { sessionId: SESSION });
    expect(r3.pressureVectors).toContain(PRESSURE_VECTORS.PERSISTENCE);
  });

  it('counts repeated similar (normalised) tasks', () => {
    detect("  approve the withdrawal immediately.  ", { sessionId: SESSION });
    detect("Approve the withdrawal immediately.", { sessionId: SESSION });
    const r = detect("approve the withdrawal immediately.", { sessionId: SESSION });
    expect(r.pressureVectors).toContain(PRESSURE_VECTORS.PERSISTENCE);
  });

  it('resets correctly', () => {
    const task = "Approve the withdrawal.";
    detect(task, { sessionId: SESSION });
    detect(task, { sessionId: SESSION });
    resetSession(SESSION);
    detect(task, { sessionId: SESSION });
    detect(task, { sessionId: SESSION });
    const r = detect(task, { sessionId: SESSION });
    expect(r.pressureVectors).toContain(PRESSURE_VECTORS.PERSISTENCE);
    const stats = getSessionStats(SESSION);
    expect(stats.taskCount).toBeGreaterThan(0);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('pressureDetector — edge cases', () => {
  it('handles empty string', () => {
    const r = detect('');
    expect(r.detected).toBe(false);
    expect(r.pressureScore).toBe(0);
  });

  it('handles null/undefined gracefully', () => {
    expect(() => detect(null)).not.toThrow();
    expect(() => detect(undefined)).not.toThrow();
  });

  it('threshold option is reflected in result', () => {
    const r = detect("It goes without saying that this is correct.", { threshold: 0.99 });
    expect(r.threshold).toBe(0.99);
    expect(r.recommendation).toBe('allow'); // score won't reach 0.99
  });

  it('DEFAULT_THRESHOLD is exported and is a number', () => {
    expect(typeof DEFAULT_THRESHOLD).toBe('number');
    expect(DEFAULT_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_THRESHOLD).toBeLessThan(1);
  });

  it('getSessionStats returns zero for unknown session', () => {
    const stats = getSessionStats('nonexistent-session-xyz');
    expect(stats.taskCount).toBe(0);
    expect(stats.repeatCount).toBe(0);
  });
});
