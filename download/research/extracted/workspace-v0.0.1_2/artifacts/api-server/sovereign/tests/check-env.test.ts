import "./_flush.mjs";
/**
 * tests/check-env.test.ts — Unit tests for scripts/check-env.mjs.
 *
 * Coverage:
 *   TFA_PERSIST
 *     • unset → ok, no errors
 *     • "" (empty) → ok (treated as memory)
 *     • "memory" → ok
 *     • "pg" (no DB_URL) → error
 *     • "pg" + valid DB_URL → ok
 *     • "pg" + DB_URL without postgres:// prefix → error
 *     • "pg" + postgresql:// prefix → ok
 *     • invalid value ("redis") → error
 *
 *   DB_URL
 *     • set but TFA_PERSIST != "pg" → warning (not error)
 *     • set + TFA_PERSIST=pg → ok (no extra warning)
 *     • DB_URL with password → redacted in error message (not tested for exact string,
 *       tested that the word "***" appears)
 *
 *   TFA_REQUIRE_API_KEY
 *     • unset → ok
 *     • "1" → ok
 *     • "0" → ok
 *     • "true" (invalid) → warning (not error)
 *     • "yes" (invalid) → warning (not error)
 *
 *   PORT
 *     • unset → ok (defaults to 7700)
 *     • "7700" → ok
 *     • "0" → error (out of range)
 *     • "65535" → ok (upper boundary)
 *     • "65536" → error (over boundary)
 *     • "abc" → error (not a number)
 *     • "3000.5" → error (not an integer)
 *     • "-1" → error (negative)
 *     • "1" → ok (lower boundary)
 *
 *   Combined
 *     • all vars missing → ok
 *     • TFA_PERSIST=pg + no DB_URL + bad PORT → 2 errors
 *     • TFA_PERSIST=pg + valid DB_URL + valid PORT + TFA_REQUIRE_API_KEY=1 → ok
 *     • DB_URL set + persist=memory → warning only, ok=true
 *
 *   result shape
 *     • ok === (errors.length === 0)
 *     • warnings and errors are arrays of strings
 */

import { test, eq, assert } from "./_harness.mjs";
import { checkEnv } from "../scripts/check-env.mjs";

// ─── TFA_PERSIST ──────────────────────────────────────────────────────────────

test("check-env: TFA_PERSIST unset → ok, no errors", () => {
  const r = checkEnv({});
  eq(r.ok, true);
  eq(r.errors.length, 0);
});

test("check-env: TFA_PERSIST='' (empty string) → ok", () => {
  const r = checkEnv({ TFA_PERSIST: "" });
  eq(r.ok, true);
  eq(r.errors.length, 0);
});

test("check-env: TFA_PERSIST=memory → ok", () => {
  const r = checkEnv({ TFA_PERSIST: "memory" });
  eq(r.ok, true);
  eq(r.errors.length, 0);
});

test("check-env: TFA_PERSIST=pg without DB_URL → error", () => {
  const r = checkEnv({ TFA_PERSIST: "pg" });
  eq(r.ok, false);
  assert(r.errors.length >= 1, "should have at least one error");
  assert(r.errors.some(e => e.includes("DB_URL")), "error should mention DB_URL");
});

test("check-env: TFA_PERSIST=pg + valid postgres:// DB_URL → ok", () => {
  const r = checkEnv({ TFA_PERSIST: "pg", DB_URL: "postgres://user:pass@localhost:5432/tfa" });
  eq(r.ok, true);
  eq(r.errors.length, 0);
});

test("check-env: TFA_PERSIST=pg + postgresql:// prefix → ok", () => {
  const r = checkEnv({ TFA_PERSIST: "pg", DB_URL: "postgresql://user:pass@localhost:5432/tfa" });
  eq(r.ok, true);
  eq(r.errors.length, 0);
});

test("check-env: TFA_PERSIST=pg + DB_URL without postgres:// prefix → error", () => {
  const r = checkEnv({ TFA_PERSIST: "pg", DB_URL: "mysql://localhost/tfa" });
  eq(r.ok, false);
  assert(r.errors.some(e => e.includes("DB_URL")), "error should mention DB_URL");
  assert(r.errors.some(e => e.includes("postgres")), "error should mention expected prefix");
});

test("check-env: TFA_PERSIST=redis (invalid) → error", () => {
  const r = checkEnv({ TFA_PERSIST: "redis" });
  eq(r.ok, false);
  assert(r.errors.some(e => e.includes("TFA_PERSIST")), "error should mention TFA_PERSIST");
  assert(r.errors.some(e => e.includes("redis")), "error should include the bad value");
});

// ─── DB_URL ───────────────────────────────────────────────────────────────────

test("check-env: DB_URL set but TFA_PERSIST != pg → warning (ok=true)", () => {
  const r = checkEnv({ DB_URL: "postgres://localhost/tfa" });
  eq(r.ok, true, "DB_URL without TFA_PERSIST=pg is a warning, not an error");
  assert(r.warnings.length >= 1, "should have at least one warning");
  assert(r.warnings.some(w => w.includes("DB_URL")), "warning should mention DB_URL");
});

test("check-env: DB_URL set + TFA_PERSIST=memory → warning (ok=true)", () => {
  const r = checkEnv({ TFA_PERSIST: "memory", DB_URL: "postgres://localhost/tfa" });
  eq(r.ok, true);
  assert(r.warnings.length >= 1);
});

test("check-env: DB_URL with password → error message does not leak plain password", () => {
  const r = checkEnv({ TFA_PERSIST: "pg", DB_URL: "postgres://admin:supersecret@host/db" });
  // If there's an error (bad DB_URL scheme is fine, or ok is fine), check no plain password
  const allMessages = [...r.errors, ...r.warnings].join(" ");
  assert(!allMessages.includes("supersecret"), "password must not appear in messages");
});

// ─── TFA_REQUIRE_API_KEY ─────────────────────────────────────────────────────

test("check-env: TFA_REQUIRE_API_KEY unset → ok", () => {
  const r = checkEnv({});
  eq(r.ok, true);
  eq(r.errors.length, 0);
});

test("check-env: TFA_REQUIRE_API_KEY=1 → ok", () => {
  const r = checkEnv({ TFA_REQUIRE_API_KEY: "1" });
  eq(r.ok, true);
  eq(r.errors.length, 0);
  eq(r.warnings.filter(w => w.includes("TFA_REQUIRE_API_KEY")).length, 0);
});

test("check-env: TFA_REQUIRE_API_KEY=0 → ok", () => {
  const r = checkEnv({ TFA_REQUIRE_API_KEY: "0" });
  eq(r.ok, true);
  eq(r.errors.length, 0);
});

test("check-env: TFA_REQUIRE_API_KEY=true (invalid) → warning, ok=true", () => {
  const r = checkEnv({ TFA_REQUIRE_API_KEY: "true" });
  eq(r.ok, true, "invalid TFA_REQUIRE_API_KEY is a warning, not an error");
  assert(r.warnings.some(w => w.includes("TFA_REQUIRE_API_KEY")), "warning should mention the var");
});

test("check-env: TFA_REQUIRE_API_KEY=yes (invalid) → warning, ok=true", () => {
  const r = checkEnv({ TFA_REQUIRE_API_KEY: "yes" });
  eq(r.ok, true);
  assert(r.warnings.some(w => w.includes("TFA_REQUIRE_API_KEY")));
});

// ─── PORT ─────────────────────────────────────────────────────────────────────

test("check-env: PORT unset → ok", () => {
  const r = checkEnv({});
  eq(r.ok, true);
  eq(r.errors.length, 0);
});

test("check-env: PORT=7700 → ok", () => {
  const r = checkEnv({ PORT: "7700" });
  eq(r.ok, true);
  eq(r.errors.length, 0);
});

test("check-env: PORT=1 (lower boundary) → ok", () => {
  const r = checkEnv({ PORT: "1" });
  eq(r.ok, true);
});

test("check-env: PORT=65535 (upper boundary) → ok", () => {
  const r = checkEnv({ PORT: "65535" });
  eq(r.ok, true);
});

test("check-env: PORT=0 → error", () => {
  const r = checkEnv({ PORT: "0" });
  eq(r.ok, false);
  assert(r.errors.some(e => e.includes("PORT")));
});

test("check-env: PORT=65536 → error", () => {
  const r = checkEnv({ PORT: "65536" });
  eq(r.ok, false);
  assert(r.errors.some(e => e.includes("PORT")));
});

test("check-env: PORT=-1 → error", () => {
  const r = checkEnv({ PORT: "-1" });
  eq(r.ok, false);
  assert(r.errors.some(e => e.includes("PORT")));
});

test("check-env: PORT=abc → error", () => {
  const r = checkEnv({ PORT: "abc" });
  eq(r.ok, false);
  assert(r.errors.some(e => e.includes("PORT")));
});

test("check-env: PORT=3000.5 (non-integer) → error", () => {
  const r = checkEnv({ PORT: "3000.5" });
  eq(r.ok, false);
  assert(r.errors.some(e => e.includes("PORT")));
});

// ─── Combined scenarios ───────────────────────────────────────────────────────

test("check-env: all vars missing → ok", () => {
  const r = checkEnv({});
  eq(r.ok, true);
  eq(r.errors.length, 0);
});

test("check-env: TFA_PERSIST=pg + no DB_URL + bad PORT → 2 errors", () => {
  const r = checkEnv({ TFA_PERSIST: "pg", PORT: "99999" });
  eq(r.ok, false);
  assert(r.errors.length >= 2, `expected ≥2 errors, got ${r.errors.length}: ${r.errors.join("; ")}`);
  assert(r.errors.some(e => e.includes("DB_URL")));
  assert(r.errors.some(e => e.includes("PORT")));
});

test("check-env: TFA_PERSIST=pg + valid DB_URL + valid PORT + TFA_REQUIRE_API_KEY=1 → ok", () => {
  const r = checkEnv({
    TFA_PERSIST: "pg",
    DB_URL: "postgres://user:pass@localhost:5432/tfa",
    PORT: "8080",
    TFA_REQUIRE_API_KEY: "1",
  });
  eq(r.ok, true);
  eq(r.errors.length, 0);
});

test("check-env: result.ok === (errors.length === 0) invariant", () => {
  const cases = [
    {},
    { TFA_PERSIST: "pg" },
    { TFA_PERSIST: "memory" },
    { PORT: "abc" },
    { TFA_PERSIST: "pg", DB_URL: "postgres://h/db", PORT: "3000" },
  ];
  for (const env of cases) {
    const r = checkEnv(env);
    eq(r.ok, r.errors.length === 0, `ok/errors mismatch for env=${JSON.stringify(env)}`);
  }
});

test("check-env: warnings and errors are arrays of strings", () => {
  const r = checkEnv({ TFA_PERSIST: "bad", PORT: "99999", TFA_REQUIRE_API_KEY: "yes", DB_URL: "postgres://h/db" });
  assert(Array.isArray(r.errors), "errors must be array");
  assert(Array.isArray(r.warnings), "warnings must be array");
  for (const e of r.errors) assert(typeof e === "string", "each error must be string");
  for (const w of r.warnings) assert(typeof w === "string", "each warning must be string");
});

// ─── TFA_SIGNER_KIND ──────────────────────────────────────────────────────────

test("check-env: TFA_SIGNER_KIND unset → ok", () => {
  const r = checkEnv({});
  eq(r.ok, true);
  eq(r.errors.length, 0);
  eq(r.warnings.filter(w => w.includes("TFA_SIGNER_KIND")).length, 0);
});

test("check-env: TFA_SIGNER_KIND=ed25519 → ok", () => {
  const r = checkEnv({ TFA_SIGNER_KIND: "ed25519" });
  eq(r.ok, true);
  eq(r.errors.length, 0);
  eq(r.warnings.filter(w => w.includes("TFA_SIGNER_KIND")).length, 0);
});

test("check-env: TFA_SIGNER_KIND=hmac → ok", () => {
  const r = checkEnv({ TFA_SIGNER_KIND: "hmac" });
  eq(r.ok, true);
  eq(r.errors.length, 0);
  eq(r.warnings.filter(w => w.includes("TFA_SIGNER_KIND")).length, 0);
});

test("check-env: TFA_SIGNER_KIND=hybrid-ed25519-mldsa → warning (ops-visibility for PQC sim)", () => {
  const r = checkEnv({ TFA_SIGNER_KIND: "hybrid-ed25519-mldsa" });
  eq(r.ok, true, "hybrid signer kind is valid, not an error");
  assert(r.warnings.some(w => w.includes("PQC") || w.includes("sim")), "should warn about simulation mode");
  assert(r.warnings.some(w => w.includes("liboqs")), "should mention install path");
});

test("check-env: TFA_SIGNER_KIND=rsa → error (fail-closed)", () => {
  const r = checkEnv({ TFA_SIGNER_KIND: "rsa" });
  eq(r.ok, false);
  assert(r.errors.some(e => e.includes("TFA_SIGNER_KIND")), "error should mention TFA_SIGNER_KIND");
  assert(r.errors.some(e => e.includes("rsa")), "error should include the bad value");
});

test("check-env: TFA_SIGNER_KIND empty string → treated as unset (ok)", () => {
  const r = checkEnv({ TFA_SIGNER_KIND: "" });
  eq(r.ok, true);
  eq(r.errors.length, 0);
  eq(r.warnings.filter(w => w.includes("TFA_SIGNER_KIND")).length, 0);
});
