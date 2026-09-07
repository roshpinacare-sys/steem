import "../_flush.mjs";
/**
 * tests/passport/passport-revocation-list.test.ts
 *
 * Coverage:
 *   Happy path:
 *     • revoke() records an entry; isRevoked() returns true for same tenant.
 *     • get() returns the entry with correct fields.
 *     • list() returns entries sorted by revokedAt ascending.
 *     • totalSize counts across all tenants.
 *   Edge cases:
 *     • Revoking the same passportId twice is idempotent (original entry kept).
 *     • reason defaults to "revoked" when omitted or empty string.
 *     • list() returns [] for unknown tenant (never throws).
 *     • isRevoked() with wrong-but-valid tenant → false (cross-tenant isolation).
 *     • get() with wrong tenant → null (cross-tenant isolation).
 *   Fail-closed:
 *     • revoke() throws on empty passportId.
 *     • revoke() throws on empty tenantId.
 *     • isRevoked() with empty passportId → false (no throw).
 *     • isRevoked() with empty tenantId → false (no throw).
 *   Verifier integration:
 *     • verifyActionPassport without revocationList → check skipped (backward compat).
 *     • verifyActionPassport with revocationList, passport not revoked → check passes.
 *     • verifyActionPassport with revocationList, passport revoked → ok: false, check fails.
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  PassportRevocationList,
  PassportRevocationError,
} from "../../lib/passport/passport-revocation-list.ts";
import { verifyActionPassport } from "../../lib/passport/passport-verifier.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { issuePassport } from "../../lib/passport/passport.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SECRET = "revocation-list-test-secret-0123!!";

function makeSigner() {
  return new HmacSigner(SECRET);
}

function makeAudit(overrides: Record<string, unknown> = {}) {
  return {
    id: "audit-1",
    tenantId: "tenant-a",
    actionId: "action-1",
    actionType: "file_delete",
    source: "test",
    outcome: "allowed" as const,
    occurredAt: "2026-01-01T00:00:00.000Z",
    prevHash: "0000000000000000",
    hash: "",
    ...overrides,
  };
}

// Build a minimal valid passport (no real audit store needed — we fake the raw object).
function makeRawPassport(overrides: Record<string, unknown> = {}) {
  const signer = makeSigner();
  const audit = {
    id: "audit-rev-1",
    tenantId: "tenant-a",
    actionId: "action-rev-1",
    actionType: "funds_transfer",
    source: "test",
    outcome: "allowed",
    occurredAt: "2026-06-20T00:00:00.000Z",
    prevHash: "0000000000000000",
    // compute audit hash the same way the verifier does
    hash: (() => {
      const { createHash } = require("node:crypto");
      const data = ["audit-rev-1", "tenant-a", "funds_transfer", "allowed", "0000000000000000"].join("|");
      return createHash("sha256").update(data, "utf8").digest("hex");
    })(),
  };

  // Build canonical body
  const body: Record<string, unknown> = {
    version: "1",
    passportId: "passport-rev-1",
    issuedAt: "2026-06-20T00:00:00.000Z",
    tenantId: "tenant-a",
    audit,
    delegationChain: null,
    policyDecision: { outcome: "allowed" },
    ledgerEffect: null,
    attestation: null,
    algorithm: signer.algorithm,
    ...overrides,
  };

  // Import canonicalStringify to compute body hash
  const { createHash } = require("node:crypto");
  // Simple deterministic JSON for this test (keys sorted)
  function canon(v: unknown): string {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  const hash = createHash("sha256").update(canon(body), "utf8").digest("hex");
  const signature = signer.sign(hash);
  return { ...body, hash, signature };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// Happy path: basic revocation
test("revoke() adds entry; isRevoked() returns true for same tenant", () => {
  const rl = new PassportRevocationList();
  eq(rl.isRevoked("passport-1", "tenant-a"), false);
  rl.revoke("passport-1", "tenant-a", "fraudulent_transfer");
  eq(rl.isRevoked("passport-1", "tenant-a"), true);
});

test("get() returns the correct revocation entry", () => {
  const rl = new PassportRevocationList();
  const before = new Date().toISOString();
  rl.revoke("passport-2", "tenant-b", "policy_violation");
  const after = new Date().toISOString();

  const entry = rl.get("passport-2", "tenant-b");
  assert(entry !== null, "entry should exist");
  eq(entry!.passportId, "passport-2");
  eq(entry!.tenantId, "tenant-b");
  eq(entry!.reason, "policy_violation");
  assert(entry!.revokedAt >= before && entry!.revokedAt <= after, "revokedAt in range");
});

test("list() returns entries sorted by revokedAt ascending", () => {
  const rl = new PassportRevocationList();
  const times = [
    "2026-06-20T00:00:01.000Z",
    "2026-06-20T00:00:03.000Z",
    "2026-06-20T00:00:02.000Z",
  ];
  let i = 0;
  rl.revoke("p-c", "tenant-c", "r1", () => times[i++]);
  rl.revoke("p-d", "tenant-c", "r2", () => times[i++]);
  rl.revoke("p-e", "tenant-c", "r3", () => times[i++]);

  const entries = rl.list("tenant-c");
  eq(entries.length, 3);
  eq(entries[0].passportId, "p-c"); // 00:01
  eq(entries[1].passportId, "p-e"); // 00:02
  eq(entries[2].passportId, "p-d"); // 00:03
});

test("totalSize counts across all tenants", () => {
  const rl = new PassportRevocationList();
  rl.revoke("p1", "t1");
  rl.revoke("p2", "t1");
  rl.revoke("p3", "t2");
  eq(rl.totalSize, 3);
});

// Edge cases
test("revoking same passportId twice is idempotent (original entry preserved)", () => {
  const rl = new PassportRevocationList();
  let tick = 0;
  const clock = () => `2026-06-20T00:0${tick++}:00.000Z`;
  rl.revoke("passport-dup", "tenant-a", "first_reason", clock);
  rl.revoke("passport-dup", "tenant-a", "second_reason", clock);

  const entry = rl.get("passport-dup", "tenant-a");
  eq(entry!.reason, "first_reason");
  eq(entry!.revokedAt, "2026-06-20T00:00:00.000Z");
  eq(rl.totalSize, 1);
});

test("reason defaults to 'revoked' when omitted", () => {
  const rl = new PassportRevocationList();
  rl.revoke("p-no-reason", "tenant-a");
  eq(rl.get("p-no-reason", "tenant-a")!.reason, "revoked");
});

test("reason defaults to 'revoked' when empty string is passed", () => {
  const rl = new PassportRevocationList();
  rl.revoke("p-empty-reason", "tenant-a", "");
  eq(rl.get("p-empty-reason", "tenant-a")!.reason, "revoked");
});

test("list() returns [] for unknown tenant", () => {
  const rl = new PassportRevocationList();
  const result = rl.list("tenant-unknown");
  eq(result.length, 0);
});

test("cross-tenant isolation: isRevoked() returns false for wrong tenant", () => {
  const rl = new PassportRevocationList();
  rl.revoke("passport-x", "tenant-a", "fraud");
  eq(rl.isRevoked("passport-x", "tenant-b"), false);
});

test("cross-tenant isolation: get() returns null for wrong tenant", () => {
  const rl = new PassportRevocationList();
  rl.revoke("passport-y", "tenant-a", "fraud");
  eq(rl.get("passport-y", "tenant-b"), null);
});

// Fail-closed
test("revoke() throws PassportRevocationError on empty passportId", () => {
  const rl = new PassportRevocationList();
  let threw = false;
  try {
    rl.revoke("", "tenant-a");
  } catch (e) {
    threw = true;
    assert(e instanceof PassportRevocationError, "should be PassportRevocationError");
    eq((e as PassportRevocationError).code, "invalid_passport_id");
  }
  assert(threw, "should have thrown");
});

test("revoke() throws PassportRevocationError on empty tenantId", () => {
  const rl = new PassportRevocationList();
  let threw = false;
  try {
    rl.revoke("passport-z", "");
  } catch (e) {
    threw = true;
    assert(e instanceof PassportRevocationError, "should be PassportRevocationError");
    eq((e as PassportRevocationError).code, "invalid_tenant_id");
  }
  assert(threw, "should have thrown");
});

test("isRevoked() with empty passportId returns false (no throw)", () => {
  const rl = new PassportRevocationList();
  eq(rl.isRevoked("", "tenant-a"), false);
});

test("isRevoked() with empty tenantId returns false (no throw)", () => {
  const rl = new PassportRevocationList();
  eq(rl.isRevoked("passport-1", ""), false);
});

// ─── Verifier integration ─────────────────────────────────────────────────────

const { createHash } = await import("node:crypto");

function buildCanon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + (v as unknown[]).map(buildCanon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + buildCanon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function makeVerifierPassport() {
  const signer = makeSigner();
  const auditData = ["audit-vr-1", "tenant-vr", "funds_transfer", "allowed", "0000000000000000"].join("|");
  const auditHash = createHash("sha256").update(auditData, "utf8").digest("hex");
  const audit = {
    id: "audit-vr-1",
    tenantId: "tenant-vr",
    actionId: "action-vr-1",
    actionType: "funds_transfer",
    source: "test",
    outcome: "allowed",
    occurredAt: "2026-06-20T12:00:00.000Z",
    prevHash: "0000000000000000",
    hash: auditHash,
  };
  const body: Record<string, unknown> = {
    version: "1",
    passportId: "passport-vr-1",
    issuedAt: "2026-06-20T12:00:00.000Z",
    tenantId: "tenant-vr",
    audit,
    delegationChain: null,
    policyDecision: { outcome: "allowed" },
    ledgerEffect: null,
    attestation: null,
    algorithm: signer.algorithm,
  };
  const hash = createHash("sha256").update(buildCanon(body), "utf8").digest("hex");
  const signature = signer.sign(hash);
  return { ...body, hash, signature };
}

test("verifyActionPassport without revocationList → 'passport.revocation' check is skipped", () => {
  const passport = makeVerifierPassport();
  const result = verifyActionPassport(passport, { hmacSecret: SECRET });
  const check = result.checks.find((c) => c.name === "passport.revocation");
  assert(check !== undefined, "revocation check should be present");
  eq(check!.status, "skipped");
});

test("verifyActionPassport with revocationList, passport NOT revoked → check passes", () => {
  const passport = makeVerifierPassport();
  const rl = new PassportRevocationList();
  const result = verifyActionPassport(passport, { hmacSecret: SECRET, revocationList: rl });
  const check = result.checks.find((c) => c.name === "passport.revocation");
  assert(check !== undefined, "revocation check should be present");
  eq(check!.status, "pass");
});

test("verifyActionPassport with revocationList, passport IS revoked → ok: false, check fails", () => {
  const passport = makeVerifierPassport();
  const rl = new PassportRevocationList();
  rl.revoke("passport-vr-1", "tenant-vr", "fraudulent_transfer");
  const result = verifyActionPassport(passport, { hmacSecret: SECRET, revocationList: rl });
  eq(result.ok, false);
  const check = result.checks.find((c) => c.name === "passport.revocation");
  assert(check !== undefined, "revocation check should be present");
  eq(check!.status, "fail");
  assert(check!.message?.includes("fraudulent_transfer"), "message includes reason");
});

test("revoked passport: verifier returns early — no further checks run after revocation fail", () => {
  const passport = makeVerifierPassport();
  const rl = new PassportRevocationList();
  rl.revoke("passport-vr-1", "tenant-vr", "fraud");
  const result = verifyActionPassport(passport, { hmacSecret: SECRET, revocationList: rl });
  // Only shape + revocation should appear; no audit/signature checks
  const names = result.checks.map((c) => c.name);
  assert(names.includes("shape"), "shape check present");
  assert(names.includes("passport.revocation"), "revocation check present");
  assert(!names.includes("audit.hash"), "audit.hash check absent (early exit)");
  assert(!names.includes("passport.hash"), "passport.hash check absent (early exit)");
});
