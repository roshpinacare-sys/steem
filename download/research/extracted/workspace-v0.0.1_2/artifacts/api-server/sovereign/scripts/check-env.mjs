#!/usr/bin/env node
/**
 * scripts/check-env.mjs — Startup environment validation for TFA sovereign server.
 *
 * Run this before starting the server to catch misconfiguration early.
 * Can also be imported as a module: { checkEnv } returns { ok, warnings, errors }.
 *
 * Checks:
 *   TFA_PERSIST   — must be "pg" | "memory" | undefined (empty = memory).
 *                   If "pg": DB_URL must also be set.
 *   DB_URL        — required when TFA_PERSIST=pg. Must start with postgres:// or postgresql://.
 *                   Ignored (warn-only) if TFA_PERSIST != "pg".
 *   TFA_REQUIRE_API_KEY — must be "1" | "0" | undefined. Anything else → warning.
 *   PORT          — must be a valid integer 1–65535 if set. Default 7700.
 *
 * Exit codes (when run as a script):
 *   0 — all checks passed (errors.length === 0)
 *   1 — at least one error (misconfiguration that will cause server failure)
 *
 * Warnings are non-fatal but printed to stderr. Errors are fatal.
 *
 * Design: zero external dependencies, zero I/O (only process.env), testable.
 */

/**
 * @typedef {{ ok: boolean, warnings: string[], errors: string[] }} EnvCheckResult
 */

/**
 * Validate the current process.env against TFA requirements.
 * Pass a custom env object for testing without touching process.env.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: boolean, warnings: string[], errors: string[] }}
 */
export function checkEnv(env = process.env) {
  const errors = [];
  const warnings = [];

  // ── TFA_PERSIST ──────────────────────────────────────────────────────────────
  const persist = env["TFA_PERSIST"];
  const validPersist = [undefined, "", "pg", "memory"];

  if (persist !== undefined && persist !== "" && persist !== "pg" && persist !== "memory") {
    errors.push(
      `TFA_PERSIST="${persist}" is invalid. Allowed values: "pg" | "memory" | (unset = memory).`
    );
  }

  // ── DB_URL ───────────────────────────────────────────────────────────────────
  const dbUrl = env["DB_URL"];

  if (persist === "pg") {
    if (!dbUrl) {
      errors.push(
        `DB_URL is required when TFA_PERSIST=pg but it is not set.`
      );
    } else if (!dbUrl.startsWith("postgres://") && !dbUrl.startsWith("postgresql://")) {
      errors.push(
        `DB_URL="${redact(dbUrl)}" does not look like a PostgreSQL connection string ` +
        `(must start with postgres:// or postgresql://).`
      );
    }
  } else if (dbUrl && persist !== "pg") {
    // DB_URL is set but TFA_PERSIST is not "pg" — odd but not fatal.
    warnings.push(
      `DB_URL is set but TFA_PERSIST is not "pg" — DB_URL will be ignored. ` +
      `Set TFA_PERSIST=pg to enable PostgreSQL persistence.`
    );
  }

  // ── TFA_REQUIRE_API_KEY ───────────────────────────────────────────────────────
  const requireApiKey = env["TFA_REQUIRE_API_KEY"];

  if (requireApiKey !== undefined && requireApiKey !== "" &&
      requireApiKey !== "0" && requireApiKey !== "1") {
    warnings.push(
      `TFA_REQUIRE_API_KEY="${requireApiKey}" is not a recognised value. ` +
      `Use "1" to enable, "0" or (unset) to disable.`
    );
  }

  // ── PORT ─────────────────────────────────────────────────────────────────────
  const portStr = env["PORT"];

  if (portStr !== undefined && portStr !== "") {
    const port = Number(portStr);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(
        `PORT="${portStr}" is not a valid port number (must be integer 1–65535).`
      );
    }
  }

  // ── TFA_SIGNER_KIND ──────────────────────────────────────────────────────────
  const signerKind = env["TFA_SIGNER_KIND"];
  const VALID_SIGNER_KINDS = ["ed25519", "hmac", "hybrid-ed25519-mldsa"];

  if (signerKind !== undefined && signerKind !== "") {
    if (!VALID_SIGNER_KINDS.includes(signerKind)) {
      errors.push(
        `TFA_SIGNER_KIND="${signerKind}" is invalid. Allowed values: ${VALID_SIGNER_KINDS.map(k => JSON.stringify(k)).join(", ")}.`
      );
    } else if (signerKind === "hybrid-ed25519-mldsa") {
      warnings.push(
        `TFA_SIGNER_KIND="hybrid-ed25519-mldsa" is active. No real PQC provider is installed — ` +
        `the system will run in simulation mode (algorithm tagged "-sim"). ` +
        `Install a compiled ML-DSA-44 provider (e.g., @open-quantum-safe/liboqs) ` +
        `to remove this warning and achieve post-quantum security.`
      );
    }
  }

  return { ok: errors.length === 0, warnings, errors };
}

/**
 * Redact credentials from a URL for safe logging.
 * Replaces the password portion of postgres://user:pass@host/db → postgres://user:***@host/db
 * @param {string} url
 * @returns {string}
 */
function redact(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    // Not a parseable URL — redact the whole thing past the scheme
    const colonSlash = url.indexOf("://");
    return colonSlash >= 0 ? url.slice(0, colonSlash + 3) + "***" : "***";
  }
}

/**
 * Print a formatted env check report to stderr and exit with code 0 or 1.
 * Called when the script is run directly.
 */
function main() {
  const result = checkEnv();

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      process.stderr.write(`[check-env] WARN  ${w}\n`);
    }
  }

  if (result.errors.length > 0) {
    for (const e of result.errors) {
      process.stderr.write(`[check-env] ERROR ${e}\n`);
    }
    process.stderr.write(
      `[check-env] ❌  ${result.errors.length} error(s) found — server will not start correctly.\n`
    );
    process.exit(1);
  }

  // All good
  const persist = process.env["TFA_PERSIST"] || "memory";
  const port    = process.env["PORT"] || "7700";
  const apiKey  = process.env["TFA_REQUIRE_API_KEY"] === "1" ? "enabled" : "disabled";
  process.stdout.write(
    `[check-env] ✅  OK — persist=${persist}, port=${port}, requireApiKey=${apiKey}\n`
  );
  if (result.warnings.length > 0) {
    process.stdout.write(`[check-env]    ${result.warnings.length} warning(s) — see stderr.\n`);
  }
  process.exit(0);
}

// Run main only when executed as a script, not when imported as a module.
// Works for both `node scripts/check-env.mjs` and `import { checkEnv } from ...`.
const isMain =
  // ESM: import.meta.url matches the process entry point
  (typeof import.meta !== "undefined" &&
   typeof process !== "undefined" &&
   process.argv[1] &&
   (process.argv[1].endsWith("check-env.mjs") || process.argv[1].endsWith("check-env.ts")));

if (isMain) {
  main();
}
