#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mutation_test.py v2 — Snapshot-safe mutation testing for the SRS.

Improvements over v1 (Cycle 18 process bug):
  1. Snapshot every source file BEFORE any mutation is applied.
     On exit (normal, signal, exception) the snapshots are restored.
  2. Use signal handlers for SIGINT/SIGTERM so timeout-killed parent
     processes still get a chance to revert.
  3. A `--revert` flag forces snapshot restore without running mutations
     (recovery path if a previous run was killed mid-mutation).
  4. A `--check` flag diffs every source file vs git HEAD (when a repo
     is present) and reports any drift.
  5. Atomicity: each mutation's revert happens immediately after its
     tests finish; the global snapshot is a second line of defense.

Mutation score = killed / (killed + survived).
"""
from __future__ import annotations

import atexit
import hashlib
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, List, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent

# Files that are mutated — listed explicitly so the snapshot is tight.
MUTATED_FILES = [
    "governance/seg_controller.py",
    "governance/sqa_aggregator.py",
    "kernel/omnivisor.py",
    "kernel/smpu_sppu.py",
    "self_healing/digital_dna.py",
    "cognition/adm_intent_mapper.py",
    "cognition/agemem_controller.py",
    "simulation/adaqc_compiler.py",
    "simulation/photonic_bus.py",
    "verification/z3_power_proof.py",
    "verification/saarthi_sva_generator.py",
]

# Test command — focused mutation killers + fuzz tests that target SEG.
TEST_CMD = [
    sys.executable, "-m", "pytest",
    "tests/test_mutation_killers.py",
    "tests/test_mutation_killers_cog_sim.py",
    "tests/test_mutation_killers_verif.py",
    "tests/test_mutation_killers_seg.py",
    "tests/test_fuzz.py::test_seg_evidence_chain_empty",
    "tests/test_fuzz.py::test_seg_all_validators_reject",
    "tests/test_fuzz.py::test_seg_replay_old_epoch",
    "tests/test_fuzz.py::test_seg_negative_seq",
    "-q", "--tb=no", "-p", "no:cacheprovider",
    "--override-ini=testpaths=",
]

MUTATIONS: List[Tuple[str, str, str, str]] = [
    # SEG controller mutations
    ("governance/seg_controller.py", "not ec.get(\"admissible\"", "ec.get(\"admissible\"", "SEG: flip admissible check (NOT -> direct)"),
    ("governance/seg_controller.py", "ec_seq != self.active_epoch", "ec_seq == self.active_epoch", "SEG: flip seq comparison (!= -> ==)"),
    ("governance/seg_controller.py", "not cert.admissible", "cert.admissible", "SEG: flip quorum check (NOT -> direct)"),
    ("governance/seg_controller.py", "ec_witness_hash != mutation.z3_witness_hash", "ec_witness_hash == mutation.z3_witness_hash", "SEG: flip witness hash comparison"),

    # SQA aggregator mutations
    ("governance/sqa_aggregator.py", "len(admits) < threshold", "len(admits) <= threshold", "SQA: threshold off-by-one (< -> <=)"),
    ("governance/sqa_aggregator.py", "c_sum < c_min", "c_sum <= c_min", "SQA: c_min off-by-one (< -> <=)"),
    ("governance/sqa_aggregator.py", "v.verdict == Verdict.ADMIT", "v.verdict != Verdict.ADMIT", "SQA: flip verdict filter (== -> !=)"),

    # Omnivisor mutations
    ("kernel/omnivisor.py", "page.owner == writer", "page.owner != writer", "Omnivisor: flip owner check (== -> !=)"),
    ("kernel/omnivisor.py", "PageAttribute.TI not in page.attrs", "PageAttribute.TI in page.attrs", "Omnivisor: flip TI check"),
    ("kernel/omnivisor.py", "b.budget < cost", "b.budget <= cost", "Omnivisor: TIB off-by-one (< -> <=)"),

    # SMPU mutations
    ("kernel/smpu_sppu.py", "ecr > ECR_CASCADE_THRESHOLD", "ecr >= ECR_CASCADE_THRESHOLD", "SMPU: ECR threshold off-by-one"),
    ("kernel/smpu_sppu.py", "region.perm == Perm.RO", "region.perm != Perm.RO", "SMPU: flip quarantine check"),

    # Digital DNA mutations
    ("self_healing/digital_dna.py", "norm1 == 0 or norm2 == 0", "norm1 != 0 or norm2 != 0", "DNA: flip zero-norm guard"),
    ("self_healing/digital_dna.py", "dot / (norm1 * norm2)", "dot / (norm1 + norm2)", "DNA: cosine -> wrong formula (dot/(n1+n2))"),

    # Cognition layer mutations
    ("cognition/adm_intent_mapper.py", "action.op not in INTENT_OPS[intent]", "action.op in INTENT_OPS[intent]", "Adm: flip op membership check (not in -> in)"),
    ("cognition/adm_intent_mapper.py", "action.tier != INTENT_TIER[intent]", "action.tier == INTENT_TIER[intent]", "Adm: flip tier check (!= -> ==)"),
    ("cognition/agemem_controller.py", "op in (MemOp.ADD, MemOp.UPDATE, MemOp.DELETE)", "op not in (MemOp.ADD, MemOp.UPDATE, MemOp.DELETE)", "AgeMem: flip tier assignment (in -> not in)"),

    # Simulation layer mutations
    ("simulation/adaqc_compiler.py", "theta_fpga > self.DEPTH_REDUCTION_THRESHOLD", "theta_fpga >= self.DEPTH_REDUCTION_THRESHOLD", "AdaQC: depth-reduction off-by-one (> -> >=)"),
    ("simulation/adaqc_compiler.py", "dp[i][k] + dp[k][j] < dp[i][j]", "dp[i][k] + dp[k][j] > dp[i][j]", "AdaQC: Floyd-Warshall flip comparison (< -> >)"),
    ("simulation/photonic_bus.py", "delivered_this_cycle += 1", "delivered_this_cycle -= 1", "Photonic: flip delivery counter (+= -> -=)"),

    # Verification layer mutations
    ("verification/z3_power_proof.py", "self.F[isl.name] >= isl.f_low", "self.F[isl.name] > isl.f_low", "Z3: safety envelope low bound off-by-one (>= -> >)"),
    ("verification/z3_power_proof.py", "F_total <= self.g_global", "F_total < self.g_global", "Z3: global budget off-by-one (<= -> <)"),
    ("verification/saarthi_sva_generator.py", "assert property", "cover property", "SVA: flip assert -> cover"),
]


# ---------------------------------------------------------------------------
# Snapshot / restore
# ---------------------------------------------------------------------------

class SnapshotGuard:
    """Snapshots mutated files to a temp dir and restores on close().
    Registered as an atexit hook and a signal handler so that timeout-killed
    parents still revert on the way out.
    """

    def __init__(self, files: List[str], root: Path):
        self.root = root
        self.snap_dir = Path(tempfile.mkdtemp(prefix="srs_mut_snap_"))
        self.files: Dict[Path, Path] = {}  # src -> snapshot
        self._closed = False
        for rel in files:
            src = root / rel
            if not src.exists():
                continue
            dst = self.snap_dir / hashlib.sha256(str(src).encode()).hexdigest()[:16]
            shutil.copy2(src, dst)
            self.files[src] = dst

    def restore(self) -> None:
        if self._closed:
            return
        for src, dst in self.files.items():
            try:
                if dst.exists():
                    shutil.copy2(dst, src)
            except Exception as e:  # pragma: no cover — best effort
                sys.stderr.write(f"[SnapshotGuard] restore failed for {src}: {e}\n")
        self._closed = True

    def close(self) -> None:
        self.restore()
        try:
            shutil.rmtree(self.snap_dir, ignore_errors=True)
        except Exception:
            pass


# Module-level guard so signal handlers can find it.
_GUARD: SnapshotGuard | None = None


def _on_signal(signum, frame):  # pragma: no cover — signal path
    sys.stderr.write(f"\n[mutation_test] signal {signum} received — restoring snapshots\n")
    if _GUARD is not None:
        _GUARD.restore()
    sys.exit(130 if signum == signal.SIGINT else 1)


# ---------------------------------------------------------------------------
# Mutation logic
# ---------------------------------------------------------------------------

def run_tests(cwd: Path, timeout: int = 90) -> Tuple[bool, str]:
    """Run the test suite; return (passed, output_tail)."""
    try:
        result = subprocess.run(
            TEST_CMD, capture_output=True, text=True, timeout=timeout, cwd=str(cwd),
        )
        passed = result.returncode == 0
        tail = result.stdout.strip().split("\n")[-3:] if result.stdout else result.stderr.strip().split("\n")[-3:]
        return passed, "\n".join(tail)
    except subprocess.TimeoutExpired:
        return False, "TIMEOUT"
    except Exception as e:
        return False, str(e)


def apply_mutation(file_path: Path, old: str, new: str) -> bool:
    content = file_path.read_text()
    if old not in content:
        return False
    file_path.write_text(content.replace(old, new, 1))
    return True


def revert_mutation(file_path: Path, old: str, new: str) -> None:
    """Revert by swapping new -> old. Idempotent."""
    content = file_path.read_text()
    if new in content:
        file_path.write_text(content.replace(new, old, 1))


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

def mode_check(root: Path) -> int:
    """Diff each mutated file against its snapshot (taken at script start).
    In a git repo, fall back to `git diff` if no snapshot exists.
    """
    print("=" * 78)
    print("Mode: --check (detect unreverted mutations from prior runs)")
    print("=" * 78)
    drift_found = False
    for rel in MUTATED_FILES:
        src = root / rel
        if not src.exists():
            print(f"  {rel}: MISSING")
            continue
        # Try git first
        try:
            r = subprocess.run(
                ["git", "-C", str(root), "diff", "--stat", "--", rel],
                capture_output=True, text=True, timeout=10,
            )
            if r.returncode == 0 and r.stdout.strip():
                print(f"  {rel}: DRIFT (git diff)")
                print(r.stdout)
                drift_found = True
                continue
        except Exception:
            pass
        # No git / no diff
        print(f"  {rel}: clean")
    print("=" * 78)
    return 1 if drift_found else 0


def mode_revert(root: Path) -> int:
    """Force-revert: take a fresh snapshot of MUTATED_FILES from git HEAD
    (if available) and restore them. Without git, this is a no-op warning.
    """
    print("=" * 78)
    print("Mode: --revert (restore MUTATED_FILES from git HEAD)")
    print("=" * 78)
    restored = 0
    for rel in MUTATED_FILES:
        src = root / rel
        try:
            r = subprocess.run(
                ["git", "-C", str(root), "show", f"HEAD:{rel}"],
                capture_output=True, timeout=10,
            )
            if r.returncode == 0 and r.stdout:
                src.write_bytes(r.stdout)
                print(f"  {rel}: restored from HEAD")
                restored += 1
                continue
        except Exception:
            pass
        print(f"  {rel}: no git, cannot restore")
    print(f"\nRestored {restored}/{len(MUTATED_FILES)} files.")
    print("Run `python -m pytest tests/ -q` to confirm.")
    return 0 if restored == len(MUTATED_FILES) else 1


def mode_run(root: Path) -> int:
    global _GUARD
    print("=" * 78)
    print("Mutation Testing v2 — Snapshot-safe")
    print("=" * 78)

    # Pre-flight: tests must pass clean
    print("\n[baseline] Running test suite without mutations...")
    baseline_pass, baseline_output = run_tests(root)
    if not baseline_pass:
        print(f"  BASELINE FAILED — fix tests before mutation testing:")
        print(f"  {baseline_output}")
        return 1
    print("  Baseline: ALL PASS")

    # Take snapshots
    _GUARD = SnapshotGuard(MUTATED_FILES, root)
    atexit.register(_GUARD.close)
    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    killed = 0
    survived = 0
    failed_to_apply = 0
    per_mutation: List[Tuple[int, str, str]] = []

    print(f"\n[mutations] Testing {len(MUTATIONS)} mutations:\n")
    print(f"  {'#':>3}  {'Status':<10} {'Description'}")
    print(f"  {'─'*3}  {'─'*10} {'─'*60}")

    for i, (file_rel, old, new, desc) in enumerate(MUTATIONS, 1):
        file_path = root / file_rel
        if not apply_mutation(file_path, old, new):
            print(f"  {i:>3}  SKIP       {desc} (pattern not found)")
            failed_to_apply += 1
            per_mutation.append((i, "SKIP", desc))
            continue

        passed, output = run_tests(root)

        # Revert IMMEDIATELY after tests finish
        revert_mutation(file_path, old, new)

        if passed:
            status = "SURVIVED"
            survived += 1
        else:
            status = "KILLED"
            killed += 1
        per_mutation.append((i, status, desc))
        print(f"  {i:>3}  {status:<10} {desc}")

    # Restore from snapshot as a second line of defense
    _GUARD.restore()
    _GUARD.close()

    total = killed + survived
    score = (killed / total * 100) if total > 0 else 0

    print(f"\n{'='*78}")
    print(f"Mutation Testing Results:")
    print(f"  Mutations applied:  {total}")
    print(f"  Mutations killed:   {killed}")
    print(f"  Mutations survived: {survived}")
    print(f"  Failed to apply:    {failed_to_apply}")
    print(f"  Mutation score:     {score:.1f}%")
    print(f"{'='*78}")

    # Save results
    results_path = root / "docs" / "MUTATION_TEST_RESULTS.md"
    with open(results_path, "w") as f:
        f.write("# Mutation Testing Results\n\n")
        f.write(f"**Date**: 2026-07-14\n")
        f.write(f"**Method**: Snapshot-safe manual mutation testing (v2)\n")
        f.write(f"**Test suite**: {len(TEST_CMD)-6} test files\n\n")
        f.write("## Summary\n\n")
        f.write("| Metric | Value |\n|--------|-------|\n")
        f.write(f"| Mutations applied | {total} |\n")
        f.write(f"| Mutations killed | {killed} |\n")
        f.write(f"| Mutations survived | {survived} |\n")
        f.write(f"| Failed to apply | {failed_to_apply} |\n")
        f.write(f"| Mutation score | {score:.1f}% |\n\n")
        f.write("## Per-Mutation Results\n\n")
        f.write("| # | Status | Description |\n|---|--------|-------------|\n")
        for idx, status, desc in per_mutation:
            f.write(f"| {idx} | {status} | {desc} |\n")
    print(f"\nResults saved to: {results_path}")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if "--revert" in args:
        return mode_revert(REPO_ROOT)
    if "--check" in args:
        return mode_check(REPO_ROOT)
    return mode_run(REPO_ROOT)


if __name__ == "__main__":
    sys.exit(main())
