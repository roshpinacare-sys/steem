import "../_flush.mjs";
/**
 * tests/release/persistence-report.test.ts — v126: the LAST persistence seam is CLOSED.
 *
 * Up to v125 the ledger (financial truth) was the lone trust primitive that stayed
 * in-memory under a pool unless NODE_ENV=production. v126 makes the ledger follow the
 * same rule as every sibling store: a pool present ⇒ durable (DrizzlePaymentProvider).
 * The report stays HONEST: an explicit in-memory provider still wins and is reported
 * truthfully — no green illusions.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";

test("with a pool, EVERY trust primitive is durable — including the ledger (v126 seam closed)", () => {
  const stack = buildSovereignStack(undefined, { pool: new InMemoryPool() } as any);
  const r = (stack as any).persistenceReport;
  // ledger now joins the durable set — the seam the deep-audit flagged as critical.
  for (const k of ["ledger", "audit", "identities", "apiKeys", "escrow", "catalog", "personality", "successPath", "collaboration", "tenantPlans", "kgSource", "introduction"]) {
    eq(r[k], "pg", `${k} must be pg under a pool`);
  }
});

test("honest about provider precedence: an explicit in-memory ledger still wins, and is reported as in-memory", () => {
  // Edge case: a pool is present, but the caller injects an explicit InMemoryLedger.
  // Provider precedence must be preserved AND the report must not lie about it.
  const stack = buildSovereignStack(undefined, { pool: new InMemoryPool(), provider: new InMemoryLedger() } as any);
  eq((stack as any).persistenceReport.ledger, "in-memory");
});

test("no pool → everything in-memory, reported truthfully (dev mode)", () => {
  const prev = process.env.NODE_ENV;
  delete process.env.NODE_ENV; // ensure not production so in-memory fallback is allowed
  try {
    const stack = buildSovereignStack();
    const r = (stack as any).persistenceReport;
    for (const v of Object.values(r)) eq(v, "in-memory");
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
});
