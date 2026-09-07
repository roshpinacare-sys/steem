# Titai Threat Model

## Scope

This model covers the current Next.js application, local SQLite state, model-provider adapters, prompt and skill composition, policy evaluation, tool execution, approvals, artifacts, event streaming, and release packaging.

## Primary assets

- User identities and password hashes.
- Provider credentials encrypted at rest.
- Agent prompts, skill instructions, and versions.
- Run objectives, messages, events, approvals, and artifacts.
- Policy rules and capability decisions.
- Audit-chain integrity.
- Local database, backups, and release artifacts.
- Operator authority over high-risk actions.

## Trust boundaries

1. Browser to application routes.
2. Application routes to authenticated session.
3. Runner to model provider or local simulation.
4. Model output to policy and tool boundary.
5. Tool executor to filesystem or network side effects.
6. Runtime to SQLite persistence.
7. Source tree to dependency and build supply chain.
8. Exported ZIP to the next execution environment.

## Critical abuse cases

| ID | Abuse case | Current control | Gap / next task |
|---|---|---|---|
| AB-001 | Prompt instructs an agent to bypass approval | Policy decision is outside the prompt | Capability broker still required: CAP-001/CAP-002 |
| AB-002 | Tool-result injection changes future reasoning | Tool results are inserted as messages | Add typed result envelopes and taint labels |
| AB-003 | Unknown tool name is requested | Runner rejects unknown tools | Preserve deny-by-default behavior |
| AB-004 | High-risk action runs without operator consent | Policy can route to human approval | Approval UX and restart-safe resume remain incomplete |
| AB-005 | Resolved approval is changed | Lifecycle guard rejects terminal mutation | Add database-level concurrency protection later |
| AB-006 | Run is marked complete with unresolved side effect | Evidence summary detects missing result | Prevent terminal transition at persistence boundary in a future task |
| AB-007 | Cross-user data is returned by an API | Queries generally scope by user | Full tenancy and authorization model remains IAM-001 |
| AB-008 | API key leaks through UI or logs | Ciphertext storage and masked display | Secret rotation and key custody remain SEC-002 |
| AB-009 | Malicious URL causes SSRF through fetch tool | Policy and approvals can intervene | URL allow/deny controls and egress sandbox remain SAN-001 |
| AB-010 | Dependency or model artifact is compromised | Lockfile and release audit exist | SBOM, model hashes, and provenance remain SUP-001/MOD-001 |
| AB-011 | Event sequence is corrupted or incomplete | Evidence ledger detects sequence gaps | Durable append concurrency requires DUR-002 |
| AB-012 | Server restart strands an approval | Run becomes interrupted honestly | Durable checkpoint and resume remain DUR-002/DUR-003 |
| AB-013 | Resource exhaustion from unlimited work | Agent limits exist per run | Global admission control and backpressure remain PERF-001 |
| AB-014 | Release ZIP contains credentials or runtime data | Release audit blocks known forbidden files | Add SBOM and signed provenance later |

## Fail-closed requirements

- Unknown tools must not execute.
- Medium or high risk without a matching policy must require a human.
- Missing provider credentials must not silently route to an unapproved remote provider.
- Invalid lifecycle transitions must fail before persistence.
- A failed release gate must not be downgraded to a warning.

## Verification boundary

This document is an implementation-grounded threat model, not penetration-test certification. Each open control maps to a canonical task.
