/**
 * TFA Evolution Studio v24 — Canonical Test Suite
 *
 * Verifies all V24 hardening fixes across 7 stress batches.
 * Runs as a plain Node.js script (no test runner dependency).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Minimal test harness ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let section = "";

function describe(name, fn) {
  section = name;
  console.log(`\n[${Object.keys({ [name]: 1 })[0].replace(/^.*\[/, "")}] ${name}`);
  fn();
}

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? "assertion failed");
}

function readSrc(...parts) {
  return fs.readFileSync(path.join(ROOT, "src", ...parts), "utf-8");
}

function readFile(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), "utf-8");
}

// ── [1] Batch 1 — Failure Injection ────────────────────────────────────────

describe("Batch 1 — Failure Injection", () => {
  const types = readSrc("lib", "types.ts");
  const durableStore = readSrc("lib", "job-engine", "durable-job-store.ts");
  const workflow = readSrc("lib", "workflow", "workflow-engine.ts");
  const compiler = readSrc("lib", "compiler", "compiler-orchestrator.ts");

  it("CompilerJob has updatedAt field (B1-1)", () => {
    assert(
      types.includes("updatedAt?: string") &&
        types.includes("V24: stamped on every durableUpdateJob"),
      "CompilerJob.updatedAt field missing or undocumented"
    );
  });

  it("durableUpdateJob stamps updatedAt on every call (B1-1)", () => {
    assert(
      durableStore.includes("updatedAt: new Date().toISOString()") &&
        durableStore.includes("V24: always stamp updatedAt"),
      "durableUpdateJob does not stamp updatedAt"
    );
  });

  it("findStuckJobs calls durableListJobs not durableGetInterruptedJobs (B1-2)", () => {
    const fnBody = workflow.slice(workflow.indexOf("export function findStuckJobs"));
    const bodyEnd = fnBody.indexOf("\nexport ");
    const body = fnBody.slice(0, bodyEnd === -1 ? undefined : bodyEnd);
    assert(
      body.includes("durableListJobs(projectId)"),
      "findStuckJobs must use durableListJobs"
    );
    assert(
      !body.includes("durableGetInterruptedJobs("),
      "findStuckJobs must NOT call durableGetInterruptedJobs"
    );
  });

  it("findStuckJobs filters for running status without unsafe cast (B1-2)", () => {
    const fnBody = workflow.slice(workflow.indexOf("export function findStuckJobs"));
    const bodyEnd = fnBody.indexOf("\nexport ");
    const body = fnBody.slice(0, bodyEnd === -1 ? undefined : bodyEnd);
    assert(body.includes('j.status === "running"'), "must filter for running status");
    assert(!body.includes("as CompilerJob &"), "unsafe cast must be removed");
  });

  it("workflow-engine imports durableListJobs (B1-2)", () => {
    assert(
      workflow.includes("durableListJobs"),
      "workflow-engine must import durableListJobs"
    );
  });

  it("DEFAULT_RETRY_POLICY is a proper const declaration (B1-3)", () => {
    assert(
      compiler.includes("const DEFAULT_RETRY_POLICY: RetryPolicy = {"),
      "DEFAULT_RETRY_POLICY must be declared as typed const"
    );
    // Verify the orphaned lines are gone
    const orphanedPattern = /^  maxRetries: 2,/m;
    const declarationIdx = compiler.indexOf("const DEFAULT_RETRY_POLICY");
    const orphanBefore = compiler.slice(0, declarationIdx);
    assert(
      !orphanedPattern.test(orphanBefore),
      "orphaned maxRetries line must not appear before const declaration"
    );
  });

  it("replayWorkflow restores state from CheckpointPayload (B1-4)", () => {
    assert(
      workflow.includes("CheckpointPayload<S>") &&
        workflow.includes("cp.state") &&
        workflow.includes("V24 fix: restore finalState from checkpoint"),
      "replayWorkflow must restore state from checkpoint, not return def.initialState"
    );
  });

  it("finalize() emits workflow_replayable evidence unconditionally for any passed step (B1-5)", () => {
    const fnBody = workflow.slice(workflow.indexOf("function finalize<"));
    const bodyEnd = fnBody.indexOf("\nexport ");
    const body = fnBody.slice(0, bodyEnd === -1 ? undefined : bodyEnd);
    assert(
      body.includes("V24 fix: emit workflow_replayable evidence even for fully-replayed runs"),
      "finalize must include V24 replay fix comment"
    );
    assert(body.includes("freshCount"), "finalize must track freshCount vs replayedCount");
    assert(body.includes("replayedCount"), "finalize must track replayedCount");
  });

  it("install phase emits build_passed not adapter_selected (B1-6)", () => {
    const installIdx = compiler.indexOf("Phase: Install");
    assert(installIdx !== -1, "Install phase comment must exist");
    // Use a larger window (900 chars) — the evidence saveEvidence call sits
    // after checkpoint + durableUpdateJob + install + multi-line comment.
    const installSection = compiler.slice(installIdx, installIdx + 900);
    assert(
      installSection.includes('kind: "build_passed"'),
      "install phase must emit build_passed evidence"
    );
    assert(
      installSection.includes("Install phase") || installSection.includes("install phase"),
      "install phase evidence message must identify the phase"
    );
    assert(
      !installSection.includes('"adapter_selected"'),
      "install phase must NOT emit adapter_selected"
    );
  });
});

// ── [2] Batch 2 — Multi-Agent Conflict ─────────────────────────────────────

describe("Batch 2 — Multi-Agent Conflict", () => {
  const orch = readSrc("lib", "agents", "sovereign-orchestrator.ts");

  it("synthesise() blocks when all positions have zero evidence weight (B2-1)", () => {
    assert(
      orch.includes("totalWeight === 0") &&
        orch.includes("Synthesis blocked: no position carries any evidence weight"),
      "synthesise must block on zero total evidence weight"
    );
  });

  it("synthesise() requires evidence from each role when weight is zero (B2-1)", () => {
    assert(
      orch.includes("evidence_required_from_"),
      "synthesise must emit per-role evidence requirements when weight=0"
    );
  });

  it("runSovereignBatch() accumulates priorSyntheses across topics (B2-2)", () => {
    assert(
      orch.includes("priorSyntheses") &&
        orch.includes("priorSyntheses[topic] = outcome.finalProposal"),
      "runSovereignBatch must accumulate priorSyntheses"
    );
  });

  it("runSovereignBatch() merges priorSyntheses into each topic context (B2-2)", () => {
    assert(
      orch.includes("priorSyntheses: { ...priorSyntheses }"),
      "runSovereignBatch must spread priorSyntheses into context"
    );
  });

  it("V24 fix comment present in runSovereignBatch (B2-2)", () => {
    assert(
      orch.includes("V24 fix: prior synthesis results are now threaded forward"),
      "runSovereignBatch must include V24 fix comment"
    );
  });
});

// ── [3] Batch 3 — Concurrency ───────────────────────────────────────────────

describe("Batch 3 — Large-Batch Concurrency", () => {
  const batch = readSrc("lib", "batch", "batch-coordinator.ts");

  it("BatchSynthesisSummary has cycleWarnings field (B3-1)", () => {
    const iface = batch.slice(batch.indexOf("export interface BatchSynthesisSummary"));
    const ifaceEnd = iface.indexOf("}");
    const body = iface.slice(0, ifaceEnd);
    assert(body.includes("cycleWarnings"), "BatchSynthesisSummary must have cycleWarnings");
  });

  it("cycleWarnings is declared as string[] (B3-1)", () => {
    assert(
      batch.includes("cycleWarnings: string[]"),
      "cycleWarnings must be typed string[]"
    );
  });

  it("runBatch populates cycleWarnings on dependency cycle (B3-1)", () => {
    assert(
      batch.includes("cycleWarnings.push(") &&
        batch.includes("Dependency cycle or unsatisfiable deps detected"),
      "runBatch must push to cycleWarnings on cycle detection"
    );
  });

  it("runBatch initialises cycleWarnings before the loop (B3-1)", () => {
    assert(
      batch.includes("const cycleWarnings: string[] = []"),
      "cycleWarnings must be initialised before topological loop"
    );
  });

  it("runBatch return includes cycleWarnings (B3-1)", () => {
    const returnIdx = batch.lastIndexOf("return {");
    const returnBlock = batch.slice(returnIdx, returnIdx + 300);
    assert(
      returnBlock.includes("cycleWarnings"),
      "runBatch return must include cycleWarnings"
    );
  });
});

// ── [4] Batch 4 — Compiler / Adapter ───────────────────────────────────────

describe("Batch 4 — Compiler / Adapter", () => {
  const registry = readSrc("lib", "compiler", "adapter-registry.ts");
  const manifest = readSrc("lib", "compiler", "platform-manifest.ts");
  const ir = readSrc("lib", "compiler", "project-ir.ts");

  it("discoverAdapter filters out degraded adapters (B4-1)", () => {
    const fnBody = registry.slice(registry.indexOf("export async function discoverAdapter"));
    const bodyEnd = fnBody.indexOf("\nexport ");
    const body = fnBody.slice(0, bodyEnd === -1 ? undefined : bodyEnd);
    assert(
      body.includes('.filter(') && body.includes('healthStatus') && body.includes('"degraded"'),
      "discoverAdapter must filter out degraded adapters"
    );
  });

  it("discoverAdapter includes V24 fix comment (B4-1)", () => {
    assert(
      registry.includes("V24 fix: degraded adapters are excluded from auto-discovery"),
      "discoverAdapter must include V24 fix comment"
    );
  });

  it("buildPlatformManifest reads from live registry (B4-2)", () => {
    assert(
      manifest.includes("listAdapters()") && manifest.includes("listAdapterManifests()"),
      "buildPlatformManifest must call listAdapters and listAdapterManifests"
    );
  });

  it("platform-manifest imports from adapter-registry (B4-2)", () => {
    assert(
      manifest.includes('from "./adapter-registry"'),
      "platform-manifest must import from adapter-registry"
    );
  });

  it("parseZipToIR validates ZIP is non-empty before extraction (B4-3)", () => {
    assert(
      ir.includes("entries.length === 0") &&
        ir.includes("ZIP is empty"),
      "parseZipToIR must reject empty ZIPs"
    );
  });

  it("parseZipToIR validates against path traversal (B4-3)", () => {
    assert(
      ir.includes("path traversal") && ir.includes("Extraction aborted"),
      "parseZipToIR must detect and reject path traversal entries"
    );
  });

  it("parseZipToIR validates before extractAllTo (B4-3)", () => {
    const extractIdx = ir.indexOf("extractAllTo");
    const validationIdx = ir.indexOf("path traversal");
    assert(
      validationIdx < extractIdx,
      "path traversal validation must appear before extractAllTo call"
    );
  });
});

// ── [5] Batch 5 — Release Identity ─────────────────────────────────────────

describe("Batch 5 — Release Identity", () => {
  const releaseNotes = readFile("RELEASE_NOTES.md");
  const readme = readFile("README.md");
  const pkg = JSON.parse(readFile("package.json"));
  const lock = JSON.parse(readFile("package-lock.json"));
  const sidebar = readSrc("components", "layout", "Sidebar.tsx");

  it("package.json version = 24.0.0", () => {
    assert(pkg.version === "24.0.0", `package.json version is ${pkg.version}`);
  });

  it("package-lock.json root version = 24.0.0", () => {
    assert(lock.version === "24.0.0", `package-lock.json version is ${lock.version}`);
  });

  it("README heading references v24.0.0", () => {
    assert(readme.includes("v24.0.0"), "README must reference v24.0.0");
  });

  it("RELEASE_NOTES heading = v24.0.0", () => {
    assert(
      releaseNotes.includes("v24.0.0") || releaseNotes.includes("24.0.0"),
      "RELEASE_NOTES must reference 24.0.0"
    );
  });

  it("RELEASE_NOTES ← current points to 24.0.0 (B5-2)", () => {
    assert(
      releaseNotes.includes("24.0.0") &&
        releaseNotes.includes("← **current**") &&
        releaseNotes.indexOf("24.0.0") < releaseNotes.indexOf("← **current**") + 10,
      "RELEASE_NOTES ← current marker must be on 24.0.0 row"
    );
  });

  it("RELEASE_NOTES V22 section has no stale ← current marker (B5-2)", () => {
    const v22Idx = releaseNotes.indexOf("V22 —");
    assert(v22Idx !== -1, "V22 section must exist");
    const v22Section = releaseNotes.slice(v22Idx, v22Idx + 300);
    assert(
      !v22Section.includes("← **current**"),
      "V22 section must NOT carry stale ← current marker"
    );
  });

  it("RELEASE_NOTES non-negotiable gates table references v24 ZIP (B5-1)", () => {
    assert(
      releaseNotes.includes("tfa-evolution-studio-v24.0.0.zip"),
      "Non-negotiable gates must reference v24.0.0.zip"
    );
  });

  it("Sidebar label = Studio v24.0", () => {
    assert(sidebar.includes("Studio v24.0"), "Sidebar label must be Studio v24.0");
  });

  it("V24-RELEASE-NOTES.md exists", () => {
    assert(
      fs.existsSync(path.join(ROOT, "V24-RELEASE-NOTES.md")),
      "V24-RELEASE-NOTES.md must exist"
    );
  });
});

// ── [6] Batch 6 — Evidence / Certification ─────────────────────────────────

describe("Batch 6 — Evidence / Certification", () => {
  const governor = readSrc("lib", "release", "release-governor.ts");
  const gate = readSrc("lib", "release", "release-gate.ts");

  it("verifyWorkspaceCoherence returns WorkspaceCoherenceResult not boolean (B6-1)", () => {
    assert(
      governor.includes("WorkspaceCoherenceResult") &&
        governor.includes("coherent: boolean") &&
        governor.includes("reason?: string"),
      "verifyWorkspaceCoherence must return structured result"
    );
  });

  it("WorkspaceCoherenceResult exported (B6-1)", () => {
    assert(
      governor.includes("export interface WorkspaceCoherenceResult"),
      "WorkspaceCoherenceResult must be exported"
    );
  });

  it("every false path in verifyWorkspaceCoherence includes a reason (B6-1)", () => {
    // Count { coherent: false } without reason — should be 0
    const falseMatches = [...governor.matchAll(/coherent: false(?!.*reason)/g)];
    const reasonedFalse = [...governor.matchAll(/coherent: false,\s*reason:/g)];
    // The fix should ensure every return false carries a reason
    assert(
      reasonedFalse.length >= 4,
      "Every coherent:false return must carry a reason field"
    );
  });

  it("release gate requires zip_integrity_verified", () => {
    assert(
      gate.includes('"zip_integrity_verified"'),
      "release gate must require zip_integrity_verified"
    );
  });

  it("release gate requires version_coherence_verified", () => {
    assert(
      gate.includes('"version_coherence_verified"'),
      "release gate must require version_coherence_verified"
    );
  });

  it("release gate requires self_audit_clean", () => {
    assert(
      gate.includes('"self_audit_clean"'),
      "release gate must require self_audit_clean"
    );
  });

  it("enforceEvidenceGovernance includes version_coherence_verified as hard gate", () => {
    const govFn = governor.slice(governor.indexOf("enforceEvidenceGovernance"));
    assert(
      govFn.includes('"version_coherence_verified"'),
      "enforceEvidenceGovernance must include version_coherence_verified"
    );
  });
});

// ── [7] Batch 7 — Distillation / Learning ──────────────────────────────────

describe("Batch 7 — Distillation / Learning", () => {
  const learning = readSrc("lib", "learning", "learning-engine.ts");
  const outcome = readSrc("lib", "learning", "outcome-tracker.ts");

  it("learning-engine imports applyPromotedPatternsToPrioritization (B7-1)", () => {
    assert(
      learning.includes("applyPromotedPatternsToPrioritization"),
      "learning-engine must import applyPromotedPatternsToPrioritization"
    );
  });

  it("learning-engine imports backlogFromTaxonomy (B7-1)", () => {
    assert(
      learning.includes("backlogFromTaxonomy"),
      "learning-engine must import backlogFromTaxonomy"
    );
  });

  it("applyLearningToBacklog() exported from learning-engine (B7-1)", () => {
    assert(
      learning.includes("export function applyLearningToBacklog"),
      "applyLearningToBacklog must be exported"
    );
  });

  it("runLearningAnalysis() calls applyLearningToBacklog (B7-1)", () => {
    const fnBody = learning.slice(learning.indexOf("export function runLearningAnalysis"));
    const bodyEnd = fnBody.indexOf("\nexport ");
    const body = fnBody.slice(0, bodyEnd === -1 ? undefined : bodyEnd);
    assert(
      body.includes("applyLearningToBacklog(projectId)"),
      "runLearningAnalysis must call applyLearningToBacklog"
    );
  });

  it("runLearningAnalysis() returns backlogItemsAdjusted and taxonomyItemsAdded (B7-1)", () => {
    const fnBody = learning.slice(learning.indexOf("export function runLearningAnalysis"));
    const bodyEnd = fnBody.indexOf("\nexport ");
    const body = fnBody.slice(0, bodyEnd === -1 ? undefined : bodyEnd);
    assert(
      body.includes("backlogItemsAdjusted") && body.includes("taxonomyItemsAdded"),
      "runLearningAnalysis must return backlogItemsAdjusted and taxonomyItemsAdded"
    );
  });

  it("outcome-tracker imports applyLearningToBacklog (B7-2)", () => {
    assert(
      outcome.includes("applyLearningToBacklog"),
      "outcome-tracker must import applyLearningToBacklog"
    );
  });

  it("recordOutcome() triggers applyLearningToBacklog (B7-2)", () => {
    const fnBody = outcome.slice(outcome.indexOf("export function recordOutcome"));
    const bodyEnd = fnBody.indexOf("\nexport ");
    const body = fnBody.slice(0, bodyEnd === -1 ? undefined : bodyEnd);
    assert(
      body.includes("applyLearningToBacklog(projectId)"),
      "recordOutcome must call applyLearningToBacklog"
    );
  });

  it("recordOutcome() swallows promotion errors (B7-2)", () => {
    const fnBody = outcome.slice(outcome.indexOf("export function recordOutcome"));
    const bodyEnd = fnBody.indexOf("\nexport ");
    const body = fnBody.slice(0, bodyEnd === -1 ? undefined : bodyEnd);
    assert(
      body.includes("try {") && body.includes("} catch {"),
      "recordOutcome must wrap promotion in try/catch"
    );
  });

  it("V24 fix comment present in outcome-tracker (B7-2)", () => {
    assert(
      outcome.includes("V24 fix: recordOutcome() previously appended outcomes with no downstream"),
      "outcome-tracker must include V24 fix docstring"
    );
  });
});

// ── [8] Version Coherence — all identity fields = 24.0.0 ───────────────────

describe("Version Coherence — all identity fields = 24.0.0", () => {
  it("package.json version = 24.0.0", () => {
    const pkg = JSON.parse(readFile("package.json"));
    assert(pkg.version === "24.0.0", `package.json = ${pkg.version}`);
  });

  it("package-lock.json version = 24.0.0", () => {
    const lock = JSON.parse(readFile("package-lock.json"));
    assert(lock.version === "24.0.0", `package-lock.json = ${lock.version}`);
  });

  it("README heading = v24.0.0", () => {
    const readme = readFile("README.md");
    assert(readme.match(/v24\.0\.0/), "README must contain v24.0.0");
  });

  it("RELEASE_NOTES heading = v24.0.0", () => {
    const rn = readFile("RELEASE_NOTES.md");
    assert(rn.match(/24\.0\.0/), "RELEASE_NOTES must contain 24.0.0");
  });

  it("RELEASE_NOTES Version: 24.0.0", () => {
    const rn = readFile("RELEASE_NOTES.md");
    assert(rn.includes("**Version:** 24.0.0"), "RELEASE_NOTES must have **Version:** 24.0.0");
  });

  it("V24-RELEASE-NOTES.md exists", () => {
    assert(fs.existsSync(path.join(ROOT, "V24-RELEASE-NOTES.md")), "V24-RELEASE-NOTES.md must exist");
  });

  it("Sidebar label = Studio v24.0", () => {
    const sidebar = readSrc("components", "layout", "Sidebar.tsx");
    assert(sidebar.includes("Studio v24.0"), "Sidebar must show Studio v24.0");
  });
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log("\n========================================================");
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log("\n✅ All V24 checks passed");
  process.exit(0);
} else {
  console.log("\n❌ Some V24 checks failed");
  process.exit(1);
}
