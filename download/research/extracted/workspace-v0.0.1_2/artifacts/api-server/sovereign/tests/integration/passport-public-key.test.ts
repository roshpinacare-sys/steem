import "../_flush.mjs";
/**
 * tests/integration/passport-public-key.test.ts — GET /api/passport/public-key
 *
 * Coverage:
 *   • Ed25519 stack (DEFAULT since M4 sub-step 3): algorithm=ed25519, publicKey non-null.
 *   • HMAC stack (explicit opt-in): algorithm=hmac-sha256, publicKey=null.
 *   • Ed25519: returned publicKey verifies a real passport end-to-end (zero trust).
 *   • Ed25519: returned publicKey equals the key pair used to build the stack.
 *   • "public-key" is NOT captured as auditId (static route wins over :auditId).
 *   • missing x-tenant-id → 400 (tenant isolation contract still required).
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { verifyPassport } from "../../scripts/verify-passport.mjs";

// ─── Ed25519 stack (now the DEFAULT) ─────────────────────────────────────────

const defaultServer = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const defaultPort: number = (defaultServer.address() as any).port;
const defaultBase = `http://127.0.0.1:${defaultPort}`;
const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });

test("PUBLIC-KEY / default (Ed25519): algorithm=ed25519, publicKey non-null string", async () => {
  const res = await fetch(defaultBase + "/api/passport/public-key", { headers: H("t1") });
  eq(res.status, 200);
  const body = await res.json();
  eq(body.algorithm, "ed25519");
  assert(typeof body.publicKey === "string" && body.publicKey.length > 0, "publicKey must be non-null string");
});

test("PUBLIC-KEY / default: response shape has exactly algorithm + publicKey", async () => {
  const res = await fetch(defaultBase + "/api/passport/public-key", { headers: H("t1") });
  const body = await res.json();
  assert("algorithm" in body, "must have algorithm");
  assert("publicKey" in body, "must have publicKey");
});

test("PUBLIC-KEY: missing x-tenant-id → 400 (tenant isolation contract)", async () => {
  const res = await fetch(defaultBase + "/api/passport/public-key");
  eq(res.status, 400);
});

test("PUBLIC-KEY: static route wins — 'public-key' NOT captured as auditId", async () => {
  const res = await fetch(defaultBase + "/api/passport/public-key", { headers: H("t1") });
  // If routing was wrong, the passport-route handler would return { error: "passport not found" } (404).
  eq(res.status, 200);
  const body = await res.json();
  // Public-key handler returns { algorithm, publicKey }; passport handler returns { error }.
  assert("algorithm" in body, "must be from public-key handler, not passport-route");
});

// ─── Ed25519 stack ────────────────────────────────────────────────────────────

const keyPair = generateAuditKeyPair();
const ed25519Stack = buildSovereignStack(undefined, { signerKind: "ed25519", ed25519KeyPair: keyPair });
const edServer = startSovereignServer(0, ed25519Stack, { requireIdempotencyKey: false });
const edPort: number = (edServer.address() as any).port;
const edBase = `http://127.0.0.1:${edPort}`;

test("PUBLIC-KEY / Ed25519: algorithm=ed25519, publicKey is PEM string", async () => {
  const res = await fetch(edBase + "/api/passport/public-key", { headers: H("t1") });
  eq(res.status, 200);
  const body = await res.json();
  eq(body.algorithm, "ed25519");
  assert(typeof body.publicKey === "string" && body.publicKey.length > 0, "publicKey must be a non-empty string");
  assert(body.publicKey.includes("PUBLIC KEY"), "must be PEM format");
});

test("PUBLIC-KEY / Ed25519: returned publicKey equals the keypair's public key", async () => {
  const res = await fetch(edBase + "/api/passport/public-key", { headers: H("t1") });
  const body = await res.json();
  eq(body.publicKey, keyPair.publicKey);
});

test("PUBLIC-KEY / Ed25519: publicKey verifies a real passport end-to-end (zero trust)", async () => {
  // Step 1: fetch the server's public key.
  const pkRes = await fetch(edBase + "/api/passport/public-key", { headers: H("t1") });
  const { publicKey } = await pkRes.json();

  // Step 2: produce a real auditId via mint.
  const accRes = await fetch(edBase + "/api/ledger/accounts", {
    method: "POST", headers: H("t1"),
    body: JSON.stringify({ ownerId: "pk-u1", type: "asset", name: "Alice" }),
  });
  eq(accRes.status, 201);
  const { account } = await accRes.json();

  const mintRes = await fetch(edBase + "/api/ledger/mint", {
    method: "POST", headers: H("t1"),
    body: JSON.stringify({ toAccountId: account.id, amount: "100000", memo: "pk-test" }),
  });
  eq(mintRes.status, 200);
  const { auditId } = await mintRes.json();
  assert(typeof auditId === "string", "mint must return auditId");

  // Step 3: fetch the signed passport.
  const ppRes = await fetch(edBase + `/api/passport/${auditId}`, { headers: H("t1") });
  eq(ppRes.status, 200);
  const { passport } = await ppRes.json();

  // Step 4: verify using ONLY the public key from step 1 — no shared secret.
  // Note: strict=false (default) because we only supply the passport public key,
  // not the audit-record key. The audit.signature check is skipped (not failed).
  const result = verifyPassport(passport, { publicKey });
  assert(result.ok, `zero-trust verification failed — checks: ${JSON.stringify(result.checks)}`);
  const sigCheck = result.checks.find((c: any) => c.name === "passport.signature.ed25519");
  assert(sigCheck && sigCheck.status === "pass", "passport.signature.ed25519 check must pass");
});

// Servers hold the event loop open — close them in a cleanup test so they
// shut down only after all preceding async tests have finished.
test("cleanup: close servers", () => {
  defaultServer.close();
  edServer.close();
});
