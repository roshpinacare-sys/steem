import "../_flush.mjs";
/**
 * tests/track-record/track-record.test.ts — Trust Price Discovery step 1.
 * The track record is DERIVED from the signed chain (write-nothing read-model):
 * settle escrows → score rises with explanation; denials → score falls; unknown identity → 50;
 * tenant isolation; deterministic recomputation; live HTTP endpoint.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { EscrowService } from "../../lib/escrow/index.ts";
import { computeTrackRecord } from "../../lib/track-record/index.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

async function settleOne(stack: any, t: string, funder: string, amount: bigint) {
  const payer = await stack.ledger.createAccount(t, funder, "asset", "P");
  const worker = await stack.ledger.createAccount(t, "worker-x", "asset", "W");
  await stack.ledger.mint(t, payer.id, amount * 2n, "seed", funder, false);
  const escrow = new EscrowService(stack.ledger, stack.escrowStore);
  const a = await escrow.create({ tenantId: t, opportunityId: "o", payerAccountId: payer.id, workerAccountId: worker.id, amount });
  await escrow.fund(t, a.id, funder);
  await escrow.release(t, a.id, funder);
  return worker.id;
}

test("unknown identity → score 50 (no assumed trust)", async () => {
  const stack = buildSovereignStack();
  const r = await computeTrackRecord((stack as any).orchestrator.audit, (stack as any).escrowStore, "t1", "nobody");
  eq(r.score, 50);
  eq(r.settledAsFunder + r.settledAsWorker, 0);
});

test("settlements raise the funder's score with explanation", async () => {
  const stack = buildSovereignStack();
  await settleOne(stack, "t2", "alice", 100_000n);
  await settleOne(stack, "t2", "alice", 100_000n);
  const r = await computeTrackRecord((stack as any).orchestrator.audit, (stack as any).escrowStore, "t2", "alice");
  assert(r.settledAsFunder >= 2, "two settlements counted");
  assert(r.score > 50, "score rose above neutral");
  assert(r.explanation.some(e => e.includes("settled")), "explanation names settlements");
});

test("policy denials lower the score (accountability includes attempts)", async () => {
  const stack = buildSovereignStack();
  const t = "t3";
  const payer = await stack.ledger.createAccount(t, "mallory", "asset", "M");
  // exceed the default cap → denied, recorded on the chain
  await stack.ledger.mint(t, payer.id, 999_999_999_999n, "huge", "mallory", false).catch(() => {});
  const r = await computeTrackRecord((stack as any).orchestrator.audit, (stack as any).escrowStore, t, "mallory");
  assert(r.denied >= 1, "denial counted");
  assert(r.score < 50, "score fell below neutral");
});

test("tenant isolation: record computed only from the tenant's own chain", async () => {
  const stack = buildSovereignStack();
  await settleOne(stack, "tA", "carol", 50_000n);
  const other = await computeTrackRecord((stack as any).orchestrator.audit, (stack as any).escrowStore, "tB", "carol");
  eq(other.settledAsFunder, 0, "no leak across tenants");
  eq(other.score, 50);
});

test("deterministic: recomputation yields the same score", async () => {
  const stack = buildSovereignStack();
  await settleOne(stack, "t5", "dave", 70_000n);
  const a = await computeTrackRecord((stack as any).orchestrator.audit, (stack as any).escrowStore, "t5", "dave");
  const b = await computeTrackRecord((stack as any).orchestrator.audit, (stack as any).escrowStore, "t5", "dave");
  eq(a.score, b.score);
  eq(a.settledVolume, b.settledVolume);
});

test("LIVE HTTP: GET /api/track-record/:identityId returns the record", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const res = await fetch(`http://127.0.0.1:${port}/api/track-record/someone`, { headers: { "x-tenant-id": "ht" } });
  eq(res.status, 200);
  const body = await res.json();
  eq(body.data.score, 50);
  assert(Array.isArray(body.data.explanation), "explanation present");
  server.close();
});
