import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const zipPath = process.argv[2];
const outputPath = process.argv[3];
if (!zipPath || !outputPath) {
  console.error("Usage: node scripts/verify-v15-sovereignty.mjs <release.zip> <attestation.json>");
  process.exit(2);
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (rel) => JSON.parse(await readFile(path.resolve(root, rel), "utf8"));
const [summary, validation, findings, manifest] = await Promise.all([
  readJson("docs/canonical/evidence/v15/v15-sovereignty-summary.json"),
  readJson("docs/canonical/evidence/v15-final/v15-validation.json"),
  readJson("docs/roast/ROAST_FINDINGS.json"),
  readJson("docs/roast/RELEASE_MANIFEST.json"),
]);
const zipBytes = await readFile(path.resolve(zipPath));
const releaseSha256 = hash(zipBytes);
const requiredSlices = summary.status === "three_vertical_slices_passed";
const blockers = validation.blockers ?? [];
const criticalOpen = findings.findings.filter((f) => f.severity === "critical" && ["open", "environment_blocked"].includes(f.status));
const controlledPilotEligible = requiredSlices && blockers.length === 0 && criticalOpen.length === 0;
const attestation = {
  schemaVersion: 1,
  verifierIdentity: "v15-local-independent-verifier",
  verifierSeparation: "Separate executable invocation and evidence-only inputs; same host and organization, therefore not external independence.",
  verifiedAt: new Date().toISOString(),
  release: manifest.release,
  releaseSha256,
  sourceVersion: manifest.sourceVersion,
  manifestFileCount: manifest.fileCount,
  evidence: {
    mandatoryVerticalSlicesPassed: requiredSlices,
    productionBuildPassed: validation.build?.passed === true,
    regressionPassed: validation.tests?.passed === validation.tests?.tests,
    trustAndReplayEnforced: validation.securityEnhancement?.durableReplayRejection === true,
    mandatoryExternalRuntimeDependencies: validation.dependencies?.mandatoryExternalRuntime ?? null,
    blockers,
    openCriticalFindings: criticalOpen.map((f) => f.id),
  },
  decision: {
    sovereigntyClassification: controlledPilotEligible ? "SOVEREIGN CONTROLLED PILOT" : "SOVEREIGN DEVELOPMENT MODE",
    standardReleaseClassification: "DEVELOPMENT ONLY",
    sovereignControlledPilotAccepted: controlledPilotEligible,
    status: controlledPilotEligible ? "ACCEPTED" : "REJECTED",
    reasons: controlledPilotEligible ? [] : [
      ...blockers,
      ...criticalOpen.map((f) => `open_critical:${f.id}`),
      "external_organizational_independence_absent",
    ],
  },
};
await writeFile(path.resolve(outputPath), `${JSON.stringify(attestation, null, 2)}\n`);
console.log(JSON.stringify(attestation, null, 2));
if (controlledPilotEligible) process.exit(0);
process.exit(3);
