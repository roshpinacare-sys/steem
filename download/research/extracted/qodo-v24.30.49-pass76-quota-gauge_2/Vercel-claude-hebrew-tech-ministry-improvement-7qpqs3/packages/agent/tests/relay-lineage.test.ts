/**
 * relay-lineage.test.ts — task-56: automatic parent-receipt pickup.
 *
 * NOTE ON EXECUTION: authored and hand-traced in a sandbox with no network
 * access (no node_modules, so vitest could not run against the TS
 * sources). The exact genesis-computation algorithm this module uses
 * (sha256 of canonicalJson(parentReceipt), via node:crypto directly) WAS
 * executed for real, standalone, in the same pass — see the pass-75 audit
 * note for the transcript, which cross-checks it byte-for-byte against
 * the value `services/receipt.ts`'s own `receiptSha256()` produces for an
 * identical fixture. Confirming THIS suite passes under real vitest is
 * still owed before merge.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { resolveRelayLineage, _resetRelayLineageCache, PARENT_RECEIPT_FILE } from "../src/pipeline/relay-lineage.js";
import { canonicalJson, type AutonomyReceipt } from "../src/services/receipt.js";
import { defaultGenesis } from "../src/services/audit-log.js";

function fixtureReceipt(overrides: Partial<AutonomyReceipt> = {}): AutonomyReceipt {
  return {
    schema: "qodo.receipt/v1",
    subject: { owner: "acme", repo: "widget", prNumber: 7, commitSha: "abc", diffSha256: "d".repeat(64), filesTouched: ["src/a.ts"] },
    run: { runId: "hop-1", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:01:00Z", durationMs: 60000, outcome: "done" },
    controls: {
      policy: { source: ".qodo/policy.yml", sha256: "e".repeat(64), autonomy: "full", approval: "auto", budgetCapCents: 500 },
      approval: { mode: "auto", decision: "approval-auto-override" },
      gates: { lockCheck: true, blast: true, dom: true, shadow: true, chaos: true, test: true, gateOpen: true },
      budget: { capCents: 500, spentCents: 12, exceeded: false },
      trust: { category: "feature", score: 61, canAutoMerge: false },
    },
    evidence: { auditHead: { seq: 9, hash: "f".repeat(64) }, auditEntries: 10, chainValid: true },
    ...overrides,
  };
}

describe("resolveRelayLineage", () => {
  beforeEach(() => _resetRelayLineageCache());
  afterEach(() => _resetRelayLineageCache());

  it("no parent-receipt file → unaffected standalone-run defaults", () => {
    const root = mkdtempSync(join(tmpdir(), "qodo-relay-"));
    const lineage = resolveRelayLineage(root);
    expect(lineage.genesis).toBe(defaultGenesis());
    expect(lineage.parentReceipt).toBeNull();
    expect(lineage.hopIndex).toBe(0);
  });

  it("a valid parent-receipt file → genesis is sha256(canonicalJson(parent)), hop index incremented", () => {
    const root = mkdtempSync(join(tmpdir(), "qodo-relay-"));
    const parent = fixtureReceipt();
    writeFileSync(join(root, PARENT_RECEIPT_FILE), JSON.stringify(parent));

    const lineage = resolveRelayLineage(root);
    const expected = createHash("sha256").update(canonicalJson(parent)).digest("hex");
    expect(lineage.genesis).toBe(expected);
    expect(lineage.parentReceipt).toEqual(parent);
    expect(lineage.hopIndex).toBe(1);
  });

  it("chains hopIndex across a parent that itself already carried lineage", () => {
    const root = mkdtempSync(join(tmpdir(), "qodo-relay-"));
    const parent = fixtureReceipt({ lineage: { hopIndex: 4, parentReceiptSha256: "c".repeat(64), genesis: "c".repeat(64) } });
    writeFileSync(join(root, PARENT_RECEIPT_FILE), JSON.stringify(parent));

    expect(resolveRelayLineage(root).hopIndex).toBe(5);
  });

  it("a present but corrupt parent-receipt file degrades to a fresh chain, never throws", () => {
    const root = mkdtempSync(join(tmpdir(), "qodo-relay-"));
    writeFileSync(join(root, PARENT_RECEIPT_FILE), "{ not: valid json");

    const lineage = resolveRelayLineage(root);
    expect(lineage.genesis).toBe(defaultGenesis());
    expect(lineage.parentReceipt).toBeNull();
  });

  it("caches across repeated calls until reset", () => {
    const root = mkdtempSync(join(tmpdir(), "qodo-relay-"));
    const first = resolveRelayLineage(root);
    // Write a parent AFTER the first (cached) call — should have no effect
    // until the cache is explicitly reset, matching WORKSPACE_ROOT's own
    // freeze-at-first-read contract in helpers.ts.
    writeFileSync(join(root, PARENT_RECEIPT_FILE), JSON.stringify(fixtureReceipt()));
    expect(resolveRelayLineage(root)).toBe(first);

    _resetRelayLineageCache();
    expect(resolveRelayLineage(root).parentReceipt).not.toBeNull();
  });
});
