import "../_flush.mjs";
import { test, eq, assert } from "../_harness.mjs";
import { hashPassword, verifyPassword } from "../../lib/auth/password.ts";

// Use fast params for tests
process.env.SCRYPT_N = "16";

test("hash produces scrypt$ format", async () => {
  const h = await hashPassword("correcthorse");
  assert(h.startsWith("scrypt$"), "must start with scrypt$");
  eq(h.split("$").length, 6, "must have 6 $-separated parts");
});

test("correct password verifies", async () => {
  const h = await hashPassword("mysecretpassword");
  const ok = await verifyPassword("mysecretpassword", h);
  assert(ok, "correct password must verify");
});

test("wrong password fails", async () => {
  const h = await hashPassword("correct");
  const ok = await verifyPassword("wrong", h);
  assert(!ok, "wrong password must not verify");
});

test("same password produces different hashes (salt)", async () => {
  const h1 = await hashPassword("password");
  const h2 = await hashPassword("password");
  assert(h1 !== h2, "salt must make hashes unique");
});

test("empty password is hashable and verifiable", async () => {
  const h = await hashPassword("");
  const ok = await verifyPassword("", h);
  assert(ok, "empty password should round-trip");
  const bad = await verifyPassword("notempty", h);
  assert(!bad, "non-empty must not match empty hash");
});

test("malformed stored hash → false (fail-closed)", async () => {
  const ok = await verifyPassword("anything", "not-a-valid-hash");
  assert(!ok, "malformed hash must fail-closed");
});

test("truncated hash → false (fail-closed)", async () => {
  const ok = await verifyPassword("pw", "scrypt$1024$8$1$badsalt");
  assert(!ok, "truncated hash must fail-closed");
});
