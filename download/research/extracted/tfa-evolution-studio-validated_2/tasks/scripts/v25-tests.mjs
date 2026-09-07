/**
 * TFA Evolution Studio v25 — Canonical Test Suite
 *
 * Verifies all V25 engineering-excellence fixes across 8 defect batches.
 * Runs as a plain Node.js script (no test runner dependency).
 *
 * Batches:
 *   B1-V25-1  durableRecordEvidence updatedAt stamp         (WS1)
 *   B4-V25-1  ingestZipIntoSandbox path traversal guard     (WS4)
 *   B4-V25-2  buildManifest orphaned string literal         (WS4)
 *   B4-V25-3  validation-gate ESM import conversion        (WS4)
 *   B5-V25-1  Sidebar footer version coherence             (WS5)
 *   B5-V25-2  package.json description coherence           (WS5)
 *   B5-V25-3  README version history table                 (WS5)
 *   B7-V25-1  cross-project-engine deterministic IDs       (WS7)
 *   VC-V25    Version coherence: all identity fields = 25.0.0
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Minimal test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg ?? "assertion failed");
}

function readSrc(...parts) {
  return fs.readFileSync(path.join(ROOT, "src", ...parts), "utf-8");
}

function readFile(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), "utf-8");
}

// ── [1] B1-V25-1 — durableRecordEvidence updatedAt stamp ────────────────────

describe("[B1-V25-1] WS1 — durableRecordEvidence stamps updatedAt", () => {
  const store = readSrc("lib", "job-engine", "durable-job-store.ts");

  it("durableRecordEvidence function exists", () => {
    assert(
      store.includes("export function durableRecordEvidence"),
      "durableRecordEvidence must be exported"
    );
  });

  it("durableRecordEvidence stamps updatedAt on the updated object", () => {
    const fnStart = store.indexOf("export function durableRecordEvidence");
    assert(fnStart !== -1, "durableRecordEvidence not found");
    // Find the next export after it to bound the function body
    const rest = store.slice(fnStart);
    const nextExport = rest.indexOf("\nexport ", 10);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
    assert(
      body.includes("updatedAt: new Date().toISOString()"),
      "durableRecordEvidence must stamp updatedAt: new Date().toISOString()"
    );
  });

  it("durableRecordEvidence calls compactIfNeeded after appending evidence", () => {
    const fnStart = store.indexOf("export function durableRecordEvidence");
    const rest = store.slice(fnStart);
    const nextExport = rest.indexOf("\nexport ", 10);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
    assert(
      body.includes("compactIfNeeded("),
      "durableRecordEvidence must call compactIfNeeded to prevent unbounded log growth"
    );
  });

  it("V25 fix comment is present in durableRecordEvidence", () => {
    assert(
      store.includes("V25 fix: stamp updatedAt"),
      "durableRecordEvidence must carry V25 fix comment"
    );
  });

  it("durableRecordEvidence spreads existing job fields before overriding evidence+updatedAt", () => {
    const fnStart = store.indexOf("export function durableRecordEvidence");
    const rest = store.slice(fnStart);
    const nextExport = rest.indexOf("\nexport ", 10);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
    assert(
      body.includes("...existing"),
      "durableRecordEvidence must spread existing job to preserve all fields"
    );
  });
});

// ── [2] B4-V25-1 — ingestZipIntoSandbox path traversal guard ────────────────

describe("[B4-V25-1] WS4 — ingestZipIntoSandbox path traversal validation", () => {
  const sandbox = readSrc("lib", "compiler", "sandbox-runtime.ts");

  it("ingestZipIntoSandbox function exists", () => {
    assert(
      sandbox.includes("export async function ingestZipIntoSandbox"),
      "ingestZipIntoSandbox must be exported"
    );
  });

  it("ingestZipIntoSandbox calls getEntries() before extractAllTo", () => {
    const fnStart = sandbox.indexOf("export async function ingestZipIntoSandbox");
    const rest = sandbox.slice(fnStart);
    const nextExport = rest.indexOf("\nexport ", 10);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
    assert(body.includes("getEntries()"), "must call zip.getEntries() for traversal check");
    const entriesIdx = body.indexOf("getEntries()");
    const extractIdx = body.indexOf("extractAllTo");
    assert(
      entriesIdx < extractIdx,
      "getEntries() traversal check must appear before extractAllTo()"
    );
  });

  it("ingestZipIntoSandbox rejects traversal-escape entries", () => {
    const fnStart = sandbox.indexOf("export async function ingestZipIntoSandbox");
    const rest = sandbox.slice(fnStart);
    const nextExport = rest.indexOf("\nexport ", 10);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
    assert(
      body.includes("path traversal") && body.includes("Extraction aborted"),
      "must throw with 'path traversal' and 'Extraction aborted' message"
    );
  });

  it("ingestZipIntoSandbox rejects empty ZIPs", () => {
    const fnStart = sandbox.indexOf("export async function ingestZipIntoSandbox");
    const rest = sandbox.slice(fnStart);
    const nextExport = rest.indexOf("\nexport ", 10);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
    assert(
      body.includes("entries.length === 0") && body.includes("ZIP is empty"),
      "must reject empty ZIPs before extraction"
    );
  });

  it("ingestZipIntoSandbox uses path.resolve for boundary check", () => {
    const fnStart = sandbox.indexOf("export async function ingestZipIntoSandbox");
    const rest = sandbox.slice(fnStart);
    const nextExport = rest.indexOf("\nexport ", 10);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
    assert(
      body.includes("path.resolve("),
      "must use path.resolve to canonicalise entry paths for comparison"
    );
  });

  it("sandbox-runtime.ts header says v25", () => {
    assert(
      sandbox.includes("TFA Evolution Studio v25"),
      "sandbox-runtime.ts file header must be updated to v25"
    );
  });
});

// ── [3] B4-V25-2 — buildManifest orphaned string literal removed ─────────────

describe("[B4-V25-2] WS4 — buildManifest orphaned '\",' literal removed", () => {
  const release = readSrc("lib", "release", "release.ts");

  it("buildManifest function exists", () => {
    assert(
      release.includes("export function buildManifest"),
      "buildManifest must be exported from release.ts"
    );
  });

  it("buildManifest lines array does not contain orphaned comma string", () => {
    const fnStart = release.indexOf("export function buildManifest");
    const rest = release.slice(fnStart);
    const nextExport = rest.indexOf("\nexport ", 10);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
    assert(
      !body.includes('`",`') && !body.includes('"\\","') && !body.includes("'\\\",'"),
      "buildManifest lines array must not contain orphaned '\",' literal"
    );
    // Specifically check the exact stray pattern from v24
    assert(!body.includes('`",`'), "must not contain template literal `\",`");
    assert(!body.includes('"\\","'), 'must not contain JSON-escaped "\\","');
  });

  it("buildManifest produces a header line as its first line entry", () => {
    const fnStart = release.indexOf("export function buildManifest");
    const rest = release.slice(fnStart);
    const nextExport = rest.indexOf("\nexport ", 10);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
    assert(
      body.includes("Release Manifest"),
      "First line of manifest must be the Release Manifest header"
    );
  });

  it("release.ts header says v25", () => {
    assert(
      release.includes("TFA Evolution Studio v25"),
      "release.ts file header must be updated to v25"
    );
  });
});

// ── [4] B4-V25-3 — validation-gate ESM import conversion ────────────────────

describe("[B4-V25-3] WS4 — validation-gate.ts uses top-level ESM imports", () => {
  const vg = readSrc("lib", "engine", "validation-gate.ts");

  it("validation-gate.ts has top-level import for fs", () => {
    // Top-level import must appear before any function definition
    const importFsIdx = vg.indexOf('import fs from "fs"');
    const firstFnIdx = vg.indexOf("export function");
    assert(importFsIdx !== -1, 'must have top-level import fs from "fs"');
    assert(importFsIdx < firstFnIdx, "fs import must be at top level, before any function");
  });

  it("validation-gate.ts has top-level import for path", () => {
    const importPathIdx = vg.indexOf('import path from "path"');
    const firstFnIdx = vg.indexOf("export function");
    assert(importPathIdx !== -1, 'must have top-level import path from "path"');
    assert(importPathIdx < firstFnIdx, "path import must be at top level, before any function");
  });

  it("validation-gate.ts does not use require() inside any function", () => {
    // Strip out comments first by checking for require( outside the header block
    const withoutHeader = vg.slice(vg.indexOf("export "));
    assert(
      !withoutHeader.includes("require("),
      "validation-gate.ts must not use require() inside function bodies"
    );
  });

  it("validation-gate.ts header says v25", () => {
    assert(
      vg.includes("TFA Evolution Studio v25"),
      "validation-gate.ts file header must be updated to v25"
    );
  });

  it("V25 fix comment present in validation-gate.ts", () => {
    assert(
      vg.includes("V25 fix"),
      "validation-gate.ts must include a V25 fix comment"
    );
  });
});

// ── [5] B5-V25-1 — Sidebar footer version coherence ─────────────────────────

describe("[B5-V25-1] WS5 — Sidebar footer shows v25.0.0", () => {
  const sidebar = readSrc("components", "layout", "Sidebar.tsx");

  it("Sidebar footer div does not contain v21.0.0", () => {
    assert(
      !sidebar.includes("v21.0.0"),
      "Sidebar footer must not contain stale v21.0.0"
    );
  });

  it("Sidebar footer div shows v25.0.0", () => {
    assert(sidebar.includes("v25.0.0"), "Sidebar footer must show v25.0.0");
  });

  it("Sidebar header label shows Studio v25.0", () => {
    assert(
      sidebar.includes("Studio v25.0"),
      "Sidebar header label must show Studio v25.0"
    );
  });

  it("Sidebar does not contain any stale version reference (v21/v22/v23/v24)", () => {
    // Sidebar should have no stale version references
    assert(!sidebar.includes("v21.0.0"), "must not contain v21.0.0");
    assert(!sidebar.includes("v22.0.0"), "must not contain v22.0.0");
    assert(!sidebar.includes("v23.0.0"), "must not contain v23.0.0");
    assert(!sidebar.includes("v24.0.0"), "must not contain v24.0.0");
  });
});

// ── [6] B5-V25-2 — package.json description coherence ───────────────────────

describe("[B5-V25-2] WS5 — package.json description references v25", () => {
  const pkg = JSON.parse(readFile("package.json"));

  it("package.json version = 25.0.0", () => {
    assert(pkg.version === "25.0.0", `package.json version = ${pkg.version}, expected 25.0.0`);
  });

  it("package.json description does not reference v23.0.0", () => {
    assert(
      !pkg.description.includes("v23.0.0"),
      "package.json description must not contain stale v23.0.0 reference"
    );
  });

  it("package.json description references v25.0.0", () => {
    assert(
      pkg.description.includes("v25.0.0") || pkg.description.includes("25.0.0"),
      "package.json description must reference v25.0.0"
    );
  });

  it("package.json scripts includes v25-tests", () => {
    assert(
      pkg.scripts["v25-tests"] !== undefined,
      "package.json must include v25-tests script"
    );
  });

  it("package.json scripts v25-tests points to scripts/v25-tests.mjs", () => {
    assert(
      pkg.scripts["v25-tests"].includes("v25-tests.mjs"),
      "v25-tests script must reference v25-tests.mjs"
    );
  });
});

// ── [7] B5-V25-3 — README version history table ──────────────────────────────

describe("[B5-V25-3] WS5 — README version history table includes v25", () => {
  const readme = readFile("README.md");

  it("README heading references v25.0.0", () => {
    assert(readme.includes("v25.0.0"), "README heading must reference v25.0.0");
  });

  it("README version table has 25.0.0 row", () => {
    assert(
      readme.includes("25.0.0"),
      "README version history table must contain a 25.0.0 row"
    );
  });

  it("README version table has 24.0.0 row (not just v23 at top)", () => {
    assert(
      readme.includes("24.0.0"),
      "README version history table must contain a 24.0.0 row"
    );
  });

  it("README ← current marker is on 25.0.0 row", () => {
    const currentIdx = readme.indexOf("← **current**");
    assert(currentIdx !== -1, "README must have a ← current marker");
    // The 25.0.0 text should appear within 20 chars before the marker
    const window = readme.slice(Math.max(0, currentIdx - 30), currentIdx + 5);
    assert(
      window.includes("25.0.0"),
      "← current marker must be on the 25.0.0 row"
    );
  });

  it("README references V25-RELEASE-NOTES.md", () => {
    assert(
      readme.includes("V25-RELEASE-NOTES.md"),
      "README must link to V25-RELEASE-NOTES.md"
    );
  });

  it("V25-RELEASE-NOTES.md file exists", () => {
    assert(
      fs.existsSync(path.join(ROOT, "V25-RELEASE-NOTES.md")),
      "V25-RELEASE-NOTES.md must exist in the repository root"
    );
  });
});

// ── [8] B7-V25-1 — cross-project-engine deterministic pattern IDs ────────────

describe("[B7-V25-1] WS7 — cross-project-engine uses stable pattern IDs", () => {
  const cpe = readSrc("lib", "intelligence", "cross-project-engine.ts");

  it("stablePatternId helper function is defined", () => {
    assert(
      cpe.includes("function stablePatternId"),
      "stablePatternId helper must be defined in cross-project-engine.ts"
    );
  });

  it("stablePatternId uses djb2-style hash (bitwise operations)", () => {
    const fnStart = cpe.indexOf("function stablePatternId");
    const rest = cpe.slice(fnStart);
    const nextFn = rest.indexOf("\nfunction ", 10);
    const body = nextFn === -1 ? rest.slice(0, 400) : rest.slice(0, nextFn);
    assert(
      body.includes("h << 5") || body.includes("charCodeAt"),
      "stablePatternId must use a hash algorithm (djb2 or similar)"
    );
  });

  it("analyzePatterns uses stablePatternId, not Date.now(), for pattern IDs", () => {
    const fnStart = cpe.indexOf("export function analyzePatterns") !== -1
      ? cpe.indexOf("export function analyzePatterns")
      : cpe.indexOf("export async function analyzePatterns");
    assert(fnStart !== -1, "analyzePatterns function must exist");
    const rest = cpe.slice(fnStart);
    const nextExport = rest.indexOf("\nexport ", 10);
    const body = nextExport === -1 ? rest : rest.slice(0, nextExport);
    assert(
      !body.includes("Date.now()"),
      "analyzePatterns must not use Date.now() in pattern IDs"
    );
    assert(
      body.includes("stablePatternId("),
      "analyzePatterns must use stablePatternId() for all pattern IDs"
    );
  });

  it("no pat_*_${Date.now()} pattern remains anywhere in the file", () => {
    assert(
      !cpe.includes("Date.now()"),
      "cross-project-engine.ts must have zero Date.now() calls (all replaced with stablePatternId)"
    );
  });

  it("cross-project-engine.ts header says v25", () => {
    assert(
      cpe.includes("TFA Evolution Studio v25"),
      "cross-project-engine.ts file header must be updated to v25"
    );
  });

  it("V25 fix comment present in cross-project-engine.ts", () => {
    assert(
      cpe.includes("V25 fix"),
      "cross-project-engine.ts must include a V25 fix comment"
    );
  });
});

// ── [9] Version Coherence — all identity fields = 25.0.0 ────────────────────

describe("[VC-V25] Version Coherence — all identity fields = 25.0.0", () => {
  it("package.json version = 25.0.0", () => {
    const pkg = JSON.parse(readFile("package.json"));
    assert(pkg.version === "25.0.0", `package.json = ${pkg.version}`);
  });

  it("package-lock.json root version = 25.0.0", () => {
    const lock = JSON.parse(readFile("package-lock.json"));
    assert(lock.version === "25.0.0", `package-lock.json = ${lock.version}`);
  });

  it("README heading references v25.0.0", () => {
    const readme = readFile("README.md");
    assert(readme.match(/v25\.0\.0/) !== null, "README must reference v25.0.0");
  });

  it("RELEASE_NOTES.md heading references 25.0.0", () => {
    const notes = readFile("RELEASE_NOTES.md");
    assert(notes.includes("25.0.0"), "RELEASE_NOTES.md must reference 25.0.0");
  });

  it("RELEASE_NOTES.md ← current marker is on 25.0.0 row", () => {
    const notes = readFile("RELEASE_NOTES.md");
    const currentIdx = notes.indexOf("← **current**");
    assert(currentIdx !== -1, "RELEASE_NOTES.md must have a ← current marker");
    const window = notes.slice(Math.max(0, currentIdx - 30), currentIdx + 5);
    assert(window.includes("25.0.0"), "← current must be on the 25.0.0 row");
  });

  it("V25-RELEASE-NOTES.md exists", () => {
    assert(
      fs.existsSync(path.join(ROOT, "V25-RELEASE-NOTES.md")),
      "V25-RELEASE-NOTES.md must exist"
    );
  });

  it("Sidebar footer shows v25.0.0 (no stale version)", () => {
    const sidebar = readSrc("components", "layout", "Sidebar.tsx");
    assert(sidebar.includes("v25.0.0"), "Sidebar footer must show v25.0.0");
    assert(!sidebar.includes("v21.0.0"), "Sidebar must not contain stale v21.0.0");
  });

  it("all 13 stale file headers updated to v25", () => {
    const checks = [
      ["lib", "engine", "evidence-chain.ts"],
      ["lib", "engine", "strategy-engine.ts"],
      ["lib", "engine", "validation-gate.ts"],
      ["lib", "version-coherence.ts"],
      ["lib", "release", "release.ts"],
      ["lib", "release", "release-gate.ts"],
      ["lib", "release", "release-governor.ts"],
      ["lib", "job-engine", "durable-job-store.ts"],
      ["lib", "compiler", "sandbox-runtime.ts"],
      ["lib", "batch", "batch-coordinator.ts"],
      ["lib", "audit", "self-audit.ts"],
      ["lib", "agents", "sovereign-orchestrator.ts"],
      ["lib", "workflow", "workflow-engine.ts"],
    ];
    for (const parts of checks) {
      const content = readSrc(...parts);
      const label = parts[parts.length - 1];
      assert(
        content.includes("TFA Evolution Studio v25"),
        `${label}: file header must reference v25 (found stale header)`
      );
    }
  });

  it("no file header references a version older than v25 in core engine files", () => {
    const stalePatterns = [
      "TFA Evolution Studio v20",
      "TFA Evolution Studio v21",
      "TFA Evolution Studio v22",
      "TFA Evolution Studio v23",
      "TFA Evolution Studio v24",
    ];
    const coreFiles = [
      ["lib", "engine", "evidence-chain.ts"],
      ["lib", "engine", "strategy-engine.ts"],
      ["lib", "engine", "validation-gate.ts"],
      ["lib", "release", "release.ts"],
      ["lib", "release", "release-gate.ts"],
      ["lib", "release", "release-governor.ts"],
      ["lib", "job-engine", "durable-job-store.ts"],
      ["lib", "compiler", "sandbox-runtime.ts"],
      ["lib", "batch", "batch-coordinator.ts"],
      ["lib", "audit", "self-audit.ts"],
      ["lib", "agents", "sovereign-orchestrator.ts"],
      ["lib", "workflow", "workflow-engine.ts"],
    ];
    for (const parts of coreFiles) {
      const content = readSrc(...parts);
      const label = parts[parts.length - 1];
      for (const stale of stalePatterns) {
        assert(
          !content.startsWith("/**\n * " + stale) && !content.includes("\n * " + stale + " —"),
          `${label}: file header must not reference stale version (found: ${stale})`
        );
      }
    }
  });
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(`V25 Test Results: ${passed} passed, ${failed} failed`);
console.log("─".repeat(60));

if (failed > 0) {
  process.exit(1);
}
