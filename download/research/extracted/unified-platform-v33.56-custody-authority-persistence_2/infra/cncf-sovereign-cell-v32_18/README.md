# v32.18 Sovereign Control-Plane Cell

This directory is a production-shaped deployment profile, not evidence that external daemons ran.

The repository owns the portable contracts and evaluators. Dapr, SPIRE, OPA, OpenTelemetry Collector, Wasmtime and CloudNativePG remain replaceable implementations behind those contracts.

## Qualification order

1. Pin image and binary digests.
2. Establish SPIFFE node and workload attestation.
3. Admit components with independent publisher/reviewer evidence.
4. apply bounded timeout, retry, circuit-breaker and bulkhead policies.
5. execute durable workflow crash/replay tests.
6. prove telemetry tail-sampling preserves errors, security and latency traces under budget.
7. run PostgreSQL replication, backup, PITR and failover probes.
8. collect external reviewer and witness evidence.

No local fixture can satisfy a production gate.
