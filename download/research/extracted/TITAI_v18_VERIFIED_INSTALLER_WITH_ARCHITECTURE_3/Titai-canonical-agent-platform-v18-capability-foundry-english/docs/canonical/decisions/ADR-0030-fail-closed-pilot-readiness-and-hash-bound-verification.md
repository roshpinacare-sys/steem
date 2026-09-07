# ADR-0030: Fail-Closed Pilot Readiness and Hash-Bound Verification

- Status: Accepted
- Date: 2026-07-11
- Owners: Independent Verifier, Product Safety Engineer

## Problem

A completed run, a green unit test, or a static checklist can be mistaken for pilot readiness. Missing native, browser, accessibility, recovery, or final-hash evidence must not be displayed as success.

## Decision

Pilot readiness is derived from real backend evidence. Unknown evidence blocks promotion. Final verification is performed by a distinct verifier identity against the release ZIP hash and rejects when any mandatory gate is not `pass`.

## Consequences

- The local v13 package remains `DEVELOPMENT ONLY` until the isolated lane supplies the blocked evidence.
- Operator truth is visible in the Pilot Readiness panel.
- A later CI run can update the evidence bundle without changing the safety semantics.

## Acceptance Evidence

- `src/lib/release/pilot-run-gates.ts`
- `src/lib/release/pilot-run-evidence.ts`
- `src/components/runs/pilot-readiness-panel.tsx`
- `scripts/generate-pilot-evidence.mjs`
- `scripts/verify-pilot-candidate.mjs`
