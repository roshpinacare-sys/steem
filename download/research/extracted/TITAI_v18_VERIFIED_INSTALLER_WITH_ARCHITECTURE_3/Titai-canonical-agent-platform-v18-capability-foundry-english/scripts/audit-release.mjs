import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const failures = [];
const prohibitedNames = new Set([".env", "titai.db"]);
const prohibitedDirs = new Set(["node_modules", ".next", "coverage", "dist", ".git"]);
const credentialFilePatterns = [/\.pem$/i, /\.p12$/i, /\.pfx$/i, /(^|\/)id_rsa/i, /\.key$/i];
const secretPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'](?!replace-|test-|e2e-)([^"']{8,})["']/i,
];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replaceAll(path.sep, "/");
    if (entry.isDirectory()) {
      if (prohibitedDirs.has(entry.name)) continue;
      walk(full);
      continue;
    }
    if (prohibitedNames.has(entry.name) || credentialFilePatterns.some((p) => p.test(rel))) {
      failures.push(`Prohibited release file: ${rel}`);
    }
    let content;
    try { content = fs.readFileSync(full, "utf8"); } catch { continue; }
    for (const pattern of secretPatterns) {
      if (pattern.test(content) && !["playwright.config.ts", "vitest.config.ts", ".env.example"].includes(rel)) {
        failures.push(`Potential embedded credential: ${rel}`);
      }
    }
  }
}
walk(root);
for (const script of ["scripts/validate-canonical.mjs", "scripts/validate-english-only.mjs"]) {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  if (result.status !== 0) failures.push(result.stderr || result.stdout || `${script} failed`);
}
if (failures.length) {
  console.error("Release audit failed:");
  for (const item of [...new Set(failures)]) console.error(`- ${item}`);
  process.exit(1);
}
console.log("Release audit passed: canonical integrity, language policy, exclusions, and credential checks are clean.");
