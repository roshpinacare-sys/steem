/**
 * Unit tests for Observability services:
 * prometheus-metrics, slo-tracker, alerting-rules, otel-tracer.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── Prometheus Metrics ─────────────────────────────────────────────────────
import { MetricsRegistry } from '../src/services/prometheus-metrics.js';

describe('prometheus-metrics', () => {
  it('exposition output contains expected metric names', () => {
    const reg = new MetricsRegistry();
    reg.recordRunSuccess(45000, 0.003);
    reg.recordTokens('groq', 1500);
    const text = reg.exposition();
    expect(text).toContain('qodo_runs_total');
    expect(text).toContain('qodo_run_duration_seconds');
    expect(text).toContain('qodo_tokens_used_total');
  });

  it('counter increments correctly', () => {
    const reg = new MetricsRegistry();
    reg.recordRunSuccess(10000, 0.001);
    reg.recordRunSuccess(20000, 0.002);
    reg.recordRunFailure(5000);
    const text = reg.exposition();
    expect(text).toContain('status="success"} 2');
    expect(text).toContain('status="failure"} 1');
  });

  it('histogram buckets are monotonically non-decreasing', () => {
    const reg = new MetricsRegistry();
    [30, 120, 600, 850].forEach((s) => reg.observeHistogram('qodo_run_duration_seconds', s));
    const text = reg.exposition();
    const bucketLines = text
      .split('\n')
      .filter((l) => l.includes('qodo_run_duration_seconds_bucket'));
    let prev = -1;
    for (const line of bucketLines) {
      const val = parseFloat(line.split(' ').pop()!);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });

  it('escapes Prometheus label values containing quotes, backslashes and newlines', () => {
    const reg = new MetricsRegistry();
    reg.incCounter('qodo_tokens_used_total', { model: 'groq\n"custom"' }, 1);
    const text = reg.exposition();
    expect(text).not.toContain('model="groq\n"custom""');
    expect(text).toContain('model="groq\\n\\"custom\\""');
    expect(text).toContain('qodo_tokens_used_total{model="groq\\n\\"custom\\""} 1');
  });
});

// ── SLO Tracker ────────────────────────────────────────────────────────────
import { recordRunSample, computeSloReport } from '../src/services/slo-tracker.js';

describe('slo-tracker', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qodo-slo-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('SLO-1 met when all runs < 900s', () => {
    for (let i = 0; i < 10; i++) {
      recordRunSample(dir, `run-${i}`, 300 + i * 10, true);
    }
    const report = computeSloReport(dir);
    expect(report.slo1.met).toBe(true);
  });

  it('SLO-1 breached when p90 > 900s', () => {
    for (let i = 0; i < 9; i++) {
      recordRunSample(dir, `run-${i}`, 200, true);
    }
    recordRunSample(dir, 'run-slow', 1800, true); // p10 but drags p90 in small sample
    // Need majority slow to breach p90
    for (let i = 10; i < 20; i++) {
      recordRunSample(dir, `run-${i}`, 1200, true);
    }
    const report = computeSloReport(dir);
    expect(report.slo1.met).toBe(false);
  });

  it('SLO-2 breached when error rate > 10%', () => {
    for (let i = 0; i < 8; i++) recordRunSample(dir, `ok-${i}`, 100, true);
    for (let i = 0; i < 3; i++) recordRunSample(dir, `fail-${i}`, 100, false);
    const report = computeSloReport(dir);
    expect(report.slo2.met).toBe(false);
  });
});

// ── Alerting Rules ─────────────────────────────────────────────────────────
import { evaluateAlerts } from '../src/services/alerting-rules.js';

function okSloReport() {
  return {
    slo1: { target: 'p90 < 900s', actual: 'p90 = 200s', met: true, p90DurationS: 200 },
    slo2: { target: 'error rate < 10%', actual: 'error rate = 2%', met: true, errorRatePct: 2 },
    samples: 50,
    window: 200,
    generatedAt: new Date().toISOString(),
  };
}

describe('alerting-rules', () => {
  it('no alerts when everything is fine', () => {
    const alerts = evaluateAlerts({
      currentCostUsd: 0.005,
      rollingAvgCostUsd: 0.004,
      recentErrorRatePct: 3,
      sloReport: okSloReport(),
      criticalCveCount: 0,
    });
    expect(alerts).toHaveLength(0);
  });

  it('fires cost_spike alert when cost is 2x average', () => {
    const alerts = evaluateAlerts({
      currentCostUsd: 0.012,
      rollingAvgCostUsd: 0.004,
      recentErrorRatePct: 2,
      sloReport: okSloReport(),
      criticalCveCount: 0,
    });
    expect(alerts.some((a) => a.rule === 'cost_spike')).toBe(true);
  });

  it('fires critical_cve alert', () => {
    const alerts = evaluateAlerts({
      currentCostUsd: 0.001,
      rollingAvgCostUsd: 0.001,
      recentErrorRatePct: 1,
      sloReport: okSloReport(),
      criticalCveCount: 2,
    });
    expect(alerts.some((a) => a.rule === 'critical_cve' && a.severity === 'CRITICAL')).toBe(true);
  });
});

// ── OTel Tracer ────────────────────────────────────────────────────────────
import { tracer } from '../src/services/otel-tracer.js';

describe('otel-tracer', () => {
  it('records finished span with correct fields', async () => {
    await tracer.withSpan('test.operation', async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const spans = tracer.getSpans();
    const span = spans.find((s) => s.name === 'test.operation');
    expect(span).toBeDefined();
    expect(span!.status).toBe('OK');
    expect(span!.durationMs).toBeGreaterThan(0);
    expect(span!.traceId).toHaveLength(32);
  });

  it('marks span as ERROR when fn throws', async () => {
    await expect(
      tracer.withSpan('test.failing', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    const spans = tracer.getSpans();
    const span = spans.find((s) => s.name === 'test.failing');
    expect(span?.status).toBe('ERROR');
    expect(span?.errorMessage).toContain('boom');
  });
});
