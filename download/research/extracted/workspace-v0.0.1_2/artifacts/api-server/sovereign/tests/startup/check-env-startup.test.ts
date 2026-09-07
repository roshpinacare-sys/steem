import "../_flush.mjs";
/**
 * tests/startup/check-env-startup.test.ts — Integration tests for check-env
 * wired into startSovereignServer().
 *
 * Validates that:
 *  1. startSovereignServer() in normal conditions (port=0, no TFA_PERSIST=pg)
 *     starts cleanly without throwing.
 *  2. An invalid env (TFA_PERSIST=pg + no DB_URL) causes startSovereignServer
 *     to throw with a meaningful error message.
 *  3. TFA_ENV_CHECK_SKIP=1 bypasses the check entirely — useful for tests that
 *     need to start a server with a known-invalid env for other reasons.
 *  4. Warnings (non-fatal) do NOT abort startup.
 *  5. A good env (TFA_PERSIST=pg + valid DB_URL) passes validation, server starts.
 *  6. The thrown error message contains the env error detail.
 *  7. Server started cleanly closes without error.
 *
 * All tests use port=0 (OS-assigned) so they don't collide.
 * All env mutations are isolated: we save+restore process.env around each test.
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { checkEnv } from "../../scripts/check-env.mjs";

// ─── Helper: save/restore process.env around a callback ──────────────────────

function withEnv(overrides: Record<string, string | undefined>, fn: () => unknown): unknown {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) saved[k] = process.env[k];
  // Also save TFA_ENV_CHECK_SKIP since tests may alter it
  saved["TFA_ENV_CHECK_SKIP"] = process.env["TFA_ENV_CHECK_SKIP"];
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) { delete process.env[k]; }
      else { process.env[k] = v; }
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) { delete process.env[k]; }
      else { process.env[k] = v; }
    }
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("check-env startup: clean env → server starts without throwing", () => {
  let server: any = null;
  withEnv(
    { TFA_PERSIST: undefined, DB_URL: undefined, TFA_REQUIRE_API_KEY: undefined, PORT: undefined, TFA_ENV_CHECK_SKIP: undefined },
    () => {
      server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
    }
  );
  assert(server !== null, "server should be running");
  server.close();
});

test("check-env startup: TFA_PERSIST=pg + no DB_URL → throws with env error", () => {
  let threw = false;
  let errorMsg = "";
  withEnv(
    { TFA_PERSIST: "pg", DB_URL: undefined, TFA_ENV_CHECK_SKIP: undefined },
    () => {
      try {
        const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
        server.close(); // should not reach here
      } catch (e: any) {
        threw = true;
        errorMsg = e.message || "";
      }
    }
  );
  assert(threw, "should have thrown when TFA_PERSIST=pg and DB_URL missing");
  assert(errorMsg.includes("env error") || errorMsg.includes("DB_URL") || errorMsg.includes("startup aborted"),
    `error message should mention env problem, got: ${errorMsg}`);
});

test("check-env startup: TFA_ENV_CHECK_SKIP=1 bypasses env validation → server starts despite bad PORT env", () => {
  // TFA_ENV_CHECK_SKIP=1 skips the env check entirely.
  // We use PORT=bad-port as the "bad env" (checkEnv would reject it),
  // but pass port=0 to startSovereignServer itself so listen() works.
  // The point: with skip=1, even a bad PORT env doesn't abort startup.
  let server: any = null;
  withEnv(
    { PORT: "bad-port", TFA_PERSIST: undefined, DB_URL: undefined, TFA_ENV_CHECK_SKIP: "1" },
    () => {
      server = startSovereignServer(0, undefined, { requireIdempotencyKey: false }); // 0 passed directly → ignores PORT env
    }
  );
  assert(server !== null, "server should start when env check is skipped");
  server.close();
});

test("check-env startup: PORT=invalid (non-numeric) → throws with env error", () => {
  let threw = false;
  withEnv(
    { PORT: "not-a-port", TFA_PERSIST: undefined, DB_URL: undefined, TFA_ENV_CHECK_SKIP: undefined },
    () => {
      try {
        const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
        server.close();
      } catch (e: any) {
        threw = true;
      }
    }
  );
  assert(threw, "should throw on invalid PORT");
});

test("check-env startup: PORT=0 (reserved) → throws", () => {
  let threw = false;
  withEnv(
    { PORT: "0", TFA_PERSIST: undefined, DB_URL: undefined, TFA_ENV_CHECK_SKIP: undefined },
    () => {
      try {
        const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false }); // passes 0 to listen(), but env PORT=0 is invalid
        server.close();
      } catch {
        threw = true;
      }
    }
  );
  assert(threw, "PORT=0 is reserved and should fail validation");
});

test("check-env startup: PORT=65536 (out of range) → throws", () => {
  let threw = false;
  withEnv(
    { PORT: "65536", TFA_ENV_CHECK_SKIP: undefined },
    () => {
      try {
        const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
        server.close();
      } catch {
        threw = true;
      }
    }
  );
  assert(threw, "PORT=65536 is out of valid range");
});

test("check-env startup: TFA_PERSIST=pg + valid DB_URL → env check passes (composition may still fail without pool)", () => {
  // checkEnv validates the env variables. When TFA_PERSIST=pg + valid DB_URL,
  // the env check PASSES. However, buildSovereignStack still throws because no
  // real pool is injected — that's a separate composition concern, not an env error.
  // We verify the env check piece specifically by importing checkEnv directly.
  const { ok, errors } = checkEnv({
    TFA_PERSIST: "pg",
    DB_URL: "postgresql://user:pass@localhost:5432/tfa",
  } as any);
  eq(ok, true);
  eq(errors.length, 0);
});

test("check-env startup: TFA_PERSIST=memory → server starts (no DB_URL needed)", () => {
  let server: any = null;
  withEnv(
    { TFA_PERSIST: "memory", DB_URL: undefined, TFA_ENV_CHECK_SKIP: undefined },
    () => {
      server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
    }
  );
  assert(server !== null, "TFA_PERSIST=memory should start fine without DB_URL");
  server.close();
});

test("check-env startup: thrown error contains 'startup aborted'", () => {
  let errorMsg = "";
  withEnv(
    { TFA_PERSIST: "pg", DB_URL: undefined, TFA_ENV_CHECK_SKIP: undefined },
    () => {
      try { startSovereignServer(0, undefined, { requireIdempotencyKey: false }); } catch (e: any) { errorMsg = e.message || ""; }
    }
  );
  assert(errorMsg.includes("startup aborted"), `expected 'startup aborted' in: ${errorMsg}`);
});

test("check-env startup: server starts cleanly and is addressable after check passes", () => {
  let server: any = null;
  withEnv(
    { TFA_PERSIST: undefined, DB_URL: undefined, TFA_ENV_CHECK_SKIP: undefined },
    () => {
      server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
    }
  );
  const addr = server.address();
  assert(typeof addr === "object" && addr !== null, "server should have an address");
  assert(typeof (addr as any).port === "number", "server should have a numeric port");
  assert((addr as any).port > 0, "server port should be > 0");
  server.close();
});

test("check-env startup: TFA_REQUIRE_API_KEY=bad-value → warning only, server starts", () => {
  let server: any = null;
  withEnv(
    { TFA_REQUIRE_API_KEY: "yes-please", TFA_PERSIST: undefined, DB_URL: undefined, TFA_ENV_CHECK_SKIP: undefined },
    () => {
      // TFA_REQUIRE_API_KEY with bad value is a WARNING (not error) per check-env.mjs
      server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
    }
  );
  assert(server !== null, "non-fatal warning should not abort server startup");
  server.close();
});

test("check-env startup: DB_URL set without TFA_PERSIST=pg → warning only, server starts", () => {
  let server: any = null;
  withEnv(
    { DB_URL: "postgresql://user:pass@localhost/db", TFA_PERSIST: undefined, TFA_ENV_CHECK_SKIP: undefined },
    () => {
      server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
    }
  );
  assert(server !== null, "DB_URL without TFA_PERSIST=pg is a warning, not an error");
  server.close();
});

test("check-env startup: PORT=7700 (valid explicit) → server starts", () => {
  let server: any = null;
  withEnv(
    { PORT: "7700", TFA_PERSIST: undefined, DB_URL: undefined, TFA_ENV_CHECK_SKIP: undefined },
    () => {
      // We pass 0 to startSovereignServer to avoid binding on the actual 7700 port in CI
      server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
    }
  );
  assert(server !== null, "valid PORT=7700 passes env check");
  server.close();
});
