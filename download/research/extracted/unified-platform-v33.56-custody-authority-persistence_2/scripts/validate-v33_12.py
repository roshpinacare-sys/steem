#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "release-evidence/v33.12"
REQUIRED = [
    "src/repository/qualified-hostile-code-isolation-v33_12.ts",
    "tests/qualified-hostile-code-isolation-v33_12.test.ts",
    "scripts/qualified-hostile-code-isolation-proof-v33_12.mjs",
    "scripts/run-full-regression-v33_12.sh",
    "scripts/validate-v33_12.py",
    "docs/V33_12_QUALIFIED_HOSTILE_CODE_ISOLATION.md",
    "CLAUDE_HANDOFF_v33_12.md",
    "v33/governance-state/PROOF_GATE_REGISTRY_V33.json",
    "v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json",
    "release-evidence/v33.12/V33_12_QUALIFIED_HOSTILE_CODE_ISOLATION_PROOF.json",
    "release-evidence/v33.12/V33_12_HOSTILE_EXECUTION_RESULTS.json",
    "release-evidence/v33.12/V33_12_FULL_TEST_RESULTS.json",
    "release-evidence/v33.12/V33_12_FULL_TEST_STDOUT.tap",
    "release-evidence/v33.12/V33_12_FULL_TEST_STDERR.log",
    "release-evidence/v33.12/V33_12_FULL_TEST_EXIT.txt",
    "release-evidence/v33.12/V33_12_FULL_TEST_META.json",
    "release-evidence/v33.12/V33_12_REPOSITORY_TRUTH_MAP.json",
    "release-evidence/v33.12/V33_12_ARCHITECTURE_INTEGRITY.json",
    "release-evidence/v33.12/V33_12_EXECUTION_LEDGER.md",
    "release-evidence/v33.12/V33_12_RELEASE_MANIFEST.json",
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
    result = {"version": "33.12", "status": "failed", "errors": errors}
    print(json.dumps(result, indent=2))
    sys.exit(1)

proof = load("release-evidence/v33.12/V33_12_QUALIFIED_HOSTILE_CODE_ISOLATION_PROOF.json")
execution = load("release-evidence/v33.12/V33_12_HOSTILE_EXECUTION_RESULTS.json")
rows = execution.get("results", [])
full = load("release-evidence/v33.12/V33_12_FULL_TEST_RESULTS.json")
truth = load("release-evidence/v33.12/V33_12_REPOSITORY_TRUTH_MAP.json")
architecture = load("release-evidence/v33.12/V33_12_ARCHITECTURE_INTEGRITY.json")
gates = load("v33/governance-state/PROOF_GATE_REGISTRY_V33.json")
capabilities = load("v33/governance-state/CANONICAL_CAPABILITY_MAP_V33.json")
manifest = load("release-evidence/v33.12/V33_12_RELEASE_MANIFEST.json")

if proof.get("status") != "LOCAL_LINUX_NAMESPACE_HOSTILE_CODE_CAMPAIGN_PASSED":
    errors.append("proof_status_invalid")
if proof.get("evidenceClass") != "LOCAL_LINUX_NAMESPACE_ISOLATION_REFERENCE":
    errors.append("proof_evidence_class_invalid")

expected_proof = {
    "scenarioCount": 12,
    "scenariosPassed": 12,
    "signedReceiptsVerified": 12,
    "independentChallengeAuthorizations": 11,
    "sourceRepositoriesUnchanged": 12,
    "runtimeRootsDestroyed": 12,
    "networkBoundaryObserved": 12,
    "hostFilesystemBoundaryObserved": 12,
    "procRootEscapeBlocked": 12,
    "inputReadOnlyObserved": 12,
    "workspaceWritableObserved": 12,
    "uidDropObserved": 12,
    "noNewPrivilegesObserved": 12,
    "capabilitiesDroppedObserved": 12,
    "sanitizedEnvironmentObserved": 12,
    "externalEffectsExecuted": 0,
    "secretsInjected": 0,
    "qualifiedIsolationExecuted": True,
    "microvmExecuted": False,
    "seccompQualified": False,
    "cgroupV2Qualified": False,
    "multiHostExecuted": False,
    "independentExternalReviewExecuted": False,
    "g4Status": "in-progress-not-passed",
    "g5Status": "in-progress-not-passed",
    "productionPromotion": "blocked",
    "externalQualification": "not_executed",
}
for key, value in expected_proof.items():
    if proof.get(key) != value:
        errors.append(f"proof_metric_invalid:{key}")

expected_limitations = {
    "local-single-host-reference-only",
    "host-kernel-and-host-binaries-trusted",
    "no-seccomp",
    "rlimits-not-cgroup-v2",
    "no-microvm",
    "no-independent-external-red-team",
    "shell-entrypoints-only",
    "snapshot-copy-not-openat2-race-hardened",
}
if set(proof.get("limitations", [])) != expected_limitations:
    errors.append("proof_limitations_invalid")
probe = proof.get("runtimeProbe", {})
if probe.get("available") is not True or probe.get("platform") != "linux" or probe.get("combinedNamespaceProbePassed") is not True:
    errors.append("runtime_probe_invalid")

expected_scenarios = {
    "benign-completion",
    "network-egress",
    "host-filesystem",
    "proc-root-escape",
    "input-mutation",
    "environment-secret-leak",
    "wall-time-limit",
    "process-limit",
    "file-size-limit",
    "memory-limit",
    "cpu-limit",
    "native-noexec",
}
if len(rows) != 12 or {row.get("scenarioId") for row in rows} != expected_scenarios:
    errors.append("hostile_scenario_inventory_invalid")
for row in rows:
    scenario_id = str(row.get("scenarioId"))
    common_valid = (
        row.get("signatureVerified") is True
        and row.get("commonBoundaryPassed") is True
        and row.get("scenarioPassed") is True
        and row.get("sourceUnchanged") is True
        and row.get("runtimeRootDestroyed") is True
        and isinstance(row.get("receiptDigest"), str)
        and len(row.get("receiptDigest", "")) == 64
    )
    if not common_valid:
        errors.append(f"hostile_scenario_invalid:{scenario_id}")
    if scenario_id == "benign-completion":
        if row.get("admissionDecision") != "QUALIFIED_ISOLATION_REQUIRED" or row.get("challengeAuthorized") is not False:
            errors.append("benign_authority_boundary_invalid")
    else:
        if row.get("admissionDecision") != "QUARANTINE" or row.get("challengeAuthorized") is not True:
            errors.append(f"challenge_authority_invalid:{scenario_id}")

row_by_id = {str(row.get("scenarioId")): row for row in rows}
if row_by_id.get("wall-time-limit", {}).get("timedOut") is not True:
    errors.append("wall_time_limit_not_observed")
if row_by_id.get("process-limit", {}).get("processLimitObserved") is not True:
    errors.append("process_limit_not_observed")
if row_by_id.get("file-size-limit", {}).get("fileSizeLimitObserved") is not True:
    errors.append("file_size_limit_not_observed")
if row_by_id.get("memory-limit", {}).get("memoryLimitObserved") is not True:
    errors.append("memory_limit_not_observed")

by_gate = {gate.get("id"): gate for gate in gates.get("gates", [])}
if gates.get("version") != "33.12":
    errors.append("governance_version_invalid")
for gate_id in ("G4", "G5"):
    if by_gate.get(gate_id, {}).get("status") != "in-progress":
        errors.append(f"governance_status_invalid:{gate_id}")
combined_findings = " ".join(str(by_gate.get(gate_id, {}).get("currentFinding", "")).lower() for gate_id in ("G4", "G5"))
for marker in [
    "single-host",
    "g4 remains in progress",
    "g5 is not passed",
    "no independent external red team",
    "seccomp",
    "cgroup v2",
]:
    if marker not in combined_findings:
        errors.append(f"governance_truth_boundary_missing:{marker}")

if capabilities.get("version") != "33.12":
    errors.append("capability_map_version_invalid")
engineering = set(
    next(
        (layer.get("capabilities", []) for layer in capabilities.get("layers", []) if layer.get("layer") == "engineering-pack"),
        [],
    )
)
for capability in [
    "qualified-linux-namespace-hostile-code-isolation",
    "read-only-snapshot-and-stale-admission-recheck",
    "empty-network-chroot-uid-capability-boundary",
    "rlimit-time-memory-process-file-enforcement",
    "signed-isolation-receipt-and-destruction-verification",
    "twelve-scenario-hostile-execution-campaign",
]:
    if capability not in engineering:
        errors.append(f"capability_missing:{capability}")

full_totals = full.get("totals", {})
if (
    full.get("status") != "passed"
    or (full_totals.get("testFiles"), full_totals.get("tests"), full_totals.get("passed"), full_totals.get("failed"))
    != (197, 1377, 1377, 0)
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
meta_path = ROOT / str(full.get("metaEvidence", ""))
if not meta_path.is_file():
    errors.append("meta_receipt_missing")
else:
    meta = json.loads(meta_path.read_text())
    if meta.get("exitCode") != 0 or meta.get("timedOut") is not False or meta.get("forceExitDisabled") is not True or meta.get("testFileCount") != 197:
        errors.append("meta_receipt_invalid")

inventory = truth.get("inventory", {})
if (
    truth.get("status") != "passed"
    or truth.get("findings") != []
    or inventory.get("sourceModules") != 198
    or inventory.get("testFiles") != 197
):
    errors.append("truth_map_invalid")

metrics = architecture.get("metrics", {})
if (
    architecture.get("status") != "PASS"
    or architecture.get("findings") != []
    or (metrics.get("sourceCycleCount"), metrics.get("untestedSourceCount"), metrics.get("capabilityPathCount"), metrics.get("closedCapabilityPathCount"))
    != (0, 0, 119, 119)
):
    errors.append("architecture_invalid")
closures = {row.get("capabilityId") for row in architecture.get("capabilityClosure", [])}
for capability_id in ["qualified-hostile-code-isolation-v33.12", "hostile-isolation-campaign-v33.12"]:
    if capability_id not in closures:
        errors.append(f"architecture_path_missing:{capability_id}")

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
        "chat-mission-v33_1",
        "mission-conversation-v33_2",
        "device-push-v33_3",
        "reliable-push-v33_4",
        "push-adapter-qualification-v33_5",
        "human-pilot-readiness-v33_6",
        "controlled-pilot-and-market-v33_7",
        "chat-engineering-vertical-v33_8",
        "multi-file-engineering-campaign-v33_9",
        "external-git-provider-qualification-v33_10",
        "malicious-repository-admission-v33_11",
        "qualified-hostile-code-isolation-v33_12",
    ]
    process = subprocess.run(
        ["node", "--test", *[f"dist/tests/{name}.test.js" for name in test_names]],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    totals: list[int | None] = []
    for marker in ["tests", "pass", "fail"]:
        match = re.search(rf"# {marker} (\d+)", process.stdout)
        totals.append(int(match.group(1)) if match else None)
    if process.returncode != 0 or tuple(totals) != (210, 210, 0):
        errors.append("direct_v33_regression_invalid")

if (
    manifest.get("version") != "33.12"
    or manifest.get("status") != "release-candidate-local-reference-only"
    or manifest.get("productionPromotion") != "blocked"
    or manifest.get("externalQualification") != "not_executed"
    or manifest.get("microvmExecuted") is not False
    or manifest.get("seccompQualified") is not False
    or manifest.get("cgroupV2Qualified") is not False
    or manifest.get("multiHostExecuted") is not False
):
    errors.append("release_manifest_boundary_invalid")
for item in manifest.get("files", []):
    path = ROOT / str(item.get("path", ""))
    if not path.is_file() or path.stat().st_size != item.get("sizeBytes") or sha(path) != item.get("sha256"):
        errors.append(f"release_manifest_integrity_invalid:{item.get('path', '')}")

result = {
    "version": "33.12",
    "status": "passed" if not errors else "failed",
    "gates": {
        "G0": "passed",
        "G1": "passed",
        "G2": "in-progress-not-passed",
        "G3": "in-progress-not-passed",
        "G4": "in-progress-not-passed",
        "G5": "in-progress-not-passed",
    },
    "isolationReference": {
        key: proof.get(key)
        for key in [
            "evidenceClass",
            "scenarioCount",
            "scenariosPassed",
            "signedReceiptsVerified",
            "sourceRepositoriesUnchanged",
            "runtimeRootsDestroyed",
            "externalEffectsExecuted",
            "qualifiedIsolationExecuted",
            "microvmExecuted",
            "seccompQualified",
            "cgroupV2Qualified",
            "multiHostExecuted",
            "independentExternalReviewExecuted",
        ]
    },
    "regression": full_totals,
    "truthMap": {"sourceModules": inventory.get("sourceModules"), "testFiles": inventory.get("testFiles"), "findings": len(truth.get("findings", []))},
    "architecture": {
        key: metrics.get(key)
        for key in ["sourceCycleCount", "untestedSourceCount", "capabilityPathCount", "closedCapabilityPathCount"]
    },
    "errors": errors,
    "productionPromotion": "blocked",
    "externalQualification": "not_executed",
}
(EVIDENCE / "V33_12_VALIDATION.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result, indent=2))
sys.exit(0 if not errors else 1)
