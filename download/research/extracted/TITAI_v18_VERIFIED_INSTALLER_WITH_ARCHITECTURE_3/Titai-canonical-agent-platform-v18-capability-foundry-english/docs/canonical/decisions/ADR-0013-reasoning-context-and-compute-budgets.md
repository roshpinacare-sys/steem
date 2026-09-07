# ADR-0013: Reasoning, Context, and Compute Budgets

- **Status:** proposed
- **Date:** 2026-07-10
- **Decision owners:** Architect, Security, Operations, Product

## Context

Titai must grow without allowing research enthusiasm, vendor pressure, or agent
autonomy to bypass measurable contracts and user control.

## Decision

Treat planning depth, context assembly, search, critique, model calls, tools, time, and stopping as explicit budgets with measured policies.

## Required properties

- Local-first and exportable by default.
- Explicit identity, policy, provenance, version, and audit context.
- Measurable acceptance criteria and rollback.
- Optional technologies remain adapters until qualification evidence exists.
- No commercial credential becomes mandatory for the sovereign core.

## Consequences

This decision adds design and verification work before broad feature expansion.
That cost is accepted because it reduces lock-in, unsafe agency, irreproducible
behavior, and expensive migrations.

## Validation required before acceptance or implementation

1. A repository-specific threat and failure analysis.
2. At least one minimal prototype when the decision adds infrastructure.
3. Comparison against the current baseline and at least one simpler alternative.
4. Migration, rollback, operational, and data-portability notes.
5. Independent review of security and user-control implications.
