import "../_flush.mjs";
/**
 * tests/indexer/insights.test.ts — v179.
 * computeTenantInsights: pure tenant-insights aggregation over the read-model.
 *
 *   FEATURE       settled count, volume (μ¢ BigInt), held, disputes, proofs.
 *   WINDOW        only in-window releases/proofs counted; trust-trend vs prior window.
 *   EDGE          held = total − released; disputed/reversed counted; empty input.
 *   FAIL-CLOSED   cross-tenant record throws; invalid tenantId/window/timestamp throws.
 */
import { test, assert, eq } from "../_harness.mjs";
import { computeTenantInsights } from "../../lib/indexer/insights.ts";
import { IndexerError } from "../../lib/indexer/types.ts";

const NOW = "2026-06-14T00:00:00.000Z";
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

const escrow = (o: Partial<any> = {}): any => ({
  id: "e1", tenantId: "t1", agreementId: "a1", opportunityId: "o1",
  payerAccountId: "p1", workerAccountId: "w1",
  totalAmountMicrounits: 1_000_000n, releasedAmountMicrounits: 1_000_000n,
  state: "released", createdAt: daysAgo(10), updatedAt: daysAgo(10), ...o,
});
const passport = (o: Partial<any> = {}): any => ({
  id: "pp1", tenantId: "t1", passportId: "P1", auditId: "au1",
  issuedAt: daysAgo(5), outcome: "allowed", attestationPresent: true, hash: "h", ...o,
});

test("aggregates settled count, volume, held, disputes and proofs", () => {
  const r = computeTenantInsights({
    tenantId: "t1", now: NOW,
    escrows: [
      escrow({ id: "e1", releasedAmountMicrounits: 1_000_000n, state: "released", updatedAt: daysAgo(3) }),
      escrow({ id: "e2", totalAmountMicrounits: 800_000n, releasedAmountMicrounits: 300_000n, state: "partially_released", updatedAt: daysAgo(4) }),
      escrow({ id: "e3", totalAmountMicrounits: 500_000n, releasedAmountMicrounits: 0n, state: "disputed", updatedAt: daysAgo(2) }),
    ],
    passports: [passport({ id: "pp1", issuedAt: daysAgo(5) }), passport({ id: "pp2", issuedAt: daysAgo(6) })],
  });
  eq(r.settledCount, 2, "released + partially_released in window");
  eq(r.volumeMicrounits, 1_300_000n, "sum of released amounts (BigInt μ¢)");
  eq(r.heldMicrounits, 500_000n + 500_000n, "held = Σ(total−released): e2 500k + e3 500k");
  eq(r.disputeCount, 1);
  eq(r.proofsIssued, 2);
  eq(typeof r.volumeMicrounits, "bigint", "money stays BigInt");
});

test("windowing: only in-window counts; trust-trend compares to previous window", () => {
  const r = computeTenantInsights({
    tenantId: "t1", now: NOW, windowDays: 30,
    escrows: [
      escrow({ id: "in", updatedAt: daysAgo(10), releasedAmountMicrounits: 100n }),
      escrow({ id: "old", updatedAt: daysAgo(40), releasedAmountMicrounits: 999n }), // outside window
    ],
    passports: [
      passport({ id: "p-now", issuedAt: daysAgo(5) }),   // current window
      passport({ id: "p-now2", issuedAt: daysAgo(20) }), // current window
      passport({ id: "p-prev", issuedAt: daysAgo(40) }), // previous window
    ],
  });
  eq(r.settledCount, 1, "old escrow excluded");
  eq(r.volumeMicrounits, 100n, "old volume excluded");
  eq(r.proofsIssued, 2);
  eq(r.trustTrendDelta, 1, "2 current − 1 previous");
  eq(r.trustTrend, "up");
});

test("edge: empty input yields zeros and a flat trend", () => {
  const r = computeTenantInsights({ tenantId: "t1", now: NOW, escrows: [], passports: [] });
  eq(r.settledCount, 0); eq(r.volumeMicrounits, 0n); eq(r.heldMicrounits, 0n);
  eq(r.disputeCount, 0); eq(r.proofsIssued, 0); eq(r.trustTrend, "flat"); eq(r.windowDays, 30);
});

test("fail-closed: cross-tenant records and invalid input throw IndexerError", () => {
  const expect = (fn: () => unknown, code: string) => {
    let e: any; try { fn(); } catch (x) { e = x; }
    assert(e instanceof IndexerError, "throws IndexerError");
    eq(e.code, code);
  };
  expect(() => computeTenantInsights({ tenantId: "t1", now: NOW, escrows: [escrow({ tenantId: "OTHER" })], passports: [] }), "tenant_mismatch");
  expect(() => computeTenantInsights({ tenantId: "t1", now: NOW, escrows: [], passports: [passport({ tenantId: "OTHER" })] }), "tenant_mismatch");
  expect(() => computeTenantInsights({ tenantId: "", now: NOW, escrows: [], passports: [] }), "invalid_input");
  expect(() => computeTenantInsights({ tenantId: "t1", now: "not-a-date", escrows: [], passports: [] }), "invalid_input");
  expect(() => computeTenantInsights({ tenantId: "t1", now: NOW, windowDays: 0, escrows: [], passports: [] }), "invalid_input");
});
