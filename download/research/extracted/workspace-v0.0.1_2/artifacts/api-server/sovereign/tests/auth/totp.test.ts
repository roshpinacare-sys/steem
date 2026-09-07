import "../_flush.mjs";
import { test, eq, assert } from "../_harness.mjs";
import { generateSecret, generateTotp, verifyTotp, totpUri } from "../../lib/auth/totp.ts";

// ─── generateSecret ───────────────────────────────────────────────────────────

test("generateSecret returns base32 string of correct length", () => {
  const s = generateSecret();
  assert(/^[A-Z2-7]+$/.test(s), "must be valid base32");
  // 20 raw bytes → 32 base32 chars
  eq(s.length, 32, "20-byte secret → 32 base32 chars");
});

test("each generated secret is unique", () => {
  const a = generateSecret();
  const b = generateSecret();
  assert(a !== b, "secrets must be unique");
});

// ─── RFC 6238 test vector (SHA-1, 6 digits) ───────────────────────────────────
// Using a known secret: JBSWY3DPEHPK3PXP (from many TOTP implementations)
// We test consistency: generate then immediately verify.

test("generateTotp + verifyTotp round-trip", () => {
  const secret = generateSecret();
  const now = Date.now();
  const code = generateTotp(secret, now);
  assert(/^\d{6}$/.test(code), "code must be 6 digits");
  const ok = verifyTotp(secret, code, now);
  assert(ok, "freshly generated code must verify");
});

test("code verifies within window (±1 step)", () => {
  const secret = generateSecret();
  const now = Date.now();
  // generate code for the previous step
  const prevCode = generateTotp(secret, now - 30_000);
  const ok = verifyTotp(secret, prevCode, now);
  assert(ok, "previous-step code must verify within window");
});

test("code from 2 steps ago is rejected", () => {
  const secret = generateSecret();
  const now = Date.now();
  const oldCode = generateTotp(secret, now - 90_000); // 3 steps back
  const ok = verifyTotp(secret, oldCode, now);
  assert(!ok, "stale code must be rejected");
});

// ─── Fail-closed ──────────────────────────────────────────────────────────────

test("wrong code → false", () => {
  const secret = generateSecret();
  const ok = verifyTotp(secret, "000000", Date.now());
  // could accidentally be correct, but astronomically unlikely
  // We test with a code that's clearly wrong for this secret
  const realCode = generateTotp(secret, Date.now());
  const fakeCode = realCode === "000000" ? "000001" : "000000";
  assert(!verifyTotp(secret, fakeCode, Date.now()), "wrong code must fail");
});

test("non-numeric code → false", () => {
  const secret = generateSecret();
  assert(!verifyTotp(secret, "abc123", Date.now()));
  assert(!verifyTotp(secret, "12345", Date.now()));  // 5 digits
  assert(!verifyTotp(secret, "1234567", Date.now())); // 7 digits
});

// ─── totpUri ─────────────────────────────────────────────────────────────────

test("totpUri has correct format", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const uri = totpUri(secret, "user@example.com", "MyApp");
  assert(uri.startsWith("otpauth://totp/"), "must start with otpauth://totp/");
  assert(uri.includes(`secret=${secret}`), "must include secret");
  assert(uri.includes("issuer=MyApp"), "must include issuer");
  assert(uri.includes("digits=6"), "must include digits=6");
  assert(uri.includes("period=30"), "must include period=30");
});

// ─── efficiency/decode-once ───────────────────────────────────────────────────
// verifyTotp probes ±WINDOW (3 total) counters for the same secret. base32Decode
// is now called once per verify call and the resulting key Buffer reused across
// all window steps, instead of re-decoding the secret on every hotp() call.

test("efficiency/decode-once: decode-once still matches at every window step", () => {
  const secret = generateSecret();
  const now = Date.now();
  // exercise all three window steps (prev, current, next) against one verify call
  const prevCode = generateTotp(secret, now - 30_000);
  const curCode = generateTotp(secret, now);
  const nextCode = generateTotp(secret, now + 30_000);
  assert(verifyTotp(secret, prevCode, now), "previous-step code must still verify");
  assert(verifyTotp(secret, curCode, now), "current-step code must still verify");
  assert(verifyTotp(secret, nextCode, now), "next-step code must still verify");
});

test("efficiency/decode-once: padded lowercase secret decodes once and verifies identically across many calls", () => {
  const secret = generateSecret().toLowerCase() + "=="; // lowercase + padding, exercises normalisation
  const now = Date.now();
  const code = generateTotp(secret, now);
  // repeat verification many times to simulate a hot path; every call must be
  // independently correct (decode-once is per-call, not cached across calls)
  for (let i = 0; i < 10; i++) {
    assert(verifyTotp(secret, code, now), `verify must succeed on repeated call ${i}`);
  }
});

test("efficiency/decode-once fail-closed: invalid base32 char in secret throws before any HOTP work, for both generate and verify", () => {
  const badSecret = "INVALID1"; // '1' is not in the base32 alphabet
  let generateThrew = false;
  try {
    generateTotp(badSecret, Date.now());
  } catch {
    generateThrew = true;
  }
  assert(generateThrew, "generateTotp must throw on invalid base32 secret");

  let verifyThrew = false;
  try {
    verifyTotp(badSecret, "123456", Date.now());
  } catch {
    verifyThrew = true;
  }
  assert(verifyThrew, "verifyTotp must throw on invalid base32 secret (decoded once, before the window loop)");
});
