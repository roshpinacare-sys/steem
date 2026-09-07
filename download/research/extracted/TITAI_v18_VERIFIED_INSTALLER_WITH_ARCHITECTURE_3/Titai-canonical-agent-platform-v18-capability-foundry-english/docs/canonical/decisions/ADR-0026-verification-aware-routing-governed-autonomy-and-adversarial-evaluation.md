# ADR-0026 — Verification-Aware Routing, Governed Autonomy, and Adversarial Evaluation

Status: Accepted for measured local policy; external benchmark ingestion remains future work.

## Problem

A generic model score does not identify a strong verifier, and model confidence must not determine authority. Memory relevance alone can select malicious instructions. Hand-picked tests are insufficient for graph, routing, and concurrency invariants.

## Alternatives

1. **Single generic quality score and static allowlists.** Simple, but conflates building, planning, verification, and authority.
2. **Prompt-directed routing and autonomy.** Flexible, but creates a confused-deputy security boundary.
3. **Task-class model capabilities, risk-adjusted autonomy, governed-memory ablation, and adversarial generated probes.** More measurement work, but separates capability, evidence, and authority.

## Decision

- Add model verification quality and health as explicit registry signals.
- Apply task-class weighting while preserving hard eligibility constraints.
- Derive tool autonomy from risk, effect, idempotency, reversibility, evidence, and human authority; deny prompt- or memory-derived authority.
- Compare raw and governed memory retrieval under poisoning.
- Run generated DAG, routing permutation, lease race, curated mutation, dynamic Roast, and deterministic microbenchmark suites.

## Evidence

The v12 focused suite, property/race probes, memory ablation, model-routing tests, autonomy tests, and targeted mutation probes form the acceptance evidence. Microbenchmarks are local deterministic measurements, not load tests.

## Risks

Model profile values remain locally supplied. The mutation suite is curated rather than exhaustive AST mutation. In-process tools remain inside the application trust boundary.

## Revisit conditions

Revisit after external benchmark ingestion, strong tool isolation, distributed workers, or real production workload traces are available.
