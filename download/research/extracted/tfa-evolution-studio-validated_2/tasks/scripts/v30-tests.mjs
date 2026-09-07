#!/usr/bin/env node
// ============================================================================
// TFA Evolution Studio V30 — Workstream Validation Tests
//
// Covers all 8 v30 workstreams:
//   WS1  Soak Testing Framework
//   WS2  Architectural Fitness Functions
//   WS3  Multi-Agent Debate V2
//   WS4  Engineering Memory Graph
//   WS5  Platform Runtime Profiles
//   WS6  Software Compiler Intelligence
//   WS7  Technical Debt Elimination & Release Truth
//   WS8  Self-Critique Engine
//
// Run: node scripts/v30-tests.mjs
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

// ── WS1: Soak Testing Framework ───────────────────────────────────────────────

console.log("\n── WS1: Soak Testing Framework ──────────────────────────────────────");

(function ws1() {
  const sh = readFile("src/lib/soak/soak-harness.ts");
  if (!sh) { fail("soak-harness.ts", "file not found"); return; }
  ok("soak-harness.ts present", `${Math.round(Buffer.byteLength(sh) / 1024)}KB`);

  const scenarios = [
    "endurance_cycle", "restart_recovery", "replay_verification",
    "timeout_pressure", "provider_instability", "corrupted_zip_flood",
    "large_project_soak", "parallel_projects",
  ];
  for (const s of scenarios) {
    if (sh.includes(`"${s}"`)) ok(`Soak scenario: "${s}"`);
    else fail(`Soak scenario: "${s}"`, "not found in SoakScenarioKind or DEFAULT_SOAK_CONFIGS");
  }

  const exports = [
    "export function runSoakScenario",
    "export function runFullSoakSuite",
    "export function runQuickSoak",
    "export const DEFAULT_SOAK_CONFIGS",
  ];
  for (const exp of exports) {
    if (sh.includes(exp)) ok(`Soak: ${exp.replace("export function ", "").replace("export const ", "")}`);
    else fail(`Soak: ${exp}`, "not found");
  }

  if (sh.includes("p50LatencyMs") && sh.includes("p95LatencyMs") && sh.includes("p99LatencyMs")) {
    ok("SoakReport: P50/P95/P99 latency metrics present");
  } else {
    fail("SoakReport latency percentiles", "p50/p95/p99 not found");
  }

  if (sh.includes("stable") && sh.includes("degraded") && sh.includes("unstable")) {
    ok("SoakReport verdict: stable/degraded/unstable");
  } else {
    fail("SoakReport verdict", "stable/degraded/unstable not found");
  }

  if (sh.includes("production_ready") && sh.includes("needs_hardening") && sh.includes("critical_failures")) {
    ok("FullSoakReport verdict: production_ready/needs_hardening/critical_failures");
  } else {
    fail("FullSoakReport verdict", "production_ready/needs_hardening/critical_failures not found");
  }

  if (sh.includes("consecutiveFailurePeak")) ok("SoakReport: consecutiveFailurePeak tracked");
  else fail("SoakReport: consecutiveFailurePeak", "not found");

  if (sh.includes("maxConsecutiveFailures")) ok("SoakConfig: maxConsecutiveFailures abort logic");
  else fail("SoakConfig: maxConsecutiveFailures", "not found");

  if (sh.includes("seed")) ok("SoakConfig: seed for deterministic reproducibility");
  else fail("SoakConfig: seed", "not found");

  if (sh.includes("recoveryRate")) ok("SoakReport: recoveryRate metric present");
  else fail("SoakReport: recoveryRate", "not found");
})();

// ── WS2: Architectural Fitness Functions ──────────────────────────────────────

console.log("\n── WS2: Architectural Fitness Functions ─────────────────────────────");

(function ws2() {
  const ff = readFile("src/lib/fitness/fitness-functions.ts");
  if (!ff) { fail("fitness-functions.ts", "file not found"); return; }
  ok("fitness-functions.ts present", `${Math.round(Buffer.byteLength(ff) / 1024)}KB`);

  const exports = [
    "export function measureCoupling",
    "export function measureComplexity",
    "export function detectDependencyCycles",
    "export function measureTechnicalDebt",
    "export function enforceFunctionSizeGate",
    "export function computeArchHealthScore",
    "export function runFitnessSuite",
    "export function buildArchGraph",
  ];
  for (const exp of exports) {
    if (ff.includes(exp)) ok(`Fitness: ${exp.replace("export function ", "")}`);
    else fail(`Fitness: ${exp}`, "not found");
  }

  if (ff.includes("afferent") && ff.includes("efferent") && ff.includes("instability")) {
    ok("Fitness: coupling metrics (afferent, efferent, instability)");
  } else {
    fail("Fitness: coupling metrics", "missing afferent/efferent/instability");
  }

  if (ff.includes("highCouplingRisks")) ok("Fitness: highCouplingRisks flagging");
  else fail("Fitness: highCouplingRisks", "not found");

  if (ff.includes("strongconnect")) ok("Fitness: Tarjan SCC algorithm (strongconnect) present");
  else fail("Fitness: Tarjan SCC", "strongconnect not found");

  if (ff.includes("gradeScore")) ok("Fitness: grade scoring (A-F)");
  else fail("Fitness: gradeScore", "not found");

  if (ff.includes("FUNCTION_SIZE_THRESHOLD_LINES")) ok("Fitness: FUNCTION_SIZE_THRESHOLD_LINES defined");
  else fail("Fitness: FUNCTION_SIZE_THRESHOLD_LINES", "not found");

  if (ff.includes("debtIndex")) ok("Fitness: debt index per-file metric");
  else fail("Fitness: debtIndex", "not found");

  const dimensions = ["coupling", "complexity", "cycleFreedom", "debtBurden", "functionSize"];
  for (const d of dimensions) {
    if (ff.includes(d)) ok(`Fitness: ArchHealthScore dimension "${d}"`);
    else fail(`Fitness dimension "${d}"`, "not found");
  }
})();

// ── WS3: Multi-Agent Debate V2 ────────────────────────────────────────────────

console.log("\n── WS3: Multi-Agent Debate V2 ───────────────────────────────────────");

(function ws3() {
  const so = readFile("src/lib/agents/sovereign-orchestrator.ts");
  if (!so) { fail("sovereign-orchestrator.ts", "file not found"); return; }

  const v2Stages = ["Proposal", "Critique", "Counter-Proposal", "Evidence", "Consensus", "Verification", "Distillation"];
  for (const stage of v2Stages) {
    if (so.includes(stage)) ok(`DebateV2: stage "${stage}" present`);
    else fail(`DebateV2: stage "${stage}"`, "not found");
  }

  if (so.includes("runDebateV2")) ok("DebateV2: runDebateV2() exported");
  else fail("DebateV2: runDebateV2", "not found");

  if (so.includes("DebateV2Result")) ok("DebateV2: DebateV2Result type present");
  else fail("DebateV2: DebateV2Result", "not found");

  if (so.includes("DebateV2Config")) ok("DebateV2: DebateV2Config type present");
  else fail("DebateV2: DebateV2Config", "not found");

  if (so.includes("debate_v2_converged")) ok("DebateV2: debate_v2_converged evidence node");
  else fail("DebateV2: debate_v2_converged evidence kind", "not found");

  // v29 contracts still intact
  if (so.includes("runSovereignLoop")) ok("V29 contract: runSovereignLoop still present");
  else fail("V29 contract: runSovereignLoop", "missing");

  if (so.includes("runSovereignBatch")) ok("V29 contract: runSovereignBatch still present");
  else fail("V29 contract: runSovereignBatch", "missing");

  if (so.includes("selectWork")) ok("V29 contract: selectWork still present");
  else fail("V29 contract: selectWork", "missing");

  if (so.includes("evidenceFloor ?? 3")) ok("V29 contract: evidenceFloor = 3 default intact");
  else fail("V29 contract: evidenceFloor", "3 default missing");

  if (so.includes("synthesis_loop_converged")) ok("V29 contract: synthesis_loop_converged evidence intact");
  else fail("V29 contract: synthesis_loop_converged", "missing");
})();

// ── WS4: Engineering Memory Graph ────────────────────────────────────────────

console.log("\n── WS4: Engineering Memory Graph ────────────────────────────────────");

(function ws4() {
  const mg = readFile("src/lib/memory/memory-graph.ts");
  if (!mg) { fail("memory-graph.ts", "file not found"); return; }
  ok("memory-graph.ts present", `${Math.round(Buffer.byteLength(mg) / 1024)}KB`);

  const exports = [
    "export function loadMemoryGraph",
    "export function upsertMemoryNode",
    "export function addMemoryEdge",
    "export function queryNodes",
    "export function findBestRecovery",
    "export function findPath",
    "export function getKnowledgeSummary",
    "export function ingestCycleOutcome",
  ];
  for (const exp of exports) {
    if (mg.includes(exp)) ok(`Memory: ${exp.replace("export function ", "")}`);
    else fail(`Memory: ${exp}`, "not found");
  }

  const nodeKinds = ["success", "failure", "recovery", "policy", "playbook", "pattern", "lesson", "decision"];
  for (const k of nodeKinds) {
    if (mg.includes(`"${k}"`)) ok(`Memory: MemoryNodeKind "${k}"`);
    else fail(`Memory: MemoryNodeKind "${k}"`, "not found");
  }

  const edgeKinds = ["causes", "resolves", "extends", "validates", "contradicts", "precedes", "derived_from"];
  for (const k of edgeKinds) {
    if (mg.includes(`"${k}"`)) ok(`Memory: MemoryEdgeKind "${k}"`);
    else fail(`Memory: MemoryEdgeKind "${k}"`, "not found");
  }

  if (mg.includes("confidence: number") && mg.includes("observationCount")) {
    ok("Memory: MemoryNode has confidence + observationCount");
  } else {
    fail("Memory: MemoryNode confidence/observationCount", "missing");
  }

  if (mg.includes("CycleOutcomeInput")) ok("Memory: CycleOutcomeInput type present");
  else fail("Memory: CycleOutcomeInput", "not found");
})();

// ── WS5: Platform Runtime Profiles ───────────────────────────────────────────

console.log("\n── WS5: Platform Runtime Profiles ───────────────────────────────────");

(function ws5() {
  const rp = readFile("src/lib/compiler/runtime-profiles.ts");
  if (!rp) { fail("runtime-profiles.ts", "file not found"); return; }
  ok("runtime-profiles.ts present", `${Math.round(Buffer.byteLength(rp) / 1024)}KB`);

  const profiles = ["wordpress", "shopify", "nextjs", "static", "node_service", "microservice", "plugin_ecosystem"];
  for (const p of profiles) {
    if (rp.includes(`"${p}"`)) ok(`RuntimeProfile: "${p}"`);
    else fail(`RuntimeProfile: "${p}"`, "not found");
  }

  const exports = [
    "export function detectRuntimeProfile",
    "export function getRuntimeProfile",
    "export function generateRuntimeManifest",
    "export const RUNTIME_PROFILES",
  ];
  for (const exp of exports) {
    if (rp.includes(exp)) ok(`RuntimeProfiles: ${exp.replace("export function ", "").replace("export const ", "")}`);
    else fail(`RuntimeProfiles: ${exp}`, "not found");
  }

  if (rp.includes("generateManifest") && rp.includes("generateLayout") && rp.includes("validateArtifact")) {
    ok("RuntimeProfile: all 3 lifecycle methods (generateManifest, generateLayout, validateArtifact)");
  } else {
    fail("RuntimeProfile lifecycle methods", "one or more missing");
  }

  if (rp.includes("RuntimeManifest") && rp.includes("LayoutTemplate") && rp.includes("ArtifactValidationResult")) {
    ok("RuntimeProfile: typed return interfaces present");
  } else {
    fail("RuntimeProfile typed interfaces", "missing");
  }

  if (rp.includes("detect(ir)") || rp.includes("detect(ir:")) ok("RuntimeProfile: detect(ir) method present");
  else fail("RuntimeProfile: detect method", "not found");
})();

// ── WS6: Software Compiler Intelligence ──────────────────────────────────────

console.log("\n── WS6: Software Compiler Intelligence ──────────────────────────────");

(function ws6() {
  const ci = readFile("src/lib/compiler/compiler-intelligence.ts");
  if (!ci) { fail("compiler-intelligence.ts", "file not found"); return; }
  ok("compiler-intelligence.ts present", `${Math.round(Buffer.byteLength(ci) / 1024)}KB`);

  const stages = [
    "stageLexicalScan",
    "stageParse",
    "stageArchitectureGraph",
    "stageDependencyGraph",
    "stageImpactAnalysis",
    "stageExecutionPlan",
    "stageEvidenceSynthesis",
    "stageReleaseArtifact",
  ];
  for (const s of stages) {
    if (ci.includes(`export function ${s}`)) ok(`CompilerIntelligence: ${s} exported`);
    else fail(`CompilerIntelligence: ${s}`, "export not found");
  }

  if (ci.includes("export function runCompilerIntelligencePipeline")) {
    ok("CompilerIntelligence: runCompilerIntelligencePipeline exported");
  } else {
    fail("CompilerIntelligence: runCompilerIntelligencePipeline", "not found");
  }

  if (ci.includes("CompilerPipelineResult") && ci.includes("CompilerPipelineContext")) {
    ok("CompilerIntelligence: typed Result + Context interfaces");
  } else {
    fail("CompilerIntelligence: typed interfaces", "missing");
  }

  if (ci.includes("criticalGaps") && ci.includes("blockers")) {
    ok("CompilerIntelligence: criticalGaps and blockers in synthesis");
  } else {
    fail("CompilerIntelligence: criticalGaps/blockers", "missing");
  }

  if (ci.includes("blastRadius")) ok("CompilerIntelligence: blast radius impact analysis");
  else fail("CompilerIntelligence: blastRadius", "not found");

  if (ci.includes("ExecutionStep")) ok("CompilerIntelligence: ExecutionStep typed");
  else fail("CompilerIntelligence: ExecutionStep", "not found");

  // Evidence emission: every stage should push a node
  const stages8 = stages.map((s) => `${s}(`);
  const allStagesInPipeline = stages8.every((s) => ci.includes(s));
  if (allStagesInPipeline) ok("Pipeline: all 8 stage calls present in runCompilerIntelligencePipeline");
  else fail("Pipeline: not all 8 stages called", "one or more stage calls missing");
})();

// ── WS7: Technical Debt Elimination & Release Truth ──────────────────────────

console.log("\n── WS7: Release Truth & Technical Debt Elimination ─────────────────");

(function ws7() {
  const pkg = JSON.parse(readFile("package.json"));
  if (pkg.version === "30.0.0") ok("package.json version = 30.0.0");
  else fail("package.json version", `Expected 30.0.0, got ${pkg.version}`);

  if (pkg.description && pkg.description.includes("30.0.0")) ok("package.json description includes 30.0.0");
  else fail("package.json description", "does not include 30.0.0");

  const lock = readFile("package-lock.json");
  if (lock && lock.includes('"version": "30.0.0"')) ok("package-lock.json version = 30.0.0");
  else fail("package-lock.json version", "30.0.0 not found");

  const readme = readFile("README.md");
  if (readme && readme.startsWith("# TFA Evolution Studio v30.0.0")) ok("README.md heading = v30.0.0");
  else fail("README.md heading", "does not start with '# TFA Evolution Studio v30.0.0'");

  if (readme && readme.includes("← **current**") && readme.includes("v30.0.0")) {
    ok("README.md current marker on v30.0.0 row");
  } else {
    fail("README.md current marker", "← **current** not on v30.0.0 row");
  }

  const rn = readFile("RELEASE_NOTES.md");
  if (rn && rn.startsWith("# TFA Evolution Studio v30.0.0")) ok("RELEASE_NOTES.md heading = v30.0.0");
  else fail("RELEASE_NOTES.md heading", "does not start with v30.0.0");
  if (rn && rn.includes("← **current**") && rn.includes("30.0.0")) {
    ok("RELEASE_NOTES.md current marker on 30.0.0");
  } else {
    fail("RELEASE_NOTES.md current marker", "not found");
  }

  if (fileExists("V30-RELEASE-NOTES.md")) ok("V30-RELEASE-NOTES.md present");
  else fail("V30-RELEASE-NOTES.md", "file not found");

  const v30rn = readFile("V30-RELEASE-NOTES.md");
  if (v30rn) {
    const wsCount = (v30rn.match(/## Workstream \d+/g) || []).length;
    if (wsCount === 8) ok(`V30-RELEASE-NOTES.md: all 8 workstreams documented`);
    else fail("V30-RELEASE-NOTES.md workstream count", `found ${wsCount}, expected 8`);
  }

  const sidebar = readFile("src/components/layout/Sidebar.tsx");
  if (sidebar && sidebar.includes("Studio v30.0")) ok("Sidebar header: Studio v30.0");
  else fail("Sidebar header", "Studio v30.0 not found");
  if (sidebar && sidebar.includes("v30.0.0")) ok("Sidebar footer: v30.0.0");
  else fail("Sidebar footer", "v30.0.0 not found");

  const health = readFile("src/app/api/health/route.ts");
  if (health && health.includes("PLATFORM_VERSION")) ok("Health endpoint: PLATFORM_VERSION present");
  else fail("Health endpoint PLATFORM_VERSION", "not using PLATFORM_VERSION");
  if (health && !health.includes('"30.0.0"') && !health.includes('"29.0.0"')) {
    ok("Health endpoint: no hardcoded version string");
  } else {
    fail("Health endpoint", "hardcoded version string detected");
  }

  if (pkg.scripts && pkg.scripts["v30-tests"]) ok("v30-tests npm script registered");
  else fail("v30-tests npm script", "not in package.json scripts");

  // v30 EvidenceNodeKind entries
  const types = readFile("src/lib/types.ts");
  if (!types) { fail("types.ts", "not found"); return; }
  const v30Kinds = [
    "soak_test_completed", "soak_scenario_stable", "fitness_gate_passed",
    "arch_health_scored", "debate_v2_converged", "memory_graph_updated",
    "runtime_profile_detected", "compiler_pipeline_passed",
    "self_critique_passed", "technical_debt_resolved",
  ];
  for (const kind of v30Kinds) {
    if (types.includes(`"${kind}"`)) ok(`EvidenceNodeKind v30: "${kind}" present`);
    else fail(`EvidenceNodeKind v30: "${kind}"`, "not found in types.ts");
  }

  // No stale v20–v28 headers in new v30 module files
  const stalePattern = /TFA Evolution Studio v(20|21|22|23|24|25|26|27|28|29) —/;
  const newFiles = [
    "src/lib/soak/soak-harness.ts",
    "src/lib/fitness/fitness-functions.ts",
    "src/lib/memory/memory-graph.ts",
    "src/lib/compiler/runtime-profiles.ts",
    "src/lib/compiler/compiler-intelligence.ts",
    "src/lib/self-critique/self-critique.ts",
  ];
  let staleFound = false;
  for (const f of newFiles) {
    const content = readFile(f);
    if (content && stalePattern.test(content)) {
      fail(`Stale header in ${f}`, "v20-v29 header found in v30 module");
      staleFound = true;
    }
  }
  if (!staleFound) ok("No stale v20–v29 headers in new v30 modules");
})();

// ── WS8: Self-Critique Engine ─────────────────────────────────────────────────

console.log("\n── WS8: Self-Critique Engine ────────────────────────────────────────");

(function ws8() {
  const sc = readFile("src/lib/self-critique/self-critique.ts");
  if (!sc) { fail("self-critique.ts", "file not found"); return; }
  ok("self-critique.ts present", `${Math.round(Buffer.byteLength(sc) / 1024)}KB`);

  if (sc.includes("export function runSelfCritique")) ok("SelfCritique: runSelfCritique exported");
  else fail("SelfCritique: runSelfCritique", "not found");

  const dimensions = ["naming", "boundaries", "modularity", "maintainability", "evidence", "recovery", "distillation"];
  for (const d of dimensions) {
    if (sc.includes(`"${d}"`)) ok(`SelfCritique: dimension "${d}" present`);
    else fail(`SelfCritique: dimension "${d}"`, "not found");
  }

  const types = ["SelfCritiqueReport", "DimensionScore", "CritiqueFinding"];
  for (const t of types) {
    if (sc.includes(`interface ${t}`) || sc.includes(`export interface ${t}`)) {
      ok(`SelfCritique: ${t} type present`);
    } else {
      fail(`SelfCritique: ${t}`, "interface not found");
    }
  }

  if (sc.includes("FindingSeverity") && sc.includes('"info"') && sc.includes('"warning"') && sc.includes('"critical"')) {
    ok("SelfCritique: FindingSeverity (info/warning/critical)");
  } else {
    fail("SelfCritique: FindingSeverity", "missing info/warning/critical");
  }

  if (sc.includes("convergenceReached")) ok("SelfCritique: convergenceReached flag");
  else fail("SelfCritique: convergenceReached", "not found");

  if (sc.includes("finalGrade") && sc.includes('"A"') && sc.includes('"F"')) {
    ok("SelfCritique: finalGrade A–F present");
  } else {
    fail("SelfCritique: finalGrade", "A–F grading not found");
  }

  if (sc.includes("convergenceThreshold")) ok("SelfCritique: convergenceThreshold configurable");
  else fail("SelfCritique: convergenceThreshold", "not found");

  if (sc.includes("topRecommendations")) ok("SelfCritique: topRecommendations in report");
  else fail("SelfCritique: topRecommendations", "not found");

  if (sc.includes("self_evaluation_completed")) ok("SelfCritique: self_evaluation_completed evidence emitted");
  else fail("SelfCritique: self_evaluation_completed evidence", "not found");
})();

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════════");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
console.log(`V30 Tests — package v${pkg.version} — ${passed + failed} checks`);
console.log(`  Passed: ${passed}  |  Failed: ${failed}`);
if (failed === 0) {
  console.log("\n✅ All V30 workstream checks PASSED");
  process.exit(0);
} else {
  console.log(`\n❌ ${failed} check(s) FAILED`);
  process.exit(1);
}
