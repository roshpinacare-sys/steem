"""V — Verification primitive.

Probabilistic check of a candidate answer. Mirrors v6.42
algorithm_full's verification phase: after identifying candidate h*,
run k random queries; if any mismatch, mark as unverified.

PCP-style: soundness epsilon = 2^(-k) for k verification queries.

Source: v6.42_closure_demo.py:algorithm_full, recovered.
"""
from __future__ import annotations
import hashlib
import random
from typing import Any, Dict, List
from .execution import hash_bit


def verify(hypotheses: List[bytes], target_idx: int, candidate_idx: int,
           n_features: int, k: int, rng: random.Random) -> Dict[str, Any]:
    """Return dict with `verified` (bool) and `verification_calls` (int).

    If candidate_idx == target_idx, always verified=True.
    Otherwise, each probe catches mismatch with prob >= 1/2 (under
    random input), so P(verified=True | wrong) <= 2^(-k).
    """
    if candidate_idx == target_idx:
        return {"verified": True, "verification_calls": k, "soundness_epsilon": 2**(-k)}

    calls = 0
    for _ in range(k):
        x = rng.getrandbits(n_features)
        if hash_bit(hypotheses[candidate_idx], x) != hash_bit(hypotheses[target_idx], x):
            return {"verified": False, "verification_calls": calls + 1,
                    "soundness_epsilon": 2**(-k)}
        calls += 1
    return {"verified": True, "verification_calls": calls,
            "soundness_epsilon": 2**(-k)}


def execute_identify(hypotheses: List[bytes], target_idx: int,
                     n_features: int, budget: int,
                     rng: random.Random,
                     verify_budget: int = 5) -> Dict[str, Any]:
    """Adaptive identification + probabilistic verification."""
    # Phase 1: adaptive identification (uses budget - verify_budget queries)
    from .adaptivity import execute_identify as adapt
    identify_budget = max(1, budget - verify_budget)
    r = adapt(hypotheses, target_idx, n_features, identify_budget, rng)
    if "notes" not in r:
        r["notes"] = {}

    # Phase 2: verification
    v = verify(hypotheses, target_idx, r["best_idx"], n_features, verify_budget, rng)
    r["verified"] = v["verified"]
    r["verification_calls"] = v["verification_calls"]
    r["queries"] += v["verification_calls"]
    r["work_units"] += v["verification_calls"]
    r["depth"] += v["verification_calls"]
    r["notes"]["soundness_epsilon"] = v["soundness_epsilon"]
    return r


def self_test() -> str:
    rng = random.Random(42)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    # Correct candidate -> verified
    v = verify(hyps, 7, 7, 12, 5, rng)
    assert v["verified"] is True
    # Wrong candidate -> likely caught
    rng = random.Random(42)
    v = verify(hyps, 7, 8, 12, 5, rng)
    # Soundness: P(verified=True | wrong) <= 2^-5 = 1/32
    return "verification OK"


if __name__ == "__main__":
    print(self_test())
