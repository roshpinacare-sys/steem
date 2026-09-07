import "../_flush.mjs";
/**
 * tests/passport/passport-client.test.ts — external Passport SDK client tests.
 *
 * Coverage:
 *   • happy path: fetchPassport returns a valid passport; verifyPassport confirms it.
 *   • missing tenantId on fetch → 400 (caught as server_error, no leak).
 *   • unknown auditId → not_found error.
 *   • cross-tenant lookup → not_found (isolation preserved).
 *   • invalid input guards: missing baseUrl / auditId / tenantId → PassportClientError.
 *   • local verify of tampered passport → verify_failed (ok=false).
 *   • strict mode upgrades skipped checks to failure.
 *   • canonicalStringify re-export matches library version.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import {
  fetchPassport,
  fetchPublicKey,
  verifyPassport,
  canonicalStringify,
  PassportClientError,
} from "../../lib/passport-client/index.ts";
import { canonicalStringify as libCanonical } from "../../lib/passport/index.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import { issuePassport } from "../../lib/passport/index.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
const SECRET = "passport-client-test-secret-42!";

// Helper: create an account + mint so we have a real auditId.
async function createAccountAndMint(tenant = "sdk-tenant-1") {
  const accRes = await fetch(base + "/api/ledger/accounts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    body: JSON.stringify({ ownerId: "u1", type: "asset", name: "Alice" }),
  });
  eq(accRes.status, 201);
  const acc = await accRes.json();
  const mintRes = await fetch(base + "/api/ledger/mint", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    body: JSON.stringify({ toAccountId: acc.account.id, amount: "50000", memo: "seed" }),
  });
  eq(mintRes.status, 200);
  const mint = await mintRes.json();
  return { accountId: acc.account.id, auditId: mint.auditId as string };
}

// ─── Failure cases (input guards) ──────────────────────────────────────────

test("guard: missing baseUrl → PassportClientError missing_base_url", async () => {
  try {
    await fetchPassport("", "aid", "t1");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof PassportClientError, "error is PassportClientError");
    eq(e.code, "missing_base_url");
  }
});

test("guard: missing auditId → PassportClientError missing_audit_id", async () => {
  try {
    await fetchPassport(base, "", "t1");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof PassportClientError, "error is PassportClientError");
    eq(e.code, "missing_audit_id");
  }
});

test("guard: missing tenantId → PassportClientError missing_tenant_id", async () => {
  try {
    await fetchPassport(base, "aid", "");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof PassportClientError, "error is PassportClientError");
    eq(e.code, "missing_tenant_id");
  }
});

// ─── HTTP failure cases ──────────────────────────────────────────────────────

test("fetch: unknown auditId → not_found", async () => {
  try {
    await fetchPassport(base, "00000000-0000-0000-0000-000000000000", "t1");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof PassportClientError, "error is PassportClientError");
    eq(e.code, "not_found");
  }
});

test("fetch: missing x-tenant-id on server → 400 caught as server_error", async () => {
  // Direct fetch without tenant header to prove server returns 400.
  // Our SDK always sends tenant, so this is a server-side edge.
  const r = await fetch(base + "/api/passport/any-id");
  eq(r.status, 400);
});

test("fetch: cross-tenant auditId → not_found (isolation)", async () => {
  const { auditId } = await createAccountAndMint("cross-A");
  try {
    await fetchPassport(base, auditId, "cross-B");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof PassportClientError, "error is PassportClientError");
    eq(e.code, "not_found");
  }
});

// ─── Happy path: fetch + verify ─────────────────────────────────────────────

test("happy path: fetchPassport returns valid passport; verifyPassport passes", async () => {
  const { auditId } = await createAccountAndMint("happy-tenant");

  const result = await fetchPassport(base, auditId, "happy-tenant");
  eq(result.status, 200);
  assert(result.passport, "passport present");
  eq(result.passport.version, "1");
  eq(result.passport.tenantId, "happy-tenant");
  eq(result.passport.audit.id, auditId);
  eq(result.passport.audit.actionType, "ledger.mint");

  // Local verification (we don't have the server secret, so we verify structure only).
  const lax = verifyPassport(result.passport, {});
  eq(lax.ok, true);
  const hashCheck = lax.checks.find((c) => c.name === "passport.hash");
  assert(hashCheck && hashCheck.status === "pass", "passport hash recomputation passes");
});

test("happy path: transfer auto-issues passport inline; fetch returns it", async () => {
  const t = "xfer-tenant";
  const a = await createAccountAndMint(t);
  const bRes = await fetch(base + "/api/ledger/accounts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": t },
    body: JSON.stringify({ ownerId: "u2", type: "asset", name: "Bob" }),
  });
  eq(bRes.status, 201);
  const b = await bRes.json();

  const txRes = await fetch(base + "/api/ledger/transfer", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": t },
    body: JSON.stringify({
      fromAccountId: a.accountId,
      toAccountId: b.account.id,
      amount: "10000",
      memo: "pay",
    }),
  });
  eq(txRes.status, 200);
  const tx = await txRes.json();
  assert(tx.passport, "transfer auto-issued passport inline");

  // Fetch the same passport via SDK.
  const fetched = await fetchPassport(base, tx.auditId, t);
  eq(fetched.passport.audit.id, tx.auditId);
  eq(fetched.passport.audit.actionType, "ledger.transfer");
});

// ─── Local verify edge cases ────────────────────────────────────────────────

test("verify: tampered passport body → verify fails", () => {
  const { auditId } = { auditId: "fake-audit" };
  // Build a minimal fake passport (enough to pass shape, fail hash).
  const fake: any = {
    version: "1",
    passportId: "pp-1",
    issuedAt: new Date().toISOString(),
    tenantId: "t1",
    audit: {
      id: "audit-1",
      tenantId: "t1",
      actionId: "act-1",
      actionType: "test",
      source: "test",
      outcome: "allowed",
      occurredAt: new Date().toISOString(),
      prevHash: "0".repeat(64),
      hash: "0".repeat(64),
    },
    delegationChain: null,
    policyDecision: { outcome: "allowed" },
    ledgerEffect: null,
    algorithm: "hmac-sha256",
    hash: "0".repeat(64),
    signature: "aGVsbG8=",
  };

  const report = verifyPassport(fake, { hmacSecret: SECRET });
  eq(report.ok, false);
  const hashCheck = report.checks.find((c) => c.name === "passport.hash");
  assert(hashCheck && hashCheck.status === "fail", "tampered hash fails");
});

test("verify: strict mode upgrades skipped to failure", () => {
  // Build a real passport so hash/shape pass; with no keys sig checks are skipped.
  const signer = new HmacSigner(SECRET);
  const store = new InMemoryAuditStore(signer);
  const rec = store.append({
    id: "audit-strict-" + Math.random().toString(36).slice(2),
    tenantId: "strict-t",
    actionId: "act-s",
    actionType: "agent.task.run",
    source: "test-agent",
    outcome: "allowed",
    occurredAt: new Date().toISOString(),
  });
  const passport = issuePassport({ auditId: rec.id, auditStore: store, signer });

  const lax = verifyPassport(passport, {});
  eq(lax.ok, true);
  const strict = verifyPassport(passport, {}, { strict: true });
  eq(strict.ok, false);
});

test("canonicalStringify re-export matches library version", () => {
  const samples = [
    { z: 1, a: 2 },
    [1, "b", { c: true }],
    null,
  ];
  for (const s of samples) {
    eq(canonicalStringify(s), libCanonical(s), "mismatch for " + JSON.stringify(s));
  }
});

// ─── fetchPublicKey input guards ────────────────────────────────────────────

test("guard: fetchPublicKey missing baseUrl → PassportClientError missing_base_url", async () => {
  try {
    await fetchPublicKey("", "t1");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof PassportClientError, "error is PassportClientError");
    eq(e.code, "missing_base_url");
  }
});

test("guard: fetchPublicKey missing tenantId → PassportClientError missing_tenant_id", async () => {
  try {
    await fetchPublicKey(base, "");
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(e instanceof PassportClientError, "error is PassportClientError");
    eq(e.code, "missing_tenant_id");
  }
});

// ─── fetchPublicKey happy path: default server (now Ed25519) ─────────────────

test("happy path: fetchPublicKey on default server returns ed25519 + non-null publicKey (M4 default flip)", async () => {
  const result = await fetchPublicKey(base, "pk-ed25519-default-tenant");
  eq(result.status, 200);
  eq(result.algorithm, "ed25519");
  assert(typeof result.publicKey === "string" && result.publicKey.length > 0,
    "default server now returns Ed25519 publicKey non-null");
});

// ─── fetchPublicKey happy path: Ed25519 server ──────────────────────────────

test("happy path: fetchPublicKey on Ed25519 server returns ed25519 + publicKey string", async () => {
  const kp = generateAuditKeyPair();
  const edStack = buildSovereignStack(undefined, { signerKind: "ed25519", ed25519KeyPair: kp, provider: new InMemoryLedger() });
  const edServer = startSovereignServer(0, edStack, { requireIdempotencyKey: false });
  const edBase = `http://127.0.0.1:${(edServer.address() as any).port}`;
  try {
    const result = await fetchPublicKey(edBase, "pk-ed-tenant");
    eq(result.status, 200);
    eq(result.algorithm, "ed25519");
    assert(typeof result.publicKey === "string" && result.publicKey.length > 0, "publicKey is a non-empty string");

    // End-to-end: create account + mint on Ed25519 server, fetch passport, verify with fetched public key.
    const accRes = await fetch(edBase + "/api/ledger/accounts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "pk-ed-tenant" },
      body: JSON.stringify({ ownerId: "u1", type: "asset", name: "Alice" }),
    });
    eq(accRes.status, 201);
    const acc = await accRes.json();
    const mintRes = await fetch(edBase + "/api/ledger/mint", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "pk-ed-tenant" },
      body: JSON.stringify({ toAccountId: acc.account.id, amount: "50000", memo: "seed" }),
    });
    eq(mintRes.status, 200);
    const mint = await mintRes.json();
    const auditId = mint.auditId as string;

    const passportResult = await fetchPassport(edBase, auditId, "pk-ed-tenant");
    const report = verifyPassport(passportResult.passport, { publicKey: result.publicKey, auditPublicKey: result.publicKey });
    eq(report.ok, true);
  } finally {
    edServer.close();
  }
});

import { test as _t } from "../_harness.mjs";
_t("cleanup passport-client tests", () => { server.close(); });
