"""Shared alive-set pruning algorithm.

Used by adaptivity, scheduling, and pipeline stages to factor out the
"sample 20 candidate inputs, pick the most evenly-splitting one, then
prune the alive set" loop that was previously copy-pasted across three
files. Centralizing the algorithm means a future change to the
selection logic only touches one place.

Both functions are pure: they neither mutate their inputs nor rely on
any module-level state, which keeps the call sites easy to reason about.
"""
from __future__ import annotations

import random

from ..primitives.execution import hash_bit


def best_split_query(
    hypotheses: list[bytes],
    alive: set[int],
    n_features: int,
    rng: random.Random,
    n_candidates: int = 20,
) -> tuple[int | None, float]:
    """Find the input x that most evenly splits the alive set.

    Samples ``n_candidates`` random inputs and returns the one whose
    response partition is most balanced (i.e. minimizes the larger
    side). The returned score is ``-max(zeros, ones)`` — higher is
    better, and ``0`` indicates a perfectly even split.

    Returns ``(None, -inf)`` when ``alive`` is empty (so callers can
    treat the result uniformly without a separate empty-set check).
    """
    if not alive:
        return None, float("-inf")
    best_x: int | None = None
    best_score = float("-inf")
    for _ in range(n_candidates):
        x = rng.getrandbits(n_features)
        zeros = sum(1 for h in alive if hash_bit(hypotheses[h], x) == 0)
        ones = len(alive) - zeros
        split_score = -max(zeros, ones)
        if split_score > best_score:
            best_score = split_score
            best_x = x
    return best_x, best_score


def prune_alive(
    hypotheses: list[bytes],
    alive: set[int],
    query_x: int,
    response_y: int,
) -> set[int]:
    """Return the subset of ``alive`` whose response on ``query_x`` matches ``response_y``.

    Pure: returns a fresh set; the caller's ``alive`` is not mutated.
    """
    return {h for h in alive if hash_bit(hypotheses[h], query_x) == response_y}
