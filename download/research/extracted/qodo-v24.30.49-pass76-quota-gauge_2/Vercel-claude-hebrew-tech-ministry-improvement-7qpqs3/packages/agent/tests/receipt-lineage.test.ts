/**
 * receipt-lineage.test.ts — cross-hop composability (task-55).
 *
 * A relay run hands a ZIP to the next hop as a stateless artifact. Before
 * this feature, every hop's audit chain started from the same all-zero
 * genesis, so nothing in the ZIP cryptographically proved which hop came
 * before which — a verifier at hop N had to TRUST hop N-1's claim about its
 * own history. `lineage` closes that gap: hop N's chain is seeded with
 * sha256(parent receipt), so the parent's actual bytes — not its say-so —
 * determine hop N's genesis. A verifier recomputes that hash itself.
 *
 * NOTE ON EXECUTION: this file was authored and hand-traced but could not be
 * run through `vitest` in the authoring sandbox (no network access to
 * `npm install`, so `node_modules` does not exist there). The exact
 * `canonicalJson`/`sha256` algorithm this test exercises WAS executed for
 * real, standalone, with node:crypto directly (bypassing the TS build) —
 * see the pass-74 audit note for the transcript — but that is not the same
 * as this suite passing under vitest. Run `npm test -w @qodo/agent` before
 * merging to confirm it does.
 */
import { describe, it, expect } from "vitest";
import { verifyReceipt, receiptSha256, type AutonomyReceipt } from "../src/services/receipt.js";
import { appendAuditEntry, defaultGenesis } from "../src/services/audit-log.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const checkByName = (r: { checks: { name: string; ok: boolean }[] }, name: string) =>
  r.checks.find((c) => c.name === name);

function fixtureReceipt(overrides: Partial<AutonomyReceipt> = {}): AutonomyReceipt {
  return {
    schema: "qodo.receipt/v1",
    subject: { owner: "acme", repo: "widget", prNumber: 7, commitSha: "abc", diffSha256: "d".repeat(64), filesTouched: ["src/a.ts"] },
    run: { runId: "pr-7-1", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:01:00Z", durationMs: 60000, outcome: "done" },
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

describe("audit-log genesis override (backward compatibility)", () => {
  it("defaultGenesis() is the same all-zero value the chain always used", () => {
    expect(defaultGenesis()).toBe("0".repeat(64));
  });

  it("omitting genesis reproduces the exact prior first-entry prevHash", () => {
    const root = mkdtempSync(join(tmpdir(), "qodo-lineage-"));
    const entry = appendAuditEntry(root, "run-started", "qodo-agent", {});
    expect(entry.prevHash).toBe("0".repeat(64));
  });

  it("an explicit genesis seeds the first entry's prevHash instead", () => {
    const root = mkdtempSync(join(tmpdir(), "qodo-lineage-"));
    const parentHash = "a".repeat(64);
    const entry = appendAuditEntry(root, "run-started", "qodo-agent", {}, parentHash);
    expect(entry.prevHash).toBe(parentHash);
  });
});

describe("receipt lineage", () => {
  it("a receipt with no lineage block behaves exactly as before", async () => {
    const r = fixtureReceipt();
    const v = await verifyReceipt(r, {});
    expect(checkByName(v, "lineage")).toBeUndefined();
    expect(v.valid).toBe(true);
  });

  it("verifies an honest hop-2 receipt against its real parent", async () => {
    const parent = fixtureReceipt({ run: { runId: "hop-1", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:01:00Z", durationMs: 60000, outcome: "done" } });
    const parentHash = await receiptSha256(parent);

    const child = fixtureReceipt({
      run: { runId: "hop-2", startedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:01:00Z", durationMs: 30000, outcome: "done" },
      lineage: { hopIndex: 1, parentReceiptSha256: parentHash, genesis: parentHash },
    });

    const v = await verifyReceipt(child, { parentReceipt: parent });
    expect(checkByName(v, "lineage")?.ok).toBe(true);
    expect(v.valid).toBe(true);
  });

  it("catches a hop-2 receipt whose lineage does not match the ACTUAL parent bytes", async () => {
    const parent = fixtureReceipt({ run: { runId: "hop-1", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:01:00Z", durationMs: 60000, outcome: "done" } });
    const tamperedParent = structuredClone(parent);
    tamperedParent.controls.budget.spentCents = 99999; // parent was edited after handoff

    const realParentHash = await receiptSha256(parent);
    const child = fixtureReceipt({
      run: { runId: "hop-2", startedAt: "2026-01-02T00:00:00Z", finishedAt: "2026-01-02T00:01:00Z", durationMs: 30000, outcome: "done" },
      lineage: { hopIndex: 1, parentReceiptSha256: realParentHash, genesis: realParentHash },
    });

    // Verifier only has the (silently edited) parent on disk, recomputes its
    // hash independently, and it no longer matches the claimed lineage.
    const v = await verifyReceipt(child, { parentReceipt: tamperedParent });
    expect(checkByName(v, "lineage")?.ok).toBe(false);
    expect(v.valid).toBe(false);
  });

  it("without a supplied parent, lineage is informational, not invalid", async () => {
    const child = fixtureReceipt({ lineage: { hopIndex: 3, parentReceiptSha256: "b".repeat(64), genesis: "b".repeat(64) } });
    const v = await verifyReceipt(child, {});
    expect(checkByName(v, "lineage")?.ok).toBe(true);
    expect(v.valid).toBe(true);
  });

  it("flags a parent supplied for a receipt that claims no lineage at all", async () => {
    const parent = fixtureReceipt();
    const child = fixtureReceipt(); // no lineage block
    const v = await verifyReceipt(child, { parentReceipt: parent });
    expect(checkByName(v, "lineage")?.ok).toBe(false);
  });
});
