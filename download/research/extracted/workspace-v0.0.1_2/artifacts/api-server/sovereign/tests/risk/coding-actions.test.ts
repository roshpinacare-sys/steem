import "../_flush.mjs";
/**
 * tests/risk/coding-actions.test.ts — Coding-agent action taxonomy (v167)
 *
 * Coverage:
 *   completeness: every value in CODING_ACTION_TYPES has an entry in CODING_ACTION_RISK_MAP
 *   completeness: every value has an entry in CODING_ACTION_METADATA
 *   validity: every risk class value in the map is a valid ActionRiskClass
 *   fail-closed: unknown/empty/garbage action type → MOST_RESTRICTIVE_RISK_CLASS
 *   case-sensitivity: "file.DELETE" ≠ "file.delete" → fail-closed
 *   spot-checks: specific classifications match the documented rationale
 *     - irreversible: shell.exec, git.push_force, db.migration, db.drop, infra.apply, package.publish
 *     - write_destructive: file.delete, git.push, db.delete, env.write, ci.approve
 *     - privacy_sensitive: env.read
 *     - read_only: file.read, network.read, db.read, git.read, ci.read
 *   classifyActionServerSide:
 *     - known coding action → source: "coding_taxonomy"
 *     - known general action (ledger.mint) → source: "general_taxonomy"
 *     - unknown → source: "fail_closed_default", riskClass: MOST_RESTRICTIVE_RISK_CLASS
 *   isCodingAction: returns true for known, false for unknown
 *   server-side override: client riskClass "read_only" for shell.exec → overridden to "irreversible"
 */

import { test, eq, assert } from "../_harness.mjs";
import {
  CODING_ACTION_TYPES,
  CODING_ACTION_RISK_MAP,
  CODING_ACTION_METADATA,
  classifyCodingAction,
  isCodingAction,
  classifyActionServerSide,
} from "../../lib/risk/coding-actions.ts";
import { MOST_RESTRICTIVE_RISK_CLASS, RISK_CLASSES } from "../../lib/risk/action-risk.ts";

const VALID_RISK_CLASSES = new Set<string>(RISK_CLASSES as readonly string[]);

// ─── completeness ─────────────────────────────────────────────────────────────

test("completeness: every CODING_ACTION_TYPES value has an entry in CODING_ACTION_RISK_MAP", () => {
  const missing: string[] = [];
  for (const [name, value] of Object.entries(CODING_ACTION_TYPES)) {
    if (!(value in CODING_ACTION_RISK_MAP)) missing.push(`${name}=${value}`);
  }
  eq(missing.length, 0, `missing from CODING_ACTION_RISK_MAP: ${JSON.stringify(missing)}`);
});

test("completeness: every CODING_ACTION_TYPES value has an entry in CODING_ACTION_METADATA", () => {
  const missing: string[] = [];
  for (const [name, value] of Object.entries(CODING_ACTION_TYPES)) {
    if (!(value in CODING_ACTION_METADATA)) missing.push(`${name}=${value}`);
  }
  eq(missing.length, 0, `missing from CODING_ACTION_METADATA: ${JSON.stringify(missing)}`);
});

test("validity: every CODING_ACTION_RISK_MAP value is a valid ActionRiskClass (no typos)", () => {
  const invalid: string[] = [];
  for (const [actionType, riskClass] of Object.entries(CODING_ACTION_RISK_MAP)) {
    if (!VALID_RISK_CLASSES.has(riskClass)) invalid.push(`${actionType} → "${riskClass}"`);
  }
  eq(invalid.length, 0, `invalid risk classes: ${JSON.stringify(invalid)}`);
});

test("completeness: CODING_ACTION_RISK_MAP and CODING_ACTION_TYPES have the same count", () => {
  const typeCount = Object.keys(CODING_ACTION_TYPES).length;
  const mapCount  = Object.keys(CODING_ACTION_RISK_MAP).length;
  eq(typeCount, mapCount, `CODING_ACTION_TYPES has ${typeCount} entries but CODING_ACTION_RISK_MAP has ${mapCount}`);
});

// ─── fail-closed ──────────────────────────────────────────────────────────────

test("fail-closed: unknown action type → MOST_RESTRICTIVE_RISK_CLASS", () => {
  eq(classifyCodingAction("some.unknown.action"), MOST_RESTRICTIVE_RISK_CLASS);
  eq(classifyCodingAction("SHELL.EXEC"), MOST_RESTRICTIVE_RISK_CLASS); // case-sensitive
  eq(classifyCodingAction(""), MOST_RESTRICTIVE_RISK_CLASS);
  eq(classifyCodingAction("   "), MOST_RESTRICTIVE_RISK_CLASS); // Note: non-empty, but unknown type
});

test("fail-closed: never throws — for any string input", () => {
  const inputs = ["", "null", "undefined", "🔥", "a".repeat(10000), "file.read", "SHELL.exec"];
  for (const input of inputs) {
    let threw = false;
    try { classifyCodingAction(input); } catch { threw = true; }
    assert(!threw, `classifyCodingAction threw for ${JSON.stringify(input)}`);
  }
});

test("case-sensitivity: 'file.DELETE' is NOT the same as 'file.delete' → fail-closed", () => {
  eq(classifyCodingAction("file.delete"), "write_destructive");
  eq(classifyCodingAction("file.DELETE"), MOST_RESTRICTIVE_RISK_CLASS);
  eq(classifyCodingAction("FILE.DELETE"), MOST_RESTRICTIVE_RISK_CLASS);
});

// ─── spot-checks: irreversible ─────────────────────────────────────────────────

test("spot-check: shell.exec is irreversible (can do anything)", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.SHELL_EXEC), "irreversible");
});

test("spot-check: git.push_force is irreversible (rewrites remote history)", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.GIT_PUSH_FORCE), "irreversible");
});

test("spot-check: db.migration is irreversible (schema changes corrupt data)", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.DB_MIGRATION), "irreversible");
});

test("spot-check: db.drop is irreversible", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.DB_DROP), "irreversible");
});

test("spot-check: infra.apply is irreversible (can destroy prod)", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.INFRA_APPLY), "irreversible");
});

test("spot-check: package.publish is irreversible (public after 72h)", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.PACKAGE_PUBLISH), "irreversible");
});

test("spot-check: git.rebase is irreversible (destroys old SHAs)", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.GIT_REBASE), "irreversible");
});

// ─── spot-checks: write_destructive ────────────────────────────────────────────

test("spot-check: file.delete is write_destructive", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.DELETE_FILE), "write_destructive");
});

test("spot-check: git.push is write_destructive (public after push)", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.GIT_PUSH), "write_destructive");
});

test("spot-check: db.delete is write_destructive", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.DB_DELETE), "write_destructive");
});

test("spot-check: env.write is write_destructive (can inject malicious values)", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.ENV_WRITE), "write_destructive");
});

test("spot-check: ci.approve is write_destructive (sends to production)", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.CI_APPROVE), "write_destructive");
});

// ─── spot-checks: privacy_sensitive ────────────────────────────────────────────

test("spot-check: env.read is privacy_sensitive (can expose secrets)", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.ENV_READ), "privacy_sensitive");
});

// ─── spot-checks: read_only ───────────────────────────────────────────────────

test("spot-check: read-only actions — file.read, network.read, db.read, git.read, ci.read", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.READ_FILE), "read_only");
  eq(classifyCodingAction(CODING_ACTION_TYPES.NETWORK_READ), "read_only");
  eq(classifyCodingAction(CODING_ACTION_TYPES.DB_READ), "read_only");
  eq(classifyCodingAction(CODING_ACTION_TYPES.GIT_READ), "read_only");
  eq(classifyCodingAction(CODING_ACTION_TYPES.CI_READ), "read_only");
  eq(classifyCodingAction(CODING_ACTION_TYPES.PR_READ), "read_only");
  eq(classifyCodingAction(CODING_ACTION_TYPES.INFRA_READ), "read_only");
  eq(classifyCodingAction(CODING_ACTION_TYPES.PROCESS_READ), "read_only");
});

// ─── spot-checks: write_safe ─────────────────────────────────────────────────

test("spot-check: write_safe actions — file.create, git.commit, package.install, ci.trigger", () => {
  eq(classifyCodingAction(CODING_ACTION_TYPES.CREATE_FILE), "write_safe");
  eq(classifyCodingAction(CODING_ACTION_TYPES.GIT_COMMIT), "write_safe");
  eq(classifyCodingAction(CODING_ACTION_TYPES.PACKAGE_INSTALL), "write_safe");
  eq(classifyCodingAction(CODING_ACTION_TYPES.CI_TRIGGER), "write_safe");
  eq(classifyCodingAction(CODING_ACTION_TYPES.PR_WRITE), "write_safe");
  eq(classifyCodingAction(CODING_ACTION_TYPES.INFRA_CREATE), "write_safe");
});

// ─── isCodingAction ──────────────────────────────────────────────────────────

test("isCodingAction: true for known types, false for unknown", () => {
  assert(isCodingAction("shell.exec"), "shell.exec is a coding action");
  assert(isCodingAction("file.read"), "file.read is a coding action");
  assert(!isCodingAction("ledger.mint"), "ledger.mint is NOT a coding action");
  assert(!isCodingAction(""), "empty string is not a coding action");
  assert(!isCodingAction("unknown"), "unknown is not a coding action");
});

// ─── classifyActionServerSide ─────────────────────────────────────────────────

test("classifyActionServerSide: coding action → source=coding_taxonomy", () => {
  const r = classifyActionServerSide("shell.exec");
  eq(r.source, "coding_taxonomy");
  eq(r.riskClass, "irreversible");
});

test("classifyActionServerSide: known general action (ledger.mint) → source=general_taxonomy", () => {
  const r = classifyActionServerSide("ledger.mint");
  eq(r.source, "general_taxonomy");
  eq(r.riskClass, "value_moving");
});

test("classifyActionServerSide: unknown action → source=fail_closed_default, MOST_RESTRICTIVE", () => {
  const r = classifyActionServerSide("some.completely.unknown.thing");
  eq(r.source, "fail_closed_default");
  eq(r.riskClass, MOST_RESTRICTIVE_RISK_CLASS);
});

// ─── server-side override scenario ───────────────────────────────────────────

test("server-side override: client claims shell.exec is read_only → server overrides to irreversible", () => {
  // Simulate a client sending { riskClass: "read_only", toolId: "shell.exec" }
  const clientRiskClass = "read_only"; // client's claim
  const actionType = "shell.exec";     // the actual action type (from toolId)

  const { riskClass: serverRiskClass } = classifyActionServerSide(actionType);

  // Server should override client claim
  assert(serverRiskClass !== clientRiskClass,
    "server must not trust client's underclassified riskClass for shell.exec");
  eq(serverRiskClass, "irreversible",
    "shell.exec must always be irreversible regardless of client claim");
});

test("server-side override: client claims db.migration is write_safe → server overrides to irreversible", () => {
  const { riskClass } = classifyActionServerSide("db.migration");
  eq(riskClass, "irreversible");
});

// ─── metadata quality ────────────────────────────────────────────────────────

test("metadata: every entry has non-empty description and rationale", () => {
  for (const [actionType, meta] of Object.entries(CODING_ACTION_METADATA)) {
    assert(typeof meta.description === "string" && meta.description.length > 0,
      `${actionType} has empty description`);
    assert(typeof meta.rationale === "string" && meta.rationale.length > 0,
      `${actionType} has empty rationale`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DeFi-action taxonomy (M3 — v204)
// ═══════════════════════════════════════════════════════════════════════════════


test("DeFi taxonomy: token.swap exists with riskClass=value_moving", () => {
  eq(CODING_ACTION_TYPES.TOKEN_SWAP, "token.swap");
  eq(CODING_ACTION_RISK_MAP["token.swap"], "value_moving");
  assert(CODING_ACTION_METADATA["token.swap"].description.length > 0, "has description");
  assert(CODING_ACTION_METADATA["token.swap"].rationale.includes("value"), "rationale mentions value");
});

test("DeFi taxonomy: liquidity.provide exists with riskClass=irreversible", () => {
  eq(CODING_ACTION_TYPES.LIQUIDITY_PROVIDE, "liquidity.provide");
  eq(CODING_ACTION_RISK_MAP["liquidity.provide"], "irreversible");
  assert(CODING_ACTION_METADATA["liquidity.provide"].rationale.includes("impermanent"), "rationale mentions impermanent loss");
});

test("DeFi taxonomy: bridge.transfer exists with riskClass=irreversible", () => {
  eq(CODING_ACTION_TYPES.BRIDGE_TRANSFER, "bridge.transfer");
  eq(CODING_ACTION_RISK_MAP["bridge.transfer"], "irreversible");
  assert(CODING_ACTION_METADATA["bridge.transfer"].rationale.includes("irreversible"), "rationale mentions irreversible");
});

test("DeFi taxonomy: token.approve exists with riskClass=write_destructive", () => {
  eq(CODING_ACTION_TYPES.TOKEN_APPROVE, "token.approve");
  eq(CODING_ACTION_RISK_MAP["token.approve"], "write_destructive");
  assert(CODING_ACTION_METADATA["token.approve"].rationale.toLowerCase().includes("drain"), "rationale warns about drain risk");
});

test("DeFi taxonomy: classifyCodingAction overrides client-supplied read_only for token.swap → value_moving", () => {
  const r = classifyActionServerSide("token.swap");
  eq(r.riskClass, "value_moving");
  eq(r.source, "coding_taxonomy");
});

test("DeFi taxonomy: classifyCodingAction bridge.transfer → irreversible (server overrides any client claim)", () => {
  const r = classifyActionServerSide("bridge.transfer");
  eq(r.riskClass, "irreversible");
  eq(r.source, "coding_taxonomy");
});

test("DeFi taxonomy: classifyCodingAction token.approve → write_destructive", () => {
  const r = classifyActionServerSide("token.approve");
  eq(r.riskClass, "write_destructive");
  eq(r.source, "coding_taxonomy");
});

test("DeFi taxonomy: isCodingAction recognises all four DeFi types", () => {
  assert(isCodingAction("token.swap"),        "token.swap recognised");
  assert(isCodingAction("liquidity.provide"), "liquidity.provide recognised");
  assert(isCodingAction("bridge.transfer"),   "bridge.transfer recognised");
  assert(isCodingAction("token.approve"),     "token.approve recognised");
});

test("DeFi taxonomy: all four DeFi types have metadata entries", () => {
  const defiTypes = ["token.swap", "liquidity.provide", "bridge.transfer", "token.approve"];
  for (const t of defiTypes) {
    const meta = CODING_ACTION_METADATA[t as import("../../lib/risk/coding-actions.ts").CodingActionType];
    assert(meta?.description.length > 0, `${t}: description present`);
    assert(meta?.rationale.length > 0,   `${t}: rationale present`);
  }
});

test("DeFi taxonomy: fail-closed — unknown DeFi-sounding string not trusted → irreversible", () => {
  const r = classifyActionServerSide("token.drain");
  eq(r.riskClass, "irreversible");
  eq(r.source, "fail_closed_default");
});

test("DeFi taxonomy: coverage — CODING_ACTION_TYPES still fully covered in RISK_MAP (no orphans)", () => {
  const allTypes = Object.values(CODING_ACTION_TYPES);
  const inRiskMap = Object.keys(CODING_ACTION_RISK_MAP);
  for (const t of allTypes) {
    assert(inRiskMap.includes(t), `${t} missing from CODING_ACTION_RISK_MAP`);
  }
});

test("DeFi taxonomy: coverage — CODING_ACTION_TYPES still fully covered in METADATA (no orphans)", () => {
  const allTypes = Object.values(CODING_ACTION_TYPES);
  const inMeta = Object.keys(CODING_ACTION_METADATA);
  for (const t of allTypes) {
    assert(inMeta.includes(t), `${t} missing from CODING_ACTION_METADATA`);
  }
});

// ─── Set-based lookup efficiency ──────────────────────────────────────────────
// isCodingAction uses a precomputed Set (not per-call hasOwnProperty).
// These tests verify correctness across all three categories: known, unknown, edge.

test("efficiency/Set: isCodingAction returns true for every value in CODING_ACTION_TYPES", () => {
  const missing: string[] = [];
  for (const [, v] of Object.entries(CODING_ACTION_TYPES)) {
    if (!isCodingAction(v)) missing.push(v);
  }
  eq(missing.length, 0, `isCodingAction returned false for known types: ${JSON.stringify(missing)}`);
});

test("efficiency/Set: isCodingAction returns false for unknown strings", () => {
  for (const unknown of ["", "file", "FILE.DELETE", "file.delete.extra", "__proto__", "constructor"]) {
    assert(!isCodingAction(unknown), `isCodingAction should be false for "${unknown}"`);
  }
});

test("efficiency/Set: isCodingAction Set count matches CODING_ACTION_RISK_MAP key count", () => {
  // Ensures the precomputed Set was built from the full map with no omissions.
  const mapKeyCount = Object.keys(CODING_ACTION_RISK_MAP).length;
  let setHitCount = 0;
  for (const [, v] of Object.entries(CODING_ACTION_TYPES)) {
    if (isCodingAction(v)) setHitCount++;
  }
  // CODING_ACTION_TYPES drives the map; all its values should be in the Set.
  eq(setHitCount, Object.values(CODING_ACTION_TYPES).length,
    `Set hit count ${setHitCount} ≠ CODING_ACTION_TYPES length ${Object.values(CODING_ACTION_TYPES).length}`);
  assert(mapKeyCount >= setHitCount,
    `CODING_ACTION_RISK_MAP has ${mapKeyCount} keys but Set only hit ${setHitCount}`);
});
