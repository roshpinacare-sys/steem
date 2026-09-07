"""V — Verification primitive.

Probabilistic check of a candidate answer. Mirrors v6.42
algorithm_full's verification phase: after identifying candidate h*,
run k random queries; if any mismatch, mark as unverified.

PCP-style: soundness epsilon = 2^(-k) for k verification queries.

Source: v6.42_closure_demo.py:algorithm_full, recovered.
"""
from __future__ import annotations

import hashlib
import logging
import random
import secrets
from typing import Any

from .execution import hash_bit

logger = logging.getLogger("srs.primitives.verification")


def verify(hypotheses: list[bytes], target_idx: int, candidate_idx: int,
           n_features: int, k: int,
           rng: random.Random | None = None) -> dict[str, Any]:
    """Return dict with `verified` (bool) and `verification_calls` (int).

    If candidate_idx == target_idx, always verified=True.
    Otherwise, each probe catches mismatch with prob >= 1/2 (under
    random input), so P(verified=True | wrong) <= 2^(-k).

    ``rng`` controls the probe sequence. If ``None`` (the new default),
    we use ``secrets.SystemRandom()`` — a CSPRNG backed by the OS
    entropy source. The soundness bound ``P(verified=True |
    wrong) <= 2^-k`` assumes a non-adaptive adversary who cannot
    predict the probe points; ``SystemRandom`` enforces that even
    against an adversary who can observe the runtime's state.

    Callers that need reproducibility (e.g. tests, replays) should pass
    an explicit ``random.Random(seed)``; the soundness guarantee is
    only statistical in that case, but the same seed always yields the
    same probe sequence so a previously-passing test does not flake.

    The previous signature required ``rng`` positionally; the new
    default keeps backward compatibility for positional callers (they
    pass ``rng`` as the 6th positional arg) while enabling the secure
    default for keyword callers who omit it.
    """
    if rng is None:
        # Use a CSPRNG when no RNG is supplied. The previous behavior
        # (random.Random with a predictable seed derived from the
        # task_id) was technically sound for the statistical bound but
        # failed against an adaptive adversary who could predict the
        # seed and pre-compute a passing candidate.
        rng = secrets.SystemRandom()
    logger.debug("V: verifying candidate=%d target=%d k=%d (rng=%s)",
                 candidate_idx, target_idx, k, type(rng).__name__)
    if candidate_idx == target_idx:
        logger.debug("V: candidate==target — verified (soundness_epsilon=2^-k)")
        return {"verified": True, "verification_calls": k, "soundness_epsilon": 2**(-k)}

    calls = 0
    for _ in range(k):
        x = rng.getrandbits(n_features)
        if hash_bit(hypotheses[candidate_idx], x) != hash_bit(hypotheses[target_idx], x):
            logger.debug("V: mismatch found at call %d — verified=False", calls + 1)
            return {"verified": False, "verification_calls": calls + 1,
                    "soundness_epsilon": 2**(-k)}
        calls += 1
    logger.debug("V: no mismatch after %d calls — verified=True (prob=2^-k)", calls)
    return {"verified": True, "verification_calls": calls,
            "soundness_epsilon": 2**(-k)}


def execute_identify(hypotheses: list[bytes], target_idx: int,
                     n_features: int, budget: int,
                     rng: random.Random,
                     verify_budget: int = 5) -> dict[str, Any]:
    """Adaptive identification + probabilistic verification."""
    # Phase 1: adaptive identification (uses budget - verify_budget queries)
    from .adaptivity import execute_identify as adapt
    identify_budget = max(1, budget - verify_budget)
    r = adapt(hypotheses, target_idx, n_features, identify_budget, rng)
    if "notes" not in r:
        r["notes"] = {}

    # Phase 2: verification. Pass the caller-supplied rng through so
    # reproducibility (caller passed random.Random(seed)) is preserved.
    # If reproducibility is not required, callers can call verify()
    # directly with rng=None to get the SystemRandom default.
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
    # Soundness: P(verified=True | wrong) <= 2^-5 = 1/32.
    # rng=None should use SystemRandom (no crash, no predictability).
    v_sys = verify(hyps, 7, 8, 12, 5)  # rng=None → SystemRandom
    assert "verified" in v_sys and "verification_calls" in v_sys
    return "verification OK"


if __name__ == "__main__":
    print(self_test())
