# v32.8 — Adversarial Strategic Breakthrough

## Purpose

Attack every material claim before expanding it. Add safe interfaces to mature external assurance ecosystems without vendoring or granting execution authority to third-party code.

## Selected adapter ecosystems

1. GitHub CodeQL — SARIF security evidence import.
2. OpenSSF Scorecard — repository supply-chain posture metadata.
3. Sigstore Cosign — signature and transparency verification.
4. in-toto Witness — provenance and policy evidence.
5. Open Policy Agent — policy decision evidence.
6. TLA+ TLC — formal state-model evidence.
7. Google OSS-Fuzz — continuous fuzz-campaign evidence.

The repository includes no third-party binary from these projects. Execution remains isolated and opt-in. Evidence must be immutable, digest-bound, observed, complete, and independently reviewable.

## Strategic claims attacked

- Local proof coherence may survive when two executable, independent, negative-path proof lanes agree on the exact source and artifact.
- Production qualification is refuted until external infrastructure gates are observed.
- Human value is refuted until a consented comparative pilot is observed.
- Signed supply-chain provenance is refuted until signature, builder identity, materials and transparency are verified.

## New controls

- vetted tool intake
- SARIF security evidence gate
- in-toto compatible attestation gate
- OPA-compatible policy evidence gate
- TLA+ model evidence gate
- fuzz campaign evidence gate
- adversarial claim roast
- workflow supply-chain assurance
- strategic assurance aggregation

## Boundary

Passing adapter contracts means the system is ready to execute external tools in bounded CI jobs. It does not mean those tools have run, that their outputs are clean, or that production is qualified.
