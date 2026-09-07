# ADR-0048 — Acquired Drizzle Upgrade With Behavioral Validation and Rollback

## Status
Accepted

## Context
Earlier releases retained a static Roast blocker because package versions could not be changed honestly without acquiring and testing the real artifacts.

## Decision
Acquire drizzle-orm 0.45.2 and drizzle-kit 0.31.10, record registry integrity, update the lockfile, and require typecheck, canonical migrations, SQLite persistence tests, v17 controls, production build, backup and restore compatibility. Preserve the previous package files outside the release as rollback material.

## Consequences
The stale version finding can close. Future upgrades must repeat the same package-acquisition and behavioral-validation protocol.
