# v7 Executive Engineering Report

## Verified starting condition

The v6 archive contained a real Next.js and TypeScript application with SQLite persistence, Drizzle schema, agent and skill versioning, provider adapters, a deterministic simulation provider, policy-controlled tools, approvals, append-only run events, artifacts, a hash-linked audit chain, and a live execution canvas.

The initial canonical, language, release, and TypeScript gates passed. Three integration suites could not load because dependency installation was intentionally performed without native post-install scripts, leaving `better-sqlite3` without its platform binary.

## Major gaps found

- Runtime status labels were typed but legal transitions were not enforced.
- A terminal run badge did not prove that tool calls, approvals, plan steps, and event sequence were structurally complete.
- The interface exposed raw views but lacked a first-class evidence and uncertainty surface.
- The baseline evaluation task had no executable repository-owned harness.
- Threat and data-lifecycle coverage was broad in prose but lacked focused machine-readable inventories.
- The default lint command opened an interactive Next.js configuration prompt and was unsuitable for canonical automation.
- Security-sensitive workstation operation was not explicitly defined.

## Implementations completed

1. Added pure run, step, and approval lifecycle state machines.
2. Routed runner status mutations through guarded persistence helpers.
3. Added unit tests for legal paths, illegal completion, terminal-state reopening, and approval immutability.
4. Added a deterministic event-evidence reducer.
5. Added detection for event sequence gaps, missing plan evidence, unresolved and orphan tool events, unresolved and orphan approval events, conflicting terminal events, and completion without step evidence.
6. Added an Evidence Ledger tab to the functioning run-detail interface.
7. Added a deterministic baseline evaluation harness and committed JSON and Markdown result artifacts.
8. Added a noninteractive repository source linter.
9. Added security-sensitive workstation guidance that explicitly forbids requesting disabled endpoint protection.
10. Added an implementation-grounded threat model, abuse-case registry, data inventory, data lifecycle contract, and UI design doctrine.
11. Strengthened CI with lint, baseline evaluation, and release audit gates.

## Architecture decisions

- ADR-0018 selects a storage-neutral pure lifecycle guard with guarded persistence helpers.
- ADR-0019 selects an evidence-first run interface that complements, rather than replaces, the graph and timeline.

## Design changes

The new Evidence Ledger uses a vertical proof spine rather than a generic metric-card grid. It shows causal obligations and named gaps, combines color with text and icons, and states that structural evidence coverage is not independent verification.

## Validation results

- Canonical validation: passed.
- English-only validation: passed.
- Release audit: passed.
- Repository source lint: passed.
- TypeScript typecheck: passed.
- Safe unit baseline: 11 suites, 47 tests passed.
- Deterministic evaluation harness: 8 of 8 cases passed.
- Full test command: 11 suites and 47 tests passed; 3 database-dependent suites were blocked before test collection by the unavailable `better-sqlite3` native binding.
- Production build: generated substantial `.next` compile output but did not complete within the five-minute audit command limit. It was stopped rather than allowed to stall the workstation workflow. No successful production-build claim is made.

## Security findings

- Prompt text does not directly grant tool permission; policy remains an external decision point.
- Unknown tools are rejected.
- Lifecycle mutation of resolved approvals is now rejected in process.
- SSRF controls, global capability budgets, tenant isolation, secret rotation, and supply-chain provenance remain incomplete canonical tasks.

## Sovereignty findings

- Deterministic simulation, local state, local UI assets, and system fonts require no commercial key.
- Optional remote providers remain adapters.
- Native SQLite remains a required local runtime dependency and needs a platform-appropriate trusted installation path.
- Full offline startup was not executed because the native database binding was unavailable in the constrained audit profile.

## Performance, cost, and energy

No defensible application-level performance or energy improvement is claimed. The safe test suite completes in approximately six seconds with two workers in the audit environment. PERF-001 and ENGY-001 remain required for workload, capacity, energy, and total-cost measurements.

## Remaining critical risks

- No durable checkpoint, lease, idempotency record, or restart resume.
- No complete tenant and delegated authorization model.
- No capability broker or tool sandbox.
- No complete export, encrypted backup, restore drill, or deletion propagation.
- No independent verifier identity in runtime state.
- No SBOM, model hash registry, signed provenance, or plugin conformance boundary.
- Database integration and full production build remain unverified in this constrained environment.

## Next canonical execution order

1. Independent verification of LIF-001, EVAL-001, THR-001, DAT-001, and UX-002.
2. SKL-001 filesystem-to-application skill importer.
3. DUR-001 durable work contract, followed by checkpoint and idempotency implementation.
4. CAP-001 capability broker contract before expanding external tools or protocols.
5. OPS-001 export, encrypted backup, restore, and disaster-recovery drill.
