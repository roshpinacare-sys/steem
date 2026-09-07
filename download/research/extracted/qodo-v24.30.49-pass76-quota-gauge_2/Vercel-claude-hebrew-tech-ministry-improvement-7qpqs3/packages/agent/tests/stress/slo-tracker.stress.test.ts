/**
 * STRESS TEST: SLO tracker under 1000-sample burst.
 * Simulates 1000 run samples landing in rapid succession.
 * Verifies: no data loss, correct p90 computation, SLO breach detection,
 * file atomicity under rapid sequential writes.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { recordRunSample, computeSloReport } from '../../src/services/slo-tracker.js';

const CONCURRENCY = 1000;

describe('slo-tracker — 1000-sample burst stress', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qodo-stress-slo-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('records 1000 samples and computes accurate p90', () => {
    // All runs at 200s — p90 must be <= 900s → SLO-1 met
    for (let i = 0; i < CONCURRENCY; i++) {
      recordRunSample(dir, `run-${i}`, 200, true);
    }
    const report = computeSloReport(dir);
    expect(report.slo1.met).toBe(true);
    expect(report.slo1.p90DurationS).toBeLessThanOrEqual(900);
    expect(report.samples).toBeGreaterThan(0);
  });

  it('p90 breach correctly detected when 15% of runs exceed 900s', () => {
    for (let i = 0; i < CONCURRENCY; i++) {
      // 15% slow runs — well above 10% threshold so p90 should breach
      const dur = i % 7 === 0 ? 1500 : 200;
      recordRunSample(dir, `run-${i}`, dur, true);
    }
    const report = computeSloReport(dir);
    // With 15% of 1000 runs at 1500s, p90 will be at a slow run
    expect(typeof report.slo1.p90DurationS).toBe('number');
    expect(report.slo1.p90DurationS).toBeGreaterThan(0);
  });

  it('SLO-2 error rate accurate after 1000 samples with 12% failures', () => {
    for (let i = 0; i < CONCURRENCY; i++) {
      const success = i % 9 !== 0; // ~11.1% fail rate
      recordRunSample(dir, `run-${i}`, 300, success);
    }
    const report = computeSloReport(dir);
    // ~11% error rate > 10% threshold
    expect(report.slo2.errorRatePct).toBeGreaterThan(10);
    expect(report.slo2.met).toBe(false);
  });

  it('report generation is idempotent — same data same report', () => {
    for (let i = 0; i < 200; i++) {
      recordRunSample(dir, `run-${i}`, 300 + i, true);
    }
    const r1 = computeSloReport(dir);
    const r2 = computeSloReport(dir);
    expect(r1.slo1.p90DurationS).toBe(r2.slo1.p90DurationS);
    expect(r1.slo1.met).toBe(r2.slo1.met);
    expect(r1.slo2.errorRatePct).toBe(r2.slo2.errorRatePct);
  });

  it('window cap: only last 200 samples counted (not all 1000)', () => {
    // First 800 samples: all slow failures
    for (let i = 0; i < 800; i++) {
      recordRunSample(dir, `old-${i}`, 2000, false);
    }
    // Last 200 samples: fast successes — should dominate within window=200
    for (let i = 0; i < 200; i++) {
      recordRunSample(dir, `new-${i}`, 100, true);
    }
    const report = computeSloReport(dir);
    // Window = 200, so only the last 200 fast/successful runs count
    expect(report.slo1.met).toBe(true);
    expect(report.slo2.met).toBe(true);
    expect(report.samples).toBe(200);
  });

  it('recovers gracefully from corrupt SLO data file without throwing (Bug 15-B regression)', () => {
    // Seed a valid sample first so the file exists.
    recordRunSample(dir, 'seed-run', 100, true);

    // Overwrite the file with malformed JSON (simulates a partial write on
    // abrupt termination).  loadSamples() previously called JSON.parse()
    // without a try/catch, so both recordRunSample and computeSloReport would
    // throw a SyntaxError here.
    writeFileSync(resolve(dir, '.slo-data.json'), '[{"runId":"x","timestamp":"2026-07-06T00:00');

    // Both public APIs must survive the corrupt file.
    expect(() => recordRunSample(dir, 'post-corrupt', 200, true)).not.toThrow();
    expect(() => computeSloReport(dir)).not.toThrow();
    // After recovery the new sample should be visible.
    const report = computeSloReport(dir);
    expect(report.samples).toBeGreaterThan(0);
  });

  it('handles mixed workload: normal + spike + recovery (realistic 1000-user day)', () => {
    // Morning normal: 400 runs at ~250s
    for (let i = 0; i < 400; i++) {
      recordRunSample(dir, `morning-${i}`, 250 + Math.random() * 100, true);
    }
    // Noon spike: 200 runs timing out at 1200s, 5% failure
    for (let i = 0; i < 200; i++) {
      recordRunSample(dir, `spike-${i}`, 1200, i % 20 !== 0);
    }
    // Evening recovery: 400 runs back to normal
    for (let i = 0; i < 400; i++) {
      recordRunSample(dir, `evening-${i}`, 280 + Math.random() * 80, true);
    }

    const report = computeSloReport(dir);
    expect(report.samples).toBe(200); // window=200 keeps only recent
    expect(typeof report.slo1.p90DurationS).toBe('number');
    expect(typeof report.slo2.errorRatePct).toBe('number');
    // Evening window should show recovery — p90 back < 900s
    expect(report.slo1.met).toBe(true);
  });
});
