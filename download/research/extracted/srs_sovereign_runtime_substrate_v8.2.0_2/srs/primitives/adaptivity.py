"""A — Adaptivity primitive.

Information-gain greedy query selection. Mirrors v6.42
algorithm_with_adaptivity: at each step, pick input x that best
splits the surviving hypothesis set.

Source: v6.42_closure_demo.py:algorithm_with_adaptivity, recovered.
"""
from __future__ import annotations

import hashlib
import logging
import random
from typing import Any

from ..algorithms.alive_set import best_split_query, prune_alive
from .execution import hash_bit

logger = logging.getLogger("srs.primitives.adaptivity")


def execute_identify(hypotheses: list[bytes], target_idx: int,
                     n_features: int, budget: int,
                     rng: random.Random) -> dict[str, Any]:
    alive: set[int] = set(range(len(hypotheses)))
    queries_made = 0
    work = 0
    transcript: list[tuple[int, int]] = []
    storage = (len(hypotheses) // 8) + 1  # bitset of alive hypotheses
    depth = 0
    logger.debug("A: starting identify N=%d target=%d budget=%d",
                 len(hypotheses), target_idx, budget)

    for _ in range(budget):
        if len(alive) <= 1:
            break
        # Pick the input that most evenly splits the alive set (20 candidates).
        best_x, _score = best_split_query(hypotheses, alive, n_features, rng)
        work += 20 * len(alive)
        if best_x is None:
            break
        y = hash_bit(hypotheses[target_idx], best_x)
        transcript.append((best_x, y))
        queries_made += 1
        depth += 1
        alive = prune_alive(hypotheses, alive, best_x, y)
        work += len(alive)

    best_idx = next(iter(alive)) if alive else 0
    storage += len(transcript) * 16
    logger.debug("A: complete best_idx=%d correct=%s queries=%d work=%d "
                 "alive=%d", best_idx, best_idx == target_idx,
                 queries_made, work, len(alive))
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
