/**
 * tests/semanticDriftMonitor.test.js — V121
 * Tests for semantic drift monitoring layer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SemanticDriftMonitor,
  DOMAIN_PROFILES,
  ALERT_LEVELS,
} from '../lib/semanticDriftMonitor.js';

// Helper: feed N readings into a monitor
function feed(monitor, domain, scores) {
  let last;
  for (const s of scores) {
    last = monitor.record(domain, s);
  }
  return last;
}

// ── Basic recording ───────────────────────────────────────────────────────────

describe('SemanticDriftMonitor — basic recording', () => {
  let monitor;
  beforeEach(() => { monitor = new SemanticDriftMonitor(); });

  it('returns NONE alert when not enough samples', () => {
    monitor.record('LEGAL', 0.80);
    monitor.record('LEGAL', 0.79);
    const r = monitor.record('LEGAL', 0.78);
    expect(r.alertLevel).toBe(ALERT_LEVELS.NONE);
    expect(r.domain).toBe('LEGAL');
    expect(r.domainType).toBe('brittle');
  });

  it('returns NONE for stable high-confidence readings', () => {
    const scores = [0.85, 0.86, 0.84, 0.85, 0.86, 0.87];
    const r = feed(monitor, 'CODE', scores);
    expect(r.alertLevel).toBe(ALERT_LEVELS.NONE);
  });

  it('assigns GENERAL profile for unknown domain', () => {
    const r = monitor.record('UNKNOWN_DOMAIN', 0.70);
    expect(r.domainType).toBe('ductile'); // GENERAL is ductile
  });
});

// ── Drift detection ───────────────────────────────────────────────────────────

describe('SemanticDriftMonitor — drift detection', () => {
  let monitor;
  beforeEach(() => { monitor = new SemanticDriftMonitor(); });

  it('detects WARN on gradual downward velocity', () => {
    // Slowly declining scores
    const scores = [0.80, 0.78, 0.76, 0.74, 0.72, 0.70, 0.68, 0.66, 0.64, 0.62];
    const r = feed(monitor, 'GENERAL', scores);
    expect([ALERT_LEVELS.WARN, ALERT_LEVELS.ALERT, ALERT_LEVELS.CRITICAL]).toContain(r.alertLevel);
  });

  it('detects CRITICAL on rapid collapse (metastable — CODE domain)', () => {
    // Stable then sudden collapse
    const scores = [0.90, 0.89, 0.90, 0.88, 0.89, 0.90, 0.88, 0.50, 0.40, 0.30];
    const r = feed(monitor, 'CODE', scores);
    expect(r.alertLevel).toBe(ALERT_LEVELS.CRITICAL);
    expect(r.recommendation).toBe('force_hitl');
  });

  it('detects ALERT on accelerating downward trend (brittle — LEGAL)', () => {
    // Accelerating decline
    const scores = [0.85, 0.83, 0.80, 0.76, 0.70, 0.62];
    const r = feed(monitor, 'LEGAL', scores);
    expect([ALERT_LEVELS.ALERT, ALERT_LEVELS.CRITICAL]).toContain(r.alertLevel);
  });
});

// ── Summary and reset ─────────────────────────────────────────────────────────

describe('SemanticDriftMonitor — summary and reset', () => {
  let monitor;
  beforeEach(() => { monitor = new SemanticDriftMonitor(); });

  it('summary includes all recorded domains', () => {
    monitor.record('LEGAL', 0.80);
    monitor.record('CODE', 0.75);
    monitor.record('FINANCE', 0.90);
    const s = monitor.summary();
    expect(Object.keys(s)).toContain('LEGAL');
    expect(Object.keys(s)).toContain('CODE');
    expect(Object.keys(s)).toContain('FINANCE');
  });

  it('reset clears domain history', () => {
    feed(monitor, 'LEGAL', [0.80, 0.75, 0.70, 0.60, 0.50, 0.40]);
    monitor.reset('LEGAL');
    const r = monitor.record('LEGAL', 0.80);
    expect(r.alertLevel).toBe(ALERT_LEVELS.NONE); // fresh start
  });

  it('resetAll clears everything', () => {
    monitor.record('CODE', 0.80);
    monitor.record('LEGAL', 0.80);
    monitor.resetAll();
    const s = monitor.summary();
    expect(Object.keys(s)).toHaveLength(0);
  });
});

// ── Report structure ──────────────────────────────────────────────────────────

describe('SemanticDriftMonitor — report structure', () => {
  let monitor;
  beforeEach(() => { monitor = new SemanticDriftMonitor(); });

  it('report has all required fields', () => {
    const r = feed(monitor, 'FINANCE', [0.85, 0.80, 0.74, 0.65, 0.54]);
    expect(r).toHaveProperty('domain');
    expect(r).toHaveProperty('domainType');
    expect(r).toHaveProperty('alertLevel');
    expect(r).toHaveProperty('recommendation');
    expect(r).toHaveProperty('velocity');
    expect(r).toHaveProperty('acceleration');
    expect(r).toHaveProperty('recentReadings');
    expect(r).toHaveProperty('timestamp');
  });

  it('getAlert returns NONE for untracked domain', () => {
    const r = monitor.getAlert('UNTRACKED');
    expect(r.alertLevel).toBe(ALERT_LEVELS.NONE);
    expect(r.recommendation).toBe('nominal');
  });
});

// ── DOMAIN_PROFILES export ────────────────────────────────────────────────────

describe('DOMAIN_PROFILES', () => {
  it('all expected domains are defined', () => {
    const expected = ['LEGAL', 'FINANCE', 'CODE', 'MEDICAL', 'NARRATIVE', 'GENERAL'];
    for (const d of expected) {
      expect(DOMAIN_PROFILES).toHaveProperty(d);
    }
  });

  it('brittle domains have smaller windows than ductile', () => {
    expect(DOMAIN_PROFILES.LEGAL.window).toBeLessThan(DOMAIN_PROFILES.NARRATIVE.window);
    expect(DOMAIN_PROFILES.FINANCE.window).toBeLessThan(DOMAIN_PROFILES.GENERAL.window);
  });
});
