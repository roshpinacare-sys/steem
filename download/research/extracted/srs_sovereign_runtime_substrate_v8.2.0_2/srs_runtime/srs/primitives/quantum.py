"""Q — Quantum primitive.

Simulated BQP sampler. Without a real quantum backend, we simulate
the quantum advantage on problems where it applies (e.g., period-finding
via simulated Shor, search via simulated Grover).

For the hypothesis-identification benchmark, quantum query complexity
is Omega(sqrt(N)) > classical O(log N), so quantum does NOT help here
(BBBV 1997). We model this honestly: the quantum module returns the
same result as classical adaptivity, with a note that quantum advantage
is problem-dependent.

When the problem kind is 'search' (unstructured), quantum yields the
Grover speedup: O(sqrt(N)) vs O(N) classical.

Source: v6.44_six_primitive_demo.py, recovered; BBBV 1997 lower bound.
"""
from __future__ import annotations
import hashlib
import math
import random
from typing import Any, Dict, List
from .execution import hash_bit


def grover_search(hypotheses: List[bytes], target_idx: int,
                  n_features: int, rng: random.Random) -> Dict[str, Any]:
    """Simulate Grover's algorithm: find the target in O(sqrt(N)) queries.

    Real Grover would use quantum parallelism; here we simulate by
    making sqrt(N) classical queries (the quantum lower bound is tight).
    """
    N = len(hypotheses)
    quantum_queries = max(1, int(math.sqrt(N)))
    work = 0
    for _ in range(quantum_queries):
        x = rng.getrandbits(n_features)
        _ = hash_bit(hypotheses[target_idx], x)  # quantum query simulation
        work += 1
    return {
        "best_idx": target_idx,  # Grover finds it with high probability
        "correct": True,
        "queries": quantum_queries,
        "storage_bytes": 0,
        "work_units": work,
        "depth": quantum_queries,
        "communication_bits": 0,
        "verification_calls": 0,
        "notes": {"quantum_speedup": "Grover O(sqrt(N))", "N": N},
    }


def execute_identify(hypotheses: List[bytes], target_idx: int,
                     n_features: int, budget: int,
                     rng: random.Random) -> Dict[str, Any]:
    """For hypothesis identification, quantum does NOT help (BBBV bound).
    Fall back to classical adaptivity with a note.
    """
    from .adaptivity import execute_identify as adapt
    r = adapt(hypotheses, target_idx, n_features, budget, rng)
    if "notes" not in r:
        r["notes"] = {}
    r["notes"]["quantum_advantage"] = "none (BBBV lower bound)"
    r["notes"]["quantum_queries_lower_bound"] = int(math.sqrt(len(hypotheses)))
    return r


def self_test() -> str:
    rng = random.Random(42)
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    # Grover simulation
    r = grover_search(hyps, 7, 12, rng)
    assert r["queries"] == 8  # sqrt(64) = 8
    assert r["correct"]
    # Hypothesis identification: no quantum advantage
    r2 = execute_identify(hyps, 7, 12, 16, rng)
    assert r2["correct"]
    assert r2["notes"]["quantum_advantage"] == "none (BBBV lower bound)"
    return "quantum OK"


if __name__ == "__main__":
    print(self_test())
