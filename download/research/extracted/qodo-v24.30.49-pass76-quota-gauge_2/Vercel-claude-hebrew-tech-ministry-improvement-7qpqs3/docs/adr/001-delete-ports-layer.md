# ADR-001: Delete the `ports/` hexagonal layer

**Status:** accepted (2026-07)

## Context

`packages/agent/src/ports/` declared `IStateStore`, `IBlobStore`, and
`IVersionControl` and documented them as the dependency-injection seams used
by agents and tests. Reference analysis showed **zero imports outside the
directory** — cli, agents, and every test construct the concrete
`RedisState`/`R2Storage`/`GitHubClient` directly. The hexagonal architecture
existed only in documentation.

## Decision

Delete the directory. Retrofitting the interfaces through the (then-monolithic)
pipeline would have touched every construction site with no test able to
verify the wiring — maximal risk for zero behavioral payoff.

## Consequences

If real DI is wanted later, `PhaseContext` (src/pipeline/context.ts) is the
natural seam: it already threads every service a phase touches, and its fields
can be narrowed to interfaces one at a time (see `TrustStateStore` in
trust-ledger.ts and `PhaseLogger`/`PhaseTelemetry` in phase-runner.ts for the
pattern — interfaces introduced at the point of consumption, driven by tests).
