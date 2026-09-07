# CLAUDE HANDOFF — V33.3

## State

V33.3 adds device-bound simulated push, signed device acknowledgements and decisions, local persistent approval inbox, signed snapshot restore, revocation semantics and user-flow measurement.

## Read first

1. `CLAUDE.md`
2. `MASTER_DIRECTIVE.md`
3. `PROGRAM_CHARTER.md`
4. `CLAUDE_HANDOFF_v33_3.md`
5. `docs/V33_3_DEVICE_BOUND_PUSH_AND_USER_FLOW.md`
6. `v33/governance-state/PROOF_GATE_REGISTRY_V33.json`

## Commands

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run test:chat:v33.3
npm run proof:chat:v33.3
npm run validate:v33.3
```

## Truth classification

- G0: passed
- G1: passed
- G2: not started
- G3: in progress, not passed
- external mobile transport: not integrated
- human UX validation: not executed
- production promotion: blocked

## Next bounded objective

V33.4 should implement a transport-neutral push adapter contract plus an out-of-order/disconnect fault simulator and a human-pilot protocol. It must not connect production APNs/FCM credentials or mark G3 passed without observed users.
