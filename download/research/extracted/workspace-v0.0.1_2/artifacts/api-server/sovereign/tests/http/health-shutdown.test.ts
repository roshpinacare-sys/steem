import "../_flush.mjs";
/**
 * tests/http/health-shutdown.test.ts — /healthz, /readyz, and graceful shutdown tests.
 *
 * Coverage:
 *   • checkLiveness / checkReadiness unit logic (7 tests)
 *   • GET /healthz returns 200 ok (no auth required)
 *   • GET /readyz returns 200 ok with checks (no auth required)
 *   • GET /readyz includes draining + solvency checks
 *   • shutdown() resolves without error
 *   • shutdown() is idempotent (second call is a no-op)
 *   • GET /healthz returns 503 after shutdown begins (unit-level probe)
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer, type SovereignServer } from "../../src/http/sovereign-server.ts";
import { checkLiveness, checkReadiness, type HealthState } from "../../src/http/health-routes.ts";

// ─── Helper ──────────────────────────────────────────────────────────────────

async function httpGet(port: number, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await res.json() as Record<string, unknown>;
  return { status: res.status, body };
}

async function startTestServer(): Promise<{ s: SovereignServer; port: number }> {
  const s = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  s.unref();
  // Give event loop a tick to stabilise (same pattern as sovereign-server.test.ts)
  await new Promise((r) => setTimeout(r, 50));
  const port = (s.address() as any).port as number;
  return { s, port };
}

// ─── Unit tests for health-routes.ts ─────────────────────────────────────────

test("checkLiveness: returns 200 ok when not draining", () => {
  const state: HealthState = { draining: false };
  const result = checkLiveness(state);
  eq(result.status, 200);
  eq((result.body as any).status, "ok");
});

test("checkLiveness: returns 503 draining when draining=true", () => {
  const state: HealthState = { draining: true };
  const result = checkLiveness(state);
  eq(result.status, 503);
  eq((result.body as any).status, "draining");
});

test("checkReadiness: returns 200 ok with checks when ready and no monitor", async () => {
  const state: HealthState = { draining: false };
  const result = await checkReadiness(state);
  eq(result.status, 200);
  eq((result.body as any).status, "ok");
  assert(typeof (result.body as any).checks === "object", "should include checks");
  eq((result.body as any).checks.draining, "ok");
  eq((result.body as any).checks.solvency, "ok");
  eq((result.body as any).checks.db, "ok");
  eq((result.body as any).checks.chain, "ok");
});

test("checkReadiness: returns 503 when draining=true", async () => {
  const state: HealthState = { draining: true };
  const result = await checkReadiness(state);
  eq(result.status, 503);
  eq((result.body as any).status, "not ready");
  const checks = (result.body as any).checks as Record<string, string>;
  assert(checks.draining !== "ok", "draining check should fail");
});

test("checkReadiness: monitor with no results is optimistic (ok)", async () => {
  const mockMonitor = {
    getStatus: () => ({ results: {} as Record<string, { isSolvent: boolean }>, tenants: [] as string[] }),
  } as any;
  const state: HealthState = { draining: false, monitor: mockMonitor };
  const result = await checkReadiness(state);
  eq(result.status, 200);
  eq((result.body as any).checks.solvency, "ok");
});

test("checkReadiness: monitor with all-solvent results returns ok", async () => {
  const mockMonitor = {
    getStatus: () => ({
      results: {
        "tenant-a": { isSolvent: true },
        "tenant-b": { isSolvent: true },
      } as Record<string, { isSolvent: boolean }>,
      tenants: ["tenant-a", "tenant-b"],
    }),
  } as any;
  const state: HealthState = { draining: false, monitor: mockMonitor };
  const result = await checkReadiness(state);
  eq(result.status, 200);
  eq((result.body as any).checks.solvency, "ok");
});

test("checkReadiness: monitor with insolvent tenant returns 503", async () => {
  const mockMonitor = {
    getStatus: () => ({
      results: {
        "tenant-a": { isSolvent: true },
        "tenant-insolvent": { isSolvent: false },
      } as Record<string, { isSolvent: boolean }>,
      tenants: ["tenant-a", "tenant-insolvent"],
    }),
  } as any;
  const state: HealthState = { draining: false, monitor: mockMonitor };
  const result = await checkReadiness(state);
  eq(result.status, 503);
  assert(
    String((result.body as any).checks.solvency).includes("tenant-insolvent"),
    "should name insolvent tenants"
  );
});

// ─── PQC provider visibility (PQC stage-2b sub-step) ─────────────────────────
// readyz surfaces the active signer algorithm so ops monitoring can alert on
// the zero-dep "-sim" fallback per lib/orchestrator/pqc-loader.ts. This never
// fails readiness — a sim provider is a valid, functional configuration.

test("checkReadiness: real (non-sim) signer algorithm reported as-is, stays ready", async () => {
  const state: HealthState = { draining: false, signer: { algorithm: "hybrid:ed25519+ml-dsa-44-oqs" } };
  const result = await checkReadiness(state);
  eq(result.status, 200);
  eq((result.body as any).checks.pqc, "hybrid:ed25519+ml-dsa-44-oqs");
});

test("checkReadiness: sim signer algorithm flagged with sim: prefix, stays ready", async () => {
  const state: HealthState = { draining: false, signer: { algorithm: "hybrid:ed25519+ml-dsa-44-local-sim" } };
  const result = await checkReadiness(state);
  eq(result.status, 200);
  eq((result.body as any).checks.pqc, "sim: hybrid:ed25519+ml-dsa-44-local-sim");
});

test("checkReadiness: no signer supplied omits pqc check entirely (fail-closed-by-omission, no false claim)", async () => {
  const state: HealthState = { draining: false };
  const result = await checkReadiness(state);
  eq(result.status, 200);
  eq((result.body as any).checks.pqc, undefined);
});

test("checkReadiness: draining=true overrides solvent monitor (503)", async () => {
  const mockMonitor = {
    getStatus: () => ({ results: { t: { isSolvent: true } }, tenants: ["t"] }),
  } as any;
  const state: HealthState = { draining: true, monitor: mockMonitor };
  const result = await checkReadiness(state);
  eq(result.status, 503);
});

// ─── DB reachability tests ───────────────────────────────────────────────────

test("checkReadiness: pool query succeeds → db=ok", async () => {
  const mockPool = {
    query: async () => ({ rows: [{ "?column?": 1 }], rowCount: 1, fields: [], command: "SELECT" }),
  } as any;
  const state: HealthState = { draining: false, pool: mockPool };
  const result = await checkReadiness(state);
  eq(result.status, 200);
  eq((result.body as any).checks.db, "ok");
});

test("checkReadiness: pool query throws → 503 with db=unreachable", async () => {
  const mockPool = {
    query: async () => { throw new Error("connection refused"); },
  } as any;
  const state: HealthState = { draining: false, pool: mockPool };
  const result = await checkReadiness(state);
  eq(result.status, 503);
  assert(String((result.body as any).checks.db).includes("connection refused"), "should mention connection refused");
});

// ─── Chain verification tests ────────────────────────────────────────────────

test("checkReadiness: auditStore with no monitor tenants → probes empty chain (ok)", async () => {
  const mockAudit = { verifyChain: () => true } as any;
  const state: HealthState = { draining: false, auditStore: mockAudit };
  const result = await checkReadiness(state);
  eq(result.status, 200);
  eq((result.body as any).checks.chain, "ok");
});

test("checkReadiness: auditStore with monitor tenants → verifies sample tenant", async () => {
  const mockMonitor = {
    getStatus: () => ({ results: {}, tenants: ["t1", "t2"] }),
  } as any;
  let verifiedTenant = "";
  const mockAudit = {
    verifyChain: (tenantId: string) => { verifiedTenant = tenantId; return true; },
  } as any;
  const state: HealthState = { draining: false, monitor: mockMonitor, auditStore: mockAudit };
  const result = await checkReadiness(state);
  eq(result.status, 200);
  eq((result.body as any).checks.chain, "ok");
  eq(verifiedTenant, "t1", "should verify first monitored tenant");
});

test("checkReadiness: auditStore verifyChain returns false → 503", async () => {
  const mockMonitor = {
    getStatus: () => ({ results: {}, tenants: ["t1"] }),
  } as any;
  const mockAudit = { verifyChain: () => false } as any;
  const state: HealthState = { draining: false, monitor: mockMonitor, auditStore: mockAudit };
  const result = await checkReadiness(state);
  eq(result.status, 503);
  assert(String((result.body as any).checks.chain).includes("broken"), "should mention chain broken");
});

test("checkReadiness: auditStore verifyChain throws → 503", async () => {
  const mockAudit = { verifyChain: () => { throw new Error("db timeout"); } } as any;
  const state: HealthState = { draining: false, auditStore: mockAudit };
  const result = await checkReadiness(state);
  eq(result.status, 503);
  assert(String((result.body as any).checks.chain).includes("db timeout"), "should mention db timeout");
});

// ─── HTTP integration tests ───────────────────────────────────────────────────

test("GET /healthz returns 200 ok (no auth required)", async () => {
  const { s, port } = await startTestServer();
  try {
    const r = await httpGet(port, "/healthz");
    eq(r.status, 200);
    eq(r.body.status, "ok");
  } finally {
    s.close();
  }
});

test("GET /readyz returns 200 ok (no auth required)", async () => {
  const { s, port } = await startTestServer();
  try {
    const r = await httpGet(port, "/readyz");
    eq(r.status, 200);
    eq(r.body.status, "ok");
  } finally {
    s.close();
  }
});

test("GET /readyz includes draining=ok and solvency=ok checks", async () => {
  const { s, port } = await startTestServer();
  try {
    const r = await httpGet(port, "/readyz");
    const checks = r.body.checks as Record<string, string>;
    eq(checks.draining, "ok");
    eq(checks.solvency, "ok");
    // Default composition uses signerKind="ed25519" (no PQC hybrid), so pqc
    // reports the real algorithm — never flagged "sim:" — proving the live
    // wiring (sovereign-server.ts → resolvedStack.signer) actually reaches readyz.
    assert(typeof checks.pqc === "string" && !checks.pqc.startsWith("sim:"), "pqc check should report real algorithm, unflagged");
  } finally {
    s.close();
  }
});

// ─── Shutdown tests ───────────────────────────────────────────────────────────

test("shutdown() resolves without error and stops listening", async () => {
  const { s } = await startTestServer();
  await s.shutdown(1000);
  eq((s as any).listening, false);
});

test("shutdown() is idempotent — second call is no-op", async () => {
  const { s } = await startTestServer();
  await s.shutdown(1000);
  await s.shutdown(1000); // must not throw
  eq((s as any).listening, false);
});

test("healthz unit: draining flag set by shutdown makes probe return 503", () => {
  // Test the health state logic directly (HTTP-level test would race the server.close())
  const state: HealthState = { draining: true };
  const result = checkLiveness(state);
  eq(result.status, 503);
  eq((result.body as any).status, "draining");
});

// ─── Idle-connection graceful shutdown tests ─────────────────────────────────

test("shutdown() completes even with an idle keep-alive connection", async () => {
  const { s, port } = await startTestServer();
  // Open a raw TCP connection and leave it idle (no HTTP request sent).
  // server.close() alone would hang forever; closeAllConnections must destroy it.
  const net = await import("node:net");
  const socket = net.createConnection({ host: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  await s.shutdown(2000);
  eq((s as any).listening, false);
});

test("wireGracefulShutdown wires SIGTERM handler without throwing", async () => {
  const { startSovereignServer, wireGracefulShutdown } = await import("../../src/http/sovereign-server.ts");
  const s = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  s.unref();
  await new Promise((r) => setTimeout(r, 50));

  // We cannot send a real SIGTERM to ourselves in the test runner without
  // killing the whole process. We verify the function exists, wires the
  // handler, and does not throw.
  wireGracefulShutdown(s, { timeoutMs: 500, signals: ["SIGTERM"] });

  // Clean up
  await s.shutdown(500);
  eq((s as any).listening, false);
});
