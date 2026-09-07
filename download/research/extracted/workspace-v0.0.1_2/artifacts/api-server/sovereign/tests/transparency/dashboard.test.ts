import "../_flush.mjs";
/**
 * tests/transparency/dashboard.test.ts — Minimal Transparency Dashboard (v34).
 *
 * Covers three read-only views:
 *   • buildChainView        (שרשרת) — audit chain + chain integrity
 *   • buildBalancesView     (יתרות) — account balances + solvency snapshot
 *   • buildPassportListView (דרכונים) — lightweight passport references
 *
 * Also verifies the three route handlers via sovereignRoutes:
 *   GET /api/transparency/chain
 *   GET /api/transparency/balances
 *   GET /api/transparency/passports
 *
 * Edge cases:
 *   • empty tenant → empty chain / empty balances / empty passports
 *   • tenant isolation — T1 data does NOT appear in T2 views
 *   • denied op does NOT appear in passport list (only "allowed" records)
 *   • balances serialised as decimal strings (BigInt-safe)
 *   • chainIntact=false when chain is tampered
 *   • passportHref points to /api/passport/:auditId
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildChainView, buildBalancesView, buildPassportListView } from "../../lib/transparency/index.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { allowAll, denyAll } from "../../lib/orchestrator/guard.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { LedgerOrchestrator } from "../../lib/ledger-orchestrator/ledger-orchestrator.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { sovereignRoutes } from "../../src/routes/sovereign-routes.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal stack with a single tenant that has some ledger activity. */
async function makePopulatedStack(tenantId = "t1") {
  const stack = buildSovereignStack();
  const acc1 = await stack.ledger.createAccount(tenantId, "u1", "asset", "wallet-a");
  const acc2 = await stack.ledger.createAccount(tenantId, "u2", "asset", "wallet-b");
  await stack.ledger.mint(tenantId, acc1.id, 1_000_000n, "seed", "system");
  await stack.ledger.transfer(tenantId, acc1.id, acc2.id, 250_000n, "gift", "u1");
  return { stack, acc1, acc2 };
}

/** Simulate a route call (mirrors how sovereign-server.ts invokes handlers). */
async function callRoute(routes: ReturnType<typeof sovereignRoutes>, method: string, pattern: string, tenantId: string) {
  const route = routes.find(r => r.method === method && r.pattern === pattern);
  assert(!!route, `route ${method} ${pattern} must exist`);
  return route!.handler({ tenantId, body: {}, params: {} });
}

// ─── buildChainView ───────────────────────────────────────────────────────────

test("buildChainView: empty tenant returns intact chain with 0 records", () => {
  const auditStore = new InMemoryAuditStore();
  const view = buildChainView("nobody", auditStore);
  eq(view.tenantId, "nobody");
  eq(view.chainIntact, true);
  eq(view.recordCount, 0);
  eq(view.records.length, 0);
});

test("buildChainView: records appear in insertion order with correct fields", async () => {
  const { stack } = await makePopulatedStack("chain-t");
  const view = buildChainView("chain-t", stack.ledger.orchestrator.audit);
  assert(view.recordCount >= 2, "at least mint + transfer records");
  eq(view.chainIntact, true);
  const first = view.records[0];
  assert(typeof first.id === "string" && first.id.length > 0, "id present");
  assert(typeof first.hash === "string" && first.hash.length === 64, "hash is sha256 hex");
  assert(typeof first.actionType === "string", "actionType present");
  assert(first.outcome === "allowed" || first.outcome === "denied" || first.outcome === "error", "valid outcome");
  assert(typeof first.signed === "boolean", "signed flag is boolean");
  // First record's prevHash must be "genesis"
  eq(view.records[0].prevHash, "genesis");
  // Each subsequent prevHash links to the previous hash
  for (let i = 1; i < view.records.length; i++) {
    eq(view.records[i].prevHash, view.records[i - 1].hash);
  }
});

test("buildChainView: tenant isolation — T1 records not visible to T2", async () => {
  const { stack } = await makePopulatedStack("iso-t1");
  const view = buildChainView("iso-t2", stack.ledger.orchestrator.audit);
  eq(view.recordCount, 0);
  eq(view.tenantId, "iso-t2");
});

test("buildChainView: chainIntact=false when chain is tampered", () => {
  const auditStore = new InMemoryAuditStore();
  // Append a real record
  const rec = auditStore.append({
    id: "rec-1",
    tenantId: "tamper-t",
    actionId: "act-1",
    actionType: "test.action",
    source: "test",
    outcome: "allowed",
    occurredAt: new Date().toISOString(),
  });
  // Directly mutate the internal chain to simulate tampering
  const chain = (auditStore as any).chains.get("tamper-t") as any[];
  chain[0].hash = "deadbeef";
  const view = buildChainView("tamper-t", auditStore);
  eq(view.chainIntact, false);
  assert(view.recordCount === 1, "record count unaffected by tamper check");
});

// ─── buildBalancesView ────────────────────────────────────────────────────────

test("buildBalancesView: empty tenant returns no accounts and zero solvency", async () => {
  const provider = new InMemoryLedger();
  const view = await buildBalancesView("empty-t", provider);
  eq(view.tenantId, "empty-t");
  eq(view.accounts.length, 0);
  eq(view.solvency.totalAssets, "0");
  eq(view.solvency.totalLiabilities, "0");
  eq(view.solvency.netEquity, "0");
  eq(view.solvency.isSolvent, true);
});

test("buildBalancesView: balances are decimal strings (BigInt-safe)", async () => {
  const { stack, acc1 } = await makePopulatedStack("bal-t");
  const provider = (stack.ledger as any).provider as InMemoryLedger;
  const view = await buildBalancesView("bal-t", provider);
  assert(view.accounts.length >= 2, "at least two accounts");
  // Every balance must be a decimal-string integer (no decimal point, no 'n')
  for (const a of view.accounts) {
    assert(/^-?\d+$/.test(a.balance), `balance "${a.balance}" must be a decimal integer string`);
  }
  // The wallet that received 1_000_000 and sent 250_000 should show 750_000
  const walletA = view.accounts.find(a => a.id === acc1.id);
  assert(walletA !== undefined, "wallet-a must appear in balances view");
  eq(walletA!.balance, "750000");
  // Solvency snapshot fields
  assert(/^-?\d+$/.test(view.solvency.totalAssets), "totalAssets is decimal string");
  assert(/^-?\d+$/.test(view.solvency.totalLiabilities), "totalLiabilities is decimal string");
  assert(typeof view.solvency.balanceHash === "string" && view.solvency.balanceHash.length === 64, "balanceHash is sha256");
  assert(typeof view.solvency.generatedAt === "string", "generatedAt present");
});

test("buildBalancesView: tenant isolation — T1 accounts not visible to T2", async () => {
  const { stack } = await makePopulatedStack("bal-iso-t1");
  const provider = (stack.ledger as any).provider as InMemoryLedger;
  const view = await buildBalancesView("bal-iso-t2", provider);
  eq(view.accounts.length, 0);
});

// ─── buildPassportListView ────────────────────────────────────────────────────

test("buildPassportListView: empty tenant returns count=0", () => {
  const auditStore = new InMemoryAuditStore();
  const view = buildPassportListView("nobody", auditStore);
  eq(view.tenantId, "nobody");
  eq(view.count, 0);
  eq(view.passports.length, 0);
});

test("buildPassportListView: only 'allowed' records appear as passport summaries", async () => {
  const signer = new HmacSigner("test-secret-please-change-32bytes!!");
  const provider = new InMemoryLedger();
  const orch = new TfaOrchestrator([denyAll("blocked")]);
  const ledger = new LedgerOrchestrator(provider, orch, { signer });
  const acc = await ledger.createAccount("pp-t", "u1", "asset", "w");
  // This mint will be DENIED by the denyAll policy
  const r = await ledger.mint("pp-t", acc.id, 100n, "denied-mint", "system");
  eq(r.ok, false);
  const view = buildPassportListView("pp-t", orch.audit);
  // The denied audit record must NOT appear in passport summaries
  eq(view.count, 0);
  eq(view.passports.length, 0);
});

test("buildPassportListView: allowed records appear with correct href", async () => {
  const { stack } = await makePopulatedStack("pp-happy-t");
  const view = buildPassportListView("pp-happy-t", stack.ledger.orchestrator.audit);
  assert(view.count >= 2, "mint + transfer = at least 2 allowed records");
  for (const p of view.passports) {
    assert(typeof p.auditId === "string" && p.auditId.length > 0, "auditId present");
    eq(p.outcome, "allowed");
    eq(p.passportHref, `/api/passport/${p.auditId}`);
    assert(typeof p.actionType === "string", "actionType present");
    assert(typeof p.occurredAt === "string", "occurredAt present");
  }
});

test("buildPassportListView: tenant isolation — T1 passports not visible to T2", async () => {
  const { stack } = await makePopulatedStack("pp-iso-t1");
  const view = buildPassportListView("pp-iso-t2", stack.ledger.orchestrator.audit);
  eq(view.count, 0);
  eq(view.tenantId, "pp-iso-t2");
});

// ─── Route handlers ───────────────────────────────────────────────────────────

test("GET /api/transparency/chain: route exists and returns 200 with chain data", async () => {
  const { stack } = await makePopulatedStack("route-chain-t");
  const routes = sovereignRoutes(stack);
  const res = await callRoute(routes, "GET", "/api/transparency/chain", "route-chain-t");
  eq(res.status, 200);
  assert(typeof res.body.recordCount === "number", "recordCount present");
  assert(typeof res.body.chainIntact === "boolean", "chainIntact present");
  assert(Array.isArray(res.body.records), "records is array");
  eq(res.body.tenantId, "route-chain-t");
});

test("GET /api/transparency/balances: route exists and returns 200 with account data", async () => {
  const { stack } = await makePopulatedStack("route-bal-t");
  const routes = sovereignRoutes(stack);
  const res = await callRoute(routes, "GET", "/api/transparency/balances", "route-bal-t");
  eq(res.status, 200);
  assert(Array.isArray(res.body.accounts), "accounts is array");
  assert(typeof res.body.solvency === "object", "solvency present");
  assert(typeof res.body.solvency.isSolvent === "boolean", "isSolvent present");
  eq(res.body.tenantId, "route-bal-t");
});

test("GET /api/transparency/passports: route exists and returns 200 with passport list", async () => {
  const { stack } = await makePopulatedStack("route-pp-t");
  const routes = sovereignRoutes(stack);
  const res = await callRoute(routes, "GET", "/api/transparency/passports", "route-pp-t");
  eq(res.status, 200);
  assert(typeof res.body.count === "number", "count present");
  assert(Array.isArray(res.body.passports), "passports is array");
  eq(res.body.tenantId, "route-pp-t");
  // Every passport summary must have a passportHref
  for (const p of res.body.passports) {
    assert(p.passportHref.startsWith("/api/passport/"), "passportHref correct prefix");
  }
});

test("transparency routes: all three route handlers are registered", () => {
  const stack = buildSovereignStack();
  const routes = sovereignRoutes(stack);
  const patterns = routes.map(r => `${r.method} ${r.pattern}`);
  assert(patterns.includes("GET /api/transparency/chain"), "chain route registered");
  assert(patterns.includes("GET /api/transparency/balances"), "balances route registered");
  assert(patterns.includes("GET /api/transparency/passports"), "passports route registered");
});
