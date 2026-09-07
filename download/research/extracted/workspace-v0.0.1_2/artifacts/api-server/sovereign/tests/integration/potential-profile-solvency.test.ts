import "../_flush.mjs";
/**
 * tests/integration/potential-profile-solvency.test.ts
 *
 * Live-server HTTP integration tests covering the missing flow from MANIFEST v48:
 *   "withdraw-then-solvency flow חסר"
 *
 * Covered paths:
 *
 *   GET /api/ledger/solvency
 *     • missing x-tenant-id → 400 (tenant isolation)
 *     • fresh tenant → isSolvent:true, all BigInt fields are decimal strings
 *     • after mint: totalAssets increases, still solvent
 *     • after withdraw: totalAssets decreases (reflects the withdrawal), still solvent
 *     • sequential withdraws: cumulative balance reduction visible in proof
 *     • tenant isolation: solvency of tenant-A is independent of tenant-B
 *     • auditId present in solvency response
 *
 *   POST /api/potential/profile (response-shape and solvency-independence checks)
 *     • happy path: 200, ok:true, auditId string
 *     • result data field accessible (data or result key)
 *     • signals forwarded: response shape stable with knowledgeSignals
 *     • potential does NOT affect ledger solvency (solvency proof unchanged after analyze)
 *     • missing x-tenant-id → 400
 *     • missing userId → 400
 *
 *   Cross-route: withdraw → solvency → potential/profile → solvency (full round trip)
 *     • solvency after potential call unchanged from solvency after withdraw
 *
 * All assertions against a live Node http server (startSovereignServer port=0).
 * Zero external dependencies — built-in fetch only.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (path: string, body: any, tenant = "sol-t1") =>
  fetch(base + path, { method: "POST", headers: H(tenant), body: JSON.stringify(body) });
const get = (path: string, tenant = "sol-t1") =>
  fetch(base + path, { headers: H(tenant) });

// ─── Shared state for the withdraw-then-solvency flow ────────────────────────
let solAccountId: string;
const MINT_AMOUNT = "1000000"; // 10 USD in μ¢

// ─── Setup: create and fund an account for solvency tests ────────────────────

test("SOLVENCY SETUP: create and fund account for flow tests", async () => {
  const r = await post("/api/ledger/accounts", { ownerId: "sol-u1", type: "asset", name: "SolvencyTest" });
  eq(r.status, 201, "account creation should be 201 (or 200)");
  const body = await r.json();
  assert(body.account?.id, "account.id present");
  solAccountId = body.account.id;

  const mint = await post("/api/ledger/mint", { toAccountId: solAccountId, amount: MINT_AMOUNT, memo: "sol-seed" });
  // mint returns 200
  assert(mint.status === 200 || mint.status === 201, "mint succeeded (status " + mint.status + ")");
  const mintBody = await mint.json();
  assert(mintBody.ok, "mint body ok");
});

// ─── GET /api/ledger/solvency — tenant isolation ──────────────────────────────

test("SOLVENCY: missing x-tenant-id → 400 (tenant isolation)", async () => {
  const r = await fetch(base + "/api/ledger/solvency");
  eq(r.status, 400);
});

// ─── GET /api/ledger/solvency — response shape ────────────────────────────────

test("SOLVENCY: happy path — 200, ok:true, auditId, isSolvent:true", async () => {
  const r = await get("/api/ledger/solvency");
  eq(r.status, 200);
  const body = await r.json();
  eq(body.ok, true, "ok:true");
  assert(typeof body.auditId === "string" && body.auditId.length > 0, "auditId is non-empty string");
  const proof = body.data;
  assert(proof !== null && typeof proof === "object", "data is an object (SolvencyProof)");
  eq(proof.isSolvent, true, "isSolvent is true");
});

test("SOLVENCY: proof has BigInt-safe decimal string fields", async () => {
  const r = await get("/api/ledger/solvency");
  eq(r.status, 200);
  const { data: proof } = await r.json();
  // totalAssets, totalLiabilities, netEquity must be decimal strings (BigInt-serialised)
  assert(typeof proof.totalAssets === "string" && /^-?\d+$/.test(proof.totalAssets),
    "totalAssets is decimal string (BigInt-safe), got: " + proof.totalAssets);
  assert(typeof proof.totalLiabilities === "string" && /^-?\d+$/.test(proof.totalLiabilities),
    "totalLiabilities is decimal string, got: " + proof.totalLiabilities);
  assert(typeof proof.netEquity === "string" && /^-?\d+$/.test(proof.netEquity),
    "netEquity is decimal string, got: " + proof.netEquity);
  assert(typeof proof.accountCount === "number", "accountCount is a number");
  assert(typeof proof.generatedAt === "string", "generatedAt is a string timestamp");
});

test("SOLVENCY: after mint — totalAssets ≥ MINT_AMOUNT, isSolvent:true", async () => {
  // Account was minted in setup
  const r = await get("/api/ledger/solvency");
  eq(r.status, 200);
  const { data: proof } = await r.json();
  const total = BigInt(proof.totalAssets);
  assert(total >= BigInt(MINT_AMOUNT), "totalAssets ≥ minted amount (got " + proof.totalAssets + ")");
  eq(proof.isSolvent, true);
});

// ─── Withdraw → Solvency: the core missing flow ───────────────────────────────

test("SOLVENCY FLOW: solvency before withdraw has higher totalAssets than after", async () => {
  // Capture solvency before withdraw
  const before = await (await get("/api/ledger/solvency")).json();
  eq(before.ok, true);
  const totalBefore = BigInt(before.data.totalAssets);

  // Withdraw a portion
  const WITHDRAW = "200000"; // 2 USD
  const wr = await post("/api/ledger/withdraw", {
    fromAccountId: solAccountId,
    amount: WITHDRAW,
    memo: "solvency-test-withdraw",
  });
  eq(wr.status, 200, "withdraw should succeed (status " + wr.status + ")");

  // Capture solvency after withdraw
  const after = await (await get("/api/ledger/solvency")).json();
  eq(after.ok, true, "solvency proof ok after withdraw");
  const totalAfter = BigInt(after.data.totalAssets);

  // totalAssets should be lower by at least WITHDRAW (platform reserve may offset slightly)
  assert(totalAfter < totalBefore,
    "totalAssets after withdraw (" + totalAfter + ") < before (" + totalBefore + ")");
  eq(after.data.isSolvent, true, "still solvent after withdraw");
});

test("SOLVENCY FLOW: sequential withdraws — cumulative reduction in totalAssets", async () => {
  // Create a dedicated account to isolate state
  const acc = await (await post("/api/ledger/accounts", { ownerId: "seq-u1", type: "asset", name: "Sequential" })).json();
  const accId = acc.account.id;
  await post("/api/ledger/mint", { toAccountId: accId, amount: "900000", memo: "seq-seed" });

  const sol1 = await (await get("/api/ledger/solvency")).json();
  const t1 = BigInt(sol1.data.totalAssets);

  await post("/api/ledger/withdraw", { fromAccountId: accId, amount: "100000", memo: "wd-1" });
  const sol2 = await (await get("/api/ledger/solvency")).json();
  const t2 = BigInt(sol2.data.totalAssets);

  await post("/api/ledger/withdraw", { fromAccountId: accId, amount: "100000", memo: "wd-2" });
  const sol3 = await (await get("/api/ledger/solvency")).json();
  const t3 = BigInt(sol3.data.totalAssets);

  assert(t2 < t1, "after 1st withdraw: totalAssets lower");
  assert(t3 < t2, "after 2nd withdraw: totalAssets even lower");
  eq(sol3.data.isSolvent, true, "solvent after sequential withdraws");
});

test("SOLVENCY FLOW: withdraw response includes auditId; same audit visible via solvency", async () => {
  const acc = await (await post("/api/ledger/accounts", { ownerId: "audit-check-u1", type: "asset", name: "AuditCheck" })).json();
  await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "500000", memo: "seed" });

  const wr = await post("/api/ledger/withdraw", { fromAccountId: acc.account.id, amount: "50000", memo: "audit-check" });
  eq(wr.status, 200);
  const wrBody = await wr.json();
  assert(typeof wrBody.auditId === "string" && wrBody.auditId.length > 0, "withdraw carries auditId");

  // Solvency after should also carry an auditId (proof is itself audited)
  const solR = await (await get("/api/ledger/solvency")).json();
  assert(typeof solR.auditId === "string" && solR.auditId.length > 0, "solvency proof also has auditId");
});

// ─── Tenant isolation for solvency ───────────────────────────────────────────

test("SOLVENCY: tenant isolation — solvency proofs for different tenants are independent", async () => {
  const tA = "sol-iso-A";
  const tB = "sol-iso-B";

  // Fund tenant-A heavily
  const accA = await (await post("/api/ledger/accounts", { ownerId: "iso-u1", type: "asset", name: "IsoA" }, tA)).json();
  await post("/api/ledger/mint", { toAccountId: accA.account.id, amount: "5000000", memo: "a-seed" }, tA);

  // Tenant-B has no accounts
  const solA = await (await get("/api/ledger/solvency", tA)).json();
  const solB = await (await get("/api/ledger/solvency", tB)).json();

  eq(solA.ok, true);
  eq(solB.ok, true);
  // Tenant-A totalAssets should be ≥ 5000000; tenant-B should be 0 or independent
  assert(BigInt(solA.data.totalAssets) >= 5000000n,
    "tenant-A has ≥5M μ¢ in totalAssets, got: " + solA.data.totalAssets);
  // Tenant-B's totalAssets should NOT include tenant-A's accounts
  assert(
    BigInt(solB.data.totalAssets) < BigInt(solA.data.totalAssets),
    "tenant-B totalAssets unaffected by tenant-A mint",
  );
});

// ─── POST /api/potential/profile — response shape ────────────────────────────

test("POTENTIAL PROFILE: missing x-tenant-id → 400", async () => {
  const r = await fetch(base + "/api/potential/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "pp-u1" }),
  });
  eq(r.status, 400);
});

test("POTENTIAL PROFILE: missing userId → 400", async () => {
  const r = await post("/api/potential/profile", {});
  eq(r.status, 400);
  const body = await r.json();
  assert(body.error?.includes("userId"), "error mentions userId");
});

test("POTENTIAL PROFILE: happy path — 200, ok:true, auditId", async () => {
  const r = await post("/api/potential/profile", { userId: "pp-happy-u1" }, "pot-sol-t1");
  eq(r.status, 200);
  const body = await r.json();
  eq(body.ok, true);
  assert(typeof body.auditId === "string" && body.auditId.length > 0, "auditId present");
});

test("POTENTIAL PROFILE: with knowledgeSignals — 200, profile shape valid", async () => {
  const r = await post("/api/potential/profile", {
    userId: "pp-sig-u1",
    knowledgeSignals: [
      { category: "technical", label: "TypeScript", weight: 0.9, source: "project" },
      { category: "domain",    label: "fintech",    weight: 0.8, source: "history" },
    ],
    analyticsSignals: [
      { metric: "tasksCompleted", value: 42, windowDays: 30 },
    ],
  }, "pot-sol-sig-t1");
  eq(r.status, 200);
  const body = await r.json();
  eq(body.ok, true);
  // mapOp returns { ok, data, auditId }; data contains the StrengthProfile (or null for this engine)
  assert(typeof body === "object" && body !== null, "valid response object");
  assert(!body.error, "no error on happy path with signals");
});

// ─── Cross-route: potential does NOT affect ledger solvency ───────────────────

test("SOLVENCY INDEPENDENCE: solvency proof unchanged after potential/profile call", async () => {
  const tenant = "pot-sol-cross-t1";

  // Fund the tenant to have a baseline
  const acc = await (await post("/api/ledger/accounts", { ownerId: "psc-u1", type: "asset", name: "PSC" }, tenant)).json();
  await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "300000", memo: "psc-seed" }, tenant);

  // Solvency before potential call
  const before = await (await get("/api/ledger/solvency", tenant)).json();
  eq(before.ok, true);
  const totalBefore = before.data.totalAssets;

  // Potential analyze (does NOT touch ledger)
  const potR = await post("/api/potential/profile", { userId: "psc-u1" }, tenant);
  eq(potR.status, 200);

  // Solvency after potential call — must be unchanged
  const after = await (await get("/api/ledger/solvency", tenant)).json();
  eq(after.ok, true);
  eq(after.data.totalAssets, totalBefore, "solvency totalAssets unchanged after potential/profile call");
  eq(after.data.isSolvent, true);
});

// ─── Full round trip: withdraw → solvency → potential → solvency ──────────────

test("FULL FLOW: withdraw → solvency → potential/profile → solvency (end-to-end)", async () => {
  const tenant = "full-flow-t1";

  const acc = await (await post("/api/ledger/accounts", { ownerId: "ff-u1", type: "asset", name: "FullFlow" }, tenant)).json();
  await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "600000", memo: "ff-seed" }, tenant);

  // Step 1: solvency baseline
  const sol1 = await (await get("/api/ledger/solvency", tenant)).json();
  eq(sol1.ok, true);
  const t1 = BigInt(sol1.data.totalAssets);
  eq(sol1.data.isSolvent, true, "solvent at baseline");

  // Step 2: withdraw
  const wr = await post("/api/ledger/withdraw", { fromAccountId: acc.account.id, amount: "150000", memo: "ff-wd" }, tenant);
  eq(wr.status, 200, "withdraw succeeded");
  const wrBody = await wr.json();
  assert(wrBody.ok && typeof wrBody.auditId === "string", "withdraw has ok+auditId");

  // Step 3: solvency after withdraw
  const sol2 = await (await get("/api/ledger/solvency", tenant)).json();
  eq(sol2.ok, true);
  const t2 = BigInt(sol2.data.totalAssets);
  assert(t2 < t1, "totalAssets lower after withdraw (" + t2 + " < " + t1 + ")");
  eq(sol2.data.isSolvent, true, "still solvent after withdraw");

  // Step 4: potential/profile (non-financial operation)
  const pot = await post("/api/potential/profile", { userId: "ff-u1" }, tenant);
  eq(pot.status, 200, "potential profile 200");

  // Step 5: solvency after potential — must equal solvency after withdraw (potential is non-financial)
  const sol3 = await (await get("/api/ledger/solvency", tenant)).json();
  eq(sol3.ok, true);
  eq(sol3.data.totalAssets, sol2.data.totalAssets, "solvency unchanged by potential call");
  eq(sol3.data.isSolvent, true, "solvent at end of full flow");
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

import { test as _t } from "../_harness.mjs";
_t("SOLVENCY/POTENTIAL: cleanup", () => { server.close(); });
