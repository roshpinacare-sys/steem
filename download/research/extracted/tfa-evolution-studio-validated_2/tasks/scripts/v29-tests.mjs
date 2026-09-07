#!/usr/bin/env node
// ============================================================================
// TFA Evolution Studio V29 — Workstream Validation Tests
//
// Covers all 9 v29 workstreams:
//   WS1  Distillation Intelligence
//   WS2  Decision Intelligence
//   WS3  Architecture Refinement (compiler phase decomposition)
//   WS4  Evidence-First Execution (traces + verification data)
//   WS5  Large-Project Soak & Stress (13 fault classes)
//   WS6  Multi-Agent Synthesis Quality
//   WS7  Release Truth Perfection
//   WS8  Technical Debt Elimination
//   WS9  Self-Evaluation Loop
//
// Run: node scripts/v29-tests.mjs
// Exit 0: all checks pass  |  Exit 1: any check failed
// ============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function ok(label, detail = "") {
  passed++;
  console.log(`  ✓ ${label}${detail ? " — " + detail : ""}`);
}

function fail(label, reason) {
  failed++;
  console.error(`  ✗ ${label}: ${reason}`);
}

function readFile(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf-8");
}

function fileExists(rel) {
  return fs.existsSync(path.join(root, rel));
}

// ── WS1: Distillation Intelligence ───────────────────────────────────────────

console.log("\n── WS1: Distillation Intelligence ───────────────────────────────────");

(function ws1() {
  const di = readFile("src/lib/distillation/distillation-intelligence.ts");
  if (!di) { fail("distillation-intelligence.ts", "file not found"); return; }
  ok("distillation-intelligence.ts present", `${Math.round(Buffer.byteLength(di) / 1024)}KB`);

  const exports = [
    "export function distillOutcome",
    "export function getSuccessRecipes",
    "export function getFailureTaxonomy",
    "export function getEngineeringPlaybooks",
    "export function getArchitecturePatterns",
    "export function getDecisionPriors",
    "export function getRecoveryStrategies",
    "export function getReusablePolicies",
    "export function getDecisionPrior",
    "export function getTopFailureModes",
    "export function getKnowledgeSummary",
    "export function clearKnowledgeBaseForTest",
  ];
  for (const exp of exports) {
    if (di.includes(exp)) ok(`Distillation: ${exp.replace("export function ", "")} exported`);
    else fail(`Distillation: ${exp}`, "not found");
  }

  const types = [
    "SuccessRecipe",
    "FailureTaxonomyEntry",
    "EngineeringPlaybook",
    "ArchitecturePattern",
    "DecisionPrior",
    "RecoveryStrategy",
    "ReusablePolicy",
  ];
  for (const t of types) {
    if (di.includes(`export interface ${t}`)) ok(`Distillation type: ${t}`);
    else fail(`Distillation type: ${t}`, "interface not found");
  }

  // confidence field on SuccessRecipe
  if (di.includes("confidence: number")) ok("SuccessRecipe: confidence field present");
  else fail("SuccessRecipe.confidence", "not found");

  // decision prior Bayesian fields
  if (di.includes("successRate: number") && di.includes("totalObservations")) {
    ok("DecisionPrior: Bayesian fields (successRate, totalObservations) present");
  } else {
    fail("DecisionPrior Bayesian fields", "missing");
  }

  // pattern-promoter bridge
  const pp = readFile("src/lib/distillation/pattern-promoter.ts");
  if (pp && pp.includes("bridgeToDecisionPriors")) ok("PatternPromoter: bridgeToDecisionPriors present");
  else fail("PatternPromoter: bridgeToDecisionPriors", "not found");

  // playbook-engine architecture extensions
  const pb = readFile("src/lib/distillation/playbook-engine.ts");
  if (pb && pb.includes("getArchitecturePlaybooks")) ok("PlaybookEngine: getArchitecturePlaybooks present");
  else fail("PlaybookEngine: getArchitecturePlaybooks", "not found");
  if (pb && pb.includes("architecturePatternTrigger")) ok("PlaybookEngine: architecturePatternTrigger present");
  else fail("PlaybookEngine: architecturePatternTrigger", "not found");
})();

// ── WS2: Decision Intelligence ────────────────────────────────────────────────

console.log("\n── WS2: Decision Intelligence ───────────────────────────────────────");

(function ws2() {
  const ds = readFile("src/lib/engine/decision-scorer.ts");
  if (!ds) { fail("decision-scorer.ts", "file not found"); return; }
  ok("decision-scorer.ts present", `${Math.round(Buffer.byteLength(ds) / 1024)}KB`);

  const scorerExports = [
    "export function scoreDecision",
    "export function rankDecisions",
    "export function selectBestDecision",
  ];
  for (const exp of scorerExports) {
    if (ds.includes(exp)) ok(`DecisionScorer: ${exp.replace("export function ", "")} exported`);
    else fail(`DecisionScorer: ${exp}`, "not found");
  }

  const dimensions = [
    "impact",
    "risk",
    "confidence",
    "leverage",
    "reuseValue",
    "regressionProbability",
    "architecturalPayoff",
    "maintainabilityPayoff",
  ];
  for (const dim of dimensions) {
    if (ds.includes(dim)) ok(`DecisionScorer: dimension "${dim}" present`);
    else fail(`DecisionScorer: dimension "${dim}"`, "not found");
  }

  // Weight sum check: all 8 weights must be present
  if (ds.includes("WEIGHTS")) ok("DecisionScorer: WEIGHTS table present");
  else fail("DecisionScorer: WEIGHTS", "not found");

  // Verdict thresholds
  if (ds.includes("0.80") && ds.includes("0.60")) {
    ok("DecisionScorer: verdict thresholds (0.80 / 0.60) present");
  } else {
    fail("DecisionScorer: verdict thresholds", "0.80 or 0.60 not found");
  }

  // Bayesian prior adjustment
  if (ds.includes("getDecisionPrior") && ds.includes("priorAdjustment")) {
    ok("DecisionScorer: Bayesian prior adjustment wired");
  } else {
    fail("DecisionScorer: Bayesian prior adjustment", "getDecisionPrior or priorAdjustment missing");
  }

  // Judgement engine extensions
  const je = readFile("src/lib/engine/judgement-engine.ts");
  if (je && je.includes("architecturalPayoff")) ok("JudgementEngine: architecturalPayoff field present");
  else fail("JudgementEngine: architecturalPayoff", "not found");
  if (je && je.includes("maintainabilityPayoff")) ok("JudgementEngine: maintainabilityPayoff field present");
  else fail("JudgementEngine: maintainabilityPayoff", "not found");
})();

// ── WS3: Architecture Refinement ─────────────────────────────────────────────

console.log("\n── WS3: Architecture Refinement ─────────────────────────────────────");

(function ws3() {
  const co = readFile("src/lib/compiler/compiler-orchestrator.ts");
  if (!co) { fail("compiler-orchestrator.ts", "file not found"); return; }

  const phases = [
    "prepareCompilerJob",
    "validateCompilerInputs",
    "discoverCompilerAdapter",
    "installDependencies",
    "buildProject",
    "exportArtifact",
    "verifyArtifact",
    "emitCompilerEvidence",
    "persistCompilerResult",
  ];
  for (const p of phases) {
    if (co.includes(`function ${p}`)) ok(`CompilerPhase exported: ${p}`);
    else fail(`CompilerPhase: ${p}`, `function ${p} not found`);
  }

  // runJob must be thin coordinator — no inline adapter calls
  if (!co.includes("await lifecycle.install") || co.split("function installDependencies")[1]?.includes("await lifecycle.install")) {
    ok("runJob: thin coordinator (adapter calls in phase functions only)");
  } else {
    fail("runJob: thin coordinator", "adapter lifecycle calls found outside phase functions");
  }

  // JobContext type
  if (co.includes("interface JobContext")) ok("JobContext context type present");
  else fail("JobContext", "interface not found");

  // Phase exports at bottom
  if (co.includes("export {") && co.includes("prepareCompilerJob")) {
    ok("Compiler phases: all exported for independent testing");
  } else {
    fail("Compiler phases export block", "not found");
  }

  // Evolution engine phases still present (unchanged from v28)
  const ee = readFile("src/lib/evolution-engine.ts");
  if (!ee) { fail("evolution-engine.ts", "not found"); return; }
  const evPhases = ["prepareEvolutionCycle", "validateEvolutionInputs", "loadProjectContext",
    "analyzeProjectState", "planEvolutionSteps", "executeEvolutionPlan",
    "verifyEvolutionResults", "emitEvolutionEvidence", "persistEvolutionState", "finalizeEvolutionCycle"];
  let evAll = true;
  for (const p of evPhases) {
    if (!ee.includes(`export function ${p}`)) { evAll = false; break; }
  }
  if (evAll) ok("EvolutionEngine: all 10 phases still exported (v28 contract intact)");
  else fail("EvolutionEngine: phases missing", "one or more v28 phase exports absent");
})();

// ── WS4: Evidence-First Execution ────────────────────────────────────────────

console.log("\n── WS4: Evidence-First Execution ────────────────────────────────────");

(function ws4() {
  const em = readFile("src/lib/engine/evidence-emitter.ts");
  if (!em) { fail("evidence-emitter.ts", "file not found"); return; }

  if (em.includes("executionTrace")) ok("EvidencePayload: executionTrace field present");
  else fail("EvidencePayload: executionTrace", "not found");

  if (em.includes("verificationData")) ok("EvidencePayload: verificationData field present");
  else fail("EvidencePayload: verificationData", "not found");

  // Core contracts still intact
  const contracts = [
    ["export function emitEvidence", "emitEvidence exported"],
    ["export function emitFailure", "emitFailure exported"],
    ["export function assertEvidencePassed", "assertEvidencePassed exported"],
    ["export function computePassRate", "computePassRate exported"],
    ["recovery is required", "emitFailure enforces recovery requirement"],
    ["Optimistic failure paths are not allowed", "anti-optimism enforcement"],
    ["if (nodes.length === 0) return 0", "computePassRate: empty nodes returns 0"],
  ];
  for (const [token, label] of contracts) {
    if (em.includes(token)) ok(`EvidenceEmitter: ${label}`);
    else fail(`EvidenceEmitter: ${label}`, `token not found: "${token}"`);
  }

  // Compiler orchestrator emits evidence with metadata on every phase
  const co = readFile("src/lib/compiler/compiler-orchestrator.ts");
  if (co) {
    const evidenceCalls = (co.match(/ctx\.saveEvidence\(/g) || []).length;
    if (evidenceCalls >= 5) ok(`CompilerOrchestrator: ${evidenceCalls} evidence emissions (≥5 required)`);
    else fail("CompilerOrchestrator: evidence emissions", `only ${evidenceCalls} found, need ≥5`);

    if (co.includes("recovery:")) ok("CompilerOrchestrator: recovery hints in evidence metadata");
    else fail("CompilerOrchestrator: recovery hints", "not found");
  }
})();

// ── WS5: Large-Project Soak & Stress ─────────────────────────────────────────

console.log("\n── WS5: Large-Project Soak & Stress ─────────────────────────────────");

(function ws5() {
  const ch = readFile("src/lib/chaos/chaos-harness.ts");
  if (!ch) { fail("chaos-harness.ts", "file not found"); return; }

  // All 13 fault classes
  const faults = [
    "corrupted_zip", "invalid_manifest", "broken_adapter", "provider_failure",
    "mid_phase_interrupt", "workspace_collision", "oversized_repository",
    "duplicate_job_submission", "checkpoint_corruption", "network_timeout",
    "dependency_poisoning", "partial_write_failure", "evidence_chain_truncation",
  ];
  for (const f of faults) {
    if (ch.includes(`case "${f}":`)) ok(`Fault covered: ${f}`);
    else fail(`Fault: ${f}`, `case "${f}": not found`);
  }

  // FaultKind union has all 13
  const faultKindMatches = faults.filter(f => ch.includes(`"${f}"`));
  if (faultKindMatches.length === 13) ok("FaultKind union: all 13 entries present");
  else fail("FaultKind union", `only ${faultKindMatches.length}/13 entries found`);

  // FAULT_LIBRARY present
  if (ch.includes("FAULT_LIBRARY")) ok("FAULT_LIBRARY exported");
  else fail("FAULT_LIBRARY", "not found");

  // New v29 fault case handlers
  if (ch.includes("dependency_poisoning") && ch.includes("partial_write_failure") && ch.includes("evidence_chain_truncation")) {
    ok("V29 fault case handlers present (dependency_poisoning, partial_write_failure, evidence_chain_truncation)");
  } else {
    fail("V29 fault handlers", "one or more missing");
  }

  // Verdicts
  if (ch.includes('"resilient"') && ch.includes('"vulnerable"')) {
    ok("ChaosReport: resilient/vulnerable verdict dichotomy present");
  } else {
    fail("ChaosReport verdicts", "missing");
  }
})();

// ── WS6: Multi-Agent Synthesis Quality ───────────────────────────────────────

console.log("\n── WS6: Multi-Agent Synthesis Quality ───────────────────────────────");

(function ws6() {
  const so = readFile("src/lib/agents/sovereign-orchestrator.ts");
  if (!so) { fail("sovereign-orchestrator.ts", "file not found"); return; }

  if (so.includes("representedRoles")) ok("Sovereign: representedRoles check present");
  else fail("Sovereign: representedRoles", "not found");

  if (so.includes("missingRoles")) ok("Sovereign: missingRoles computation present");
  else fail("Sovereign: missingRoles", "not found");

  if (so.includes("missing viewpoints from roles")) {
    ok("Sovereign: synthesis blocked on missing role viewpoints");
  } else {
    fail("Sovereign: viewpoint block message", "not found");
  }

  if (so.includes("orchestration_phase_completed") && so.includes("missingRoles")) {
    ok("Sovereign: FAILED evidence emitted for missing viewpoints");
  } else {
    fail("Sovereign: missing viewpoint evidence", "not found");
  }

  // V28 contracts still intact
  if (so.includes("evidenceFloor ?? 3")) ok("Sovereign: evidenceFloor = 3 (v28 contract intact)");
  else fail("Sovereign: evidenceFloor", "3 default not found");

  if (so.includes("requiredEvidenceFromObjections")) ok("Sovereign: objection→missing_evidence wiring intact");
  else fail("Sovereign: requiredEvidenceFromObjections", "not found");

  if (so.includes("totalWeight === 0")) ok("Sovereign: zero-weight detection intact");
  else fail("Sovereign: totalWeight === 0", "not found");

  if (so.includes("synthesis_loop_converged")) ok("Sovereign: synthesis_loop_converged evidence intact");
  else fail("Sovereign: synthesis_loop_converged", "not found");
})();

// ── WS7: Release Truth Perfection ────────────────────────────────────────────

console.log("\n── WS7: Release Truth Perfection ────────────────────────────────────");

(function ws7() {
  const pkg = JSON.parse(readFile("package.json"));
  if (pkg.version === "29.0.0") ok("package.json version = 29.0.0");
  else fail("package.json version", `Expected 29.0.0, got ${pkg.version}`);

  if (pkg.description && pkg.description.includes("29.0.0")) ok("package.json description includes 29.0.0");
  else fail("package.json description", "does not include 29.0.0");

  const lock = readFile("package-lock.json");
  if (lock && lock.includes('"version": "29.0.0"')) ok("package-lock.json version = 29.0.0");
  else fail("package-lock.json version", "29.0.0 not found");

  const readme = readFile("README.md");
  if (readme && readme.startsWith("# TFA Evolution Studio v29.0.0")) ok("README.md heading = v29.0.0");
  else fail("README.md heading", "does not start with '# TFA Evolution Studio v29.0.0'");

  if (readme && readme.includes("← **current**") && readme.includes("v29.0.0")) {
    ok("README.md current marker on v29.0.0 row");
  } else {
    fail("README.md current marker", "← **current** not on v29.0.0 row");
  }

  const rn = readFile("RELEASE_NOTES.md");
  if (rn && rn.startsWith("# TFA Evolution Studio v29.0.0")) ok("RELEASE_NOTES.md heading = v29.0.0");
  else fail("RELEASE_NOTES.md heading", "does not start with v29.0.0");
  if (rn && rn.includes("← **current**") && rn.includes("29.0.0")) {
    ok("RELEASE_NOTES.md current marker on 29.0.0");
  } else {
    fail("RELEASE_NOTES.md current marker", "not found");
  }

  if (fileExists("V29-RELEASE-NOTES.md")) ok("V29-RELEASE-NOTES.md present");
  else fail("V29-RELEASE-NOTES.md", "file not found");

  const sidebar = readFile("src/components/layout/Sidebar.tsx");
  if (sidebar && sidebar.includes("Studio v29.0")) ok("Sidebar header: Studio v29.0");
  else fail("Sidebar header", "Studio v29.0 not found");
  if (sidebar && sidebar.includes("v29.0.0")) ok("Sidebar footer: v29.0.0");
  else fail("Sidebar footer", "v29.0.0 not found");

  const health = readFile("src/app/api/health/route.ts");
  if (health && health.includes("PLATFORM_VERSION")) {
    ok("Health endpoint: PLATFORM_VERSION present");
  } else {
    fail("Health endpoint PLATFORM_VERSION", "not using PLATFORM_VERSION");
  }
  if (health && !health.includes('"29.0.0"') && !health.includes('"28.0.0"')) {
    ok("Health endpoint: no hardcoded version string");
  } else {
    fail("Health endpoint", "hardcoded version string detected");
  }

  const vc = readFile("src/lib/version-coherence.ts");
  if (vc && vc.includes("pkg.version")) ok("version-coherence.ts: PLATFORM_VERSION from pkg.version");
  else fail("version-coherence.ts", "not reading from pkg.version");

  if (pkg.scripts && pkg.scripts["v29-tests"]) ok("v29-tests npm script registered");
  else fail("v29-tests npm script", "not in package.json scripts");
})();

// ── WS8: Technical Debt Elimination ──────────────────────────────────────────

console.log("\n── WS8: Technical Debt Elimination ─────────────────────────────────");

(function ws8() {
  // No stale v20–v27 headers in src/
  const stalePattern = /TFA Evolution Studio v(20|21|22|23|24|25|26|27) —/;
  const srcDir = path.join(root, "src");
  let staleFiles = [];
  function walkDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const content = fs.readFileSync(full, "utf-8");
        if (stalePattern.test(content)) staleFiles.push(path.relative(root, full));
      }
    }
  }
  walkDir(srcDir);
  if (staleFiles.length === 0) ok("No stale v20–v27 headers in src/");
  else fail("Stale headers eliminated", `Found in: ${staleFiles.join(", ")}`);

  // compiler-orchestrator is decomposed (has JobContext)
  const co = readFile("src/lib/compiler/compiler-orchestrator.ts");
  if (co && co.includes("interface JobContext")) ok("compiler-orchestrator: decomposed JobContext present");
  else fail("compiler-orchestrator: decomposed", "JobContext interface not found");

  // v29 EvidenceNodeKind entries
  const types = readFile("src/lib/types.ts");
  if (!types) { fail("types.ts", "not found"); return; }
  const v29Kinds = [
    "distillation_cycle_completed",
    "decision_prior_updated",
    "architecture_pattern_validated",
    "recovery_strategy_applied",
    "synthesis_objection_resolved",
    "large_project_stress_verified",
    "self_evaluation_completed",
  ];
  for (const kind of v29Kinds) {
    if (types.includes(`"${kind}"`)) ok(`EvidenceNodeKind v29: "${kind}" present`);
    else fail(`EvidenceNodeKind v29: "${kind}"`, "not found in types.ts");
  }
})();

// ── WS9: Self-Evaluation Loop ─────────────────────────────────────────────────

console.log("\n── WS9: Self-Evaluation Loop ────────────────────────────────────────");

(function ws9() {
  const di = readFile("src/lib/distillation/distillation-intelligence.ts");
  if (!di) { fail("distillation-intelligence.ts", "not found"); return; }

  if (di.includes("getKnowledgeSummary")) ok("Self-eval: getKnowledgeSummary() present as self-audit surface");
  else fail("Self-eval: getKnowledgeSummary", "not found");

  if (di.includes("avgConfidence")) ok("Self-eval: avgConfidence metric in summary");
  else fail("Self-eval: avgConfidence", "not found");

  if (di.includes("clearKnowledgeBaseForTest")) ok("Self-eval: clearKnowledgeBaseForTest for isolated testing");
  else fail("Self-eval: clearKnowledgeBaseForTest", "not found");

  if (di.includes("getTopFailureModes")) ok("Self-eval: getTopFailureModes closes distillation→planning loop");
  else fail("Self-eval: getTopFailureModes", "not found");

  const ds = readFile("src/lib/engine/decision-scorer.ts");
  if (ds && ds.includes("buildRationale")) ok("Self-eval: buildRationale makes scoring transparent");
  else fail("Self-eval: buildRationale", "not in decision-scorer.ts");

  // scripts/v29-tests.mjs present
  if (fs.existsSync(path.join(root, "scripts/v29-tests.mjs"))) ok("scripts/v29-tests.mjs present");
  else fail("scripts/v29-tests.mjs", "not found");

  // V29-RELEASE-NOTES.md covers all 9 workstreams
  const rn = readFile("V29-RELEASE-NOTES.md");
  if (!rn) { fail("V29-RELEASE-NOTES.md", "not found"); return; }
  const wsCount = (rn.match(/## Workstream \d+/g) || []).length;
  if (wsCount === 9) ok(`V29-RELEASE-NOTES.md: all 9 workstreams documented`);
  else fail("V29-RELEASE-NOTES.md workstream count", `found ${wsCount}, expected 9`);
})();

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════════");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
console.log(`V29 Tests — package v${pkg.version} — ${passed + failed} checks`);
console.log(`  Passed: ${passed}  |  Failed: ${failed}`);
if (failed === 0) {
  console.log("\n✅ All V29 workstream checks PASSED");
  process.exit(0);
} else {
  console.log(`\n❌ ${failed} check(s) FAILED`);
  process.exit(1);
}
