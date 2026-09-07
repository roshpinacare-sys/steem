# ADR-0022: Governed Local Memory Baseline

Status: Accepted for a user-controlled baseline; automatic agent retrieval remains disabled.

## Problem

A vector database alone does not provide ownership, provenance, correction, expiry, deletion, contradiction handling, sensitivity control, or retrieval explanation. Automatically injecting ungoverned memories into prompts creates privacy and prompt-injection risks.

## Decision

Implement a local text-and-metadata memory ledger with:

- Explicit memory type, owner, provenance, confidence, authority, contradiction risk, sensitivity, expiry, and content hash.
- Immutable correction linkage: a replacement points to the corrected record and the prior record leaves the active retrieval set.
- Hard owner deletion and account-cascade deletion.
- Owner-scoped retrieval with expiry/status filters, restricted-memory exclusion by default, reasoned scoring, and a token budget.
- A user-visible ledger for creation, inspection, correction, and deletion.
- No automatic agent prompt injection in this release. Memory is evidence and cannot grant tool authority or override policy.

## Alternatives

1. Add embeddings and an external vector service first. Rejected because governance and sovereignty would remain unresolved.
2. Store free-form memories inside agent prompts. Rejected because correction, deletion, and provenance would be unreliable.
3. Disable memory entirely. Rejected because an inspectable user-controlled baseline has practical value and creates testable contracts.

## Consequences

The baseline is useful without API keys and is independently inspectable. Semantic quality is lexical until a measured local retrieval adapter is promoted. Poisoning and isolation integration tests are required before automatic agent use.
