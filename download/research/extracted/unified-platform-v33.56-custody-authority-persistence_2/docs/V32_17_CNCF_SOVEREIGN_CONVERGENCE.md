# v32.17 — CNCF Sovereign Building-Block Convergence

## Objective

Reduce paid-service dependence and operational duplication without replacing sovereignty with a new platform monopoly.

## Architecture

The platform treats the Dapr building-block profile as a portable contract, not as an unquestioned authority. Private components are admitted only when exact interfaces, a trusted SPIFFE domain, Unix-domain-socket transport, bounded resources, digest lineage, egress policy and independent review agree. OPA, OpenTelemetry, Wasmtime and CloudNativePG remain pinned external execution targets; their daemons were not available in the offline local environment.

Eight capabilities are normalized behind one portable surface: service invocation, state, publish/subscribe, workflow, bindings, secrets, configuration and distributed locking. A native adapter and a Dapr-envelope adapter execute one deterministic scenario and must produce identical semantic traces.

## Measured local proof

The local fixture covers all eight building blocks with four selected components, two publisher organizations and full alternative-provider coverage. Against an eight-unit, cost-80 normalized baseline, the selected topology uses four operational units and cost 32: 50% fewer operational units and 60% lower normalized cost. These are model measurements, not external invoices or production benchmarks.

## Trust boundary

Production remains blocked unless actual pinned runtimes execute on independently operated hosts and produce externally observed identity, policy, telemetry, isolation, database failover and recovery evidence. A local envelope fixture cannot satisfy that requirement.
