"""Fuzzing tests for the governance layer."""
import sys
from pathlib import Path
import pytest
from hypothesis import given, strategies as st, settings, assume

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from governance.seg_controller import SEGController, Mutation
from governance.sqa_aggregator import SQAAggregator, Validator, ValidatorVerdict, Verdict, ValidatorType

def _vv():
    v0 = Validator("v0", ValidatorType.FORMAL, 0)
    v1 = Validator("v1", ValidatorType.EMPIRICAL, 0)
    v2 = Validator("v2", ValidatorType.HEURISTIC, 0)
    return [ValidatorVerdict(v0, Verdict.ADMIT, 0.95, "ok"), ValidatorVerdict(v1, Verdict.ADMIT, 0.88, "ok"), ValidatorVerdict(v2, Verdict.ADMIT, 0.81, "ok")]

def _seg():
    sqa = SQAAggregator()
    seg = SEGController(sqa)
    seg.set_epoch(1)
    return seg

def test_seg_oversized_witness_hash():
    seg = _seg()
    huge = "sha256:" + "A" * 10000
    mut = Mutation("oversized", "test", "medium", {"admissible": True, "seq": 1, "sqa_certificate_ref": "quorum:self#bls_evidence_binding", "z3_witness_hash": huge}, huge, _vv())
    d = seg.evaluate(mut)
    assert d is not None

def test_seg_evidence_chain_none():
    seg = _seg()
    try:
        d = seg.evaluate(Mutation("none", "test", "medium", None, "sha256:abc", _vv()))
        assert not d.admissible
    except (TypeError, AttributeError): pass

def test_seg_evidence_chain_empty():
    seg = _seg()
    d = seg.evaluate(Mutation("empty", "test", "medium", {}, "sha256:abc", _vv()))
    assert not d.admissible

def test_seg_all_validators_reject():
    seg = _seg()
    vs = [ValidatorVerdict(Validator("v0", ValidatorType.FORMAL), Verdict.REJECT, 0.0, "no"),
          ValidatorVerdict(Validator("v1", ValidatorType.EMPIRICAL), Verdict.REJECT, 0.0, "no"),
          ValidatorVerdict(Validator("v2", ValidatorType.HEURISTIC), Verdict.REJECT, 0.0, "no")]
    d = seg.evaluate(Mutation("reject", "test", "medium", {"admissible": True, "seq": 1, "sqa_certificate_ref": "quorum:self#bls_evidence_binding", "z3_witness_hash": "sha256:abc"}, "sha256:abc", vs))
    assert not d.admissible

def test_seg_replay_same_mutation():
    seg = _seg()
    mut = Mutation("replay", "test", "medium", {"admissible": True, "seq": 1, "sqa_certificate_ref": "quorum:self#bls_evidence_binding", "z3_witness_hash": "sha256:abc"}, "sha256:abc", _vv())
    d1 = seg.evaluate(mut)
    d2 = seg.evaluate(mut)
    assert d1 is not None and d2 is not None

def test_seg_replay_old_epoch():
    seg = _seg()
    seg.set_epoch(5)
    d = seg.evaluate(Mutation("old", "test", "medium", {"admissible": True, "seq": 1, "sqa_certificate_ref": "quorum:self#bls_evidence_binding", "z3_witness_hash": "sha256:abc"}, "sha256:abc", _vv()))
    assert not d.admissible and "seq mismatch" in d.reason

def test_seg_negative_seq():
    seg = _seg()
    d = seg.evaluate(Mutation("neg", "test", "medium", {"admissible": True, "seq": -1, "sqa_certificate_ref": "quorum:self#bls_evidence_binding", "z3_witness_hash": "sha256:abc"}, "sha256:abc", _vv()))
    assert not d.admissible

def test_seg_negative_assurance():
    sqa = SQAAggregator()
    v0, v1, v2 = Validator("v0", ValidatorType.FORMAL), Validator("v1", ValidatorType.EMPIRICAL), Validator("v2", ValidatorType.HEURISTIC)
    for v in (v0, v1, v2): sqa.register_validator(v)
    vs = [ValidatorVerdict(v0, Verdict.ADMIT, -0.5, "neg"), ValidatorVerdict(v1, Verdict.ADMIT, 0.88, "ok"), ValidatorVerdict(v2, Verdict.ADMIT, 0.81, "ok")]
    cert = sqa.assemble_quorum("neg", "medium", vs, "sha256:abc")
    assert cert is not None

def test_seg_assurance_overflow():
    sqa = SQAAggregator()
    v0, v1, v2 = Validator("v0", ValidatorType.FORMAL), Validator("v1", ValidatorType.EMPIRICAL), Validator("v2", ValidatorType.HEURISTIC)
    for v in (v0, v1, v2): sqa.register_validator(v)
    vs = [ValidatorVerdict(v0, Verdict.ADMIT, 999.0, "overflow"), ValidatorVerdict(v1, Verdict.ADMIT, 0.88, "ok"), ValidatorVerdict(v2, Verdict.ADMIT, 0.81, "ok")]
    cert = sqa.assemble_quorum("overflow", "medium", vs, "sha256:abc")
    assert cert is not None

@given(risk_class=st.sampled_from(["low", "medium", "high", "critical", "invalid", "", None]),
       seq=st.one_of(st.integers(), st.text(), st.none(), st.floats()),
       witness=st.one_of(st.text(), st.none(), st.integers()))
@settings(max_examples=50, deadline=None)
def test_seg_fuzz_random_inputs(risk_class, seq, witness):
    seg = _seg()
    try:
        ec = {"admissible": True, "seq": seq, "sqa_certificate_ref": "quorum:self#bls_evidence_binding", "z3_witness_hash": str(witness) if witness is not None else ""}
        mut = Mutation("fuzz", "fuzz", str(risk_class) if risk_class else "medium", ec, str(witness) if witness is not None else "", _vv())
        d = seg.evaluate(mut)
        assert d is not None
    except (TypeError, ValueError, KeyError): pass
