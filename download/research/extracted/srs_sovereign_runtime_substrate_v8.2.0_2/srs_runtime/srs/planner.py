"""Planner — selects primitives for a task.

The planner uses the v6.46 7-primitive taxonomy as a decision tree.
For each task kind, it picks the appropriate primitives based on
the resource axis that matters most.
"""
from __future__ import annotations
from typing import List, Tuple


# Mapping: task_kind -> (primary_axis, recommended_primitives)
TASK_PLAN = {
    "identify":        ("queries",     ["E", "C", "A", "V", "Adv"]),
    "identify_hard":   ("queries",     ["E", "C", "A", "V", "Adv"]),
    "search":          ("queries",     ["E", "A", "Q", "Adv"]),     # Grover
    "optimize":        ("queries",     ["E", "C", "A", "Adv"]),
    "verify":          ("verify",      ["V"]),
    "compute":         ("time",        ["E", "S"]),
    "store":           ("storage",     ["C"]),
    "amortize":        ("amortization",["E", "C", "Adv"]),
}


def plan(task_kind: str, required_primitives=None) -> Tuple[str, List[str]]:
    """Return (primary_axis, primitives) for a task kind.

    If required_primitives is given, use those directly (override).
    """
    if required_primitives:
        # Validate
        valid = {"E", "C", "A", "S", "V", "Adv", "Q"}
        for p in required_primitives:
            if p not in valid:
                raise ValueError(f"Unknown primitive: {p}")
        return ("override", list(required_primitives))

    if task_kind not in TASK_PLAN:
        # Default: execution only
        return ("time", ["E"])
    return TASK_PLAN[task_kind]


def self_test() -> str:
    axis, prims = plan("identify")
    assert axis == "queries"
    assert "A" in prims and "V" in prims
    axis, prims = plan("identify_hard")
    assert "Adv" in prims
    axis, prims = plan("search")
    assert "Q" in prims
    axis, prims = plan("verify")
    assert prims == ["V"]
    # Override
    axis, prims = plan("anything", required_primitives=["E", "C"])
    assert prims == ["E", "C"]
    return "planner OK"


if __name__ == "__main__":
    print(self_test())
