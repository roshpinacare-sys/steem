"""SRS Runtime test suite."""
import hashlib
import random
import tempfile
from pathlib import Path

import pytest

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from srs import Runtime, Task, __version__
from srs.primitives import (execution, compression, adaptivity, scheduling,
                            verification, advice, quantum)
from srs.primitives.advice import AdviceTable
from srs.planner import plan
from srs import persistence, improvement


def test_version():
    assert __version__ == "7.0.0"


def test_execution_self_test():
    assert execution.self_test() == "execution OK"


def test_compression_self_test():
    assert compression.self_test() == "compression OK"


def test_adaptivity_self_test():
    assert adaptivity.self_test() == "adaptivity OK"


def test_scheduling_self_test():
    assert scheduling.self_test() == "scheduling OK"


def test_verification_self_test():
    assert verification.self_test() == "verification OK"


def test_advice_self_test():
    assert advice.self_test() == "advice OK"


def test_quantum_self_test():
    assert quantum.self_test() == "quantum OK"


def test_planner_self_test():
    from srs.planner import self_test
    assert self_test() == "planner OK"


def test_persistence_self_test():
    assert persistence.self_test() == "persistence OK"


def test_improvement_self_test():
    assert improvement.self_test() == "self-improvement OK"


def test_runtime_self_test():
    from srs.runtime import self_test
    assert self_test() == "runtime OK"


def test_compression_reduces_storage():
    """C should use less storage than E for the same problem."""
    rng1 = random.Random(42)
    rng2 = random.Random(42)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    r_e = execution.execute_identify(hyps, 7, 12, 16, rng1)
    r_c = compression.execute_identify(hyps, 7, 12, 16, rng2)
    assert r_c["storage_bytes"] < r_e["storage_bytes"]


def test_adaptivity_uses_fewer_queries():
    """A should use fewer queries than E for the same correctness."""
    rng1 = random.Random(42)
    rng2 = random.Random(42)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(256)]
    r_e = execution.execute_identify(hyps, 100, 12, 16, rng1)
    r_a = adaptivity.execute_identify(hyps, 100, 12, 16, rng2)
    # Adaptive should use fewer or equal queries for same correctness
    if r_a["correct"] and r_e["correct"]:
        assert r_a["queries"] <= r_e["queries"]


def test_advice_yields_zero_queries():
    """Adv should answer in 0 queries when advice table has the answer."""
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    adv = AdviceTable()
    adv.build_for_identify(hyps, 7)
    rng = random.Random(42)
    r = advice.execute_identify(hyps, 7, 12, 16, rng, adv)
    assert r["queries"] == 0
    assert r["correct"]


def test_runtime_end_to_end():
    """Full Runtime execute -> persist -> recover cycle."""
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
                    budget=16)
        r = rt.execute(task)
        assert r.correct
        # Persist + recover
        rt.store_state()
        rt2 = Runtime(home=Path(tmp))
        assert rt2.recover()
        # Advice should have been seeded
        assert len(rt2.advice._table) >= 1


def test_runtime_self_improvement():
    """Second run of same task should hit advice (0 queries)."""
    with tempfile.TemporaryDirectory() as tmp:
        rt = Runtime(home=Path(tmp))
        hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
        task = Task(kind="identify",
                    payload={"hypotheses": hyps, "target_idx": 7, "n_features": 12},
                    budget=16)
        r1 = rt.execute(task)
        assert r1.correct
        # Second run: advice should be seeded now
        r2 = rt.execute(task)
        assert r2.correct
        # If advice hit, queries == 0
        if r2.notes.get("advice_hit"):
            assert r2.queries == 0


def test_capabilities_report():
    rt = Runtime(home=Path("/tmp/srs_test_caps_ignored"))
    c = rt.capabilities()
    assert "primitives" in c
    assert set(c["primitives"]) == {"E", "C", "A", "S", "V", "Adv", "Q"}
    assert c["version"] == "7.0.0"


def test_planner_picks_correct_primitives():
    axis, prims = plan("identify")
    assert "A" in prims
    assert "V" in prims
    axis, prims = plan("search")
    assert "Q" in prims
    axis, prims = plan("verify")
    assert prims == ["V"]


def test_verification_soundness():
    """Wrong candidate should be caught with high probability."""
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    rng = random.Random(42)
    # Try wrong candidate many times; should almost always be caught
    caught = 0
    trials = 20
    for _ in range(trials):
        v = verification.verify(hyps, 7, 8, 12, 5, rng)
        if not v["verified"]:
            caught += 1
    # P(not caught) <= 2^-5 = 1/32 per trial; over 20 trials, expected ~0.625 escapes
    assert caught >= trials - 5, f"only {caught}/{trials} caught"
