import "../_flush.mjs";
/**
 * tests/auth/api-key.test.ts — API-Key store, service, and middleware tests.
 *
 * Coverage:
 *   • create key → secret shown once, key stored without raw secret.
 *   • validate with correct secret → returns key.
 *   • validate with wrong secret → null (fail-closed).
 *   • validate revoked key → null.
 *   • validate expired key → null.
 *   • list keys → hashedSecret omitted, revoked keys still listed (with revokedAt).
 *   • revoke key → subsequent validate returns null.
 *   • tenant isolation: key from tenant-A does not validate for tenant-B middleware.
 *   • middleware: x-api-key resolves tenantId; x-tenant-id still works as fallback.
 *   • middleware: missing both headers → error.
 */

import { test, eq, assert } from "../_harness.mjs";
import { InMemoryApiKeyStore, ApiKeyService } from "../../lib/api-key/index.ts";
import { resolveTenantId } from "../../src/http/tenant-resolver.ts";

const store = new InMemoryApiKeyStore();
const svc = new ApiKeyService(store);

// ─── Service / Store ────────────────────────────────────────────────────────

test("API-KEY: create key returns secret once and stores without it", async () => {
  const r = await svc.create({ tenantId: "t1", name: "test-key" });
  assert(r.secret, "secret must be present");
  assert(r.secret.startsWith("tfa_"), "secret must start with tfa_");
  eq(r.key.tenantId, "t1");
  eq(r.key.name, "test-key");
  assert(!("hashedSecret" in r.key), "key object must not contain hashedSecret");
});

test("API-KEY: validate correct secret returns key", async () => {
  const r = await svc.create({ tenantId: "t1", name: "validate-test" });
  const validated = await svc.validate(r.secret);
  assert(validated, "valid secret must return key");
  eq(validated!.keyId, r.key.keyId);
  eq(validated!.tenantId, "t1");
});

test("API-KEY: validate wrong secret returns null (fail-closed)", async () => {
  const v = await svc.validate("tfa_totally-wrong-secret-123");
  eq(v, null);
});

test("API-KEY: revoke key then validate returns null", async () => {
  const r = await svc.create({ tenantId: "t1", name: "revoke-test" });
  const ok = await svc.revoke(r.key.keyId);
  assert(ok, "revoke must return true");
  const v = await svc.validate(r.secret);
  eq(v, null);
});

test("API-KEY: expired key validates as null", async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const r = await svc.create({ tenantId: "t1", name: "expired-test", expiresAt: yesterday });
  const v = await svc.validate(r.secret);
  eq(v, null);
});

test("API-KEY: non-expired key validates successfully", async () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const r = await svc.create({ tenantId: "t1", name: "future-test", expiresAt: tomorrow });
  const v = await svc.validate(r.secret);
  assert(v, "non-expired key must validate");
  eq(v!.keyId, r.key.keyId);
});

test("API-KEY: list omits hashedSecret", async () => {
  await svc.create({ tenantId: "t-list", name: "list-test" });
  const keys = await svc.list("t-list");
  assert(keys.length > 0, "list must return keys");
  for (const k of keys) {
    assert(!("hashedSecret" in k), "listed key must not contain hashedSecret");
  }
});

test("API-KEY: tenant isolation — key from t-A does not resolve for t-B", async () => {
  const rA = await svc.create({ tenantId: "t-A", name: "isolated" });
  const v = await svc.validate(rA.secret);
  assert(v, "must validate for correct tenant");
  eq(v!.tenantId, "t-A");
});

test("API-KEY: revoke non-existent key returns false", async () => {
  const ok = await svc.revoke("non-existent-key-id");
  eq(ok, false);
});

// ─── Middleware / resolveTenantId ─────────────────────────────────────────────

test("API-KEY middleware: x-api-key resolves tenantId", async () => {
  const r = await svc.create({ tenantId: "t-mw", name: "mw-test" });
  const resolved = await resolveTenantId(svc, { "x-api-key": r.secret });
  eq(resolved.error, undefined);
  eq(resolved.tenantId, "t-mw");
});

test("API-KEY middleware: invalid x-api-key returns 401", async () => {
  const resolved = await resolveTenantId(svc, { "x-api-key": "tfa_bad" });
  eq(resolved.error, "invalid or revoked api key");
  eq(resolved.status, 401);
});

test("API-KEY middleware: x-tenant-id still works as fallback", async () => {
  const resolved = await resolveTenantId(svc, { "x-tenant-id": "t-fallback" });
  eq(resolved.error, undefined);
  eq(resolved.tenantId, "t-fallback");
});

test("API-KEY middleware: missing both headers returns 400", async () => {
  const resolved = await resolveTenantId(svc, {});
  eq(resolved.error, "x-tenant-id or x-api-key header required");
  eq(resolved.status, 400);
});

test("API-KEY middleware: revoked key returns 401", async () => {
  const r = await svc.create({ tenantId: "t-revoked-mw", name: "revoked-mw" });
  await svc.revoke(r.key.keyId);
  const resolved = await resolveTenantId(svc, { "x-api-key": r.secret });
  eq(resolved.error, "invalid or revoked api key");
  eq(resolved.status, 401);
});
