"""Self-improvement — update advice table from execution experience.

Inspired by self_healing/antibody_maturation.py: each successful
identification seeds the advice table for future lookups.
"""
from __future__ import annotations
import hashlib
from typing import List
from .primitives.advice import AdviceTable


def improve(advice: AdviceTable, hypotheses: List[bytes], target_idx: int,
            was_correct: bool) -> int:
    """If the identification was correct, seed advice for future reuse.

    Returns the number of new entries added (0 or 1).
    """
    if not was_correct:
        return 0
    h_hash = hashlib.sha256(b"|".join(hypotheses)).hexdigest()[:16]
    if h_hash in advice._table:
        return 0
    advice._table[h_hash] = target_idx
    return 1


def self_test() -> str:
    advice = AdviceTable()
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(8)]
    # First run: nothing in advice
    n = improve(advice, hyps, 3, True)
    assert n == 1
    # Second run: already there
    n = improve(advice, hyps, 3, True)
    assert n == 0
    # Wrong answer: don't seed
    hyps2 = [hashlib.sha256(f"j{i}".encode()).digest() for i in range(8)]
    n = improve(advice, hyps2, 5, False)
    assert n == 0
    return "self-improvement OK"


if __name__ == "__main__":
    print(self_test())
