#!/usr/bin/env node
// ============================================================================
// TFA Evolution Studio — ZIP-First Release Packaging Script
//
// Canonical packaging command: npm run package:zip
//
// Produces a versioned release ZIP containing all source files
// (excludes node_modules, .next, dist, build, .git, coverage).
//
// Output: tfa-evolution-studio-v<version>.zip in the project root.
//
// Usage:
//   npm run package:zip
//   npm run package:zip -- --out /custom/path/release.zip
//   node scripts/package-zip.mjs
//
// Exit 0: ZIP created and passes integrity check
// Exit 1: packaging failed — prints the blocking reason
// ============================================================================

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Load package.json for version
// ---------------------------------------------------------------------------

const pkgPath = path.join(__dirname, "../package.json");
if (!fs.existsSync(pkgPath)) {
  console.error("❌ package.json not found at:", pkgPath);
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const version = pkg.version ?? "0.0.0";

// ---------------------------------------------------------------------------
// Resolve output path
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const outIdx = args.findIndex((a) => a === "--out");
const defaultOut = path.join(__dirname, `../tfa-evolution-studio-v${version}.zip`);
const outputZipPath = outIdx !== -1 ? args[outIdx + 1] : defaultOut;

// ---------------------------------------------------------------------------
// Load AdmZip
// ---------------------------------------------------------------------------

let AdmZip;
try {
  AdmZip = require("adm-zip");
} catch {
  console.error("❌ adm-zip not found. Run: npm install");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build ZIP
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, "..");
const IGNORE = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage", ".turbo"]);

console.log(`\nTFA Evolution Studio v${version} — ZIP Packaging`);
console.log(`Source: ${ROOT}`);
console.log(`Output: ${outputZipPath}`);
console.log(`Started: ${new Date().toISOString()}\n`);

const zip = new AdmZip();
let fileCount = 0;
const baseName = `tfa-evolution-studio-v${version}`;

function walk(dir, relBase) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env.example" && entry.name !== ".gitignore" && entry.name !== ".npmrc") continue;
    const abs = path.join(dir, entry.name);
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) {
      walk(abs, rel);
    } else {
      try {
        zip.addLocalFile(abs, path.join(baseName, path.dirname(rel)));
        fileCount++;
      } catch (e) {
        console.warn(`  ⚠ Could not add ${rel}: ${e.message}`);
      }
    }
  }
}

walk(ROOT, "");

if (fileCount === 0) {
  console.error("❌ No files found — ZIP aborted. Source directory may be empty.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Write ZIP
// ---------------------------------------------------------------------------

try {
  fs.mkdirSync(path.dirname(outputZipPath), { recursive: true });
  zip.writeZip(outputZipPath);
} catch (e) {
  console.error(`❌ Failed to write ZIP: ${e.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Integrity check
// ---------------------------------------------------------------------------

if (!fs.existsSync(outputZipPath)) {
  console.error("❌ ZIP was not created — writeZip silently failed.");
  process.exit(1);
}

const stat = fs.statSync(outputZipPath);
if (stat.size < 512) {
  console.error(`❌ ZIP is suspiciously small (${stat.size} bytes) — likely corrupt.`);
  process.exit(1);
}

let entryCount = 0;
try {
  const verify = new AdmZip(outputZipPath);
  entryCount = verify.getEntries().length;
} catch (e) {
  console.error(`❌ ZIP integrity check failed — could not open: ${e.message}`);
  process.exit(1);
}

if (entryCount === 0) {
  console.error("❌ ZIP contains zero entries — packaging failed.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// SHA-256 hash for downstream verification
// ---------------------------------------------------------------------------

const buf = fs.readFileSync(outputZipPath);
const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

// ---------------------------------------------------------------------------
// Success
// ---------------------------------------------------------------------------

console.log(`  ✓ Files packaged:    ${fileCount}`);
console.log(`  ✓ ZIP entries:       ${entryCount}`);
console.log(`  ✓ Size:              ${(stat.size / 1024).toFixed(1)} KB`);
console.log(`  ✓ SHA256:            ${sha256}`);
console.log(`  ✓ Output:            ${outputZipPath}`);
console.log(`\n✅ Release ZIP created: ${path.basename(outputZipPath)}`);
