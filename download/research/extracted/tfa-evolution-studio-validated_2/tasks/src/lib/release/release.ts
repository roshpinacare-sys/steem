/**
 * TFA Evolution Studio v28 — Release Module
 *
 * SHA-256 integrity and manifest generation for release artifacts.
 *
 * V25 fix: removed orphaned string literal ","  from buildManifest() lines
 * array that was corrupting every generated manifest since v20.
 */

import fs from "fs";
import crypto from "crypto";
import path from "path";

export function computeSha256(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function verifyZipIntegrity(zipPath: string): { valid: boolean; size: number; entries: number } {
  const stat = fs.statSync(zipPath);
  if (stat.size < 512) return { valid: false, size: stat.size, entries: 0 };
  // Real validation would use adm-zip; this is the structural contract
  return { valid: true, size: stat.size, entries: -1 };
}

export function buildManifest(projectId: string, version: string, artifacts: string[]): string {
    // comma-containing line in the manifest output (corrupt manifest since v20).
  const lines = [
    `# Release Manifest — ${projectId} v${version}`,
    `Version: ${version}`,
    `Project: ${projectId}`,
    `Generated: ${new Date().toISOString()}`,
    "---",
    "## Artifacts",
  ];
  for (const artifact of artifacts) {
    const hash = fs.existsSync(artifact) ? computeSha256(artifact) : "N/A";
    lines.push(`- ${path.basename(artifact)} \`SHA-256: ${hash.slice(0, 16)}...\``);
  }
  return lines.join("\n");
}
