import "../_flush.mjs";
/**
 * tests/integration/express-contract-passport.test.ts — B.6.4
 *
 * The big Express adapter (artifacts/api-server/src/routes/sovereign.routes.ts) is
 * outside this audit's scope (it imports `express`, which requires `pnpm install`).
 * The adapter is intentionally thin: its ONLY logic is
 *   res.status(out.status).json(bigIntSafe(out.body))
 * where `bigIntSafe` is now imported from `sovereign/src/http/json-safe.ts`.
 *
 * This test locks the contract the Express layer relies on:
 *   • bigIntSafe round-trips the kernel's mint response — `passport` is preserved,
 *     BigInt fields anywhere in the body become strings, and the result is a plain
 *     JSON-serializable object (no BigInt left).
 *   • Edge: solvency body has no `passport` key after bigIntSafe (no leak of a
 *     `null` field; absence is preserved).
 *   • Fail: guard denial (over spending cap) → 403, body has `error`, no `passport`.
 *
 * If this test breaks, the Express adapter would either drop the passport or throw
 * on BigInt — both regressions of v28 / B.6.3.
 */
import { test, eq, assert } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { sovereignRoutes, type Ctx, type Res } from "../../src/routes/sovereign-routes.ts";
import { bigIntSafe } from "../../src/http/json-safe.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { computePassportHash } from "../../lib/passport/index.ts";

const SECRET = "deterministic-express-contract-secret-base64-pad====";

function callRoute(method: string, pattern: string, ctx: Partial<Ctx>): Promise<Res> {
  const stack = buildSovereignStack(undefined, SECRET);
  const routes = sovereignRoutes(stack);
  const r = routes.find((x) => x.method === method && x.pattern === pattern);
  if (!r) throw new Error("route missing: " + method + " " + pattern);
  const full: Ctx = { tenantId: ctx.tenantId ?? "t-exp", body: ctx.body ?? {}, params: ctx.params ?? {} };
  return Promise.resolve(r.handler(full));
}

// Helper: build a fresh stack + run two calls against it (account + mint), as the
// Express adapter would on a single live stack.
async function mintOnFreshStack() {
  const stack = buildSovereignStack(undefined, SECRET);
  const routes = sovereignRoutes(stack);
  const exec = (m: string, p: string, c: Partial<Ctx>) => {
    const r = routes.find((x) => x.method === m && x.pattern === p)!;
    return Promise.resolve(r.handler({ tenantId: c.tenantId ?? "t-exp", body: c.body ?? {}, params: c.params ?? {}, scopes: ["superadmin"] }));
  };
  const acct = await exec("POST", "/api/ledger/accounts", { body: { ownerId: "u-1", type: "asset", name: "A" } });
  const accountId = acct.body.account.id;
  const mint = await exec("POST", "/api/ledger/mint", { body: { toAccountId: accountId, amount: "777000", memo: "exp" } });
  return { stack, acct, mint, exec };
}

test("EXPRESS CONTRACT B.6.4: bigIntSafe(mint body) preserves passport + strips BigInt", async () => {
  const { mint } = await mintOnFreshStack();
  eq(mint.status, 200);

  // bigIntSafe must not throw on this body and must round-trip through JSON.stringify cleanly.
  const safe: any = bigIntSafe(mint.body);
  const reSerialized = JSON.stringify(safe); // would throw if any BigInt slipped through
  assert(typeof reSerialized === "string" && reSerialized.length > 0, "body re-serializes to JSON");

  eq(safe.ok, true);
  assert(typeof safe.auditId === "string", "auditId is a string");
  assert(safe.passport, "passport carried inline (B.6.3) survives bigIntSafe (B.6.4)");
  eq(safe.passport.version, "1");
  eq(safe.passport.tenantId, "t-exp");
  eq(safe.passport.audit.id, safe.auditId);
  eq(safe.passport.audit.actionType, "ledger.mint");
  eq(safe.passport.policyDecision.outcome, "allowed");
  assert(safe.passport.ledgerEffect != null, "ledgerEffect attached (auto-issue path)");

  // Verifier round-trip: the same signer with the same secret verifies the passport
  // the adapter would have sent over the wire.
  const { hash, signature, ...passportBody } = safe.passport;
  eq(computePassportHash(passportBody), hash);
  assert(new HmacSigner(SECRET).verify(hash, signature), "passport signature verifies after bigIntSafe roundtrip");
});

test("EXPRESS CONTRACT B.6.4: bigIntSafe(solvency body) has no passport key (no false-positive leak)", async () => {
  const r = await callRoute("GET", "/api/ledger/solvency", {});
  eq(r.status, 200);
  const safe: any = bigIntSafe(r.body);
  eq(safe.ok, true);
  eq("passport" in safe, false);
  // Sanity: solvency body must also be JSON-serializable end-to-end.
  assert(typeof JSON.stringify(safe) === "string", "solvency body serializes");
});

test("EXPRESS CONTRACT B.6.4: guard denial → 403, bigIntSafe carries error, no passport leak", async () => {
  const stack = buildSovereignStack(undefined, SECRET);
  const routes = sovereignRoutes(stack);
  const exec = (m: string, p: string, c: Partial<Ctx>) => {
    const r = routes.find((x) => x.method === m && x.pattern === p)!;
    return Promise.resolve(r.handler({ tenantId: c.tenantId ?? "t-exp", body: c.body ?? {}, params: c.params ?? {}, scopes: ["superadmin"] }));
  };
  const acct = await exec("POST", "/api/ledger/accounts", { body: { ownerId: "u-2", type: "asset", name: "B" } });
  const mint = await exec("POST", "/api/ledger/mint", { body: { toAccountId: acct.body.account.id, amount: "999999999", memo: "nope" } });
  eq(mint.status, 403);
  const safe: any = bigIntSafe(mint.body);
  assert(typeof safe.error === "string" && safe.error.length > 0, "error reason serialized");
  eq("passport" in safe, false);
  eq("ok" in safe, false);
});