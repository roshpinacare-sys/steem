import "../_flush.mjs";
/**
 * tests/composition/kg-source-wiring.test.ts — v222.
 * Wire PgKnowledgeGraphSource into the boot path (quality hardening per MANIFEST ‹6›).
 *
 *   FEATURE       a pooled stack reports kgSource="pg" and exposes a durable
 *                 PgKnowledgeGraphSource wired to PotentialEngine.
 *   ROUTE-LOGIC   KG signals survive RESTART: a signal written via stack #1 is
 *                 readable by PotentialEngine on stack #2 over the same pool.
 *   EDGE          no pool → kgSource="in-memory", reported honestly.
 *   FAIL-CLOSED   tenant isolation: cross-tenant signals are discarded.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgKnowledgeGraphSource } from "../../lib/potential/pg-kg-source.ts";
import { InMemoryKnowledgeGraphSource } from "../../lib/potential/in-memory-kg-source.ts";

// ── FEATURE: pooled stack → durable KG source, reported honestly ──
test("a pooled stack wires PgKnowledgeGraphSource and reports kgSource=pg", () => {
  const stack = buildSovereignStack(undefined, { pool: new InMemoryPool() } as any);
  eq((stack as any).persistenceReport.kgSource, "pg");
  assert((stack as any).kgSource instanceof PgKnowledgeGraphSource, "kgSource is the Pg store");
});

// ── EDGE: no pool → in-memory, reported honestly ──
test("a pool-less stack uses the in-memory KG source and says so", () => {
  const stack = buildSovereignStack();
  eq((stack as any).persistenceReport.kgSource, "in-memory");
  assert((stack as any).kgSource instanceof InMemoryKnowledgeGraphSource, "kgSource is in-memory");
});

// ── ROUTE-LOGIC + RESTART: a KG signal survives a rebuild over the same pool ──
test("KG signals survive restart via the same pool", async () => {
  const pool = new InMemoryPool();
  const tenant = "tnt-kg";
  const user = "user-1";

  // Stack #1: write a signal.
  const stack1 = buildSovereignStack(undefined, { pool } as any);
  await (stack1 as any).kgSource.init();
  await (stack1 as any).kgSource.addSignal({
    userId: user,
    tenantId: tenant,
    nodeType: "skill",
    category: "technical",
    weight: 0.9,
  });

  // Verify signal is readable on stack #1.
  const signals1 = await (stack1 as any).kgSource.fetchSignals(user, tenant);
  eq(signals1.length, 1);
  eq(signals1[0].category, "technical");

  // RESTART: brand-new stack over the SAME pool must still see the signal.
  const stack2 = buildSovereignStack(undefined, { pool } as any);
  await (stack2 as any).kgSource.init();
  const signals2 = await (stack2 as any).kgSource.fetchSignals(user, tenant);
  eq(signals2.length, 1);
  eq(signals2[0].category, "technical");
});

// ── FAIL-CLOSED: tenant isolation enforced by PgKnowledgeGraphSource ──
test("PgKnowledgeGraphSource enforces tenant isolation (cross-tenant signals discarded)", async () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool } as any);
  await (stack as any).kgSource.init();

  // Signal for tenant A.
  await (stack as any).kgSource.addSignal({
    userId: "u1",
    tenantId: "tenant-a",
    nodeType: "skill",
    category: "technical",
    weight: 0.8,
  });

  // Signal for tenant B, same user.
  await (stack as any).kgSource.addSignal({
    userId: "u1",
    tenantId: "tenant-b",
    nodeType: "achievement",
    category: "leadership",
    weight: 0.7,
  });

  // Fetch for tenant-a must NOT include tenant-b's signal.
  const signalsA = await (stack as any).kgSource.fetchSignals("u1", "tenant-a");
  eq(signalsA.length, 1);
  eq(signalsA[0].tenantId, "tenant-a");
  eq(signalsA[0].nodeType, "skill");

  // Fetch for tenant-b must NOT include tenant-a's signal.
  const signalsB = await (stack as any).kgSource.fetchSignals("u1", "tenant-b");
  eq(signalsB.length, 1);
  eq(signalsB[0].tenantId, "tenant-b");
  eq(signalsB[0].nodeType, "achievement");
});
