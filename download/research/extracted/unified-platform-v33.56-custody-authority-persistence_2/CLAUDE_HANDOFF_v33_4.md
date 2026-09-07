# CLAUDE HANDOFF — V33.4

## Current state

V33.4 adds transport-neutral reliable push, a signed durable outbox, provider receipts, fault injection, worker crash recovery, device-session invalidation and registrar-bound device replacement.

## Read order

1. `CLAUDE.md`
2. `MASTER_DIRECTIVE.md`
3. `PROGRAM_CHARTER.md`
4. `v33/governance-state/PROOF_GATE_REGISTRY_V33.json`
5. `docs/V33_4_TRANSPORT_NEUTRAL_RELIABLE_PUSH.md`
6. `src/product/reliable-push-v33_4.ts`
7. `tests/reliable-push-v33_4.test.ts`
8. `release-evidence/v33.4/V33_4_RELIABLE_PUSH_PROOF.json`

## Required command

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run validate:v33.4
```

## Truth boundary

- G0 and G1 are passed.
- G2 is not started.
- G3 is in progress and not passed.
- Transport evidence is local simulated fault injection only.
- APNs, FCM, real devices, hardware keys and human UX remain unqualified.
- Production promotion and external effects remain blocked.

## Next action

Build V33.5 provider-adapter qualification contracts and a local HTTP reference adapter without introducing production credentials or weakening the canonical authority/evidence boundary.
