# ADR-0035: Signed offline updates with atomic rollback

## Status
Accepted for sovereign development mode.

## Problem
A sovereign installation cannot require a public registry or live update service to evolve, and an interrupted or malicious update must not corrupt the current installation.

## Alternatives
1. Distribute a complete new ZIP and replace manually. Easy, but lacks compatibility, signature, dry-run, and rollback semantics.
2. Mirror the entire public registry. Comprehensive but operationally expensive for the pilot.
3. Produce a minimal signed update bundle containing changed files, hashes, compatibility, migrations, validation commands, and rollback evidence.

## Decision
Implement a canonical signed offline update envelope with path containment, downgrade prevention, manifest verification, dry-run planning, atomic file replacement, injected-failure rollback, and explicit version state.

## Risks
The current prototype is file-level and does not yet run application migrations itself. Update execution must remain an administrator capability.

## Acceptance evidence
- `src/lib/sovereignty/offline-update.ts`
- `tests/sovereign-offline-update.test.ts`
- `docs/canonical/evidence/v15/sovereign-vertical-slices.json`
