# V33.38 — External Custody Ceremony and Receipt Transparency

V33.38 connects the signed V33.37 external deployment/import protocol to a fail-closed key-custody lifecycle.

## Implemented controls

- One-time provisioning for the exact eleven V33.37 role slots.
- Challenge/response proof of private-key possession for every role owner.
- Immutable ceremony transcript with two independently administered witnesses.
- Scheduled rotation requiring current-key consent, replacement-key acceptance and two security custodians.
- Emergency rotation or revocation requiring three security custodians.
- Full lifecycle-evidence recomputation from proposal, possession statements, approvals and certificate; a signed certificate alone is insufficient.
- Irreversible old-key revocation and anti-resurrection checks.
- Append-only receipt transparency log, witnessed checkpoints, rollback rejection and split-view detection.
- Exact recomputation of the V33.37 evidence import before the V33.38 verdict.

## Truth boundary

The bundled proof is a local custody/import rehearsal. It does not establish independent external operators, external hosts, human participants, G3 completion or production authority. External mutation remains not authorized and production promotion remains blocked.
