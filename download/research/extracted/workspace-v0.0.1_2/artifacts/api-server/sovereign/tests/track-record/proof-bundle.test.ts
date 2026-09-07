import "../_flush.mjs";
/**
 * tests/track-record/proof-bundle.test.ts — v125: the PUBLIC Trust API (deep-audit moat, K7).
 * A portable proof bundle: deterministic, hash-verifiable, carries the issuer public key and the
 * supporting passports. Any third party verifies it offline. Trust becomes portable.
 */
import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { EscrowService } from "../../lib/escrow/index.ts";
import { buildTrustProofBundle, verifyBundleHash, computeTrackRecord } from "../../lib/track-record/index.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

test("bundle hash verifies; tampering breaks it", async () => {
  const stack = buildSovereignStack();
  const t = "pb";
  const rec = await computeTrackRecord((stack as any).orchestrator.audit, stack.escrowStore, t, "x");
  const bundle = buildTrustProofBundle({ tenantId: t, identityId: "x", record: rec, passports: [], publicKey: "pk", algorithm: "hmac-sha256" });
  assert(verifyBundleHash(bundle), "fresh bundle verifies");
  const tampered = { ...bundle, record: { ...bundle.record, score: 100 } };
  assert(!verifyBundleHash(tampered as any), "tampered score breaks the hash");
});

test("LIVE: GET /api/track-record/:id/proof returns a verifiable bundle", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const H = { "content-type": "application/json", "x-tenant-id": "pblive" };
  const acc = async (o: string) => (await (await fetch(base + "/api/ledger/accounts", { method: "POST", headers: H, body: JSON.stringify({ ownerId: o, type: "asset", name: o }) })).json()).account.id;
  const payer = await acc("alice"); const worker = await acc("bob");
  await fetch(base + "/api/ledger/mint", { method: "POST", headers: H, body: JSON.stringify({ toAccountId: payer, amount: "500000", memo: "s", initiatedBy: "alice" }) });
  const e = await (await fetch(base + "/api/escrow", { method: "POST", headers: H, body: JSON.stringify({ opportunityId: "o", payerAccountId: payer, workerAccountId: worker, amount: "200000" }) })).json();
  const id = e.data?.agreement?.id ?? e.agreement?.id ?? e.data?.id;
  await fetch(base + `/api/escrow/${id}/fund`, { method: "POST", headers: H, body: JSON.stringify({ initiatedBy: "alice" }) });
  await fetch(base + `/api/escrow/${id}/release`, { method: "POST", headers: H, body: JSON.stringify({ initiatedBy: "alice" }) });

  const res = await fetch(base + "/api/track-record/bob/proof", { headers: H });
  eq(res.status, 200);
  const body = await res.json();
  assert(body.data.bundleHash, "bundle has a hash");
  eq(body.data.version, "1");
  assert(verifyBundleHash(body.data), "served bundle verifies offline");
  assert(body.data.record.settledAsWorker >= 1, "worker delivery reflected in the portable proof");
  server.close();
});
