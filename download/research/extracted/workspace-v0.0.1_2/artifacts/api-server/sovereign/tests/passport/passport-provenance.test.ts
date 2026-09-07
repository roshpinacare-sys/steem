import "../_flush.mjs";
/**
 * tests/passport/passport-provenance.test.ts — v315: provenance embedded in ActionPassport.
 *
 * Coverage:
 *   • happy path: AgentProvenanceInput → normalized provenance on passport
 *   • provenance.provenanceId is a stable sha256 fingerprint
 *   • pre-normalized AgentProvenance passes through unchanged
 *   • provenance included in canonical body → tampering breaks hash
 *   • no provenance supplied → passport.provenance is undefined (backward-compat)
 *   • invalid provenance (missing agentId) → throws ProvenanceError (fail-closed)
 *   • invalid provenance (empty vendor) → throws ProvenanceError (fail-closed)
 *   • cross-tenant: provenance fingerprint stable regardless of tenantId
 *   • two receipts for same agent produce same provenanceId (audit-trail join key)
 *   • two receipts for different agents produce different provenanceId
 */

import { test, assert, eq } from "../_harness.mjs";
import { issuePassport, computePassportHash } from "../../lib/passport/index.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import type { AuditRecord } from "../../lib/orchestrator/types.ts";
import { normalizeAgentProvenance } from "../../lib/adapter/agent-provenance.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let _seq = 0;
function nextId(prefix: string): string {
  _seq++;
  return `${prefix}-${_seq}`;
}

function makeStore(): InMemoryAuditStore {
  return new InMemoryAuditStore();
}

function appendRecord(store: InMemoryAuditStore, tenantId = "tenant-1"): AuditRecord {
  return store.append({
    id: nextId("aud"),
    tenantId,
    actionId: nextId("act"),
    actionType: "agent.task.run",
    source: "test-agent",
    outcome: "allowed",
    occurredAt: new Date().toISOString(),
  });
}

const SIGNER = new HmacSigner("provenance-test-secret-32-bytes!!");

// ─── Tests ────────────────────────────────────────────────────────────────────

test("happy path: AgentProvenanceInput is normalized and embedded", () => {
  const store = makeStore();
  const record = appendRecord(store);
  const passport = issuePassport({
    auditId: record.id,
    auditStore: store,
    signer: SIGNER,
    provenance: { vendor: "anthropic", agentId: "claude-code-1", model: "claude-sonnet-4-6" },
  });
  assert(passport.provenance !== undefined, "provenance should be present");
  eq(passport.provenance!.vendor, "anthropic");
  eq(passport.provenance!.agentId, "claude-code-1");
  eq(passport.provenance!.model, "claude-sonnet-4-6");
  assert(typeof passport.provenance!.provenanceId === "string" && passport.provenance!.provenanceId.length === 64,
    "provenanceId should be a 64-char hex sha256");
});

test("provenanceId is stable for same identity", () => {
  const store1 = makeStore();
  const store2 = makeStore();
  const r1 = appendRecord(store1, "tenant-A");
  const r2 = appendRecord(store2, "tenant-B");
  const input = { vendor: "openai", agentId: "gpt-agent-007" };
  const p1 = issuePassport({ auditId: r1.id, auditStore: store1, signer: SIGNER, provenance: input });
  const p2 = issuePassport({ auditId: r2.id, auditStore: store2, signer: SIGNER, provenance: input });
  eq(p1.provenance!.provenanceId, p2.provenance!.provenanceId,
    "same agent across tenants must produce the same provenanceId (audit-trail join key)");
});

test("two different agents produce different provenanceId", () => {
  const store = makeStore();
  const r1 = appendRecord(store);
  const r2 = appendRecord(store);
  const p1 = issuePassport({ auditId: r1.id, auditStore: store, signer: SIGNER, provenance: { vendor: "xai", agentId: "agent-A" } });
  const p2 = issuePassport({ auditId: r2.id, auditStore: store, signer: SIGNER, provenance: { vendor: "xai", agentId: "agent-B" } });
  assert(p1.provenance!.provenanceId !== p2.provenance!.provenanceId, "different agentId must produce different provenanceId");
});

test("pre-normalized AgentProvenance passes through unchanged", () => {
  const store = makeStore();
  const record = appendRecord(store);
  const normalized = normalizeAgentProvenance({ vendor: "google", agentId: "gemini-agent-99" });
  const passport = issuePassport({
    auditId: record.id, auditStore: store, signer: SIGNER,
    provenance: normalized,
  });
  eq(passport.provenance!.provenanceId, normalized.provenanceId);
  eq(passport.provenance!.vendor, "google");
});

test("provenance is included in canonical body — tampering breaks hash", () => {
  const store = makeStore();
  const record = appendRecord(store);
  const passport = issuePassport({
    auditId: record.id, auditStore: store, signer: SIGNER,
    provenance: { vendor: "cursor", agentId: "composer-x1" },
  });
  // Tamper with provenanceId
  const tampered = {
    ...passport,
    provenance: { ...passport.provenance!, provenanceId: "0".repeat(64) },
  };
  const { hash: _h, signature: _s, ...bodyWithoutHashSig } = tampered;
  const recomputed = computePassportHash(bodyWithoutHashSig);
  assert(recomputed !== passport.hash, "tampered provenanceId must break the passport hash");
});

test("no provenance supplied → passport.provenance is undefined (backward-compat)", () => {
  const store = makeStore();
  const record = appendRecord(store);
  const passport = issuePassport({ auditId: record.id, auditStore: store, signer: SIGNER });
  eq(passport.provenance, undefined, "provenance should be absent when not supplied");
});

test("fail-closed: missing agentId → ProvenanceError", () => {
  const store = makeStore();
  const record = appendRecord(store);
  let threw = false;
  try {
    issuePassport({
      auditId: record.id, auditStore: store, signer: SIGNER,
      provenance: { vendor: "openai", agentId: "" } as never,
    });
  } catch (e: unknown) {
    threw = true;
    assert((e as { code?: string }).code === "invalid_agent_id", `expected invalid_agent_id, got ${(e as Error).message}`);
  }
  assert(threw, "should have thrown ProvenanceError for empty agentId");
});

test("fail-closed: empty vendor → ProvenanceError", () => {
  const store = makeStore();
  const record = appendRecord(store);
  let threw = false;
  try {
    issuePassport({
      auditId: record.id, auditStore: store, signer: SIGNER,
      provenance: { vendor: "", agentId: "agent-x" } as never,
    });
  } catch (e: unknown) {
    threw = true;
    assert((e as { code?: string }).code === "invalid_vendor", `expected invalid_vendor, got ${(e as Error).message}`);
  }
  assert(threw, "should have thrown ProvenanceError for empty vendor");
});

test("vendor alias normalization: 'claude-code' → vendor='anthropic', vendorRaw preserved", () => {
  const store = makeStore();
  const record = appendRecord(store);
  const passport = issuePassport({
    auditId: record.id, auditStore: store, signer: SIGNER,
    provenance: { vendor: "claude-code", agentId: "agent-7" },
  });
  eq(passport.provenance!.vendor, "anthropic");
  eq(passport.provenance!.vendorRaw, "claude-code");
});

test("unknown vendor normalizes to 'custom' with raw label preserved", () => {
  const store = makeStore();
  const record = appendRecord(store);
  const passport = issuePassport({
    auditId: record.id, auditStore: store, signer: SIGNER,
    provenance: { vendor: "novel-vendor-xyz", agentId: "agent-99" },
  });
  eq(passport.provenance!.vendor, "custom");
  eq(passport.provenance!.vendorRaw, "novel-vendor-xyz");
});

test("signature verification: provenance in body, signer.verify confirms", () => {
  const store = makeStore();
  const record = appendRecord(store);
  const passport = issuePassport({
    auditId: record.id, auditStore: store, signer: SIGNER,
    provenance: { vendor: "github", agentId: "copilot-pr-agent" },
  });
  const { hash: _h, signature: _s, ...body } = passport;
  const recomputed = computePassportHash(body);
  eq(recomputed, passport.hash, "recomputed hash must match passport.hash");
  const valid = SIGNER.verify(passport.hash, passport.signature);
  assert(valid, "signature should verify with the same HmacSigner");
});
