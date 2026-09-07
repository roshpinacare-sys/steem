#!/usr/bin/env node
// scripts/verify-passport.mjs — standalone, zero-dependency Action Passport verifier.
//
// Goal: anyone (auditor, regulator, partner) can verify a TFA ActionPassport
// WITHOUT trusting our code base. This single file uses only `node:crypto`
// and `node:fs` — no imports from lib/, no npm packages.
//
// It recomputes:
//   1. the audit record's hash from its canonical fields
//   2. the passport body hash via the same canonicalStringify+SHA-256
// and verifies cryptographic signatures (HMAC-SHA256 or Ed25519) when keys
// are supplied.
//
// CLI:
//   node scripts/verify-passport.mjs <passport.json> [options]
//
// Options (all optional; verify-what-you-can):
//   --hmac-secret <utf8>         Secret for HmacSigner passport signatures.
//   --hmac-secret-file <path>    Read the secret from a file (raw bytes).
//   --public-key-file <path>     Ed25519 SPKI PEM for passport signature.
//   --audit-hmac-secret <utf8>             Secret for the audit record signature.
//   --audit-hmac-secret-file <path>
//   --audit-public-key-file <path>         Ed25519 SPKI PEM for audit signature.
//   --strict                     Treat skipped signature checks as failures.
//   --json                       Emit machine-readable JSON report.
//   --help, -h
//
// Exit codes: 0 = ok, 1 = verification failed, 2 = bad usage.
//
// Library mode: `import { verifyPassport, canonicalStringify } from "./verify-passport.mjs"`.

import { createHash, createHmac, timingSafeEqual, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";

// ─── Canonical JSON ──────────────────────────────────────────────────────────
// MUST match lib/passport/passport.ts exactly. Object keys sorted, arrays
// preserve order, primitives via JSON.stringify. No BigInts in passport body.
export function canonicalStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalStringify(value[k]),
  );
  return "{" + parts.join(",") + "}";
}

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ─── Audit-record hash (mirrors lib/orchestrator/audit.ts computeHash) ───────
function computeAuditHash(audit) {
  const data = [
    audit.id,
    audit.tenantId,
    audit.actionType,
    audit.outcome,
    audit.prevHash,
  ].join("|");
  return sha256Hex(data);
}

// ─── Signature verifiers ─────────────────────────────────────────────────────
function verifyHmac(data, signatureB64, secretBuf) {
  try {
    const expected = createHmac("sha256", secretBuf).update(data, "utf8").digest();
    const actual = Buffer.from(signatureB64, "base64");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function verifyEd25519(data, signatureB64, publicKeyPem) {
  try {
    return edVerify(
      null,
      Buffer.from(data, "utf8"),
      publicKeyPem,
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

// ─── Core verifier ───────────────────────────────────────────────────────────
/**
 * Verify an ActionPassport.
 *
 * @param {object} passport - Parsed passport JSON.
 * @param {object} [keys]
 *   - hmacSecret  (Buffer | string)  symmetric secret for passport signature
 *   - publicKey   (string)           Ed25519 SPKI PEM for passport signature
 *   - auditHmacSecret (Buffer|string)
 *   - auditPublicKey  (string)
 * @param {object} [opts]
 *   - strict (boolean) treat "skipped" sig checks as failures
 *
 * @returns {{ ok: boolean, checks: Array<{name: string, status: "pass"|"fail"|"skipped", message?: string}> }}
 */
export function verifyPassport(passport, keys = {}, opts = {}) {
  const checks = [];
  const addPass = (name) => checks.push({ name, status: "pass" });
  const addFail = (name, message) => checks.push({ name, status: "fail", message });
  const addSkip = (name, message) => checks.push({ name, status: "skipped", message });

  // ── shape ──────────────────────────────────────────────────────────────
  if (!passport || typeof passport !== "object") {
    addFail("shape", "passport is not an object");
    return { ok: false, checks };
  }
  if (passport.version !== "1") {
    addFail("shape.version", `unsupported version: ${passport.version}`);
    return { ok: false, checks };
  }
  const required = ["passportId", "issuedAt", "tenantId", "audit", "policyDecision", "algorithm", "hash", "signature"];
  for (const k of required) {
    if (passport[k] === undefined) {
      addFail("shape", `missing field: ${k}`);
      return { ok: false, checks };
    }
  }
  addPass("shape");

  // ── audit hash recomputation ───────────────────────────────────────────
  const audit = passport.audit;
  const expectedAuditHash = computeAuditHash(audit);
  if (expectedAuditHash !== audit.hash) {
    addFail("audit.hash", `recomputed ${expectedAuditHash} != ${audit.hash}`);
  } else {
    addPass("audit.hash");
  }

  // ── audit signature (optional) ─────────────────────────────────────────
  if (audit.signature) {
    if (keys.auditHmacSecret) {
      const secretBuf = Buffer.isBuffer(keys.auditHmacSecret)
        ? keys.auditHmacSecret
        : Buffer.from(keys.auditHmacSecret, "utf8");
      verifyHmac(audit.hash, audit.signature, secretBuf)
        ? addPass("audit.signature.hmac")
        : addFail("audit.signature.hmac", "HMAC verification failed");
    } else if (keys.auditPublicKey) {
      verifyEd25519(audit.hash, audit.signature, keys.auditPublicKey)
        ? addPass("audit.signature.ed25519")
        : addFail("audit.signature.ed25519", "Ed25519 verification failed");
    } else {
      addSkip("audit.signature", "no audit key provided");
    }
  } else {
    addSkip("audit.signature", "audit record was not signed");
  }

  // ── passport body hash recomputation ───────────────────────────────────
  // Body = everything except `hash` and `signature`.
  const { hash: _h, signature: _s, ...body } = passport;
  const expectedPassportHash = sha256Hex(canonicalStringify(body));
  if (expectedPassportHash !== passport.hash) {
    addFail("passport.hash", `recomputed ${expectedPassportHash} != ${passport.hash}`);
  } else {
    addPass("passport.hash");
  }

  // ── passport signature ─────────────────────────────────────────────────
  if (passport.algorithm === "hmac-sha256") {
    if (keys.hmacSecret) {
      const secretBuf = Buffer.isBuffer(keys.hmacSecret)
        ? keys.hmacSecret
        : Buffer.from(keys.hmacSecret, "utf8");
      verifyHmac(passport.hash, passport.signature, secretBuf)
        ? addPass("passport.signature.hmac")
        : addFail("passport.signature.hmac", "HMAC verification failed");
    } else {
      addSkip("passport.signature.hmac", "no --hmac-secret provided");
    }
  } else if (passport.algorithm === "ed25519") {
    if (keys.publicKey) {
      verifyEd25519(passport.hash, passport.signature, keys.publicKey)
        ? addPass("passport.signature.ed25519")
        : addFail("passport.signature.ed25519", "Ed25519 verification failed");
    } else {
      addSkip("passport.signature.ed25519", "no --public-key-file provided");
    }
  } else {
    addFail("passport.algorithm", `unknown algorithm: ${passport.algorithm}`);
  }

  const strict = !!opts.strict;
  const ok = checks.every((c) => c.status === "pass" || (!strict && c.status === "skipped"));
  return { ok, checks };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { args.help = true; continue; }
    if (a === "--strict") { args.strict = true; continue; }
    if (a === "--json") { args.json = true; continue; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`flag --${key} requires a value`);
      }
      args[key] = next;
      i++;
      continue;
    }
    args._.push(a);
  }
  return args;
}

function usage() {
  process.stderr.write(
    "Usage: node scripts/verify-passport.mjs <passport.json> [options]\n" +
    "  --hmac-secret <s> | --hmac-secret-file <p>\n" +
    "  --public-key-file <p>          (Ed25519 SPKI PEM)\n" +
    "  --audit-hmac-secret <s> | --audit-hmac-secret-file <p>\n" +
    "  --audit-public-key-file <p>\n" +
    "  --strict                       fail on skipped signature checks\n" +
    "  --json                         machine-readable output\n",
  );
}

function loadKeys(args) {
  const keys = {};
  if (args["hmac-secret"]) keys.hmacSecret = args["hmac-secret"];
  if (args["hmac-secret-file"]) keys.hmacSecret = readFileSync(args["hmac-secret-file"]);
  if (args["public-key-file"]) keys.publicKey = readFileSync(args["public-key-file"], "utf8");
  if (args["audit-hmac-secret"]) keys.auditHmacSecret = args["audit-hmac-secret"];
  if (args["audit-hmac-secret-file"]) keys.auditHmacSecret = readFileSync(args["audit-hmac-secret-file"]);
  if (args["audit-public-key-file"]) keys.auditPublicKey = readFileSync(args["audit-public-key-file"], "utf8");
  return keys;
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`error: ${e.message}\n`); usage(); process.exit(2); }

  if (args.help || args._.length === 0) { usage(); process.exit(args.help ? 0 : 2); }

  const passportPath = args._[0];
  let passport;
  try { passport = JSON.parse(readFileSync(passportPath, "utf8")); }
  catch (e) { process.stderr.write(`error: cannot read passport at ${passportPath}: ${e.message}\n`); process.exit(2); }

  const keys = loadKeys(args);
  const report = verifyPassport(passport, keys, { strict: !!args.strict });

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    for (const c of report.checks) {
      const sym = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "—";
      process.stdout.write(`  ${sym} ${c.name}${c.message ? ": " + c.message : ""}\n`);
    }
    process.stdout.write(`\nResult: ${report.ok ? "OK" : "FAILED"}\n`);
  }
  process.exit(report.ok ? 0 : 1);
}

// Run as CLI only when invoked directly.
const isMain = import.meta.url === `file://${process.argv[1]}` ||
               import.meta.url.endsWith(process.argv[1]);
if (isMain) main();
