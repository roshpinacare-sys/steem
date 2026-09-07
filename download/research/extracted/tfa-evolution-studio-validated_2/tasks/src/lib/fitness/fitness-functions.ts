/**
 * TFA Evolution Studio v30 — Architectural Fitness Functions
 *
 * WS2: Static analysis fitness functions that enforce coupling, complexity,
 * dependency, and debt thresholds. Intended to be run on every cycle as a
 * continuous architectural health gate — not just at release time.
 *
 * Functions implemented:
 *   measureCoupling          — afferent/efferent coupling + instability score
 *   measureComplexity        — cyclomatic proxy from IR file structure
 *   detectDependencyCycles   — strongly connected component detection
 *   measureTechnicalDebt     — LOC-weighted debt hours estimate
 *   enforceFunctionSizeGate  — flag functions exceeding line threshold
 *   computeArchHealthScore   — composite 0-100 architectural health score
 *   runFitnessSuite          — run all functions and produce a gate result
 */

import type { ProjectIR } from "@/lib/compiler/project-ir";
import type { ArchGraph } from "@/lib/types";
import type { EvidenceNode } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────

export interface CouplingMetrics {
  /** Afferent coupling: number of external modules that depend on this module. */
  afferent: Record<string, number>;
  /** Efferent coupling: number of modules this module depends on. */
  efferent: Record<string, number>;
  /** Instability = Ce / (Ca + Ce). 0 = stable, 1 = unstable. */
  instability: Record<string, number>;
  /** Modules with instability > 0.80 flagged as high-coupling risks. */
  highCouplingRisks: string[];
}

export interface ComplexityMetrics {
  /** Per-file cyclomatic complexity proxy (import count + export count + size/500). */
  fileComplexity: Record<string, number>;
  avgComplexity: number;
  maxComplexity: number;
  hotspots: string[];
}

export interface DependencyCycle {
  cycle: string[];
  severity: "low" | "medium" | "high";
}

export interface TechnicalDebtMetrics {
  /** Estimated remediation hours across all files. */
  totalDebtHours: number;
  /** Debt per file (hours). */
  fileDebt: Record<string, number>;
  /** Files with highest debt contribution. */
  topDebtFiles: string[];
  debtIndex: number;
}

export interface FunctionSizeViolation {
  file: string;
  estimatedLines: number;
  threshold: number;
}

export interface ArchHealthScore {
  /** Composite 0-100 score. ≥80 = healthy, 60-79 = warning, <60 = critical. */
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  dimensions: {
    coupling: number;
    complexity: number;
    cycleFreedom: number;
    debtBurden: number;
    functionSize: number;
  };
}

export interface FitnessGateResult {
  passed: boolean;
  score: ArchHealthScore;
  coupling: CouplingMetrics;
  complexity: ComplexityMetrics;
  cycles: DependencyCycle[];
  debt: TechnicalDebtMetrics;
  sizeViolations: FunctionSizeViolation[];
  evidence: EvidenceNode[];
  blockers: string[];
  warnings: string[];
}

// ── Coupling analysis ─────────────────────────────────────────────────────

/**
 * Compute afferent/efferent coupling and instability for each module.
 * Uses the IR import graph as the dependency source.
 */
export function measureCoupling(ir: ProjectIR): CouplingMetrics {
  const afferent: Record<string, number> = {};
  const efferent: Record<string, number> = {};

  for (const file of ir.files) {
    const key = file.relPath;
    const externalImports = file.imports.filter((i) => !i.startsWith(".")).length;
    const relativeImports = file.imports.filter((i) => i.startsWith(".")).length;
    efferent[key] = externalImports + relativeImports * 0.5;

    for (const imp of file.imports) {
      if (imp.startsWith(".")) {
        afferent[imp] = (afferent[imp] ?? 0) + 1;
      }
    }
  }

  const instability: Record<string, number> = {};
  const highCouplingRisks: string[] = [];

  for (const key of Object.keys(efferent)) {
    const ca = afferent[key] ?? 0;
    const ce = efferent[key] ?? 0;
    const inst = ca + ce === 0 ? 0 : ce / (ca + ce);
    instability[key] = Math.round(inst * 100) / 100;
    if (inst > 0.80) highCouplingRisks.push(key);
  }

  return { afferent, efferent, instability, highCouplingRisks };
}

// ── Complexity analysis ───────────────────────────────────────────────────

/**
 * Compute a cyclomatic complexity proxy per file.
 * Proxy = (import count × 1.5) + (export count) + (size / 500).
 */
export function measureComplexity(ir: ProjectIR): ComplexityMetrics {
  const fileComplexity: Record<string, number> = {};

  for (const file of ir.files) {
    if (![".ts", ".tsx", ".js", ".jsx", ".py"].includes(file.extension)) continue;
    const complexity = file.imports.length * 1.5 + file.exports.length + file.size / 500;
    fileComplexity[file.relPath] = Math.round(complexity * 10) / 10;
  }

  const values = Object.values(fileComplexity);
  const avg = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const threshold = avg * 2.5;

  const hotspots = Object.entries(fileComplexity)
    .filter(([, v]) => v > threshold)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([k]) => k);

  return {
    fileComplexity,
    avgComplexity: Math.round(avg * 10) / 10,
    maxComplexity: Math.round(max * 10) / 10,
    hotspots,
  };
}

// ── Dependency cycle detection ─────────────────────────────────────────────

/**
 * Detect dependency cycles using Tarjan's SCC algorithm applied to the
 * relative import graph derived from the IR.
 */
export function detectDependencyCycles(ir: ProjectIR): DependencyCycle[] {
  const index: Record<string, number> = {};
  const lowlink: Record<string, number> = {};
  const onStack: Record<string, boolean> = {};
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  const adj: Record<string, string[]> = {};
  for (const file of ir.files) {
    adj[file.relPath] = file.imports
      .filter((i) => i.startsWith("."))
      .map((i) => i.replace(/^\.\//, ""));
  }

  function strongconnect(v: string) {
    index[v] = lowlink[v] = counter++;
    stack.push(v);
    onStack[v] = true;

    for (const w of adj[v] ?? []) {
      if (!(w in index)) {
        strongconnect(w);
        lowlink[v] = Math.min(lowlink[v], lowlink[w]);
      } else if (onStack[w]) {
        lowlink[v] = Math.min(lowlink[v], index[w]);
      }
    }

    if (lowlink[v] === index[v]) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack[w] = false;
        scc.push(w);
      } while (w !== v);
      if (scc.length > 1) sccs.push(scc);
    }
  }

  for (const node of Object.keys(adj)) {
    if (!(node in index)) strongconnect(node);
  }

  return sccs.map((cycle) => ({
    cycle,
    severity: cycle.length > 5 ? "high" : cycle.length > 2 ? "medium" : "low" as "low" | "medium" | "high",
  }));
}

// ── Technical debt measurement ────────────────────────────────────────────

interface DebtRule {
  name: string;
  match: (f: ProjectIR["files"][number]) => boolean;
  costPer100: number;
}

const DEBT_RULES: DebtRule[] = [
  { name: "large_file",        match: (f) => f.size > 10_000, costPer100: 0.5 },
  { name: "no_exports",        match: (f) => f.exports.length === 0 && [".ts", ".tsx"].includes(f.extension), costPer100: 0.2 },
  { name: "high_import_count", match: (f) => f.imports.length > 15, costPer100: 0.3 },
];

/**
 * Estimate technical debt in remediation hours using weighted LOC-per-file analysis.
 */
export function measureTechnicalDebt(ir: ProjectIR): TechnicalDebtMetrics {
  const fileDebt: Record<string, number> = {};

  for (const file of ir.files) {
    if (![".ts", ".tsx", ".js", ".jsx"].includes(file.extension)) continue;
    const approxLoc = file.size / 30;
    let hours = 0;
    for (const rule of DEBT_RULES) {
      if (rule.match(file)) hours += (approxLoc / 100) * rule.costPer100;
    }
    if (hours > 0) fileDebt[file.relPath] = Math.round(hours * 10) / 10;
  }

  const totalDebtHours = Object.values(fileDebt).reduce((s, v) => s + v, 0);
  const topDebtFiles = Object.entries(fileDebt)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([k]) => k);

  const fileCount = ir.files.filter((f) => [".ts", ".tsx", ".js", ".jsx"].includes(f.extension)).length;
  const debtIndex = fileCount > 0 ? Math.round((totalDebtHours / fileCount) * 10) / 10 : 0;

  return { totalDebtHours: Math.round(totalDebtHours * 10) / 10, fileDebt, topDebtFiles, debtIndex };
}

// ── Function size gate ────────────────────────────────────────────────────

const FUNCTION_SIZE_THRESHOLD_LINES = 80;

/**
 * Flag files whose estimated average function size exceeds the threshold.
 * Uses size/export count as a proxy for average function length.
 */
export function enforceFunctionSizeGate(
  ir: ProjectIR,
  threshold: number = FUNCTION_SIZE_THRESHOLD_LINES
): FunctionSizeViolation[] {
  const violations: FunctionSizeViolation[] = [];

  for (const file of ir.files) {
    if (![".ts", ".tsx", ".js", ".jsx"].includes(file.extension)) continue;
    const exportCount = Math.max(1, file.exports.length);
    const approxLoc = file.size / 30;
    const avgFnLines = approxLoc / exportCount;
    if (avgFnLines > threshold) {
      violations.push({ file: file.relPath, estimatedLines: Math.round(avgFnLines), threshold });
    }
  }

  return violations.sort((a, b) => b.estimatedLines - a.estimatedLines);
}

// ── Composite health score ────────────────────────────────────────────────

function gradeScore(score: number): ArchHealthScore["grade"] {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Produce a 0-100 composite architectural health score.
 * Each of the five fitness dimensions contributes 20 points maximum.
 */
export function computeArchHealthScore(
  coupling: CouplingMetrics,
  complexity: ComplexityMetrics,
  cycles: DependencyCycle[],
  debt: TechnicalDebtMetrics,
  sizeViolations: FunctionSizeViolation[]
): ArchHealthScore {
  const couplingScore = Math.max(0, 20 - coupling.highCouplingRisks.length * 2);
  const complexityScore = Math.max(0, 20 - Math.min(20, complexity.avgComplexity * 0.5));
  const cycleDeduction = cycles.reduce(
    (d, c) => d + (c.severity === "high" ? 5 : c.severity === "medium" ? 3 : 1),
    0
  );
  const cycleScore = Math.max(0, 20 - cycleDeduction);
  const debtScore = Math.max(0, 20 - Math.min(20, debt.debtIndex * 4));
  const sizeScore = Math.max(0, 20 - sizeViolations.length * 2);
  const total = Math.round(couplingScore + complexityScore + cycleScore + debtScore + sizeScore);

  return {
    score: Math.min(100, total),
    grade: gradeScore(total),
    dimensions: {
      coupling: Math.round(couplingScore),
      complexity: Math.round(complexityScore),
      cycleFreedom: Math.round(cycleScore),
      debtBurden: Math.round(debtScore),
      functionSize: Math.round(sizeScore),
    },
  };
}

// ── Arch graph builder ────────────────────────────────────────────────────

/**
 * Build an ArchGraph from a ProjectIR for use in architecture visualization.
 */
export function buildArchGraph(ir: ProjectIR): ArchGraph {
  const nodes = ir.files
    .filter((f) => [".ts", ".tsx", ".js", ".jsx"].includes(f.extension))
    .map((f) => ({
      id: f.relPath,
      label: f.relPath.split("/").pop() ?? f.relPath,
      type: "module" as const,
      metrics: { size: f.size, imports: f.imports.length, exports: f.exports.length },
    }));

  const edges: ArchGraph["edges"] = [];
  for (const file of ir.files) {
    for (const imp of file.imports) {
      if (imp.startsWith(".")) {
        edges.push({ from: file.relPath, to: imp, type: "import" });
      }
    }
  }

  return { nodes, edges };
}

// ── Fitness suite gate ─────────────────────────────────────────────────────

/**
 * Run all fitness functions against a ProjectIR and return a consolidated
 * gate result with evidence nodes, blockers, and warnings.
 */
export function runFitnessSuite(ir: ProjectIR): FitnessGateResult {
  const coupling      = measureCoupling(ir);
  const complexity    = measureComplexity(ir);
  const cycles        = detectDependencyCycles(ir);
  const debt          = measureTechnicalDebt(ir);
  const sizeViolations = enforceFunctionSizeGate(ir);
  const score         = computeArchHealthScore(coupling, complexity, cycles, debt, sizeViolations);

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (score.score < 60) {
    blockers.push(`Architectural health score ${score.score}/100 is below the minimum threshold (60)`);
  }
  const highCycles = cycles.filter((c) => c.severity === "high");
  if (highCycles.length > 0) {
    blockers.push(`${highCycles.length} high-severity dependency cycle(s) detected — must be resolved before release`);
  }
  if (score.score < 80) {
    warnings.push(`Architectural health score ${score.score}/100 is below recommended threshold (80)`);
  }
  if (coupling.highCouplingRisks.length > 5) {
    warnings.push(`${coupling.highCouplingRisks.length} high-coupling modules detected — consider decomposition`);
  }
  if (debt.debtIndex > 3) {
    warnings.push(`Technical debt index ${debt.debtIndex} hrs/file is elevated — schedule remediation`);
  }

  const passed = blockers.length === 0;
  const evidence: EvidenceNode[] = [
    {
      kind: "arch_graph_built",
      status: passed ? "passed" : "failed",
      message: `Architectural fitness gate: score ${score.score}/100 (${score.grade}) — ${passed ? "PASSED" : "BLOCKED"}`,
      timestamp: new Date().toISOString(),
      metadata: {
        score: score.score,
        grade: score.grade,
        blockers: blockers.length,
        warnings: warnings.length,
        dimensions: score.dimensions,
        cycles: cycles.length,
        highCycles: highCycles.length,
        debtHours: debt.totalDebtHours,
        hotspots: complexity.hotspots.slice(0, 5),
      },
    },
    {
      kind: "dependency_graph_verified",
      status: highCycles.length === 0 ? "passed" : "failed",
      message: `Dependency cycles: ${cycles.length} total, ${highCycles.length} high-severity`,
      timestamp: new Date().toISOString(),
      metadata: { cycles: cycles.length, highCycles: highCycles.length },
    },
  ];

  return { passed, score, coupling, complexity, cycles, debt, sizeViolations, evidence, blockers, warnings };
}
