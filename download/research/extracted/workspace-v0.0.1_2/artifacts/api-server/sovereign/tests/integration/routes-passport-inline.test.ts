import "../_flush.mjs";
/**
 * tests/integration/routes-passport-inline.test.ts — B.6.3
 *
 * Verifies that the framework-agnostic sovereign handlers attach the
 * auto-issued ActionPassport (LedgerOrchestrator → v27) directly to the
 * HTTP response body of /api/ledger/mint, /withdraw, /transfer, so external
 * callers no longer need a second GET /api/passport/:auditId round-trip.
 *
 * Coverage:
 *   • happy: mint succeeds → response body carries .passport, signed by
 *     the same kernel signer that GET /api/passport/:auditId would use.
 *   • edge:  solvency (no passport on result) → response body omits .passport.
 *   • fail:  guard denial (spending cap exceeded) → 403, no .passport leaked.
 *
 * Pure handler test — no HTTP server, no network. Calls sovereignRoutes()
 * directly with a fresh stack and invokes route.handler(ctx).
 */
import { test, eq, assert } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { sovereignRoutes, type Route, type Ctx, type Res } from "../../src/routes/sovereign-routes.ts";
import { computePassportHash } from "../../lib/passport/index.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";

const SECRET = "deterministic-secret-for-passport-roundtrip-base64-padding=";

function makeRoutes() {
  const stack = buildSovereignStack(undefined, SECRET);
  const routes = sovereignRoutes(stack);
  const find = (method: string, pattern: string): Route => {
    const r = routes.find((x) => x.method === method && x.pattern === pattern);
    if (!r) throw new Error("route not found: " + method + " " + pattern);
    return r;
  };
  const call = (method: string, pattern: string, ctx: Partial<Ctx>): Promise<Res> => {
    const full: Ctx = { tenantId: ctx.tenantId ?? "t-1", body: ctx.body ?? {}, params: ctx.params ?? {}, scopes: ["superadmin"] };
    return Promise.resolve(find(method, pattern).handler(full));
  };
  return { stack, call };
}

test("ROUTES B.6.3: mint response carries auto-issued passport signed by kernel signer", async () => {
  const { call } = makeRoutes();
  const acct = await call("POST", "/api/ledger/accounts", { body: { ownerId: "u-1", type: "asset", name: "Alice" } });
  eq(acct.status, 201);
  const accountId = acct.body.account.id;

  const mint = await call("POST", "/api/ledger/mint", { body: { toAccountId: accountId, amount: "500000", memo: "seed" } });
  eq(mint.status, 200);
  eq(mint.body.ok, true);
  assert(typeof mint.body.auditId === "string" && mint.body.auditId.length > 0, "auditId present");

  const passport = mint.body.passport;
  assert(passport, "passport attached to mint response (B.6.3)");
  eq(passport.version, "1");
  eq(passport.tenantId, "t-1");
  eq(passport.audit.id, mint.body.auditId);
  eq(passport.audit.actionType, "ledger.mint");
  eq(passport.policyDecision.outcome, "allowed");
  assert(passport.ledgerEffect != null, "ledgerEffect is attached (auto-issue path, not lazy)");

  // Same hash + signature an independent verifier would compute from body.
  const { hash, signature, ...body } = passport;
  const recomputed = computePassportHash(body);
  eq(recomputed, hash);
  const external = new HmacSigner(SECRET);
  assert(external.verify(hash, signature), "passport signature verifies against external HmacSigner with same secret");
});

test("ROUTES B.6.3: solvency response has no .passport field (no auto-issue on read ops)", async () => {
  const { call } = makeRoutes();
  const r = await call("GET", "/api/ledger/solvency", {});
  eq(r.status, 200);
  eq(r.body.ok, true);
  eq("passport" in r.body, false);
});

test("ROUTES B.6.3: guard denial (over spending cap) → 403 with no passport leaked", async () => {
  const { call } = makeRoutes();
  const acct = await call("POST", "/api/ledger/accounts", { body: { ownerId: "u-2", type: "asset", name: "Bob" } });
  const accountId = acct.body.account.id;

  // DEFAULT_TX_CAP is 100_000_000 μ¢; 200_000_000 exceeds it → policy deny.
  const mint = await call("POST", "/api/ledger/mint", { body: { toAccountId: accountId, amount: "200000000", memo: "too-much" } });
  eq(mint.status, 403);
  eq("passport" in mint.body, false);
  assert(typeof mint.body.error === "string" && mint.body.error.length > 0, "error reason returned");
});