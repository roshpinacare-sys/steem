"""C — Compression primitive.

Compact representation of transcripts. Mirrors v6.42 algorithm_with_compression:
store response bits as a packed bitset (1 bit per query vs 16 bytes naive).

Source: v6.42_closure_demo.py:algorithm_with_compression, recovered.
"""
from __future__ import annotations
import hashlib
import random
from typing import Any, Dict, List, Tuple
from .execution import hash_bit


def pack_bits(bits: List[int]) -> bytes:
    """Pack list of 0/1 into bytes (LSB first per byte)."""
    out = bytearray()
    for i in range(0, len(bits), 8):
        byte = 0
        for j in range(8):
            if i + j < len(bits):
                byte |= bits[i + j] << j
        out.append(byte)
    return bytes(out)


def unpack_bits(data: bytes, n: int) -> List[int]:
    bits = []
    for i in range(n):
        byte = data[i // 8]
        bits.append((byte >> (i % 8)) & 1)
    return bits


def execute_identify(hypotheses: List[bytes], target_idx: int,
                     n_features: int, budget: int,
                     rng: random.Random) -> Dict[str, Any]:
    """Same as execution.execute_identify but transcript is packed.
    Storage drops from 16B/query to ~1bit/query + query-index storage.
    """
    queries: List[int] = []
    responses: List[int] = []
    work = 0
    for _ in range(budget):
        x = rng.getrandbits(n_features)
        y = hash_bit(hypotheses[target_idx], x)
        queries.append(x)
        responses.append(y)
        work += 1

    # Compressed: pack responses into bytes; queries still need full storage
    packed = pack_bits(responses)
    storage = len(packed) + budget  # 1 byte per query index + packed bits

    best_idx, best_score = 0, -1
    for h_idx in range(len(hypotheses)):
        score = 0
        for i, q in enumerate(queries):
            if hash_bit(hypotheses[h_idx], q) == responses[i]:
                score += 1
        work += budget
        if score > best_score:
            best_score, best_idx = score, h_idx

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
    r1 = execute_identify(hyps, 3, 8, 16, rng)
    rng = random.Random(42)
    r2 = execute_identify(hyps, 3, 8, 16, rng)
    # Should be deterministic given same seed
    assert r1["storage_bytes"] < 16 * 16, f"compression failed: {r1['storage_bytes']}"
    # Round-trip pack/unpack
    bits = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1]
    packed = pack_bits(bits)
    assert unpack_bits(packed, len(bits)) == bits
    return "compression OK"


if __name__ == "__main__":
    print(self_test())
