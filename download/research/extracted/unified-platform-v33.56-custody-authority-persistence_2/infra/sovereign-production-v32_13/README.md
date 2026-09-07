# Sovereign Production Cell v32.13

Status: **repository-local implementation complete; external multi-host production qualification not executed**.

The cell deliberately avoids a large microservice stack. It reuses the canonical platform primitives for identity, encrypted secrets, content-addressed artifacts, telemetry, durable outbox execution and governed model boundaries. v32.13 adds a tenant-bound semantic cache, single-flight job coalescing, hard admission control, cost evidence, policy-driven local/external routing and an exact topology optimizer.

## Minimal production shape

- Two strong data nodes: application, PostgreSQL, worker and content-addressed storage roles.
- One small independently governed witness/verifier node.
- One encrypted backup target in another provider/failure domain.
- No mandatory Redis, Kafka, OpenSearch, separate vector database, hosted identity provider or per-seat observability service.

## Why this is smaller

PostgreSQL already carries durable transactions, FORCE RLS, outbox claims, idempotency and append-only evidence. Adding a separate broker or distributed cache before measured need would increase failure modes and cost. The native efficiency fabric prevents duplicate work and paid-model escalation before infrastructure scaling is considered.

## Qualification order

1. Create non-root hosts and private networking.
2. Supply real prices to the topology optimizer; archive the selected-plan digest.
3. Build and test the package from a clean extraction.
4. Execute PostgreSQL HA, FORCE RLS, failover and PITR qualification.
5. Execute multi-host cache/dedup consistency and node-loss tests.
6. Execute independent witness/verifier qualification.
7. Execute load tests using representative workloads and record p95, throughput, memory, queue depth and cost-event evidence.
8. Keep production promotion blocked until all external gates pass and an authorized human decision is recorded.

The compose file is a disposable single-host qualification harness. It is not a multi-host production claim.
