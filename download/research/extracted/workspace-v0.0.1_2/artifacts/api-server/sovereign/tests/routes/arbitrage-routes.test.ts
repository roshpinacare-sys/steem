import "../_flush.mjs";
/**
 * tests/routes/arbitrage-routes.test.ts
 * Coverage: POST /api/arbitrage/quotes — happy path, edge cases, fail-closed.
 */
import { test, eq, assert } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";

const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
const server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
const port = (server.address() as any).port as number;
server.unref();
await new Promise((r) => setTimeout(r, 50));

async function post(body: unknown, tenantId: string | undefined = "test-tenant") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tenantId) headers["x-tenant-id"] = tenantId;
  const res = await fetch(`http://127.0.0.1:${port}/api/arbitrage/quotes`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

// ─── Happy path ───────────────────────────────────────────────────────────────

test("POST /api/arbitrage/quotes: returns winner and spread for 3 vendors", async () => {
  const { status, body } = await post({
    quotes: [
      { vendorId: "anthropic", estimatedCostMc: "5000" },
      { vendorId: "openai",    estimatedCostMc: "3000" },
      { vendorId: "gcp",       estimatedCostMc: "7000" },
    ],
  });
  eq(status, 200);
  assert(body.ok);
  eq(body.winner.vendorId, "openai");
  eq(body.winner.estimatedCostMc, "3000");
  eq(body.runnerUp.vendorId, "anthropic");
  eq(body.spreadMc, "2000");
  eq(body.suggestedRoutingFeeMc, "1000"); // 50% of 2000
});

test("POST /api/arbitrage/quotes: sortedQuotes ascending by cost", async () => {
  const { status, body } = await post({
    quotes: [
      { vendorId: "c", estimatedCostMc: "9000" },
      { vendorId: "a", estimatedCostMc: "1000" },
      { vendorId: "b", estimatedCostMc: "5000" },
    ],
  });
  eq(status, 200);
  eq(body.sortedQuotes[0].vendorId, "a");
  eq(body.sortedQuotes[1].vendorId, "b");
  eq(body.sortedQuotes[2].vendorId, "c");
});

test("POST /api/arbitrage/quotes: tie-breaking by vendorId lex order", async () => {
  const { status, body } = await post({
    quotes: [
      { vendorId: "zeta",  estimatedCostMc: "1000" },
      { vendorId: "alpha", estimatedCostMc: "1000" },
    ],
  });
  eq(status, 200);
  eq(body.winner.vendorId, "alpha"); // alpha < zeta
  eq(body.spreadMc, "0");
  eq(body.suggestedRoutingFeeMc, "0");
});

test("POST /api/arbitrage/quotes: custom fee fraction 1/4 of spread", async () => {
  const { status, body } = await post({
    quotes: [
      { vendorId: "cheap",  estimatedCostMc: "1000" },
      { vendorId: "pricey", estimatedCostMc: "5000" },
    ],
    feeFractionNumerator: "1",
    feeFractionDenominator: "4",
  });
  eq(status, 200);
  eq(body.spreadMc, "4000");
  eq(body.suggestedRoutingFeeMc, "1000"); // floor(4000 * 1/4)
});

test("POST /api/arbitrage/quotes: single vendor → runnerUp=null, spread=0", async () => {
  const { status, body } = await post({
    quotes: [{ vendorId: "solo", estimatedCostMc: "2500" }],
  });
  eq(status, 200);
  eq(body.runnerUp, null);
  eq(body.spreadMc, "0");
  eq(body.suggestedRoutingFeeMc, "0");
});

test("POST /api/arbitrage/quotes: zero-cost vendor wins", async () => {
  const { status, body } = await post({
    quotes: [
      { vendorId: "free", estimatedCostMc: "0" },
      { vendorId: "paid", estimatedCostMc: "500" },
    ],
  });
  eq(status, 200);
  eq(body.winner.vendorId, "free");
  eq(body.spreadMc, "500");
});

test("POST /api/arbitrage/quotes: large BigInt preserves precision", async () => {
  const huge = "999999999999999999"; // > Number.MAX_SAFE_INTEGER
  const { status, body } = await post({
    quotes: [
      { vendorId: "cheap",  estimatedCostMc: "1" },
      { vendorId: "pricey", estimatedCostMc: huge },
    ],
  });
  eq(status, 200);
  eq(body.winner.estimatedCostMc, "1");
  eq(body.spreadMc, "999999999999999998");
});

test("POST /api/arbitrage/quotes: fee 0/1 → suggestedRoutingFeeMc=0", async () => {
  const { status, body } = await post({
    quotes: [
      { vendorId: "a", estimatedCostMc: "100" },
      { vendorId: "b", estimatedCostMc: "900" },
    ],
    feeFractionNumerator: "0",
    feeFractionDenominator: "1",
  });
  eq(status, 200);
  eq(body.suggestedRoutingFeeMc, "0");
});

// ─── Fail-closed cases ────────────────────────────────────────────────────────

test("POST /api/arbitrage/quotes: malformed estimatedCostMc string 'abc' → 400", async () => {
  const { status, body } = await post({ quotes: [{ vendorId: "a", estimatedCostMc: "abc" }] });
  eq(status, 400);
  assert(String(body.error).includes("estimatedCostMc"));
});

test("POST /api/arbitrage/quotes: empty quotes array → 400", async () => {
  const { status } = await post({ quotes: [] });
  eq(status, 400);
});

test("POST /api/arbitrage/quotes: missing quotes key → 400", async () => {
  const { status } = await post({ vendors: [] });
  eq(status, 400);
});

test("POST /api/arbitrage/quotes: float estimatedCostMc → 400", async () => {
  const { status, body } = await post({ quotes: [{ vendorId: "a", estimatedCostMc: "12.5" }] });
  eq(status, 400);
  assert(String(body.error).includes("estimatedCostMc"));
});

test("POST /api/arbitrage/quotes: negative estimatedCostMc → 400", async () => {
  const { status } = await post({ quotes: [{ vendorId: "a", estimatedCostMc: "-100" }] });
  eq(status, 400);
});

test("POST /api/arbitrage/quotes: duplicate vendorId → 400", async () => {
  const { status } = await post({
    quotes: [
      { vendorId: "dup", estimatedCostMc: "100" },
      { vendorId: "dup", estimatedCostMc: "200" },
    ],
  });
  eq(status, 400);
});

test("POST /api/arbitrage/quotes: feeFractionNumerator > denominator → 400", async () => {
  const { status } = await post({
    quotes: [{ vendorId: "a", estimatedCostMc: "100" }],
    feeFractionNumerator: "3",
    feeFractionDenominator: "2",
  });
  eq(status, 400);
});

test("POST /api/arbitrage/quotes: feeFractionDenominator=0 → 400", async () => {
  const { status } = await post({
    quotes: [{ vendorId: "a", estimatedCostMc: "100" }],
    feeFractionNumerator: "0",
    feeFractionDenominator: "0",
  });
  eq(status, 400);
});

test("POST /api/arbitrage/quotes: missing vendorId → 400", async () => {
  const { status } = await post({ quotes: [{ estimatedCostMc: "100" }] });
  eq(status, 400);
});
