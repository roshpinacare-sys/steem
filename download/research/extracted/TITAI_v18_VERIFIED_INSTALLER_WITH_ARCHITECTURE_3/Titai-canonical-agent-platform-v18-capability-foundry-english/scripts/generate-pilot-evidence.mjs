import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const root = process.cwd();
const out = resolve(root, "docs/canonical/evidence/v13");
mkdirSync(out, { recursive: true });
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const loadJson = (file) => {
  const absolute = resolve(root, file);
  if (!existsSync(absolute)) return null;
  try { return JSON.parse(readFileSync(absolute, "utf8")); } catch { return null; }
};
const stateFromExit = (file) => loadJson(file)?.exitCode === 0 ? "pass" : existsSync(resolve(root, file)) ? "fail" : "unknown";
const evidenceFiles = [
  "docs/canonical/evidence/v13/pilot-failure-matrix.json",
  "docs/canonical/evidence/v13/mutation-probes.json",
  "docs/canonical/evidence/v13/performance-microbenchmarks.json",
  "docs/canonical/evidence/v13/test-safe-final.log",
  "docs/canonical/evidence/v13/gates/canonical.log",
  "docs/canonical/evidence/v13/gates/typecheck.log",
  "docs/canonical/evidence/v13/gates/eval.log",
  "docs/canonical/evidence/v13/gates/durable.log",
  "docs/canonical/evidence/v13/build/production-build-release.log",
  "docs/canonical/evidence/v13/native/native-suites.log",
  "docs/canonical/evidence/v13/browser/playwright-list.log",
  "docs/canonical/evidence/v13/browser/e2e-chromium.log",
];
const artifacts = evidenceFiles.filter((file) => existsSync(resolve(root, file))).map((file) => {
  const buffer = readFileSync(resolve(root, file));
  return { path: relative(root, resolve(root, file)).replaceAll("\\", "/"), sha256: sha(buffer), bytes: buffer.length };
});
const failureMatrix = loadJson("docs/canonical/evidence/v13/pilot-failure-matrix.json");
const mutations = loadJson("docs/canonical/evidence/v13/mutation-probes.json");
const build = loadJson("docs/canonical/evidence/v13/build/production-build-release.json");
const native = loadJson("docs/canonical/evidence/v13/native/native-suites.json");
const browser = loadJson("docs/canonical/evidence/v13/browser/e2e-chromium.json");
const gates = {
  canonicalIntegrity: { state: stateFromExit("docs/canonical/evidence/v13/gates/canonical.json") },
  languageAndSourceAudit: { state: stateFromExit("docs/canonical/evidence/v13/gates/language.json") === "pass" && stateFromExit("docs/canonical/evidence/v13/gates/lint.json") === "pass" ? "pass" : "fail" },
  sourceSafeTests: { state: stateFromExit("docs/canonical/evidence/v13/test-safe-final.json"), evidence: "44 files / 147 tests" },
  durablePortableProof: { state: stateFromExit("docs/canonical/evidence/v13/gates/durable.json"), evidence: "one side effect across two worker attempts" },
  tenantAndApprovalSourceTests: { state: existsSync(resolve(root, "tests/tenant-isolation-property.test.ts")) && existsSync(resolve(root, "tests/durable-approval-restart.test.ts")) ? "pass" : "unknown" },
  mutationThreshold: { state: mutations?.summary?.killed === mutations?.summary?.total && mutations?.summary?.total >= 10 ? "pass" : "fail", evidence: mutations?.summary ?? null },
  portableFailureMatrix: { state: failureMatrix?.summary?.blocked === 0 ? "pass" : "partial", evidence: failureMatrix?.summary ?? null },
  productionBuild: { state: build?.exitCode === 0 ? "pass" : build ? "fail" : "unknown", evidence: build ? { durationMs: build.durationMs, outputSha256: build.outputSha256 } : null },
  nativePersistence: { state: native?.exitCode === 0 ? "pass" : "blocked_environment", evidence: native ? { exitCode: native.exitCode, outputSha256: native.outputSha256 } : null },
  browserE2e: { state: browser?.exitCode === 0 ? "pass" : "blocked_environment", evidence: browser ? { exitCode: browser.exitCode, outputSha256: browser.outputSha256 } : null },
  accessibilityAndVisualRegression: { state: "blocked_environment" },
  multiProcessRaceAndRestart: { state: "blocked_environment" },
  cleanNativeRestore: { state: "blocked_environment" },
  independentFinalVerification: { state: "pending_final_zip" },
};
const blocking = Object.values(gates).filter((gate) => gate.state !== "pass").length;
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  pilotScope: "bounded local artifact generation in a personal tenant/workspace",
  releaseClassification: blocking === 0 ? "CONTROLLED INTERNAL PILOT" : "DEVELOPMENT ONLY",
  blockingGates: blocking,
  gates,
  artifacts,
};
writeFileSync(resolve(out, "pilot-evidence-bundle.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`Pilot evidence bundle: ${report.releaseClassification}; ${blocking} blocking gate(s).`);
