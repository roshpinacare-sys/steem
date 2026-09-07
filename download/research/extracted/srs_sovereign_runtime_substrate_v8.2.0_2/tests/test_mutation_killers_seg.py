"""Mutation killer tests for SEG survivors.

These tests kill the 3 SEG mutants that survived because the SEG self-test
was excluded from the mutation test command for speed. Each test directly
imports the SEG and SQA modules (no subprocess) and tests the specific
mutation target.
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


def _vv():
    v0 = Validator("v0", ValidatorType.FORMAL)
    v1 = Validator("v1", ValidatorType.EMPIRICAL)
    v2 = Validator("v2", ValidatorType.HEURISTIC)
    return [
        ValidatorVerdict(v0, Verdict.ADMIT, 0.95, "ok"),
        ValidatorVerdict(v1, Verdict.ADMIT, 0.88, "ok"),
        ValidatorVerdict(v2, Verdict.ADMIT, 0.81, "ok"),
    ]


def _seg(epoch=1):
    sqa = SQAAggregator()
    seg = SEGController(sqa)
    seg.set_epoch(epoch)
    return seg


# ---------------------------------------------------------------------------
# Mutant 1: SEG flip admissible check (NOT → direct)
# Mutation: "not ec.get("admissible"" → "ec.get("admissible""
# This means admissible=False would PASS check 1 (the NOT is removed)
# Test: verify that admissible=False is REJECTED
# ---------------------------------------------------------------------------

def test_seg_admissible_false_is_rejected():
    """evidence_chain with admissible=False must be rejected."""
    seg = _seg()
    mut = Mutation(
        mutation_id="m1",
        description="test",
        risk_class="medium",
        evidence_chain={
            "admissible": False,  # explicitly False
            "seq": 1,
            "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
            "z3_witness_hash": "sha256:abc",
        },
        z3_witness_hash="sha256:abc",
        validators=_vv(),
    )
    d = seg.evaluate(mut)
    assert not d.admissible, "admissible=False must be rejected"
    assert "admissible is False" in d.reason


def test_seg_admissible_true_is_accepted():
    """evidence_chain with admissible=True must be accepted (when all other checks pass)."""
    seg = _seg()
    mut = Mutation(
        mutation_id="m2",
        description="test",
        risk_class="medium",
        evidence_chain={
            "admissible": True,
            "seq": 1,
            "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
            "z3_witness_hash": "sha256:abc",
        },
        z3_witness_hash="sha256:abc",
        validators=_vv(),
    )
    d = seg.evaluate(mut)
    assert d.admissible, "admissible=True with all other checks passing must be accepted"


# ---------------------------------------------------------------------------
# Mutant 3: SEG flip quorum check (NOT → direct)
# Mutation: "not cert.admissible" → "cert.admissible"
# This means a failed quorum would PASS check 3
# Test: verify that a failed quorum (insufficient validators) is REJECTED
# ---------------------------------------------------------------------------

def test_seg_failed_quorum_is_rejected():
    """A mutation with insufficient validators (quorum fails) must be rejected."""
    seg = _seg()
    # Only 2 ADMIT verdicts (medium requires 3)
    vs = _vv()[:2]  # only 2 validators
    mut = Mutation(
        mutation_id="m3",
        description="test",
        risk_class="medium",
        evidence_chain={
            "admissible": True,
            "seq": 1,
            "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
            "z3_witness_hash": "sha256:abc",
        },
        z3_witness_hash="sha256:abc",
        validators=vs,
    )
    d = seg.evaluate(mut)
    assert not d.admissible, "Insufficient quorum (2 < 3) must be rejected"
    assert "quorum" in d.reason.lower() or "insufficient" in d.reason.lower()


# ---------------------------------------------------------------------------
# Mutant 4: SEG flip witness hash comparison
# Mutation: "ec_witness_hash != mutation.z3_witness_hash" → "=="
# This means a MISMATCHED witness hash would PASS check 4
# Test: verify that mismatched witness hash is REJECTED
# ---------------------------------------------------------------------------

def test_seg_witness_hash_mismatch_is_rejected():
    """Evidence chain witness hash != mutation witness hash must be rejected."""
    seg = _seg()
    mut = Mutation(
        mutation_id="m4",
        description="test",
        risk_class="medium",
        evidence_chain={
            "admissible": True,
            "seq": 1,
            "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
            "z3_witness_hash": "sha256:DIFFERENT",  # mismatch!
        },
        z3_witness_hash="sha256:abc",
        validators=_vv(),
    )
    d = seg.evaluate(mut)
    assert not d.admissible, "Witness hash mismatch must be rejected"
    assert "mismatch" in d.reason.lower() or "witness" in d.reason.lower()


def test_seg_witness_hash_match_is_accepted():
    """Evidence chain witness hash == mutation witness hash must be accepted."""
    seg = _seg()
    mut = Mutation(
        mutation_id="m5",
        description="test",
        risk_class="medium",
        evidence_chain={
            "admissible": True,
            "seq": 1,
            "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
            "z3_witness_hash": "sha256:abc",
        },
        z3_witness_hash="sha256:abc",
        validators=_vv(),
    )
    d = seg.evaluate(mut)
    assert d.admissible, "Witness hash match with all other checks passing must be accepted"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
