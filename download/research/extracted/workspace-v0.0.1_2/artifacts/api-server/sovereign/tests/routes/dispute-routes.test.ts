import "../_flush.mjs";
/**
 * tests/routes/dispute-routes.test.ts
 * Coverage: POST /api/dispute/proof — happy path, edge cases, fail-closed.
 */
import { test, eq, assert } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { verifyBillingDisputeProof } from "../../lib/track-record/billing-dispute-proof.ts";

const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
const server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
const port = (server.address() as any).port as number;
server.unref();
await new Promise((r) => setTimeout(r, 50));

async function post(body: unknown, tenantId: string | undefined = "test-tenant") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tenantId) headers["x-tenant-id"] = tenantId;
  const res = await fetch(`http://127.0.0.1:${port}/api/dispute/proof`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as any };
}

// ─── Happy path ───────────────────────────────────────────────────────────────

test("POST /api/dispute/proof: OVERCHARGE proof round-trips and verifies against the kernel signer", async () => {
  const { status, body } = await post({
    intentId: "intent-1",
    authorizedMicrounits: "1000",
    billedMicrounits: "1500",
    decision: "allowed",
  });
  eq(status, 200);
  assert(body.ok);
  eq(body.proof.discrepancyType, "OVERCHARGE");
  eq(body.proof.authorizedMicrounits, "1000");
  eq(body.proof.billedMicrounits, "1500");
  eq(body.proof.tenantId, "test-tenant");
  eq(body.proof.intentId, "intent-1");
  eq(body.proof.signerId, "kernel");
  assert(verifyBillingDisputeProof(body.proof, stack.signer), "proof returned over HTTP must verify against the kernel signer");
});

test("POST /api/dispute/proof: DENIED_BUT_BILLED when decision is 'denied' and billed > 0", async () => {
  const { status, body } = await post({
    intentId: "intent-2",
    authorizedMicrounits: "0",
    billedMicrounits: "500",
    decision: "denied",
  });
  eq(status, 200);
  eq(body.proof.discrepancyType, "DENIED_BUT_BILLED");
  eq(body.proof.authorizedMicrounits, "0");
  assert(verifyBillingDisputeProof(body.proof, stack.signer));
});

test("POST /api/dispute/proof: AMOUNT_MISMATCH when billed < authorized (undercharge)", async () => {
  const { status, body } = await post({
    intentId: "intent-3",
    authorizedMicrounits: "9000",
    billedMicrounits: "100",
    decision: "allowed",
  });
  eq(status, 200);
  eq(body.proof.discrepancyType, "AMOUNT_MISMATCH");
  assert(verifyBillingDisputeProof(body.proof, stack.signer));
});

test("POST /api/dispute/proof: arbitrarily large BigInt amounts beyond Number.MAX_SAFE_INTEGER round-trip exactly", async () => {
  const huge = "123456789012345678901234567890";
  const { status, body } = await post({
    intentId: "intent-4",
    authorizedMicrounits: "1",
    billedMicrounits: huge,
    decision: "allowed",
  });
  eq(status, 200);
  eq(body.proof.billedMicrounits, huge);
  assert(verifyBillingDisputeProof(body.proof, stack.signer));
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

test("POST /api/dispute/proof: a tampered proof (billedMicrounits changed after issuance) fails verification", async () => {
  const { body } = await post({
    intentId: "intent-5",
    authorizedMicrounits: "1000",
    billedMicrounits: "2000",
    decision: "allowed",
  });
  const tampered = { ...body.proof, billedMicrounits: "9999" };
  assert(!verifyBillingDisputeProof(tampered, stack.signer), "tampering a signed field must break verification");
});

test("POST /api/dispute/proof: two different intents for the same tenant produce independently valid proofs", async () => {
  const r1 = await post({ intentId: "i-a", authorizedMicrounits: "100", billedMicrounits: "200", decision: "allowed" });
  const r2 = await post({ intentId: "i-b", authorizedMicrounits: "100", billedMicrounits: "300", decision: "allowed" });
  eq(r1.body.proof.intentId, "i-a");
  eq(r2.body.proof.intentId, "i-b");
  assert(verifyBillingDisputeProof(r1.body.proof, stack.signer));
  assert(verifyBillingDisputeProof(r2.body.proof, stack.signer));
});

// ─── Fail-closed ──────────────────────────────────────────────────────────────

test("POST /api/dispute/proof: missing x-tenant-id → 400", async () => {
  const { status, body } = await post(
    { intentId: "i", authorizedMicrounits: "0", billedMicrounits: "100", decision: "allowed" },
    null as any,
  );
  eq(status, 400);
  assert(body.error);
});

test("POST /api/dispute/proof: missing intentId → 400", async () => {
  const { status } = await post({ authorizedMicrounits: "0", billedMicrounits: "100", decision: "allowed" });
  eq(status, 400);
});

test("POST /api/dispute/proof: missing decision → 400", async () => {
  const { status } = await post({ intentId: "i", authorizedMicrounits: "0", billedMicrounits: "100" });
  eq(status, 400);
});

test("POST /api/dispute/proof: float billedMicrounits string → 400", async () => {
  const { status } = await post({ intentId: "i", authorizedMicrounits: "0", billedMicrounits: "100.5", decision: "allowed" });
  eq(status, 400);
});

test("POST /api/dispute/proof: negative authorizedMicrounits string → 400", async () => {
  const { status } = await post({ intentId: "i", authorizedMicrounits: "-100", billedMicrounits: "200", decision: "allowed" });
  eq(status, 400);
});

test("POST /api/dispute/proof: billedMicrounits = 0 → 400 (vendor must have charged something)", async () => {
  const { status } = await post({ intentId: "i", authorizedMicrounits: "100", billedMicrounits: "0", decision: "allowed" });
  eq(status, 400);
});

test("POST /api/dispute/proof: no discrepancy (billed === authorized, decision not denied) → 400", async () => {
  const { status, body } = await post({ intentId: "i", authorizedMicrounits: "500", billedMicrounits: "500", decision: "allowed" });
  eq(status, 400);
  assert(body.error);
});

test("POST /api/dispute/proof: missing body entirely (null) → 400", async () => {
  const { status } = await post(null);
  eq(status, 400);
});
