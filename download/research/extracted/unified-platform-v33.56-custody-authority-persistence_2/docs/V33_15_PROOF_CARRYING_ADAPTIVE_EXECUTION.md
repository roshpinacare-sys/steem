# V33.15 — Proof-Carrying Adaptive Execution

## Purpose

Convert a repeated governed workflow into a bounded shortcut candidate without allowing a research component, model, agent, operator or user interface to expand authority or create a production effect.

## Evidence sequence

1. **Training** — at least five valid full-workflow observations with one uniform authority, scope, policy, input schema, toolchain, model set, input class and deterministic result.
2. **Holdout** — disjoint observations that were not used for discovery and must reproduce the same full-workflow result.
3. **Shadow** — the full governed workflow still runs; the proposed shortcut result is compared without external effect.
4. **Qualification** — an independent trusted signer attests to holdout equivalence.
5. **Shortcut Passport** — a different trusted signer binds candidate, qualification, shadow evidence, expiry, scope and fallback.
6. **Explicit activation** — a user or authorized actor activates only a subset of the passport scopes for a bounded period.
7. **Routing** — the shortcut is eligible only in shadow mode when every boundary remains identical and the operation is low/medium risk and reversible.
8. **Drift and revocation** — policy, authority, scope, schema, toolchain, model-set or result drift creates a revocation and routes work to the full governed workflow.

## Fail-closed properties

- No high-risk, critical or non-reversible candidate.
- No overlap between training and holdout evidence.
- No mismatch tolerance.
- No untrusted qualifier, passport issuer, activation signer or revocation signer.
- No wildcard scope and no activation scope expansion.
- No self-promotion from discovery to passport issuance.
- No external effect in shortcut discovery, qualification, routing or revocation.
- Missing revocation trust context falls back to the full workflow.

## Local proof

The local campaign uses 8 training observations, 4 holdout observations and 10 shadow comparisons. It then routes 12 matching requests in qualified shadow mode, introduces toolchain drift, signs a revocation and verifies fallback.

The structural estimate reports 76% cost reduction, 82.7% duration reduction and 90% user-step reduction. These are simulated local estimates for one workflow class, not customer, human, production or revenue evidence.

## Truth boundary

V33.15 does not execute a shortcut against an external system, does not run a live drift-monitor service, does not qualify multiple workflow classes, and does not pass G6 or production promotion.
