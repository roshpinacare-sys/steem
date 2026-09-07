#!/usr/bin/env node
/**
 * scripts/gen-sovereign-spec.mjs — Generate sovereign-openapi.yaml
 *
 * Reads lib/api-spec/openapi.yaml (full TFA spec, 159 operations) and produces
 * lib/api-spec/sovereign-openapi.yaml containing ONLY the operations that
 * sovereign-routes.ts actually implements.
 *
 * Mapping rule:
 *   spec path  /ledger/accounts/{id}  ← (servers.[0].url = /api)
 *   route pattern  /api/ledger/accounts/:id
 *   Both refer to the same endpoint. We normalise both to a canonical key.
 *
 * Usage:
 *   node scripts/gen-sovereign-spec.mjs [--dry-run]
 *
 * Output:
 *   lib/api-spec/sovereign-openapi.yaml
 *   (also prints a summary to stdout)
 */

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOV       = path.join(__dirname, "..");
const SPEC_IN   = path.join(SOV, "lib", "api-spec", "openapi.yaml");
const SPEC_OUT  = path.join(SOV, "lib", "api-spec", "sovereign-openapi.yaml");
const DRY_RUN   = process.argv.includes("--dry-run");

// ─── Sovereign-implemented routes (method, path) ────────────────────────────
// Extracted from src/routes/sovereign-routes.ts patterns.
// Server URL prefix is /api, so spec path = route-pattern.replace(/^\/api/, "")
//   with :param → {param}.
//
// Keep this list in sync with sovereignRoutes() in sovereign-routes.ts.
// The generator test (tests/gen-sovereign-spec/gen-sovereign-spec.test.ts) enforces that
// every entry here corresponds to a real route.

const SOVEREIGN_ROUTES = [
  // ── Auth ──────────────────────────────────────────────────────────────────
  { method: "post",   specPath: "/auth/api-keys" },
  { method: "get",    specPath: "/auth/api-keys" },
  { method: "delete", specPath: "/auth/api-keys/{keyId}" },

  // ── Ledger ────────────────────────────────────────────────────────────────
  { method: "post",   specPath: "/ledger/accounts" },
  { method: "get",    specPath: "/ledger/accounts/{id}" },
  { method: "post",   specPath: "/ledger/mint" },
  { method: "post",   specPath: "/ledger/transfer" },
  { method: "get",    specPath: "/ledger/solvency" },

  // ── Potential engine ──────────────────────────────────────────────────────
  { method: "post",   specPath: "/potential/profile" },
  { method: "post",   specPath: "/potential/personality" },
  { method: "get",    specPath: "/potential/personality/{userId}" },
  { method: "post",   specPath: "/potential/success-path" },
  { method: "get",    specPath: "/potential/success-path/{userId}/{opportunityId}" },
  { method: "post",   specPath: "/potential/collaboration" },
  { method: "get",    specPath: "/potential/collaboration/{userId}" },

  // ── Escrow ────────────────────────────────────────────────────────────────
  { method: "post",   specPath: "/escrow" },
  { method: "get",    specPath: "/escrow/{id}" },
  { method: "post",   specPath: "/escrow/{id}/fund" },
  { method: "post",   specPath: "/escrow/{id}/release" },
  { method: "post",   specPath: "/escrow/{id}/refund" },
  { method: "post",   specPath: "/escrow/{id}/dispute" },
  { method: "post",   specPath: "/escrow/{id}/undispute" },

  // ── Settlement ────────────────────────────────────────────────────────────
  { method: "post",   specPath: "/settlement" },
  { method: "get",    specPath: "/settlement" },
  { method: "get",    specPath: "/settlement/{id}" },
  { method: "post",   specPath: "/settlement/{id}/fund" },
  { method: "post",   specPath: "/settlement/{id}/partial-release" },
  { method: "post",   specPath: "/settlement/{id}/release" },
  { method: "post",   specPath: "/settlement/{id}/dispute" },
  { method: "post",   specPath: "/settlement/{id}/reverse" },
  { method: "post",   specPath: "/settlement/{id}/threshold-approval" },

  // ── Webhooks ──────────────────────────────────────────────────────────────
  { method: "post",   specPath: "/webhooks" },
  { method: "get",    specPath: "/webhooks" },
  { method: "delete", specPath: "/webhooks/{id}" },

  // ── Track-record ──────────────────────────────────────────────────────────
  { method: "get",    specPath: "/track-record/{identityId}" },

  // ── Tenants ───────────────────────────────────────────────────────────────
  { method: "post",   specPath: "/tenants" },
];

// Build a lookup set: "METHOD specPath" → true
const IMPLEMENTED = new Set(
  SOVEREIGN_ROUTES.map(r => `${r.method} ${r.specPath}`)
);

// ─── YAML extraction ─────────────────────────────────────────────────────────
// Strategy: parse the YAML as text, split into path-level blocks, then within
// each path block keep only the method sub-blocks that are implemented.

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/**
 * Parse the full openapi.yaml text into:
 *   header  — everything before `paths:` (preamble + servers + tags etc.)
 *   paths   — Map<specPath, { pathLevelLines: string[], methods: Map<method, string[]> }>
 *   footer  — everything after the `paths:` block (components, security schemes, etc.)
 */
function parseSpec(text) {
  const lines = text.split("\n");
  let i = 0;

  // ── 1. Collect header (up to and including "paths:") ──────────────────────
  const headerLines = [];
  while (i < lines.length) {
    headerLines.push(lines[i]);
    if (lines[i].trim() === "paths:") { i++; break; }
    i++;
  }

  // ── 2. Collect paths ───────────────────────────────────────────────────────
  // A "path block" starts at `  /...:\n` (exactly 2 spaces, slash, no-blank-line).
  // A "method block" starts at `    get:|post:|...:` (exactly 4 spaces).
  // The path block ends when we see another `  /` at top level, or a non-indented line
  // (which marks the start of `components:` etc.).

  const paths = new Map(); // specPath → { pathLines: [], methods: Map<method, []> }

  while (i < lines.length) {
    const ln = lines[i];

    // Detect start of a non-path section (components, security, etc.)
    if (/^[a-zA-Z]/.test(ln) && ln.trim() !== "") break; // e.g. "components:"

    // Detect a new path entry
    const pathMatch = ln.match(/^  (\/[^:]+):\s*$/);
    if (!pathMatch) { i++; continue; } // blank lines, comments, etc.

    const specPath = pathMatch[1];
    i++;

    // Collect lines belonging to this path block (until the next top-level path or section)
    const pathEntry = { pathLines: [], methods: new Map() };
    paths.set(specPath, pathEntry);

    // Path-level lines: comments/parameters that appear BEFORE the first method
    let currentMethod = null;
    let currentMethodLines = [];

    while (i < lines.length) {
      const mln = lines[i];

      // End of this path block: another path or non-indented keyword
      if (/^  (\/[^:]+):\s*$/.test(mln)) break; // next path
      if (/^[a-zA-Z]/.test(mln) && mln.trim() !== "") break; // components etc.

      // Detect a method line (exactly 4 spaces + method name + :)
      const methodMatch = mln.match(/^    (get|post|put|patch|delete|head|options):\s*$/);
      if (methodMatch) {
        // Save the previous method block (if any)
        if (currentMethod !== null) {
          pathEntry.methods.set(currentMethod, currentMethodLines);
        }
        currentMethod = methodMatch[1];
        currentMethodLines = [mln];
      } else if (currentMethod !== null) {
        // Inside a method block
        currentMethodLines.push(mln);
      } else {
        // Path-level lines (parameters, x-tags, etc.) before first method
        pathEntry.pathLines.push(mln);
      }
      i++;
    }
    // Save the last method block
    if (currentMethod !== null) {
      pathEntry.methods.set(currentMethod, currentMethodLines);
    }
  }

  // ── 3. Footer ──────────────────────────────────────────────────────────────
  const footerLines = [];
  while (i < lines.length) { footerLines.push(lines[i]); i++; }

  return { headerLines, paths, footerLines };
}

/**
 * Rebuild YAML text from the parsed structure, keeping only implemented operations.
 */
function buildFilteredSpec(parsed, implementedOverride) {
  const impl = implementedOverride ?? IMPLEMENTED;
  const { headerLines, paths, footerLines } = parsed;
  const outLines = [...headerLines];
  let included = 0, excluded = 0;

  for (const [specPath, entry] of paths) {
    // Collect methods that are implemented for this path
    const keptMethods = [];
    for (const [method] of entry.methods) {
      const key = `${method} ${specPath}`;
      if (impl.has(key)) {
        keptMethods.push(method);
        included++;
      } else {
        excluded++;
      }
    }

    if (keptMethods.length === 0) continue; // skip this path entirely

    // Emit path header
    outLines.push(`  ${specPath}:`);
    // Emit path-level lines (shared parameters etc.)
    for (const l of entry.pathLines) outLines.push(l);
    // Emit kept method blocks
    for (const method of keptMethods) {
      for (const l of entry.methods.get(method)) outLines.push(l);
    }
  }

  // Append footer (components, security schemes, etc.)
  for (const l of footerLines) outLines.push(l);

  return { text: outLines.join("\n"), included, excluded };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const raw    = fs.readFileSync(SPEC_IN, "utf8");
const parsed = parseSpec(raw);
const { text, included, excluded } = buildFilteredSpec(parsed);

// Update the info.title to clarify this is the sovereign subset
const updated = text
  .replace(
    /^  title: TFA API/m,
    "  title: TFA Sovereign Kernel API"
  )
  .replace(
    /^  description: >[\s\S]*?(?=\nservers:)/m,
    `  description: >\n    TFA Sovereign Kernel — the ${included}-operation subset of the full TFA API\n    that is implemented by sovereign-routes.ts. Generated by scripts/gen-sovereign-spec.mjs.\n    Do not edit by hand — regenerate by running: node scripts/gen-sovereign-spec.mjs\n`
  );

const totalInFull = included + excluded;
const unmatched = [...IMPLEMENTED].filter(key => {
  const [, sp] = key.split(" ");
  return !parsed.paths.has(sp);
});

console.log(`\ngen-sovereign-spec: ${SPEC_IN} → ${SPEC_OUT}`);
console.log(`  Full spec operations : ${totalInFull}`);
console.log(`  Sovereign implemented: ${included}`);
console.log(`  Excluded (not impl.) : ${excluded}`);
if (unmatched.length > 0) {
  console.log(`  ⚠ SOVEREIGN_ROUTES entries not found in full spec (not included):`);
  for (const k of unmatched) console.log(`    - ${k}`);
}
console.log(`  Sovereign operations : ${included}  (target: all verified in contract tests)`);

if (!DRY_RUN) {
  fs.writeFileSync(SPEC_OUT, updated, "utf8");
  console.log(`  ✓ Written: ${SPEC_OUT}`);
} else {
  console.log(`  (dry-run: not written)`);
}

// Export for testing
export { SOVEREIGN_ROUTES, IMPLEMENTED, parseSpec, buildFilteredSpec };
