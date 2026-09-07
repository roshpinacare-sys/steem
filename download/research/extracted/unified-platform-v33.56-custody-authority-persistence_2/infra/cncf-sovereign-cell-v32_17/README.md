# CNCF Sovereign Cell v32.17

This kit is an execution-ready profile, not evidence that the external runtimes were executed.

The central seam is the Dapr building-block contract: service invocation, state, pub/sub, workflow, bindings, secrets, configuration and distributed lock. Private components are admitted only with a proof-carrying manifest, a SPIFFE workload identity, independent review, a bound policy digest, bounded resources and Unix-domain-socket transport.

Complementary control planes are deliberately replaceable: SPIRE for workload identity, OPA for policy, OpenTelemetry for telemetry, Wasmtime for WASM components and CloudNativePG for PostgreSQL HA/PITR. The repository-local harness proves semantic portability between the native implementation and a Dapr-envelope profile, but does not claim execution of those external daemons.
