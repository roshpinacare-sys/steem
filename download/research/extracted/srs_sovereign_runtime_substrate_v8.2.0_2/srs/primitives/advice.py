"""Adv — Advice primitive (target-aware keying).

Non-uniform polynomial-size advice (P/poly style). For a fixed problem
family, advice is a precomputed lookup table that the runtime consults
in O(1) time. Demonstrates the v6.43 counterexample: advice can decide
problems that {C,A,S,V,E} cannot (e.g., undecidable unary languages
when the advice encodes halting bits).

In this executable form, the advice table is built offline by an
external process (the `build_for_identify` function) and consulted
online by `execute_identify`.

Target-aware keying: the advice key includes target_idx. Previously,
building advice for target=5 then querying for target=7 silently
returned best_idx=5 with correct=False. Now the key is
sha256(hypotheses || target_idx), so different targets get different
advice entries.

Source: v6.43_counterexample.py:problem_with_advice, recovered.
"""
from __future__ import annotations

import hashlib
import logging
import random
import threading
import warnings
from functools import lru_cache
from typing import Any, cast

logger = logging.getLogger("srs.primitives.advice")


class AdviceTable:
    """Precomputed lookup table mapping (task fingerprint, target) to answer.

    Thread-safe: all read/write operations are protected by an internal lock
    to prevent race conditions when multiple threads share the same table
    (which previously raced on bare ``_table`` reads and writes).
    """

    def __init__(self) -> None:
        self._table: dict[str, Any] = {}
        self._lock = threading.Lock()

    @staticmethod
    @lru_cache(maxsize=128)
    def _fingerprint(hypotheses: tuple[bytes, ...]) -> str:
        """Length-prefixed fingerprint of the hypotheses list.

        Uses length-prefix encoding to prevent collision attacks.
        The previous b"|".join approach was vulnerable: if a hypothesis
        byte string contained 0x7c (the pipe character), an attacker
        could split it into two hypotheses that produce the same join.

        Length-prefix encoding: for each hypothesis, write 4-byte length
        followed by the bytes. This is unambiguous and collision-resistant.

        Performance: the result is memoised via
        ``functools.lru_cache`` so repeated lookups for the SAME
        hypotheses list (very common: the runtime calls
        ``advice.lookup(hyps, target_idx)`` once per execute(), and
        the same hyps are also hashed in ``build_for_identify`` and
        ``lookup_any_target``) skip the SHA-256 + struct.pack loop.
        The cache key is a ``tuple`` (hashable) rather than a ``list``
        (unhashable); callers convert via ``tuple(hypotheses)`` before
        invoking this method. Cache size is bounded at 128 entries —
        enough to cover the realistic working set (one entry per
        distinct (hypotheses, target) pair in a typical benchmark
        run) without unbounded growth.
        """
        import struct
        parts = []
        for h in hypotheses:
            parts.append(struct.pack(">I", len(h)))
            parts.append(h)
        return hashlib.sha256(b"".join(parts)).hexdigest()[:16]

    def _key(self, hypotheses: list[bytes], target_idx: int) -> str:
        """Key includes target_idx to prevent cross-target poisoning."""
        # Convert list -> tuple so _fingerprint's lru_cache can hash it.
        h_hash = self._fingerprint(tuple(hypotheses))
        return f"{h_hash}:{target_idx}"

    def build_for_identify(self, hypotheses: list[bytes], target_idx: int) -> None:
        """Precompute the answer for the (hypotheses, target) pair.

        The key includes target_idx. Different targets for the same
        hypotheses set get separate advice entries.
        """
        self.add(hypotheses, target_idx)

    def add(self, hypotheses: list[bytes], target_idx: int) -> bool:
        """Add an advice entry. Returns True if new, False if already present.

        Public API so callers (e.g. self-improvement) can seed the table
        without reaching into the private ``_table`` dict. The check-then-set
        is performed atomically under ``_lock`` so concurrent callers cannot
        race and double-insert.
        """
        key = self._key(hypotheses, target_idx)
        with self._lock:
            if key in self._table:
                return False
            self._table[key] = target_idx
            return True

    def lookup(self, hypotheses: list[bytes], target_idx: int) -> int | None:
        """Look up advice for the (hypotheses, target) pair.

        Requires target_idx. Returns None if no advice for this specific
        (hypotheses, target) pair.
        """
        key = self._key(hypotheses, target_idx)
        with self._lock:
            return self._table.get(key)

    def lookup_any_target(self, hypotheses: list[bytes]) -> int | None:
        """Legacy lookup: returns advice for ANY target with these hypotheses.

        .. deprecated::
            This method is unsafe — it can return advice built for a
            different target_idx, which silently produces wrong answers
            when the caller assumes the cached value applies to their
            target. Use :meth:`lookup` (which takes ``target_idx``)
            instead. The deprecation warning surfaces at call time so
            existing callers learn about the migration path.
        """
        warnings.warn(
            "lookup_any_target is unsafe and deprecated; "
            "use lookup(hypotheses, target_idx) instead",
            DeprecationWarning,
            stacklevel=2,
        )
        # Convert list -> tuple so _fingerprint's lru_cache can hash it.
        h_hash = self._fingerprint(tuple(hypotheses))
        with self._lock:
            for key, val in list(self._table.items()):
                if key.startswith(f"{h_hash}:"):
                    return cast(int, val)
        return None

    def __len__(self) -> int:
        """Number of advice entries (public, lock-protected).

        Replaces ``len(advice._table)`` calls scattered across the runtime
        and CLI. Locking makes the count safe under concurrent ``add`` /
        ``build_for_identify`` calls.
        """
        with self._lock:
            return len(self._table)

    def __bool__(self) -> bool:
        """True iff at least one advice entry exists.

        Replaces ``bool(advice._table)`` so the planner / CLI can check
        "advice available?" without touching the private dict.
        """
        with self._lock:
            return bool(self._table)

    def size_bytes(self) -> int:
        with self._lock:
            return len(self._table) * 28

    def to_dict(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._table)

    @classmethod
    def from_dict(cls, d: Any) -> AdviceTable:
        """Validate and construct an AdviceTable from a dict.

        The previous implementation was ``t._table = dict(d)`` with no
        validation, so a tampered or corrupt snapshot could inject
        arbitrary values (huge ints, strings, lists, None) as the
        "answer" returned by ``lookup``. Combined with the
        (now-fixed) HMAC bypass via plain SHA-256, an attacker with
        filesystem write access could make ``execute_identify`` return
        any value as the cached answer with ``advice_hit=True`` and
        ``queries=0``.

        Validation rules:
          - ``d`` must be a ``dict`` (rejects str / list / None / etc).
          - Each key must be a ``str`` (JSON object keys are always str,
            but a hand-constructed dict could have int/float keys that
            ``dict(d)`` would silently accept — and that would later
            break the ``f"{h_hash}:{target_idx}"`` lookup).
          - Each value must be a non-negative ``int`` (advice values
            are hypothesis indices, so a negative or non-int value is
            either corruption or an attack).
          - Booleans are explicitly rejected: ``isinstance(True, int)``
            is True in Python, but ``True`` as an "answer index" is a
            sign of corruption.

        Raises ``ValueError`` on any violation. The caller (typically
        ``Snapshot.from_dict`` → ``load_latest``) catches the exception
        and discards the advice rather than propagating it, so a
        corrupt advice table degrades gracefully to "no advice" instead
        of crashing the runtime.
        """
        t = cls()
        if not isinstance(d, dict):
            raise ValueError(
                f"AdviceTable.from_dict requires dict, got "
                f"{type(d).__name__}"
            )
        for key, val in d.items():
            if not isinstance(key, str):
                raise ValueError(
                    f"advice key must be str, got {type(key).__name__}"
                )
            # ``bool`` is a subclass of ``int``; reject explicitly so
            # ``True`` / ``False`` don't sneak through as answer indices.
            if isinstance(val, bool) or not isinstance(val, int):
                raise ValueError(
                    f"advice value must be int, got {type(val).__name__}"
                )
            if val < 0:
                raise ValueError(
                    f"advice value must be non-negative, got {val}"
                )
        t._table = dict(d)
        return t


def execute_identify(hypotheses: list[bytes], target_idx: int,
                     n_features: int, budget: int,
                     rng: random.Random,
                     advice: AdviceTable) -> dict[str, Any]:
    """O(1) lookup if advice has the answer; otherwise fall back to
    adaptivity. This is the 6-primitive algorithm (v6.44).

    Lookup is target-aware. Advice built for a
    different target will NOT be returned for this target.
    """
    logger.debug("Adv: looking up target=%d in advice table (size=%d bytes)",
                 target_idx, advice.size_bytes())
    cached = advice.lookup(hypotheses, target_idx)
    if cached is not None:
        logger.debug("Adv: HIT — answer=%d (0 queries)", cached)
        return {
            "best_idx": cached,
            "correct": cached == target_idx,
            "queries": 0,
            "storage_bytes": advice.size_bytes(),
            "work_units": 1,  # hash + lookup
            "depth": 1,
            "communication_bits": 0,
            "verification_calls": 0,
            "notes": {"used_advice": True, "advice_hit": True},
        }
    # Fall back to adaptivity if advice missing
    logger.debug("Adv: MISS — falling back to adaptivity")
    from .adaptivity import execute_identify as adapt
    r = adapt(hypotheses, target_idx, n_features, budget, rng)
    if "notes" not in r:
        r["notes"] = {}
    r["notes"]["used_advice"] = False
    r["notes"]["advice_hit"] = False
    return r


def self_test() -> str:
    hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
    advice = AdviceTable()
    advice.build_for_identify(hyps, 7)
    rng = random.Random(42)
    r = execute_identify(hyps, 7, 12, 16, rng, advice)
    assert r["correct"]
    assert r["queries"] == 0, "advice should yield 0 queries"
    assert r["notes"]["used_advice"] is True
    # Persistence
    d = advice.to_dict()
    advice2 = AdviceTable.from_dict(d)
    assert advice2.lookup(hyps, 7) == 7
    # Advice for target=7 should NOT be returned for target=8
    assert advice2.lookup(hyps, 8) is None, "cross-target advice must be None"
    # Build advice for two different targets on same hypotheses
    advice.build_for_identify(hyps, 8)
    assert advice.lookup(hyps, 7) == 7
    assert advice.lookup(hyps, 8) == 8
    return "advice OK"


if __name__ == "__main__":
    print(self_test())
