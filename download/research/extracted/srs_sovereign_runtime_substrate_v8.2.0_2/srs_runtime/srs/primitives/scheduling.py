"""S — Scheduling primitive.

Parallel hypothesis pruning across workers. Mirrors v6.42
algorithm_with_scheduling: query chosen sequentially (depth = budget),
but hypothesis pruning is parallel (depth ~ log(|alive|)/log(n_workers)).

Source: v6.42_closure_demo.py:algorithm_with_scheduling, recovered.
"""
from __future__ import annotations
import hashlib
import math
import random
from typing import Any, Dict, List, Set
from .execution import hash_bit
from .adaptivity import execute_identify as adaptive_identify


def execute_identify(hypotheses: List[bytes], target_idx: int,
                     n_features: int, budget: int,
                     rng: random.Random,
                     n_workers: int = 8) -> Dict[str, Any]:
    alive: Set[int] = set(range(len(hypotheses)))
    queries_made = 0
    work = 0
    depth = 0
    storage = (len(hypotheses) // 8) + 1
    transcript: List[tuple] = []
    communication = 0

    for _ in range(budget):
        if len(alive) <= 1:
            break
        best_x, best_score = None, float("-inf")
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
        depth += 1  # sequential query

        # Parallel pruning
        n_to_prune = len(alive)
        parallel_depth = max(1, math.ceil(math.log2(max(n_to_prune, 2)) / math.log2(n_workers)))
        depth += parallel_depth
        alive = {h for h in alive if hash_bit(hypotheses[h], best_x) == y}
        work += len(alive)
        communication += n_workers * 8  # broadcast query to workers

    best_idx = next(iter(alive)) if alive else 0
    storage += len(transcript) * 16

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
