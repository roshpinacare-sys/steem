# ADR-0033: Zero-key local authority and runtime adapters

## Status
Accepted for sovereign development mode.

## Problem
TITAI can route to local providers, but the core sovereign workflow needs a verified path that starts and completes without commercial credentials, remote identity, or network access.

## Verified current state
v14 has local SQLite, durable execution, governed memory, tools, evidence, verification, backup, and optional provider adapters. It did not bind these into a single zero-key proof.

## Constraints
- No model weights in the source archive.
- No opaque native installer on the protected host.
- Remote providers must remain optional adapters.
- A deterministic local runtime proves integration, not generative-model quality.

## Alternatives
1. Require an Ollama-compatible daemon. Stronger realism, but introduces an external process and model artifact dependency.
2. Embed one model runtime directly. Better single-process control, but creates hardware, license, and native-distribution pressure.
3. Preserve a canonical local runtime contract, prove it with a deterministic adapter, and benchmark real local models separately. Lowest coupling and reversible.

## Decision
Use a canonical `LocalModelRuntime` contract. The authoritative zero-key proof uses a deterministic local adapter; real local CPU/GPU models remain replaceable profiles behind the same contract and cannot be promoted without artifact, hardware, quality, and energy evidence.

## Quantitative comparison
The deterministic adapter adds no model artifact, commercial key, network request, or background process. It completes the bounded proof in milliseconds but has no measured reasoning-quality claim.

## Security and data impact
All prompt, memory, artifact, verification, and backup data remain local. Memory cannot grant capabilities.

## Reversibility
The adapter boundary permits replacement without changing canonical run, tool, memory, or evidence contracts.

## Acceptance evidence
- `src/lib/sovereignty/model-runtime.ts`
- `src/lib/sovereignty/zero-key-workflow.ts`
- `tests/sovereign-zero-key-workflow.test.ts`
- `docs/canonical/evidence/v15/sovereign-vertical-slices.json`
