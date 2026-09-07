# V33.39 — HSM/Threshold Custody, Public Checkpoint and Site Recovery

V33.39 extends the verified V33.38 custody ceremony with a fail-closed hardware-custody and disaster-recovery protocol.

## Implemented controls

- Eleven role-bound hardware-key attestations with signed provider/device identity, firmware digest, generated-in-device origin, non-extractability and fail-closed signing controls.
- Three-of-five independent threshold custody for public checkpoints, revocation propagation and site recovery.
- Exact threshold sequence and predecessor continuity; rollback, fork and duplicate-share attempts fail closed.
- Sealed role transfer bound to source and target attestations without including private or exportable key material.
- HTTPS checkpoint publication bound to the V33.38 verdict, transparency head and threshold certificate.
- Three independently identified retrieval monitors with durable write and fsync receipts.
- Revocation propagation receipts from three monitors and explicit anti-resurrection behavior.
- Site-loss recovery bound to the prior checkpoint, exact backup inventory, restored bytes and threshold head, with no sequence reset or fork.
- Independent proof verifier recomputes V33.38 and V33.39 from original public evidence.

## Truth boundary

The bundled proof uses locally generated keys, local TPM-class rehearsal attestations and local checkpoint retrieval. It does not establish external HSMs, external role owners, external sites, external monitors or external human participants. G3 remains blocked. External mutation is not authorized and production promotion remains blocked.
