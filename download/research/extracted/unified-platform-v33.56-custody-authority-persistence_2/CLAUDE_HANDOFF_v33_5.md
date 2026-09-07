# CLAUDE HANDOFF — V33.5

## Current state

V33.5 adds a real loopback HTTP provider adapter, provider-signed receipt, signed webhook receiver, network fault qualification and a mobile approval presentation simulator. It also expands the architecture closure to include the five V33 product capabilities.

## Read order

1. `CLAUDE.md`
2. `MASTER_DIRECTIVE.md`
3. `PROGRAM_CHARTER.md`
4. `v33/governance-state/PROOF_GATE_REGISTRY_V33.json`
5. `docs/V33_5_PUSH_ADAPTER_QUALIFICATION_AND_MOBILE_SIMULATOR.md`
6. `src/product/push-adapter-qualification-v33_5.ts`
7. `tests/push-adapter-qualification-v33_5.test.ts`
8. `release-evidence/v33.5/V33_5_PUSH_ADAPTER_QUALIFICATION_PROOF.json`

## Required command

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run validate:v33.5
```

## Truth boundary

- G0 and G1 are passed.
- G2 is not started.
- G3 is in progress and not passed.
- The provider and webhook use real local HTTP only.
- APNs, FCM, public network, real phone, hardware-backed keys and human UX remain unqualified.
- Production effects and promotion remain blocked.

## Next action

Build V33.6 human-pilot readiness and an isolated external-provider qualification kit without introducing production credentials into the canonical repository.
