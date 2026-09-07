"""Adv — Advice primitive.

Non-uniform polynomial-size advice (P/poly style). For a fixed problem
family, advice is a precomputed lookup table that the runtime consults
in O(1) time. Demonstrates the v6.43 counterexample: advice can decide
problems that {C,A,S,V,E} cannot (e.g., undecidable unary languages
when the advice encodes halting bits).

In this executable form, the advice table is built offline by an
external process (the `build_advice_table` function) and consulted
online by `execute_identify`.

Source: v6.43_counterexample.py:problem_with_advice, recovered.
"""
from __future__ import annotations
import hashlib
import random
from typing import Any, Dict, List, Optional


class AdviceTable:
    """Precomputed lookup table mapping task fingerprints to answers."""

    def __init__(self) -> None:
        self._table: Dict[str, Any] = {}

    def build_for_identify(self, hypotheses: List[bytes], target_idx: int) -> None:
        """Precompute the answer for the (hypotheses, target) pair.
        The fingerprint keys on the hypotheses' hashes, not their identity,
        so identical hypothesis sets reuse advice.
        """
        h_hash = hashlib.sha256(b"|".join(hypotheses)).hexdigest()[:16]
        self._table[h_hash] = target_idx

    def lookup(self, hypotheses: List[bytes]) -> Optional[int]:
        h_hash = hashlib.sha256(b"|".join(hypotheses)).hexdigest()[:16]
        return self._table.get(h_hash)

    def size_bytes(self) -> int:
        # 16 bytes per key + 4 bytes per value
        return len(self._table) * 20

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._table)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "AdviceTable":
        t = cls()
        t._table = dict(d)
        return t


def execute_identify(hypotheses: List[bytes], target_idx: int,
                     n_features: int, budget: int,
                     rng: random.Random,
                     advice: AdviceTable) -> Dict[str, Any]:
    """O(1) lookup if advice has the answer; otherwise fall back to
    adaptivity. This is the 6-primitive algorithm (v6.44).
    """
    cached = advice.lookup(hypotheses)
    if cached is not None:
        return {
            "best_idx": cached,
            "correct": cached == target_idx,
            "queries": 0,
            "storage_bytes": advice.size_bytes(),
            "work_units": 1,  # hash + lookup
            "depth": 1,
            "communication_bits": 0,
            "verification_calls": 0,
            "notes": {"used_advice": True},
        }
    # Fall back to adaptivity if advice missing
    from .adaptivity import execute_identify as adapt
    r = adapt(hypotheses, target_idx, n_features, budget, rng)
    r["notes"]["used_advice"] = False
    return r


def self_test() -> str:
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    advice = AdviceTable()
    advice.build_for_identify(hyps, 7)
    rng = random.Random(42)
    r = execute_identify(hyps, 7, 12, 16, rng, advice)
    assert r["correct"]
    assert r["queries"] == 0, "advice should yield 0 queries"
    assert r["notes"]["used_advice"] is True
    # Persistence
    d = advice.to_dict()
    advice2 = AdviceTable.from_dict(d)
    assert advice2.lookup(hyps) == 7
    return "advice OK"


if __name__ == "__main__":
    print(self_test())
