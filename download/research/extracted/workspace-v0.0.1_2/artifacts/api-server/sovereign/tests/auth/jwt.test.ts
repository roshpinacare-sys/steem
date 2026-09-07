import "../_flush.mjs";
import { test, eq, assert } from "../_harness.mjs";
import { signJwt, verifyJwt, decodeJwt } from "../../lib/auth/jwt.ts";

const SECRET = "test-secret-that-is-long-enough-for-hs256-32chars!";

test("sign + verify round-trip", () => {
  const token = signJwt({ sub: "user-1", tenantId: "t1" }, { secret: SECRET, expiresInSec: 3600 });
  const r = verifyJwt(token, SECRET);
  assert(r.ok, "verify should succeed");
  if (r.ok) {
    eq(r.payload.sub, "user-1");
    eq(r.payload.tenantId, "t1");
    assert(typeof r.payload.iat === "number", "iat should be set");
    assert(typeof r.payload.exp === "number", "exp should be set");
    assert(typeof r.payload.jti === "string", "jti should be set");
  }
});

test("each token has a unique jti", () => {
  const a = signJwt({ sub: "u1" }, { secret: SECRET });
  const b = signJwt({ sub: "u1" }, { secret: SECRET });
  const pa = decodeJwt(a);
  const pb = decodeJwt(b);
  assert(pa?.jti !== pb?.jti, "jti must be unique per token");
});

test("tampered signature → invalid_signature", () => {
  const token = signJwt({ sub: "u1" }, { secret: SECRET });
  const parts = token.split(".");
  parts[2] = parts[2].slice(0, -3) + "xxx";
  const r = verifyJwt(parts.join("."), SECRET);
  assert(!r.ok, "tampered token must fail");
  if (!r.ok) eq(r.reason, "invalid_signature");
});

test("tampered payload (tenant escalation attempt) → invalid_signature", () => {
  const token = signJwt({ sub: "u1", tenantId: "t1" }, { secret: SECRET });
  const [h, body, s] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  payload.tenantId = "other-tenant";
  const fakeBody = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const r = verifyJwt(`${h}.${fakeBody}.${s}`, SECRET);
  assert(!r.ok, "payload tampering must fail");
  if (!r.ok) eq(r.reason, "invalid_signature");
});

test("wrong secret → invalid_signature", () => {
  const token = signJwt({ sub: "u1" }, { secret: SECRET });
  const r = verifyJwt(token, "wrong-secret");
  assert(!r.ok);
  if (!r.ok) eq(r.reason, "invalid_signature");
});

test("expired token → expired", () => {
  const past = Math.floor(Date.now() / 1000) - 10;
  const token = signJwt({ sub: "u1", exp: past }, { secret: SECRET });
  const r = verifyJwt(token, SECRET);
  assert(!r.ok, "expired token must fail");
  if (!r.ok) eq(r.reason, "expired");
});

test("missing secret → missing_secret", () => {
  const token = signJwt({ sub: "u1" }, { secret: SECRET });
  const r = verifyJwt(token, "");
  assert(!r.ok);
  if (!r.ok) eq(r.reason, "missing_secret");
});

test("malformed token (2 parts) → malformed", () => {
  const r = verifyJwt("header.body", SECRET);
  assert(!r.ok);
  if (!r.ok) eq(r.reason, "malformed");
});

test("tenantId is preserved and immutable after signing", () => {
  const token = signJwt({ sub: "u1", tenantId: "tenant-A" }, { secret: SECRET });
  const r = verifyJwt(token, SECRET);
  assert(r.ok);
  if (r.ok) eq(r.payload.tenantId, "tenant-A");
});

// ─── efficiency/const-header (v377) ────────────────────────────────────────
// Tests covering the module-level JWT_HEADER_B64 constant that replaced the
// per-call JSON.stringify({ alg:"HS256", typ:"JWT" }) + base64url in signJwt().

test("const-header happy-path: signed token always has HS256/JWT header", () => {
  const token = signJwt({ sub: "u1", tenantId: "t1" }, { secret: SECRET });
  const [headerB64] = token.split(".");
  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  eq(header.alg, "HS256", "alg must be HS256");
  eq(header.typ, "JWT",   "typ must be JWT");
  // Exact canonical encoding must match what module-level constant produces.
  eq(headerB64, Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf8").toString("base64url"),
    "header encoding is byte-for-byte identical to the pre-computed constant");
});

test("const-header edge-case: header is identical across many concurrent signs (no divergence)", () => {
  // Verifies the constant is truly shared and not re-derived per call.
  const headers = Array.from({ length: 50 }, () =>
    signJwt({ sub: "u2", tenantId: "t2" }, { secret: SECRET }).split(".")[0]
  );
  const unique = new Set(headers);
  eq(unique.size, 1, "all 50 tokens must share the exact same header b64 segment");
});

test("const-header fail-closed: token with mutated header segment fails verify", () => {
  // Round-trip correctness: even though header is pre-computed, the HMAC still
  // covers `header.body` — so forging the header breaks the signature check.
  const token = signJwt({ sub: "u3", tenantId: "t3" }, { secret: SECRET });
  const [, body, sig] = token.split(".");
  // Replace HS256 with RS256 in the header to simulate a header-swap attack.
  const fakeHeader = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }), "utf8").toString("base64url");
  const forged = `${fakeHeader}.${body}.${sig}`;
  const r = verifyJwt(forged, SECRET);
  assert(!r.ok, "forged header must be rejected");
  if (!r.ok) eq(r.reason, "invalid_signature", "rejection reason must be invalid_signature");
});
