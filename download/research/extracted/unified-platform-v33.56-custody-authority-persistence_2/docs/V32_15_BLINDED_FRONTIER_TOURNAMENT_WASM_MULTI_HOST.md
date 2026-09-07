# v32.15 — Blinded Frontier Tournament, Proof-Carrying WASM Components, and Multi-Host Qualification

## Objective

Convert three external claims into executable, fail-closed protocols: model comparison, portable component isolation, and independent multi-host operation.

## Blinded tournament

The tournament binds one run to source, corpus, policy and blind-salt digests. Provider submissions and judge scores are signed by keys authorized through an out-of-band trust policy. Scores are committed before identity reveal. Synthetic or local fixtures cannot produce an external frontier verdict, and every report retains `worldBestClaim: not-proven` until independently operated evidence exists.

## Proof-carrying WASM components

Admission binds the exact binary, source, toolchain, policy, WIT imports and exports, capability grants, resource limits, publisher and independent reviewer. Composition rejects missing, ambiguous, self-bound and cyclic interfaces. The repository validates admission and composition; it does not execute untrusted components or claim that a concrete WASI runtime is qualified.

## Multi-host qualification

A challenge nonce and monotonic sequence bind signed host observations to one source, build, toolchain, environment and policy identity. Production qualification requires externally pinned host keys and policy-mandated provider and organization diversity. Local processes remain dry-run evidence.

## Local evidence

Run:

```bash
npm ci --offline
npm run validate:v32.15
```

Local proof demonstrates protocol integrity, independent report verification and causal mutation resistance. External provider calls, judge custody, runtime escape testing, network partitions, failover, RTO/RPO and production telemetry remain not executed.
