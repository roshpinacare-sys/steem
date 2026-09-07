# ADR-0032 — Bounded Build Resources and Conservative Browser Gating

## Status
Accepted.

## Problem
Next.js inferred a very large CPU count in the validation container and created excessive static-generation workers. The installed Chromium executable is subject to an organization-managed `URLBlocklist` that denies all navigation, including localhost.

## Alternatives
1. Disable build or browser gates.
2. Modify managed browser policy or request weaker workstation protection.
3. Bound Next.js build concurrency, keep browser tests in the disposable CI lane, and treat local browser results as blocked rather than passed.

## Decision
Adopt alternative 3.

The build is limited to two workers and authenticated pages are dynamically rendered. Browser tests remain part of the pinned isolated workflow. The local environment's managed policy is not modified or bypassed.

## Consequences
The production build can complete predictably without spawning an excessive number of workers. Local browser, accessibility, offline, and visual-regression gates remain blocking until executed in the disposable lane.

## Acceptance evidence
- `next.config.ts`
- `src/app/[locale]/(auth)/layout.tsx`
- `playwright.config.ts`
- `.github/workflows/pilot-validation.yml`
- `docs/canonical/evidence/v14/pilot-failure-matrix.json`
