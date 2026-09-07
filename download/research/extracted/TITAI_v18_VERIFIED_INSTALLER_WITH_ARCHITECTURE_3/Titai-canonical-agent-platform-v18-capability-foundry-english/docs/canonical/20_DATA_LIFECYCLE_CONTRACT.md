# Data Lifecycle Contract

The machine-readable authority is `docs/canonical/data/DATA_INVENTORY.json`.

## Rules

1. Every persisted object must declare owner, purpose, sensitivity, retention, export, correction, and deletion behavior before production use.
2. Derived data inherits the most restrictive classification of its sources unless an approved declassification rule exists.
3. Provider credentials are never exported in plaintext.
4. Run deletion must include steps, events, approvals, artifacts, future retrieval indexes, caches, and backup-expiry handling.
5. Audit correction is append-only. Silent rewriting invalidates accountability.
6. Telemetry must not contain raw prompts, secrets, or artifacts by default.
7. Optional remote providers receive only the data required for the selected task and must remain replaceable.

## Current implementation boundary

The SQLite schema provides cascade relationships for several primary objects, but configurable retention, complete export, backup-expiry propagation, and future vector-index deletion are not implemented. DAT-001 is therefore implemented as a contract and inventory, not independently verified as a complete runtime lifecycle.
