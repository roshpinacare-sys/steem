import "../_flush.mjs";
/**
 * tests/containerization/healthcheck-integration.test.ts
 *
 * Verifies that the TFA server health endpoints behave exactly as the
 * Dockerfile and docker-compose healthcheck configurations expect:
 *   • GET /healthz → 200 {"status":"ok"} (Docker HEALTHCHECK probe)
 *   • GET /readyz → 200 {"status":"ok","checks":{...}} (readiness probe)
 *   • Probes are unauthenticated (no x-tenant-id required)
 *
 * This test confirms the container orchestration contract is satisfied
 * by the sovereign server implementation.
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer, type SovereignServer } from "../../src/http/sovereign-server.ts";

async function httpGet(port: number, path: string): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text); } catch { /* non-JSON is acceptable for some probes */ }
  return { status: res.status, body, text };
}

async function startTestServer(): Promise<{ s: SovereignServer; port: number }> {
  const s = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  s.unref();
  await new Promise((r) => setTimeout(r, 50));
  const port = (s.address() as any).port as number;
  return { s, port };
}

test("GET /healthz returns 200 and JSON body compatible with curl probe", async () => {
  const { s, port } = await startTestServer();
  try {
    const r = await httpGet(port, "/healthz");
    eq(r.status, 200, `healthz must return 200, got ${r.status}`);
    eq(r.body.status, "ok", "healthz body.status must be 'ok'");
    // curl -fsS exits 0 on 200, exits non-zero on 4xx/5xx — so 200 is sufficient
  } finally {
    s.close();
  }
});

test("GET /readyz returns 200 with checks object", async () => {
  const { s, port } = await startTestServer();
  try {
    const r = await httpGet(port, "/readyz");
    eq(r.status, 200, `readyz must return 200, got ${r.status}`);
    eq(r.body.status, "ok", "readyz body.status must be 'ok'");
    assert(typeof r.body.checks === "object", "readyz must include checks object");
    const checks = r.body.checks as Record<string, string>;
    eq(checks.draining, "ok", "draining check must be ok");
    eq(checks.db, "ok", "db check must be ok (no pool configured)");
    eq(checks.solvency, "ok", "solvency check must be ok (no monitor yet)");
    eq(checks.chain, "ok", "chain check must be ok (no auditStore configured)");
  } finally {
    s.close();
  }
});

test("GET /healthz and /readyz do not require x-tenant-id", async () => {
  const { s, port } = await startTestServer();
  try {
    // fetch() sends no tenant-id header by default
    const health = await httpGet(port, "/healthz");
    eq(health.status, 200, "healthz must be unauthenticated");
    const ready = await httpGet(port, "/readyz");
    eq(ready.status, 200, "readyz must be unauthenticated");
  } finally {
    s.close();
  }
});

test("server shutdown triggers draining state (unit contract)", async () => {
  const { s, port } = await startTestServer();
  // Verify that shutdown() exists and resolves without error.
  // Actual 503-on-drain behavior is covered in tests/http/health-shutdown.test.ts.
  await s.shutdown(500);
  eq((s as any).listening, false, "server must stop listening after shutdown");
});

test("health probes return application/json content-type", async () => {
  const { s, port } = await startTestServer();
  try {
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    const contentType = health.headers.get("content-type") || "";
    assert(contentType.includes("application/json"), "healthz must return application/json");
    const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
    const readyType = ready.headers.get("content-type") || "";
    assert(readyType.includes("application/json"), "readyz must return application/json");
  } finally {
    s.close();
  }
});
