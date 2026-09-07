import "../_flush.mjs";
/**
 * tests/orchestrator/orchestrator-signing.test.ts — Orchestrator + Signer integration.
 *
 * Coverage:
 *   TfaOrchestrator + HmacSigner
 *     • allowed action → audit record carries signature
 *     • denied action → audit record carries signature
 *     • error action → audit record carries signature
 *     • verifyChain succeeds with signatures
 *     • tampering a record breaks verifyChain
 *
 *   TfaOrchestrator + Ed25519Signer
 *     • allowed action → audit record carries signature
 *     • verifyChain succeeds with signatures
 *
 *   Backward compatibility
 *     • no signer → no signatures, verifyChain still works
 *     • existing orchestrator tests behaviour unchanged
 *
 *   Composition root
 *     • buildSovereignStack wires HmacSigner by default
 *     • ledger actions produce signed audit records
 */

import { test, assert, eq } from "../_harness.mjs";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import { HmacSigner, Ed25519Signer, generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { allowAll, denyAll } from "../../lib/orchestrator/guard.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import type { Action } from "../../lib/orchestrator/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
function makeAction(overrides: Partial<Action> = {}): Action {
  _seq++;
  return {
    id: `action-${_seq}`,
    tenantId: "tenant-1",
    type: "agent.task.run",
    payload: { task: "test" },
    source: "test-agent",
    isFinancial: false,
    isAutonomous: false,
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

const HMAC_SECRET = "hmac-secret-32bytes-long!!!!!";

// ─── HmacSigner via Orchestrator ─────────────────────────────────────────────

test("Orchestrator + HmacSigner: allowed action record has signature", async () => {
  const signer = new HmacSigner(HMAC_SECRET);
  const orch = new TfaOrchestrator([allowAll()], undefined, signer);
  const result = await orch.run(makeAction(), async () => "ok");
  assert(result.ok);
  const rec = orch.audit.getRecord(result.auditId);
  assert(rec !== null, "record must exist");
  assert(rec!.signature && rec!.signature.length > 0, "signature must be present on allowed record");
});

test("Orchestrator + HmacSigner: denied action record has signature", async () => {
  const signer = new HmacSigner(HMAC_SECRET);
  const orch = new TfaOrchestrator([denyAll("blocked")], undefined, signer);
  const result = await orch.run(makeAction(), async () => "ok");
  assert(!result.ok);
  const rec = orch.audit.getRecord(result.auditId);
  assert(rec !== null);
  assert(rec!.signature && rec!.signature.length > 0, "signature must be present on denied record");
  eq(rec!.outcome, "denied");
});

test("Orchestrator + HmacSigner: error action record has signature", async () => {
  const signer = new HmacSigner(HMAC_SECRET);
  const orch = new TfaOrchestrator([allowAll()], undefined, signer);
  const result = await orch.run(makeAction(), async () => { throw new Error("boom"); });
  assert(!result.ok);
  const rec = orch.audit.getRecord(result.auditId);
  assert(rec !== null);
  assert(rec!.signature && rec!.signature.length > 0, "signature must be present on error record");
  eq(rec!.outcome, "error");
});

test("Orchestrator + HmacSigner: verifyChain succeeds for mixed outcomes", async () => {
  const signer = new HmacSigner(HMAC_SECRET);
  const orch = new TfaOrchestrator([allowAll()], undefined, signer);
  const t = "mixed-sig-tenant";
  await orch.run(makeAction({ tenantId: t }), async () => "a");
  await orch.run(makeAction({ tenantId: t }), async () => { throw new Error("e"); });
  assert(orch.audit.verifyChain(t), "chain with signatures must verify");
  eq(orch.audit.getChain(t).length, 2);
});

test("Orchestrator + HmacSigner: tampering breaks verifyChain", async () => {
  const signer = new HmacSigner(HMAC_SECRET);
  const store = new InMemoryAuditStore(signer);
  const orch = new TfaOrchestrator([allowAll()], store);
  const t = "tamper-sig-tenant";
  await orch.run(makeAction({ tenantId: t }), async () => "x");

  // Access internal chain to mutate (tests only)
  const internal = (store as any).chains.get(t) as any[];
  assert(internal && internal.length === 1, "internal chain must have 1 record");
  internal[0].outcome = "denied"; // mutate

  assert(!store.verifyChain(t), "tampered chain must fail verifyChain");
});

// ─── Ed25519Signer via Orchestrator ───────────────────────────────────────────

test("Orchestrator + Ed25519Signer: allowed action record has signature", async () => {
  const pair = generateAuditKeyPair();
  const signer = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const orch = new TfaOrchestrator([allowAll()], undefined, signer);
  const result = await orch.run(makeAction(), async () => "ok");
  assert(result.ok);
  const rec = orch.audit.getRecord(result.auditId);
  assert(rec !== null);
  assert(rec!.signature && rec!.signature.length > 0, "signature must be present with Ed25519");
});

test("Orchestrator + Ed25519Signer: verifyChain succeeds", async () => {
  const pair = generateAuditKeyPair();
  const signer = new Ed25519Signer(pair.privateKey, pair.publicKey);
  const orch = new TfaOrchestrator([allowAll()], undefined, signer);
  const t = "ed-chain-tenant";
  for (let i = 0; i < 3; i++) {
    await orch.run(makeAction({ tenantId: t }), async () => i);
  }
  assert(orch.audit.verifyChain(t), "Ed25519-signed chain must verify");
  eq(orch.audit.getChain(t).length, 3);
});

// ─── Backward compatibility ─────────────────────────────────────────────────

test("Backward compat: no signer → no signatures", async () => {
  const orch = new TfaOrchestrator([allowAll()]);
  const result = await orch.run(makeAction(), async () => "ok");
  assert(result.ok);
  const rec = orch.audit.getRecord(result.auditId);
  assert(rec !== null);
  assert(rec!.signature === undefined, "signature must be absent when no signer");
});

test("Backward compat: verifyChain works without signer", async () => {
  const orch = new TfaOrchestrator([allowAll()]);
  const t = "compat-tenant";
  await orch.run(makeAction({ tenantId: t }), async () => "a");
  await orch.run(makeAction({ tenantId: t }), async () => "b");
  assert(orch.audit.verifyChain(t), "chain without signer must still verify");
});

test("Backward compat: custom auditStore ignores signer param", async () => {
  const signer = new HmacSigner(HMAC_SECRET);
  const store = new InMemoryAuditStore(); // no signer
  const orch = new TfaOrchestrator([allowAll()], store, signer);
  const result = await orch.run(makeAction(), async () => "ok");
  assert(result.ok);
  const rec = orch.audit.getRecord(result.auditId);
  assert(rec !== null);
  assert(rec!.signature === undefined, "custom store without signer must ignore orchestrator signer");
});

// ─── Composition root ───────────────────────────────────────────────────────

test("Composition root: buildSovereignStack wires HmacSigner by default", async () => {
  const stack = buildSovereignStack();
  const orch = (stack.ledger as any).orchestrator;
  assert(orch !== null && orch !== undefined, "ledger must have orchestrator");

  // Trigger a ledger action through the orchestrator
  const action: Action = {
    id: `ledger-action-${++_seq}`,
    tenantId: "compose-tenant",
    type: "ledger.mint",
    payload: { toAccountId: "acc-1", amount: "1000" },
    source: "test",
    isFinancial: true,
    isAutonomous: false,
    requestedAt: new Date().toISOString(),
  };

  const result = await orch.run(action, async () => ({ minted: true }));
  assert(result.ok, "ledger action should be allowed by default policies");
  const rec = orch.audit.getRecord(result.auditId);
  assert(rec !== null);
  assert(rec!.signature && rec!.signature.length > 0, "composition root must produce signed audit records");
});

test("Composition root: custom auditSecret produces signed records", async () => {
  const secret = "my-fixed-secret-for-tests-32b!!!";
  const stack = buildSovereignStack(undefined, secret);
  const orch = (stack.ledger as any).orchestrator;

  const action: Action = {
    id: `ledger-action-${++_seq}`,
    tenantId: "det-tenant",
    type: "ledger.mint",
    payload: { toAccountId: "acc-1", amount: "500" },
    source: "test",
    isFinancial: true,
    isAutonomous: false,
    requestedAt: new Date().toISOString(),
  };

  const result = await orch.run(action, async () => ({ minted: true }));
  const rec = orch.audit.getRecord(result.auditId);
  assert(rec !== null);
  assert(rec!.signature && rec!.signature.length > 0, "custom secret must produce signed records");

  // Verify that the signature is valid using the store's verifyChain
  assert(orch.audit.verifyChain("det-tenant"), "chain with custom secret must verify");
});
