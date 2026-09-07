# CLAUDE HANDOFF v32.17

## Canonical status

CNCF Sovereign Building-Block Convergence Integrated Pilot — External Qualification Ready. Production promotion is blocked.

## Start here

1. Read `CLAUDE.md`, `MASTER_DIRECTIVE.md`, `PROGRAM_CHARTER.md`.
2. Read `governance-state/PROGRAM_STATE.json`, `NEXT_ACTION.json`, and `OPEN_DECISIONS.json`.
3. Run `npm ci --offline`, `npm run build`, then `npm run validate:v32.17`.
4. Do not interpret the local Dapr-envelope adapter as execution of the Dapr runtime.

## New controls

- Proof-carrying admission for private Dapr-profile building-block components.
- SPIFFE trust-domain, UDS, interface, resource, egress and independent-review enforcement.
- Exact topology optimization across eight building blocks.
- Native versus Dapr-envelope semantic trace comparison.
- Independent Python verifier incapable of producing or approving evidence.
- Seventeen causal mutation controls.

## External next action

Execute the pinned Dapr, SPIRE, OPA, OpenTelemetry, Wasmtime and CloudNativePG profile on independent hosts, collect externally observed evidence, and prove runtime substitution under failures. Keep all six production gates blocked until independently qualified.
