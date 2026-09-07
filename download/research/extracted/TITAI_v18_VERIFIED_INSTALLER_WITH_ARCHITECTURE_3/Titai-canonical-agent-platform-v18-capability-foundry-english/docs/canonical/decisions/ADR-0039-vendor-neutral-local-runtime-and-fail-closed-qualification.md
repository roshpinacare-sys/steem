# ADR-0039: Vendor-neutral local runtime and fail-closed qualification

## Status
Accepted for v16 sovereign development mode.

## Problem
The platform had deterministic local execution and model profiles, but no lifecycle contract for a real model process. Treating a test runtime as generative evidence would overstate sovereignty.

## Alternatives
1. Bind the runner directly to one vendor runtime. Fast, but creates protocol and lifecycle lock-in.
2. Keep deterministic local generation only. Safe for tests, but cannot prove reasoning quality.
3. Define a runtime lifecycle contract, loopback-only adapters, artifact integrity verification, explicit no-model behavior, and a qualification lane that blocks when a signed artifact is absent.

## Decision
Adopt option 3. The canonical runner depends on a runtime-neutral lifecycle. An OpenAI-compatible loopback adapter and a hash-verified llama.cpp process adapter are available, while `NoModelRuntime` fails closed. A deterministic runtime remains test evidence only.

## Security and sovereignty impact
Remote endpoints are rejected by the local adapter. Binary and model paths require SHA-256 verification. Missing model artifacts block pilot claims rather than triggering an undisclosed remote fallback.

## Reversibility
Adapters are additive. The deterministic and no-model adapters remain available if a local runtime is removed.

## Acceptance evidence
- `src/lib/sovereignty/runtime-adapters.ts`
- `tests/sovereign-runtime-adapters.test.ts`
- `scripts/qualify-v16-local-model.mjs`
- `docs/canonical/evidence/v16/model/local-model-qualification.json`
