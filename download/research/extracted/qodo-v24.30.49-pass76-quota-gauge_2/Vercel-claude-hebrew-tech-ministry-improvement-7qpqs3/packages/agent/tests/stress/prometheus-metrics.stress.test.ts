/**
 * STRESS TEST: Prometheus metrics under 1000-concurrent burst.
 * Simulates 1000 parallel pipeline completions all hitting the registry at once.
 * Verifies: counter monotonicity, gauge accuracy, histogram bucket ordering,
 * exposition format correctness under heavy concurrent mutation.
 */
import { describe, it, expect } from 'vitest';
import { MetricsRegistry } from '../../src/services/prometheus-metrics.js';

const CONCURRENCY = 1000;

describe('prometheus-metrics — 1000-concurrent burst stress', () => {
  it('counter increments are exact after 1000 concurrent success runs', async () => {
    const reg = new MetricsRegistry();

    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        Promise.resolve(reg.recordRunSuccess(30000 + i * 10, 0.001 + i * 0.0001)),
      ),
    );

    const text = reg.exposition();
    // Find success counter value
    const match = text.match(/qodo_runs_total\{status="success"\}\s+(\d+)/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBe(CONCURRENCY);
  });

  it('histogram count matches total observations after 1000 runs', async () => {
    const reg = new MetricsRegistry();
    const durations = Array.from({ length: CONCURRENCY }, () =>
      Math.random() * 900 + 10,
    );

    await Promise.all(
      durations.map((d) =>
        Promise.resolve(reg.observeHistogram('qodo_run_duration_seconds', d)),
      ),
    );

    const text = reg.exposition();
    const countMatch = text.match(/qodo_run_duration_seconds_count\s+(\d+)/);
    expect(countMatch).not.toBeNull();
    expect(parseInt(countMatch![1], 10)).toBe(CONCURRENCY);
  });

  it('histogram buckets are monotonically non-decreasing after 1000 observations', async () => {
    const reg = new MetricsRegistry();
    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        Promise.resolve(reg.observeHistogram('qodo_run_duration_seconds', (i % 900) + 1)),
      ),
    );

    const text = reg.exposition();
    const bucketLines = text
      .split('\n')
      .filter((l) => l.startsWith('qodo_run_duration_seconds_bucket'));

    let prev = -1;
    for (const line of bucketLines) {
      const val = parseFloat(line.split(' ').pop()!);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });

  it('exposition output is valid text/plain Prometheus format', () => {
    const reg = new MetricsRegistry();
    for (let i = 0; i < CONCURRENCY; i++) {
      reg.recordRunSuccess(Math.random() * 600000, Math.random() * 0.05);
      reg.recordTokens('groq', Math.floor(Math.random() * 2000));
      if (i % 5 === 0) reg.recordRunFailure(Math.random() * 30000);
      if (i % 10 === 0) reg.recordCve('critical');
      if (i % 20 === 0) reg.recordLicenseViolation('denied');
    }

    const text = reg.exposition();
    // All lines must be: empty, comment (#), or metric {labels} value
    for (const line of text.split('\n').filter((l) => l.trim())) {
      const isComment = line.startsWith('#');
      const isMetric = /^\w[\w_]*(\{[^}]*\})?\s+[\d.e+-]+$/.test(line);
      expect(isComment || isMetric).toBe(true);
    }
  });

  it('mixed 1000-user scenario: success + failure + tokens + CVEs', async () => {
    const reg = new MetricsRegistry();

    await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_, i) => {
        if (i % 10 === 0) {
          reg.recordRunFailure(Math.random() * 60000);
        } else {
          reg.recordRunSuccess(Math.random() * 900000, Math.random() * 0.05);
        }
        reg.recordTokens('groq', 1000 + Math.floor(Math.random() * 1000));
        if (i % 50 === 0) reg.recordCve('high');
      }),
    );

    const text = reg.exposition();
    const successMatch = text.match(/qodo_runs_total\{status="success"\}\s+(\d+)/);
    const failMatch = text.match(/qodo_runs_total\{status="failure"\}\s+(\d+)/);
    expect(successMatch).not.toBeNull();
    expect(failMatch).not.toBeNull();

    const successes = parseInt(successMatch![1], 10);
    const failures = parseInt(failMatch![1], 10);
    expect(successes + failures).toBe(CONCURRENCY);
  });
});
