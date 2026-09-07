import { log } from "../services/logger.js";
import { GitHubClient } from "../services/github-client.js";
import { R2Storage } from "../services/r2-storage.js";
import type { Telemetry } from "../services/telemetry.js";

// ---------------------------------------------------------------------------
// Finding types
// ---------------------------------------------------------------------------

export type FindingSeverity = "high" | "medium" | "low";

export interface ComplianceFinding {
  file: string;
  rule: string;
  severity: FindingSeverity;
  description: string;
  fix: string;
  fixedContent: string;
}

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

/**
 * Dockerfile rule: running as root is a high-severity security finding.
 * Fixes by inserting `USER 10001` before the last CMD/ENTRYPOINT instruction.
 */
function scanDockerfile(path: string, content: string): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  const hasUser = /^\s*USER\s+(?!root\b)\S+/m.test(content);
  if (!hasUser) {
    // Insert USER directive before the last CMD or ENTRYPOINT line.
    const fixedContent = content.replace(
      /(^(?:CMD|ENTRYPOINT)\s.+)/m,
      "USER 10001\n$1",
    );
    findings.push({
      file: path,
      rule: "dockerfile-no-root",
      severity: "high",
      description: "Dockerfile does not specify a non-root USER. Container runs as root.",
      fix: "Insert `USER 10001` before CMD/ENTRYPOINT.",
      fixedContent,
    });
  }
  return findings;
}

/**
 * GitHub Actions rule: workflows without `timeout-minutes` can run indefinitely,
 * blocking runners and accruing cost.
 */
function scanWorkflow(path: string, content: string): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  // Each `- uses:` or `- run:` step that lacks a timeout-minutes key.
  const hasJobTimeout = /timeout-minutes\s*:/m.test(content);
  if (!hasJobTimeout) {
    // Inject a 30-minute timeout after each `jobs:` block's first `runs-on:`.
    const fixedContent = content.replace(
      /(runs-on\s*:.+)/g,
      "$1\n    timeout-minutes: 30",
    );
    findings.push({
      file: path,
      rule: "workflow-missing-timeout",
      severity: "medium",
      description: `Workflow "${path}" has no timeout-minutes set on its jobs.`,
      fix: "Add `timeout-minutes: 30` to each job.",
      fixedContent,
    });
  }
  return findings;
}

/**
 * Kubernetes manifest rule: pods without resource requests/limits are
 * unschedulable on resource-constrained clusters and cause node OOM.
 */
function scanK8sManifest(path: string, content: string): ComplianceFinding[] {
  const findings: ComplianceFinding[] = [];
  const hasResources = /resources\s*:/m.test(content);
  if (!hasResources) {
    // Append a resources block after the last `image:` line.
    const fixedContent = content.replace(
      /(image\s*:.+)/g,
      `$1\n        resources:\n          requests:\n            cpu: "100m"\n            memory: "128Mi"\n          limits:\n            cpu: "500m"\n            memory: "512Mi"`,
    );
    findings.push({
      file: path,
      rule: "k8s-missing-resources",
      severity: "high",
      description: `Kubernetes manifest "${path}" is missing resource requests/limits.`,
      fix: "Add resource requests and limits to all container specs.",
      fixedContent,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Scanner orchestrator
// ---------------------------------------------------------------------------

async function fetchFiles(
  gh: GitHubClient,
  paths: string[],
  ref = "HEAD",
): Promise<{ path: string; content: string }[]> {
  const results: { path: string; content: string }[] = [];
  for (const path of paths) {
    const content = await gh.getFileAtRef(path, ref).catch(() => null);
    if (content !== null) results.push({ path, content });
  }
  return results;
}

/**
 * Runs all compliance rules against fetched repo files and returns every
 * finding that requires remediation.
 */
export async function runComplianceScan(
  gh: GitHubClient,
  telemetry?: Telemetry,
): Promise<ComplianceFinding[]> {
  const findings: ComplianceFinding[] = [];

  // Fetch all files at HEAD and filter by pattern.
  const allFiles = await gh.listFilesAtRef("HEAD").catch(() => [] as string[]);

  const dockerfiles  = allFiles.filter((f) => /^Dockerfile(\.[\w-]+)?$/.test(f));
  const workflows    = allFiles.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f));
  const k8sManifests = allFiles.filter((f) => /^k8s\/.+\.ya?ml$/.test(f));

  const fetched = await fetchFiles(gh, [...dockerfiles, ...workflows, ...k8sManifests]);

  for (const { path, content } of fetched) {
    let fileFindings: ComplianceFinding[] = [];

    if (/^Dockerfile/.test(path)) {
      fileFindings = scanDockerfile(path, content);
    } else if (/^\.github\/workflows\//.test(path)) {
      fileFindings = scanWorkflow(path, content);
    } else if (/^k8s\//.test(path)) {
      fileFindings = scanK8sManifest(path, content);
    }

    findings.push(...fileFindings);
    for (const f of fileFindings) {
      await telemetry?.decision("compliance-oracle", "finding", {
        file: f.file,
        rule: f.rule,
        severity: f.severity,
      });
    }
  }

  log.info("compliance-oracle: scan complete", { findings: findings.length });
  return findings;
}

// ---------------------------------------------------------------------------
// PR creator
// ---------------------------------------------------------------------------

/**
 * For each compliance finding, opens a dedicated fix PR using the existing
 * GitHubClient.createBranchAndPR + commitViaGitDB pipeline.
 */
export async function openCompliancePRs(
  gh: GitHubClient,
  storage: R2Storage,
  findings: ComplianceFinding[],
  telemetry?: Telemetry,
): Promise<void> {
  for (const finding of findings) {
    const title = `fix(compliance): ${finding.rule} in ${finding.file}`;
    try {
      const prNumber = await gh.createBranchAndPR(title);
      await gh.commitViaGitDB(
        prNumber,
        [{ path: finding.file, content: finding.fixedContent }],
        `qodo(compliance): ${finding.description}`,
      );
      await gh.comment(
        prNumber,
        `## 🛡️ Compliance Oracle Finding\n\n` +
        `**Rule:** \`${finding.rule}\`  \n` +
        `**Severity:** ${finding.severity}  \n` +
        `**File:** \`${finding.file}\`  \n\n` +
        `**Description:** ${finding.description}  \n` +
        `**Fix Applied:** ${finding.fix}`,
      );

      // Archive finding in R2 for audit trail.
      await storage.putText(
        `compliance/${finding.rule}/${finding.file.replace(/\//g, "_")}-${Date.now()}.json`,
        JSON.stringify({ finding, prNumber }, null, 2),
      );

      await telemetry?.decision("compliance-oracle", "pr-opened", {
        rule: finding.rule,
        file: finding.file,
        prNumber,
      });
      log.info("compliance-oracle: opened PR", { prNumber, rule: finding.rule, file: finding.file });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error("compliance-oracle: failed to open PR", { rule: finding.rule, error: msg });
    }
  }
}
