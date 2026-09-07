"""Shared algorithm primitives used across SRS pipeline stages.

This package extracts algorithms that were previously copy-pasted
across `srs/primitives/adaptivity.py`, `srs/primitives/scheduling.py`,
and `srs/pipeline.py`. Centralizing them removes duplication and
gives a single place to fix correctness bugs.
"""
from .alive_set import best_split_query, prune_alive

__all__ = ["best_split_query", "prune_alive"]
