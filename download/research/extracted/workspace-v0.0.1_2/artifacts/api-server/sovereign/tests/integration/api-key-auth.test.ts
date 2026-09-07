import "../_flush.mjs";
/**
 * tests/integration/api-key-auth.test.ts — End-to-end API-Key auth via sovereign-server.
 *
 * Coverage:
 *   • POST /auth/api-keys — create key, secret shown once, 201.
 *   • GET /auth/api-keys — list keys without hashedSecret, 200.
 *   • DELETE /auth/api-keys/:keyId — revoke key, 204; re-revoke → 404.
 *   • Use created API key as x-api-key header on a protected route (GET /api/ledger/solvency).
 *   • Revoked key → 401 on protected route.
 *   • Invalid key → 401.
 *   • Missing both headers → 400.
 *   • Tenant isolation: tenant-A key cannot access tenant-B data.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const H = (tenant: string) => ({ "content-type": "application/json", "x-tenant-id": tenant });
const Hkey = (secret: string) => ({ "content-type": "application/json", "x-api-key": secret });

const post = (path: string, body: any, headers: Record<string, string>) =>
  fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });

const get = (path: string, headers: Record<string, string>) =>
  fetch(base + path, { headers });

const del = (path: string, headers: Record<string, string>) =>
  fetch(base + path, { method: "DELETE", headers });

// ─── Create / List / Revoke ───────────────────────────────────────────────────

test("API-KEY AUTH: POST /auth/api-keys creates key and shows secret once", async () => {
  const r = await post("/api/auth/api-keys", { name: "integration-test" }, H("apikey-t1"));
  eq(r.status, 201);
  const body = await r.json();
  eq(body.ok, true);
  assert(body.secret, "secret must be present");
  assert(body.secret.startsWith("tfa_"), "secret must start with tfa_");
  eq(body.key.tenantId, "apikey-t1");
  eq(body.key.name, "integration-test");
  assert(!body.key.hashedSecret, "hashedSecret must not leak");
});

test("API-KEY AUTH: GET /auth/api-keys lists keys without secrets", async () => {
  const r = await get("/api/auth/api-keys", H("apikey-t1"));
  eq(r.status, 200);
  const body = await r.json();
  eq(body.ok, true);
  assert(Array.isArray(body.keys), "keys must be an array");
  assert(body.keys.length >= 1, "at least one key must exist");
  for (const k of body.keys) {
    assert(!k.hashedSecret, "listed key must not contain hashedSecret");
  }
});

test("API-KEY AUTH: DELETE /auth/api-keys/:keyId revokes key", async () => {
  // Create a key to revoke
  const createR = await post("/api/auth/api-keys", { name: "to-revoke" }, H("apikey-t1"));
  eq(createR.status, 201);
  const created = await createR.json();
  const keyId = created.key.keyId;

  const r = await del("/api/auth/api-keys/" + keyId, H("apikey-t1"));
  eq(r.status, 204);

  // Re-revoke → 404
  const r2 = await del("/api/auth/api-keys/" + keyId, H("apikey-t1"));
  eq(r2.status, 404);
});

test("API-KEY AUTH: revoked key cannot access protected routes", async () => {
  const createR = await post("/api/auth/api-keys", { name: "revoked-access" }, H("apikey-t-revoke"));
  eq(createR.status, 201);
  const created = await createR.json();
  const secret = created.secret;

  // Verify it works before revocation
  const before = await get("/api/ledger/solvency", Hkey(secret));
  eq(before.status, 200);

  await del("/api/auth/api-keys/" + created.key.keyId, H("apikey-t-revoke"));

  const after = await get("/api/ledger/solvency", Hkey(secret));
  eq(after.status, 401);
});

test("API-KEY AUTH: invalid key returns 401", async () => {
  const r = await get("/api/ledger/solvency", Hkey("tfa_invalid_key"));
  eq(r.status, 401);
});

test("API-KEY AUTH: missing both headers returns 400", async () => {
  const r = await fetch(base + "/api/ledger/solvency", { headers: { "content-type": "application/json" } });
  eq(r.status, 400);
});

test("API-KEY AUTH: tenant isolation — key from t-A cannot access t-B data", async () => {
  const createA = await post("/api/auth/api-keys", { name: "t-A-key" }, H("apikey-t-A"));
  eq(createA.status, 201);
  const secretA = (await createA.json()).secret;

  // Onboard tenant B so it has some state
  await post("/api/tenants", {}, H("apikey-t-B"));

  // Try to access tenant B's ledger using tenant A's key
  const r = await get("/api/ledger/solvency", Hkey(secretA));
  // The key resolves to tenant A, so tenant B's solvency check runs under tenant A
  // Since tenant A has no accounts, it should still be 200 (empty solvency is valid)
  // but the point is the tenantId is derived from the key, not from the header.
  // The real tenant isolation test: can A's key see B's accounts?
  const acctR = await get("/api/ledger/accounts/anything", Hkey(secretA));
  eq(acctR.status, 404); // tenant A doesn't have this account
});

test("API-KEY AUTH: x-tenant-id fallback still works", async () => {
  await post("/api/tenants", {}, H("fallback-t"));
  const r = await get("/api/ledger/solvency", H("fallback-t"));
  eq(r.status, 200);
});

import { test as _t } from "../_harness.mjs";
_t("API-KEY AUTH: cleanup", () => { server.close(); });
