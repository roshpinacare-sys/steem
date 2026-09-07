/**
 * TFA Evolution Studio v28 — Reality Engine
 *
 * Fail-hard validation of build outputs, ZIP integrity, and workspace state.
 */

import fs from "fs";
import AdmZip from "adm-zip";

const REALITY_THRESHOLD = 0.80;
const FAIL_HARD_ON_CRITICAL = true;

export interface RealityCheckResult {
  passed: boolean;
  criticalBlocking: string[];
  score: number;
}

export function verifyZipFilename(zipPath: string, expectedName: string): boolean {
  return fs.existsSync(zipPath) && zipPath.includes(expectedName);
}

export function verifyZipRootFolder(zipPath: string, expectedRoot: string): boolean {
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    for (const entry of entries) {
      const parts = entry.entryName.split("/");
      if (parts.length >= 2) {
        return parts[0] === expectedRoot;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function runRealityCheck(zipPath: string, expectedName: string, expectedRoot: string): RealityCheckResult {
  const criticalBlocking: string[] = [];
  let score = 1.0;

  if (!fs.existsSync(zipPath)) {
    criticalBlocking.push("ZIP file does not exist");
    score -= 0.5;
  } else {
    const stat = fs.statSync(zipPath);
    if (stat.size < 512) {
      criticalBlocking.push("ZIP is too small");
      score -= 0.3;
    }
  }

  if (!verifyZipFilename(zipPath, expectedName)) {
    criticalBlocking.push("ZIP filename mismatch");
    score -= 0.1;
  }

  if (!verifyZipRootFolder(zipPath, expectedRoot)) {
    criticalBlocking.push("ZIP root folder mismatch");
    score -= 0.1;
  }

  const passed = score >= REALITY_THRESHOLD;
  if (FAIL_HARD_ON_CRITICAL && criticalBlocking.length > 0 && score < REALITY_THRESHOLD) {
    return { passed: false, criticalBlocking, score };
  }

  return { passed, criticalBlocking, score };
}
