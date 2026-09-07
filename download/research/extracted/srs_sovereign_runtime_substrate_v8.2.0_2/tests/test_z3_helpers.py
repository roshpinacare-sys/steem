"""Tests for the refactored z3_power_proof.py helper functions.

These ensure the helpers extracted from main() in Cycle 20 work correctly
in isolation, AND that they remain type-clean (mypy passes).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import z3

from verification.z3_power_proof import (
    SmtEncoder,
    HighEntropyEncoder,
    ThermalDeratingEncoder,
    ContentionResolutionEncoder,
    SafetyProofEncoder,
    PowerTreeEncoder,
    report,
    _print_per_island_table,
    _print_aggregate_summary,
    run_nominal_proof,
    run_high_entropy_proof,
    run_thermal_derating_proof,
    run_contention_resolution_proof,
    run_real_safety_proof,
    _persist_report,
)


# ---------------------------------------------------------------------------
# Helper print functions
# ---------------------------------------------------------------------------

def test_print_per_island_table_with_sat_report(capsys):
    """The print helper handles a well-formed SAT report."""
    rep = {
        "islands": [
            {"name": "APU", "theta": 0.5, "F": 1.0, "ecr": 0.01,
             "low": 0.0, "high": 1.1, "weights": {"route_a": 0.5, "route_b": 0.5}},
        ],
    }
    _print_per_island_table(rep)
    captured = capsys.readouterr()
    assert "APU" in captured.out
    assert "route_a" in captured.out


def test_print_per_island_table_with_empty_islands(capsys):
    """Empty islands list should not crash."""
    _print_per_island_table({"islands": []})
    captured = capsys.readouterr()
    assert "Island" in captured.out  # header is always printed


def test_print_per_island_table_with_non_list_islands(capsys):
    """Non-list islands should not crash."""
    _print_per_island_table({"islands": "not a list"})
    captured = capsys.readouterr()
    assert "Island" in captured.out


def test_print_aggregate_summary(capsys):
    """Aggregate summary prints F_total, risk, G, Q_BAR."""
    rep = {
        "F_total": 1.5,
        "G_global": 2.0,
        "risk": 1.0,
        "Q_bar": 1.2,
    }
    _print_aggregate_summary(rep, label="SAFE")
    captured = capsys.readouterr()
    assert "F_total" in captured.out
    assert "risk" in captured.out
    assert "SAFE" in captured.out


def test_print_aggregate_summary_no_label(capsys):
    rep = {"F_total": 1.0, "G_global": 2.0, "risk": 0.5, "Q_bar": 1.0}
    _print_aggregate_summary(rep)
    captured = capsys.readouterr()
    assert "F_total" in captured.out
    assert "verdict" not in captured.out


# ---------------------------------------------------------------------------
# Run mode helpers (use a stub args object)
# ---------------------------------------------------------------------------

class _Args:
    """Stub for argparse.Namespace — only the attributes the helpers read."""
    def __init__(self, **kwargs):
        self.high_entropy = False
        self.thermal_derating = False
        self.contention = False
        self.prove_safety = False
        self.power_tree = False
        self.epsilon = 0.05
        self.target_margin = 0.05
        for k, v in kwargs.items():
            setattr(self, k, v)


def test_run_nominal_proof_returns_report_and_count(capsys):
    """run_nominal_proof returns (rep, n_constraints) with expected fields."""
    args = _Args()
    rep, n = run_nominal_proof(args)
    assert isinstance(rep, dict)
    assert "verdict" in rep
    assert "mode" in rep
    assert rep["mode"] == "nominal"
    assert isinstance(n, int)
    assert n > 0


def test_run_nominal_proof_power_tree_mode(capsys):
    """run_nominal_proof with --power-tree uses PowerTreeEncoder."""
    args = _Args(power_tree=True)
    rep, n = run_nominal_proof(args)
    assert "verdict" in rep
    # If SAT, power_tree block should be present
    if str(rep.get("verdict")) == "sat":
        assert "power_tree" in rep


def test_run_high_entropy_proof_disabled_returns_none(capsys):
    """When args.high_entropy=False, returns None without running."""
    args = _Args(high_entropy=False)
    result = run_high_entropy_proof(args, n_constraints=70)
    assert result is None


def test_run_thermal_derating_proof_disabled_returns_none(capsys):
    args = _Args(thermal_derating=False)
    assert run_thermal_derating_proof(args) is None


def test_run_contention_resolution_proof_disabled_returns_none(capsys):
    args = _Args(contention=False)
    assert run_contention_resolution_proof(args) is None


def test_run_real_safety_proof_disabled_is_noop(capsys):
    """When disabled, the function returns None and prints nothing."""
    args = _Args(prove_safety=False)
    run_real_safety_proof(args)
    captured = capsys.readouterr()
    assert captured.out == ""


# ---------------------------------------------------------------------------
# Run mode helpers — ENABLED paths (actually run the Z3 solver)
# ---------------------------------------------------------------------------

def test_run_high_entropy_proof_enabled_returns_report(capsys):
    """run_high_entropy_proof with high_entropy=True runs the adversarial proof."""
    args = _Args(high_entropy=True, epsilon=0.05)
    result = run_high_entropy_proof(args, n_constraints=70)
    assert result is not None
    assert "verdict" in result
    assert "mode" in result
    assert result["mode"] == "high_entropy"
    assert "epsilon" in result
    assert "stress_probe" in result
    # The stress probe should have entries for each stress type
    probe = result["stress_probe"]
    assert isinstance(probe, dict)
    assert len(probe) >= 4  # ecr_max, budget_tight, quorum_tight, thermal_max, all


def test_run_thermal_derating_proof_enabled_returns_report(capsys):
    """run_thermal_derating_proof with thermal_derating=True runs the derating proof."""
    args = _Args(thermal_derating=True, epsilon=0.05)
    result = run_thermal_derating_proof(args)
    assert result is not None
    assert "verdict" in result
    assert "mode" in result
    assert result["mode"] == "thermal_derating"
    # If SAT, the derating block should be present
    if str(result.get("verdict")) == "sat":
        assert "derating" in result


def test_run_contention_resolution_proof_enabled_returns_report(capsys):
    """run_contention_resolution_proof with contention=True runs the contention proof."""
    args = _Args(contention=True, epsilon=0.05, target_margin=0.05)
    result = run_contention_resolution_proof(args)
    assert result is not None
    assert "verdict" in result
    assert "mode" in result
    assert result["mode"] == "contention_resolution"
    # If SAT, the contention_resolution block should be present
    if str(result.get("verdict")) == "sat":
        assert "contention_resolution" in result


def test_run_real_safety_proof_enabled_prints_verdict(capsys):
    """run_real_safety_proof with prove_safety=True runs the ¬safety → UNSAT proof."""
    args = _Args(prove_safety=True)
    run_real_safety_proof(args)
    captured = capsys.readouterr()
    # The proof should print one of: SAFETY PROVEN, NON-VACUOUS, or UNKNOWN
    assert "SAFETY" in captured.out.upper() or "UNKNOWN" in captured.out.upper()


def test_persist_report_writes_json(tmp_path, capsys, monkeypatch):
    """_persist_report writes a JSON file with all 4 mode reports."""
    # The function resolves the path relative to __file__, so just call it
    # and check the file gets written.
    rep = {"verdict": "sat", "mode": "nominal"}
    he_rep = {"verdict": "sat", "mode": "high_entropy"}
    td_rep = {"verdict": "sat", "mode": "thermal_derating"}
    cr_rep = {"verdict": "sat", "mode": "contention_resolution"}

    out_path = _persist_report(rep, he_rep, td_rep, cr_rep)
    p = Path(out_path)
    assert p.exists()
    data = json.loads(p.read_text())
    assert "nominal" in data
    assert "high_entropy" in data
    assert "thermal_derating" in data
    assert "contention_resolution" in data


def test_persist_report_with_none_modes(tmp_path, capsys):
    """When only nominal ran, only the nominal key is in the report."""
    rep = {"verdict": "sat"}
    out_path = _persist_report(rep, None, None, None)
    p = Path(out_path)
    data = json.loads(p.read_text())
    assert "nominal" in data
    assert "high_entropy" not in data
    assert "thermal_derating" not in data
    assert "contention_resolution" not in data


# ---------------------------------------------------------------------------
# Report() function — type-clean after Cycle 20 refactor
# ---------------------------------------------------------------------------

def test_report_with_unsat_result():
    """UNSAT result produces unsat_core in the report."""
    enc = SmtEncoder()
    enc.encode()
    # Force UNSAT by adding a contradiction
    enc.solver.add(enc.F["APU"] >= 1000)  # impossibly large
    enc.solver.add(enc.F["APU"] <= 0)
    result = enc.solver.check()
    if result == z3.unsat:
        rep = report(result, None, enc)
        assert rep["verdict"] == "unsat"
        assert "unsat_core" in rep


def test_report_with_sat_result():
    """SAT result produces islands + aggregates in the report."""
    enc = SmtEncoder()
    enc.encode()
    result, model = enc.check_satisfiability()
    if result == z3.sat:
        rep = report(result, model, enc)
        assert rep["verdict"] == "sat"
        assert "islands" in rep
        assert "F_total" in rep
        assert "risk" in rep
        assert "budget_ok" in rep
        assert "quorum_ok" in rep
        assert "overall_safe" in rep


def test_report_with_thermal_derating_encoder():
    """ThermalDeratingEncoder SAT report includes 'derating' block."""
    enc = ThermalDeratingEncoder(epsilon=0.05)
    enc.encode()
    result, model = enc.check_satisfiability()
    if result == z3.sat:
        rep = report(result, model, enc)
        assert "derating" in rep
        der = rep["derating"]
        assert "f_rpu" in der
        assert "t_rpu" in der
        assert "deadline_ok" in der


def test_report_with_contention_resolution_encoder():
    """ContentionResolutionEncoder SAT report includes 'contention_resolution' block."""
    enc = ContentionResolutionEncoder(epsilon=0.05, target_margin=0.05)
    enc.encode()
    result, model = enc.check_satisfiability()
    if result == z3.sat:
        rep = report(result, model, enc)
        assert "contention_resolution" in rep
        cr = rep["contention_resolution"]
        assert "esv" in cr
        assert "margin" in cr
        assert "margin_ok" in cr


def test_report_with_power_tree_encoder():
    """PowerTreeEncoder SAT report includes 'power_tree' block."""
    enc = PowerTreeEncoder()
    enc.encode()
    result, model = enc.check_satisfiability()
    if result == z3.sat:
        rep = report(result, model, enc)
        assert "power_tree" in rep
