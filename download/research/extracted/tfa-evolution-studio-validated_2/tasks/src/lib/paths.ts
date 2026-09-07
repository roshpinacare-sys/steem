/**
 * TFA Evolution Studio v28 — Path Resolution & Directory Management
 *
 * All filesystem paths flow through here.
 * Guarantees workspace isolation, sandbox separation, and directory existence.
 *
 * Key invariant: application source code never lives under WORKSPACE_ROOT.
 * WORKSPACE_ROOT contains only runtime data: projects, sandboxes, artifacts,
 * evidence, audit logs, memory, traces, and job state.
 */

import fs from "fs";
import path from "path";

const WORKSPACE_ROOT = process.env.TFA_WORKSPACE_ROOT || "/tmp/tfa-studio-data";

const CONTROL_PLANE_FILE = path.join(WORKSPACE_ROOT, "control-plane.json");
const TEAMS_FILE = path.join(WORKSPACE_ROOT, "teams.json");
const REGISTRY_FILE = path.join(WORKSPACE_ROOT, "registry.json");
const PROVIDERS_FILE = path.join(WORKSPACE_ROOT, "providers.json");
const AUDIT_FILE = path.join(WORKSPACE_ROOT, "audit", "audit.ndjson");
const AUTOMATION_FILE = path.join(WORKSPACE_ROOT, "automation", "rules.json");
const AUTOMATION_LOG_FILE = path.join(WORKSPACE_ROOT, "automation", "logs.ndjson");

function ensureDir(dirPath: string): string {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function getProjectDir(projectId: string): string {
  return ensureDir(path.join(WORKSPACE_ROOT, "projects", projectId));
}

function getVersionProjectDir(projectId: string, versionId: string): string {
  return ensureDir(path.join(getProjectDir(projectId), "versions", versionId, "project"));
}

function getVersionArtifactsDir(projectId: string, versionId: string): string {
  return ensureDir(path.join(getProjectDir(projectId), "versions", versionId, "artifacts"));
}

function getVersionEvidenceDir(projectId: string, versionId: string): string {
  return ensureDir(path.join(getProjectDir(projectId), "versions", versionId, "evidence"));
}

function getProjectLearningDir(projectId: string): string {
  return ensureDir(path.join(getProjectDir(projectId), "learning"));
}

function getProjectOutcomesDir(projectId: string): string {
  return ensureDir(path.join(getProjectDir(projectId), "outcomes"));
}

function getProjectUploadsDir(projectId: string): string {
  return ensureDir(path.join(getProjectDir(projectId), "uploads"));
}

function getIntegrationDir(): string {
  return ensureDir(path.join(WORKSPACE_ROOT, "integrations"));
}

function getMemoryDir(): string {
  return ensureDir(path.join(WORKSPACE_ROOT, "memory"));
}

function getTracesDir(): string {
  return ensureDir(path.join(WORKSPACE_ROOT, "traces"));
}

function getApprovalsDir(): string {
  return ensureDir(path.join(WORKSPACE_ROOT, "approvals"));
}

function getRecipesDir(): string {
  return ensureDir(path.join(WORKSPACE_ROOT, "recipes"));
}

function getAssetsDir(): string {
  return ensureDir(path.join(WORKSPACE_ROOT, "assets"));
}

function getSandboxesRoot(): string {
  return ensureDir(path.join(WORKSPACE_ROOT, "sandboxes"));
}

function getProjectSandboxDir(projectId: string): string {
  return ensureDir(path.join(getSandboxesRoot(), projectId));
}

function getJobsDir(): string {
  return ensureDir(path.join(WORKSPACE_ROOT, "jobs"));
}

function getPortfolioDir(): string {
  return ensureDir(path.join(WORKSPACE_ROOT, "portfolio"));
}

function getProvenanceDir(projectId: string, versionId: string): string {
  return ensureDir(path.join(getProjectDir(projectId), "versions", versionId, "provenance"));
}

/**
 * Asserts that a given path resolves within WORKSPACE_ROOT.
 * Throws if the path escapes the workspace boundary (e.g. path traversal via ZIP).
 */
function assertWithinWorkspace(targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const workspaceResolved = path.resolve(WORKSPACE_ROOT);
  if (!resolved.startsWith(workspaceResolved)) {
    throw new Error(
      `[paths] Workspace boundary violation: "${resolved}" is outside "${workspaceResolved}". ` +
      `All runtime data must live under WORKSPACE_ROOT.`
    );
  }
}

export {
  WORKSPACE_ROOT,
  CONTROL_PLANE_FILE,
  TEAMS_FILE,
  REGISTRY_FILE,
  PROVIDERS_FILE,
  AUDIT_FILE,
  AUTOMATION_FILE,
  AUTOMATION_LOG_FILE,
  ensureDir,
  getProjectDir,
  getVersionProjectDir,
  getVersionArtifactsDir,
  getVersionEvidenceDir,
  getProjectLearningDir,
  getProjectOutcomesDir,
  getProjectUploadsDir,
  getIntegrationDir,
  getMemoryDir,
  getTracesDir,
  getApprovalsDir,
  getRecipesDir,
  getAssetsDir,
  getSandboxesRoot,
  getProjectSandboxDir,
  getJobsDir,
  getPortfolioDir,
  getProvenanceDir,
  assertWithinWorkspace,
};
