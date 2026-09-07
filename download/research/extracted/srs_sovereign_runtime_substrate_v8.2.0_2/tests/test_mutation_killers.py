"""Targeted tests to kill surviving mutation mutants.

Each test targets a specific mutation that survived the initial mutation
testing run, raising the mutation score from 42.9% toward 100%.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from governance.sqa_aggregator import (
    SQAAggregator, Validator, ValidatorVerdict, Verdict, ValidatorType,
)
from governance.seg_controller import SEGController, Mutation
from kernel.omnivisor import Omnivisor, Domain, Page, PageAttribute
from kernel.smpu_sppu import (
    SmpuDriver, SmpuRegion, Perm, DynamicSmpuController, TelemetrySnapshot,
    ECR_CASCADE_THRESHOLD,
)
from self_healing.digital_dna import DNAEncoder, DigitalDNA, ArtefactKind
import math


# ---------------------------------------------------------------------------
# Mutant 7: SQA c_min off-by-one (< → <=)
# Test: verify that c_sum == c_min is REJECTED (c_sum must be >= c_min, not > c_min)
# ---------------------------------------------------------------------------

def test_sqa_c_min_boundary_exact_match():
    """c_sum == c_min should be ADMITTED (the check is c_sum < c_min → reject)."""
    sqa = SQAAggregator()
    v0 = Validator("v0", ValidatorType.FORMAL)
    v1 = Validator("v1", ValidatorType.EMPIRICAL)
    v2 = Validator("v2", ValidatorType.HEURISTIC)
    for v in (v0, v1, v2):
        sqa.register_validator(v)
    # medium risk: c_min = 2.0, so make c_sum exactly 2.0
    # 0.95 + 0.88 + 0.17 = 2.0
    vs = [
        ValidatorVerdict(v0, Verdict.ADMIT, 0.95, "ok"),
        ValidatorVerdict(v1, Verdict.ADMIT, 0.88, "ok"),
        ValidatorVerdict(v2, Verdict.ADMIT, 0.17, "ok"),  # low but c_sum = 2.0
    ]
    cert = sqa.assemble_quorum("boundary", "medium", vs, "sha256:abc")
    # c_sum = 2.0, c_min = 2.0 → should be admissible (>= not >)
    assert cert.admissible, f"c_sum={cert.c_sum} >= c_min={cert.c_min} should be admissible"

    # Now make c_sum just below c_min
    vs_below = [
        ValidatorVerdict(v0, Verdict.ADMIT, 0.95, "ok"),
        ValidatorVerdict(v1, Verdict.ADMIT, 0.88, "ok"),
        ValidatorVerdict(v2, Verdict.ADMIT, 0.16, "ok"),  # c_sum = 1.99 < 2.0
    ]
    cert_below = sqa.assemble_quorum("below", "medium", vs_below, "sha256:abc")
    assert not cert_below.admissible, f"c_sum={cert_below.c_sum} < c_min={cert_below.c_min} should be rejected"


# ---------------------------------------------------------------------------
# Mutant 8: Omnivisor flip owner check (== → !=)
# Test: verify that the owner CAN write but non-owner CANNOT
# ---------------------------------------------------------------------------

def test_omnivisor_owner_can_write_non_owner_cannot():
    """Owner must be able to write; non-owner must be blocked for TI pages."""
    ov = Omnivisor()
    ov.install_page(Page(
        pa=0x1000, size=0x1000, owner=Domain.APU,
        attrs=frozenset({PageAttribute.TI}),
    ))
    # Owner can write
    assert ov.admissible_write(Domain.APU, 0x1000) is True
    # Non-owner cannot write (TI page)
    assert ov.admissible_write(Domain.FPGA, 0x1000) is False
    # Non-owner cannot write at different address in range
    assert ov.admissible_write(Domain.RPU, 0x1500) is False


# ---------------------------------------------------------------------------
# Mutant 9: Omnivisor flip TI check (not in → in)
# Test: verify that non-TI pages are writable by all, TI pages only by owner
# ---------------------------------------------------------------------------

def test_omnivisor_ti_vs_non_ti_pages():
    """Non-TI pages must be writable by any domain; TI pages only by owner."""
    ov = Omnivisor()
    # Non-TI page
    ov.install_page(Page(
        pa=0x2000, size=0x1000, owner=Domain.APU,
        attrs=frozenset(),  # no TI
    ))
    # TI page
    ov.install_page(Page(
        pa=0x3000, size=0x1000, owner=Domain.APU,
        attrs=frozenset({PageAttribute.TI}),
    ))
    # Non-TI: any domain can write
    assert ov.admissible_write(Domain.FPGA, 0x2000) is True
    assert ov.admissible_write(Domain.RPU, 0x2500) is True
    # TI: only owner can write
    assert ov.admissible_write(Domain.APU, 0x3000) is True
    assert ov.admissible_write(Domain.FPGA, 0x3000) is False


# ---------------------------------------------------------------------------
# Mutant 10: Omnivisor TIB off-by-one (< → <=)
# Test: verify that budget == cost is granted, budget < cost is denied
# ---------------------------------------------------------------------------

def test_omnivisor_tib_boundary():
    """Budget exactly equal to cost should be granted; cost+1 should be denied."""
    from kernel.omnivisor import TIBBudget
    ov = Omnivisor()
    # Manually set budget to 5
    ov.tib[Domain.APU].budget = 5
    # cost == budget → should grant
    assert ov.grant_hypercall(Domain.APU, cost=5) is True
    assert ov.tib[Domain.APU].budget == 0
    # Reset
    ov.tib[Domain.APU].budget = 5
    # cost > budget → should deny
    assert ov.grant_hypercall(Domain.APU, cost=6) is False
    assert ov.tib[Domain.APU].budget == 5  # unchanged


# ---------------------------------------------------------------------------
# Mutant 11: SMPU ECR threshold off-by-one (> → >=)
# Test: verify that ECR exactly at threshold does NOT trigger quarantine
# ---------------------------------------------------------------------------

def test_smpu_ecr_threshold_boundary():
    """ECR exactly at threshold should NOT trigger; above should trigger."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x40000000, size=0x100000,
                            owner="FPGA", perm=Perm.RWX, ti=True))
    dyn = DynamicSmpuController(smpu)

    # ECR exactly at threshold → should NOT quarantine (the check is > not >=)
    snap_at = TelemetrySnapshot(
        theta={"FPGA": 0.5},
        ecr_rate={"FPGA": ECR_CASCADE_THRESHOLD},  # exactly at threshold
        photonic_saturation=0.5,
    )
    events_at = dyn.consume_telemetry(snap_at, {"FPGA": 0}, seg_certify_fn=lambda x: True)
    ecr_events = [e for e in events_at if e["action"] == "ecr_quarantine"]
    assert len(ecr_events) == 0, "ECR at threshold should NOT trigger quarantine"

    # Reset SMPU
    smpu2 = SmpuDriver()
    smpu2.program(SmpuRegion(base=0x40000000, size=0x100000,
                             owner="FPGA", perm=Perm.RWX, ti=True))
    dyn2 = DynamicSmpuController(smpu2)

    # ECR above threshold → should quarantine
    snap_above = TelemetrySnapshot(
        theta={"FPGA": 0.5},
        ecr_rate={"FPGA": ECR_CASCADE_THRESHOLD + 0.001},
        photonic_saturation=0.5,
    )
    events_above = dyn2.consume_telemetry(snap_above, {"FPGA": 0}, seg_certify_fn=lambda x: True)
    ecr_events_above = [e for e in events_above if e["action"] == "ecr_quarantine"]
    assert len(ecr_events_above) == 1, "ECR above threshold SHOULD trigger quarantine"
    assert smpu2.regions[0].perm == Perm.RO


# ---------------------------------------------------------------------------
# Mutant 12: SMPU flip quarantine check (== RO → != RO)
# Test: verify that quarantine actually changes perm to RO
# ---------------------------------------------------------------------------

def test_smpu_quarantine_changes_perm_to_ro():
    """Quarantine must change perm from RWX to RO."""
    smpu = SmpuDriver()
    smpu.program(SmpuRegion(base=0x40000000, size=0x100000,
                            owner="FPGA", perm=Perm.RWX, ti=True))
    assert smpu.regions[0].perm == Perm.RWX  # before quarantine

    dyn = DynamicSmpuController(smpu)
    snap = TelemetrySnapshot(
        theta={"FPGA": 0.5},
        ecr_rate={"FPGA": 0.08},  # above threshold
        photonic_saturation=0.5,
    )
    dyn.consume_telemetry(snap, {"FPGA": 0}, seg_certify_fn=lambda x: True)

    assert smpu.regions[0].perm == Perm.RO  # after quarantine


# ---------------------------------------------------------------------------
# Mutant 13: DNA flip zero-norm guard (== 0 → != 0)
# Test: verify that zero-norm fingerprints return affinity 0.0
# ---------------------------------------------------------------------------

def test_dna_zero_norm_returns_zero():
    """Zero-norm fingerprint must return affinity 0.0, not crash or return NaN."""
    d1 = DigitalDNA(
        strand="a" * 64, fingerprint=[0.0] * 32,
        kind=ArtefactKind.RTL_DESIGN, provenance_esr_id="e1", environment_snapshot="s1",
    )
    d2 = DigitalDNA(
        strand="b" * 64, fingerprint=[1.0, 0.5, 0.3] + [0.0] * 29,
        kind=ArtefactKind.RTL_DESIGN, provenance_esr_id="e2", environment_snapshot="s2",
    )
    aff = d1.affinity(d2)
    assert aff == 0.0, f"Zero-norm should return 0.0, got {aff}"

    # Both zero-norm
    d3 = DigitalDNA(
        strand="c" * 64, fingerprint=[0.0] * 32,
        kind=ArtefactKind.RTL_DESIGN, provenance_esr_id="e3", environment_snapshot="s3",
    )
    aff2 = d1.affinity(d3)
    assert aff2 == 0.0, f"Both zero-norm should return 0.0, got {aff2}"


# ---------------------------------------------------------------------------
# Mutant 14: DNA wrong cosine formula (dot/(n1*n2) → dot/(n1+n2))
# Test: verify that the affinity is actually cosine similarity, not some other formula
# ---------------------------------------------------------------------------

def test_dna_affinity_is_cosine_similarity():
    """Affinity must be cosine similarity: dot(a,b) / (||a|| * ||b||)."""
    # Use known vectors where cosine != dot/(n1+n2)
    # a = [1, 0], b = [1, 1] → cosine = 1/sqrt(2) ≈ 0.7071
    # dot/(n1+n2) = 1/(1+sqrt(2)) ≈ 0.4142
    # These are different, so the test distinguishes the two formulas.
    d1 = DigitalDNA(
        strand="a" * 64, fingerprint=[1.0, 0.0] + [0.0] * 30,
        kind=ArtefactKind.RTL_DESIGN, provenance_esr_id="e1", environment_snapshot="s1",
    )
    d2 = DigitalDNA(
        strand="b" * 64, fingerprint=[1.0, 1.0] + [0.0] * 30,
        kind=ArtefactKind.RTL_DESIGN, provenance_esr_id="e2", environment_snapshot="s2",
    )
    aff = d1.affinity(d2)
    expected_cosine = 1.0 / math.sqrt(2.0)  # ≈ 0.7071
    expected_wrong = 1.0 / (1.0 + math.sqrt(2.0))  # ≈ 0.4142
    assert abs(aff - expected_cosine) < 0.01, (
        f"Affinity should be cosine similarity ({expected_cosine:.4f}), "
        f"got {aff:.4f} (wrong formula would give {expected_wrong:.4f})"
    )


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
