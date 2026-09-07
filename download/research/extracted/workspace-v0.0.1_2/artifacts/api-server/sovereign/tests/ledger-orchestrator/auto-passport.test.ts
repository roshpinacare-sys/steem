import "../_flush.mjs";
/**
 * tests/ledger-orchestrator/auto-passport.test.ts — v26 B.6.2.
 *
 * Verifies auto-passport issuance in LedgerOrchestrator: when a Signer is
 * wired through PassportIssuanceOptions, every successful mint / withdraw /
 * transfer returns a signed ActionPassport with the LedgerTransaction
 * attached as `ledgerEffect`, AND fires the onPassport hook.
 *
 * Coverage:
 *   • happy path mint → passport attached, signature verifies, ledgerEffect serialised
 *   • withdraw → passport attached, ledgerEffect kind = "withdraw"
 *   • transfer → passport attached, ledgerEffect kind = "transfer"
 *   • onPassport hook fires once per successful op, in order
 *   • backward compat: no signer → no `passport` field on result
 *   • denied op → no passport (passport only on ok=true)
 *   • passport.tenantId matches op tenant (tenant isolation)
 *   • composition root (buildSovereignStack) wires auto-passport by default
 *   • edge case: BigInt μ¢ amount serialised as decimal string in ledgerEffect
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { TfaOrchestrator } from "../../lib/orchestrator/orchestrator.ts";
import { allowAll, denyAll } from "../../lib/orchestrator/guard.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { LedgerOrchestrator } from "../../lib/ledger-orchestrator/ledger-orchestrator.ts";
import { computePassportHash } from "../../lib/passport/passport.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import type { ActionPassport } from "../../lib/passport/types.ts";

function makeStack(signer = new HmacSigner("test-secret-please-change-32bytes!!")) {
  const provider = new InMemoryLedger();
  const orchestrator = new TfaOrchestrator([allowAll()]);
  const hookCalls: ActionPassport[] = [];
  const ledger = new LedgerOrchestrator(provider, orchestrator, {
    signer,
    onPassport: (p) => hookCalls.push(p),
  });
  return { provider, orchestrator, ledger, signer, hookCalls };
}

// 1. mint emits a signed passport
test("auto-passport: mint returns signed passport with ledgerEffect", async () => {
  const { ledger, signer, hookCalls } = makeStack();
  const acc = await ledger.createAccount("t1", "u1", "asset", "wallet");
  const r = await ledger.mint("t1", acc.id, 500_000n, "starter", "system");
  assert(r.ok, "mint should succeed");
  if (!r.ok) return;
  assert(r.passport, "passport should be attached");
  const p = r.passport!;
  eq(p.version, "1");
  eq(p.tenantId, "t1");
  eq(p.audit.id, r.auditId);
  eq(p.policyDecision.outcome, "allowed");
  assert(p.ledgerEffect, "ledgerEffect should be set");
  eq(p.ledgerEffect!.kind, "mint");
  eq(p.ledgerEffect!.amount, "500000");
  // signature verifies — must include attestation field (always present, null when absent)
  const recomputed = computePassportHash({
    version: p.version, passportId: p.passportId, issuedAt: p.issuedAt,
    tenantId: p.tenantId, audit: p.audit, delegationChain: p.delegationChain,
    policyDecision: p.policyDecision, ledgerEffect: p.ledgerEffect,
    attestation: p.attestation, algorithm: p.algorithm,
  });
  eq(recomputed, p.hash);
  assert(signer.verify(p.hash, p.signature), "signature must verify");
  // hook fired exactly once
  eq(hookCalls.length, 1);
  eq(hookCalls[0].passportId, p.passportId);
});

// 2. withdraw also emits passport
test("auto-passport: withdraw returns passport with kind=withdraw", async () => {
  const { ledger, hookCalls } = makeStack();
  const acc = await ledger.createAccount("t1", "u1", "asset", "w");
  await ledger.mint("t1", acc.id, 1_000_000n, "seed", "system");
  const r = await ledger.withdraw("t1", acc.id, 100_000n, "pay", "u1");
  assert(r.ok, "withdraw should succeed");
  if (!r.ok) return;
  assert(r.passport, "passport on withdraw");
  eq(r.passport!.ledgerEffect!.kind, "withdraw");
  eq(r.passport!.ledgerEffect!.amount, "100000");
  // two passports issued total (mint + withdraw)
  eq(hookCalls.length, 2);
});

// 3. transfer also emits passport
test("auto-passport: transfer returns passport with kind=transfer", async () => {
  const { ledger } = makeStack();
  const a = await ledger.createAccount("t1", "u1", "asset", "a");
  const b = await ledger.createAccount("t1", "u2", "asset", "b");
  await ledger.mint("t1", a.id, 2_000_000n, "seed", "system");
  const r = await ledger.transfer("t1", a.id, b.id, 250_000n, "gift", "u1");
  assert(r.ok, "transfer should succeed");
  if (!r.ok) return;
  assert(r.passport, "passport on transfer");
  eq(r.passport!.ledgerEffect!.kind, "transfer");
  eq(r.passport!.ledgerEffect!.amount, "250000");
});

// 4. edge case: huge BigInt amount serialised as decimal string
test("auto-passport: BigInt μ¢ amounts serialise as decimal string", async () => {
  const { ledger } = makeStack();
  const acc = await ledger.createAccount("t1", "u1", "asset", "w");
  const big = 99_999_999_999_999_999_999n; // > Number.MAX_SAFE_INTEGER
  const r = await ledger.mint("t1", acc.id, big, "big", "system");
  assert(r.ok && r.passport, "mint+passport");
  if (!r.ok) return;
  eq(r.passport!.ledgerEffect!.amount, big.toString());
});

// 5. backward compat: no signer → no passport field
test("auto-passport: no signer wired → no passport (backward compat)", async () => {
  const provider = new InMemoryLedger();
  const orch = new TfaOrchestrator([allowAll()]);
  const ledger = new LedgerOrchestrator(provider, orch); // legacy 2-arg
  const acc = await ledger.createAccount("t1", "u1", "asset", "w");
  const r = await ledger.mint("t1", acc.id, 100n, "x", "system");
  assert(r.ok, "mint ok");
  if (!r.ok) return;
  eq((r as any).passport, undefined);
});

// 6. fail-closed: denied op → no passport at all
test("auto-passport: denied op produces no passport, hook not fired", async () => {
  const provider = new InMemoryLedger();
  const orch = new TfaOrchestrator([denyAll("blocked")]);
  const hookCalls: ActionPassport[] = [];
  const ledger = new LedgerOrchestrator(provider, orch, {
    signer: new HmacSigner("test-secret-please-change-32bytes!!"),
    onPassport: (p) => hookCalls.push(p),
  });
  const acc = await ledger.createAccount("t1", "u1", "asset", "w");
  const r = await ledger.mint("t1", acc.id, 100n, "x", "system");
  eq(r.ok, false);
  eq(hookCalls.length, 0);
});

// 7. tenant isolation in passport
test("auto-passport: passport.tenantId matches the op tenant", async () => {
  const { ledger } = makeStack();
  const a = await ledger.createAccount("tenant-A", "u", "asset", "a");
  const b = await ledger.createAccount("tenant-B", "u", "asset", "b");
  const rA = await ledger.mint("tenant-A", a.id, 100n, "x", "system");
  const rB = await ledger.mint("tenant-B", b.id, 200n, "x", "system");
  assert(rA.ok && rA.passport && rB.ok && rB.passport, "both ok");
  if (!rA.ok || !rB.ok) return;
  eq(rA.passport!.tenantId, "tenant-A");
  eq(rB.passport!.tenantId, "tenant-B");
  eq(rA.passport!.audit.tenantId, "tenant-A");
  eq(rB.passport!.audit.tenantId, "tenant-B");
});

// 8. composition root default wires auto-passport
test("auto-passport: buildSovereignStack issues passports by default", async () => {
  const stack = buildSovereignStack();
  const acc = await stack.ledger.createAccount("t1", "u1", "asset", "w");
  const r = await stack.ledger.mint("t1", acc.id, 1000n, "seed", "system");
  assert(r.ok, "stack mint ok");
  if (!r.ok) return;
  assert(r.passport, "stack should attach passport via composition wiring");
  // signature verifies with the same kernel signer
  assert(stack.signer.verify(r.passport!.hash, r.passport!.signature), "stack signer must verify");
});
