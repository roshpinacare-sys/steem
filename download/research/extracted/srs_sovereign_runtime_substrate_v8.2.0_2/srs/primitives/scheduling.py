"""S — Scheduling primitive.

Parallel hypothesis pruning across workers. Mirrors v6.42
algorithm_with_scheduling: query chosen sequentially (depth = budget),
but hypothesis pruning is parallel (depth ~ log(|alive|)/log(n_workers)).

Source: v6.42_closure_demo.py:algorithm_with_scheduling, recovered.
"""
from __future__ import annotations

import hashlib
import logging
import math
import random
from typing import Any

from ..algorithms.alive_set import best_split_query, prune_alive
from .execution import hash_bit

logger = logging.getLogger("srs.primitives.scheduling")


def execute_identify(hypotheses: list[bytes], target_idx: int,
                     n_features: int, budget: int,
                     rng: random.Random,
                     n_workers: int = 8) -> dict[str, Any]:
    alive: set[int] = set(range(len(hypotheses)))
    queries_made = 0
    work = 0
    depth = 0
    storage = (len(hypotheses) // 8) + 1
    transcript: list[tuple[int, int]] = []
    communication = 0
    logger.debug("S: starting identify N=%d target=%d budget=%d n_workers=%d",
                 len(hypotheses), target_idx, budget, n_workers)

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
        depth += 1  # sequential query

        # Parallel pruning
        n_to_prune = len(alive)
        parallel_depth = max(1, math.ceil(math.log2(max(n_to_prune, 2)) / math.log2(n_workers)))
        depth += parallel_depth
        alive = prune_alive(hypotheses, alive, best_x, y)
        work += len(alive)
        communication += n_workers * 8  # broadcast query to workers

    best_idx = next(iter(alive)) if alive else 0
    storage += len(transcript) * 16
    logger.debug("S: complete best_idx=%d correct=%s queries=%d depth=%d "
                 "comm=%d", best_idx, best_idx == target_idx,
                 queries_made, depth, communication)
    return {
        "best_idx": best_idx,
        "correct": best_idx == target_idx,
        "queries": queries_made,
        "storage_bytes": storage,
        "work_units": work,
        "depth": depth,
        "communication_bits": communication,
        "verification_calls": 0,
    }


def self_test() -> str:
    rng = random.Random(42)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    r = execute_identify(hyps, 7, 12, 16, rng, n_workers=8)
    assert r["correct"]
    # Scheduling adds parallel depth (>= adaptivity's depth)
    assert r["depth"] > 0
    # And communication cost > 0 (broadcast)
    assert r["communication_bits"] > 0
    return "scheduling OK"


if __name__ == "__main__":
    print(self_test())
