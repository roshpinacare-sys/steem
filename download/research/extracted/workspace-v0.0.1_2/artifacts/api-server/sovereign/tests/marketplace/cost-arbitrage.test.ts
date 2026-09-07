/**
 * tests/marketplace/cost-arbitrage.test.ts
 *
 * Coverage: happy path · edge cases · fail-closed
 *
 * HAPPY (9):  basic 3-vendor selection, spread computed correctly, caller array
 *             not mutated, single-vendor (spread=0), all tied (lexicographic
 *             winner), winner-is-last-alphabetically in a tie, large bigints
 *             (> MAX_SAFE_INTEGER) exact, routingFeeFromSpread 50% and 100%,
 *             routingFeeFromSpread 0 spread always 0.
 *
 * EDGE (5):   two-vendor tie broken by vendorId, zero-cost vendor wins,
 *             spread when tied is exactly 0n, fractional routing fee floors
 *             correctly (integer division), identical quotes but for vendorId
 *             produce stable sort.
 *
 * FAIL-CLOSED (11): empty array, non-array, duplicate vendorId,
 *                   non-string vendorId, empty-string vendorId,
 *                   negative cost, non-bigint cost (number),
 *                   non-bigint cost (string), null quote object,
 *                   routingFeeFromSpread denominator=0,
 *                   routingFeeFromSpread fraction > 1.
 */

import { test, assert, eq } from "../../tests/_harness.mjs";
import {
  selectCheapestVendor,
  routingFeeFromSpread,
  ArbitrageError,
} from "../../lib/marketplace/cost-arbitrage.ts";
import type { VendorQuote } from "../../lib/marketplace/cost-arbitrage.ts";

// ── Happy path ────────────────────────────────────────────────────────────────

test("selectCheapestVendor: basic 3-vendor — correct winner, runner-up, spread", () => {
  const quotes: VendorQuote[] = [
    { vendorId: "openai",    estimatedCostMc: 30_000n },
    { vendorId: "anthropic", estimatedCostMc: 25_000n },  // cheapest
    { vendorId: "gcp",       estimatedCostMc: 40_000n },
  ];
  const r = selectCheapestVendor(quotes);
  eq(r.winner.vendorId, "anthropic", "anthropic is cheapest");
  eq(r.winner.estimatedCostMc, 25_000n);
  eq(r.runnerUp!.vendorId, "openai", "openai is second cheapest");
  eq(r.runnerUp!.estimatedCostMc, 30_000n);
  eq(r.spreadMc, 5_000n, "spread = runnerUp - winner = 5000 μ¢");
});

test("selectCheapestVendor: sortedQuotes is ascending by cost", () => {
  const quotes: VendorQuote[] = [
    { vendorId: "z-vendor", estimatedCostMc: 100n },
    { vendorId: "a-vendor", estimatedCostMc: 50n },
    { vendorId: "m-vendor", estimatedCostMc: 75n },
  ];
  const { sortedQuotes } = selectCheapestVendor(quotes);
  eq(sortedQuotes[0].vendorId, "a-vendor");
  eq(sortedQuotes[1].vendorId, "m-vendor");
  eq(sortedQuotes[2].vendorId, "z-vendor");
});

test("selectCheapestVendor: caller's original array is not mutated", () => {
  const quotes: VendorQuote[] = [
    { vendorId: "b", estimatedCostMc: 200n },
    { vendorId: "a", estimatedCostMc: 100n },
  ];
  const origOrder = [quotes[0].vendorId, quotes[1].vendorId];
  selectCheapestVendor(quotes);
  eq(quotes[0].vendorId, origOrder[0], "first element unchanged");
  eq(quotes[1].vendorId, origOrder[1], "second element unchanged");
});

test("selectCheapestVendor: single vendor — runnerUp=null, spread=0n", () => {
  const r = selectCheapestVendor([{ vendorId: "solo", estimatedCostMc: 5_000n }]);
  eq(r.winner.vendorId, "solo");
  eq(r.runnerUp, null);
  eq(r.spreadMc, 0n);
});

test("selectCheapestVendor: all vendors tied — winner is lexicographically smallest vendorId", () => {
  const quotes: VendorQuote[] = [
    { vendorId: "zebra",    estimatedCostMc: 1_000n },
    { vendorId: "alpha",    estimatedCostMc: 1_000n },
    { vendorId: "mango",    estimatedCostMc: 1_000n },
  ];
  const r = selectCheapestVendor(quotes);
  eq(r.winner.vendorId, "alpha", "tie broken by lex ascending: alpha < mango < zebra");
  eq(r.spreadMc, 0n, "spread is 0 when tied");
});

test("selectCheapestVendor: exact large bigint arithmetic (> Number.MAX_SAFE_INTEGER)", () => {
  const big = 9_007_199_254_740_992n; // 2^53 — beyond float precision
  const quotes: VendorQuote[] = [
    { vendorId: "v1", estimatedCostMc: big + 1n },
    { vendorId: "v2", estimatedCostMc: big },
  ];
  const r = selectCheapestVendor(quotes);
  eq(r.winner.vendorId, "v2");
  eq(r.spreadMc, 1n, "spread is exactly 1 μ¢ even beyond float precision");
});

test("routingFeeFromSpread: 50% of spread (1n/2n)", () => {
  const fee = routingFeeFromSpread(10_000n, 1n, 2n);
  eq(fee, 5_000n);
});

test("routingFeeFromSpread: 100% of spread (1n/1n)", () => {
  const fee = routingFeeFromSpread(7_777n, 1n, 1n);
  eq(fee, 7_777n);
});

test("routingFeeFromSpread: spread=0n always returns 0n regardless of fraction", () => {
  eq(routingFeeFromSpread(0n, 1n, 2n), 0n);
  eq(routingFeeFromSpread(0n, 1n, 1n), 0n);
  eq(routingFeeFromSpread(0n, 0n, 1n), 0n);
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test("selectCheapestVendor: two-vendor tie — lower vendorId wins", () => {
  const quotes: VendorQuote[] = [
    { vendorId: "beta",  estimatedCostMc: 500n },
    { vendorId: "alpha", estimatedCostMc: 500n },
  ];
  const r = selectCheapestVendor(quotes);
  eq(r.winner.vendorId, "alpha", "alpha < beta lexicographically");
  eq(r.spreadMc, 0n);
});

test("selectCheapestVendor: zero-cost vendor wins", () => {
  const quotes: VendorQuote[] = [
    { vendorId: "paid",  estimatedCostMc: 1000n },
    { vendorId: "free",  estimatedCostMc: 0n },
  ];
  const r = selectCheapestVendor(quotes);
  eq(r.winner.vendorId, "free");
  eq(r.winner.estimatedCostMc, 0n);
  eq(r.spreadMc, 1000n);
});

test("routingFeeFromSpread: floor division (odd spread / 2 truncates)", () => {
  const fee = routingFeeFromSpread(7n, 1n, 2n);
  eq(fee, 3n, "7 / 2 floors to 3, not 4");
});

test("routingFeeFromSpread: 0% of spread (0n/5n)", () => {
  const fee = routingFeeFromSpread(10_000n, 0n, 5n);
  eq(fee, 0n, "0 numerator → fee is 0");
});

test("selectCheapestVendor: stable sort — same cost, deterministic across 5 vendors", () => {
  const quotes: VendorQuote[] = [
    { vendorId: "e", estimatedCostMc: 100n },
    { vendorId: "c", estimatedCostMc: 100n },
    { vendorId: "a", estimatedCostMc: 100n },
    { vendorId: "d", estimatedCostMc: 100n },
    { vendorId: "b", estimatedCostMc: 100n },
  ];
  const { sortedQuotes } = selectCheapestVendor(quotes);
  const ids = sortedQuotes.map(q => q.vendorId);
  assert(
    JSON.stringify(ids) === JSON.stringify(["a","b","c","d","e"]),
    "all-tied result is deterministically sorted a→e",
  );
});

// ── Fail-closed ───────────────────────────────────────────────────────────────

test("selectCheapestVendor: empty array → throws ArbitrageError EMPTY_QUOTES", () => {
  let threw = false;
  try { selectCheapestVendor([]); } catch (e) {
    threw = true;
    assert(e instanceof ArbitrageError);
    eq((e as ArbitrageError).code, "EMPTY_QUOTES");
  }
  assert(threw);
});

test("selectCheapestVendor: non-array input → throws ArbitrageError EMPTY_QUOTES", () => {
  let threw = false;
  try { selectCheapestVendor(null as unknown as VendorQuote[]); } catch (e) {
    threw = true;
    assert(e instanceof ArbitrageError);
    eq((e as ArbitrageError).code, "EMPTY_QUOTES");
  }
  assert(threw);
});

test("selectCheapestVendor: duplicate vendorId → throws DUPLICATE_VENDOR_ID", () => {
  let threw = false;
  try {
    selectCheapestVendor([
      { vendorId: "v1", estimatedCostMc: 100n },
      { vendorId: "v1", estimatedCostMc: 200n },
    ]);
  } catch (e) {
    threw = true;
    assert(e instanceof ArbitrageError);
    eq((e as ArbitrageError).code, "DUPLICATE_VENDOR_ID");
  }
  assert(threw);
});

test("selectCheapestVendor: null vendorId → throws INVALID_VENDOR_ID", () => {
  let threw = false;
  try {
    selectCheapestVendor([{ vendorId: null as unknown as string, estimatedCostMc: 100n }]);
  } catch (e) {
    threw = true;
    eq((e as ArbitrageError).code, "INVALID_VENDOR_ID");
  }
  assert(threw);
});

test("selectCheapestVendor: empty-string vendorId → throws INVALID_VENDOR_ID", () => {
  let threw = false;
  try {
    selectCheapestVendor([{ vendorId: "", estimatedCostMc: 100n }]);
  } catch (e) {
    threw = true;
    eq((e as ArbitrageError).code, "INVALID_VENDOR_ID");
  }
  assert(threw);
});

test("selectCheapestVendor: negative cost → throws INVALID_COST", () => {
  let threw = false;
  try {
    selectCheapestVendor([{ vendorId: "v1", estimatedCostMc: -1n }]);
  } catch (e) {
    threw = true;
    eq((e as ArbitrageError).code, "INVALID_COST");
  }
  assert(threw);
});

test("selectCheapestVendor: cost as number (not bigint) → throws INVALID_COST", () => {
  let threw = false;
  try {
    selectCheapestVendor([{ vendorId: "v1", estimatedCostMc: 100 as unknown as bigint }]);
  } catch (e) {
    threw = true;
    eq((e as ArbitrageError).code, "INVALID_COST");
  }
  assert(threw, "must throw when cost is a number, not bigint — money is always bigint");
});

test("selectCheapestVendor: cost as string (not bigint) → throws INVALID_COST", () => {
  let threw = false;
  try {
    selectCheapestVendor([{ vendorId: "v1", estimatedCostMc: "100" as unknown as bigint }]);
  } catch (e) {
    threw = true;
    eq((e as ArbitrageError).code, "INVALID_COST");
  }
  assert(threw);
});

test("selectCheapestVendor: null quote object in array → throws INVALID_VENDOR_ID", () => {
  let threw = false;
  try {
    selectCheapestVendor([null as unknown as VendorQuote]);
  } catch (e) {
    threw = true;
    assert(e instanceof ArbitrageError);
  }
  assert(threw);
});

test("routingFeeFromSpread: denominator=0 → throws INVALID_COST", () => {
  let threw = false;
  try { routingFeeFromSpread(1000n, 1n, 0n); } catch (e) {
    threw = true;
    assert(e instanceof ArbitrageError);
    eq((e as ArbitrageError).code, "INVALID_COST");
  }
  assert(threw);
});

test("routingFeeFromSpread: numerator > denominator → throws INVALID_COST (fee can't exceed spread)", () => {
  let threw = false;
  try { routingFeeFromSpread(1000n, 3n, 2n); } catch (e) {
    threw = true;
    eq((e as ArbitrageError).code, "INVALID_COST");
  }
  assert(threw, "fee fraction > 1 is nonsensical — would charge caller more than the spread");
});
