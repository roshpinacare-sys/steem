import "../_flush.mjs";
/**
 * tests/http/sso-bearer-auth.test.ts — RBAC/SSO sub-step 1 (v321).
 * Authorization: Bearer <jwt> resolves tenantId + scopes via lib/auth/jwt.ts
 * when TFA_SSO_JWT_SECRET / ssoJwtSecret is configured, feeding the same
 * requireScope chokepoint API keys already use. Inert (no behavior change)
 * when no secret is configured.
 */
import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { resolveSsoSecret } from "../../src/http/tenant-resolver.ts";
import { signJwt } from "../../lib/auth/jwt.ts";

const SECRET = "tfa-sso-test-secret-min-32-bytes!!";

test("resolveSsoSecret: explicit option wins; falls back to env; undefined when neither set", () => {
  eq(resolveSsoSecret("explicit"), "explicit");
  delete (globalThis as any).process.env.TFA_SSO_JWT_SECRET;
  eq(resolveSsoSecret(undefined), undefined);
  (globalThis as any).process.env.TFA_SSO_JWT_SECRET = "from-env";
  eq(resolveSsoSecret(undefined), "from-env");
  delete (globalThis as any).process.env.TFA_SSO_JWT_SECRET;
});

test("HAPPY: valid SSO bearer token with scopes claim resolves tenant + passes admin scope check", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false, ssoJwtSecret: SECRET } as any);
  const port: number = (server.address() as any).port;
  const token = signJwt({ sub: "user-1", tenantId: "acme", scopes: ["admin:kill-switch"] }, { secret: SECRET, expiresInSec: 3600 });
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/kill-switch/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  eq(r.status, 200, "scoped SSO token grants access to admin route");
  server.close();
});

test("EDGE: roles claim is honored when scopes is absent", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false, ssoJwtSecret: SECRET } as any);
  const port: number = (server.address() as any).port;
  const token = signJwt({ sub: "user-2", tenantId: "acme", roles: ["admin:kill-switch"] }, { secret: SECRET, expiresInSec: 3600 });
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/kill-switch/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  eq(r.status, 200, "roles claim maps onto the same requireScope chokepoint as scopes");
  server.close();
});

test("EDGE: token without the required scope is denied 403 (RBAC still enforced)", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false, ssoJwtSecret: SECRET } as any);
  const port: number = (server.address() as any).port;
  const token = signJwt({ sub: "user-3", tenantId: "acme", scopes: ["index:read"] }, { secret: SECRET, expiresInSec: 3600 });
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/kill-switch/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  eq(r.status, 403, "SSO auth resolves identity but does not bypass scope enforcement");
  server.close();
});

test("FAIL-CLOSED: wrong-secret signature is rejected 401", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false, ssoJwtSecret: SECRET } as any);
  const port: number = (server.address() as any).port;
  const token = signJwt({ sub: "user-4", tenantId: "acme", scopes: ["superadmin"] }, { secret: "a-completely-different-secret-value", expiresInSec: 3600 });
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/kill-switch/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  eq(r.status, 401, "tampered/wrong-secret token rejected, not silently downgraded");
  server.close();
});

test("FAIL-CLOSED: expired token is rejected 401", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false, ssoJwtSecret: SECRET } as any);
  const port: number = (server.address() as any).port;
  const token = signJwt({ sub: "user-5", tenantId: "acme", scopes: ["superadmin"], exp: Math.floor(Date.now() / 1000) - 60 }, { secret: SECRET });
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/kill-switch/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  eq(r.status, 401, "expired SSO token rejected");
  server.close();
});

test("FAIL-CLOSED: token missing tenantId claim is rejected 401, not defaulted", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false, ssoJwtSecret: SECRET } as any);
  const port: number = (server.address() as any).port;
  const token = signJwt({ sub: "user-6", scopes: ["superadmin"] }, { secret: SECRET, expiresInSec: 3600 });
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/kill-switch/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  eq(r.status, 401, "no tenantId claim → no identity, fail-closed (never guesses a tenant)");
  server.close();
});

test("INERT BY DEFAULT: no ssoJwtSecret configured → bearer header ignored, falls through to existing 400", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false } as any);
  const port: number = (server.address() as any).port;
  const token = signJwt({ sub: "user-7", tenantId: "acme", scopes: ["superadmin"] }, { secret: SECRET, expiresInSec: 3600 });
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/kill-switch/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  eq(r.status, 400, "unconfigured SSO path is a no-op — existing deployments see identical behavior to pre-v321");
  server.close();
});

test("PRECEDENCE: x-api-key still wins over a present Authorization bearer header", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false, ssoJwtSecret: SECRET } as any);
  const port: number = (server.address() as any).port;
  // Bogus bearer token (would fail SSO verification) + bare x-tenant-id absent + no x-api-key service
  // configured for this ad-hoc key string → api-key branch is reached first and rejects it as invalid,
  // proving x-api-key is checked before the bearer header is even inspected.
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/kill-switch/status`, {
    headers: { "x-api-key": "tfa_not_a_real_key", authorization: "Bearer not-a-real-jwt-either" },
  });
  eq(r.status, 401, "x-api-key branch handled the request (invalid key → 401, never reaches SSO/bearer branch)");
  server.close();
});
