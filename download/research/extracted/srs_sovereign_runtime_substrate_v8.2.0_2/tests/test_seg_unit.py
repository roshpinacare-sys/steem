"""Direct unit tests for governance/seg_controller.py — fills coverage gaps.

Targets the rejection branches that the existing test_property.py /
test_mutation_killers_seg.py do not exercise directly:
  - cert.z3_witness_hash != mutation.z3_witness_hash (Check 4 second arm)
  - cert has no binding_sig (Check 5 first arm)
  - ref does not start with 'quorum:' (Check 5 second arm)
  - stats() returns expected keys
  - _reject() records into rejected_mutations
  - certified_mutations is populated on success
"""
from __future__ import annotations

import pytest

from governance.sqa_aggregator import (
    SQAAggregator, Validator, ValidatorVerdict, Verdict, ValidatorType,
    QuorumCertificate,
)
from governance.seg_controller import SEGController, Mutation


@pytest.fixture
def seg_setup():
    sqa = SQAAggregator()
    seg = SEGController(sqa)
    seg.set_epoch(7)

    z3_val = Validator("z3-01", ValidatorType.FORMAL, "pk-z3")
    emp_val = Validator("emp-02", ValidatorType.EMPIRICAL, "pk-emp")
    heu_val = Validator("heu-03", ValidatorType.HEURISTIC, "pk-heu")
    for v in (z3_val, emp_val, heu_val):
        sqa.register_validator(v)

    verdicts = [
        ValidatorVerdict(z3_val, Verdict.ADMIT, 0.95, "Z3 ok", "sig-z3"),
        ValidatorVerdict(emp_val, Verdict.ADMIT, 0.88, "HIL ok", "sig-emp"),
        ValidatorVerdict(heu_val, Verdict.ADMIT, 0.81, "antibody ok", "sig-heu"),
    ]
    return seg, verdicts


def _make_mutation(verdicts, **overrides):
    ec = {
        "admissible": True,
        "seq": 7,
        "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
        "z3_witness_hash": "sha256:abc123",
    }
    ec.update(overrides.pop("ec_overrides", {}))
    base = dict(
        mutation_id="mut-test",
        description="test mutation",
        risk_class="medium",
        evidence_chain=ec,
        z3_witness_hash="sha256:abc123",
        validators=verdicts,
    )
    base.update(overrides)
    return Mutation(**base)


# ---------------------------------------------------------------------------
# Check 4 second arm: cert.z3_witness_hash != mutation.z3_witness_hash
# ---------------------------------------------------------------------------

def test_cert_witness_hash_mismatch_is_rejected(seg_setup):
    seg, verdicts = seg_setup
    fake_cert = QuorumCertificate(
        risk_class="medium",
        threshold=2,
        c_min=0.7,
        c_sum=2.64,
        admit_verdicts=verdicts,
        aggregate_sig="agg-sig",
        z3_witness_hash="sha256:DIFFERENT-FROM-MUTATION",
        binding_sig="binding-sig",
        admissible=True,
        rejection_reason=None,
    )
    seg.sqa.assemble_quorum = lambda *a, **k: fake_cert
    mut = _make_mutation(verdicts, mutation_id="mut-fake")
    d = seg.evaluate(mut)
    assert not d.admissible
    assert "mismatch" in d.reason.lower() or "different witness" in d.reason.lower()


# ---------------------------------------------------------------------------
# Check 5 first arm: cert has no binding_sig
# ---------------------------------------------------------------------------

def test_cert_without_binding_sig_is_rejected(seg_setup):
    seg, verdicts = seg_setup
    fake_cert = QuorumCertificate(
        risk_class="medium",
        threshold=2,
        c_min=0.7,
        c_sum=2.64,
        admit_verdicts=verdicts,
        aggregate_sig="agg-sig",
        z3_witness_hash="sha256:abc123",
        binding_sig="",  # empty
        admissible=True,
        rejection_reason=None,
    )
    seg.sqa.assemble_quorum = lambda *a, **k: fake_cert
    mut = _make_mutation(verdicts, mutation_id="mut-no-binding")
    d = seg.evaluate(mut)
    assert not d.admissible
    assert "binding" in d.reason.lower()


# ---------------------------------------------------------------------------
# Check 5 second arm: ref doesn't start with 'quorum:'
# ---------------------------------------------------------------------------

def test_cert_ref_without_quorum_prefix_is_rejected(seg_setup):
    seg, verdicts = seg_setup
    mut = _make_mutation(
        verdicts,
        mutation_id="mut-bad-ref",
        ec_overrides={"sqa_certificate_ref": "magic:string"},
    )
    d = seg.evaluate(mut)
    assert not d.admissible
    assert "quorum:" in d.reason or "does not start" in d.reason


# ---------------------------------------------------------------------------
# _reject() records into rejected_mutations
# ---------------------------------------------------------------------------

def test_reject_records_into_rejected_dict(seg_setup):
    seg, verdicts = seg_setup
    mut = _make_mutation(
        verdicts,
        mutation_id="mut-reject-record",
        ec_overrides={"admissible": False},
    )
    d = seg.evaluate(mut)
    assert not d.admissible
    assert "mut-reject-record" in seg.rejected_mutations
    assert "mut-reject-record" not in seg.certified_mutations


# ---------------------------------------------------------------------------
# certified_mutations is populated on success
# ---------------------------------------------------------------------------

def test_certify_records_into_certified_dict(seg_setup):
    seg, verdicts = seg_setup
    mut = _make_mutation(verdicts, mutation_id="mut-cert-record")
    d = seg.evaluate(mut)
    assert d.admissible
    assert "mut-cert-record" in seg.certified_mutations
    assert "mut-cert-record" not in seg.rejected_mutations


# ---------------------------------------------------------------------------
# stats()
# ---------------------------------------------------------------------------

def test_stats_initial_state():
    sqa = SQAAggregator()
    seg = SEGController(sqa)
    s = seg.stats()
    assert s["active_epoch"] == 0
    assert s["certified"] == 0
    assert s["rejected"] == 0


def test_stats_after_mixed_decisions(seg_setup):
    seg, verdicts = seg_setup
    seg.evaluate(_make_mutation(verdicts, mutation_id="m1"))
    seg.evaluate(_make_mutation(
        verdicts, mutation_id="m2", ec_overrides={"admissible": False}
    ))
    s = seg.stats()
    assert s["active_epoch"] == 7
    assert s["certified"] == 1
    assert s["rejected"] == 1


# ---------------------------------------------------------------------------
# set_epoch updates the active epoch
# ---------------------------------------------------------------------------

def test_set_epoch_updates_active_epoch(seg_setup):
    seg, _ = seg_setup
    assert seg.active_epoch == 7
    seg.set_epoch(42)
    assert seg.active_epoch == 42


# ---------------------------------------------------------------------------
# Seq missing entirely (None) — separate from seq != epoch
# ---------------------------------------------------------------------------

def test_seq_missing_entirely_is_rejected(seg_setup):
    seg, verdicts = seg_setup
    ec = {
        "admissible": True,
        # NO seq key
        "sqa_certificate_ref": "quorum:self#bls_evidence_binding",
        "z3_witness_hash": "sha256:abc123",
    }
    mut = Mutation(
        mutation_id="mut-no-seq",
        description="missing seq",
        risk_class="medium",
        evidence_chain=ec,
        z3_witness_hash="sha256:abc123",
        validators=verdicts,
    )
    d = seg.evaluate(mut)
    assert not d.admissible
    assert "missing" in d.reason.lower()


# ---------------------------------------------------------------------------
# Empty mutation.z3_witness_hash (the second guard at line 137-139)
# ---------------------------------------------------------------------------

def test_empty_mutation_witness_hash_is_rejected(seg_setup):
    seg, verdicts = seg_setup
    mut = _make_mutation(
        verdicts,
        mutation_id="mut-empty-w",
        z3_witness_hash="",  # empty
    )
    d = seg.evaluate(mut)
    assert not d.admissible
    assert "missing or empty" in d.reason
