import "../_flush.mjs";
/**
 * tests/escrow/pg-threshold-approval-store.test.ts — v153.
 * PgThresholdApprovalStore: durable replay protection for threshold approvals.
 *
 *   DURABILITY    a consumed id survives a NEW store instance over the same pool
 *                 (= survives restart) → replay stays rejected. This is the gap closed.
 *   BASIC         hasConsumed/consume reflect state; unconsumed id → false.
 *   IDEMPOTENT    consuming the same id twice is a no-op (no duplicate persist).
 *   FAIL-CLOSED   blank / non-string id throws; missing pool throws.
 */
import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgThresholdApprovalStore } from "../../lib/escrow/pg-threshold-approval-store.ts";

// helper: drain the fire-and-forget write-through microtask queue
const flush = () => new Promise((r) => setTimeout(r, 0));

// ── BASIC ──
test("hasConsumed/consume reflect state", async () => {
  const pool = new InMemoryPool();
  const store = new PgThresholdApprovalStore(pool);
  await store.init();
  eq(store.hasConsumed("appr-1"), false, "unconsumed id is not consumed");
  store.consume("appr-1");
  eq(store.hasConsumed("appr-1"), true, "consumed id is now consumed");
  eq(store.hasConsumed("appr-2"), false, "unrelated id stays unconsumed");
});

// ── DURABILITY (the core gap): survives a fresh instance over the same pool ──
test("a consumed id survives a NEW store instance (restart) — replay stays blocked", async () => {
  const pool = new InMemoryPool();
  const store1 = new PgThresholdApprovalStore(pool);
  await store1.init();
  store1.consume("appr-restart");
  await flush(); // let the write-through INSERT land

  // Simulate a process restart: brand-new instance, same durable pool.
  const store2 = new PgThresholdApprovalStore(pool);
  await store2.init();
  eq(store2.hasConsumed("appr-restart"), true,
    "after restart the spent approval is still rejected (no replay)");
  eq(store1.getWriteErrorCount(), 0, "no write-through failures");
});

// ── IDEMPOTENT ──
test("consuming the same id twice is a no-op (single persisted row)", async () => {
  const pool = new InMemoryPool();
  const store = new PgThresholdApprovalStore(pool);
  await store.init();
  store.consume("appr-dup");
  store.consume("appr-dup");
  await flush();
  const res = await pool.query("SELECT id, consumed_at FROM consumed_threshold_approvals", []);
  const rows = res.rows.filter((r: any) => r.id === "appr-dup");
  eq(rows.length, 1, "exactly one persisted row for a doubly-consumed id");
  // A fresh instance still sees it once.
  const store2 = new PgThresholdApprovalStore(pool);
  await store2.init();
  eq(store2.hasConsumed("appr-dup"), true);
});

// ── FAIL-CLOSED ──
test("invalid id and missing pool fail closed", async () => {
  const pool = new InMemoryPool();
  const store = new PgThresholdApprovalStore(pool);
  await store.init();
  for (const bad of ["", null, undefined, 123]) {
    let threw = false;
    try { store.consume(bad as any); } catch (e) {
      threw = true;
      assert((e as Error).message.includes("non-empty string"), "explains the rejection");
    }
    assert(threw, `consume(${String(bad)}) must throw`);
  }
  // missing pool
  let poolThrew = false;
  try { new PgThresholdApprovalStore(undefined as any); } catch { poolThrew = true; }
  assert(poolThrew, "constructor without a pool must throw");
});
