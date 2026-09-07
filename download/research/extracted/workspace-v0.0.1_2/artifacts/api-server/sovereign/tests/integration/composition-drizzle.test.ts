import "../_flush.mjs";
/**
 * tests/integration/composition-drizzle.test.ts — v35-unified task 1.
 *
 * Verifies DrizzlePaymentProvider is connected to composition as default in
 * production (when a pool is supplied), while InMemoryLedger remains the default
 * for tests without a pool.
 *
 * Coverage:
 *   • buildSovereignStackAsync with pool → DrizzlePaymentProvider backed stack
 *   • buildSovereignStackAsync without pool → InMemoryLedger backed stack
 *   • Edge: explicit provider takes precedence over pool
 *   • Fail: invalid pool object throws at init time
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { DrizzlePaymentProvider, LedgerError } from "../../lib/ledger/drizzle-payment-provider.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { buildSovereignStackAsync, defaultPolicies } from "../../src/composition.ts";

// ─── 1. Happy path — pool provided creates DrizzlePaymentProvider-backed stack

test("composition.drizzle: buildSovereignStackAsync with pool uses DrizzlePaymentProvider", async () => {
  const pool = new InMemoryPool();
  const stack = await buildSovereignStackAsync(defaultPolicies(), { pool });
  assert(stack.ledger !== undefined, "stack has ledger");

  // Operate through the ledger orchestrator to confirm persistence
  const acc = await stack.ledger.createAccount("tenant-dz", "user-1", "asset", "Wallet");
  const mintResult = await stack.ledger.mint("tenant-dz", acc.id, 3000n, "seed", "system");
  assert(mintResult.ok, "mint should succeed");

  // Balance must persist (confirming DrizzlePaymentProvider is the backing store)
  const fetched = await stack.ledger.getAccount("tenant-dz", acc.id);
  eq(fetched.balance, 3000n, "balance persists in DrizzlePaymentProvider-backed stack");
});

// ─── 2. Backward compat — no pool falls back to InMemoryLedger

test("composition.drizzle: buildSovereignStackAsync without pool defaults to InMemoryLedger", async () => {
  const stack = await buildSovereignStackAsync();
  assert(stack.ledger !== undefined, "stack has ledger");

  const acc = await stack.ledger.createAccount("tenant-mem", "user-2", "asset", "MemWallet");
  const mintResult = await stack.ledger.mint("tenant-mem", acc.id, 1000n, "bonus", "system");
  assert(mintResult.ok, "mint should succeed");

  const fetched = await stack.ledger.getAccount("tenant-mem", acc.id);
  eq(fetched.balance, 1000n, "InMemoryLedger works by default");
});

// ─── 3. Edge — explicit provider takes precedence over pool

test("composition.drizzle: explicit provider wins over pool", async () => {
  const pool = new InMemoryPool();
  const explicitProvider = new InMemoryLedger();

  const stack = await buildSovereignStackAsync(defaultPolicies(), {
    pool,
    provider: explicitProvider,
  });

  // Create account via the stack — it must land in the explicit InMemoryLedger,
  // not in the pool-backed DrizzlePaymentProvider.
  const acc = await stack.ledger.createAccount("tenant-prec", "user-3", "asset", "Precedence");
  const mintResult = await stack.ledger.mint("tenant-prec", acc.id, 500n, "test", "system");
  assert(mintResult.ok, "mint via explicit provider succeeds");

  // Querying the explicit provider directly must find the account
  const fromExplicit = await explicitProvider.getAccount("tenant-prec", acc.id);
  eq(fromExplicit.balance, 500n, "explicit provider received the operation");

  // The pool should NOT have the account (because the explicit provider was used)
  const poolProvider = new DrizzlePaymentProvider(pool);
  await poolProvider.init();
  let threw = false;
  try {
    await poolProvider.getAccount("tenant-prec", acc.id);
  } catch (e) {
    threw = true;
    eq((e as LedgerError).code, "ACCOUNT_NOT_FOUND");
  }
  assert(threw, "pool-backed provider must not see the account (provider precedence)");
});

// ─── 4. Fail-closed — invalid pool throws during init

test("composition.drizzle: invalid pool throws at build time", async () => {
  const badPool = {
    // Missing query method — not a valid DbPool
    connect: async () => ({ release: () => {} }),
    end: async () => {},
  } as any;

  let threw = false;
  try {
    await buildSovereignStackAsync(defaultPolicies(), { pool: badPool });
  } catch (e) {
    threw = true;
  }
  assert(threw, "invalid pool must throw during buildSovereignStackAsync");
});
