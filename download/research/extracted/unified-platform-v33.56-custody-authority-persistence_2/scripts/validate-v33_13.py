#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "release-evidence/v33.13"
REQUIRED = [
    "src/repository/isolation-runtime-contract-v33_13.ts",
    "src/repository/qualified-hostile-code-orchestrator-v33_13.ts",
    "tests/qualified-isolation-orchestration-v33_13.test.ts",
    "scripts/qualified-isolation-orchestration-proof-v33_13.mjs",
    "scripts/run-full-regression-v33_13.sh",
    "scripts/validate-v33_13.py",
    "docs/V33_13_RUNTIME_ADAPTER_AND_INDEPENDENT_VERIFICATION.md",
    "CLAUDE_HANDOFF_v33_13.md",
    "v33/governance-state/PROOF_GATE_REGISTRY_V33.json",
    "v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json",
    "release-evidence/v33.13/V33_13_QUALIFIED_ISOLATION_ORCHESTRATION_PROOF.json",
    "release-evidence/v33.13/V33_13_MULTI_ROLE_TRACE.json",
    "release-evidence/v33.13/V33_13_FULL_TEST_RESULTS.json",
    "release-evidence/v33.13/V33_13_FULL_TEST_STDOUT.tap",
    "release-evidence/v33.13/V33_13_FULL_TEST_STDERR.log",
    "release-evidence/v33.13/V33_13_FULL_TEST_EXIT.txt",
    "release-evidence/v33.13/V33_13_FULL_TEST_META.json",
    "release-evidence/v33.13/V33_13_REPOSITORY_TRUTH_MAP.json",
    "release-evidence/v33.13/V33_13_ARCHITECTURE_INTEGRITY.json",
    "release-evidence/v33.13/V33_13_EXECUTION_LEDGER.md",
    "release-evidence/v33.13/V33_13_RELEASE_MANIFEST.json",
]


def load(relative: str) -> dict:
    return json.loads((ROOT / relative).read_text())


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


errors: list[str] = []
for relative in REQUIRED:
    if not (ROOT / relative).is_file():
        errors.append(f"missing:{relative}")

if errors:
    print(json.dumps({"version": "33.13", "status": "failed", "errors": errors}, indent=2))
    sys.exit(1)

proof = load("release-evidence/v33.13/V33_13_QUALIFIED_ISOLATION_ORCHESTRATION_PROOF.json")
trace = load("release-evidence/v33.13/V33_13_MULTI_ROLE_TRACE.json")
full = load("release-evidence/v33.13/V33_13_FULL_TEST_RESULTS.json")
truth = load("release-evidence/v33.13/V33_13_REPOSITORY_TRUTH_MAP.json")
architecture = load("release-evidence/v33.13/V33_13_ARCHITECTURE_INTEGRITY.json")
gates = load("v33/governance-state/PROOF_GATE_REGISTRY_V33.json")
capabilities = load("v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json")
manifest = load("release-evidence/v33.13/V33_13_RELEASE_MANIFEST.json")

expected_proof = {
    "status": "LOCAL_MULTI_ROLE_REFERENCE_QUALIFICATION_PASSED",
    "evidenceClass": "LOCAL_REFERENCE_MULTI_ROLE_QUALIFICATION",
    "capabilityAttestationVerified": True,
    "localNamespaceRuntime": "VERIFIED_AVAILABLE",
    "openat2Qualified": False,
    "seccompQualified": False,
    "cgroupV2Qualified": False,
    "secondRuntimeQualified": False,
    "multiHostQualified": False,
    "sourceStable": True,
    "descriptorManifestStable": True,
    "runtimeReceiptVerified": True,
    "adapterEvidenceVerified": True,
    "independentVerdictVerified": True,
    "independentVerdictStatus": "REFERENCE_QUALIFIED",
    "selfVerificationRejected": True,
    "roleCount": 5,
    "externalEffectsExecuted": 0,
    "runtimeRootDestroyed": True,
    "promotionCeiling": "research",
    "productionPromotion": "blocked",
    "externalQualification": "not_executed",
}
for key, expected in expected_proof.items():
    if proof.get(key) != expected:
        errors.append(f"proof_metric_invalid:{key}")

if set(proof.get("limitations", [])) != {
    "DESCRIPTOR_PINNING_IS_PARTIAL_WITHOUT_OPENAT2",
    "LOCAL_NAMESPACE_RUNTIME_DELEGATES_TO_V33_12_REFERENCE",
    "NO_SECCOMP_EXECUTED_PROOF",
    "NO_CGROUP_V2_EXECUTED_PROOF",
    "NO_SECOND_RUNTIME",
    "NO_MULTI_HOST",
    "NO_EXTERNAL_WITNESS",
}:
    errors.append("proof_limitations_invalid")

role_ids = trace.get("roleKeyIds", {})
if set(role_ids) != {"admission", "capability", "runtime", "orchestrator", "verifier"} or len(set(role_ids.values())) != 5:
    errors.append("role_separation_trace_invalid")
if trace.get("verdict", {}).get("payload", {}).get("status") != "REFERENCE_QUALIFIED":
    errors.append("independent_verdict_trace_invalid")
if trace.get("selfVerdict", {}).get("payload", {}).get("status") != "REJECTED":
    errors.append("self_verdict_not_rejected")
if trace.get("snapshotBefore", {}).get("manifestDigest") != trace.get("snapshotAfter", {}).get("manifestDigest"):
    errors.append("snapshot_manifest_unstable")

full_totals = full.get("totals", {})
if (
    full.get("status") != "passed"
    or (full_totals.get("testFiles"), full_totals.get("tests"), full_totals.get("passed"), full_totals.get("failed")) != (198, 1389, 1389, 0)
    or full.get("runnerExitCode") != 0
    or full.get("timedOut") is not False
    or full.get("forceExitDisabled") is not True
):
    errors.append("full_regression_invalid")
for evidence_field, digest_field in [("stdoutEvidence", "stdoutSha256"), ("stderrEvidence", "stderrSha256")]:
    evidence_path = ROOT / str(full.get(evidence_field, ""))
    if not evidence_path.is_file() or sha(evidence_path) != full.get(digest_field):
        errors.append(f"{evidence_field}_invalid")
exit_path = ROOT / str(full.get("exitEvidence", ""))
if not exit_path.is_file() or exit_path.read_text().strip() != "0":
    errors.append("exit_receipt_invalid")

inventory = truth.get("inventory", {})
if truth.get("status") != "passed" or truth.get("findings") != [] or inventory.get("sourceModules") != 200 or inventory.get("testFiles") != 198:
    errors.append("truth_map_invalid")

metrics = architecture.get("metrics", {})
if (
    architecture.get("status") != "PASS"
    or architecture.get("findings") != []
    or (metrics.get("sourceCycleCount"), metrics.get("untestedSourceCount"), metrics.get("capabilityPathCount"), metrics.get("closedCapabilityPathCount")) != (0, 0, 121, 121)
):
    errors.append("architecture_invalid")
closures = {row.get("capabilityId") for row in architecture.get("capabilityClosure", [])}
for capability_id in ["isolation-runtime-adapter-and-host-attestation-v33.13", "independent-isolation-orchestration-v33.13"]:
    if capability_id not in closures:
        errors.append(f"architecture_path_missing:{capability_id}")

if gates.get("version") != "33.13":
    errors.append("governance_version_invalid")
by_gate = {gate.get("id"): gate for gate in gates.get("gates", [])}
for gate_id in ("G4", "G5"):
    if by_gate.get(gate_id, {}).get("status") != "in-progress":
        errors.append(f"governance_status_invalid:{gate_id}")
findings = " ".join(str(by_gate.get(g, {}).get("currentFinding", "")).lower() for g in ("G4", "G5"))
for marker in ["openat2", "seccomp", "cgroup v2", "second runtime", "multi-host", "production remains blocked"]:
    if marker not in findings:
        errors.append(f"governance_boundary_missing:{marker}")

if capabilities.get("version") != "33.13":
    errors.append("capability_map_version_invalid")
engineering = set(next((layer.get("capabilities", []) for layer in capabilities.get("layers", []) if layer.get("layer") == "engineering-pack"), []))
for capability in [
    "signed-host-isolation-capability-attestation",
    "provider-neutral-isolation-runtime-adapter",
    "descriptor-pinned-repository-manifest-reference",
    "five-role-isolation-separation-of-duties",
    "signed-isolation-orchestration-bundle",
    "independent-research-ceiling-isolation-verdict",
]:
    if capability not in engineering:
        errors.append(f"capability_missing:{capability}")

if not errors:
    for command in [["npm", "run", "truth-map:v32.18"], ["npm", "run", "architecture:v32"]]:
        process = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        if process.returncode != 0:
            errors.append("regeneration_failed:" + process.stdout[-1200:] + process.stderr[-1200:])

if not errors:
    regenerated_truth = load("evidence/generated/V32_18_REPOSITORY_TRUTH_MAP.json")
    regenerated_architecture = load("evidence/generated/V32_ARCHITECTURE_INTEGRITY.json")
    if regenerated_truth.get("inventory") != truth.get("inventory") or regenerated_truth.get("findings") != truth.get("findings"):
        errors.append("truth_regeneration_mismatch")
    if regenerated_architecture.get("graphDigest") != architecture.get("graphDigest"):
        errors.append("architecture_regeneration_mismatch")

if not errors:
    test_names = [
        "chat-mission-v33_1", "mission-conversation-v33_2", "device-push-v33_3", "reliable-push-v33_4",
        "push-adapter-qualification-v33_5", "human-pilot-readiness-v33_6", "controlled-pilot-and-market-v33_7",
        "chat-engineering-vertical-v33_8", "multi-file-engineering-campaign-v33_9", "external-git-provider-qualification-v33_10",
        "malicious-repository-admission-v33_11", "qualified-hostile-code-isolation-v33_12", "qualified-isolation-orchestration-v33_13",
    ]
    process = subprocess.run(["node", "--test", "--test-concurrency=4", *[f"dist/tests/{name}.test.js" for name in test_names]], cwd=ROOT, capture_output=True, text=True, timeout=180)
    totals = []
    for marker in ["tests", "pass", "fail"]:
        match = re.search(rf"# {marker} (\d+)", process.stdout)
        totals.append(int(match.group(1)) if match else None)
    if process.returncode != 0 or tuple(totals) != (222, 222, 0):
        errors.append("direct_v33_regression_invalid")

if (
    manifest.get("version") != "33.13"
    or manifest.get("status") != "release-candidate-local-reference-only"
    or manifest.get("productionPromotion") != "blocked"
    or manifest.get("externalQualification") != "not_executed"
    or manifest.get("openat2Qualified") is not False
    or manifest.get("seccompQualified") is not False
    or manifest.get("cgroupV2Qualified") is not False
    or manifest.get("secondRuntimeQualified") is not False
    or manifest.get("multiHostQualified") is not False
):
    errors.append("release_manifest_boundary_invalid")
for item in manifest.get("files", []):
    path = ROOT / str(item.get("path", ""))
    if not path.is_file() or path.stat().st_size != item.get("sizeBytes") or sha(path) != item.get("sha256"):
        errors.append(f"release_manifest_integrity_invalid:{item.get('path', '')}")

result = {
    "version": "33.13",
    "status": "passed" if not errors else "failed",
    "gates": {"G0": "passed", "G1": "passed", "G2": "in-progress-not-passed", "G3": "in-progress-not-passed", "G4": "in-progress-not-passed", "G5": "in-progress-not-passed"},
    "referenceQualification": {key: proof.get(key) for key in expected_proof},
    "regression": full_totals,
    "truthMap": {"sourceModules": inventory.get("sourceModules"), "testFiles": inventory.get("testFiles"), "findings": len(truth.get("findings", []))},
    "architecture": {key: metrics.get(key) for key in ["sourceCycleCount", "untestedSourceCount", "capabilityPathCount", "closedCapabilityPathCount"]},
    "errors": errors,
    "productionPromotion": "blocked",
    "externalQualification": "not_executed",
}
EVIDENCE.mkdir(parents=True, exist_ok=True)
(EVIDENCE / "V33_13_VALIDATION.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
sys.exit(0 if not errors else 1)
