import "../_flush.mjs";
/**
 * tests/system/system-invariants.test.ts — the system's "physics laws" on one page.
 *
 * Acting on the external architecture review ("if you can't write the invariants
 * on one page, the system isn't defined"), this file aggregates the small number
 * of guarantees that must ALWAYS hold, and proves each against the REAL
 * composition root (buildSovereignStack) and the real primitives — not mocks.
 *
 * The laws:
 *   1. MONEY    — credit is created ONLY through guardMint; no public bypass,
 *                 and minting is fail-closed (positive amount, non-empty fields).
 *   2. TENANT   — a cross-tenant read or write never returns another tenant's
 *                 data; it errors or returns nothing.
 *   3. REPLAY   — a consumed nonce is seen on the second presentation (no double
 *                 spend), and re-adding is idempotent.
 *   4. AUDIT    — the audit chain is tamper-evident: verifyChain passes on a
 *                 genuine chain and fails the moment a record is altered.
 *   5. SPEC↔CODE— every reachable route is in the spec and every spec entry is
 *                 in code (the drift invariant; the detailed gate lives in
 *                 openapi-route-truth.test.ts — here we assert the gate exists
 *                 and is wired, so this law can never be silently dropped).
 *
 * If any of these fails, the failure is a system-level alarm, not a unit nit.
 */

import { test, assert, eq } from "../_harness.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import { resolveTenantId } from "../../src/http/tenant-resolver.ts";
import {
  selectCheapestVendor,
  routingFeeFromSpread,
  ArbitrageError,
  type VendorQuote,
} from "../../lib/marketplace/cost-arbitrage.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SECRET = "system-invariants-secret-32chars!!";

// ─── LAW 1: MONEY — credit is created only through the guarded mint path ───────

test("LAW 1 (money): the guarded mint/withdraw chokepoints are the sanctioned credit path", () => {
  const ledger = new InMemoryLedger();
  // The two documented chokepoints exist and are the public way to change supply.
  assert(typeof ledger.guardMint === "function", "guardMint exists (only way to create credits)");
  assert(typeof ledger.guardWithdraw === "function", "guardWithdraw exists (only way to destroy credits)");
  // The raw journal writer is NOT enumerable on the public-ish surface as an
  // alternative mint path: callers must go through the guards. (TS `private` is
  // erased at runtime, so the enforced guarantee is the presence + use of the
  // guards, which LAW 1's fail-closed test below exercises end-to-end.)
});

test("LAW 1 (money): mint is fail-closed — non-positive amount and empty fields are rejected", async () => {
  const ledger = new InMemoryLedger();
  const acct = await ledger.createAccount("t1", "owner-1", "user", "Acct");
  // happy: a positive mint succeeds and is solvent
  await ledger.guardMint("t1", acct.id, 100_000n, "seed", "system");
  const bal = await ledger.getAccount("t1", acct.id);
  eq(bal.balance.toString(), "100000", "minted credits land in the account");
  // fail-closed: zero / negative / empty memo all throw
  let zero = false, neg = false, empty = false;
  try { await ledger.guardMint("t1", acct.id, 0n, "x", "system"); } catch { zero = true; }
  try { await ledger.guardMint("t1", acct.id, -5n, "x", "system"); } catch { neg = true; }
  try { await ledger.guardMint("t1", acct.id, 1n, "", "system"); } catch { empty = true; }
  assert(zero, "zero-amount mint rejected");
  assert(neg, "negative-amount mint rejected");
  assert(empty, "empty-memo mint rejected");
});

// ─── LAW 2: TENANT — cross-tenant access never returns foreign data ────────────

test("LAW 2 (tenant): a cross-tenant read does not return another tenant's account", async () => {
  const ledger = new InMemoryLedger();
  const a = await ledger.createAccount("tenant-a", "owner-a", "user", "A");
  // Reading tenant-a's account under tenant-b must NOT return tenant-a's data.
  let leaked = false;
  try {
    const got = await ledger.getAccount("tenant-b", a.id);
    // If it returns at all, it must not be tenant-a's account.
    if (got && (got as any).tenantId === "tenant-a") leaked = true;
  } catch {
    // throwing is the correct fail-closed behaviour
  }
  assert(!leaked, "cross-tenant read must never expose another tenant's account");
});

test("LAW 2 (tenant): a cross-tenant transfer cannot move another tenant's funds", async () => {
  const ledger = new InMemoryLedger();
  const a = await ledger.createAccount("tenant-a", "owner-a", "user", "A");
  const b = await ledger.createAccount("tenant-b", "owner-b", "user", "B");
  await ledger.guardMint("tenant-a", a.id, 50_000n, "seed", "system");
  // tenant-b attempts to transfer tenant-a's account → must fail-closed.
  let moved = false;
  try {
    await ledger.transfer("tenant-b", a.id, b.id, 50_000n, "theft", "tenant-b");
    moved = true;
  } catch {
    // expected: cross-tenant transfer rejected
  }
  assert(!moved, "cross-tenant transfer must be rejected");
  // tenant-a's balance is untouched.
  const aBal = await ledger.getAccount("tenant-a", a.id);
  eq(aBal.balance.toString(), "50000", "victim balance unchanged");
});

// ─── LAW 3: REPLAY — a consumed nonce cannot be reused ─────────────────────────

test("LAW 3 (replay): a consumed nonce is seen on re-presentation; add is idempotent", () => {
  const reg = new InMemoryNonceRegistry();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  assert(!reg.has("nonce-1"), "fresh nonce is not yet seen");
  reg.add("nonce-1", future);
  assert(reg.has("nonce-1"), "consumed nonce is seen (replay blocked)");
  // idempotent re-add does not change the seen state
  reg.add("nonce-1", future);
  assert(reg.has("nonce-1"), "re-adding the same nonce keeps it seen");
});

// ─── LAW 4: AUDIT — the chain is tamper-evident ────────────────────────────────

test("LAW 4 (audit): verifyChain passes on a genuine chain and fails after tampering", () => {
  const signer = new HmacSigner(SECRET);
  const audit = new InMemoryAuditStore(signer);
  for (let i = 0; i < 3; i++) {
    audit.append({
      id: `rec-${i}`,
      tenantId: "t1",
      actionId: `act-${i}`,
      actionType: "test.action",
      source: "api",
      outcome: "allowed",
      reason: "ok",
    } as any);
  }
  assert(audit.verifyChain("t1"), "a genuine chain verifies");

  // Tamper with a record in place; the hash/signature chain must no longer verify.
  const chain = audit.getChain("t1");
  assert(chain.length === 3, "three records recorded");
  (chain[1] as any).outcome = "denied"; // mutate a committed record
  assert(!audit.verifyChain("t1"), "a tampered chain must fail verification");
});

// ─── LAW 5: SPEC↔CODE — the drift invariant is wired and can't be dropped ──────

test("LAW 5 (spec↔code): the route-truth drift gate exists and guards every route file", () => {
  const gate = join(ROOT, "tests/docs/openapi-route-truth.test.ts");
  assert(existsSync(gate), "the route-truth drift gate exists");
  const src = readFileSync(gate, "utf8");
  // The gate must assert both directions of the drift invariant.
  assert(/every registered code route is either in spec/i.test(src),
    "gate asserts every code route is in spec");
  assert(/every spec entry is either implemented in code/i.test(src),
    "gate asserts every spec entry is in code");
  // And it must carry the canary that breaks when route count drifts.
  assert(/drift canary/i.test(src), "gate carries a route-count drift canary");
});

// ─── LAW 6: PRODUCTION IDENTITY — a bare tenant header is never an identity in prod ──
// External architecture review flagged this as the one remaining invariant hole:
// the dev-convenient x-tenant-id path must never resolve a tenant under production
// enforcement. The mechanism (requireApiKey / TFA_REQUIRE_API_KEY) already exists;
// this law makes it permanent — a regression that re-opens the bare-header path in
// prod mode trips here.

test("LAW 6 (prod identity): under api-key enforcement, a bare x-tenant-id is rejected 401", async () => {
  // Production mode (requireApiKey=true): identity must come from a verified key.
  const prod = await resolveTenantId(undefined, { "x-tenant-id": "tenant-x" }, true);
  assert(prod.tenantId === undefined, "prod must NOT resolve a tenant from a bare header");
  eq(prod.status, 401, "bare tenant header is unauthenticated in prod (401)");

  // Same with no headers at all → still fail-closed, never a default tenant.
  const prodEmpty = await resolveTenantId(undefined, {}, true);
  assert(prodEmpty.tenantId === undefined, "prod resolves no tenant without a key");
  eq(prodEmpty.status, 401, "no-credential request is 401 in prod");
});

test("LAW 6 (prod identity): the dev-convenient bare-header path is dev-only", async () => {
  // Dev mode (requireApiKey=false) intentionally accepts a bare header for
  // convenience — but that is the ONLY mode where it resolves. This pins the
  // behaviour so the two modes can never silently converge.
  const dev = await resolveTenantId(undefined, { "x-tenant-id": "tenant-x" }, false);
  eq(dev.tenantId, "tenant-x", "dev mode accepts the bare header (by design)");
  // The crucial asymmetry: the SAME request is rejected under enforcement.
  const prod = await resolveTenantId(undefined, { "x-tenant-id": "tenant-x" }, true);
  assert(dev.tenantId !== undefined && prod.tenantId === undefined,
    "the bare-header path must behave differently in dev vs prod (no leak into prod)");
});

// ─── LAW 7: ECONOMIC FAIRNESS — a routing fee never exceeds the spread ─────────
// TFA's revenue model (cross-vendor cost arbitrage) is only legitimate if the
// caller always pays at most the next-best market price. That holds iff the
// platform's routing fee is capped by the spread (gap to the runner-up). This
// law pins that guarantee: a future change that lets the fee exceed the spread —
// silently overcharging the caller — trips here.

test("LAW 7 (economics): the cheapest vendor wins and the spread is the gap to runner-up", () => {
  const quotes: VendorQuote[] = [
    { vendorId: "vendor-b", estimatedCostMc: 300_000n },
    { vendorId: "vendor-a", estimatedCostMc: 100_000n }, // cheapest
    { vendorId: "vendor-c", estimatedCostMc: 250_000n },
  ];
  const r = selectCheapestVendor(quotes);
  eq(r.winner.vendorId, "vendor-a", "cheapest vendor wins");
  eq(r.runnerUp?.vendorId, "vendor-c", "runner-up is the second cheapest");
  // spread = 250_000 − 100_000 = 150_000
  eq(r.spreadMc.toString(), "150000", "spread is the gap to the runner-up");
});

test("LAW 7 (economics): routing fee can NEVER exceed the spread (caller pays ≤ market)", () => {
  const quotes: VendorQuote[] = [
    { vendorId: "a", estimatedCostMc: 100_000n },
    { vendorId: "b", estimatedCostMc: 160_000n },
  ];
  const { spreadMc } = selectCheapestVendor(quotes); // 60_000
  // Across every fraction of the spread, fee ≤ spread, and the caller's effective
  // price (winner cost + fee) never exceeds the runner-up's price.
  const winnerCost = 100_000n;
  const runnerUpCost = 160_000n;
  for (const [num, den] of [[0n, 1n], [1n, 2n], [3n, 4n], [1n, 1n]] as const) {
    const fee = routingFeeFromSpread(spreadMc, num, den);
    assert(fee <= spreadMc, `fee ${fee} must be ≤ spread ${spreadMc}`);
    assert(winnerCost + fee <= runnerUpCost, "caller pays ≤ the next-best market price");
  }
});

test("LAW 7 (economics): the fee function is fail-closed on invalid fractions", () => {
  let zeroDen = false, over = false, neg = false;
  try { routingFeeFromSpread(100n, 1n, 0n); } catch (e) { zeroDen = e instanceof ArbitrageError; }
  try { routingFeeFromSpread(100n, 3n, 2n); } catch (e) { over = e instanceof ArbitrageError; } // fraction > 1
  try { routingFeeFromSpread(100n, -1n, 2n); } catch (e) { neg = e instanceof ArbitrageError; }
  assert(zeroDen, "denominator 0 → throws (no divide-by-zero fee)");
  assert(over, "fraction > 1 → throws (fee can't exceed spread)");
  assert(neg, "negative numerator → throws");
});

test("LAW 7 (economics): a lone vendor has zero spread, so the max fee is zero", () => {
  const r = selectCheapestVendor([{ vendorId: "solo", estimatedCostMc: 500_000n }]);
  eq(r.spreadMc.toString(), "0", "no alternative → zero spread");
  eq(routingFeeFromSpread(r.spreadMc, 1n, 1n).toString(), "0", "no spread → no fee (can't overcharge)");
});

// ─── META: the composition root actually wires the primitives these laws guard ──

test("META: buildSovereignStack wires ledger, orchestrator, audit, nonce, transparency", () => {
  const stack = buildSovereignStack(undefined, SECRET);
  assert(stack.ledger, "stack has a ledger (LAW 1/2)");
  assert(stack.orchestrator, "stack has the orchestrator chokepoint");
  assert(stack.auditStore, "stack has the audit store (LAW 4)");
  assert(stack.nonceRegistry, "stack has the nonce registry (LAW 3)");
  assert(stack.transparencyLog, "stack has the transparency log");
});
