#!/usr/bin/env node
// scripts/check-dead-integrations.mjs
//
// Audit finding (§1): across 32 recorded passes, the single most common bug
// class in this codebase is a service written, exported, and unit-tested,
// but never actually called from cli.ts's phase-runner or any agent. It
// works in isolation and looks done, but has zero effect on a real run.
//
// This script is a blunt but effective net for that pattern: for every
// named export in packages/agent/src/services/** and
// packages/agent/src/validators/**, it checks whether that identifier is
// referenced anywhere outside its own file. If not, it's flagged.
//
// This is intentionally simple (text search, not a real call graph) so it
// has no new dependencies and can run in CI on every PR. It will have false
// positives (e.g. an export only used by a test, or re-exported through an
// index.ts) — treat a flag as "go verify this is really wired in," not as
// an automatic build failure.
//
// Usage: node scripts/check-dead-integrations.mjs
// Exit code 1 if any likely-dead export is found.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(process.cwd(), "packages/agent/src");
// pipeline/ holds the orchestrator + per-phase handlers — the primary call
// sites for services/validators/agents since the runPipeline decomposition.
const SCAN_DIRS = ["services", "validators", "agents", "pipeline", "skills", "utils", "schemas", "types"];
const EXPORT_RE = /export\s+(?:async\s+function|function|const|class)\s+([A-Za-z0-9_]+)/g;

// Allowlist of known public/test-only exports. Each new flagged export must be
// triaged before merging: add it here with a reason, or wire it up.
const ALLOWLIST = (() => {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "scripts/dead-code-allowlist.json"), "utf8"));
  } catch {
    return [];
  }
})();

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

// IR10 (ADR-005 follow-up): advisory scan of the Mission Control frontend.
// The dead-export heuristic is noisier for a React app (JSX usage, lazy
// string imports), so this pass is WARN-ONLY — it never changes the exit
// code — until the false-positive rate is understood. Promote to a hard gate
// later if it proves reliable.
function warnMissionControl() {
  const MC_ROOT = join(process.cwd(), "apps/mission-control/src");
  let files;
  try {
    files = walk(MC_ROOT).concat(
      readdirSync(MC_ROOT).some((e) => e === "main.tsx") ? [join(MC_ROOT, "main.tsx")] : [],
    );
  } catch {
    return; // app not present in this checkout — skip silently
  }
  // walk() only collects .ts; include .tsx explicitly for the React app.
  function walkTsx(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) out.push(...walkTsx(full));
      else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
        out.push(full);
      }
    }
    return out;
  }
  let all;
  try {
    all = walkTsx(MC_ROOT);
  } catch {
    return;
  }
  const contents = new Map(all.map((f) => [f, readFileSync(f, "utf8")]));
  const warnings = [];
  for (const [file, content] of contents) {
    let match;
    EXPORT_RE.lastIndex = 0;
    while ((match = EXPORT_RE.exec(content))) {
      const name = match[1];
      if (name === "default") continue;
      let used = false;
      for (const [other, oc] of contents) {
        if (other === file) continue;
        if (new RegExp(`\\b${name}\\b`).test(oc)) {
          used = true;
          break;
        }
      }
      if (!used) warnings.push(`${relative(process.cwd(), file)}  ::  ${name}`);
    }
  }
  if (warnings.length > 0) {
    console.log(`\ncheck-dead-integrations [advisory / mission-control]: ${warnings.length} export(s) with no in-app call site (warning only, not a build failure):`);
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }
}

function main() {
  warnMissionControl();
  const allFiles = SCAN_DIRS.flatMap((d) => {
    try {
      return walk(join(ROOT, d));
    } catch {
      return [];
    }
  });
  // Also include cli.ts and bootstrap.mjs as call sites, even though they
  // aren't under services/validators/agents themselves.
  const callSiteFiles = [...allFiles, join(ROOT, "cli.ts")].filter((f) => {
    try {
      statSync(f);
      return true;
    } catch {
      return false;
    }
  });

  const fileContents = new Map(callSiteFiles.map((f) => [f, readFileSync(f, "utf8")]));

  const flagged = [];

  for (const file of allFiles) {
    const content = fileContents.get(file) ?? readFileSync(file, "utf8");
    let match;
    EXPORT_RE.lastIndex = 0;
    while ((match = EXPORT_RE.exec(content))) {
      const name = match[1];
      // Skip obvious non-integration exports (types, error classes are fine to
      // only be caught, not called — but still worth a soft flag if unused).
      let usedElsewhere = false;
      for (const [otherFile, otherContent] of fileContents) {
        if (otherFile === file) continue;
        // Word-boundary search so "foo" doesn't match "fooBar".
        const re = new RegExp(`\\b${name}\\b`);
        if (re.test(otherContent)) {
          usedElsewhere = true;
          break;
        }
      }
      if (!usedElsewhere) {
        flagged.push({ file: relative(process.cwd(), file), name });
      }
    }
  }

  const allowedSet = new Set(ALLOWLIST.map((e) => `${e.file}::${e.name}`));
  const novel = flagged.filter(({ file, name }) => !allowedSet.has(`${file}::${name}`));

  if (flagged.length === 0) {
    console.log("check-dead-integrations: no likely-dead exports found.");
    process.exit(0);
  }

  if (novel.length === 0) {
    console.log(`check-dead-integrations: ${flagged.length} export(s) flagged; all are in the allowlist.`);
    process.exit(0);
  }

  console.log(`check-dead-integrations: ${novel.length} new export(s) with no call site outside their own file:\n`);
  for (const { file, name } of novel) {
    console.log(`  ${file}  ::  ${name}`);
  }
  console.log(
    "\nEach of these is either (a) genuinely dead / only test-covered, or (b) a false " +
      "positive (re-exported via an index, used only in an app outside packages/agent). " +
      "Either wire it into the pipeline or add it to scripts/dead-code-allowlist.json with a reason.",
  );
  process.exit(1);
}

main();
