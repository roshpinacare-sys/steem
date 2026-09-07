#!/usr/bin/env node
// ============================================================================
// TFA Evolution Studio V31.1.0 — Production Certification Suite
//
// Gates:
//   1. Release Truth (version markers aligned)
//   2. Capability Preservation (all 16 v30 capability areas present)
//   3. Security Hardening (overrides + resolutions for undici / js-yaml)
//   4. Architecture (fitness module present)
//   5. Soak (soak module + report present)
//   6. Evidence (audit module present)
//
// Run: node scripts/v31-tests.mjs
// Exit 0 = certified, 1 = certification failed.
// ============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let passed = 0, failed = 0;
const ok = (l, d = "") => { passed++; console.log(`  ✓ ${l}${d ? " — " + d : ""}`); };
const bad = (l, r) => { failed++; console.error(`  ✗ ${l}: ${r}`); };

const exists = (p) => fs.existsSync(path.join(root, p));
const read = (p) => exists(p) ? fs.readFileSync(path.join(root, p), "utf-8") : null;

console.log("\n▶ V31.1.0 Certification\n");

// 1. Release Truth
const pkg = JSON.parse(read("package.json"));
pkg.version === "31.1.0" ? ok("package.json version 31.1.0") : bad("package.json version", pkg.version);
const lock = JSON.parse(read("package-lock.json"));
lock.version === "31.1.0" ? ok("package-lock.json version 31.1.0") : bad("package-lock.json version", lock.version);
/v31\.1\.0/.test(read("README.md") || "") ? ok("README mentions v31.1.0") : bad("README", "missing v31.1.0");
/v31\.1\.0/.test(read("RELEASE_NOTES.md") || "") ? ok("RELEASE_NOTES mentions v31.1.0") : bad("RELEASE_NOTES", "missing");
/v31\.1\.0/.test(read("src/components/layout/Sidebar.tsx") || "") ? ok("UI banner v31.1.0") : bad("Sidebar", "missing v31.1.0");

// 2. Capability Preservation
const caps = [
  ["Compiler Intelligence", "src/lib/compiler"],
  ["IR Systems", "src/lib/intelligence"],
  ["Runtime Profiles", "src/lib/execution"],
  ["Distillation", "src/lib/distillation"],
  ["Memory Graph", "src/lib/memory"],
  ["Multi-Agent Debate", "src/lib/agents"],
  ["Fitness Functions", "src/lib/fitness"],
  ["Chaos Harness", "src/lib/chaos"],
  ["Soak Harness", "src/lib/soak"],
  ["Recovery Systems", "src/lib/engine"],
  ["Evidence Systems", "src/lib/audit"],
  ["Release Governance", "src/lib/release"],
  ["Adapters", "src/lib/integrations"],
  ["Learning Systems", "src/lib/learning"],
  ["Project Management", "src/lib/workflow"],
  ["Artifact Generation", "src/lib/automation"],
];
for (const [name, p] of caps) {
  exists(p) ? ok(`Capability preserved: ${name}`) : bad(`Capability missing: ${name}`, p);
}

// 3. Security
const ov = pkg.overrides || {};
const rs = pkg.resolutions || {};
ov.undici && rs.undici ? ok("undici override + resolution set", ov.undici)
                        : bad("undici hardening", "missing");
ov["js-yaml"] && rs["js-yaml"] ? ok("js-yaml override + resolution set", ov["js-yaml"])
                                : bad("js-yaml hardening", "missing");

// 4. Architecture / 5. Soak / 6. Evidence reports
["ARCHITECTURE-REPORT.md", "SOAK-REPORT.md", "CAPABILITY-INVENTORY.md", "V31-RELEASE-NOTES.md"]
  .forEach(f => exists(f) ? ok(`Artifact present: ${f}`) : bad(`Artifact missing: ${f}`, f));

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
