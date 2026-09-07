# SRS Security Policy

## Threat Model

The SRS operates under the following threat model:

### Trust Roots
- **Omnivisor (EL2)**: The root of trust. Runs at exception level 2 on
  the AArch64 APU. Compromise of the Omnivisor compromises all domains.
- **BLS Validator Keys**: Each validator holds a BLS12-381 private key.
  Compromise of ≥ 1/3 of validators (by assurance weight) breaks quorum.
- **SEG Controller**: The final admission authority. Compromise allows
  arbitrary mutations. Mitigated by the 5-check gate and SQA quorum.

### Threats (STRIDE)
| Threat | Surface | Mitigation |
|--------|---------|------------|
| **Spoofing** | Validator identity | BLS proof-of-possession at registration |
| **Tampering** | ESR entries | BLS aggregate signatures + Lamport timestamps |
| **Repudiation** | Validator verdicts | Evidence-binding signatures (non-repudiable) |
| **Information disclosure** | Cross-domain memory | SMPU/SPPU TI/SC enforcement |
| **Denial of service** | TIB starvation | Temporal-banker bounded budgets + NoStarvation |
| **Elevation of privilege** | SEG bypass | 5 mandatory checks, no optional fields |

### Key Lifecycle
1. **Generation**: `bls_signatures.generate_keypair()` uses
   `os.urandom(32)` for the private key scalar. In production, keys
   are generated in an HSM.
2. **Registration**: Validators submit their public key + PoP signature.
   The PoP prevents rogue-key attacks on aggregation.
3. **Rotation**: Keys are rotated on epoch transitions (`seg.set_epoch()`).
   Old keys are revoked; signatures from old epochs are rejected by
   the seq check.
4. **Compromise**: If a validator key is compromised, the epoch is
   rotated and the compromised validator is evicted from the quorum.
   The `c_min` threshold ensures the remaining honest validators still
   meet the quorum floor.

## Reporting a Vulnerability

Email: sovereign-security@srs.z.ai

Response time: 48 hours for acknowledgement, 7 days for initial assessment.

## Cryptographic primitives

- **BLS12-381**: Via `py_ecc.bls.G2ProofOfPossession`. Signatures are
  96-byte G2 points. Aggregation is a single group operation.
  Verification is a single pairing check.
- **SHA-256**: Used for witness hashing and content addressing.
- **Scrypt**: Used for deterministic key derivation in testing (NOT
  production — production uses HSM-generated keys).

## Known limitations (v1.0.0)

1. The SQA aggregator's binding signature is a SHA-256 commitment, not
   a real BLS aggregate. Production deployment requires each validator
   to produce an independent `evidence_binding_sign()` and the aggregator
   to aggregate them. The `bls_signatures.py` self-test demonstrates
   the real cryptographic primitive.
2. The Omnivisor is a Python reference implementation, not an EL2
   hypervisor. Production deployment requires a Rust/C implementation
   at EL2 with real stage-2 page-table manipulation.
3. The eBPF telemetry programs are source-level only; they are not
   compiled or loaded in the test suite. Production deployment requires
   `libbpf` compilation and privileged loading.
