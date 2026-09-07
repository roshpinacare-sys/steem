"""Self-improvement — update advice table from execution experience.

Target-aware: advice is keyed on (hypotheses, target_idx), so different
targets get separate entries.

Inspired by self_healing/antibody_maturation.py: each successful
identification seeds the advice table for future lookups.
"""
from __future__ import annotations

from .primitives.advice import AdviceTable


def improve(advice: AdviceTable, hypotheses: list[bytes], target_idx: int,
            was_correct: bool) -> int:
    """If the identification was correct, seed advice for future reuse.

    Uses target-aware keying. Different targets for the
    same hypotheses set get separate advice entries.

    Returns the number of new entries added (0 or 1).
    """
    if not was_correct:
        return 0
    # Delegate to the AdviceTable's public add() method, which performs
    # the check-then-set atomically under the table's internal lock.
    # Returning the int (0 or 1) keeps the public contract stable.
    return 1 if advice.add(hypotheses, target_idx) else 0


def self_test() -> str:
    advice = AdviceTable()
    hyps = [__import__('hashlib').sha256(f"h{i}".encode()).digest() for i in range(8)]
    # First run: nothing in advice
    n = improve(advice, hyps, 3, True)
    assert n == 1
    # Second run: already there (same target)
    n = improve(advice, hyps, 3, True)
    assert n == 0
    # Different target on same hyps -> NEW entry
    n = improve(advice, hyps, 5, True)
    assert n == 1, "different target should add new entry"
    # Both targets should be in the table
    assert advice.lookup(hyps, 3) == 3
    assert advice.lookup(hyps, 5) == 5
    # Wrong answer: don't seed
    hyps2 = [__import__('hashlib').sha256(f"j{i}".encode()).digest() for i in range(8)]
    n = improve(advice, hyps2, 5, False)
    assert n == 0
    return "self-improvement OK"


if __name__ == "__main__":
    print(self_test())

