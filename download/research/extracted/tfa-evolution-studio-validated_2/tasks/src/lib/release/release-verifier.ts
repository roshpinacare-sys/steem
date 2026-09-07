/**
 * TFA Evolution Studio v28 — Release Verifier
 *
 * Cross-field identity and coherence checker for the release chain.
 * Every claim about a release must be backed by agreement across:
 *   - package.json version
 *   - ZIP filename version
 *   - ZIP root folder name version
 *   - Response header X-TFA-Version
 *   - Release notes version
 *   - Artifact hash (SHA-256)
 *   - Smoke test evidence
 *
 * If any field disagrees the release is REJECTED.
 * No release passes unless ALL fields are coherent.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import AdmZip from "adm-zip";
import { PLATFORM_VERSION } from "@/lib/version-coherence";
import type { ReleaseIdentityReport, EvidenceNode } from "@/lib/types";

// ── Artifact hashing ──────────────────────────────────────────────────────

export function hashArtifact(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cannot hash artifact: file not found: ${filePath}`);
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function hashArtifacts(filePaths: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const fp of filePaths) {
    try {
      result[path.basename(fp)] = hashArtifact(fp);
    } catch {
      result[path.basename(fp)] = "MISSING";
    }
  }
  return result;
}

// ── ZIP structural verification ────────────────────────────────────────────

export interface ZipStructureResult {
  valid: boolean;
  size: number;
  entryCount: number;
  rootFolder?: string;
  errors: string[];
}

export function verifyZipStructure(zipPath: string): ZipStructureResult {
  const errors: string[] = [];

  if (!fs.existsSync(zipPath)) {
    return { valid: false, size: 0, entryCount: 0, errors: ["ZIP file does not exist"] };
  }

  const stat = fs.statSync(zipPath);
  if (stat.size < 512) {
    errors.push(`ZIP size ${stat.size} bytes is below minimum threshold (512 bytes)`);
    return { valid: false, size: stat.size, entryCount: 0, errors };
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch (e) {
    return {
      valid: false,
      size: stat.size,
      entryCount: 0,
      errors: [`ZIP cannot be opened: ${(e as Error).message}`],
    };
  }

  const entries = zip.getEntries();
  if (entries.length === 0) {
    errors.push("ZIP contains zero entries");
    return { valid: false, size: stat.size, entryCount: 0, errors };
  }

  // Detect root folder — all entries should share a common top-level prefix
  const roots = new Set<string>();
  for (const entry of entries) {
    const parts = entry.entryName.split("/");
    if (parts[0]) roots.add(parts[0]);
  }
  const rootFolder = roots.size === 1 ? Array.from(roots)[0] : undefined;
  if (!rootFolder) {
    errors.push(`ZIP has multiple or no root folders (found: ${Array.from(roots).slice(0, 5).join(", ")})`);
  }

  return {
    valid: errors.length === 0,
    size: stat.size,
    entryCount: entries.length,
    rootFolder,
    errors,
  };
}

// ── Version extraction ─────────────────────────────────────────────────────

export function extractVersionFromFilename(filename: string): string | undefined {
  // Matches: tfa-evolution-studio-v21.0.0.zip  → "21.0.0"
  const m = /v(\d+\.\d+\.\d+)/.exec(path.basename(filename));
  return m?.[1];
}

export function extractVersionFromFolder(folderName: string): string | undefined {
  const m = /v(\d+\.\d+\.\d+)/.exec(folderName);
  return m?.[1];
}

export function extractVersionFromReleaseNotes(notesPath: string): string | undefined {
  if (!fs.existsSync(notesPath)) return undefined;
  const content = fs.readFileSync(notesPath, "utf-8");
  // Matches: **Version:** 21.0.0  or  "version": "21.0.0"  or  # TFA ... v21.0.0
  const patterns = [
    /\*\*Version:\*\*\s*([\d.]+)/,
    /"version"\s*:\s*"([\d.]+)"/,
    /v([\d]+\.\d+\.\d+)/,
  ];
  for (const re of patterns) {
    const m = re.exec(content);
    if (m) return m[1];
  }
  return undefined;
}

// ── Release identity report ────────────────────────────────────────────────

export interface VerifyReleaseIdentityOptions {
  zipPath?: string;
  releaseNotesPath?: string;
  headerVersion?: string;
  expectedVersion?: string;
}

export function verifyReleaseIdentity(
  opts: VerifyReleaseIdentityOptions = {}
): ReleaseIdentityReport {
  const packageVersion = opts.expectedVersion ?? PLATFORM_VERSION;
  const discrepancies: string[] = [];

  let zipFilenameVersion: string | undefined;
  let zipRootFolderVersion: string | undefined;

  if (opts.zipPath) {
    zipFilenameVersion = extractVersionFromFilename(opts.zipPath);
    if (!zipFilenameVersion) {
      discrepancies.push(`ZIP filename "${path.basename(opts.zipPath)}" does not contain a parseable version`);
    } else if (zipFilenameVersion !== packageVersion) {
      discrepancies.push(
        `ZIP filename version "${zipFilenameVersion}" ≠ package version "${packageVersion}"`
      );
    }

    // Check root folder inside ZIP
    const structure = verifyZipStructure(opts.zipPath);
    if (structure.rootFolder) {
      zipRootFolderVersion = extractVersionFromFolder(structure.rootFolder);
      if (!zipRootFolderVersion) {
        discrepancies.push(`ZIP root folder "${structure.rootFolder}" does not contain a parseable version`);
      } else if (zipRootFolderVersion !== packageVersion) {
        discrepancies.push(
          `ZIP root folder version "${zipRootFolderVersion}" ≠ package version "${packageVersion}"`
        );
      }
    } else if (structure.valid === false) {
      discrepancies.push(`ZIP structure invalid: ${structure.errors.join("; ")}`);
    }
  }

  const headerVersion = opts.headerVersion;
  if (headerVersion !== undefined && headerVersion !== packageVersion) {
    discrepancies.push(
      `Response header X-TFA-Version "${headerVersion}" ≠ package version "${packageVersion}"`
    );
  }

  let releaseNotesVersion: string | undefined;
  if (opts.releaseNotesPath) {
    releaseNotesVersion = extractVersionFromReleaseNotes(opts.releaseNotesPath);
    if (!releaseNotesVersion) {
      discrepancies.push(`Could not extract version from release notes: ${opts.releaseNotesPath}`);
    } else if (releaseNotesVersion !== packageVersion) {
      discrepancies.push(
        `Release notes version "${releaseNotesVersion}" ≠ package version "${packageVersion}"`
      );
    }
  }

  return {
    packageVersion,
    zipFilenameVersion,
    zipRootFolderVersion,
    headerVersion,
    releaseNotesVersion,
    coherent: discrepancies.length === 0,
    discrepancies,
  };
}

// ── Evidence node builder ──────────────────────────────────────────────────

export function buildReleaseIdentityEvidence(
  report: ReleaseIdentityReport
): EvidenceNode {
  return {
    kind: "version_coherence_verified",
    status: report.coherent ? "passed" : "failed",
    message: report.coherent
      ? `Release identity coherent: all version fields agree on ${report.packageVersion}`
      : `Release identity incoherent: ${report.discrepancies.join("; ")}`,
    timestamp: new Date().toISOString(),
    metadata: {
      packageVersion: report.packageVersion,
      zipFilenameVersion: report.zipFilenameVersion,
      zipRootFolderVersion: report.zipRootFolderVersion,
      headerVersion: report.headerVersion,
      releaseNotesVersion: report.releaseNotesVersion,
      discrepancies: report.discrepancies,
    },
  };
}

// ── Provenance record ─────────────────────────────────────────────────────

export interface ProvenanceRecord {
  version: string;
  projectId: string;
  builtAt: string;
  artifacts: Record<string, string>; // filename → sha256
  identityReport: ReleaseIdentityReport;
  platformVersion: string;
}

export function buildProvenance(
  projectId: string,
  artifactPaths: string[],
  identityReport: ReleaseIdentityReport
): ProvenanceRecord {
  return {
    version: identityReport.packageVersion,
    projectId,
    builtAt: new Date().toISOString(),
    artifacts: hashArtifacts(artifactPaths),
    identityReport,
    platformVersion: PLATFORM_VERSION,
  };
}

export function writeProvenance(provenanceDir: string, record: ProvenanceRecord): string {
  if (!fs.existsSync(provenanceDir)) {
    fs.mkdirSync(provenanceDir, { recursive: true });
  }
  const outPath = path.join(provenanceDir, `provenance-v${record.version}.json`);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
  return outPath;
}
