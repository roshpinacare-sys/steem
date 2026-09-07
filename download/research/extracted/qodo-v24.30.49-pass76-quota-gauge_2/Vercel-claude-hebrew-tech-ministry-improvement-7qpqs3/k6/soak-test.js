// NOTE (2026-07 audit): these scripts target an HTTP service on
// BASE_URL (default :3000/health), but the agent is a one-shot batch CLI
// that serves no HTTP — the only /health endpoint in this repo is the
// Cloudflare telemetry-proxy worker. Point BASE_URL at a deployed worker
// (k6 run -e BASE_URL=https://<worker>.workers.dev) or at a future HTTP
// surface; running them against the agent container will only measure 404s.
/**
 * k6 Soak Test — sustained load over 10 minutes to detect memory leaks
 * and long-running degradation.
 * Run: k6 run k6/soak-test.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('error_rate');

export const options = {
  stages: [
    { duration: '2m', target: 10 },
    { duration: '8m', target: 10 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(99)<3000'],
    error_rate: ['rate<0.02'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const res = http.get(`${BASE_URL}/health`);
  const ok = check(res, { 'status 200': (r) => r.status === 200 });
  errorRate.add(!ok);
  sleep(2);
}
