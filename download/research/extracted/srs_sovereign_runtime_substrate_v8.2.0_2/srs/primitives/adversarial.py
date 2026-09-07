"""Adversarial benchmark utilities.

The v6.44 5-prim vs 6-prim separation requires hypotheses that are
information-theoretically indistinguishable within the query budget.

The previous "adversarial" benchmark used n_features=4 with SHA-256
hashes. This is NOT adversarial because SHA-256 outputs are wildly
different across inputs, so even with 4-bit inputs the hypotheses
remain perfectly distinguishable.

This module provides a TRULY adversarial construction: hypotheses that
are identical on the first k inputs (so any query within budget
returns the same bit for all of them) but differ afterwards. With
budget <= k, no algorithm can distinguish them.
"""
from __future__ import annotations

import hashlib
import logging

logger = logging.getLogger("srs.primitives.adversarial")


def build_adversarial_hypotheses(n: int, k: int) -> tuple[list[bytes], list[int]]:
    """Build n hypotheses that are identical on the first k inputs.

    Each hypothesis is represented by its truth table prefix (the first
    k bits). All n hypotheses share the same prefix. They differ only
    on bits k+1, k+2, ...

    Returns:
      hypotheses: list of n byte strings (each 32 bytes, derived from
                  a unique seed + the shared prefix)
      shared_prefix: list of k bits that all hypotheses agree on

    With budget <= k queries, no algorithm can distinguish these
    hypotheses because every query within budget returns the same
    answer for all of them.
    """
    logger.debug("building %d adversarial hypotheses (k=%d)", n, k)
    # Shared prefix: all hypotheses agree on the first k inputs
    rng_prefix = hashlib.sha256(b"adversarial_prefix_seed").digest()
    shared_prefix = [(rng_prefix[i // 8] >> (i % 8)) & 1 for i in range(k)]

    # Each hypothesis is identified by a unique seed, but its response
    # on the first k inputs is forced to equal shared_prefix.
    # On inputs > k, the response is determined by hash(seed, input).
    hypotheses = []
    for i in range(n):
        seed = hashlib.sha256(f"adv_hyp_{i}".encode()).digest()
        # Encode as: first 32 bytes = seed (used for inputs > k)
        # The first k inputs are forced to shared_prefix via the query function.
        hypotheses.append(seed)
    logger.debug("built %d hypotheses with shared prefix of %d bits", n, k)
    return hypotheses, shared_prefix


def adversarial_hash_bit(hypothesis_seed: bytes, x: int, k: int,
                          shared_prefix: list[int]) -> int:
    """Query function for adversarial hypotheses.

    For x < k: return shared_prefix[x] (all hypotheses agree)
    For x >= k: return hash(seed, x) & 1 (hypotheses differ)
    """
    if x < k:
        return shared_prefix[x]
    h = hashlib.sha256(hypothesis_seed + x.to_bytes(8, "big")).digest()
    return h[0] & 1


def is_truly_adversarial(hypotheses: list[bytes], shared_prefix: list[int],
                          k: int, n_features: int) -> bool:
    """Verify that the hypotheses are truly indistinguishable within
    k queries. Check that all hypotheses agree on inputs 0..k-1.
    """
    for x in range(k):
        responses = {adversarial_hash_bit(h, x, k, shared_prefix) for h in hypotheses}
        if len(responses) > 1:
            return False
    return True


def self_test() -> str:
    """Verify the adversarial construction is actually adversarial."""
    # Build 64 hypotheses that agree on first 20 inputs
    hyps, prefix = build_adversarial_hypotheses(64, 20)
    assert len(hyps) == 64
    assert len(prefix) == 20
    # Verify they are truly indistinguishable within 20 queries
    assert is_truly_adversarial(hyps, prefix, 20, 12), \
        "hypotheses should be indistinguishable within 20 queries"
    # Verify they ARE distinguishable beyond 20 queries (find a distinguishing input)
    found_distinct = False
    for x in range(20, 100):
        responses = {adversarial_hash_bit(h, x, 20, prefix) for h in hyps}
        if len(responses) > 1:
            found_distinct = True
            break
    assert found_distinct, "hypotheses should differ on some input >= k"
    return "adversarial OK"


if __name__ == "__main__":
    print(self_test())
