"""Concurrency tests for the SEG (audit gap H5)."""
import sys, threading
from pathlib import Path
import pytest

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

def test_seg_concurrent_admission_no_crash():
    seg = _seg()
    mut = Mutation("c1", "test", "medium", {"admissible": True, "seq": 1, "sqa_certificate_ref": "quorum:self#bls_evidence_binding", "z3_witness_hash": "sha256:c"}, "sha256:c", _vv())
    results = []
    lock = threading.Lock()
    def submit():
        d = seg.evaluate(mut)
        with lock: results.append(d)
    threads = [threading.Thread(target=submit) for _ in range(10)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert len(results) == 10

def test_seg_concurrent_different_mutations():
    seg = _seg()
    results = []
    lock = threading.Lock()
    def submit(i):
        mut = Mutation(f"c{i}", "test", "medium", {"admissible": True, "seq": 1, "sqa_certificate_ref": "quorum:self#bls_evidence_binding", "z3_witness_hash": f"sha256:m{i}"}, f"sha256:m{i}", _vv())
        d = seg.evaluate(mut)
        with lock: results.append(d)
    threads = [threading.Thread(target=submit, args=(i,)) for i in range(5)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert len(results) == 5
    assert sum(1 for r in results if r.admissible) == 5

def test_seg_concurrent_rejected_mutations():
    seg = _seg()
    results = []
    lock = threading.Lock()
    def submit(i):
        mut = Mutation(f"r{i}", "test", "medium", {"admissible": True, "seq": 99, "sqa_certificate_ref": "quorum:self#bls_evidence_binding", "z3_witness_hash": f"sha256:r{i}"}, f"sha256:r{i}", _vv())
        d = seg.evaluate(mut)
        with lock: results.append(d)
    threads = [threading.Thread(target=submit, args=(i,)) for i in range(5)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert sum(1 for r in results if not r.admissible) == 5
    assert seg.stats()["certified"] == 0
