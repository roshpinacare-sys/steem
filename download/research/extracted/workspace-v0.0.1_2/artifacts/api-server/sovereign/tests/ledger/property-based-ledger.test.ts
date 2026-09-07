import "../_flush.mjs";
/**
 * tests/ledger/property-based-ledger.test.ts — L13 (MANIFEST roadmap, שלב L #13):
 * "מחולל פעולות אקראיות (mint/transfer/escrow) שמאמת אינווריאנטים (solvency, sum-zero)
 * על אלפי צעדים."
 *
 * Zero external dependencies: a small deterministic PRNG (mulberry32) replaces a
 * fuzzing library — fully reproducible (fixed seeds logged on failure), no new deps.
 *
 * INVARIANTS CHECKED AFTER EVERY STEP (not just at the end — a bug that's introduced
 * and later masked by a compensating op would otherwise slip through):
 *   1. sum-zero: sum of ALL account balances within a tenant is always exactly 0n.
 *      (Established by tests/ledger/ledger.test.ts for fixed scenards; here it's
 *      checked after EVERY one of thousands of random mint/withdraw/transfer ops.)
 *   2. solvency: proofOfSolvency().isSolvent reflects totalAssets >= totalLiabilities
 *      for the CURRENT account set (recomputed independently in the test, not just
 *      trusting the ledger's own arithmetic).
 *   3. no negative USER asset balance: only the platform reserve (equity) account
 *      may go negative; every "asset"-typed account must stay >= 0 (guardWithdraw/
 *      transfer fail-closed on insufficient funds — this is the externally-visible
 *      proof that fail-closed actually holds across thousands of random sequences,
 *      not just the few hand-picked cases in ledger.test.ts).
 *   4. balanceHash determinism: re-running proofOfSolvency on an unchanged ledger
 *      state produces the identical hash (tamper-evidence requires this).
 *   5. tenant isolation: a second, untouched tenant's accounts/balances are never
 *      affected by any operation against the first tenant.
 *
 * Each random step is one of: mint (always succeeds — reserve can go arbitrarily
 * negative), withdraw (attempted on a random user account; insufficient-funds
 * rejections are expected and tracked, not errors), transfer (same; self-transfer
 * skipped). Multiple seeds × thousands of steps each give broad coverage while
 * staying fully deterministic and fast (offline, zero network/DB).
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryLedger, LedgerError } from "../../lib/ledger/in-memory-ledger.ts";
import type { Account } from "../../lib/ledger/types.ts";

// ─── Deterministic PRNG (mulberry32) — zero dependencies, fully reproducible ──

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ─── Invariant checks ─────────────────────────────────────────────────────────

async function checkSumZero(ledger: InMemoryLedger, tenantId: string, step: number, seed: number): Promise<void> {
  const accounts = await ledger.listAccounts(tenantId);
  const sum = accounts.reduce((acc, a) => acc + a.balance, 0n);
  assert(sum === 0n, `seed=${seed} step=${step}: sum-zero violated — total balance is ${sum} μ¢ across ${accounts.length} accounts`);
}

async function checkNoNegativeAssets(ledger: InMemoryLedger, tenantId: string, step: number, seed: number): Promise<void> {
  const accounts = await ledger.listAccounts(tenantId);
  for (const a of accounts) {
    if (a.type === "asset") {
      assert(a.balance >= 0n, `seed=${seed} step=${step}: user asset account ${a.id} went negative (${a.balance} μ¢) — fail-closed broken`);
    }
  }
}

async function checkSolvencyConsistency(ledger: InMemoryLedger, tenantId: string, step: number, seed: number): Promise<void> {
  const accounts = await ledger.listAccounts(tenantId);
  let totalAssets = 0n;
  let totalLiabilities = 0n;
  for (const a of accounts) {
    if (a.type === "asset") totalAssets += a.balance;
    else if (a.type === "liability") totalLiabilities += a.balance;
  }
  const expectedSolvent = totalAssets - totalLiabilities >= 0n;
  const proof = await ledger.proofOfSolvency(tenantId);
  eq(proof.isSolvent, expectedSolvent, `seed=${seed} step=${step}: proofOfSolvency.isSolvent disagrees with independently recomputed assets/liabilities`);
  eq(proof.totalAssets, totalAssets, `seed=${seed} step=${step}: totalAssets mismatch`);
  eq(proof.totalLiabilities, totalLiabilities, `seed=${seed} step=${step}: totalLiabilities mismatch`);
}

// ─── The fuzz runner ──────────────────────────────────────────────────────────

interface FuzzStats {
  mints: number;
  withdrawsOk: number;
  withdrawsRejected: number;
  transfersOk: number;
  transfersRejected: number;
  selfTransfersSkipped: number;
}

async function runFuzz(seed: number, steps: number, accountCount: number): Promise<FuzzStats> {
  const rng = mulberry32(seed);
  const ledger = new InMemoryLedger();
  const tenantId = `fuzz-${seed}`;

  // Untouched control tenant — proves isolation at the end.
  const controlTenantId = `fuzz-control-${seed}`;
  const controlAccount = await ledger.createAccount(controlTenantId, "control-owner", "asset", "Control");
  await ledger.guardMint(controlTenantId, controlAccount.id, 777_777n, "control seed", "fuzz");
  const controlSnapshotBefore = await ledger.listAccounts(controlTenantId);

  const accounts: Account[] = [];
  for (let i = 0; i < accountCount; i++) {
    accounts.push(await ledger.createAccount(tenantId, `owner-${i}`, "asset", `Account ${i}`));
  }

  const stats: FuzzStats = {
    mints: 0, withdrawsOk: 0, withdrawsRejected: 0,
    transfersOk: 0, transfersRejected: 0, selfTransfersSkipped: 0,
  };

  for (let step = 0; step < steps; step++) {
    const op = pick(rng, ["mint", "withdraw", "transfer"] as const);
    const amount = BigInt(randInt(rng, 1, 10_000));

    if (op === "mint") {
      const acc = pick(rng, accounts);
      await ledger.guardMint(tenantId, acc.id, amount, `fuzz-mint-${step}`, "fuzzer");
      stats.mints++;
    } else if (op === "withdraw") {
      const acc = pick(rng, accounts);
      try {
        await ledger.guardWithdraw(tenantId, acc.id, amount, `fuzz-withdraw-${step}`, "fuzzer");
        stats.withdrawsOk++;
      } catch (e) {
        assert(e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS",
          `seed=${seed} step=${step}: withdraw failed with unexpected error: ${(e as Error).message}`);
        stats.withdrawsRejected++;
      }
    } else {
      const from = pick(rng, accounts);
      const to = pick(rng, accounts);
      if (from.id === to.id) { stats.selfTransfersSkipped++; continue; }
      try {
        await ledger.transfer(tenantId, from.id, to.id, amount, `fuzz-transfer-${step}`, "fuzzer");
        stats.transfersOk++;
      } catch (e) {
        assert(e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS",
          `seed=${seed} step=${step}: transfer failed with unexpected error: ${(e as Error).message}`);
        stats.transfersRejected++;
      }
    }

    // Check invariants after EVERY step, not just at the end.
    await checkSumZero(ledger, tenantId, step, seed);
    await checkNoNegativeAssets(ledger, tenantId, step, seed);
    await checkSolvencyConsistency(ledger, tenantId, step, seed);
  }

  // Tenant isolation: the control tenant must be untouched by ANY of the
  // thousands of operations run against the fuzzed tenant above.
  const controlSnapshotAfter = await ledger.listAccounts(controlTenantId);
  eq(controlSnapshotAfter.length, controlSnapshotBefore.length, `seed=${seed}: control tenant account count changed`);
  for (let i = 0; i < controlSnapshotBefore.length; i++) {
    eq(controlSnapshotAfter[i].balance, controlSnapshotBefore[i].balance, `seed=${seed}: control tenant account ${controlSnapshotBefore[i].id} balance drifted — cross-tenant leak`);
  }

  // balanceHash determinism: re-running proofOfSolvency twice in a row on an
  // unchanged ledger state must produce the identical hash.
  const proof1 = await ledger.proofOfSolvency(tenantId);
  const proof2 = await ledger.proofOfSolvency(tenantId);
  eq(proof1.balanceHash, proof2.balanceHash, `seed=${seed}: balanceHash is not deterministic across repeated calls on unchanged state`);

  return stats;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("property-based ledger fuzz: seed=1, 2000 steps, 8 accounts — invariants hold throughout", async () => {
  const stats = await runFuzz(1, 2000, 8);
  // Sanity: the fuzzer actually exercised all three operation kinds and hit
  // both the success and rejection paths (otherwise the test would be vacuous).
  assert(stats.mints > 0, "mint ops occurred");
  assert(stats.withdrawsOk > 0, "some withdraws succeeded");
  assert(stats.withdrawsRejected > 0, "some withdraws were correctly rejected (insufficient funds)");
  assert(stats.transfersOk > 0, "some transfers succeeded");
  assert(stats.transfersRejected > 0, "some transfers were correctly rejected (insufficient funds)");
});

test("property-based ledger fuzz: seed=42, 3000 steps, 5 accounts — invariants hold throughout", async () => {
  const stats = await runFuzz(42, 3000, 5);
  assert(stats.mints + stats.withdrawsOk + stats.withdrawsRejected + stats.transfersOk + stats.transfersRejected + stats.selfTransfersSkipped === 3000);
});

test("property-based ledger fuzz: seed=999, 1500 steps, 20 accounts (wide fan-out) — invariants hold throughout", async () => {
  const stats = await runFuzz(999, 1500, 20);
  assert(stats.transfersOk > 0, "wide account pool still produces successful transfers");
});

test("property-based ledger fuzz: seed=7, 1 account, 1000 steps (only mint/withdraw, transfers self-skip) — invariants hold", async () => {
  // With a single account every "transfer" picks from===to and is skipped —
  // exercises the boundary where only mint/withdraw actually mutate state.
  const stats = await runFuzz(7, 1000, 1);
  eq(stats.transfersOk, 0, "single-account pool: no transfer can ever succeed");
  assert(stats.selfTransfersSkipped > 0, "self-transfers were attempted and skipped, not silently ignored");
  assert(stats.mints > 0 && (stats.withdrawsOk + stats.withdrawsRejected) > 0);
});

test("property-based ledger fuzz: reproducibility — same seed produces identical final state", async () => {
  // Determinism is the whole point of using a seeded PRNG instead of Math.random():
  // a failure must be reproducible by re-running with the same seed.
  const seed = 31415;
  const runOnce = async () => {
    const ledger = new InMemoryLedger();
    const rng = mulberry32(seed);
    const tenantId = "repro-tenant";
    const accounts: Account[] = [];
    for (let i = 0; i < 4; i++) accounts.push(await ledger.createAccount(tenantId, `o${i}`, "asset", `A${i}`));
    for (let step = 0; step < 200; step++) {
      const op = pick(rng, ["mint", "withdraw", "transfer"] as const);
      const amount = BigInt(randInt(rng, 1, 5000));
      const acc = pick(rng, accounts);
      try {
        if (op === "mint") await ledger.guardMint(tenantId, acc.id, amount, "m", "fuzzer");
        else if (op === "withdraw") await ledger.guardWithdraw(tenantId, acc.id, amount, "w", "fuzzer");
        else {
          const to = pick(rng, accounts);
          if (to.id !== acc.id) await ledger.transfer(tenantId, acc.id, to.id, amount, "t", "fuzzer");
        }
      } catch { /* expected rejections — state still deterministic */ }
    }
    return (await ledger.listAccounts(tenantId))
      .sort((a, b) => a.ownerId.localeCompare(b.ownerId))
      .map((a) => `${a.ownerId}:${a.balance}`);
  };

  const run1 = await runOnce();
  const run2 = await runOnce();
  eq(JSON.stringify(run1), JSON.stringify(run2), "identical seed must produce identical final balances — reproducibility broken");
});
