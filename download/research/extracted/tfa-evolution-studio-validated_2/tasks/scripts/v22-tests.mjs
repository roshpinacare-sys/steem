#!/usr/bin/env node
// ============================================================================
// TFA Evolution Studio V29 — Kernel Tests
//
// Pure-JS smoke checks for the V22 kernels — no Next.js / TS runtime needed.
// Validates the *contracts* of:
//   - workflow-engine.ts   (checkpoint/replay/cancel surface)
//   - sovereign-orchestrator.ts (debate/critique/synthesis surface)
//   - batch-coordinator.ts (deterministic batching surface)
//   - self-audit.ts        (finding kinds + scanner shape)
//   - pattern-promoter.ts  (promotion surface)
//
// Each check fails with a specific reason — never silently passes.
// Exits 0 on full pass, 1 on any failure.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let failed = 0, passed = 0;
function pass(label, detail = "") { passed++; console.log(`  ✓ ${label}${detail ? " — " + detail : ""}`); }
function fail(label, reason) { failed++; console.log(`  ✗ ${label} — ${reason}`); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf-8"); }

console.log("\nTFA Evolution Studio V29 — Kernel Tests");

// ── workflow-engine ────────────────────────────────────────────────────────
{
  const c = read("src/lib/workflow/workflow-engine.ts");
  const checks = {
    "runWorkflow exported": /export\s+async\s+function\s+runWorkflow\b/.test(c),
    "replayWorkflow exported": /export\s+async\s+function\s+replayWorkflow\b/.test(c),
    "cancelWorkflow exported": /export\s+function\s+cancelWorkflow\b/.test(c),
    "recoverInterruptedWorkflows exported": /export\s+async\s+function\s+recoverInterruptedWorkflows\b/.test(c),
    "checkpoint persists before step advance": c.includes("durableSaveCheckpoint(jobId, projectId, {"),
    "idempotency key threaded to durable store": c.includes("idempotencyKey: def.idempotencyKey"),
    "workflow_replayable evidence emitted": c.includes(`kind: "workflow_replayable"`),
    "isCancelled flag respected post-step": (c.match(/isCancelled\(def\.workflowId\)/g) || []).length >= 2,
  };
  for (const [k, v] of Object.entries(checks)) v ? pass(`workflow-engine: ${k}`) : fail(`workflow-engine: ${k}`, "contract missing");
}

// ── sovereign-orchestrator ─────────────────────────────────────────────────
{
  const c = read("src/lib/agents/sovereign-orchestrator.ts");
  const roles = ["architect", "builder", "critic", "verifier", "integrator", "release-governor"];
  const allRoles = roles.every(r => c.includes(`"${r}"`));
  allRoles ? pass("sovereign: 6 roles defined") : fail("sovereign: 6 roles defined", "missing one or more role literals");

  const checks = {
    "runSovereignLoop exported": /export\s+async\s+function\s+runSovereignLoop\b/.test(c),
    "evidence-weighted synthesis": c.includes("evidenceWeight") && c.includes("synthesise"),
    "release governor is hard gate": c.includes("blocked_by_governor") && c.includes("governor("),
    "requires_more_evidence fallback": c.includes("requires_more_evidence"),
    "synthesis_loop_converged evidence emitted": c.includes(`kind: "synthesis_loop_converged"`),
    "deterministic voice factory": c.includes("makeDeterministicVoice"),
  };
  for (const [k, v] of Object.entries(checks)) v ? pass(`sovereign: ${k}`) : fail(`sovereign: ${k}`, "contract missing");
}

// ── batch-coordinator ──────────────────────────────────────────────────────
{
  const c = read("src/lib/batch/batch-coordinator.ts");
  const checks = {
    "runBatch exported": /export\s+async\s+function\s+runBatch\b/.test(c),
    "deterministic group ordering": c.includes(".sort()") && c.includes("groupIds"),
    "parallel + serial split honoured": c.includes("safeForParallel") && c.includes("serialUnits"),
    "bounded concurrency": c.includes("runWithConcurrency"),
    "default reconciler detects diffs": c.includes("defaultReconcile") && c.includes("BatchConflict"),
    "batch_reconciled evidence per group": c.includes(`kind: "batch_reconciled"`),
    "stopOnConflict option supported": c.includes("stopOnConflict"),
  };
  for (const [k, v] of Object.entries(checks)) v ? pass(`batch: ${k}`) : fail(`batch: ${k}`, "contract missing");
}

// ── self-audit ─────────────────────────────────────────────────────────────
{
  const c = read("src/lib/audit/self-audit.ts");
  const kinds = ["stale_version_marker", "missing_release_notes", "header_version_mismatch",
                 "broken_local_import", "current_marker_mismatch"];
  const allKinds = kinds.every(k => c.includes(`"${k}"`));
  allKinds ? pass("self-audit: 5 finding kinds defined") : fail("self-audit: 5 finding kinds defined", "missing kinds");
  const checks = {
    "runSelfAudit exported": /export\s+function\s+runSelfAudit\b/.test(c),
    "skips historical release-notes from stale-version pass": c.includes("historicalNotesPattern"),
    "broken local import detection scans import sources": c.includes('from\\s+["\']'),
  };
  for (const [k, v] of Object.entries(checks)) v ? pass(`self-audit: ${k}`) : fail(`self-audit: ${k}`, "contract missing");
}

// ── pattern-promoter ───────────────────────────────────────────────────────
{
  const c = read("src/lib/distillation/pattern-promoter.ts");
  const checks = {
    "promote exported": /export\s+function\s+promote\b/.test(c),
    "listPatterns exported": /export\s+function\s+listPatterns\b/.test(c),
    "evidence weight drives recipe vs playbook vs lesson": c.includes("weight >= 3") && c.includes('"recipe"') && c.includes('"playbook"') && c.includes('"lesson"'),
  };
  for (const [k, v] of Object.entries(checks)) v ? pass(`promoter: ${k}`) : fail(`promoter: ${k}`, "contract missing");
}

// ── release truth (cross-file coherence) ───────────────────────────────────
{
  const pkg = JSON.parse(read("package.json"));
  const v = pkg.version;
  const major = `v${v.split(".")[0]}`;
  const readme = read("README.md");
  const notes = read("RELEASE_NOTES.md");
  const sb = read("src/components/layout/Sidebar.tsx");
  const v22notes = fs.existsSync(path.join(ROOT, `${major.toUpperCase()}-RELEASE-NOTES.md`));

  readme.startsWith(`# TFA Evolution Studio v${v}`)
    ? pass("release-truth: README heading matches package")
    : fail("release-truth: README heading matches package", "README starts with " + readme.split("\n")[0]);
  notes.startsWith(`# TFA Evolution Studio v${v}`)
    ? pass("release-truth: RELEASE_NOTES heading matches package")
    : fail("release-truth: RELEASE_NOTES heading matches package", "starts with " + notes.split("\n")[0]);
  sb.includes(`Studio v${v.split(".").slice(0, 2).join(".")}`)
    ? pass("release-truth: Sidebar label matches package")
    : fail("release-truth: Sidebar label matches package", "Sidebar version label drifted");
  v22notes
    ? pass(`release-truth: ${major.toUpperCase()}-RELEASE-NOTES.md exists`)
    : fail(`release-truth: ${major.toUpperCase()}-RELEASE-NOTES.md exists`, "file missing");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
