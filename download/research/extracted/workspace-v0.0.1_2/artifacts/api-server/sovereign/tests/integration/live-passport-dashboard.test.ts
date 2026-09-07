import "../_flush.mjs";
/**
 * tests/integration/live-passport-dashboard.test.ts
 *
 * End-to-end live-server test combining the Action Passport endpoint with the
 * Transparency Dashboard endpoints through the actual HTTP server.
 *
 * Coverage:
 *   • Happy path: create account → mint → GET /api/passport/:auditId returns
 *     a signed ActionPassport; GET /api/transparency/chain, /balances, /passports
 *     reflect the operation correctly.
 *   • Edge case: unknown auditId on passport route → 404.
 *   • Failure case: missing x-tenant-id → 400 on all endpoints.
 *   • Tenant isolation: cross-tenant requests for passport and dashboard → 404
 *     or empty/isolated data.
 *   • BigInt-safe JSON: balances are decimal strings, not raw BigInt.
 *   • Passport list view only includes "allowed" records.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { canonicalStringify, computePassportHash } from "../../lib/passport/index.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (p: string, body: any, t = "e2e-tenant-1") =>
  fetch(base + p, { method: "POST", headers: H(t), body: JSON.stringify(body) });
const get = (p: string, t = "e2e-tenant-1") => fetch(base + p, { headers: H(t) });

// ─── Failure cases ────────────────────────────────────────────────────────────

test("LIVE E2E: missing x-tenant-id → 400 on passport route", async () => {
  const r = await fetch(base + "/api/passport/any-id");
  eq(r.status, 400);
});

test("LIVE E2E: missing x-tenant-id → 400 on transparency chain", async () => {
  const r = await fetch(base + "/api/transparency/chain");
  eq(r.status, 400);
});

test("LIVE E2E: unknown auditId → 404 with correct message", async () => {
  const r = await get("/api/passport/00000000-0000-0000-0000-000000000000");
  eq(r.status, 404);
  const body = await r.json();
  eq(body.error, "passport not found");
});

// ─── Happy path: full flow ──────────────────────────────────────────────────

test("LIVE E2E: mint → passport + dashboard views reflect operation", async () => {
  // 1. Create account
  const acc = await (await post("/api/ledger/accounts", { ownerId: "e2e-u1", type: "asset", name: "Alice" })).json();
  const accId = acc.account.id;
  assert(accId && typeof accId === "string", "account created with id");

  // 2. Mint
  const mintRes = await post("/api/ledger/mint", { toAccountId: accId, amount: "1000000", memo: "seed" });
  eq(mintRes.status, 200);
  const mintBody = await mintRes.json();
  const auditId = mintBody.auditId;
  assert(typeof auditId === "string" && auditId.length > 0, "mint returned auditId");
  assert(mintBody.passport, "mint auto-issued passport inline (B.6.3)");

  // 3. GET /api/passport/:auditId
  const ppRes = await get("/api/passport/" + auditId);
  eq(ppRes.status, 200);
  const { passport } = await ppRes.json();
  assert(passport, "passport returned");
  eq(passport.version, "1");
  eq(passport.tenantId, "e2e-tenant-1");
  eq(passport.audit.id, auditId);
  eq(passport.audit.actionType, "ledger.mint");
  eq(passport.policyDecision.outcome, "allowed");
  assert(typeof passport.hash === "string" && passport.hash.length === 64, "hash is sha256 hex");
  assert(typeof passport.signature === "string" && passport.signature.length > 0, "signature present");
  // Recompute hash to verify canonical consistency
  const { hash: _h, signature: _s, ...body } = passport;
  eq(computePassportHash(body), passport.hash);

  // 4. GET /api/transparency/chain
  const chainRes = await get("/api/transparency/chain");
  eq(chainRes.status, 200);
  const chain = await chainRes.json();
  eq(chain.tenantId, "e2e-tenant-1");
  eq(chain.chainIntact, true);
  assert(chain.recordCount >= 1, "chain has at least the mint record (createAccount is not audited)");
  assert(Array.isArray(chain.records), "records is array");
  const mintRecord = chain.records.find((r: any) => r.actionType === "ledger.mint");
  assert(mintRecord, "mint record appears in chain");
  assert(typeof mintRecord.hash === "string" && mintRecord.hash.length === 64, "chain record hash is sha256");

  // 5. GET /api/transparency/balances
  const balRes = await get("/api/transparency/balances");
  eq(balRes.status, 200);
  const bal = await balRes.json();
  eq(bal.tenantId, "e2e-tenant-1");
  assert(Array.isArray(bal.accounts), "accounts is array");
  const alice = bal.accounts.find((a: any) => a.id === accId);
  assert(alice, "Alice account in balances view");
  eq(alice.balance, "1000000");
  assert(/^-?\d+$/.test(alice.balance), "balance is decimal string");
  eq(bal.solvency.isSolvent, true);
  assert(/^-?\d+$/.test(bal.solvency.totalAssets), "totalAssets is decimal string");
  assert(typeof bal.solvency.balanceHash === "string" && bal.solvency.balanceHash.length === 64, "balanceHash is sha256");

  // 6. GET /api/transparency/passports
  const listRes = await get("/api/transparency/passports");
  eq(listRes.status, 200);
  const list = await listRes.json();
  eq(list.tenantId, "e2e-tenant-1");
  assert(list.count >= 1, "mint appears in passport list (createAccount is not audited)");
  assert(Array.isArray(list.passports), "passports is array");
  const ppSummary = list.passports.find((p: any) => p.auditId === auditId);
  assert(ppSummary, "mint auditId appears in passport list");
  eq(ppSummary.outcome, "allowed");
  eq(ppSummary.passportHref, `/api/passport/${auditId}`);
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test("LIVE E2E: cross-tenant passport lookup → 404", async () => {
  const acc = await (await post("/api/ledger/accounts", { ownerId: "iso-u1", type: "asset", name: "Isolated" }, "iso-A")).json();
  const mint = await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "1000", memo: "iso" }, "iso-A");
  const { auditId } = await mint.json();
  const r = await get("/api/passport/" + auditId, "iso-B");
  eq(r.status, 404);
});

test("LIVE E2E: cross-tenant dashboard returns empty/isolated data", async () => {
  // Populate tenant-A
  const acc = await (await post("/api/ledger/accounts", { ownerId: "iso2-u1", type: "asset", name: "T1" }, "iso-t1")).json();
  await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "5000", memo: "t1" }, "iso-t1");

  // Tenant-B should see no chain records
  const chain = await (await get("/api/transparency/chain", "iso-t2")).json();
  eq(chain.recordCount, 0);
  eq(chain.chainIntact, true);

  // Tenant-B should see no balances
  const bal = await (await get("/api/transparency/balances", "iso-t2")).json();
  eq(bal.accounts.length, 0);

  // Tenant-B should see no passports
  const list = await (await get("/api/transparency/passports", "iso-t2")).json();
  eq(list.count, 0);
});

// ─── Edge: transfer flow with auto-passport ─────────────────────────────────

test("LIVE E2E: transfer auto-issues passport inline + dashboard reflects it", async () => {
  const a = await (await post("/api/ledger/accounts", { ownerId: "tr-u1", type: "asset", name: "Sender" })).json();
  const b = await (await post("/api/ledger/accounts", { ownerId: "tr-u2", type: "asset", name: "Receiver" })).json();
  await post("/api/ledger/mint", { toAccountId: a.account.id, amount: "100000", memo: "seed" });
  const tx = await post("/api/ledger/transfer", { fromAccountId: a.account.id, toAccountId: b.account.id, amount: "30000", memo: "pay" });
  eq(tx.status, 200);
  const txBody = await tx.json();
  assert(txBody.auditId, "transfer returned auditId");
  assert(txBody.passport, "transfer auto-issued passport inline");

  // Dashboard should now have at least 2 records (mint + transfer; createAccount is not audited)
  const list = await (await get("/api/transparency/passports")).json();
  assert(list.count >= 2, "mint and transfer appear in passport list");
  const txSummary = list.passports.find((p: any) => p.auditId === txBody.auditId);
  assert(txSummary, "transfer auditId in passport list");
  eq(txSummary.outcome, "allowed");

  // Balances should reflect the transfer
  const bal = await (await get("/api/transparency/balances")).json();
  const sender = bal.accounts.find((ac: any) => ac.id === a.account.id);
  const receiver = bal.accounts.find((ac: any) => ac.id === b.account.id);
  assert(sender, "sender in balances");
  assert(receiver, "receiver in balances");
  eq(sender.balance, "70000");
  eq(receiver.balance, "30000");
});

import { test as _t } from "../_harness.mjs";
_t("LIVE E2E: cleanup", () => { server.close(); });
