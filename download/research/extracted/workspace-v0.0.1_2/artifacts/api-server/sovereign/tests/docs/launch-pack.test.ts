import "../_flush.mjs";
/**
 * tests/docs/launch-pack.test.ts
 *
 * Smoke test for the "Launch Pack" (roadmap item 15): README.md,
 * ARCHITECTURE.md, SECURITY.md, STATUS.md.
 *
 * This is a documentation task — there's no runtime behavior to exercise, so
 * the test verifies the contract that matters for a customer/investor reading
 * these files first:
 *   • all four files exist and are non-trivial in size
 *   • README links to the other three, and the linked files exist
 *   • each doc covers its required topics (by heading/keyword presence)
 *   • SECURITY.md's six core properties are all present
 *   • STATUS.md's audit numbers are internally consistent with MANIFEST.md
 *   • no doc claims a capability that contradicts fail-closed / tenant-isolation
 *     invariants (spot-check: SECURITY.md must not say "allow by default")
 *
 * Edge cases:
 *   • MANIFEST.md pass-count referenced by STATUS.md must actually appear in
 *     MANIFEST.md (prevents stale numbers).
 *   • TESTING.md (preserved old README) must still exist and describe the
 *     zero-dependency test kit — README.md no longer duplicates that content
 *     but must still link to it.
 *
 * Failure case:
 *   • If a required file is missing entirely, this test fails loudly (not
 *     cannotRun) — documentation presence is part of "done" for this cycle.
 */

import { test, eq, assert } from "../_harness.mjs";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const read = (name: string): string => readFileSync(join(root, name), "utf8");
const exists = (name: string): boolean => existsSync(join(root, name));

// ─── Existence ────────────────────────────────────────────────────────────────

test("LAUNCH PACK: README.md exists and is substantial", () => {
  assert(exists("README.md"), "README.md exists");
  const content = read("README.md");
  assert(content.length > 1000, "README.md is substantial (>1000 chars)");
});

test("LAUNCH PACK: ARCHITECTURE.md exists and is substantial", () => {
  assert(exists("ARCHITECTURE.md"), "ARCHITECTURE.md exists");
  const content = read("ARCHITECTURE.md");
  assert(content.length > 1000, "ARCHITECTURE.md is substantial (>1000 chars)");
});

test("LAUNCH PACK: SECURITY.md exists and is substantial", () => {
  assert(exists("SECURITY.md"), "SECURITY.md exists");
  const content = read("SECURITY.md");
  assert(content.length > 1000, "SECURITY.md is substantial (>1000 chars)");
});

test("LAUNCH PACK: STATUS.md exists and is a one-pager", () => {
  assert(exists("STATUS.md"), "STATUS.md exists");
  const content = read("STATUS.md");
  assert(content.length > 500, "STATUS.md has real content");
  // "one-pager" — keep it reasonably short (not a second README)
  assert(content.length < 8000, "STATUS.md stays one-page-ish (<8000 chars)");
});

test("LAUNCH PACK: TESTING.md preserved (old README content not lost)", () => {
  assert(exists("TESTING.md"), "TESTING.md exists (preserved test-kit docs)");
  const content = read("TESTING.md");
  assert(content.includes("ecos-audit"), "TESTING.md still documents the truth engine");
});

// ─── README cross-references ────────────────────────────────────────────────

test("LAUNCH PACK: README links to ARCHITECTURE, SECURITY, STATUS, TESTING, MANIFEST", () => {
  const readme = read("README.md");
  for (const target of ["ARCHITECTURE.md", "SECURITY.md", "STATUS.md", "TESTING.md", "MANIFEST.md"]) {
    assert(readme.includes(target), `README references ${target}`);
    assert(exists(target), `${target} actually exists on disk`);
  }
});

test("LAUNCH PACK: README references the truth engine command", () => {
  const readme = read("README.md");
  assert(readme.includes("ecos-audit.mjs"), "README mentions ecos-audit.mjs");
  assert(readme.includes("quickstart.mjs"), "README mentions quickstart.mjs");
});

// ─── README topic coverage ──────────────────────────────────────────────────

test("LAUNCH PACK: README covers the API surface and key endpoints", () => {
  const readme = read("README.md");
  for (const endpoint of ["/api/ledger/mint", "/api/escrow", "/api/marketplace", "/api/passport", "/api/tenants"]) {
    assert(readme.includes(endpoint), `README mentions ${endpoint}`);
  }
});

// ─── ARCHITECTURE topic coverage ────────────────────────────────────────────

test("LAUNCH PACK: ARCHITECTURE covers orchestrator, policy, ledger, escrow, marketplace, potential, passport", () => {
  const arch = read("ARCHITECTURE.md");
  for (const topic of [
    "TfaOrchestrator", "policy", "guardMint", "guardWithdraw", "escrow",
    "marketplace", "Potential Engine", "Passport", "tenant", "audit",
  ]) {
    assert(arch.toLowerCase().includes(topic.toLowerCase()), `ARCHITECTURE covers "${topic}"`);
  }
});

test("LAUNCH PACK: ARCHITECTURE describes both HTTP adapters", () => {
  const arch = read("ARCHITECTURE.md");
  assert(arch.includes("sovereign-server"), "mentions sovereign-server.ts (zero-dep)");
  assert(arch.includes("express-adapter"), "mentions express-adapter.ts (production)");
});

// ─── SECURITY: six core properties + threat model structure ────────────────

test("LAUNCH PACK: SECURITY documents fail-closed default", () => {
  const sec = read("SECURITY.md");
  assert(sec.toLowerCase().includes("fail-closed"), "mentions fail-closed");
  // Must NOT claim allow-by-default as the system's posture
  assert(!/system.*allow.*by default/i.test(sec), "does not claim allow-by-default as system posture");
});

test("LAUNCH PACK: SECURITY documents audit-chain tamper-evidence", () => {
  const sec = read("SECURITY.md");
  assert(sec.toLowerCase().includes("tamper-evident") || sec.toLowerCase().includes("hash-link"),
    "mentions tamper-evidence / hash-linking");
});

test("LAUNCH PACK: SECURITY documents tenant isolation as structural", () => {
  const sec = read("SECURITY.md");
  assert(sec.includes("TENANT_VIOLATION"), "mentions TENANT_VIOLATION");
  assert(sec.toLowerCase().includes("tenant isolation"), "mentions tenant isolation");
});

test("LAUNCH PACK: SECURITY documents ledger chokepoints", () => {
  const sec = read("SECURITY.md");
  assert(sec.includes("guardMint"), "mentions guardMint");
  assert(sec.includes("guardWithdraw"), "mentions guardWithdraw");
});

test("LAUNCH PACK: SECURITY documents BigInt money invariant", () => {
  const sec = read("SECURITY.md");
  assert(sec.toLowerCase().includes("bigint"), "mentions bigint");
});

test("LAUNCH PACK: SECURITY documents zero-dependency crypto with concrete algorithms", () => {
  const sec = read("SECURITY.md");
  for (const algo of ["scrypt", "HMAC-SHA256", "TOTP", "Ed25519", "node:crypto"]) {
    assert(sec.includes(algo), `SECURITY mentions ${algo}`);
  }
});

test("LAUNCH PACK: SECURITY has a key-management section", () => {
  const sec = read("SECURITY.md");
  assert(/key management/i.test(sec), "has a Key management section");
  assert(sec.includes("public-key"), "mentions the public-key verification endpoint");
});

test("LAUNCH PACK: SECURITY has an explicit threat model with in/out of scope", () => {
  const sec = read("SECURITY.md");
  assert(/threat model/i.test(sec), "has a Threat model section");
  assert(/out of scope/i.test(sec), "explicitly states what's out of scope");
  assert(sec.includes("TLS"), "out-of-scope section addresses TLS/transport security");
});

// ─── STATUS: numbers must match MANIFEST ────────────────────────────────────

test("LAUNCH PACK: STATUS pass-count is consistent with MANIFEST.md", () => {
  const status = read("STATUS.md");
  const manifest = read("MANIFEST.md");

  const m = status.match(/(\d+)\s*pass\s*\/\s*(\d+)\s*cannotRun\s*\/\s*(\d+)\s*realFail/);
  assert(m, "STATUS.md contains a pass/cannotRun/realFail line");

  const [, pass, cannotRun, realFail] = m!;
  // The same triple must appear somewhere in MANIFEST.md (current truth)
  const triple = `${pass} pass / ${cannotRun} cannotRun / ${realFail} realFail`;
  assert(manifest.includes(triple), `MANIFEST.md contains the same figure: "${triple}"`);

  // Quality gate: realFail must be documented honestly (not silently hidden).
  // Flaky harness artifacts are acceptable if explicitly noted; the test guards
  // against stale or invented numbers, not against the existence of flaky tests.
  assert(Number(realFail) >= 0, "realFail is a non-negative integer");
  assert(Number(pass) > 0, "pass count is positive");
});

test("LAUNCH PACK: STATUS references the current version consistently with MANIFEST header", () => {
  const status = read("STATUS.md");
  const manifest = read("MANIFEST.md");
  const manifestVersion = manifest.match(/MANIFEST קנוני \(v(\d+)\)/);
  assert(manifestVersion, "MANIFEST.md has a version header (vNNN)");
  assert(status.includes(`v${manifestVersion![1]}`), `STATUS.md references v${manifestVersion![1]}`);
});

// ─── STATUS: built/verified table structure ─────────────────────────────────

test("LAUNCH PACK: STATUS lists what's-built and what's-not-verified separately", () => {
  const status = read("STATUS.md");
  assert(/what's built/i.test(status) || /מה בוצע|מה נבנה/i.test(status), "has a built/verified section");
  assert(/not yet verified|לא אומת/i.test(status), "has a not-yet-verified section");
});

test("LAUNCH PACK: STATUS surfaces self-running verification commands", () => {
  const status = read("STATUS.md");
  assert(status.includes("ecos-audit.mjs"), "STATUS tells reader how to verify via ecos-audit");
  assert(status.includes("quickstart.mjs"), "STATUS references quickstart.mjs");
});
