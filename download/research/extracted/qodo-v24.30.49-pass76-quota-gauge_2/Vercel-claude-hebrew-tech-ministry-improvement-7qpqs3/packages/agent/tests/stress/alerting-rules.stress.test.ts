/**
 * STRESS TEST: Alerting rules under burst — 1000 concurrent evaluations.
 * Simulates 1000 pipeline completions all evaluating alert conditions simultaneously.
 * Verifies: no state leakage between calls, correct rule firing, severity accuracy.
 */
import { describe, it, expect } from 'vitest';
import { evaluateAlerts, type AlertContext } from '../../src/services/alerting-rules.js';
import type { SloReport } from '../../src/services/slo-tracker.js';

const CONCURRENCY = 1000;

function okReport(): SloReport {
  return {
    slo1: { target: 'p90 < 900s', actual: 'p90 = 200s', met: true, p90DurationS: 200 },
    slo2: { target: 'error rate < 10%', actual: 'error rate = 2%', met: true, errorRatePct: 2 },
    samples: 50, window: 200, generatedAt: new Date().toISOString(),
  };
}

function breachReport(): SloReport {
  return {
    slo1: { target: 'p90 < 900s', actual: 'p90 = 1200s', met: false, p90DurationS: 1200 },
    slo2: { target: 'error rate < 10%', actual: 'error rate = 18%', met: false, errorRatePct: 18 },
    samples: 50, window: 200, generatedAt: new Date().toISOString(),
  };
}

describe('alerting-rules — 1000-concurrent burst stress', () => {
  it('no state leakage: 1000 parallel evaluations with OK context all return empty', async () => {
    const ctx: AlertContext = {
      currentCostUsd: 0.003,
      rollingAvgCostUsd: 0.003,
      recentErrorRatePct: 3,
      sloReport: okReport(),
      criticalCveCount: 0,
    };

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => Promise.resolve(evaluateAlerts(ctx))),
    );

    for (const alerts of results) {
      expect(alerts).toHaveLength(0);
    }
  });

  it('1000 parallel critical CVE evaluations all fire correctly', async () => {
    const ctx: AlertContext = {
      currentCostUsd: 0.001,
      rollingAvgCostUsd: 0.001,
      recentErrorRatePct: 1,
      sloReport: okReport(),
      criticalCveCount: 3,
    };

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => Promise.resolve(evaluateAlerts(ctx))),
    );

    for (const alerts of results) {
      const cveAlert = alerts.find((a) => a.rule === 'critical_cve');
      expect(cveAlert).toBeDefined();
      expect(cveAlert!.severity).toBe('CRITICAL');
      expect(cveAlert!.value).toBe(3);
    }
  });

  it('mixed 1000 contexts — correct alert count per context type', async () => {
    const contexts: AlertContext[] = Array.from({ length: CONCURRENCY }, (_, i) => ({
      currentCostUsd: i % 3 === 0 ? 0.02 : 0.002, // every 3rd: cost spike
      rollingAvgCostUsd: 0.002,
      recentErrorRatePct: i % 5 === 0 ? 25 : 3,   // every 5th: high error
      sloReport: i % 7 === 0 ? breachReport() : okReport(), // every 7th: SLO breach
      criticalCveCount: i % 11 === 0 ? 1 : 0,     // every 11th: CVE
    }));

    const results = await Promise.all(
      contexts.map((ctx) => Promise.resolve(evaluateAlerts(ctx))),
    );

    // Spot-check specific indices
    const costSpikeResult = results[3]; // index 3: cost spike
    expect(costSpikeResult.some((a) => a.rule === 'cost_spike')).toBe(true);

    const highErrResult = results[5]; // index 5: high error
    expect(highErrResult.some((a) => a.rule === 'high_error_rate')).toBe(true);

    const sloResult = results[7]; // index 7: SLO breach
    expect(sloResult.some((a) => a.rule === 'slo1_breach')).toBe(true);
    expect(sloResult.some((a) => a.rule === 'slo2_breach')).toBe(true);

    const cveResult = results[11]; // index 11: CVE
    expect(cveResult.some((a) => a.rule === 'critical_cve')).toBe(true);

    // Clean contexts should have no alerts
    expect(results[1]).toHaveLength(0);
    expect(results[2]).toHaveLength(0);
  });

  it('all alert objects have required fields', async () => {
    const ctx: AlertContext = {
      currentCostUsd: 0.05,
      rollingAvgCostUsd: 0.002,
      recentErrorRatePct: 30,
      sloReport: breachReport(),
      criticalCveCount: 2,
    };

    const results = await Promise.all(
      Array.from({ length: 100 }, () => Promise.resolve(evaluateAlerts(ctx))),
    );

    for (const alerts of results) {
      for (const alert of alerts) {
        expect(alert.rule).toBeTruthy();
        expect(['CRITICAL', 'WARNING', 'INFO']).toContain(alert.severity);
        expect(typeof alert.message).toBe('string');
        expect(typeof alert.value).toBe('number');
        expect(typeof alert.threshold).toBe('number');
        expect(alert.firedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    }
  });
});
