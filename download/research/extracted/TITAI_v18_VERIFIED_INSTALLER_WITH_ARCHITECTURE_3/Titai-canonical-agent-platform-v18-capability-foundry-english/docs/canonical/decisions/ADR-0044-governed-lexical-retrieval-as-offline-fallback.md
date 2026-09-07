# ADR-0044: Governed lexical retrieval as the offline fallback

## Status
Accepted.

## Problem
A missing embedding model or vector service must not disable governed memory or trigger an undisclosed remote dependency.

## Alternatives
1. Require remote embeddings.
2. Disable all retrieval when embeddings are unavailable.
3. Use a reconstructable local BM25 index after tenant, workspace, sensitivity, expiry, status, and contradiction-risk filters.

## Decision
Adopt option 3 as the explicit no-embedding fallback. Embeddings and reranking may be evaluated as optional derived indexes, but canonical records remain authoritative.

## Safety impact
Scope and risk filters run before ranking. The fallback requires no network and no proprietary index, and character budgets prevent unbounded prompt injection.

## Acceptance evidence
- `src/lib/sovereignty/local-retrieval.ts`
- `tests/sovereign-local-retrieval.test.ts`
