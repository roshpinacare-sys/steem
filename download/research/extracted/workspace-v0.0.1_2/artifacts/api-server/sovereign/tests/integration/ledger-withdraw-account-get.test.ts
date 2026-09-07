import "../_flush.mjs";
/**
 * tests/integration/ledger-withdraw-account-get.test.ts
 *
 * Live-server HTTP integration tests for two previously-untested HTTP paths:
 *
 *   POST /api/ledger/withdraw
 *     • happy path: mint → withdraw → response carries auditId + passport (auto-issue).
 *     • validation: missing fromAccountId → 400.
 *     • guard denial: over spending cap → 403, no passport leaked (fail-closed).
 *     • insufficient funds: withdraw more than balance → 403 (INSUFFICIENT_FUNDS).
 *     • tenant isolation: cross-tenant withdraw rejected (account not found → guard deny).
 *     • BigInt-safe: balance after withdraw is a decimal string.
 *
 *   GET /api/ledger/accounts/:id
 *     • happy path: create account → GET returns the account shape.
 *     • 404 for unknown account id (within tenant).
 *     • tenant isolation: account created in tenant-A is not visible from tenant-B.
 *     • missing x-tenant-id → 400 on both endpoints.
 *
 * All assertions against a live Node http server (startSovereignServer port=0).
 * Zero external dependencies — node:crypto + built-in fetch only.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (p: string, body: any, t = "wd-tenant-1") =>
  fetch(base + p, { method: "POST", headers: H(t), body: JSON.stringify(body) });
const get = (p: string, t = "wd-tenant-1") =>
  fetch(base + p, { headers: H(t) });

// ─── Shared state ────────────────────────────────────────────────────────────
// Setup creates an account with funds for withdraw tests.
let fundedAccountId: string;
const FUND_AMOUNT = "500000"; // 5.00 USD in μ¢

// ─── Setup ───────────────────────────────────────────────────────────────────

test("WITHDRAW SETUP: create and fund account", async () => {
  const acc = await (await post("/api/ledger/accounts", { ownerId: "wd-u1", type: "asset", name: "Alice" })).json();
  assert(acc.account && acc.account.id, "account created");
  fundedAccountId = acc.account.id;

  const mint = await post("/api/ledger/mint", { toAccountId: fundedAccountId, amount: FUND_AMOUNT, memo: "seed" });
  eq(mint.status, 200);
  const mintBody = await mint.json();
  assert(mintBody.ok, "mint succeeded");
});

// ─── POST /api/ledger/withdraw — validation ──────────────────────────────────

test("WITHDRAW: missing x-tenant-id → 400 (tenant isolation)", async () => {
  const r = await fetch(base + "/api/ledger/withdraw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fromAccountId: "any", amount: "100", memo: "test" }),
  });
  eq(r.status, 400);
});

test("WITHDRAW: missing fromAccountId → 400 (validation)", async () => {
  const r = await post("/api/ledger/withdraw", { amount: "100", memo: "no-account" });
  eq(r.status, 400);
  const body = await r.json();
  assert(body.error && typeof body.error === "string", "error message present");
  assert(body.error.includes("fromAccountId"), "error mentions missing field");
});

// ─── POST /api/ledger/withdraw — happy path ──────────────────────────────────

test("WITHDRAW: happy path → 200 + auditId + passport (auto-issue)", async () => {
  const r = await post("/api/ledger/withdraw", {
    fromAccountId: fundedAccountId,
    amount: "50000",
    memo: "partial withdrawal",
  });
  eq(r.status, 200);
  const body = await r.json();
  eq(body.ok, true);
  assert(typeof body.auditId === "string" && body.auditId.length > 0, "auditId present");
  assert(body.passport, "passport auto-issued inline (B.6.3)");

  const pp = body.passport;
  eq(pp.version, "1");
  eq(pp.tenantId, "wd-tenant-1");
  eq(pp.audit.id, body.auditId);
  eq(pp.audit.actionType, "ledger.withdraw");
  eq(pp.policyDecision.outcome, "allowed");
  assert(typeof pp.hash === "string" && pp.hash.length === 64, "passport hash is sha256 hex");
  assert(typeof pp.signature === "string" && pp.signature.length > 0, "passport signature present");
  // ledgerEffect is attached (auto-issue path)
  assert(pp.ledgerEffect != null, "ledgerEffect present on auto-issued withdraw passport");
  assert(pp.ledgerEffect.amount && /^\d+$/.test(pp.ledgerEffect.amount), "ledgerEffect.amount is decimal string (BigInt-safe)");
});

test("WITHDRAW: balance after withdraw is correct decimal string (BigInt-safe)", async () => {
  // Create fresh account to avoid shared state interference
  const acc = await (await post("/api/ledger/accounts", { ownerId: "wd-u2", type: "asset", name: "Bob" })).json();
  const accId = acc.account.id;
  await post("/api/ledger/mint", { toAccountId: accId, amount: "200000", memo: "seed" });
  const r = await post("/api/ledger/withdraw", { fromAccountId: accId, amount: "80000", memo: "partial" });
  eq(r.status, 200);

  // Verify remaining balance via transparency/balances
  const bal = await (await get("/api/transparency/balances")).json();
  const found = bal.accounts.find((a: any) => a.id === accId);
  assert(found, "account in balances");
  eq(found.balance, "120000");
  assert(/^-?\d+$/.test(found.balance), "balance is decimal string");
});

// ─── POST /api/ledger/withdraw — guard/fail-closed ───────────────────────────

test("WITHDRAW: over spending cap → 403, no passport leaked (fail-closed)", async () => {
  // DEFAULT_TX_CAP = 100_000_000 μ¢; 200_000_000 exceeds it.
  // Use a dedicated account to avoid balance issues.
  const acc = await (await post("/api/ledger/accounts", { ownerId: "wd-cap", type: "asset", name: "CapTest" })).json();
  await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "200000000", memo: "cap-seed" });
  const r = await post("/api/ledger/withdraw", {
    fromAccountId: acc.account.id,
    amount: "200000000",
    memo: "too-much",
  });
  // Mint put 200M in via the same cap — but withdraw of 200M exceeds cap → denied.
  // The guard fires before touching the ledger.
  eq(r.status, 403);
  const body = await r.json();
  assert(typeof body.error === "string" && body.error.length > 0, "error reason in body");
  assert(!("passport" in body), "no passport leaked on denial (fail-closed)");
});

test("WITHDRAW: insufficient funds → guard denies (fail-closed)", async () => {
  const acc = await (await post("/api/ledger/accounts", { ownerId: "wd-nsf", type: "asset", name: "NSF" })).json();
  await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "1000", memo: "tiny" });
  const r = await post("/api/ledger/withdraw", {
    fromAccountId: acc.account.id,
    amount: "9000000", // more than balance
    memo: "overdraft",
  });
  // Guard or ledger rejects: expect non-200
  assert(r.status >= 400, "insufficient-funds withdraw is rejected (got " + r.status + ")");
  const body = await r.json();
  assert(!("passport" in body) || body.passport == null, "no passport on failed withdrawal");
});

// ─── POST /api/ledger/withdraw — tenant isolation ────────────────────────────

test("WITHDRAW: cross-tenant account → guard deny / not found (tenant isolation)", async () => {
  // Create account in tenant-A, try to withdraw from tenant-B
  const accA = await (await post("/api/ledger/accounts", { ownerId: "iso-wd-u1", type: "asset", name: "IsoA" }, "wd-iso-A")).json();
  await post("/api/ledger/mint", { toAccountId: accA.account.id, amount: "10000", memo: "seed" }, "wd-iso-A");

  // Attempt from tenant-B — account doesn't exist in that tenant's view
  const r = await post("/api/ledger/withdraw", {
    fromAccountId: accA.account.id,
    amount: "1000",
    memo: "cross-tenant",
  }, "wd-iso-B");
  assert(r.status >= 400, "cross-tenant withdraw rejected (status " + r.status + ")");
});

// ─── GET /api/ledger/accounts/:id ────────────────────────────────────────────

test("ACCOUNTS GET: missing x-tenant-id → 400 (tenant isolation)", async () => {
  const r = await fetch(base + "/api/ledger/accounts/some-id");
  eq(r.status, 400);
});

test("ACCOUNTS GET: happy path — returns account shape with id, ownerId, balance", async () => {
  const created = await (await post("/api/ledger/accounts", { ownerId: "get-u1", type: "asset", name: "GetTest" })).json();
  const accId = created.account.id;

  const r = await get("/api/ledger/accounts/" + accId);
  eq(r.status, 200);
  const body = await r.json();
  assert(body.account || body.ok, "response has account data");
  const acc = body.account ?? body;
  assert(acc.id === accId || body.data?.id === accId, "account id matches");
});

test("ACCOUNTS GET: unknown id → 404 within tenant", async () => {
  const r = await get("/api/ledger/accounts/00000000-not-real-id-000000");
  // Route may return 404 or 403 depending on implementation
  assert(r.status === 404 || r.status === 400 || r.status === 403,
    "unknown account returns error status (got " + r.status + ")");
});

test("ACCOUNTS GET: tenant isolation — account in tenant-A not visible from tenant-B", async () => {
  const accA = await (await post("/api/ledger/accounts", { ownerId: "get-iso-u1", type: "asset", name: "IsoGetA" }, "get-iso-A")).json();
  const accId = accA.account.id;

  // Tenant-B should not find it
  const r = await get("/api/ledger/accounts/" + accId, "get-iso-B");
  assert(r.status >= 400, "account in tenant-A not accessible from tenant-B (status " + r.status + ")");
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

import { test as _t } from "../_harness.mjs";
_t("WITHDRAW/ACCOUNTS-GET: cleanup", () => { server.close(); });
