"""E — Execution primitive.

Baseline task runner. No asymptotic advantage; sets the floor that
other primitives improve upon. Closely mirrors v6.42 algorithm_baseline:
non-adaptive random queries with majority-vote scoring.

Source: v6.42_closure_demo.py:algorithm_baseline, recovered.
"""
from __future__ import annotations

import hashlib
import logging
import random
from typing import Any

logger = logging.getLogger("srs.primitives.execution")


def hash_bit(seed: bytes, x: int) -> int:
    h = hashlib.sha256(seed + x.to_bytes(8, "big")).digest()
    return h[0] & 1


def execute_identify(hypotheses: list[bytes], target_idx: int,
                     n_features: int, budget: int,
                     rng: random.Random) -> dict[str, Any]:
    queries: list[tuple[int, int]] = []
    storage = budget * 16
    work = 0
    logger.debug("E: starting identify N=%d target=%d budget=%d "
                 "n_features=%d", len(hypotheses), target_idx, budget,
                 n_features)
    for _ in range(budget):
        x = rng.getrandbits(n_features)
        y = hash_bit(hypotheses[target_idx], x)
        queries.append((x, y))
        work += 1

    best_idx, best_score = 0, -1
    for h_idx in range(len(hypotheses)):
        score = sum(1 for q, y in queries if hash_bit(hypotheses[h_idx], q) == y)
        work += budget
        if score > best_score:
            best_score, best_idx = score, h_idx

    logger.debug("E: complete best_idx=%d correct=%s queries=%d work=%d "
                 "storage=%d", best_idx, best_idx == target_idx, budget,
                 work, storage)
    return {
        "best_idx": best_idx,
        "correct": best_idx == target_idx,
        "queries": budget,
        "storage_bytes": storage,
        "work_units": work,
        "depth": 1,
        "communication_bits": 0,
        "verification_calls": 0,
    }


def self_test() -> str:
    rng = random.Random(42)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(8)]
    r = execute_identify(hyps, 3, 8, 16, rng)
    assert r["queries"] == 16
    assert r["work_units"] > 0
    return "execution OK"


if __name__ == "__main__":
    print(self_test())
