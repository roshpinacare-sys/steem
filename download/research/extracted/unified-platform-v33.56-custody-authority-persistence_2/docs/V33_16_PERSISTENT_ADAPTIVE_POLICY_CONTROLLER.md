# V33.16 — Persistent Adaptive Policy Controller

## Purpose

V33.16 turns the single-workflow V33.15 proof into a persistent, multi-workflow control plane. It does not discover new authority and it does not execute production effects.

## Implemented controls

- Store-signed persistent shortcut registry with atomic replacement and an append-only digest-chained event ledger.
- Re-verification of passport, activation, approval and revocation evidence when the store is reopened.
- Signed human approval requirement before every shortcut activation.
- Exact scope preservation; approval cannot add a scope not present in the passport.
- Multi-tenant and multi-workflow isolation.
- Deterministic selection of the cheapest equivalent shortcut under cost, duration and user-step budgets.
- Fail-closed fallback when active shortcuts predict conflicting result digests.
- Drift sweep that revokes on policy, authority, scope, schema, toolchain, model-set or result drift.
- Automatic revocation after a measured result mismatch.
- Local measured cost, duration and user-step audit records.
- Full governed workflow fallback for every rejected, expired, revoked or mismatched shortcut.

## Evidence boundary

The campaign is local. Approval is a signed Push-card contract, not delivery through a real mobile operating system. The drift sweep is explicitly invoked and is not a continuously deployed daemon. Savings are local execution measurements, not customer or production evidence. All routes remain shadow-only and external effects remain zero.

## Promotion boundary

Production promotion remains blocked. G6 stays `in-progress` until multiple live workflows, continuous monitoring, customer measurements, external red-team evidence and long-duration stability are independently demonstrated.

## Authoritative regression topology

The shared Node test scheduler showed non-deterministic lifecycle contamination when all stateful suites were co-scheduled. The release gate therefore uses four deterministic lanes without retry or force-exit:

1. Legacy core: 198 files / 1,383 tests at concurrency 2.
2. V33.9 Git fixture campaign: 1 file / 18 tests at concurrency 1.
3. V33.15 adaptive execution: 1 file / 16 tests at concurrency 1.
4. V33.16 persistent controller: 1 file / 18 tests at concurrency 1.

The aggregate exit receipt is authoritative only when all four lanes exit zero and the combined totals are 201 files and 1,435 passing tests.

The direct V33 gate also runs each of the 16 versioned V33 test files in its own Node process. This prevents a completed test file with a leaked handle from contaminating the rest of the qualification run. Each process has a hard timeout and any timeout is a failure; no retry or force-exit is accepted.
