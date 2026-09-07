#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "release-evidence/v33.45"
CHECKS: list[dict[str, object]] = []


def load(rel: str) -> dict:
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


def add(name: str, ok: bool, detail: object = None) -> None:
    CHECKS.append({"name": name, "ok": bool(ok), "detail": detail})


required = [
    "src/supply-chain/multi-package-update-transaction-v33_45.ts",
    "tests/multi-package-update-transaction-v33_45.test.ts",
    "scripts/multi-package-update-transaction-proof-v33_45.mjs",
    "scripts/verify-multi-package-update-transaction-v33_45.mjs",
    "scripts/run-focused-tests-v33_45.mjs",
    "scripts/run-full-regression-v33_45.py",
    "scripts/run-direct-v33-regression-v33_45.py",
    "scripts/repository-truth-map-v33_45.mjs",
    "scripts/architecture-validation-v33_45.mjs",
    "scripts/validate-v33_45.py",
    "docs/V33_45_MULTI_PACKAGE_UPDATE_TRANSACTION.md",
    "CLAUDE_HANDOFF_v33_45.md",
    "V33_45_עדכון_ביצוע_והוכחות.md",
    "pilot-kits/v33.45/multi-package-update-transaction/manifest.json",
    "pilot-kits/v33.45/multi-package-update-transaction/RUNBOOK.md",
    "release-evidence/v33.45/V33_45_MULTI_PACKAGE_UPDATE_TRANSACTION_PROOF.json",
    "release-evidence/v33.45/V33_45_INDEPENDENT_VERIFICATION.json",
    "release-evidence/v33.45/V33_45_FOCUSED_TEST_RECEIPT.json",
    "release-evidence/v33.45/V33_45_FULL_TEST_RESULTS.json",
    "release-evidence/v33.45/V33_45_FULL_TEST_META.json",
    "release-evidence/v33.45/V33_45_DIRECT_V33_RESULTS.json",
    "release-evidence/v33.45/V33_45_REPOSITORY_TRUTH_MAP.json",
    "release-evidence/v33.45/V33_45_ARCHITECTURE_INTEGRITY.json",
]
missing = [p for p in required if not (ROOT / p).exists()]
add("required-artifacts", not missing, missing)

try:
    proof = load("release-evidence/v33.45/V33_45_MULTI_PACKAGE_UPDATE_TRANSACTION_PROOF.json")
    summary = proof.get("summary", {})
    execution = proof.get("executionEvidence", {})
    boundary = proof.get("truthBoundary", {})
    verdict = proof.get("finalVerdict", {})
    attacks = proof.get("attacks", {})
    add(
        "proof-summary",
        summary == {
            "newSignatureCount": 24,
            "totalChainSignatureCount": 58,
            "packageCount": 3,
            "approvalCount": 3,
            "canaryStageCount": 3,
            "canaryMonitorCount": 3,
            "reportCount": 9,
            "retainedGenerationCount": 4,
        },
        summary,
    )
    add(
        "proof-execution",
        execution.get("offlineInstall", {}).get("exitCode") == 0
        and execution.get("offlineInstall", {}).get("cacheInitiallyEmpty") is True
        and execution.get("offlineInstall", {}).get("networkRequestsObserved") == 0
        and execution.get("build", {}).get("exitCode") == 0
        and execution.get("tests", {}).get("testCount") == 34
        and execution.get("tests", {}).get("passed") == 34
        and execution.get("tests", {}).get("failed") == 0
        and execution.get("packageMutationsClass") == "LOCAL_VERSION_FIXTURES_ONLY"
        and execution.get("canaryMetricsClass") == "LOCAL_DETERMINISTIC_FIXTURE_ONLY",
        execution,
    )
    add("proof-attacks", len(attacks) == 7 and all(attacks.values()), attacks)
    add(
        "proof-verdict",
        verdict.get("status") == "LOCAL_MULTI_PACKAGE_UPDATE_TRANSACTION_PROVEN"
        and verdict.get("packageCount") == 3
        and verdict.get("approvalCount") == 3
        and verdict.get("canaryStageCount") == 3
        and verdict.get("canaryMonitorCount") == 3
        and verdict.get("retainedGenerationCount") == 4
        and verdict.get("atomicTransactionProven") is True
        and verdict.get("conflictResolutionProven") is True
        and verdict.get("stagedCanaryProven") is True
        and verdict.get("promotionSuccessPathProven") is True
        and verdict.get("rollbackClassificationProven") is True
        and verdict.get("interruptionRecoveryProven") is True
        and verdict.get("updatePromoted") is False,
        verdict,
    )
    add(
        "truth-boundary",
        boundary == {
            "externalPackageArtifactsObserved": False,
            "externalCanaryTrafficObserved": False,
            "externalHumanParticipants": 0,
            "productionAuthority": "NONE",
            "externalEffectsExecuted": 0,
        }
        and verdict.get("externalPackageArtifactsObserved") is False
        and verdict.get("externalCanaryTrafficObserved") is False
        and verdict.get("externalHumanParticipants") == 0
        and verdict.get("productionAuthority") == "NONE"
        and verdict.get("externalEffectsExecuted") == 0,
        {"truthBoundary": boundary, "verdict": verdict},
    )
except Exception as exc:
    add("proof-readable", False, str(exc))

try:
    verification = load("release-evidence/v33.45/V33_45_INDEPENDENT_VERIFICATION.json")
    add(
        "independent-verification",
        verification.get("status") == "PASS"
        and verification.get("newSignatureCount") == 24
        and verification.get("totalChainSignatureCount") == 58
        and verification.get("finalStatus") == "LOCAL_MULTI_PACKAGE_UPDATE_TRANSACTION_PROVEN"
        and verification.get("productionAuthority") == "NONE"
        and all(verification.get("checks", {}).values()),
        verification,
    )
except Exception as exc:
    add("independent-verification", False, str(exc))

try:
    focused = load("release-evidence/v33.45/V33_45_FOCUSED_TEST_RECEIPT.json")
    add(
        "focused-regression",
        focused.get("status") == "passed"
        and focused.get("testFiles") == 16
        and focused.get("totals") == {"tests": 545, "passed": 545, "failed": 0}
        and focused.get("retry") is False
        and focused.get("forceExitDisabled") is True,
        focused,
    )
except Exception as exc:
    add("focused-regression", False, str(exc))

try:
    full = load("release-evidence/v33.45/V33_45_FULL_TEST_RESULTS.json")
    add(
        "full-regression",
        full.get("status") == "passed"
        and full.get("totals") == {"testFiles": 230, "tests": 2370, "passed": 2370, "failed": 0}
        and full.get("runnerExitCode") == 0
        and full.get("timedOut") is False
        and full.get("forceExitDisabled") is True
        and full.get("retry") is False,
        full.get("totals"),
    )
except Exception as exc:
    add("full-regression", False, str(exc))

try:
    direct = load("release-evidence/v33.45/V33_45_DIRECT_V33_RESULTS.json")
    add(
        "direct-v33-regression",
        direct.get("status") == "passed"
        and direct.get("totals") == {"testFiles": 45, "tests": 1203, "passed": 1203, "failed": 0}
        and direct.get("independentProcessPerFile") is True
        and direct.get("retry") is False
        and direct.get("forceExit") is False,
        direct.get("totals"),
    )
except Exception as exc:
    add("direct-v33-regression", False, str(exc))

try:
    truth = load("release-evidence/v33.45/V33_45_REPOSITORY_TRUTH_MAP.json")
    inventory = truth.get("inventory", {})
    add(
        "repository-truth-map",
        truth.get("status") in ("PASS", "passed")
        and inventory.get("sourceModules") == 234
        and inventory.get("testFiles") == 230
        and inventory.get("governanceFiles") == 11
        and truth.get("findings") == [],
        inventory,
    )
except Exception as exc:
    add("repository-truth-map", False, str(exc))

try:
    architecture = load("release-evidence/v33.45/V33_45_ARCHITECTURE_INTEGRITY.json")
    metrics = architecture.get("metrics", {})
    add(
        "architecture-integrity",
        architecture.get("status") == "PASS"
        and metrics.get("capabilityPathCount") == 170
        and metrics.get("closedCapabilityPathCount") == 170
        and metrics.get("sourceCycleCount") == 0
        and metrics.get("untestedSourceCount") == 0
        and architecture.get("findings") == [],
        metrics,
    )
except Exception as exc:
    add("architecture-integrity", False, str(exc))

try:
    meta = load("release-evidence/v33.45/V33_45_FULL_TEST_META.json")
    rows = meta.get("files", [])
    build_digest = meta.get("buildDigest")
    run_input_digest = meta.get("runInputDigest")
    add(
        "regression-input-binding",
        meta.get("exitCode") == 0
        and len(rows) == 230
        and isinstance(build_digest, str)
        and len(build_digest) == 64
        and isinstance(run_input_digest, str)
        and len(run_input_digest) == 64
        and all(
            row.get("buildDigest") == build_digest
            and row.get("runInputDigest") == run_input_digest
            and row.get("exitCode") == 0
            and row.get("timedOut") is False
            for row in rows
        ),
        {"receipts": len(rows), "buildDigest": build_digest, "runInputDigest": run_input_digest},
    )
except Exception as exc:
    add("regression-input-binding", False, str(exc))

try:
    package = load("package.json")
    lock = load("package-lock.json")
    lock_text = (ROOT / "package-lock.json").read_text(encoding="utf-8")
    canonical = sorted((ROOT / "governance-state").glob("*.json"))
    mirror = sorted((ROOT / "v33/governance-state").glob("*.json"))
    canonical_versions = [json.loads(p.read_text(encoding="utf-8")).get("version") for p in canonical]
    mirror_versions = [json.loads(p.read_text(encoding="utf-8")).get("version") for p in mirror]
    add(
        "canonical-metadata",
        package.get("version") == "0.35.0"
        and re.search(r"v33\.45", package.get("description", ""), re.I) is not None
        and lock.get("version") == "0.35.0"
        and lock.get("packages", {}).get("", {}).get("version") == "0.35.0"
        and len(canonical_versions) == 11
        and all(v == "33.45" for v in canonical_versions)
        and len(mirror_versions) >= 11
        and all(v == "33.45" for v in mirror_versions),
        {
            "packageVersion": package.get("version"),
            "lockVersion": lock.get("version"),
            "canonicalGovernance": len(canonical_versions),
            "mirrorGovernance": len(mirror_versions),
        },
    )
    add(
        "offline-lockfile",
        "https://registry.npmjs.org" not in lock_text
        and "http://registry.npmjs.org" not in lock_text
        and all(
            str(entry.get("resolved", "")).startswith("file:vendor/dependency-capsule/tarballs/")
            for key, entry in lock.get("packages", {}).items()
            if key.startswith("node_modules/")
        ),
        None,
    )
except Exception as exc:
    add("canonical-metadata", False, str(exc))

status = "PASS" if all(c["ok"] for c in CHECKS) else "FAIL"
result = {
    "version": "33.45",
    "status": status,
    "checkCount": len(CHECKS),
    "passed": sum(bool(c["ok"]) for c in CHECKS),
    "failed": sum(not bool(c["ok"]) for c in CHECKS),
    "checks": CHECKS,
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "V33_45_FINAL_VALIDATION.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, indent=2))
sys.exit(0 if status == "PASS" else 1)
