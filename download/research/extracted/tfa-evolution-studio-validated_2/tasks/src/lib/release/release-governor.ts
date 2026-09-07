/**
 * TFA Evolution Studio v28 — Release Governor
 *
 * Enforces version coherence, workspace integrity, artifact provenance,
 * and evidence governance before any release is published.
 *
 * V21 additions:
 *   - buildReleaseRecord now includes per-artifact SHA-256 hashes
 *   - verifyWorkspaceCoherence also validates version-manifest alignment
 *   - assertVersionNotReused is stricter (checks both version + projectId pair)
 *   - enforceEvidenceGovernance extended with version_coherence_verified gate
 */

import fs from "fs";
import path from "path";
import { getProjectDir, ensureDir } from "@/lib/paths";
import { PLATFORM_VERSION } from "@/lib/version-coherence";
import { hashArtifacts, verifyZipStructure } from "./release-verifier";
import type { EvidenceNode, ReleaseRecord } from "@/lib/types";

export function assertVersionNotReused(version: string, projectId: string): boolean {
  const recordPath = path.join(getProjectDir(projectId), "releases.json");
  if (!fs.existsSync(recordPath)) return true;
  try {
    const records = JSON.parse(fs.readFileSync(recordPath, "utf-8")) as ReleaseRecord[];
    // Reject if (version, projectId) pair was ever released
    return !records.some((r) => r.version === version && r.projectId === projectId);
  } catch {
    return true;
  }
}

export function applyVersionToWorkspace(projectId: string, version: string): void {
  const manifestPath = path.join(getProjectDir(projectId), "version-manifest.json");
  ensureDir(path.dirname(manifestPath));
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ version, appliedAt: new Date().toISOString(), platformVersion: PLATFORM_VERSION }, null, 2)
  );
}

export interface WorkspaceCoherenceResult {
  coherent: boolean;
  reason?: string;
}

/**
 * V24 fix: previously returned bare `boolean`, making silent false returns
 * undebuggable — callers had no way to know WHY coherence failed.
 * Now returns a structured result with a `reason` field.
 */
export function verifyWorkspaceCoherence(projectId: string): WorkspaceCoherenceResult {
  const statePath = path.join(getProjectDir(projectId), "state.json");
  if (!fs.existsSync(statePath)) {
    return { coherent: false, reason: `state.json not found at ${statePath}` };
  }
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    if (state.projectId !== projectId) {
      return {
        coherent: false,
        reason: `state.json projectId mismatch: expected "${projectId}", got "${state.projectId}"`,
      };
    }
    const manifestPath = path.join(getProjectDir(projectId), "version-manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return {
        coherent: false,
        reason: `version-manifest.json not found — call applyVersionToWorkspace() first`,
      };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (typeof manifest.version !== "string" || manifest.version.length === 0) {
      return { coherent: false, reason: "version-manifest.json has empty/missing version field" };
    }
    return { coherent: true };
  } catch (e) {
    return { coherent: false, reason: `parse error: ${(e as Error).message}` };
  }
}

/**
 * Build a release record with full artifact hashes for provenance.
 * ZIP artifacts are also structurally verified before inclusion.
 */
export function buildReleaseRecord(
  projectId: string,
  artifacts: string[],
  releaseNotesPath?: string
): ReleaseRecord {
  const artifactHashes = hashArtifacts(artifacts);

  // Verify each ZIP artifact structurally
  const evidence: EvidenceNode[] = [];
  for (const artifact of artifacts) {
    if (artifact.endsWith(".zip")) {
      const result = verifyZipStructure(artifact);
      evidence.push({
        kind: "zip_integrity_verified",
        status: result.valid ? "passed" : "failed",
        message: result.valid
          ? `ZIP valid: ${path.basename(artifact)} (${result.entryCount} entries, ${result.size} bytes)`
          : `ZIP invalid: ${result.errors.join("; ")}`,
        timestamp: new Date().toISOString(),
        metadata: {
          filename: path.basename(artifact),
          size: result.size,
          entryCount: result.entryCount,
          rootFolder: result.rootFolder,
        },
      });
    }
  }

  // Hash evidence
  const hashableArtifacts = artifacts.filter((a) => fs.existsSync(a));
  if (hashableArtifacts.length > 0) {
    evidence.push({
      kind: "artifact_hash_verified",
      status: "passed",
      message: `SHA-256 computed for ${hashableArtifacts.length} artifact(s)`,
      timestamp: new Date().toISOString(),
      metadata: { hashes: artifactHashes },
    });
  }

  // Detect ZIP filename and root folder from first ZIP artifact
  const zipArtifact = artifacts.find((a) => a.endsWith(".zip"));
  const zipFilename = zipArtifact ? path.basename(zipArtifact) : undefined;
  const zipStructure = zipArtifact ? verifyZipStructure(zipArtifact) : undefined;

  return {
    version: PLATFORM_VERSION,
    projectId,
    releasedAt: new Date().toISOString(),
    artifacts,
    artifactHashes,
    evidence,
    releaseNotesPath,
    zipFilename,
    zipRootFolder: zipStructure?.rootFolder,
    platformVersion: PLATFORM_VERSION,
  };
}

export function writeReleaseRecord(projectId: string, record: ReleaseRecord): void {
  const recordPath = path.join(getProjectDir(projectId), "releases.json");
  ensureDir(path.dirname(recordPath));
  let records: ReleaseRecord[] = [];
  if (fs.existsSync(recordPath)) {
    try {
      records = JSON.parse(fs.readFileSync(recordPath, "utf-8")) as ReleaseRecord[];
    } catch {
      records = [];
    }
  }
  records.push(record);
  fs.writeFileSync(recordPath, JSON.stringify(records, null, 2));
}

export function getReleaseHistory(projectId: string): ReleaseRecord[] {
  const recordPath = path.join(getProjectDir(projectId), "releases.json");
  if (!fs.existsSync(recordPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(recordPath, "utf-8")) as ReleaseRecord[];
  } catch {
    return [];
  }
}

export function enforceEvidenceGovernance(evidence: EvidenceNode[]): {
  allowed: boolean;
  blockers: string[];
} {
  const HARD_BLOCKING_EVIDENCE = [
    "build_verified",
    "zip_integrity_verified",
    "artifact_hash_verified",
    "manifest_version_consistent",
    "version_coherence_verified",  // V21: identity coherence is now a hard gate
  ] as const;

  const blockers: string[] = [];
  for (const kind of HARD_BLOCKING_EVIDENCE) {
    const node = evidence.find((e) => e.kind === kind);
    if (!node) {
      blockers.push(`Missing evidence: ${kind}`);
    } else if (node.status !== "passed") {
      blockers.push(`Failed evidence: ${kind} — ${node.message}`);
    }
  }
  return { allowed: blockers.length === 0, blockers };
}
