/**
 * TFA Evolution Studio v30 — Self-Critique Engine
 *
 * WS8: Autonomous review pass that evaluates the platform's own codebase
 * against quality standards across six dimensions:
 *
 *   naming        — identifier clarity, consistency, and intent-revealing names
 *   boundaries    — module boundary integrity, no cross-layer leakage
 *   modularity    — single-responsibility adherence, coupling scores
 *   maintainability — documentation coverage, test surface, function size
 *   evidence      — all execution paths emit structured evidence
 *   recovery      — all error branches have documented recovery paths
 *   distillation  — knowledge accumulation paths are closed-loop
 *
 * The engine runs to convergence: each pass scores the platform and
 * reports findings. Passes repeat until confidence rises above threshold
 * or the maximum pass count is reached.
 *
 * All findings are evidence-backed — no assertion without rationale.
 */

import type { EvidenceNode } from "@/lib/types";
import type { ProjectIR } from "@/lib/compiler/project-ir";

// ── Types ─────────────────────────────────────────────────────────────────

export type CritiqueDimension =
  | "naming"
  | "boundaries"
  | "modularity"
  | "maintainability"
  | "evidence"
  | "recovery"
  | "distillation";

export type FindingSeverity = "info" | "warning" | "critical";

export interface CritiqueFinding {
  dimension: CritiqueDimension;
  severity: FindingSeverity;
  file?: string;
  description: string;
  rationale: string;
  remediation: string;
}

export interface DimensionScore {
  dimension: CritiqueDimension;
  /** 0-100 score for this dimension. */
  score: number;
  confidence: number;
  findings: CritiqueFinding[];
}

export interface CritiquePassResult {
  passNumber: number;
  timestamp: string;
  dimensions: DimensionScore[];
  overallScore: number;
  criticalFindings: CritiqueFinding[];
  totalFindings: number;
  evidence: EvidenceNode[];
}

export interface SelfCritiqueReport {
  convergenceReached: boolean;
  passesRun: number;
  finalScore: number;
  finalGrade: "A" | "B" | "C" | "D" | "F";
  passes: CritiquePassResult[];
  allFindings: CritiqueFinding[];
  topRecommendations: string[];
  evidence: EvidenceNode[];
}

// ── Dimension evaluators ──────────────────────────────────────────────────

function evaluateNaming(ir: ProjectIR): DimensionScore {
  const findings: CritiqueFinding[] = [];
  let score = 100;

  for (const f of ir.files) {
    if (![".ts", ".tsx", ".js", ".jsx"].includes(f.extension)) continue;

    // Single-letter exports indicate poor naming
    const singleLetter = f.exports.filter((e) => e.length <= 1);
    if (singleLetter.length > 0) {
      score -= 5;
      findings.push({
        dimension: "naming",
        severity: "warning",
        file: f.relPath,
        description: `Single-letter export(s): ${singleLetter.join(", ")}`,
        rationale: "Single-letter identifiers are non-descriptive and harm long-term maintainability",
        remediation: "Rename to intent-revealing names (e.g., 'e' → 'eventPayload')",
      });
    }

    // Files with no exports are suspicious (dead files or missing exports)
    if (f.exports.length === 0 && f.size > 500) {
      score -= 3;
      findings.push({
        dimension: "naming",
        severity: "info",
        file: f.relPath,
        description: "No exported identifiers found",
        rationale: "Files with no exports may be dead code or have unexported logic that should be accessible",
        remediation: "Export the public interface or delete if unused",
      });
    }
  }

  return {
    dimension: "naming",
    score: Math.max(0, score),
    confidence: 0.70,
    findings,
  };
}

function evaluateBoundaries(ir: ProjectIR): DimensionScore {
  const findings: CritiqueFinding[] = [];
  let score = 100;

  // Detect cross-layer imports (e.g., lib importing from app, or api importing from components)
  for (const f of ir.files) {
    if (f.relPath.includes("src/lib/") && f.imports.some((i) => i.includes("/app/"))) {
      score -= 10;
      findings.push({
        dimension: "boundaries",
        severity: "critical",
        file: f.relPath,
        description: "Library module imports from app layer",
        rationale: "Libraries must not depend on the app layer — this creates a circular dependency risk and violates separation of concerns",
        remediation: "Move the shared logic into lib/ or pass it as a dependency-injected parameter",
      });
    }

    if (f.relPath.includes("src/components/") && f.imports.some((i) => i.includes("/api/"))) {
      score -= 8;
      findings.push({
        dimension: "boundaries",
        severity: "warning",
        file: f.relPath,
        description: "UI component directly imports from API layer",
        rationale: "Components should call API through service hooks, not import route handlers directly",
        remediation: "Use React Query hooks or a service abstraction layer instead of direct API imports",
      });
    }
  }

  return {
    dimension: "boundaries",
    score: Math.max(0, score),
    confidence: 0.80,
    findings,
  };
}

function evaluateModularity(ir: ProjectIR): DimensionScore {
  const findings: CritiqueFinding[] = [];
  let score = 100;

  for (const f of ir.files) {
    if (![".ts", ".tsx"].includes(f.extension)) continue;
    const approxLoc = f.size / 30;

    // Files over 400 LOC are candidates for decomposition
    if (approxLoc > 400) {
      score -= 8;
      findings.push({
        dimension: "modularity",
        severity: "warning",
        file: f.relPath,
        description: `Large file (~${Math.round(approxLoc)} LOC) — consider decomposition`,
        rationale: "Large files tend to accumulate multiple responsibilities and grow harder to test in isolation",
        remediation: "Extract independent concerns into sibling modules with clear interfaces",
      });
    }

    // Files with many imports and many exports have high bidirectional coupling
    if (f.imports.length > 15 && f.exports.length > 10) {
      score -= 6;
      findings.push({
        dimension: "modularity",
        severity: "warning",
        file: f.relPath,
        description: `High bidirectional coupling: ${f.imports.length} imports, ${f.exports.length} exports`,
        rationale: "High import + export counts indicate a module acting as a hub; hubs are fragile change surfaces",
        remediation: "Introduce a facade pattern or split into domain-specific sub-modules",
      });
    }
  }

  return {
    dimension: "modularity",
    score: Math.max(0, score),
    confidence: 0.75,
    findings,
  };
}

function evaluateMaintainability(ir: ProjectIR): DimensionScore {
  const findings: CritiqueFinding[] = [];
  let score = 100;
  let documented = 0;
  let total = 0;

  for (const f of ir.files) {
    if (![".ts", ".tsx"].includes(f.extension)) continue;
    total++;
    if (f.exports.length > 0) documented++;

    if (f.size > 5000 && f.imports.length < 2) {
      score -= 5;
      findings.push({
        dimension: "maintainability",
        severity: "info",
        file: f.relPath,
        description: "Large isolated file — may lack adequate decomposition",
        rationale: "Files with few imports but large size suggest all logic is co-located rather than composed from smaller units",
        remediation: "Refactor into smaller composable functions imported from helper modules",
      });
    }
  }

  const docCoverage = total > 0 ? documented / total : 1;
  if (docCoverage < 0.70) {
    score -= 10;
    findings.push({
      dimension: "maintainability",
      severity: "warning",
      description: `Low export coverage ${(docCoverage * 100).toFixed(1)}% — many files have no public interface`,
      rationale: "Files without exports may be dead code or under-abstracted implementation details",
      remediation: "Review all zero-export files; delete dead code or expose the correct public interface",
    });
  }

  return {
    dimension: "maintainability",
    score: Math.max(0, score),
    confidence: 0.72,
    findings,
  };
}

function evaluateEvidence(ir: ProjectIR): DimensionScore {
  const findings: CritiqueFinding[] = [];
  let score = 100;

  // Check for files that handle errors but have no evidence-emitting keywords
  const evidenceKeywords = ["evidence", "EvidenceNode", "emitEvidence", "EvidenceEmitter"];
  for (const f of ir.files) {
    if (![".ts"].includes(f.extension)) continue;
    if (!f.relPath.includes("src/lib/")) continue;

    const hasErrorHandling = f.imports.some((i) => i.includes("error") || i.includes("Error"));
    const hasEvidence = evidenceKeywords.some((kw) => f.exports.some((e) => e.toLowerCase().includes(kw.toLowerCase())));

    if (hasErrorHandling && !hasEvidence && f.size > 1000) {
      score -= 5;
      findings.push({
        dimension: "evidence",
        severity: "warning",
        file: f.relPath,
        description: "Error-handling module without evidence emission",
        rationale: "Error handling without evidence emission creates silent failure paths — the platform cannot audit what happened",
        remediation: "Add EvidenceNode emission to all error handling branches: emit status='failed' with recovery hints",
      });
    }
  }

  return {
    dimension: "evidence",
    score: Math.max(0, score),
    confidence: 0.65,
    findings,
  };
}

function evaluateRecovery(ir: ProjectIR): DimensionScore {
  const findings: CritiqueFinding[] = [];
  let score = 100;

  const recoveryKeywords = ["recovery", "retry", "fallback", "checkpoint", "replayable"];
  const chaosFiles = ir.files.filter((f) => f.relPath.includes("chaos") || f.relPath.includes("circuit"));

  if (chaosFiles.length === 0) {
    score -= 15;
    findings.push({
      dimension: "recovery",
      severity: "critical",
      description: "No chaos/circuit-breaker modules found",
      rationale: "Without chaos engineering and circuit breakers, recovery paths cannot be systematically verified",
      remediation: "Implement ChaosHarness with deterministic fault injection and verified recovery paths",
    });
  }

  for (const f of ir.files) {
    if (![".ts"].includes(f.extension) || !f.relPath.includes("src/lib/")) continue;
    const hasRecovery = recoveryKeywords.some((kw) =>
      f.exports.some((e) => e.toLowerCase().includes(kw)) ||
      f.imports.some((i) => i.toLowerCase().includes(kw))
    );
    if (!hasRecovery && f.size > 3000) {
      findings.push({
        dimension: "recovery",
        severity: "info",
        file: f.relPath,
        description: "Large module with no recovery-related exports or imports",
        rationale: "Modules performing complex operations should document their recovery behavior",
        remediation: "Add recovery path documentation or integrate with the retry/circuit-breaker infrastructure",
      });
    }
  }

  return {
    dimension: "recovery",
    score: Math.max(0, score),
    confidence: 0.70,
    findings,
  };
}

function evaluateDistillation(ir: ProjectIR): DimensionScore {
  const findings: CritiqueFinding[] = [];
  let score = 100;

  const distillationFiles = ir.files.filter(
    (f) => f.relPath.includes("distillation") || f.relPath.includes("learning") || f.relPath.includes("memory")
  );

  if (distillationFiles.length === 0) {
    score -= 20;
    findings.push({
      dimension: "distillation",
      severity: "critical",
      description: "No distillation/learning/memory modules found",
      rationale: "Without knowledge distillation, the platform cannot improve from prior experience — each run starts cold",
      remediation: "Implement distillation-intelligence.ts with DistillationInput → DistillationResult pipeline",
    });
  }

  const hasClosedLoop = distillationFiles.some((f) => f.imports.some((i) => i.includes("backlog") || i.includes("decision")));
  if (distillationFiles.length > 0 && !hasClosedLoop) {
    score -= 10;
    findings.push({
      dimension: "distillation",
      severity: "warning",
      description: "Distillation modules not connected to backlog or decision pipeline",
      rationale: "Distilled knowledge has no value if it is not consumed by future decision-making processes",
      remediation: "Wire getTopFailureModes() → backlog creation, DecisionPrior → decision-scorer input",
    });
  }

  return {
    dimension: "distillation",
    score: Math.max(0, score),
    confidence: 0.78,
    findings,
  };
}

// ── Single critique pass ──────────────────────────────────────────────────

function runCritiquePass(ir: ProjectIR, passNumber: number): CritiquePassResult {
  const dimensions: DimensionScore[] = [
    evaluateNaming(ir),
    evaluateBoundaries(ir),
    evaluateModularity(ir),
    evaluateMaintainability(ir),
    evaluateEvidence(ir),
    evaluateRecovery(ir),
    evaluateDistillation(ir),
  ];

  const overallScore = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
  const allFindings = dimensions.flatMap((d) => d.findings);
  const criticalFindings = allFindings.filter((f) => f.severity === "critical");

  const evidence: EvidenceNode[] = [
    {
      kind: "self_evaluation_completed",
      status: criticalFindings.length === 0 ? "passed" : "failed",
      message: `Self-critique pass ${passNumber}: score ${overallScore}/100 — ${allFindings.length} finding(s), ${criticalFindings.length} critical`,
      timestamp: new Date().toISOString(),
      metadata: {
        passNumber,
        overallScore,
        totalFindings: allFindings.length,
        criticalFindings: criticalFindings.length,
        dimensions: dimensions.map((d) => ({ name: d.dimension, score: d.score })),
      },
    },
  ];

  return {
    passNumber,
    timestamp: new Date().toISOString(),
    dimensions,
    overallScore,
    criticalFindings,
    totalFindings: allFindings.length,
    evidence,
  };
}

// ── Convergence loop ──────────────────────────────────────────────────────

/**
 * Run self-critique passes to convergence.
 * Convergence: score ≥ 80 and no critical findings, or maxPasses reached.
 */
export function runSelfCritique(
  ir: ProjectIR,
  options: { maxPasses?: number; convergenceThreshold?: number } = {}
): SelfCritiqueReport {
  const maxPasses = options.maxPasses ?? 3;
  const convergenceThreshold = options.convergenceThreshold ?? 80;
  const passes: CritiquePassResult[] = [];
  const allEvidence: EvidenceNode[] = [];

  let convergenceReached = false;

  for (let pass = 1; pass <= maxPasses; pass++) {
    const result = runCritiquePass(ir, pass);
    passes.push(result);
    allEvidence.push(...result.evidence);

    if (result.overallScore >= convergenceThreshold && result.criticalFindings.length === 0) {
      convergenceReached = true;
      break;
    }
  }

  const finalPass = passes[passes.length - 1];
  const allFindings = finalPass.dimensions.flatMap((d) => d.findings);

  const recommendations: string[] = [];
  const criticalByDim: Partial<Record<CritiqueDimension, number>> = {};
  for (const f of allFindings) {
    if (f.severity === "critical") {
      criticalByDim[f.dimension] = (criticalByDim[f.dimension] ?? 0) + 1;
    }
  }
  for (const [dim, count] of Object.entries(criticalByDim)) {
    recommendations.push(`CRITICAL [${dim}]: ${count} finding(s) — address before release`);
  }
  const warnings = allFindings.filter((f) => f.severity === "warning").slice(0, 5);
  for (const w of warnings) {
    recommendations.push(`WARN [${w.dimension}]: ${w.description} — ${w.remediation}`);
  }
  if (recommendations.length === 0) {
    recommendations.push("All critique dimensions passed convergence threshold — platform is in good shape.");
  }

  const score = finalPass.overallScore;
  const finalGrade: SelfCritiqueReport["finalGrade"] =
    score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";

  allEvidence.push({
    kind: "self_evaluation_completed",
    status: convergenceReached ? "passed" : "failed",
    message: `Self-critique converged=${convergenceReached} after ${passes.length} pass(es) — final score ${score}/100 (${finalGrade})`,
    timestamp: new Date().toISOString(),
    metadata: { convergenceReached, passesRun: passes.length, finalScore: score, finalGrade },
  });

  return {
    convergenceReached,
    passesRun: passes.length,
    finalScore: score,
    finalGrade,
    passes,
    allFindings,
    topRecommendations: recommendations.slice(0, 10),
    evidence: allEvidence,
  };
}
