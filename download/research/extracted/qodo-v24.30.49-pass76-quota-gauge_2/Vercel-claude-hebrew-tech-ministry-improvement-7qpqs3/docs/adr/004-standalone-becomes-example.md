# ADR-004: `standalone-executable/` becomes `examples/local-simulator/`

**Status:** accepted (2026-07)

## Context

The archive shipped a 2.2k-line "standalone executable" alongside the real
agent. It shares the agent's concept names (architect, coder, reviewer,
ports, validators, schemas) but is a **diverged, mock-only fork** with
entirely different implementations — per the archive's own consolidation
notes, the two were never the same artifact. Sitting at the repo root with a
product-like name, it was the single biggest source of "which code is the
product?" confusion.

## Decision

Move it to `examples/local-simulator/` with a README stating exactly what it
is (a zero-dependency demo harness; its 28 tests are the only part of the
archive that had ever been executed) and what it is not (the product, shared
code, or a place to fix product bugs). It stays out of npm workspaces to
preserve its zero-install property; CI runs its tests in a dedicated job.

## Consequences

Its divergence is now a feature (a self-contained pipeline-logic demo), not a
trap. If it rots, it can be deleted without touching the product.
