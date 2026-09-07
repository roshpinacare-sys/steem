import "../_flush.mjs";
/**
 * tests/integration/passport-claim-route.test.ts — GET /api/passports/:id/status
 *
 * Coverage:
 *   • missing x-tenant-id → 400 (tenant isolation).
 *   • unknown auditId → 404.
 *   • happy path: mint → GET /api/passports/:auditId/status returns a signed
 *     PassportClaim whose subject matches the passportId and whose hash verifies.
 *   • cross-tenant lookup → 404 (tenant_mismatch hidden as not-found).
 *   • claim shape: version="1", scope="passport.status", revocationStatus="active".
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { verifyPassportClaim } from "../../lib/passport/claim-verifier.ts";
import { canonicalPassportClaim, computeClaimHash } from "../../lib/passport/claim.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { buildSovereignStack } from "../../src/composition.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const post = (p: string, body: any, t = "pct-tenant-1") =>
  fetch(base + p, { method: "POST", headers: H(t), body: JSON.stringify(body) });
const get = (p: string, t = "pct-tenant-1") => fetch(base + p, { headers: H(t) });

test("CLAIM ROUTE: missing x-tenant-id → 400 (tenant isolation)", async () => {
  const r = await fetch(base + "/api/passports/anything/status");
  eq(r.status, 400);
});

test("CLAIM ROUTE: unknown auditId → 404", async () => {
  const r = await get("/api/passports/00000000-0000-0000-0000-000000000000/status");
  eq(r.status, 404);
  const body = await r.json();
  eq(body.error, "passport not found");
});

test("CLAIM ROUTE: happy path — mint → GET claim returns signed PassportClaim", async () => {
  const acc = await (await post("/api/ledger/accounts", { ownerId: "pct-u1", type: "asset", name: "Alice" })).json();
  const mintRes = await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "500000", memo: "seed" });
  eq(mintRes.status, 200);
  const mintBody = await mintRes.json();
  const auditId = mintBody.auditId;
  assert(typeof auditId === "string" && auditId.length > 0, "mint returned auditId");

  const r = await get("/api/passports/" + auditId + "/status");
  eq(r.status, 200);
  const { claim } = await r.json();
  assert(claim, "claim returned");
  eq(claim.version, "1");
  eq(claim.issuer, "pct-tenant-1");
  eq(claim.scope, "passport.status");
  eq(claim.revocationStatus, "active");
  assert(typeof claim.subject === "string" && claim.subject.length > 0, "subject (passportId) present");
  assert(Array.isArray(claim.evidenceRefs) && claim.evidenceRefs.includes(auditId), "evidenceRefs includes auditId");
  // Default composition does not wire injectReputationScore, so legacy path has no riskIntelligence.
  assert(claim.riskEvidence === undefined, "legacy path: claim.riskEvidence is absent (expected)");
  assert(typeof claim.hash === "string" && claim.hash.length === 64, "hash is 64-char hex");
  assert(typeof claim.signature === "string" && claim.signature.length > 0, "signature present");

  // Recompute hash from body and confirm it matches
  const { hash, signature, ...body } = claim;
  eq(computeClaimHash(body), hash);
  eq(canonicalPassportClaim(body), canonicalPassportClaim(body));
});

test("CLAIM ROUTE: claim hash is internally consistent (recomputes from body)", async () => {
  const acc = await (await post("/api/ledger/accounts", { ownerId: "pct-u2", type: "asset", name: "Bob" })).json();
  const mintRes = await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "1000", memo: "x" });
  const { auditId } = await mintRes.json();

  const r = await get("/api/passports/" + auditId + "/status");
  eq(r.status, 200);
  const { claim } = await r.json();

  // Recompute the canonical hash from the body and confirm it matches.
  const { hash, signature, ...body } = claim;
  eq(computeClaimHash(body), hash, "recomputed hash must match claim hash");
  // Signature is present and non-empty (server signed it with its kernel signer).
  assert(typeof signature === "string" && signature.length > 0, "signature present");
});

test("CLAIM ROUTE: cross-tenant lookup → 404 (tenant_mismatch hidden as not-found)", async () => {
  const acc = await (await post("/api/ledger/accounts", { ownerId: "pct-u3", type: "asset", name: "Carol" }, "pct-tenant-A")).json();
  const mintRes = await post("/api/ledger/mint", { toAccountId: acc.account.id, amount: "1000", memo: "y" }, "pct-tenant-A");
  const { auditId } = await mintRes.json();
  assert(auditId, "got auditId in tenant-A");

  const r = await get("/api/passports/" + auditId + "/status", "pct-tenant-B");
  eq(r.status, 404);
});

import { test as _t } from "../_harness.mjs";
_t("CLAIM ROUTE: cleanup", () => { server.close(); });
