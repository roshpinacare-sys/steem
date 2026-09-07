/**
 * receipt.test.ts — Verifiable Autonomy Receipts, end to end.
 *
 * The flagship test runs the REAL pipeline in-process (the --eval machinery),
 * then verifies the receipt it emitted — schema, signature, consistency, and
 * mutual chain anchoring — and proves the tamper matrix: each mutated field
 * trips its SPECIFIC check. Finally the dependency-free public verifier
 * (scripts/verify-receipt.mjs) is smoked on the same artifacts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  canonicalJson, sha256Hex, signReceipt, verifyReceipt, receiptSha256,
  type AutonomyReceipt,
} from "../src/services/receipt.js";

const checkByName = (r: { checks: { name: string; ok: boolean }[] }, name: string) =>
  r.checks.find((c) => c.name === name);

describe("canonicalJson", () => {
  it("is key-order independent and whitespace-free", () => {
    const a = { b: 1, a: { z: [1, 2, { y: "x" }], k: null } };
    const b = { a: { k: null, z: [1, 2, { y: "x" }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).not.toContain(" ");
  });

  it("drops undefined members", () => {
    expect(canonicalJson({ a: 1, gone: undefined })).toBe('{"a":1}');
  });
});

function fixtureReceipt(): AutonomyReceipt {
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
  };
}

describe("signature", () => {
  it("signs and verifies with the right key; rejects the wrong key", async () => {
    const signed = await signReceipt(fixtureReceipt(), "correct-horse");
    expect(signed.signature?.alg).toBe("HMAC-SHA256");

    const good = await verifyReceipt(signed, { key: "correct-horse" });
    expect(checkByName(good, "signature")?.ok).toBe(true);
    expect(good.valid).toBe(true);

    const bad = await verifyReceipt(signed, { key: "battery-staple" });
    expect(checkByName(bad, "signature")?.ok).toBe(false);
    expect(bad.valid).toBe(false);
  });

  it("treats unsigned receipts as chain-anchored-only, not invalid", async () => {
    const r = await verifyReceipt(fixtureReceipt(), {});
    expect(checkByName(r, "signature")?.ok).toBe(true);
    expect(r.valid).toBe(true);
  });
});

describe("consistency checks", () => {
  it("catches a gateOpen flag that contradicts the verdicts", async () => {
    const r = fixtureReceipt();
    r.controls.gates!.chaos = false; // still claims gateOpen: true
    const v = await verifyReceipt(r, {});
    expect(checkByName(v, "gates-consistent")?.ok).toBe(false);
    expect(v.valid).toBe(false);
  });

  it("catches spend above cap without the exceeded flag", async () => {
    const r = fixtureReceipt();
    r.controls.budget.spentCents = 900;
    const v = await verifyReceipt(r, {});
    expect(checkByName(v, "budget-consistent")?.ok).toBe(false);
  });
});

describe("end-to-end: real in-process run → receipt → verify → tamper matrix", () => {
  const savedEnv = { ...process.env };
  // ONE root for the whole describe: pipeline/helpers.ts freezes
  // WORKSPACE_ROOT at first import, so later env changes are ignored.
  // Consecutive runs share the chain — exactly like consecutive real runs.
  const root = mkdtempSync(join(tmpdir(), "qodo-receipt-"));
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.QODO_WORKSPACE_ROOT = root;
    process.env.QODO_RECEIPT_KEY = "test-receipt-key";
    delete process.env.OLLAMA_BASE_URL;
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    spy.mockRestore();
    process.env = { ...savedEnv };
    const { _resetEnvCache } = await import("../src/services/env-validator.js");
    const { _resetBudget } = await import("../src/services/budget-governor.js");
    _resetEnvCache();
    _resetBudget();
    vi.restoreAllMocks();
  });

  async function runOnce(): Promise<{ receipt: AutonomyReceipt; auditNdjson: string; receiptPath: string; auditPath: string }> {
    const { runEvalMode } = await import("../src/cli.js");
    const code = await runEvalMode(["node", "cli.js", "--eval", "--objective=Add a slug helper"]);
    expect(code).toBe(0);
    const receiptPath = join(root, "receipt.json");
    const auditPath = join(root, ".audit-log.ndjson");
    expect(existsSync(receiptPath)).toBe(true);
    return {
      receipt: JSON.parse(readFileSync(receiptPath, "utf8")) as AutonomyReceipt,
      auditNdjson: readFileSync(auditPath, "utf8"),
      receiptPath,
      auditPath,
    };
  }

  it("emits a signed receipt that passes EVERY check, then each tampering trips its check", async () => {
    const { receipt, auditNdjson, receiptPath, auditPath } = await runOnce();

    // Shape of a real run's evidence
    expect(receipt.schema).toBe("qodo.receipt/v1");
    expect(receipt.run.outcome).toBe("done");
    expect(receipt.controls.gates?.gateOpen).toBe(true);
    expect(receipt.subject.diffSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.subject.filesTouched.length).toBeGreaterThan(0);
    expect(receipt.signature?.alg).toBe("HMAC-SHA256");
    expect(receipt.evidence.chainValid).toBe(true);

    // Full verification: signature + chain + mutual anchor — all green.
    const full = await verifyReceipt(receipt, { key: "test-receipt-key", auditNdjson });
    expect(full.checks.map((c) => `${c.name}:${c.ok}`)).toEqual(
      expect.arrayContaining(["schema:true", "gates-consistent:true", "budget-consistent:true", "signature:true", "audit-chain:true", "chain-head:true", "receipt-issued:true"]),
    );
    expect(full.valid).toBe(true);

    // ── Tamper matrix ──
    // 1. Inflate spend → signature breaks (body changed).
    const t1 = structuredClone(receipt);
    t1.controls.budget.spentCents += 1;
    const v1 = await verifyReceipt(t1, { key: "test-receipt-key", auditNdjson });
    expect(checkByName(v1, "signature")?.ok).toBe(false);

    // 2. Flip a gate verdict → consistency breaks.
    const t2 = structuredClone(receipt);
    t2.controls.gates!.test = false;
    expect(checkByName(await verifyReceipt(t2, {}), "gates-consistent")?.ok).toBe(false);

    // 3. Point at a different chain head → chain-head breaks.
    const t3 = structuredClone(receipt);
    t3.evidence.auditHead.hash = "0".repeat(64);
    const v3 = await verifyReceipt(t3, { auditNdjson });
    expect(checkByName(v3, "chain-head")?.ok).toBe(false);

    // 4. Truncate the audit log's receipt-issued line → mutual anchor breaks
    //    (chain itself stays valid — that's exactly the attack this detects).
    const withoutIssued = auditNdjson.trim().split("\n").slice(0, -1).join("\n") + "\n";
    const v4 = await verifyReceipt(receipt, { auditNdjson: withoutIssued });
    expect(checkByName(v4, "audit-chain")?.ok).toBe(true);
    expect(checkByName(v4, "receipt-issued")?.ok).toBe(false);

    // 5. Corrupt a middle entry → the chain walk itself fails.
    const corrupted = auditNdjson.replace("run-started", "run-stArted");
    expect(checkByName(await verifyReceipt(receipt, { auditNdjson: corrupted }), "audit-chain")?.ok).toBe(false);

    // ── Public dependency-free verifier agrees on all of it ──
    const script = resolve(__dirname, "../../../scripts/verify-receipt.mjs");
    const ok = spawnSync("node", [script, receiptPath, "--audit", auditPath, "--key", "test-receipt-key"], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("RECEIPT VALID");

    const tamperedPath = join(root, "tampered.json");
    writeFileSync(tamperedPath, JSON.stringify(t1));
    const bad = spawnSync("node", [script, tamperedPath, "--audit", auditPath, "--key", "test-receipt-key"], { encoding: "utf8" });
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("RECEIPT INVALID");
  }, 60_000);

  it("records the exact receipt hash in the chain (mutual anchoring identity)", async () => {
    const { receipt, auditNdjson } = await runOnce();
    const self = await receiptSha256(receipt);
    const lines = auditNdjson.trim().split("\n");
    const issued = lines.map((l) => JSON.parse(l) as { event: string; payload?: { receiptSha256?: string } })
      .filter((e) => e.event === "receipt-issued");
    expect(issued.some((e) => e.payload?.receiptSha256 === self)).toBe(true);
  }, 60_000);
});

describe("sha256Hex dual-runtime", () => {
  it("matches a known vector", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
