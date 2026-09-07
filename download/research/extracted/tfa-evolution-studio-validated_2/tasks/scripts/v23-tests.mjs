#!/usr/bin/env node
/**
 * TFA Evolution Studio v23 — Canonical Test Suite
 *
 * Exercises all V23 workstreams with static checks:
 *   1. Pattern Promoter — file-backed, conditions, failure taxonomy, bridge, retire
 *   2. Playbook Engine — fromPromotedPattern, mergePlaybooks, new defaults
 *   3. Sovereign Orchestrator — batch synthesis, selectWork, objection→evidence
 *   4. Batch Coordinator — semanticReconcile, ConflictResolutionHint, dependsOn
 *   5. Workflow Engine — stuck-job detection, static import, stepTimings
 *   6. Backlog Engine — applyPromotedPatternsToPrioritization, backlogFromTaxonomy
 *   7. Release Gate — "passed" fix, buildGateEvidence
 *   8. Self-Audit — lockfile_version_mismatch finding kind
 *   9. Types — V23 evidence node kinds present
 *  10. Version coherence — all identity fields agree on 23.0.0
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? ": " + detail : ""}`);
    failed++;
  }
}

function readFile(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return "";
  return fs.readFileSync(full, "utf-8");
}

function readJSON(rel) {
  try { return JSON.parse(readFile(rel)); } catch { return null; }
}

console.log("\nTFA Evolution Studio v23 — Canonical Test Suite");
console.log("=".repeat(56));

// ── 1. Pattern Promoter ────────────────────────────────────────────────────
console.log("\n[1] Pattern Promoter");
const promoter = readFile("src/lib/distillation/pattern-promoter.ts");
check("promote() exported", promoter.includes("export function promote("));
check("retirePattern() exported", promoter.includes("export function retirePattern("));
check("bridgeToRecipeStore() exported", promoter.includes("export function bridgeToRecipeStore("));
check("bridgeFailuresToRecipeStore() exported", promoter.includes("export function bridgeFailuresToRecipeStore("));
check("buildPrioritizationHints() exported", promoter.includes("export function buildPrioritizationHints("));
check("findMatchingPatterns() exported", promoter.includes("export function findMatchingPatterns("));
check("getFailureTaxonomy() exported", promoter.includes("export function getFailureTaxonomy("));
check("conditions field on PromotedPattern", promoter.includes("conditions: Record<string, unknown>"));
check("FailureTaxonomyEntry interface", promoter.includes("export interface FailureTaxonomyEntry"));
check("PrioritizationHint interface", promoter.includes("export interface PrioritizationHint"));
check("file-backed persistence (loadPromotedPatterns)", promoter.includes("function loadPromotedPatterns()"));
check("savePromotedPatterns persists to disk", promoter.includes("fs.writeFileSync(getPromotedPatternsFile()"));
check("failure taxonomy upsert", promoter.includes("function upsertFailureTaxonomy("));
check("clearPatternsForTest exported", promoter.includes("export function clearPatternsForTest("));

// ── 2. Playbook Engine ─────────────────────────────────────────────────────
console.log("\n[2] Playbook Engine");
const playbook = readFile("src/lib/distillation/playbook-engine.ts");
check("fromPromotedPattern() exported", playbook.includes("export function fromPromotedPattern("));
check("mergePlaybooks() exported", playbook.includes("export function mergePlaybooks("));
check("Distillation Cycle playbook", playbook.includes("Distillation Cycle"));
check("Evidence Gap Recovery playbook", playbook.includes("Evidence Gap Recovery"));
check("sourcePatternId field on Playbook", playbook.includes("sourcePatternId?:"));
check("4 default playbooks", (playbook.match(/id: "pb_/g) || []).length >= 4);

// ── 3. Sovereign Orchestrator ──────────────────────────────────────────────
console.log("\n[3] Sovereign Orchestrator");
const sovereign = readFile("src/lib/agents/sovereign-orchestrator.ts");
check("runSovereignBatch() exported", sovereign.includes("export async function runSovereignBatch("));
check("selectWork() exported", sovereign.includes("export function selectWork("));
check("requiredEvidenceFromObjections in SovereignRound", sovereign.includes("requiredEvidenceFromObjections:"));
check("objections converted to evidence requirements", sovereign.includes("evidence_for_objection_by_"));
check("evidenceFloor default raised to 3", sovereign.includes("evidenceFloor ?? 3"));
check("6 sovereign roles defined", ["architect","builder","critic","verifier","integrator","release-governor"].every(r => sovereign.includes(`"${r}"`)));
check("SovereignBatchReport interface", sovereign.includes("export interface SovereignBatchReport"));
check("batchSynthesis field on report", sovereign.includes("batchSynthesis:"));
check("PrioritizationHint imported for selectWork", sovereign.includes("PrioritizationHint"));
check("makeDeterministicVoice() exported", sovereign.includes("export function makeDeterministicVoice("));
check("batch_reconciled evidence emitted in batch", sovereign.includes('batch_reconciled'));
check("synthesis_loop_converged emitted", sovereign.includes('synthesis_loop_converged'));

// ── 4. Batch Coordinator ───────────────────────────────────────────────────
console.log("\n[4] Batch Coordinator");
const batch = readFile("src/lib/batch/batch-coordinator.ts");
check("semanticReconcile() exported", batch.includes("export function semanticReconcile("));
check("shallowReconcile() retained for compat", batch.includes("export function shallowReconcile("));
check("ConflictResolutionHint interface", batch.includes("export interface ConflictResolutionHint"));
check("resolutionHints in ReconcileResult", batch.includes("resolutionHints: ConflictResolutionHint[]"));
check("stopOnFirstGroupFailure option", batch.includes("stopOnFirstGroupFailure"));
check("dependsOn in BatchGroup", batch.includes("dependsOn?:"));
check("BatchSynthesisSummary interface", batch.includes("export interface BatchSynthesisSummary"));
check("earlyAbort field in summary", batch.includes("earlyAbort:"));
check("topological group ordering", batch.includes("completedGroupIds"));
check("inferResolutionHint for status fields", batch.includes("inferResolutionHint"));
check("same-value non-conflict logic", batch.includes("valueSet.size > 1"));

// ── 5. Workflow Engine ─────────────────────────────────────────────────────
console.log("\n[5] Workflow Engine");
const workflow = readFile("src/lib/workflow/workflow-engine.ts");
check("findStuckJobs() exported", workflow.includes("export function findStuckJobs("));
check("markStuckJobsAsInterrupted() exported", workflow.includes("export function markStuckJobsAsInterrupted("));
check("recoverInterruptedWorkflows calls markStuck", workflow.includes("markStuckJobsAsInterrupted(projectId"));
check("no dynamic import() in recoverInterrupted", !workflow.includes("await import("));
check("static import of durableGetInterruptedJobs", workflow.includes("durableGetInterruptedJobs,"));
check("stepTimings in WorkflowResult", workflow.includes("stepTimings: Record<string, number>"));
check("stuckThresholdMs parameter", workflow.includes("stuckThresholdMs"));
check("recoverStuck option", workflow.includes("recoverStuck"));

// ── 6. Backlog Engine ──────────────────────────────────────────────────────
console.log("\n[6] Backlog Engine");
const backlog = readFile("src/lib/control-plane/backlog-engine.ts");
check("applyPromotedPatternsToPrioritization() exported", backlog.includes("export function applyPromotedPatternsToPrioritization("));
check("backlogFromTaxonomy() exported", backlog.includes("export function backlogFromTaxonomy("));
check("buildPrioritizationHints imported", backlog.includes("buildPrioritizationHints"));
check("getTopFailureModes imported", backlog.includes("getTopFailureModes"));
check("confidence threshold 0.5", backlog.includes("0.5"));
check("failure-taxonomy tag applied", backlog.includes("[failure-taxonomy]"));

// ── 7. Release Gate ────────────────────────────────────────────────────────
console.log("\n[7] Release Gate");
const gate = readFile("src/lib/release/release-gate.ts");
check("uses 'passed' not 'pass' for status check", gate.includes('e.status === "passed"') && !gate.includes('e.status === "pass"'));
check("buildGateEvidence() exported", gate.includes("export function buildGateEvidence("));
check("release_gate_passed evidence kind", gate.includes('release_gate_passed'));
check("workflow_replayable in required list", gate.includes('"workflow_replayable"'));
check("synthesis_loop_converged in required list", gate.includes('"synthesis_loop_converged"'));
check("batch_reconciled in required list", gate.includes('"batch_reconciled"'));
check("self_audit_clean in required list", gate.includes('"self_audit_clean"'));
check("blockers + warnings in ReleaseGateResult", gate.includes("blockers:") && gate.includes("warnings:"));

// ── 8. Self-Audit ──────────────────────────────────────────────────────────
console.log("\n[8] Self-Audit");
const audit = readFile("src/lib/audit/self-audit.ts");
check("lockfile_version_mismatch finding kind", audit.includes('lockfile_version_mismatch'));
check("readLockfileVersion() function", audit.includes("function readLockfileVersion("));
check("lockfile check in runSelfAudit", audit.includes("lockVersion !== packageVersion"));
check("5 original finding kinds preserved", [
  "stale_version_marker","missing_release_notes","header_version_mismatch",
  "broken_local_import","current_marker_mismatch"
].every(k => audit.includes(k)));

// ── 9. Types ───────────────────────────────────────────────────────────────
console.log("\n[9] Types — V23 EvidenceNodeKind values");
const types = readFile("src/lib/types.ts");
const v23Kinds = [
  "pattern_promoted","failure_taxonomy_updated","prioritization_updated",
  "distillation_cycle_complete","batch_synthesis_complete",
  "sovereign_batch_converged","release_gate_passed","lockfile_version_verified"
];
for (const k of v23Kinds) {
  check(`kind '${k}' present`, types.includes(k));
}

// ── 10. Version coherence ─────────────────────────────────────────────────
console.log("\n[10] Version Coherence — all identity fields = 23.0.0");
const pkg = readJSON("package.json");
check("package.json version = 23.0.0", pkg?.version === "23.0.0");
const lock = readJSON("package-lock.json");
check("package-lock.json version = 23.0.0", lock?.version === "23.0.0");
const readme = readFile("README.md");
check("README heading = v23.0.0", readme.includes("# TFA Evolution Studio v23.0.0"));
check("README ← current points to 23.0.0", readme.includes("23.0.0") && readme.includes("\u2190 **current**"));
const releaseNotes = readFile("RELEASE_NOTES.md");
check("RELEASE_NOTES heading = v23.0.0", releaseNotes.includes("# TFA Evolution Studio v23.0.0"));
check("RELEASE_NOTES Version: 23.0.0", releaseNotes.includes("**Version:** 23.0.0"));
check("V23-RELEASE-NOTES.md exists", fs.existsSync(path.join(ROOT, "V23-RELEASE-NOTES.md")));
const sidebar = readFile("src/components/layout/Sidebar.tsx");
check("Sidebar label = Studio v23.0", sidebar.includes("Studio v23.0"));

// ── Summary ────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(56));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed`);
  process.exit(1);
} else {
  console.log("\n✅ All V23 checks passed");
  process.exit(0);
}
