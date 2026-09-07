# v27 Governed AI and Engineering Assistant Architecture

## Decision
A broad reasoning model may analyze repository context and propose engineering work, but it is not a source of authority. Its output is admitted only as a signed, evidence-linked, budget-bounded `PROPOSAL_ONLY` receipt with a `research` promotion ceiling.

## Boundary
The model orchestrator verifies tenant/subject/scope/time authority, filters untrusted prompt-injection content, bounds context/output/claims/tools/latency, validates an acyclic work graph, and persists an idempotent signed receipt. The engineering assistant independently verifies the receipt signature, identity, proposal-only status, promotion ceiling, and semantic tool contract before creating canonical agent proposals.

The assistant may produce:
- claims linked to declared evidence;
- test, review and operational recommendations;
- canonical single-file change proposals;
- a signed review packet and traceability links.

It may not:
- approve its own output;
- mutate files, call a network, or create external effects;
- bypass the governed-agent proposal store;
- promote beyond research;
- convert unsupported claims into evidence.

## Failure and recovery
Stored model runs and agent proposals are digest-bound and idempotent. Restart reuses a valid canonical receipt/proposal; conflicting reuse or tampering fails closed. Operational blockers remain visible in the action center.

## Validation
The design requires positive, adversarial, mutation, architecture-cycle, restart, signature-substitution, prompt-injection, budget, tool-contract, and independent-review tests. Local benchmark results are regression guards only.
