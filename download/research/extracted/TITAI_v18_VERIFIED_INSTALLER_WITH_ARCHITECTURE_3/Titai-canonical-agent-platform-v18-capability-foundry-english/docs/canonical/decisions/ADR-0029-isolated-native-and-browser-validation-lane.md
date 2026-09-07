# ADR-0029: Isolated Native and Browser Validation Lane

- Status: Accepted
- Date: 2026-07-11
- Owners: Release Engineer, Security Engineer

## Problem

The protected workstation cannot safely run opaque native installers or weaken endpoint protection. Native SQLite, production build, browser E2E, accessibility, and multi-process race evidence are nevertheless mandatory before a controlled pilot classification.

## Alternatives

1. Disable workstation protection and build locally. Rejected as unsafe.
2. Mark native and browser gates as warnings. Rejected because unknown critical evidence must block pilot readiness.
3. Run the gates in a clean disposable CI worker with pinned runtime and commit-pinned actions, upload only machine-readable evidence, and keep generated native binaries out of the source archive.

## Decision

Adopt alternative 3. The repository contains a least-privilege GitHub Actions workflow with pinned action commits, pinned Node runtime, lockfile installation, native tests, build, Chromium and Firefox E2E, and evidence upload.

## Security Controls

- Read-only repository permissions.
- No production credentials.
- Telemetry disabled.
- Action references pinned to reviewed 40-character commit SHAs.
- Generated native artifacts excluded from the source release.

## Acceptance Evidence

- `.github/workflows/pilot-validation.yml`
- `.nvmrc`
- `scripts/validate-ci-pins.mjs`
- `npm run ci:pins`
