import "../_flush.mjs";
import { test, assert, eq } from "../_harness.mjs";
import { generateSecret, generateTotp, verifyTotp } from "../../lib/auth/totp.ts";

// ─── BASE32_DECODE_MAP efficiency: O(1) Map lookup replaces O(32) indexOf ────
//
// These tests verify that the refactor from BASE32_CHARS.indexOf(c) to
// BASE32_DECODE_MAP.get(c) preserves all correctness invariants: correct
// round-trip decode, handling of all 32 valid characters, and fail-closed
// rejection of invalid characters.

test("decode-map: generate + verify round-trip still correct after map refactor", () => {
  const secret = generateSecret();
  const now = Date.now();
  const code = generateTotp(secret, now);
  assert(/^\d{6}$/.test(code), "must produce a 6-digit code");
  assert(verifyTotp(secret, code, now), "freshly generated code must verify");
});

test("decode-map: all 32 distinct base32 chars in secret decode without error (exercises every Map entry)", () => {
  // ABCDEFGHIJKLMNOPQRSTUVWXYZ234567 = 32 chars; a multiple of 8 so no padding issues.
  const allChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const code = generateTotp(allChars, Date.now());
  assert(/^\d{6}$/.test(code), "must produce a 6-digit code for all-chars secret");
  // Verify the same secret: exercises full decode path on both generate and verify calls.
  assert(verifyTotp(allChars, code, Date.now()), "all-chars secret must round-trip");
});

test("decode-map: invalid base32 char still throws fail-closed (not silently skipped)", () => {
  // '0' and '1' are not valid base32 characters (alphabet is A-Z + 2-7).
  // Must throw, not silently produce a wrong result.
  let threw = false;
  try { generateTotp("INVALID0SECRET1", Date.now()); } catch { threw = true; }
  assert(threw, "invalid base32 char '0'/'1' must throw, not be silently dropped");
});
