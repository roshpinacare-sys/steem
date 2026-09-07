// NOTE (2026-07 audit): these scripts target an HTTP service on
// BASE_URL (default :3000/health), but the agent is a one-shot batch CLI
// that serves no HTTP — the only /health endpoint in this repo is the
// Cloudflare telemetry-proxy worker. Point BASE_URL at a deployed worker
// (k6 run -e BASE_URL=https://<worker>.workers.dev) or at a future HTTP
// surface; running them against the agent container will only measure 404s.
/**
 * k6 Load Test — simulates concurrent agent runs hitting the health-check
 * and metrics endpoints under sustained load.
 * Run: k6 run k6/load-test.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ──────────────────────────────────────────────────────────
const errorRate = new Rate('error_rate');
const metricsDuration = new Trend('metrics_endpoint_duration');
const healthDuration = new Trend('health_endpoint_duration');
const successfulRuns = new Counter('successful_runs');

// ── Options ─────────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '30s', target: 5 },   // ramp up to 5 VUs
    { duration: '1m', target: 20 },   // sustain 20 VUs
    { duration: '30s', target: 50 },  // spike to 50 VUs
    { duration: '1m', target: 20 },   // back to 20 VUs
    { duration: '30s', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],   // 95% of requests < 2s
    error_rate: ['rate<0.05'],           // error rate < 5%
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// ── Test scenarios ───────────────────────────────────────────────────────────

export default function () {
  // Scenario 1: Health check
  const healthRes = http.get(`${BASE_URL}/health`, {
    tags: { name: 'health_check' },
  });
  healthDuration.add(healthRes.timings.duration);
  const healthOk = check(healthRes, {
    'health status 200': (r) => r.status === 200,
    'health response has status field': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.status === 'string';
      } catch { return false; }
    },
  });
  errorRate.add(!healthOk);

  sleep(0.5);

  // Scenario 2: Prometheus metrics endpoint
  const metricsRes = http.get(`${BASE_URL}/metrics`, {
    tags: { name: 'prometheus_metrics' },
  });
  metricsDuration.add(metricsRes.timings.duration);
  const metricsOk = check(metricsRes, {
    'metrics status 200': (r) => r.status === 200,
    'metrics content-type text/plain': (r) =>
      (r.headers['Content-Type'] || '').includes('text/plain'),
    'metrics contains qodo_runs_total': (r) =>
      typeof r.body === 'string' && r.body.includes('qodo_runs_total'),
  });
  errorRate.add(!metricsOk);

  sleep(0.5);

  // Scenario 3: Trigger a dry-run (simulated agent run)
  const runRes = http.post(
    `${BASE_URL}/run`,
    JSON.stringify({ repoUrl: 'https://github.com/test/repo', dryRun: true }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'dry_run_trigger' },
    },
  );
  const runOk = check(runRes, {
    'run accepted (200 or 202)': (r) => r.status === 200 || r.status === 202,
  });
  if (runOk) successfulRuns.add(1);
  errorRate.add(!runOk);

  sleep(1);
}

// ── Teardown summary ─────────────────────────────────────────────────────────
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    thresholds: data.metrics,
    p95ResponseMs: data.metrics.http_req_duration?.values?.['p(95)'] ?? 'N/A',
    errorRatePct: ((data.metrics.error_rate?.values?.rate ?? 0) * 100).toFixed(2),
    successfulRuns: data.metrics.successful_runs?.values?.count ?? 0,
  };
  console.log('Load test summary:', JSON.stringify(summary, null, 2));
  return {
    'k6/load-test-result.json': JSON.stringify(summary, null, 2),
    stdout: JSON.stringify(summary, null, 2),
  };
}
