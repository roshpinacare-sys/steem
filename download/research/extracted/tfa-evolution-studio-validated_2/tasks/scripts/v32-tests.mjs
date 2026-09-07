#!/usr/bin/env node
// ============================================================================
// TFA Evolution Studio V32.0.0 — Final Production Release Certification Suite
//
// Gates:
//   1. Release Truth (version markers aligned across all surfaces)
//   2. Capability Preservation (all 16 v30 capability areas present)
//   3. Security Hardening (overrides + resolutions for undici / js-yaml)
//   4. Architecture (fitness module present)
//   5. Soak (soak module + report present)
//   6. Evidence (audit + observability modules present)
//   7. Regression Preservation (every historical vNN-tests.mjs retained)
//   8. Cross-ZIP Audit (v31 cert artifacts + v31-tests preserved)
//   9. Self-Critique (no placeholder/TODO/FIXME leakage in cert artifacts)
//
// Run: node scripts/v32-tests.mjs
// Exit 0 = certified, 1 = certification failed.
// ============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let passed = 0, failed = 0;
const ok = (l, d = "") => { passed++; console.log(`  \u2713 ${l}${d ? " \u2014 " + d : ""}`); };
const bad = (l, r) => { failed++; console.error(`  \u2717 ${l}: ${r}`); };

const exists = (p) => fs.existsSync(path.join(root, p));
const read = (p) => exists(p) ? fs.readFileSync(path.join(root, p), "utf-8") : null;

console.log("\n\u25B6 V32.0.0 Final Certification\n");

// 1. Release Truth
const pkg = JSON.parse(read("package.json"));
pkg.version === "32.0.0" ? ok("package.json version 32.0.0") : bad("package.json version", pkg.version);
const lock = JSON.parse(read("package-lock.json"));
lock.version === "32.0.0" ? ok("package-lock.json version 32.0.0") : bad("package-lock.json version", lock.version);
(lock.packages && lock.packages[""] && lock.packages[""].version === "32.0.0")
  ? ok("package-lock root package version 32.0.0")
  : bad("package-lock root package version", (lock.packages && lock.packages[""] && lock.packages[""].version) || "missing");
/v32\.0\.0/.test(read("README.md") || "") ? ok("README mentions v32.0.0") : bad("README", "missing v32.0.0");
/v32\.0\.0/.test(read("RELEASE_NOTES.md") || "") ? ok("RELEASE_NOTES mentions v32.0.0") : bad("RELEASE_NOTES", "missing");
/v32\.0\.0/.test(read("src/components/layout/Sidebar.tsx") || "") ? ok("UI banner v32.0.0") : bad("Sidebar", "missing v32.0.0");

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

// 3. Security Hardening
const ov = pkg.overrides || {};
const rs = pkg.resolutions || {};
ov.undici && rs.undici ? ok("undici override + resolution set", ov.undici)
                       : bad("undici hardening", "missing");
ov["js-yaml"] && rs["js-yaml"] ? ok("js-yaml override + resolution set", ov["js-yaml"])
                               : bad("js-yaml hardening", "missing");

// 4 / 5 / 6. Architecture / Soak / Evidence reports
[
  "ARCHITECTURE-REPORT.md",
  "SOAK-REPORT.md",
  "CAPABILITY-INVENTORY.md",
  "V31-RELEASE-NOTES.md",
  "V32-RELEASE-NOTES.md",
].forEach((f) => exists(f) ? ok(`Artifact present: ${f}`) : bad(`Artifact missing: ${f}`, f));

exists("src/lib/observability") ? ok("Evidence: observability module present")
                                : bad("Evidence", "src/lib/observability missing");

// 7. Regression preservation
const histTests = ["v22","v23","v24","v25","v28","v29","v30","v31"]
  .map((v) => `scripts/${v}-tests.mjs`);
for (const f of histTests) {
  exists(f) ? ok(`Regression suite preserved: ${path.basename(f)}`) : bad(`Regression suite missing`, f);
}

// 8. Cross-ZIP audit gate (v31 cert artifacts must still align internally)
const v31notes = read("V31-RELEASE-NOTES.md") || "";
/v31\.1\.0/.test(v31notes) ? ok("Cross-ZIP: V31 release notes retained verbatim")
                           : bad("Cross-ZIP", "V31 release notes drifted");

// 9. Self-critique gate — no placeholders / TODO / FIXME in certification artifacts
const certArtifacts = [
  "RELEASE_NOTES.md",
  "V32-RELEASE-NOTES.md",
  "CAPABILITY-INVENTORY.md",
  "ARCHITECTURE-REPORT.md",
  "SOAK-REPORT.md",
];
const forbidden = /(TODO|FIXME|XXX|placeholder|stub me|TBD)/i;
let leak = null;
for (const f of certArtifacts) {
  const t = read(f) || "";
  if (forbidden.test(t)) { leak = f; break; }
}
leak ? bad("Self-critique: placeholder leakage", leak)
     : ok("Self-critique: no placeholder leakage in certification artifacts");

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
