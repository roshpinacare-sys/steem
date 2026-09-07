import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifestPath = "docs/roast/RELEASE_MANIFEST.json";
const excludedAnywhere = new Set([
  "node_modules", ".next", ".git", "coverage", "test-results",
  "playwright-report", ".turbo",
]);
const excludedAtRoot = new Set(["dist", "data", "backups"]);
const excludedFiles = new Set([manifestPath, "tsconfig.tsbuildinfo", ".env", ".DS_Store"]);
const excludedSuffixes = [".db", ".db-wal", ".db-shm", ".sqlite", ".sqlite3"];

function isExcluded(relativePath, name, isDirectory) {
  const normalized = relativePath.replaceAll(path.sep, "/");
  if (isDirectory && excludedAnywhere.has(name)) return true;
  if (isDirectory && excludedAtRoot.has(normalized) && !normalized.includes("/")) return true;
  if (!isDirectory && excludedFiles.has(normalized)) return true;
  return !isDirectory && excludedSuffixes.some((suffix) => name.toLowerCase().endsWith(suffix));
}

async function walk(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
    if (isExcluded(relative, entry.name, entry.isDirectory())) continue;
    if (entry.isDirectory()) results.push(...await walk(absolute));
    else if (entry.isFile()) results.push(relative);
  }
  return results;
}

const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const readJson = async (relative, fallback = null) => {
  try { return JSON.parse(await readFile(path.join(root, relative), "utf8")); }
  catch { return fallback; }
};

const pkg = await readJson("package.json", {});
const roast = await readJson("docs/roast/ROAST_FINDINGS.json", { findings: [] });
const validation = await readJson("docs/canonical/evidence/v18/validation.json", {});
const durable = await readJson("docs/canonical/evidence/durable-vertical-slice.json", {});
const roastCounts = (roast.findings ?? []).reduce((result, finding) => {
  result[finding.status] = (result[finding.status] ?? 0) + 1;
  return result;
}, {});

const files = [];
for (const relative of (await walk(root)).sort()) {
  const absolute = path.join(root, relative);
  const bytes = await readFile(absolute);
  const details = await stat(absolute);
  files.push({ path: relative, bytes: details.size, sha256: hash(bytes) });
}

const release = {
  schemaVersion: 3,
  release: "TITAI Canonical Agent Platform v18 Sovereign Capability Foundry English",
  createdAt: new Date().toISOString(),
  sourceVersion: pkg.version ?? null,
  manifestExcludes: [manifestPath],
  archiveExclusions: [
    "node_modules", ".next", ".git", "coverage", "dist", "data",
    "test-results", "playwright-report", "backups", ".env",
    "tsconfig.tsbuildinfo", "SQLite database files",
  ],
  validationEvidence: {
    validation: "docs/canonical/evidence/v18/validation.json",
    engineeringReport: "docs/canonical/68_V18_CAPABILITY_FOUNDRY_ENGINEERING_REPORT.md",
    evidenceIndex: "docs/canonical/66_V18_EVIDENCE_INDEX.md",
    roastAddendum: "docs/roast/ROAST_FINDINGS.json",
    fullTestLog: "docs/canonical/evidence/v18/full-tests/summary.json",
    nativeTestLog: "docs/canonical/evidence/v18/full-tests/summary.json",
    buildLog: "docs/canonical/evidence/v18/gates/build.stdout.log",
    browserLog: "docs/canonical/evidence/v17/browser/evidence.json",
    pilotEvidence: "docs/canonical/evidence/v18/validation.json",
  },
  durableProof: {
    result: durable.verification?.status ?? durable.verification?.result ?? durable.result ?? null,
    injectedCrashObserved: durable.faultInjection?.observed ?? durable.injectedCrashObserved ?? null,
    sideEffectCount: durable.metrics?.sideEffectExecutions ?? durable.sideEffectCount ?? null,
    attempts: durable.metrics?.attempts ?? durable.attempts ?? durable.attemptCount ?? null,
    evidenceHash: durable.verification?.evidenceHash ?? durable.evidenceHash ?? null,
  },
  roastStatusCounts: roastCounts,
  validationSummary: validation.summary ?? validation,
  fileCount: files.length,
  files,
};

await writeFile(path.join(root, manifestPath), `${JSON.stringify(release, null, 2)}\n`);
console.log(`Release manifest generated: ${files.length} files.`);
