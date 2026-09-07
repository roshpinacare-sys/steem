"""A — Adaptivity primitive.

Information-gain greedy query selection. Mirrors v6.42
algorithm_with_adaptivity: at each step, pick input x that best
splits the surviving hypothesis set.

Source: v6.42_closure_demo.py:algorithm_with_adaptivity, recovered.
"""
from __future__ import annotations
import hashlib
import math
import random
from typing import Any, Dict, List, Set
from .execution import hash_bit


def execute_identify(hypotheses: List[bytes], target_idx: int,
                     n_features: int, budget: int,
                     rng: random.Random) -> Dict[str, Any]:
    alive: Set[int] = set(range(len(hypotheses)))
    queries_made = 0
    work = 0
    transcript: List[tuple] = []
    storage = (len(hypotheses) // 8) + 1  # bitset of alive hypotheses
    depth = 0

    for _ in range(budget):
        if len(alive) <= 1:
            break
        best_x, best_score = None, float("-inf")
        # Sample 20 candidates, pick the one that most evenly splits alive set
        for _ in range(20):
            x = rng.getrandbits(n_features)
            zeros = sum(1 for h in alive if hash_bit(hypotheses[h], x) == 0)
            ones = len(alive) - zeros
            split_score = -max(zeros, ones)
            if split_score > best_score:
                best_score, best_x = split_score, x
            work += len(alive)

        y = hash_bit(hypotheses[target_idx], best_x)
        transcript.append((best_x, y))
        queries_made += 1
        depth += 1
        alive = {h for h in alive if hash_bit(hypotheses[h], best_x) == y}
        work += len(alive)

    best_idx = next(iter(alive)) if alive else 0
    storage += len(transcript) * 16

    return {
        "best_idx": best_idx,
        "correct": best_idx == target_idx,
        "queries": queries_made,
        "storage_bytes": storage,
        "work_units": work,
        "depth": depth,
        "communication_bits": 0,
        "verification_calls": 0,
    }


def self_test() -> str:
    rng = random.Random(42)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    r = execute_identify(hyps, 7, 12, 16, rng)
    assert r["queries"] <= 16
    # Adaptive should use fewer queries than non-adaptive for same correctness
    assert r["correct"], "adaptivity should identify correctly"
    return "adaptivity OK"


if __name__ == "__main__":
    print(self_test())
