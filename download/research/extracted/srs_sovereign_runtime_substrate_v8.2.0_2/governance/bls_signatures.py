#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bls_signatures.py
=================

BLS aggregate signature module using real BLS12-381 pairings via py_ecc.

This module provides cryptographically sound BLS signatures on the
BLS12-381 curve with proof-of-possession (to prevent rogue-key attacks).
The implementation uses py_ecc's G2ProofOfPossession module, which
implements the IETF BLS signature draft.

Key properties:
  - Signatures are unforgeable under the computational co-CDH assumption
    in the BLS12-381 pairing group.
  - Aggregate verification checks a single pairing equation, not
    individual signatures.
  - Proof-of-possession (PoP) during key registration prevents rogue-key
    attacks on aggregation.
  - Evidence-binding signatures cryptographically bind (validator_id, c_i)
    pairs to the Z3 witness hash, providing real non-repudiation.

Adm linkage:
  - BLS aggregate signatures bind the SQA quorum's (validator_id, c_i)
    pairs to the Z3 witness hash, ensuring non-repudiation (Chapter 4.5).
  - The SEG's Check 4 (witness hash binding) relies on this module's
    evidence_binding_verify to reject fabricated evidence chains.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

# Real BLS12-381 via py_ecc (graceful degradation — D5 fix).
# The module imports successfully even when py_ecc is not installed;
# callers must check BLSPY_AVAILABLE before invoking any signing /
# verification primitive. The stub `_bls` object raises a clear
# RuntimeError on attribute access so a missing dependency is reported
# at call time, not at import time.
try:
    from py_ecc.bls import G2ProofOfPossession as bls  # type: ignore[assignment]
    BLSPY_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only when py_ecc is absent
    BLSPY_AVAILABLE = False

    class _BlsStub:
        """Stand-in for py_ecc.bls.G2ProofOfPossession.

        Raises ``RuntimeError`` on any attribute access so that callers
        learn *where* the missing dependency actually matters, instead of
        failing at module import time.
        """

        def __getattr__(self, name: str) -> object:
            raise RuntimeError(
                f"py_ecc is not available (cannot access bls.{name}). "
                f"Install with: pip install py_ecc==7.0.0"
            )

    bls = _BlsStub()  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# 1. Key model
# ---------------------------------------------------------------------------

@dataclass
class BLSKeyPair:
    """A BLS12-381 key pair with proof-of-possession.

    The private key is a 32-byte integer; the public key is a G1 point
    (48 bytes compressed).  The PoP signature proves knowledge of the
    private key at registration time, preventing rogue-key attacks.
    """
    private_key: int          # 32-byte secret scalar
    public_key: int           # G1 point (compressed)
    pop: bytes = b""          # proof-of-possession signature (96 bytes)


def generate_keypair(seed: str = "") -> BLSKeyPair:
    """Generate a BLS12-381 key pair.

    If seed is provided, the private key is derived deterministically
    via scrypt (for reproducible tests).  Otherwise, a cryptographically
    random key is generated via os.urandom.

    The private key is masked to ensure it is less than the BLS12-381
    curve order r (the py_ecc library validates this).
    """
    # BLS12-381 curve order (r)
    CURVE_ORDER = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001

    if seed:
        sk_bytes = hashlib.scrypt(
            seed.encode(), salt=b"srs-bls-salt", n=1024, r=8, p=1, dklen=32
        )
        sk = int.from_bytes(sk_bytes, "big") % CURVE_ORDER
    else:
        sk_bytes = os.urandom(32)
        sk = int.from_bytes(sk_bytes, "big") % CURVE_ORDER
        # Ensure non-zero
        if sk == 0:
            sk = 1  # pragma: no cover

    pk = bls.SkToPk(sk)
    pop = bls.PopProve(sk)
    return BLSKeyPair(private_key=sk, public_key=pk, pop=pop)


def verify_pop(kp: BLSKeyPair) -> bool:
    """Verify a key pair's proof-of-possession (rogue-key defence)."""
    return bool(bls.PopVerify(kp.public_key, kp.pop))


# ---------------------------------------------------------------------------
# 2. Signing and verification
# ---------------------------------------------------------------------------

def sign(private_key: int, message: str) -> bytes:
    """Sign a message with a BLS12-381 private key.

    Returns a 96-byte G2 signature.
    """
    msg_bytes = message.encode("utf-8")
    return bytes(bls.Sign(private_key, msg_bytes))


def verify(public_key: int, message: str, signature: bytes) -> bool:
    """Verify a BLS12-381 signature.

    Performs a pairing check: e(pk, H(m)) == e(g1, sig).
    Returns True iff the signature is valid.
    """
    msg_bytes = message.encode("utf-8")
    return bool(bls.Verify(public_key, msg_bytes, signature))


# ---------------------------------------------------------------------------
# 3. Aggregate signatures
# ---------------------------------------------------------------------------

def aggregate(signatures: List[bytes]) -> bytes:
    """Aggregate a list of BLS signatures into a single aggregate.

    BLS aggregation is a single group operation (point addition in G2).
    The result is a 96-byte aggregate signature.
    """
    if not signatures:
        return b""
    return bytes(bls.Aggregate(signatures))


def aggregate_verify(public_keys: List[int], messages: List[str],
                     aggregate_sig: bytes) -> bool:
    """Verify an aggregate BLS signature.

    Checks: e(g1, agg_sig) == prod_i e(pk_i, H(m_i))

    This is a single multi-pairing check, not individual verifications.
    Returns True iff ALL constituent signatures are valid.
    """
    if not public_keys or not messages or not aggregate_sig:
        return False
    if len(public_keys) != len(messages):
        return False
    msg_bytes_list = [m.encode("utf-8") for m in messages]
    return bool(bls.AggregateVerify(public_keys, msg_bytes_list, aggregate_sig))


# ---------------------------------------------------------------------------
# 4. Evidence-binding signature
# ---------------------------------------------------------------------------

def _binding_message(z3_witness_hash: str,
                     validator_assurances: List[Tuple[str, float]]) -> str:
    """Construct the canonical binding message.

    The message is: z3_witness_hash|validator_id_1:c_i_1|validator_id_2:c_i_2|...
    This is the material that gets signed; any change to the witness hash
    or the assurance scores produces a different message and therefore a
    different (valid) signature.
    """
    parts = [z3_witness_hash]
    for vid, ci in validator_assurances:
        parts.append(f"{vid}:{ci:.6f}")
    return "|".join(parts)


def evidence_binding_sign(private_key: int,
                          z3_witness_hash: str,
                          validator_assurances: List[Tuple[str, float]]) -> bytes:
    """Sign the binding between a Z3 witness and the validator assurance scores.

    This is the cryptographic primitive that prevents evidence fabrication:
    each validator signs (z3_witness_hash, [(validator_id, c_i), ...]),
    and the aggregate binding signature proves that the listed validators
    attested to the listed scores for the listed witness.

    Any party can later verify that:
      (a) the witness hash matches the Z3 proof being certified, AND
      (b) the validator assurance scores match what the validators attested,
    by re-constructing the binding message and verifying the signature.
    """
    msg = _binding_message(z3_witness_hash, validator_assurances)
    return sign(private_key, msg)


def evidence_binding_verify(public_key: int,
                            z3_witness_hash: str,
                            validator_assurances: List[Tuple[str, float]],
                            binding_sig: bytes) -> bool:
    """Verify an evidence-binding signature.

    Returns True iff the signature is valid for the given (witness_hash,
    validator_assurances) tuple under the given public key.
    """
    msg = _binding_message(z3_witness_hash, validator_assurances)
    return verify(public_key, msg, binding_sig)


def aggregate_evidence_binding(
    keypairs: List[BLSKeyPair],
    z3_witness_hash: str,
    validator_assurances: List[Tuple[str, float]]
) -> bytes:
    """Aggregate evidence-binding signatures from multiple validators.

    Each validator signs the same binding message with their own key.
    The aggregate signature can be verified with the list of public keys
    and the binding message.
    """
    sigs = [
        evidence_binding_sign(kp.private_key, z3_witness_hash, validator_assurances)
        for kp in keypairs
    ]
    return aggregate(sigs)


def verify_aggregate_evidence_binding(
    public_keys: List[int],
    z3_witness_hash: str,
    validator_assurances: List[Tuple[str, float]],
    agg_sig: bytes
) -> bool:
    """Verify an aggregate evidence-binding signature.

    Checks that all validators signed the same (witness_hash, assurances)
    tuple.  Returns True iff the aggregate signature is valid.
    """
    msg = _binding_message(z3_witness_hash, validator_assurances)
    # All validators sign the same message, so aggregate_verify checks
    # e(g1, agg_sig) == prod_i e(pk_i, H(msg))
    msg_bytes_list = [msg.encode("utf-8")] * len(public_keys)
    return bool(bls.AggregateVerify(public_keys, msg_bytes_list, agg_sig))


# ---------------------------------------------------------------------------
# 5. Self-test
# ---------------------------------------------------------------------------

def self_test() -> None:
    if not BLSPY_AVAILABLE:
        raise RuntimeError(
            "BLS self_test requires py_ecc. Install with: "
            "pip install py_ecc==7.0.0"
        )
    print("=" * 78)
    print("BLS Signatures — real BLS12-381 self-test")
    print("=" * 78)

    # Generate two key pairs with PoP
    kp1 = generate_keypair("validator-1")
    kp2 = generate_keypair("validator-2")
    print(f"  Keypair 1: pk={kp1.public_key} (PoP: {len(kp1.pop)} bytes)")
    print(f"  Keypair 2: pk={kp2.public_key} (PoP: {len(kp2.pop)} bytes)")

    # Verify PoPs (rogue-key defence)
    assert verify_pop(kp1), "PoP 1 failed"
    assert verify_pop(kp2), "PoP 2 failed"
    print(f"  PoP verification: ✓ (rogue-key defence active)")

    # Sign and verify
    msg = "mutation-001"
    sig1 = sign(kp1.private_key, msg)
    sig2 = sign(kp2.private_key, msg)
    print(f"  Signature 1: {len(sig1)} bytes (G2 point)")
    print(f"  Signature 2: {len(sig2)} bytes (G2 point)")

    assert verify(kp1.public_key, msg, sig1), "verify sig1 failed"
    assert verify(kp2.public_key, msg, sig2), "verify sig2 failed"
    print(f"  Individual verify: ✓")

    # Tampered message must FAIL
    assert not verify(kp1.public_key, "mutation-002", sig1), "tampered message should fail"
    print(f"  Tampered message rejected: ✓")

    # Tampered signature must FAIL
    bad_sig = bytearray(sig1)
    bad_sig[0] ^= 1
    assert not verify(kp1.public_key, msg, bytes(bad_sig)), "tampered sig should fail"
    print(f"  Tampered signature rejected: ✓")

    # Aggregate
    agg = aggregate([sig1, sig2])
    print(f"  Aggregate: {len(agg)} bytes")
    assert aggregate_verify([kp1.public_key, kp2.public_key], [msg, msg], agg)
    print(f"  Aggregate verify: ✓")

    # Aggregate with wrong message must FAIL
    assert not aggregate_verify(
        [kp1.public_key, kp2.public_key], [msg, "wrong"], agg
    ), "aggregate with wrong message should fail"
    print(f"  Aggregate with wrong message rejected: ✓")

    # Evidence binding
    witness_hash = "sha256:abc123def456"
    assurances = [("validator-1", 0.95), ("validator-2", 0.88)]
    binding = evidence_binding_sign(kp1.private_key, witness_hash, assurances)
    print(f"  Evidence binding: {len(binding)} bytes")
    assert evidence_binding_verify(kp1.public_key, witness_hash, assurances, binding)
    print(f"  Evidence binding verify: ✓")

    # Binding with tampered witness hash must FAIL
    assert not evidence_binding_verify(
        kp1.public_key, "sha256:DIFFERENT", assurances, binding
    ), "binding with wrong witness should fail"
    print(f"  Binding with wrong witness rejected: ✓")

    # Binding with tampered assurance score must FAIL
    bad_assurances = [("validator-1", 0.96), ("validator-2", 0.88)]
    assert not evidence_binding_verify(
        kp1.public_key, witness_hash, bad_assurances, binding
    ), "binding with wrong assurance should fail"
    print(f"  Binding with wrong assurance rejected: ✓")

    # Aggregate evidence binding
    agg_binding = aggregate_evidence_binding(
        [kp1, kp2], witness_hash, assurances
    )
    assert verify_aggregate_evidence_binding(
        [kp1.public_key, kp2.public_key], witness_hash, assurances, agg_binding
    )
    print(f"  Aggregate evidence binding: ✓")

    print("=" * 78)
    print("BLS Signatures self-test PASSED — real BLS12-381 cryptography.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()  # pragma: no cover
