import "../_flush.mjs";
/**
 * tests/ledger/ledger-cron.test.ts — LedgerCron unit & integration tests.
 *
 * Tests run offline (no Express, no DB) using InMemoryLedger.
 * The cron itself is tested with a very short interval so the suite is fast.
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { LedgerCron } from "../../src/monitor/ledger-cron.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function seedTenant(provider: InMemoryLedger, tenantId: string) {
  const alice = await provider.createAccount(tenantId, "alice", "asset", "Alice");
  await provider.guardMint(tenantId, alice.id, 5000n, "seed", "admin");
  return alice;
}

// ─── 1. initial state ────────────────────────────────────────────────────────

test("ledger-cron: initial state is stopped with empty tenants", () => {
  const cron = new LedgerCron(new InMemoryLedger());
  const s = cron.getStatus();
  eq(s.running, false, "not running before start()");
  eq(s.tenants.length, 0, "no tenants registered");
  eq(s.lastRunAt, null, "no last run");
  eq(s.nextRunAt, null, "no next run");
  eq(s.totalRuns, 0, "zero runs");
});

// ─── 2. registerTenant + getStatus ───────────────────────────────────────────

test("ledger-cron: registerTenant is reflected in getStatus", () => {
  const cron = new LedgerCron(new InMemoryLedger());
  cron.registerTenant("t1");
  cron.registerTenant("t2");
  cron.registerTenant("t1"); // idempotent
  const s = cron.getStatus();
  eq(s.tenants.length, 2, "two unique tenants");
  assert(s.tenants.includes("t1"), "t1 present");
  assert(s.tenants.includes("t2"), "t2 present");
});

// ─── 3. runNow — single tenant ───────────────────────────────────────────────

test("ledger-cron: runNow runs audit and populates results", async () => {
  const provider = new InMemoryLedger();
  const cron = new LedgerCron(provider);
  await seedTenant(provider, "t-now");

  const result = await cron.runNow("t-now");
  eq(result.tenantId, "t-now", "tenantId");
  eq(result.isSolvent, true, "solvent after seed mint");
  assert(result.accountsChecked >= 1, "at least one account audited");
  eq(result.anomalies.length, 0, "no anomalies on clean ledger");

  const status = cron.getStatus();
  eq(status.totalRuns, 1, "totalRuns incremented");
  assert(status.lastRunAt !== null, "lastRunAt set");
  assert("t-now" in status.results, "results keyed by tenantId");
  eq(status.results["t-now"]!.isSolvent, true, "result matches return value");
});

// ─── 4. start / stop lifecycle ───────────────────────────────────────────────

test("ledger-cron: start() fires immediately and marks running", async () => {
  const provider = new InMemoryLedger();
  await seedTenant(provider, "t-auto");
  const cron = new LedgerCron(provider, {}, 5_000); // long interval — we only test the immediate fire
  cron.registerTenant("t-auto");

  cron.start();
  eq(cron.running, true, "running after start()");

  // The immediate run is async — wait up to 500ms
  for (let i = 0; i < 10; i++) {
    await sleep(50);
    if (cron.getStatus().lastRunAt !== null) break;
  }
  assert(cron.getStatus().lastRunAt !== null, "immediate run fired within 500ms");
  assert(cron.getStatus().totalRuns >= 1, "at least one run recorded");

  cron.stop();
  eq(cron.running, false, "stopped after stop()");
});

test("ledger-cron: calling start() twice is idempotent", async () => {
  const cron = new LedgerCron(new InMemoryLedger(), {}, 5_000);
  cron.start();
  cron.start(); // second call should be no-op
  eq(cron.running, true, "still running after double start");
  cron.stop();
});

// ─── 5. interval ticks ───────────────────────────────────────────────────────

test("ledger-cron: periodic tick increments totalRuns", async () => {
  const provider = new InMemoryLedger();
  await seedTenant(provider, "t-tick");
  const cron = new LedgerCron(provider, {}, 80); // 80ms interval for speed
  cron.registerTenant("t-tick");

  cron.start();
  // Wait for at least 2 ticks (immediate + 1 interval)
  await sleep(200);
  cron.stop();

  const s = cron.getStatus();
  assert(s.totalRuns >= 2, `expected ≥2 runs, got ${s.totalRuns}`);
  eq(s.running, false, "stopped");
});

// ─── 6. nextRunAt calculation ─────────────────────────────────────────────────

test("ledger-cron: nextRunAt is in the future once cron is running", async () => {
  const provider = new InMemoryLedger();
  await seedTenant(provider, "t-next");
  const cron = new LedgerCron(provider, {}, 5_000);
  cron.registerTenant("t-next");
  cron.start();

  // Wait for immediate run
  await sleep(100);
  const s = cron.getStatus();
  assert(s.nextRunAt !== null, "nextRunAt set when running");
  assert(new Date(s.nextRunAt!).getTime() > Date.now(), "nextRunAt is in the future");

  cron.stop();
  eq(cron.getStatus().nextRunAt, null, "nextRunAt cleared after stop");
});

// ─── 7. anomaly detection in cron context ────────────────────────────────────

test("ledger-cron: runNow detects unauthorized mint anomaly", async () => {
  const provider = new InMemoryLedger();
  const tenantId = "t-anom";
  const alice = await provider.createAccount(tenantId, "alice", "asset", "Alice");
  await provider.guardMint(tenantId, alice.id, 500n, "rogue mint", "rogue-actor");

  const cron = new LedgerCron(provider, { highValueThreshold: 1_000n }, 5_000);
  const result = await cron.runNow(tenantId);

  assert(result.anomalies.length > 0, "anomaly detected");
  const hasUnauth = result.anomalies.some((a) =>
    a.toLowerCase().includes("unauthorized"),
  );
  assert(hasUnauth, "unauthorized mint anomaly flagged");
});

// ─── 8. stop() while no timer — safe no-op ───────────────────────────────────

test("ledger-cron: stop() when not running is a safe no-op", () => {
  const cron = new LedgerCron(new InMemoryLedger());
  cron.stop(); // should not throw
  eq(cron.running, false, "still not running");
});
