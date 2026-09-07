# Claude Handoff — V33.6

## Status

Human-pilot readiness implemented locally. G3 remains in progress. Production remains blocked.

## Canonical additions

- `src/product/human-pilot-readiness-v33_6.ts`
- `src/web/pwa-approval-server-v33_6.ts`
- `web-v33_6/*`
- `tests/human-pilot-readiness-v33_6.test.ts`
- `scripts/human-pilot-readiness-proof-v33_6.mjs`
- `docs/V33_6_HUMAN_PILOT_READINESS_AND_EXTERNAL_PROVIDER_KIT.md`

## Security boundaries

- A browser response is pilot intent only.
- Human evidence requires an independent signed observation.
- Self-declared `HUMAN_OBSERVED` sessions are rejected by the PWA server.
- Device-loss session revocation requires canonical device revocation first.
- APNs/FCM credentials may only be referenced through approved secret adapters and are absent from the repository.
- No external provider or production effect has been executed.

## Next action

Run a controlled local human study, then execute credentialled APNs/FCM qualification in a separate environment with independent evidence collection. Do not promote G3 from simulated or locally generated evidence.
