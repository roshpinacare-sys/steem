"""Direct unit tests for governance/bls_signatures.py.

The existing tests/test_property.py exercises the happy path via
hypothesis. This file targets the under-covered branches identified by
`scripts/run_coverage.py`:

  - aggregate([]) returns b""
  - aggregate_verify with empty / mismatched-length inputs returns False
  - verify_pop rejects a tampered PoP
  - aggregate_evidence_binding + verify_aggregate_evidence_binding round-trip
  - tampered witness hash / tampered assurance list are rejected by aggregate verify
  - generate_keypair with no seed (random path) still produces a validatable key
"""
from __future__ import annotations

import os
import pytest

from governance.bls_signatures import (
    BLSKeyPair,
    aggregate,
    aggregate_evidence_binding,
    aggregate_verify,
    evidence_binding_sign,
    evidence_binding_verify,
    generate_keypair,
    sign,
    verify,
    verify_aggregate_evidence_binding,
    verify_pop,
    _binding_message,
)


# ---------------------------------------------------------------------------
# Key generation paths
# ---------------------------------------------------------------------------

def test_generate_keypair_random_seed_produces_valid_pair():
    """No seed → os.urandom path → still PoP-verifiable."""
    kp = generate_keypair()  # no seed
    assert verify_pop(kp), "random-key PoP must verify"
    assert kp.private_key != 0


def test_generate_keypair_deterministic_seed_is_reproducible():
    kp1 = generate_keypair("validator-X")
    kp2 = generate_keypair("validator-X")
    assert kp1.private_key == kp2.private_key
    assert kp1.public_key == kp2.public_key


def test_generate_keypair_distinct_seeds_distinct_keys():
    kp1 = generate_keypair("a")
    kp2 = generate_keypair("b")
    assert kp1.private_key != kp2.private_key


# ---------------------------------------------------------------------------
# Aggregate edge cases
# ---------------------------------------------------------------------------

def test_aggregate_empty_returns_empty_bytes():
    assert aggregate([]) == b""


def test_aggregate_verify_rejects_empty_public_keys():
    sig = sign(generate_keypair("s").private_key, "msg")
    assert aggregate_verify([], ["msg"], sig) is False


def test_aggregate_verify_rejects_empty_messages():
    kp = generate_keypair("s")
    sig = sign(kp.private_key, "msg")
    assert aggregate_verify([kp.public_key], [], sig) is False


def test_aggregate_verify_rejects_empty_signature():
    kp = generate_keypair("s")
    assert aggregate_verify([kp.public_key], ["msg"], b"") is False


def test_aggregate_verify_rejects_mismatched_lengths():
    kp1 = generate_keypair("a")
    kp2 = generate_keypair("b")
    sig1 = sign(kp1.private_key, "m1")
    sig2 = sign(kp2.private_key, "m2")
    agg = aggregate([sig1, sig2])
    # 2 keys, 1 message — must reject without invoking the pairing check
    assert aggregate_verify([kp1.public_key, kp2.public_key], ["m1"], agg) is False


# ---------------------------------------------------------------------------
# PoP tampering
# ---------------------------------------------------------------------------

def test_verify_pop_rejects_tampered_pop():
    """Mutating any byte of the PoP must cause PopVerify to fail."""
    kp = generate_keypair("validator-pop")
    assert verify_pop(kp), "original PoP must verify"

    bad_pop = bytearray(kp.pop)
    bad_pop[0] ^= 0x01
    tampered = BLSKeyPair(
        private_key=kp.private_key,
        public_key=kp.public_key,
        pop=bytes(bad_pop),
    )
    assert verify_pop(tampered) is False


# ---------------------------------------------------------------------------
# Evidence-binding: direct round-trip + tamper detection
# ---------------------------------------------------------------------------

def test_evidence_binding_round_trip():
    kp = generate_keypair("ev-binding")
    wh = "sha256:abcd"
    assurances = [("v1", 0.9), ("v2", 0.8)]
    sig = evidence_binding_sign(kp.private_key, wh, assurances)
    assert evidence_binding_verify(kp.public_key, wh, assurances, sig)


def test_evidence_binding_rejects_tampered_witness():
    kp = generate_keypair("ev-binding-t1")
    assurances = [("v1", 0.9)]
    sig = evidence_binding_sign(kp.private_key, "sha256:abc", assurances)
    assert not evidence_binding_verify(kp.public_key, "sha256:XXX", assurances, sig)


def test_evidence_binding_rejects_tampered_assurance_score():
    kp = generate_keypair("ev-binding-t2")
    sig = evidence_binding_sign(kp.private_key, "sha256:abc", [("v1", 0.9)])
    assert not evidence_binding_verify(
        kp.public_key, "sha256:abc", [("v1", 0.91)], sig
    )


def test_evidence_binding_rejects_tampered_validator_id():
    kp = generate_keypair("ev-binding-t3")
    sig = evidence_binding_sign(kp.private_key, "sha256:abc", [("v1", 0.9)])
    assert not evidence_binding_verify(
        kp.public_key, "sha256:abc", [("vX", 0.9)], sig
    )


def test_evidence_binding_rejects_tampered_signature():
    kp = generate_keypair("ev-binding-t4")
    sig = evidence_binding_sign(kp.private_key, "sha256:abc", [("v1", 0.9)])
    bad = bytearray(sig)
    bad[0] ^= 0x01
    assert not evidence_binding_verify(
        kp.public_key, "sha256:abc", [("v1", 0.9)], bytes(bad)
    )


# ---------------------------------------------------------------------------
# Aggregate evidence binding
# ---------------------------------------------------------------------------

def test_aggregate_evidence_binding_round_trip():
    kp1 = generate_keypair("agg-ev-1")
    kp2 = generate_keypair("agg-ev-2")
    kp3 = generate_keypair("agg-ev-3")

    wh = "sha256:deadbeef"
    assurances = [("v1", 0.9), ("v2", 0.85), ("v3", 0.95)]

    agg_sig = aggregate_evidence_binding([kp1, kp2, kp3], wh, assurances)
    assert verify_aggregate_evidence_binding(
        [kp1.public_key, kp2.public_key, kp3.public_key], wh, assurances, agg_sig
    )


def test_aggregate_evidence_binding_rejects_tampered_witness():
    kp1 = generate_keypair("agg-ev-t1")
    kp2 = generate_keypair("agg-ev-t2")

    assurances = [("v1", 0.9), ("v2", 0.8)]
    agg_sig = aggregate_evidence_binding([kp1, kp2], "sha256:abc", assurances)
    assert not verify_aggregate_evidence_binding(
        [kp1.public_key, kp2.public_key], "sha256:DIFFERENT", assurances, agg_sig
    )


def test_aggregate_evidence_binding_rejects_swapped_validator():
    """If we claim v3 signed but actually v1 and v2 did, the aggregate
    signature must fail verification.
    """
    kp1 = generate_keypair("agg-ev-s1")
    kp2 = generate_keypair("agg-ev-s2")
    kp3 = generate_keypair("agg-ev-s3")

    assurances = [("v1", 0.9), ("v2", 0.8)]
    agg_sig = aggregate_evidence_binding([kp1, kp2], "sha256:abc", assurances)
    # Try to verify with [kp1, kp3] — kp3 never signed
    assert not verify_aggregate_evidence_binding(
        [kp1.public_key, kp3.public_key], "sha256:abc", assurances, agg_sig
    )


# ---------------------------------------------------------------------------
# Binding message format
# ---------------------------------------------------------------------------

def test_binding_message_format():
    msg = _binding_message("sha256:abc", [("v1", 0.9), ("v2", 0.85)])
    # Format: "sha256:abc|v1:0.900000|v2:0.850000"
    assert msg == "sha256:abc|v1:0.900000|v2:0.850000"


def test_binding_message_empty_assurances():
    msg = _binding_message("sha256:abc", [])
    assert msg == "sha256:abc"


def test_binding_message_distinct_for_distinct_witnesses():
    m1 = _binding_message("sha256:aaa", [("v1", 0.9)])
    m2 = _binding_message("sha256:bbb", [("v1", 0.9)])
    assert m1 != m2
