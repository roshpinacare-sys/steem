#!/usr/bin/env node
// ============================================================================
// TFA Evolution Studio V29 — Self-Audit CLI
//
// Runs src/lib/audit/self-audit.ts over the repository.
// Exits 1 on any high-severity finding (release truth violation).
// ============================================================================

import { register } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Inline JS port of the audit logic — keeps this CLI dependency-free
// (no ts-node / esbuild required). Mirrors src/lib/audit/self-audit.ts.

const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".md", ".json"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage", ".turbo"]);

function* walk(root) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(full); }
      else if (TEXT_EXTS.has(path.extname(e.name))) yield full;
    }
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
const packageVersion = pkg.version;
const major = `v${packageVersion.split(".")[0]}`;
const historical = /(V\d+-RELEASE-NOTES\.md|release-notes|history|CHANGELOG)/i;

const findings = [];
let scanned = 0;

// 1. Required release notes for current major.
const notesFile = path.join(repoRoot, `${major.toUpperCase()}-RELEASE-NOTES.md`);
if (!fs.existsSync(notesFile)) {
  findings.push({ severity: "high", kind: "missing_release_notes", file: path.basename(notesFile),
                  message: `Missing release notes for ${major.toUpperCase()}` });
}

for (const file of walk(repoRoot)) {
  scanned++;
  const rel = path.relative(repoRoot, file);
  const isMarkdown = rel.endsWith(".md");
  const isHistoricalNotes = historical.test(rel);
  const isActiveNotesOrReadme = /^(README|RELEASE_NOTES)\.md$/i.test(rel);
  const content = fs.readFileSync(file, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Active current-marker check (only in active README / RELEASE_NOTES).
    if (isMarkdown && isActiveNotesOrReadme && !isHistoricalNotes) {
      const lower = line.toLowerCase();
      if (lower.includes("\u2190 **current**") || lower.includes("\u2190 current")) {
        if (!line.includes(packageVersion)) {
          findings.push({ severity: "high", kind: "current_marker_mismatch", file: rel, line: i + 1,
                          message: `Current marker on this line does not include package version ${packageVersion}` });
        }
      }
    }

    if (i === 0 && line.startsWith("# ") && isActiveNotesOrReadme) {
      const match = line.match(/v(\d+)\.(\d+)\.(\d+)/);
      if (match && match[0] !== `v${packageVersion}`) {
        findings.push({ severity: "high", kind: "header_version_mismatch", file: rel, line: 1,
                        message: `Top-level heading is ${match[0]} but package.json is v${packageVersion}` });
      }
    }

    if (isMarkdown && !isHistoricalNotes) {
      const m = line.match(/\bv(\d+)\.0\.0\b/g);
      if (m) for (const ref of m) {
        const refMajor = parseInt(ref.slice(1).split(".")[0], 10);
        const currentMajor = parseInt(packageVersion.split(".")[0], 10);
        if (refMajor < currentMajor && /current|active|latest|^# /i.test(line) && !/(previously|prior|former|deprecated|historical|earlier)/i.test(line)) {
          findings.push({ severity: "medium", kind: "stale_version_marker", file: rel, line: i + 1,
                          message: `Stale active reference to ${ref} while package.json is v${packageVersion}` });
        }
      }
    }

    // Broken local imports. Skip self-audit sources (they embed the pattern as
    // a literal example), the smoke-test (same reason), and test scripts that
    // use string literals containing import-like patterns for assertion checks.
    if (rel === "src/lib/audit/self-audit.ts" || rel === "scripts/self-audit.mjs" ||
        rel === "scripts/v29-tests.mjs" || rel === "scripts/v28-tests.mjs" || rel === "scripts/v24-tests.mjs" || rel === "scripts/v23-tests.mjs") continue;
    const im = line.match(/from\s+["'](\.\.?\/[^"']+)["']/);
    if (im && /\.(ts|tsx|mjs|js)$/.test(rel)) {
      const target = im[1];
      const baseDir = path.dirname(file);
      const resolved = path.resolve(baseDir, target);
      const cands = [resolved, resolved + ".ts", resolved + ".tsx", resolved + ".js", resolved + ".mjs",
                     path.join(resolved, "index.ts"), path.join(resolved, "index.tsx")];
      if (!cands.some(c => fs.existsSync(c))) {
        findings.push({ severity: "high", kind: "broken_local_import", file: rel, line: i + 1,
                        message: `Import target not found: ${target}` });
      }
    }
  }
}


const clean = findings.length === 0;
const high = findings.filter(f => f.severity === "high").length;

console.log(`\nSelf-Audit — package v${packageVersion} — scanned ${scanned} files`);
if (clean) {
  console.log("  ✓ clean (0 findings)");
  process.exit(0);
}
for (const f of findings) {
  console.log(`  [${f.severity.toUpperCase()}] ${f.kind} — ${f.file}${f.line ? ":" + f.line : ""}: ${f.message}`);
}
console.log(`\n${findings.length} finding(s) (${high} high-severity)`);
process.exit(high > 0 ? 1 : 0);
