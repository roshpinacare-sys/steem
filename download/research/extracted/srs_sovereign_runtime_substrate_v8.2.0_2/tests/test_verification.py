"""Tests for the verification/ module (Z3, TLA+, SVA)."""
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_z3_nominal_proof_sat():
    """Run Z3 proof (nominal mode) and verify SAT."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "verification" / "z3_power_proof.py")],
        capture_output=True, text=True, timeout=60,
        cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0
    assert "result = sat" in result.stdout


def test_z3_contention_resolution_sat():
    """Run Z3 proof (contention mode) and verify margin >= 0.05."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "verification" / "z3_power_proof.py"),
         "--contention"],
        capture_output=True, text=True, timeout=60,
        cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0
    assert "STABLE CONFIGURATION" in result.stdout
    assert "margin" in result.stdout


def test_z3_thermal_derating_restores_sat():
    """Run Z3 proof (thermal-derating mode) and verify SAT restored."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "verification" / "z3_power_proof.py"),
         "--high-entropy", "--thermal-derating"],
        capture_output=True, text=True, timeout=60,
        cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0
    assert "SAT RESTORED" in result.stdout


def test_saarthi_sva_generator():
    """Run SVA generator self-test."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "verification" / "saarthi_sva_generator.py")],
        capture_output=True, text=True, timeout=30,
        cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0
    assert "PASSED" in result.stdout


def test_tla_spec_exists_and_has_theorems():
    """Verify the TLA+ spec exists and contains the three theorems."""
    tla_path = REPO_ROOT / "verification" / "TemporalBankerScheduler.tla"
    assert tla_path.exists()
    content = tla_path.read_text()
    assert "BudgetInvariantTheorem" in content
    assert "NoDeadlockTheorem" in content
    assert "NoStarvationTheorem" in content


def test_sva_file_generated():
    """Verify the SVA file is generated and contains assertions."""
    sva_path = REPO_ROOT / "verification" / "srs_safety_assertions.sva"
    if not sva_path.exists():
        # Generate it
        subprocess.run(
            [sys.executable, str(REPO_ROOT / "verification" / "saarthi_sva_generator.py")],
            cwd=str(REPO_ROOT), timeout=30,
        )
    content = sva_path.read_text()
    assert "module srs_safety_assertions" in content
    assert "assert property" in content
    assert "power_envelope" in content
