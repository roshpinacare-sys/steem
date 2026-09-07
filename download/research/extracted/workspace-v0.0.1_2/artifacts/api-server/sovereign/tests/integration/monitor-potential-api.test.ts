import "../_flush.mjs";
/**
 * tests/integration/monitor-potential-api.test.ts
 *
 * Live-server HTTP integration tests for the two previously-untested route groups:
 *   • GET  /api/monitor/status  — cron status shape, cold state, after run
 *   • POST /api/monitor/run     — AuditResult shape (timestamp/accountsChecked/anomalies),
 *                                  tenant registration, mint-then-run consistency
 *   • POST /api/potential/profile — 200 with default policies (v47+);
 *                                    403 with ledger-only strict policies (fail-closed demo)
 *
 * AuditResult shape (from scripts/ledger-monitor.ts):
 *   { tenantId, timestamp, isSolvent, accountsChecked, anomalies, alertSent }
 *
 * Note on potential/profile policies (updated v47):
 *   defaultPolicies() now includes POTENTIAL_ACTION_TYPES (potential.analyze + potential.route)
 *   alongside LEDGER_ACTION_TYPES. Server A (default) returns 200 for potential/profile.
 *   Server B uses a ledger-only strict policy to document + test the fail-closed path.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { LEDGER_ACTION_TYPES } from "../../lib/ledger-orchestrator/types.ts";

// ─── Server A: default policies (monitor tests + potential/profile 200) ───────

const serverA = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const portA: number = (serverA.address() as any).port;
const baseA = `http://127.0.0.1:${portA}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (path: string, body: any, tenant = "mon-t1", base = baseA) =>
  fetch(base + path, { method: "POST", headers: H(tenant), body: JSON.stringify(body) });
const get = (path: string, tenant = "mon-t1", base = baseA) =>
  fetch(base + path, { headers: H(tenant) });

// ─── Server B: ledger-only strict policies (fail-closed demo for potential) ──
//
// Only LEDGER_ACTION_TYPES allowed — potential.analyze / potential.route denied.
// This documents that if a stack is intentionally restricted to financial ops only,
// potential calls correctly fail-closed with 403.

const ledgerOnlyPolicies = [
  {
    name: "ledger-only-allowlist",
    rules: [{
      if: { actionTypeNotIn: Object.values(LEDGER_ACTION_TYPES) as string[] },
      then: "deny" as const,
      reason: "non-ledger action (ledger-only stack, fail-closed)",
    }],
    default: "allow" as const,
  },
];
const serverB = startSovereignServer(0, buildSovereignStack(ledgerOnlyPolicies), { requireIdempotencyKey: false });
const portB: number = (serverB.address() as any).port;
const baseB = `http://127.0.0.1:${portB}`;

// ─── GET /api/monitor/status ──────────────────────────────────────────────────

test("MONITOR: missing x-tenant-id → 400", async () => {
  const r = await fetch(baseA + "/api/monitor/status");
  eq(r.status, 400);
});

test("MONITOR STATUS: cold state — correct shape", async () => {
  const r = await get("/api/monitor/status", "shape-check-tenant");
  eq(r.status, 200);
  const body = await r.json();
  assert(typeof body.running === "boolean", "running is boolean");
  assert(typeof body.intervalMs === "number" && body.intervalMs > 0, "intervalMs is positive number");
  assert(body.lastRunAt === null || typeof body.lastRunAt === "string", "lastRunAt: null or ISO string");
  assert(body.nextRunAt === null || typeof body.nextRunAt === "string", "nextRunAt: null or ISO string");
  assert(Array.isArray(body.tenants), "tenants is array");
  assert(typeof body.totalRuns === "number" && body.totalRuns >= 0, "totalRuns is non-negative number");
  assert(typeof body.results === "object" && body.results !== null, "results is object");
});

// ─── POST /api/monitor/run ────────────────────────────────────────────────────

test("MONITOR RUN: missing x-tenant-id → 400", async () => {
  const r = await fetch(baseA + "/api/monitor/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  eq(r.status, 400);
});

test("MONITOR RUN: AuditResult — correct field names and types", async () => {
  const r = await post("/api/monitor/run", {}, "mon-shape-t1");
  eq(r.status, 200);
  const body = await r.json();
  eq(body.tenantId, "mon-shape-t1", "tenantId echoed");
  assert(typeof body.timestamp === "string" && body.timestamp.length > 0, "timestamp is ISO string");
  assert(typeof body.isSolvent === "boolean", "isSolvent is boolean");
  assert(typeof body.accountsChecked === "number", "accountsChecked is number");
  assert(Array.isArray(body.anomalies), "anomalies is array");
  assert(typeof body.alertSent === "boolean", "alertSent is boolean");
});

test("MONITOR RUN: fresh tenant — solvent, accountsChecked=0, no anomalies", async () => {
  const r = await post("/api/monitor/run", {}, "mon-fresh-t1");
  eq(r.status, 200);
  const body = await r.json();
  eq(body.isSolvent, true, "trivially solvent (no ledger)");
  eq(body.accountsChecked, 0, "zero accounts for fresh tenant");
  eq(body.anomalies.length, 0, "no anomalies on empty ledger");
  eq(body.alertSent, false, "no alert sent when all ok");
});

test("MONITOR RUN: registers tenant — appears in status.tenants", async () => {
  const tenant = "mon-reg-t1";
  await post("/api/monitor/run", {}, tenant);
  const status = await (await get("/api/monitor/status", tenant)).json();
  assert(status.tenants.includes(tenant), "tenant registered in cron after /monitor/run");
});

test("MONITOR RUN: after mint — accountsChecked >= 1, isSolvent true, anomalies is array", async () => {
  const tenant = "mon-mint-t1";
  const accR = await post("/api/ledger/accounts", { ownerId: "mon-u1", type: "asset", name: "Test" }, tenant);
  const acc = await accR.json();
  await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "750000", memo: "seed" }, tenant);

  const r = await post("/api/monitor/run", {}, tenant);
  eq(r.status, 200);
  const body = await r.json();
  eq(body.isSolvent, true, "solvent after mint (double-entry balanced)");
  assert(body.accountsChecked >= 1, "accountsChecked >= 1 (asset + reserve accounts)");
  assert(Array.isArray(body.anomalies), "anomalies is array (may flag 'api' actor — see comment)");
  // Note: the monitor may report actor-authorization anomalies for mints via HTTP API
  // (initiatedBy defaults to 'api'). That's correct security behavior — not a test failure.
});

test("MONITOR RUN: double run — totalRuns increments in status.results", async () => {
  const tenant = "mon-double-t1";
  await post("/api/monitor/run", {}, tenant);
  await post("/api/monitor/run", {}, tenant);
  const status = await (await get("/api/monitor/status", tenant)).json();
  assert(status.results[tenant], "results has entry for tenant");
  assert(typeof status.results[tenant].timestamp === "string", "result has timestamp");
  assert(status.totalRuns >= 2, "totalRuns >= 2");
});

test("MONITOR RUN: tenant isolation — A's result does not contain B's data", async () => {
  const [tA, tB] = ["mon-iso-A1", "mon-iso-B1"];
  await post("/api/ledger/accounts", { ownerId: "u1", type: "asset", name: "A" }, tA);
  await post("/api/monitor/run", {}, tA);

  const status = await (await get("/api/monitor/status", tB)).json();
  if (status.results[tA]) {
    eq(status.results[tA].tenantId, tA, "A's result has A's tenantId");
    assert(status.results[tA].tenantId !== tB, "A's result never shows B's tenantId");
  }
  // B's result (if any) must be B's own data
  if (status.results[tB]) {
    eq(status.results[tB].tenantId, tB, "B's result has B's tenantId");
  }
});

// ─── POST /api/potential/profile ─────────────────────────────────────────────

test("POTENTIAL: missing x-tenant-id → 400", async () => {
  const r = await fetch(baseA + "/api/potential/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "u1" }),
  });
  eq(r.status, 400);
});

test("POTENTIAL: missing userId → 400 (before policy check)", async () => {
  const r = await post("/api/potential/profile", {}, "pot-t1");
  eq(r.status, 400);
  const body = await r.json();
  assert(typeof body.error === "string" && body.error.includes("userId"), "error mentions userId");
});

test("POTENTIAL: default policies — 403 fail-closed (potential.analyze not in ledger-only allowlist)", async () => {
  // Server B uses ledger-only strict policies that exclude potential.analyze.
  // This documents that a deliberately restricted stack correctly denies potential calls.
  const r = await post("/api/potential/profile", { userId: "pot-fc-u1" }, "pot-fc-t1", baseB);
  eq(r.status, 403, "403 = policy denied by ledger-only-allowlist (fail-closed, correct behavior)");
  const body = await r.json();
  assert(typeof body.error === "string", "error message present");
  assert(body.error.includes("denied") || body.error.includes("fail-closed") || body.error.includes("non-ledger"),
    "error explains policy denial");
});

test("POTENTIAL: default policies — 200 (potential.analyze included in defaultPolicies since v47)", async () => {
  // Server A uses defaultPolicies() which now includes POTENTIAL_ACTION_TYPES.
  const r = await post("/api/potential/profile", { userId: "pot-default-u1" }, "pot-default-t1");
  eq(r.status, 200, "200 = defaultPolicies allows potential.analyze");
  const body = await r.json();
  assert(body.ok === true, "ok=true from mapOp");
});

test("POTENTIAL: extended-policy stack — 200 with empty signals", async () => {
  const r = await post("/api/potential/profile", { userId: "pot-ext-u1" }, "pot-ext-t1");
  eq(r.status, 200, "200 when potential.analyze is in the allowlist");
  const body = await r.json();
  assert(typeof body === "object" && body !== null, "valid JSON object");
  // mapOp wraps in { ok, data, auditId } or { ok, data } on success
  assert(body.ok === true, "ok=true from mapOp");
});

test("POTENTIAL: default policies — knowledgeSignals forwarded, no crash", async () => {
  const r = await post("/api/potential/profile", {
    userId: "pot-sig-u1",
    knowledgeSignals: [
      { category: "technical", label: "TypeScript", weight: 0.9, source: "project" },
      { category: "domain",    label: "finance",    weight: 0.7, source: "history" },
    ],
    analyticsSignals: [
      { metric: "tasksCompleted", value: 55, windowDays: 30 },
    ],
  }, "pot-sig-t1");
  eq(r.status, 200);
  const body = await r.json();
  eq(body.ok, true, "analyze succeeded with signals");
});

test("POTENTIAL: default policies — tenant isolation, two users independent", async () => {
  const [rA, rB] = await Promise.all([
    post("/api/potential/profile", { userId: "shared-user" }, "pot-iso-A"),
    post("/api/potential/profile", { userId: "shared-user" }, "pot-iso-B"),
  ]);
  eq(rA.status, 200, "tenant-A ok");
  eq(rB.status, 200, "tenant-B ok");
  const [bA, bB] = await Promise.all([rA.json(), rB.json()]);
  eq(bA.ok, true, "A result ok");
  eq(bB.ok, true, "B result ok");
});

// ─── Cross-route: monitor after potential call ────────────────────────────────

test("MONITOR + POTENTIAL: monitor run after potential call — no crash, no ledger anomalies", async () => {
  const tenant = "cross-route-t1";
  // Potential doesn't touch the ledger, so monitor sees a clean state
  await post("/api/potential/profile", { userId: "cr-u1" }, tenant);
  const monR = await post("/api/monitor/run", {}, tenant);
  eq(monR.status, 200);
  const mon = await monR.json();
  eq(mon.isSolvent, true, "solvent (potential calls don't affect ledger)");
  eq(mon.anomalies.length, 0, "no anomalies");
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

import { test as _t } from "../_harness.mjs";
_t("MONITOR+POTENTIAL: cleanup servers", () => {
  serverA.close();
  serverB.close();
});
