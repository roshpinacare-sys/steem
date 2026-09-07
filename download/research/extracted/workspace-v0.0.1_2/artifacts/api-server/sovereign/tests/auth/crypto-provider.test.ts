import "../_flush.mjs";
/**
 * tests/auth/crypto-provider.test.ts
 *
 * Tests for the CryptoProvider interface and its two implementations:
 * - defaultCryptoProvider (sovereign/real)
 * - testCryptoProvider (stub for unit tests)
 *
 * Covers: factory validation, DI contract, jwt/password/totp round-trips
 * through the interface, fail-closed on bad secret, tenant isolation.
 */
// Override scrypt N for sandbox environments (production uses N=131072 by default).
// The MANIFEST notes that N=131072 exceeds memory limits in CI/sandbox.
process.env.SCRYPT_N = "16";

import { test, eq, assert } from "../_harness.mjs";
import {
  defaultCryptoProvider,
  testCryptoProvider,
} from "../../lib/auth/crypto-provider.ts";

const SECRET = "test-jwt-secret-that-is-long-enough-for-hs256!";

// ─── Factory validation ───────────────────────────────────────────────────────

test("defaultCryptoProvider: throws on short secret (< 32 chars)", () => {
  let threw = false;
  try {
    defaultCryptoProvider({ jwtSecret: "tooshort" });
  } catch {
    threw = true;
  }
  assert(threw, "should throw when jwtSecret is too short");
});

test("defaultCryptoProvider: throws on empty secret", () => {
  let threw = false;
  try {
    defaultCryptoProvider({ jwtSecret: "" });
  } catch {
    threw = true;
  }
  assert(threw, "should throw on empty secret");
});

test("defaultCryptoProvider: constructs cleanly with valid secret", () => {
  const cp = defaultCryptoProvider({ jwtSecret: SECRET });
  assert(typeof cp.jwt.sign === "function", "jwt.sign must be a function");
  assert(typeof cp.password.hash === "function", "password.hash must be a function");
  assert(typeof cp.totp.generateSecret === "function", "totp.generateSecret must be a function");
});

// ─── JWT via CryptoProvider ───────────────────────────────────────────────────

test("cp.jwt: sign + verify round-trip with tenantId", () => {
  const cp = defaultCryptoProvider({ jwtSecret: SECRET });
  const token = cp.jwt.sign(
    { sub: "user-1", tenantId: "tenant-A" },
    { secret: SECRET, expiresInSec: 3600 }
  );
  const r = cp.jwt.verify(token, SECRET);
  assert(r.ok, "verify must succeed");
  if (r.ok) {
    eq(r.payload.sub, "user-1");
    eq(r.payload.tenantId, "tenant-A");
  }
});

test("cp.jwt: tenant escalation attempt → invalid_signature", () => {
  const cp = defaultCryptoProvider({ jwtSecret: SECRET });
  const token = cp.jwt.sign({ sub: "u1", tenantId: "tenant-A" }, { secret: SECRET });
  const [h, body, s] = token.split(".");
  const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  decoded.tenantId = "tenant-B"; // escalation attempt
  const tampered = `${h}.${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${s}`;
  const r = cp.jwt.verify(tampered, SECRET);
  assert(!r.ok, "tampered tenant must be rejected");
  if (!r.ok) eq(r.reason, "invalid_signature");
});

test("cp.jwt: decode (no verify) returns payload without checking sig", () => {
  const cp = defaultCryptoProvider({ jwtSecret: SECRET });
  const token = cp.jwt.sign({ sub: "decode-test" }, { secret: SECRET });
  const payload = cp.jwt.decode(token);
  assert(payload !== null, "decode must return payload");
  eq(payload?.sub, "decode-test");
});

// ─── Password via CryptoProvider ─────────────────────────────────────────────

test("cp.password: hash + verify round-trip", async () => {
  const cp = defaultCryptoProvider({ jwtSecret: SECRET });
  const hash = await cp.password.hash("correct-horse-battery");
  const ok = await cp.password.verify("correct-horse-battery", hash);
  assert(ok, "correct password must verify");
});

test("cp.password: wrong password → false (fail-closed)", async () => {
  const cp = defaultCryptoProvider({ jwtSecret: SECRET });
  const hash = await cp.password.hash("correct-horse-battery");
  const ok = await cp.password.verify("wrong-password", hash);
  assert(!ok, "wrong password must return false");
});

test("cp.password: hash is non-deterministic (unique salts)", async () => {
  const cp = defaultCryptoProvider({ jwtSecret: SECRET });
  const h1 = await cp.password.hash("same-password");
  const h2 = await cp.password.hash("same-password");
  assert(h1 !== h2, "each hash must be unique (different salts)");
});

// ─── TOTP via CryptoProvider ─────────────────────────────────────────────────

test("cp.totp: generate secret is base32 string", () => {
  const cp = defaultCryptoProvider({ jwtSecret: SECRET });
  const secret = cp.totp.generateSecret();
  assert(/^[A-Z2-7]+$/.test(secret), "secret must be base32 encoded");
  assert(secret.length >= 16, "secret must be at least 16 chars");
});

test("cp.totp: generate + verify round-trip", () => {
  const cp = defaultCryptoProvider({ jwtSecret: SECRET });
  const secret = cp.totp.generateSecret();
  const now = Date.now();
  const code = cp.totp.generateCode(secret, now);
  assert(cp.totp.verify(secret, code, now), "generated code must verify");
});

test("cp.totp: uri format is valid otpauth", () => {
  const cp = defaultCryptoProvider({ jwtSecret: SECRET });
  const secret = cp.totp.generateSecret();
  const uri = cp.totp.uri(secret, "user@example.com", "TFA");
  assert(uri.startsWith("otpauth://totp/"), "uri must start with otpauth://totp/");
  assert(uri.includes(secret), "uri must contain the secret");
});

// ─── Test stub (testCryptoProvider) ──────────────────────────────────────────

test("testCryptoProvider: jwt sign + verify stub round-trip", () => {
  const cp = testCryptoProvider();
  const token = cp.jwt.sign({ sub: "stub-user", tenantId: "t1" }, { secret: "irrelevant" });
  const r = cp.jwt.verify(token, "irrelevant");
  assert(r.ok, "stub verify must succeed for a stub-signed token");
  if (r.ok) {
    eq(r.payload.sub, "stub-user");
    eq(r.payload.tenantId, "t1");
  }
});

test("testCryptoProvider: password hash + verify stub", async () => {
  const cp = testCryptoProvider();
  const hash = await cp.password.hash("any-password");
  assert(await cp.password.verify("any-password", hash), "stub verify must pass for correct pw");
  assert(!(await cp.password.verify("wrong", hash)), "stub verify must fail for wrong pw");
});

test("testCryptoProvider: totp stub always returns 123456", () => {
  const cp = testCryptoProvider();
  const secret = cp.totp.generateSecret();
  const code = cp.totp.generateCode(secret);
  eq(code, "123456");
  assert(cp.totp.verify(secret, "123456"), "stub totp must accept 123456");
  assert(!cp.totp.verify(secret, "000000"), "stub totp must reject anything else");
});

// ─── Interface swap (DI contract) ────────────────────────────────────────────

test("DI swap: service works identically with real vs stub provider", async () => {
  // Simulate an AuthService that only depends on CryptoProvider
  async function loginFlow(cp: ReturnType<typeof defaultCryptoProvider>, pw: string, stored: string) {
    const ok = await cp.password.verify(pw, stored);
    if (!ok) return null;
    return cp.jwt.sign({ sub: "user-1", tenantId: "t1" }, { secret: SECRET });
  }

  // With real provider
  const real = defaultCryptoProvider({ jwtSecret: SECRET });
  const realHash = await real.password.hash("hunter2");
  const realToken = await loginFlow(real, "hunter2", realHash);
  assert(realToken !== null, "real login must succeed");

  // With stub provider (same interface)
  const stub = testCryptoProvider();
  const stubHash = await stub.password.hash("hunter2");
  const stubToken = await loginFlow(stub as ReturnType<typeof defaultCryptoProvider>, "hunter2", stubHash);
  assert(stubToken !== null, "stub login must succeed");
});
