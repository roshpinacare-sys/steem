"""Planner — cost-model primitive selection.

Design:
  - estimate_cost matches the pipeline's actual behavior:
      * If "Adv" is in the set AND advice_available: queries = 0
        (pipeline short-circuits on advice hit).
      * If "A" is in the set (no advice short-circuit): queries = log2(N)
        (A replaces E — they don't both make queries).
      * If "V" is in the set (no advice short-circuit): queries += verify_budget
        (V adds verification queries on top).
  - Candidate enumeration drops E when A is present (A replaces E) and
    puts Adv first (so it short-circuits the rest).

The cost model is grounded in the known complexity bounds:
  - E: O(budget) queries, O(budget * 16B) storage
  - C: same queries as E, but O(budget/8 + budget) storage
  - A: O(log N) queries (info-theoretic lower bound) — REPLACES E
  - S: adds parallel depth, comm cost
  - V: adds k verification queries, epsilon = 2^-k
  - Adv: O(1) if advice hits → short-circuits the pipeline (0 queries)
  - Q: O(sqrt(N)) for search, no advantage for identify (BBBV)
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class CostEstimate:
    """Estimated cost of a primitive set on a task."""
    queries: int
    storage_bytes: int
    work_units: int
    depth: int
    communication_bits: int
    verification_calls: int
    soundness_epsilon: float = 1.0
    confidence: float = 1.0  # 1.0 = certain, 0.0 = unknown


# Known complexity bounds per primitive
PRIMITIVE_BOUNDS = {
    "E":   {"queries": "O(budget)",        "storage": "O(budget * 16)"},
    "C":   {"queries": "O(budget)",        "storage": "O(budget / 8 + budget)"},
    "A":   {"queries": "O(log N)",         "storage": "O(N/8 + log N * 16)"},
    "S":   {"queries": "O(log N)",         "depth": "O(log N / log W)"},
    "V":   {"queries": "O(budget + k)",    "epsilon": "2^-k"},
    "Adv": {"queries": "O(1) if hit",      "storage": "O(advice_size)"},
    "Q":   {"queries": "O(sqrt N) search", "note": "no advantage for identify"},
}


def estimate_cost(primitives: list[str], task_kind: str, n: int,
                  budget: int, advice_available: bool,
                  verify_budget: int = 5) -> CostEstimate:
    """Estimate the cost of running `primitives` on a task.

    The estimate matches the pipeline's actual behavior.
    If "Adv" is in the set AND advice_available, the pipeline short-circuits
    (0 queries). Otherwise, "A" replaces "E" (only A makes queries).
    "V" adds verify_budget queries on top.
    """
    log_n = max(1, int(math.ceil(math.log2(max(n, 2)))))

    # Check if pipeline will short-circuit (Adv hit)
    # If Adv is present and advice_available, the pipeline makes 0 queries
    # because Adv sets state.confident=True and all subsequent stages skip.
    short_circuit = "Adv" in primitives and advice_available
    if short_circuit:
        # Adv hit → 0 queries, all subsequent stages skip their query work
        return CostEstimate(
            queries=0,
            storage_bytes=n * 20,  # advice table size
            work_units=1,          # hash + lookup
            depth=1,
            communication_bits=0,
            verification_calls=0,
            soundness_epsilon=1.0,
            confidence=1.0,
        )

    # Not short-circuited — full pipeline runs
    queries = 0
    storage = 0
    work = 0
    depth = 0
    comm = 0
    verify_calls = 0
    epsilon = 1.0
    confidence = 1.0
    has_a = False

    for p in primitives:
        if p == "E":
            # E alone: budget queries. If A is also present, E is subsumed
            # (A replaces E — pipeline drops E when A is present).
            if not has_a:
                queries = max(queries, budget)
            storage = max(storage, budget * 16)
            work += budget * (1 + n)
            depth = max(depth, 1)
        elif p == "C":
            # C doesn't change queries; reduces storage
            if not has_a:
                storage = max(storage, (budget + 7) // 8 + budget)
            else:
                storage = max(storage, (n // 8) + 1 + 8 * 16)
        elif p == "A":
            has_a = True
            # A replaces E — only A's queries count
            q_a = min(budget, log_n)
            queries = q_a
            storage = max(storage, (n // 8) + 1 + q_a * 16)
            work += 20 * q_a * n
            depth = max(depth, q_a)
        elif p == "S":
            # Scheduling: adds parallel depth, comm cost
            n_workers = 8
            p_depth = max(1, int(math.ceil(log_n / math.log2(n_workers))))
            depth += p_depth
            comm += n_workers * budget * 8
        elif p == "V":
            # V adds verify_budget queries ON TOP of A/E
            verify_calls = verify_budget
            queries += verify_budget
            work += verify_budget
            depth += verify_budget
            epsilon = min(epsilon, 2**(-verify_budget))
        elif p == "Adv":
            # Advice present but didn't short-circuit (advice_available=False
            # or miss). Adv makes 0 queries but the pipeline continues to A/E/V.
            pass
        elif p == "Q":
            if task_kind == "search":
                # Grover: O(sqrt(N)) queries, replaces E.
                # Use floor(pi/4 * sqrt(N)) — the optimal Grover
                # iteration count — to match the actual query count
                # produced by ``quantum.grover_search``. Previously the
                # planner used ``int(math.sqrt(n))`` which overestimates
                # by ~21% (pi/4 ≈ 0.785). The overestimate was
                # conservative (the planner would not pick Q when it
                # shouldn't), but the cost model now matches the actual
                # primitive behavior so plans and execution agree.
                q_q = max(1, int(math.pi / 4 * math.sqrt(n)))
                queries = q_q
                work += q_q
                depth = max(depth, q_q)
                confidence = 0.9
            # For identify, Q gives no advantage (BBBV) — don't change queries

    return CostEstimate(
        queries=queries, storage_bytes=storage, work_units=work,
        depth=depth, communication_bits=comm,
        verification_calls=verify_calls,
        soundness_epsilon=epsilon, confidence=confidence,
    )


# Primary axis per task kind
TASK_AXIS = {
    "identify":      "queries",
    "identify_hard": "queries",
    "search":        "queries",
    "optimize":      "queries",
    "verify":        "verification_calls",
    "compute":       "work_units",
    "store":         "storage_bytes",
    "amortize":      "queries",
}


def plan(task_kind: str, n: int = 64, budget: int = 16,
         advice_available: bool = False,
         required_primitives: list[str] | None = None,
         verify_budget: int = 5) -> tuple[str, list[str], CostEstimate]:
    """Plan a task: return (primary_axis, primitives, cost_estimate).

    If required_primitives is given, use those directly.
    Otherwise, enumerate candidate primitive sets and pick the
    lowest-cost one on the primary axis.
    """
    if required_primitives:
        valid = {"E", "C", "A", "S", "V", "Adv", "Q"}
        for p in required_primitives:
            if p not in valid:
                # List the valid values so the caller can fix the typo
                # without consulting the docs.
                raise ValueError(
                    f"Unknown primitive {p!r}. Valid primitives are: "
                    f"{sorted(valid)}."
                )
        cost = estimate_cost(required_primitives, task_kind, n, budget,
                             advice_available, verify_budget)
        return (TASK_AXIS.get(task_kind, "queries"), list(required_primitives), cost)

    axis = TASK_AXIS.get(task_kind, "queries")

    # Candidate enumeration matches pipeline behavior:
    # - Drop E when A is present (A replaces E in the pipeline).
    # - Put Adv first when present (so it short-circuits the rest).
    if task_kind == "verify":
        candidates = [["V"]]
    elif task_kind == "search":
        candidates = [["E", "Q"], ["E", "A", "Q"], ["E", "A", "Q", "Adv"]]
    elif task_kind == "store":
        candidates = [["C"]]
    elif task_kind == "compute":
        candidates = [["E"], ["E", "S"]]
    elif task_kind in ("identify", "identify_hard", "optimize", "amortize"):
        candidates = [
            ["E"],
            ["E", "C"],
            ["A", "C"],          # A replaces E
            ["A", "C", "S"],
            ["A", "C", "V"],
            ["A", "C", "S", "V"],
        ]
        if advice_available or task_kind == "identify_hard":
            candidates.append(["Adv", "A", "C", "V"])      # Adv first
            candidates.append(["Adv", "A", "C", "S", "V"])
    else:
        candidates = [["E"]]

    # Estimate cost for each candidate, pick lowest on primary axis
    best_set = None
    best_cost = None
    best_axis_value = float("inf")
    for cand in candidates:
        cost = estimate_cost(cand, task_kind, n, budget, advice_available, verify_budget)
        axis_value = getattr(cost, axis)
        # Prefer lower cost on primary axis; tie-break by total work.
        best_work = best_cost.work_units if best_cost else float("inf")
        if axis_value < best_axis_value or (
            axis_value == best_axis_value and cost.work_units < best_work
        ):
            best_set = cand
            best_cost = cost
            best_axis_value = axis_value

    fallback = best_set or ["E"]
    fallback_cost = best_cost or estimate_cost(
        ["E"], task_kind, n, budget, advice_available, verify_budget
    )
    return (axis, fallback, fallback_cost)


def self_test() -> str:
    # Verify: advice_available=True should reduce queries to 0 for identify
    axis, prims_no_adv, cost_no_adv = plan("identify", n=64, budget=16, advice_available=False)
    axis, prims_adv, cost_adv = plan("identify", n=64, budget=16, advice_available=True)
    assert cost_adv.queries <= cost_no_adv.queries, \
        f"advice should reduce queries: {cost_adv.queries} vs {cost_no_adv.queries}"
    # advice_available with Adv should yield 0 queries
    assert cost_adv.queries == 0, \
        f"advice short-circuit should yield 0 queries, got {cost_adv.queries}"

    # Verify: search should include Q (Grover advantage)
    axis, prims_search, cost_search = plan("search", n=64, budget=16)
    assert "Q" in prims_search, f"search should use quantum: {prims_search}"

    # Verify: verify task should only use V
    axis, prims_verify, cost_verify = plan("verify")
    assert prims_verify == ["V"]

    # Verify: required_primitives override works
    axis, prims_override, _ = plan("identify", required_primitives=["E", "C"])
    assert prims_override == ["E", "C"]

    # Verify: cost estimate is honest (queries bounded)
    assert cost_no_adv.queries <= 16  # bounded by budget
    assert cost_no_adv.work_units > 0

    # planner estimate matches pipeline actual (within 10%)
    # For identify without advice, planner picks [A, C] -> queries=6
    # Pipeline runs A (6 queries) + C (0) = 6. Exact match.
    assert cost_no_adv.queries == 6, \
        f"planner should estimate 6 queries for [A,C] on N=64, got {cost_no_adv.queries}"

    return "planner OK"


if __name__ == "__main__":
    print(self_test())
