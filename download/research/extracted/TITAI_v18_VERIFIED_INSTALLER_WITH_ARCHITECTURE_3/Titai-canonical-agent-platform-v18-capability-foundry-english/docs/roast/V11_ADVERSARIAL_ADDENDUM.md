# TITAI v11 Adversarial Roast Addendum

## Outcome

The repeatable static Roast now passes **33/34** controls. The sole failing static control is the Drizzle ORM security baseline, which was not changed without acquiring and validating the real dependency.

The 50-finding register now contains:

- 13 fixed in v8
- 6 fixed in v10
- 3 fixed in v11
- 25 partially mitigated
- 1 open
- 2 environment blocked

## v11 findings closed

- F-040: governed memory is no longer documentation-only.
- F-041: provider selection now has measured capability profiles, hard constraints, fail-closed eligibility, deterministic scoring, and persisted rationale.
- F-049: tool schemas and runtime budgets are explicit and enforced.

## v11 findings reduced but not closed

- F-001: durable infrastructure and a gated envelope exist, but the active runner still lacks granular restart-safe continuation.
- F-027: a serializable approval state machine exists, but persistence and active resume are not wired.

## Release decision

**DEVELOPMENT ONLY.** Critical production evidence remains blocked by native SQLite, browser, accessibility, build, and multi-process restart tests.
