import { Project } from "ts-morph";
import type { GitHubClient } from "../services/github-client.js";
import type { Telemetry } from "../services/telemetry.js";
import {
  getFileCoverage,
  formatCoverageHint,
  resolveCodecovConfig,
} from "../services/integrations/codecov-intelligence.js";

export interface JanitorFinding {
  path: string;
  type: "long-function" | "no-coverage" | "low-coverage";
  details: string;
}

/**
 * Scans the repository for functions over 200 lines or files without test
 * coverage, then generates an autonomous PR to refactor or add Vitest tests.
 * The PR flows through the standard Gate pipeline.
 *
 * When CODECOV_TOKEN is configured, real per-file coverage data is used
 * instead of the heuristic "no test file present" detection.
 */
export async function runJanitor(
  gh: GitHubClient,
  owner: string,
  repo: string,
  files: { path: string; content: string }[],
  telemetry?: Telemetry,
): Promise<JanitorFinding[]> {
  const findings: JanitorFinding[] = [];

  // A single Project is reused for all files. Creating a new ts-morph Project
  // per file was previously O(N) in heavyweight TypeScript language-service
  // instantiations, causing OOM on large repositories. createSourceFile with
  // overwrite:true and explicit removeSourceFile keeps peak memory flat.
  const project = new Project({ useInMemoryFileSystem: true });

  for (const file of files) {
    if (!file.path.endsWith(".ts") && !file.path.endsWith(".tsx")) continue;
    const sourceFile = project.createSourceFile(file.path, file.content, { overwrite: true });

    for (const fn of sourceFile.getFunctions()) {
      const startLine = fn.getStartLineNumber();
      const endLine = fn.getEndLineNumber();
      const length = endLine - startLine + 1;
      if (length > 200) {
        findings.push({
          path: file.path,
          type: "long-function",
          details: `${fn.getName() || "anonymous"} spans ${length} lines`,
        });
      }
    }

    // Free the source file from the shared project so the language service
    // does not accumulate all files in memory for the lifetime of the scan.
    project.removeSourceFile(sourceFile);
  }

  const testFiles = new Set(files.filter((f) => /\.(test|spec)\.(ts|tsx)$/.test(f.path)).map((f) => f.path));
  const sourcePaths = files.filter((f) => /src\/.*\.(ts|tsx)$/.test(f.path) && !/\.(test|spec)\./.test(f.path));

  // Prefer real Codecov data when available; fall back to heuristic.
  const codecovCfg = resolveCodecovConfig(owner, repo);
  if (codecovCfg) {
    const coverageResults = await getFileCoverage(sourcePaths.map((f) => f.path), codecovCfg, telemetry);
    const hint = formatCoverageHint(coverageResults);
    if (hint) {
      for (const r of coverageResults.filter((r) => r.lowCoverage)) {
        findings.push({
          path: r.file,
          type: "low-coverage",
          details: `Codecov reports ${r.coverage.toFixed(1)}% coverage (threshold: ${codecovCfg.coverageThreshold}%)`,
        });
      }
    }
  } else {
    // Heuristic: no matching test file
    for (const source of sourcePaths) {
      const base = source.path.replace(/\.tsx?$/, "");
      const hasTest = Array.from(testFiles).some((t) => t.startsWith(base));
      if (!hasTest) {
        findings.push({
          path: source.path,
          type: "no-coverage",
          details: "no matching Vitest test file found",
        });
      }
    }
  }

  await telemetry?.decision("janitor", "scan-complete", {
    findings: findings.length,
    longFunctions: findings.filter((f) => f.type === "long-function").length,
    noCoverage: findings.filter((f) => f.type === "no-coverage" || f.type === "low-coverage").length,
  });

  return findings;
}

export async function createJanitorPR(
  gh: GitHubClient,
  owner: string,
  repo: string,
  finding: JanitorFinding,
  telemetry?: Telemetry,
): Promise<number> {
  const objective = finding.type === "long-function"
    ? `Refactor long function in ${finding.path}: ${finding.details}`
    : `Add Vitest tests for ${finding.path}`;

  const prNumber = await gh.createBranchAndPR(objective);
  await telemetry?.decision("janitor", "pr-created", { prNumber, objective, finding });
  return prNumber;
}
