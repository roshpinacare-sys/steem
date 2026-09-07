import "../_flush.mjs";
/**
 * tests/sovereignty/break-glass-middleware.test.ts — enforcement chokepoint
 * for signed break-glass tickets on sensitive routes (MANIFEST v196 →
 * "החסר הבא #1", substep 1: middleware primitive + tests).
 *
 * Coverage (10 tests):
 *   • happy: valid ticket → ok + nonce consumed + signed audit appended
 *   • superadmin wildcard covers an unrelated required scope
 *   • exact scope match (ledger:transfer for ledger:transfer)
 *   • replay (same encoded ticket twice) → 409 + only ONE audit record
 *   • expired ticket → 401, no nonce, no audit
 *   • tenant mismatch (ticket for t1, route receives t2) → 401
 *   • grantScope does NOT cover requiredScope → 403, no nonce, no audit
 *   • garbage / non-base64 encoded ticket → 401
 *   • missing encoded ticket (undefined/empty string) → 401
 *   • signature invalid (tampered ticket re-encoded) → 401, audit untouched
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  enforceBreakGlassTicket,
  grantScopeCovers,
  BREAK_GLASS_CONSUMED_ACTION_TYPE,
} from "../../src/sovereignty/break-glass-middleware.ts";
import {
  issueBreakGlassTicket,
  encodeBreakGlassTicket,
  decodeBreakGlassTicket,
} from "../../src/sovereignty/break-glass.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";

const SECRET = "middleware-unit-secret-32bytes!!!";

function freshFixtures() {
  const signer = new HmacSigner(SECRET);
  const auditStore = new InMemoryAuditStore(signer);
  const nonceRegistry = new InMemoryNonceRegistry();
  return { signer, auditStore, nonceRegistry };
}

// ─── Unit: pure helper ──────────────────────────────────────────────────────

test("grantScopeCovers: exact match and superadmin wildcard, nothing else", () => {
  assert(grantScopeCovers("ledger:transfer", "ledger:transfer"));
  assert(grantScopeCovers("superadmin", "ledger:transfer"));
  assert(grantScopeCovers("superadmin", "settlement:write"));
  assert(!grantScopeCovers("ledger:transfer", "settlement:write"));
  assert(!grantScopeCovers("", "ledger:transfer"));
  assert(!grantScopeCovers("ledger:transfer", ""));
  assert(!grantScopeCovers("admin:break-glass", "ledger:transfer"));
});

// ─── Happy path ─────────────────────────────────────────────────────────────

test("middleware: valid ticket → ok:true, nonce consumed, signed audit appended", () => {
  const { signer, auditStore, nonceRegistry } = freshFixtures();
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "ledger:transfer", operator: "op-alice", reason: "incident response #99 prod" },
    signer,
  );
  const encoded = encodeBreakGlassTicket(ticket);
  const beforeLen = auditStore.getChain("t1").length;

  const res = enforceBreakGlassTicket({
    encodedTicket: encoded,
    tenantId: "t1",
    requiredScope: "ledger:transfer",
    signer,
    nonceRegistry,
    auditStore,
    operator: "op-alice",
  });

  assert(res.ok, `expected ok, got: ${JSON.stringify(res)}`);
  if (res.ok) {
    eq(res.ticket.tenantId, "t1");
    eq(res.ticket.grantScope, "ledger:transfer");
  }
  assert(nonceRegistry.has(ticket.nonce), "nonce recorded");
  const chain = auditStore.getChain("t1");
  eq(chain.length, beforeLen + 1);
  const last = chain[chain.length - 1];
  eq(last.actionType, BREAK_GLASS_CONSUMED_ACTION_TYPE);
  eq(last.outcome, "allowed");
  eq(last.actionId, ticket.ticketId);
  assert(typeof last.signature === "string" && last.signature.length > 0, "consume record is signed");
  assert(auditStore.verifyChain("t1"), "audit chain still intact");
});

test("middleware: superadmin grantScope covers an unrelated required scope", () => {
  const { signer, auditStore, nonceRegistry } = freshFixtures();
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "superadmin", operator: "op", reason: "rotating compromised key now" },
    signer,
  );
  const res = enforceBreakGlassTicket({
    encodedTicket: encodeBreakGlassTicket(ticket),
    tenantId: "t1",
    requiredScope: "settlement:write",
    signer,
    nonceRegistry,
    auditStore,
  });
  assert(res.ok, "superadmin grants any scope");
});

// ─── Replay detection ───────────────────────────────────────────────────────

test("middleware: same ticket twice → second call 409, exactly ONE audit record", () => {
  const { signer, auditStore, nonceRegistry } = freshFixtures();
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "ledger:transfer", operator: "op", reason: "replay-test incident drill" },
    signer,
  );
  const encoded = encodeBreakGlassTicket(ticket);

  const first = enforceBreakGlassTicket({
    encodedTicket: encoded, tenantId: "t1", requiredScope: "ledger:transfer",
    signer, nonceRegistry, auditStore,
  });
  assert(first.ok, "first use succeeds");

  const second = enforceBreakGlassTicket({
    encodedTicket: encoded, tenantId: "t1", requiredScope: "ledger:transfer",
    signer, nonceRegistry, auditStore,
  });
  assert(!second.ok, "second use rejected");
  if (!second.ok) {
    eq(second.denial.status, 409);
    assert(String(second.denial.body.error).includes("replay"), "error mentions replay");
  }
  // Only ONE consume audit record (the second was rejected BEFORE audit.append).
  const consumed = auditStore.getChain("t1").filter((r) => r.actionType === BREAK_GLASS_CONSUMED_ACTION_TYPE);
  eq(consumed.length, 1);
});

// ─── Fail-closed paths ──────────────────────────────────────────────────────

test("middleware: expired ticket → 401, no nonce, no audit", () => {
  const { signer, auditStore, nonceRegistry } = freshFixtures();
  const issued = new Date("2026-01-01T00:00:00Z");
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "ledger:transfer", operator: "op", reason: "expired ticket test ten", ttlMs: 1_000, now: () => issued },
    signer,
  );
  const after = new Date(issued.getTime() + 2_000);
  const res = enforceBreakGlassTicket({
    encodedTicket: encodeBreakGlassTicket(ticket),
    tenantId: "t1", requiredScope: "ledger:transfer",
    signer, nonceRegistry, auditStore,
    now: () => after,
  });
  assert(!res.ok);
  if (!res.ok) {
    eq(res.denial.status, 401);
    assert(String(res.denial.body.error).includes("expired"));
  }
  assert(!nonceRegistry.has(ticket.nonce), "nonce NOT recorded for expired ticket");
  eq(auditStore.getChain("t1").length, 0);
});

test("middleware: tenant mismatch (ticket bound to t1, route enforces t2) → 401", () => {
  const { signer, auditStore, nonceRegistry } = freshFixtures();
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "ledger:transfer", operator: "op", reason: "cross-tenant replay attempt ten" },
    signer,
  );
  const res = enforceBreakGlassTicket({
    encodedTicket: encodeBreakGlassTicket(ticket),
    tenantId: "t2", requiredScope: "ledger:transfer",
    signer, nonceRegistry, auditStore,
  });
  assert(!res.ok);
  if (!res.ok) {
    eq(res.denial.status, 401);
    assert(String(res.denial.body.error).includes("tenant"));
  }
  // Audit goes to no tenant (mismatch rejected before append).
  eq(auditStore.getChain("t1").length, 0);
  eq(auditStore.getChain("t2").length, 0);
});

test("middleware: grantScope does NOT cover requiredScope → 403, no nonce, no audit", () => {
  const { signer, auditStore, nonceRegistry } = freshFixtures();
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "ledger:transfer", operator: "op", reason: "scope-mismatch test incident" },
    signer,
  );
  const res = enforceBreakGlassTicket({
    encodedTicket: encodeBreakGlassTicket(ticket),
    tenantId: "t1", requiredScope: "settlement:write",
    signer, nonceRegistry, auditStore,
  });
  assert(!res.ok);
  if (!res.ok) {
    eq(res.denial.status, 403);
    assert(String(res.denial.body.error).includes("does not cover"));
  }
  assert(!nonceRegistry.has(ticket.nonce), "nonce NOT recorded when scope insufficient");
  eq(auditStore.getChain("t1").length, 0);
});

test("middleware: garbage encoded ticket → 401, no audit, no nonce", () => {
  const { signer, auditStore, nonceRegistry } = freshFixtures();
  for (const garbage of ["!!!not-base64!!!", "AAAA", "{}", ""]) {
    const res = enforceBreakGlassTicket({
      encodedTicket: garbage,
      tenantId: "t1", requiredScope: "ledger:transfer",
      signer, nonceRegistry, auditStore,
    });
    assert(!res.ok, `expected denial for ${JSON.stringify(garbage)}`);
    if (!res.ok) eq(res.denial.status, 401);
  }
  eq(auditStore.getChain("t1").length, 0);
});

test("middleware: missing encoded ticket (undefined, number, blank) → 401", () => {
  const { signer, auditStore, nonceRegistry } = freshFixtures();
  for (const bad of [undefined, null, 42, {}, ""] as unknown[]) {
    const res = enforceBreakGlassTicket({
      encodedTicket: bad,
      tenantId: "t1", requiredScope: "ledger:transfer",
      signer, nonceRegistry, auditStore,
    });
    assert(!res.ok, `expected denial for ${String(bad)}`);
    if (!res.ok) eq(res.denial.status, 401);
  }
});

test("middleware: signature tampered (re-encoded after edit) → 401", () => {
  const { signer, auditStore, nonceRegistry } = freshFixtures();
  const ticket = issueBreakGlassTicket(
    { tenantId: "t1", grantScope: "ledger:transfer", operator: "op", reason: "tamper-detection drill test" },
    signer,
  );
  const encoded = encodeBreakGlassTicket(ticket);
  // Decode → mutate grantScope → re-encode (signature now mismatches payload).
  const decoded = decodeBreakGlassTicket(encoded)!;
  const tampered = encodeBreakGlassTicket({ ...decoded, grantScope: "superadmin" });

  const res = enforceBreakGlassTicket({
    encodedTicket: tampered,
    tenantId: "t1", requiredScope: "ledger:transfer",
    signer, nonceRegistry, auditStore,
  });
  assert(!res.ok);
  if (!res.ok) {
    eq(res.denial.status, 401);
    assert(String(res.denial.body.error).includes("signature"));
  }
  eq(auditStore.getChain("t1").length, 0);
});
