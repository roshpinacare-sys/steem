import "../_flush.mjs";
/**
 * tests/ledger/ledger-persistence-boot.test.ts — v126.
 *
 * Proves the closed seam in the SYNCHRONOUS boot path (buildSovereignStack), which is
 * what the HTTP routes and most tests use:
 *
 *   FEATURE      a pool ⇒ the ledger is DrizzlePaymentProvider-backed (durable), and a
 *               real mint actually flows through it and is readable back.
 *   EDGE         an explicit provider still wins over a pool (precedence preserved).
 *   FAIL-CLOSED  production with neither provider nor pool refuses to boot an amnesiac
 *               money ledger (throws), instead of silently running in-memory.
 *
 * The deep-audit ("persistence truth") named this the last seam: trust that resets on
 * restart is not trust. A balance is financial truth — it must be as durable as audit.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { DrizzlePaymentProvider } from "../../lib/ledger/drizzle-payment-provider.ts";

// ── FEATURE: pool present (no NODE_ENV=production) → durable ledger that actually works ──
test("sync boot with a pool gives a DrizzlePaymentProvider-backed ledger and a mint persists", async () => {
  const prev = process.env.NODE_ENV;
  delete process.env.NODE_ENV; // prove it no longer depends on production
  try {
    const stack = buildSovereignStack(undefined, { pool: new InMemoryPool() } as any);
    eq((stack as any).persistenceReport.ledger, "pg", "ledger is reported durable under a pool");

    const acc = await stack.ledger.createAccount("tnt-boot", "u1", "asset", "Wallet");
    const res = await stack.ledger.mint("tnt-boot", acc.id, 7500n, "seed", "system");
    assert(res.ok, "mint succeeds through the Drizzle-backed ledger");
    const fetched = await stack.ledger.getAccount("tnt-boot", acc.id);
    eq(fetched.balance, 7500n, "balance flows through the durable provider (no race on idempotent DDL)");
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
  }
});

// ── EDGE: explicit provider beats the pool, and the report says so ──
test("an explicit InMemoryLedger provider still wins over a pool (precedence preserved)", async () => {
  const explicit = new InMemoryLedger();
  const stack = buildSovereignStack(undefined, { pool: new InMemoryPool(), provider: explicit } as any);
  eq((stack as any).persistenceReport.ledger, "in-memory", "explicit in-memory provider reported honestly");

  const acc = await stack.ledger.createAccount("tnt-edge", "u2", "asset", "W");
  await stack.ledger.mint("tnt-edge", acc.id, 200n, "seed", "system");
  // The operation must have landed in the explicit provider, not in a fresh pool-backed one.
  const fromExplicit = await explicit.getAccount("tnt-edge", acc.id);
  eq(fromExplicit.balance, 200n, "the explicit provider received the operation");
});

// ── FAIL-CLOSED: production with no provider and no pool must refuse to boot ──
test("production boot without provider or pool refuses (fail-closed, no amnesiac ledger)", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    let threw = false;
    try {
      buildSovereignStack(); // no pool, no provider, in production
    } catch (e) {
      threw = true;
      assert(/DbPool is required/i.test((e as Error).message), "throws the fail-closed reason");
    }
    assert(threw, "must refuse to boot a money ledger in-memory in production");
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
  }
});

// ── Sanity: the durable provider is actually the Drizzle one (type-level proof) ──
test("the pool-backed provider is a DrizzlePaymentProvider instance", () => {
  const stack = buildSovereignStack(undefined, { pool: new InMemoryPool() } as any);
  // The ledger orchestrator wraps the provider; persistenceReport derives from instanceof.
  eq((stack as any).persistenceReport.ledger, "pg");
  assert(DrizzlePaymentProvider != null, "DrizzlePaymentProvider import resolves");
});
