# Canonical Handoff — v32.1

## Status

v32.1 is a validated **Integrated Pilot**. It is not a production release and does not authorize external mutation.

## Mandatory read order

Read `CLAUDE.md`, `MASTER_DIRECTIVE.md`, `PROGRAM_CHARTER.md`, `governance-state/PROGRAM_STATE.json`, `governance-state/NEXT_ACTION.json`, `governance-state/OPEN_DECISIONS.json`, and then this file.

## What changed from v32

The portable workspace governance gap was closed and seven bounded capabilities were added or repaired:

1. semantic change DAG;
2. audit completeness probe;
3. model lifecycle watchdog;
4. workspace continuity validator;
5. uncertainty assurance gate;
6. payment safety ledger without payment authority;
7. atomic file-store publication under multi-process contention.

See `governance/v32_1/SOURCE_REUSE_DECISION_MATRIX_v32_1.json` and `governance/v32_1/SOURCE_TO_CANONICAL_TRACEABILITY_v32_1.json`.

## Non-negotiable architecture

- Keep one canonical authority and one durable job/task/attempt/lease/checkpoint/outbox/receipt model.
- Do not import wholesale source systems or add a competing orchestrator.
- Keep domain packs subordinate to kernel authority.
- Keep research, simulation and model output non-authoritative.
- Do not claim direct source-code reuse until original archives, hashes and licenses are independently requalified.
- Keep external mutation, untrusted repository execution and production promotion blocked.

## Next gate

Proceed only with v33 external qualification: KMS/HSM, independent custodians and witness, PostgreSQL failover/PITR, multi-host propagation, independent security and licensing review, and a consented comparative human pilot.
