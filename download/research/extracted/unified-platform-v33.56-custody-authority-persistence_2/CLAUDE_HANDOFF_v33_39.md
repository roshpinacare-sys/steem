# Claude handoff — v33.39

Canonical version: **33.39**.

Read `CLAUDE.md`, `MASTER_DIRECTIVE.md`, `PROGRAM_CHARTER.md`, then the JSON files in `governance-state/`.

V33.39 adds eleven role-bound hardware-key attestations, a three-of-five threshold custody chain, sealed non-exportable role transfer, public checkpoint publication and retrieval receipts, revocation propagation, and site-loss recovery without sequence reset or fork. The independent verifier first recomputes the complete V33.38 custody/import proof and then recomputes the V33.39 chain from public keys and exact bytes.

Current proof status: `LOCAL_HSM_THRESHOLD_RECOVERY_REHEARSAL_ONLY`. External hardware observed: false. External topology observed: false. External role owners observed: 0. External human participants: 0. Production authority: `NONE`. External mutation is not authorized and production promotion is blocked.

Next action: execute the kit with independently administered HSM/KMS providers, five threshold custodians, a public checkpoint endpoint, three external monitors and a physically separate recovery site. Do not change G3 or production blockers until genuine external evidence verifies.
