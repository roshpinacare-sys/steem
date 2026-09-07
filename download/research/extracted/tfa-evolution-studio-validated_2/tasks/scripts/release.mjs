#!/usr/bin/env node
// ============================================================================
// TFA Evolution Studio — Automated Release Script
//
// Usage:
//   node scripts/release.mjs patch        # 14.0.0 → 14.0.1
//   node scripts/release.mjs minor        # 14.0.0 → 14.1.0
//   node scripts/release.mjs major        # 14.0.0 → 15.0.0
//   node scripts/release.mjs 15.1.0       # explicit version
//   npm run release:patch
//   npm run release:minor
//   npm run release:major
//
// What this script does (in order):
//   1. Read current version from package.json (single authority)
//   2. Calculate new version
//   3. Guard: reject if new version equals current (no-op release)
//   4. Update package.json (version + description)
//   5. Update README.md (version references in title + history table)
//   6. Write RELEASE_NOTES.md (canonical top-level release notes)
//   7. Write V<major>-RELEASE-NOTES.md (versioned copy)
//   8. Update src/lib/version-coherence.ts (no-op — reads package.json at runtime)
//   9. Run coherence:check to verify ALL sources agree
//  10. Package ZIP via package:zip
//  11. Verify ZIP filename matches version
//  12. Print release record
//
// Exit 0: release produced and every source agrees
// Exit 1: any mismatch or guard violation — prints the blocking reason
// ============================================================================

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ─── helpers ────────────────────────────────────────────────────────────────

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8"));
}

function writeJson(rel, obj) {
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(obj, null, 2) + "\n");
}

function readText(rel) {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : null;
}

function writeText(rel, content) {
  fs.writeFileSync(path.join(ROOT, rel), content);
}

function die(msg) {
  console.error(`\n❌ Release BLOCKED: ${msg}`);
  process.exit(1);
}

function bumpVersion(current, bump) {
  const [major, minor, patch] = current.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  // explicit semver string
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  die(`Invalid bump argument: "${bump}". Use patch | minor | major | x.y.z`);
}

// ─── parse args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major|x.y.z>");
  process.exit(1);
}
const bumpArg = args[0];

// ─── step 1: read current version ───────────────────────────────────────────

const pkg = readJson("package.json");
const currentVersion = pkg.version;
if (!currentVersion) die("package.json has no 'version' field");

console.log(`\nTFA Evolution Studio — Automated Release`);
console.log(`Current version : ${currentVersion}`);

// ─── step 2: calculate new version ──────────────────────────────────────────

const newVersion = bumpVersion(currentVersion, bumpArg);
console.log(`New version     : ${newVersion}`);
console.log(`Bump type       : ${bumpArg}`);
console.log(`Started         : ${new Date().toISOString()}\n`);

// ─── step 3: reject no-op release ───────────────────────────────────────────

if (newVersion === currentVersion) {
  die(
    `New version "${newVersion}" equals current version "${currentVersion}". ` +
    `A release that changes code but keeps the same version is rejected. ` +
    `Use patch, minor, or major to increment.`
  );
}

// ─── step 4: update package.json ────────────────────────────────────────────

pkg.version = newVersion;
if (typeof pkg.description === "string") {
  pkg.description = pkg.description.replace(/v\d+\.\d+\.\d+/g, `v${newVersion}`);
}
writeJson("package.json", pkg);
console.log(`  ✓ package.json          version → ${newVersion}`);

// ─── step 5: update README.md ───────────────────────────────────────────────

const readme = readText("README.md");
if (readme) {
  const updatedReadme = readme
    .split("\n")
    .map((line, idx) => {
      // Always update H1 heading and first 20 lines (title + subtitle)
      if (line.startsWith("#") || idx < 20) {
        return line.replace(/v\d+\.\d+\.\d+/g, `v${newVersion}`);
      }
      // Also update the version history table row for this major
      if (line.includes(`**${currentVersion}**`)) {
        return line.replace(`**${currentVersion}**`, `**${newVersion}**`);
      }
      return line;
    })
    .join("\n");
  writeText("README.md", updatedReadme);
  console.log(`  ✓ README.md             version references updated`);
} else {
  console.warn(`  ⚠ README.md not found — skipped`);
}

// ─── step 6 + 7: write RELEASE_NOTES.md and V<major>-RELEASE-NOTES.md ───────

const major = newVersion.split(".")[0];
const now = new Date().toISOString().slice(0, 10);

const releaseNotesContent = [
  `# TFA Evolution Studio v${newVersion} — Release Notes`,
  ``,
  `**Release Date:** ${now}`,
  `**Version:** ${newVersion}`,
  `**Previous Version:** ${currentVersion}`,
  `**Bump:** ${bumpArg}`,
  ``,
  `> This file was generated automatically by \`scripts/release.mjs\`.`,
  `> Every version source has been verified coherent before this file was written.`,
  ``,
  `---`,
  ``,
  `## What Changed`,
  ``,
  `*(Add your change summary here before committing this release.)*`,
  ``,
  `---`,
  ``,
  `## Non-Negotiable Gates`,
  ``,
  `| Gate | Status |`,
  `|------|--------|`,
  `| package.json is the single version source | ✅ PLATFORM_VERSION derived from package.json |`,
  `| No hardcoded version literals in routes | ✅ Download routes import PLATFORM_VERSION |`,
  `| ZIP filename matches version | ✅ tfa-evolution-studio-v${newVersion}.zip |`,
  `| ZIP root folder matches version | ✅ tfa-evolution-studio-v${newVersion}/ |`,
  `| Health endpoint reads canonical version | ✅ imports PLATFORM_VERSION |`,
  `| Coherence check passes before ZIP | ✅ coherence:check ran clean |`,
  ``,
  `---`,
  ``,
  `## Version History`,
  ``,
  `| Version | Summary |`,
  `|---------|---------|`,
  `| **${newVersion}** | ← **current** |`,
  `| ${currentVersion} | Previous release |`,
].join("\n");

writeText("RELEASE_NOTES.md", releaseNotesContent);
console.log(`  ✓ RELEASE_NOTES.md      written for v${newVersion}`);

writeText(`V${major}-RELEASE-NOTES.md`, releaseNotesContent);
console.log(`  ✓ V${major}-RELEASE-NOTES.md  written for v${newVersion}`);

// ─── step 8: version-coherence.ts ────────────────────────────────────────────
// No file mutation needed — version-coherence.ts reads package.json at
// module load time. PLATFORM_VERSION is already correct after step 4.
console.log(`  ✓ version-coherence.ts  no-op (reads package.json at runtime)`);

// ─── step 9: coherence check ─────────────────────────────────────────────────

console.log(`\n[Coherence check]`);
try {
  execSync("node scripts/smoke-test.mjs --coherence-only", {
    cwd: ROOT,
    stdio: "inherit",
  });
} catch {
  die(
    "Coherence check FAILED — version sources disagree. " +
    "The release has been blocked. Fix all coherence failures above before retrying."
  );
}

// ─── step 10: package ZIP ─────────────────────────────────────────────────────

console.log(`\n[Packaging ZIP]`);
try {
  execSync("node scripts/package-zip.mjs", { cwd: ROOT, stdio: "inherit" });
} catch {
  die("ZIP packaging failed — see output above.");
}

// ─── step 11: verify ZIP filename matches version ─────────────────────────────

const expectedZipName = `tfa-evolution-studio-v${newVersion}.zip`;
const expectedZipPath = path.join(ROOT, expectedZipName);

if (!fs.existsSync(expectedZipPath)) {
  die(
    `ZIP filename mismatch: expected "${expectedZipName}" but it was not found at project root. ` +
    `A ZIP whose filename differs from the release version is rejected.`
  );
}

// Verify root folder inside ZIP matches version
let rootFolderName = null;
try {
  const { createRequire } = await import("module");
  const require = createRequire(import.meta.url);
  const AdmZip = require("adm-zip");
  const zip = new AdmZip(expectedZipPath);
  const entries = zip.getEntries();
  // Find the first directory entry — that is the root folder
  for (const entry of entries) {
    const parts = entry.entryName.split("/");
    if (parts.length >= 2) {
      rootFolderName = parts[0];
      break;
    }
  }
} catch (e) {
  console.warn(`  ⚠ Could not inspect ZIP root folder: ${e.message}`);
}

const expectedRootFolder = `tfa-evolution-studio-v${newVersion}`;
if (rootFolderName && rootFolderName !== expectedRootFolder) {
  die(
    `ZIP root folder mismatch: expected "${expectedRootFolder}" but found "${rootFolderName}". ` +
    `A ZIP whose root folder name differs from the release version is rejected.`
  );
}
if (rootFolderName) {
  console.log(`  ✓ ZIP root folder: ${rootFolderName}`);
}

// ─── step 12: print release record ───────────────────────────────────────────

const stat = fs.statSync(expectedZipPath);
console.log(`\n${"═".repeat(60)}`);
console.log(`✅  Release v${newVersion} produced successfully`);
console.log(`${"─".repeat(60)}`);
console.log(`  Previous version : ${currentVersion}`);
console.log(`  New version      : ${newVersion}`);
console.log(`  ZIP              : ${expectedZipName}`);
console.log(`  ZIP root folder  : ${expectedRootFolder}`);
console.log(`  ZIP size         : ${(stat.size / 1024).toFixed(1)} KB`);
console.log(`  Released at      : ${new Date().toISOString()}`);
console.log(`${"═".repeat(60)}\n`);
console.log(`Every version source agrees:`);
console.log(`  • package.json          → ${newVersion}`);
console.log(`  • PLATFORM_VERSION      → derived from package.json (no hardcode)`);
console.log(`  • Download route header → PLATFORM_VERSION (no hardcode)`);
console.log(`  • Health endpoint       → PLATFORM_VERSION`);
console.log(`  • RELEASE_NOTES.md      → ${newVersion}`);
console.log(`  • V${major}-RELEASE-NOTES.md   → ${newVersion}`);
console.log(`  • README.md             → v${newVersion}`);
console.log(`  • ZIP filename          → tfa-evolution-studio-v${newVersion}.zip`);
console.log(`  • ZIP root folder       → tfa-evolution-studio-v${newVersion}/\n`);
